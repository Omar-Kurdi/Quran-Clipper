/**
 * Gemini-based audio-to-Quran-timeline matcher.
 *
 * `runGeminiMatch` sends the uploaded audio inline to Gemini and asks it to
 * both *listen* and *segment* in one shot, returning approximate timestamps.
 * `runGeminiIdentify` asks it to do only the first half -- see
 * `hybridMatcher.ts`, which pairs that with the local forced aligner for the
 * timing Gemini structurally can't produce. See `asrAligner.ts` for the
 * alternative all-local pipeline.
 */

import { getRange } from '@/lib/quranCorpus';
import { SURAHS_LIST } from '@/lib/quranData';
import type { MatchResult, MatchSegment } from '@/lib/matchTypes';

type GeminiRawResponse = {
  audioDuration?: number;
  confidence?: number;
  transcript?: string;
  segments?: MatchSegment[];
  notes?: string;
};

/** One contiguous block of ayahs, as identified (not timed) by Gemini. */
export type GeminiRange = { surah: number; start: number; end: number };

export type GeminiIdentifyResult = {
  transcript?: string;
  confidence?: number;
  notes?: string;
  ranges: GeminiRange[];
};

type GeminiIdentifyRaw = {
  transcript?: string;
  confidence?: number;
  notes?: string;
  ranges?: { surahNumber?: number; startAyah?: number; endAyah?: number }[];
};

function getAudioMimeType(file: File) {
  // Only trust a type that actually names an audio format. Clients that don't
  // sniff the file send `application/octet-stream`, which is non-empty but
  // tells Gemini nothing -- fall through to the extension in that case.
  if (file.type?.startsWith('audio/')) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.mp3')) return 'audio/mpeg';
  if (name.endsWith('.wav')) return 'audio/wav';
  if (name.endsWith('.m4a')) return 'audio/mp4';
  if (name.endsWith('.aac')) return 'audio/aac';
  if (name.endsWith('.ogg') || name.endsWith('.opus')) return 'audio/ogg';
  if (name.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
}

function extractJson<T>(text: string): T {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;

  try {
    return JSON.parse(jsonText);
  } catch (firstError) {
    const repaired = jsonText.replace(/,\s*([}\]])/g, '$1').replace(/}\s*{/g, '},{');
    try {
      return JSON.parse(repaired);
    } catch {
      console.error('Gemini returned malformed JSON:', jsonText);
      throw firstError;
    }
  }
}

function buildPrompt(params: { selectedSurah: number; selectedStart: number; selectedEnd: number; reciter: string; verseList: string }) {
  return `
You are an expert Quran recitation audio alignment engine.

Task:
Analyze the uploaded Quran recitation audio and return the exact detected Quran timeline.

Selected context, if the user already chose the correct range:
- Selected surah number: ${params.selectedSurah}
- Selected ayah range: ${params.selectedStart}-${params.selectedEnd}
- Selected reciter id/name: ${params.reciter}

Important:
The uploaded audio may include a different surah/range, multiple surahs, repeated Al-Fatihah, salah/two-rak'ah prayer recitation, repeated ayahs, partial ayah phrases, and repeated phrases.

Known Quran text for the selected range, useful only if it matches the audio:
${params.verseList || 'No selected-range text was available.'}

Instructions:
1. Listen to the uploaded audio.
2. Detect the actual Quran ayahs and exact phrases recited.
3. Preserve the exact recitation order.
4. Segment at every meaningful recitation pause, breath, repetition, or phrase boundary, even inside the same ayah.
5. If Surah Al-Fatihah is recited fully, return all detected Al-Fatihah ayahs individually: 1:1 through 1:7.
6. Never represent the whole of Al-Fatihah as only 1:1.
7. If a verse or phrase is repeated, include it again as a separate segment.
8. If multiple surahs are recited, include each segment in order.
9. Do not add verses or words that are not present in the audio.
10. If the audio starts at verse 40:14, the first segment must be 40:14, not 40:1.
11. Produce accurate start and end timestamps in seconds for every segment.

CRITICAL — displayTextUthmani field:
- For EVERY segment, you MUST include the displayTextUthmani field.
- displayTextUthmani must contain ONLY the Arabic words the reciter actually speaks during that segment's time window.
- If only part of an ayah is recited, displayTextUthmani must contain only that partial phrase, not the whole ayah.
- If the reciter repeats a phrase, create a separate segment for each repetition with the same verseKey and put only the repeated phrase in displayTextUthmani.
- Use the full ayah text for displayTextUthmani ONLY when the entire ayah is recited in one continuous block without internal pauses.
- NEVER put unrecited words in displayTextUthmani — the UI shows this text directly to users.

Return JSON only. Do not include Markdown code fences.

Required JSON schema:
{
  "audioDuration": number,
  "confidence": number,
  "transcript": "Arabic transcript if available",
  "segments": [
    {
      "verseKey": "40:14",
      "surahNumber": 40,
      "verseNumber": 14,
      "startTime": 0.0,
      "endTime": 5.2,
      "confidence": 0.86,
      "displayTextUthmani": "exact Arabic words recited in this segment, not necessarily the full ayah",
      "displayTransliteration": "optional transliteration of only the displayed words",
      "displayTranslation": "optional English meaning of only the displayed words",
      "notes": "optional short note"
    }
  ],
  "notes": "overall matching notes"
}

Return JSON only.
`.trim();
}

/**
 * OpenAPI-subset schema for the full match response. Passing this as
 * `responseSchema` (with `responseMimeType: application/json`) makes Gemini
 * constrain its own decoding to valid JSON of this shape, which is what
 * actually cuts down on the malformed-output cases `extractJson`'s regex
 * repair was compensating for -- that repair stays in place as a fallback,
 * not as the primary defense.
 */
const MATCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    audioDuration: { type: 'NUMBER' },
    confidence: { type: 'NUMBER' },
    transcript: { type: 'STRING' },
    segments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          verseKey: { type: 'STRING' },
          surahNumber: { type: 'INTEGER' },
          verseNumber: { type: 'INTEGER' },
          startTime: { type: 'NUMBER' },
          endTime: { type: 'NUMBER' },
          confidence: { type: 'NUMBER' },
          displayTextUthmani: { type: 'STRING' },
          displayTransliteration: { type: 'STRING' },
          displayTranslation: { type: 'STRING' },
          notes: { type: 'STRING' }
        },
        required: ['verseKey', 'startTime', 'endTime', 'displayTextUthmani']
      }
    },
    notes: { type: 'STRING' }
  },
  required: ['segments']
};

const IDENTIFY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
    ranges: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          surahNumber: { type: 'INTEGER' },
          startAyah: { type: 'INTEGER' },
          endAyah: { type: 'INTEGER' }
        },
        required: ['surahNumber', 'startAyah', 'endAyah']
      }
    },
    notes: { type: 'STRING' }
  },
  required: ['ranges']
};

/** Generous -- a long clip legitimately takes a while -- but finite. */
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 180_000;

/**
 * Statuses worth trying again: 503 UNAVAILABLE ("this model is currently
 * experiencing high demand"), 429 rate limit, and transient 500s. Observed
 * three times in one testing session, and each one silently costs the hybrid
 * provider its Gemini-identified range -- it falls back to the UI's selection,
 * which may be wrong. One retry converts most of those back into a real answer.
 */
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const GEMINI_RETRIES = 1;
const GEMINI_RETRY_DELAY_MS = 2_000;

async function callGemini<T>(params: {
  apiKey: string;
  model: string;
  audio: File;
  prompt: string;
  schema: object;
}): Promise<T> {
  const audioBuffer = Buffer.from(await params.audio.arrayBuffer());
  const base64Audio = audioBuffer.toString('base64');
  const mimeType = getAudioMimeType(params.audio);
  const approxMb = audioBuffer.byteLength / 1024 / 1024;
  if (approxMb > 18) {
    throw new Error('Audio file is too large for inline Gemini matching. Please upload a shorter/compressed MP3 under ~18 MB, or upgrade this endpoint to use the Gemini File API.');
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${params.apiKey}`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: params.prompt }, { inline_data: { mime_type: mimeType, data: base64Audio } }] }],
    generationConfig: {
      temperature: 0.1,
      topP: 0.8,
      responseMimeType: 'application/json',
      responseSchema: params.schema
    }
  });

  let res: Response | null = null;
  for (let attempt = 0; attempt <= GEMINI_RETRIES; attempt++) {
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        // Audio requests are slow and Gemini's latency is highly variable -- a
        // single identify call took 120s under load during testing. Without a
        // ceiling the whole match request hangs on it indefinitely; with one,
        // the hybrid provider can fall back to the selected range instead.
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
      });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') {
        throw new Error(`Gemini did not respond within ${GEMINI_TIMEOUT_MS / 1000}s (model ${params.model}).`);
      }
      throw err;
    }

    if (res.ok || !RETRYABLE_STATUSES.has(res.status) || attempt === GEMINI_RETRIES) break;

    console.warn(`[geminiMatcher] ${res.status} from ${params.model}, retrying once in ${GEMINI_RETRY_DELAY_MS}ms.`);
    await new Promise(resolve => setTimeout(resolve, GEMINI_RETRY_DELAY_MS));
  }

  if (!res || !res.ok) {
    const errorText = res ? await res.text() : 'no response';
    console.error('Gemini audio matching failed', { status: res?.status, statusText: res?.statusText, model: params.model, mimeType, approxMb, errorText });
    throw new Error(`Gemini audio matching failed (${res?.status ?? 0}): ${errorText}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || '';
  if (!text) throw new Error('Gemini returned no alignment output.');
  return extractJson(text) as T;
}

export async function runGeminiMatch(params: {
  apiKey: string;
  model: string;
  audio: File;
  selectedSurah: number;
  selectedStart: number;
  selectedEnd: number;
  reciter: string;
}): Promise<MatchResult> {
  let verseList = '';
  try {
    const verses = await getRange(params.selectedSurah, params.selectedStart, params.selectedEnd);
    verseList = verses.map(v => `${v.verseKey}: ${v.textUthmani}`).join('\n');
  } catch {
    // Gemini can still work from audio alone if the reference text fetch fails.
  }

  const prompt = buildPrompt({
    selectedSurah: params.selectedSurah,
    selectedStart: params.selectedStart,
    selectedEnd: params.selectedEnd,
    reciter: params.reciter,
    verseList
  });

  const raw = await callGemini<GeminiRawResponse>({
    apiKey: params.apiKey,
    model: params.model,
    audio: params.audio,
    prompt,
    schema: MATCH_SCHEMA
  });
  const segments = Array.isArray(raw.segments) ? raw.segments : [];

  return {
    audioDuration: raw.audioDuration,
    confidence: raw.confidence,
    transcript: raw.transcript,
    segments,
    notes: raw.notes
  };
}

/**
 * Identify-only pass: what was recited and in what order, with no timestamps
 * requested at all. Timestamps are exactly the thing an LLM has no frame-level
 * grounding for -- see docs/ALIGNMENT.md -- so the hybrid provider uses this
 * instead of `runGeminiMatch`, and hands the identified ranges to the local
 * forced aligner for timing.
 */
function buildIdentifyPrompt(params: { selectedSurah: number; selectedStart: number; selectedEnd: number }) {
  return `
You are an expert Quran recitation identifier.

Task:
Listen to the uploaded Quran recitation audio and identify ONLY which Quran ayahs are recited and in what order. Do NOT estimate timestamps -- exact word timing is computed separately by a dedicated forced-alignment step; your only job is correctly identifying the text.

Selected context, if the user already chose the correct range:
- Selected surah number: ${params.selectedSurah}
- Selected ayah range: ${params.selectedStart}-${params.selectedEnd}

Instructions:
1. Listen to the whole clip.
2. List every contiguous block of ayahs recited, in recitation order (e.g. Al-Fatihah then the first five ayahs of Al-Baqarah is two blocks).
3. If a phrase, ayah, or block is repeated, or the reciter restarts partway through and carries on, do NOT add a separate block for the repeat -- report each block's linear ayah range once. Repetition is detected separately, from the audio itself.
4. If only part of an ayah is recited, still report the full ayah number it belongs to.
5. Do not invent verses that are not present in the audio.
6. If the audio starts at verse 40:14, the first block must start at ayah 14, not ayah 1.

Return JSON only, matching the schema. Do not include Markdown code fences.
`.trim();
}

export async function runGeminiIdentify(params: {
  apiKey: string;
  model: string;
  audio: File;
  selectedSurah: number;
  selectedStart: number;
  selectedEnd: number;
}): Promise<GeminiIdentifyResult> {
  const prompt = buildIdentifyPrompt(params);
  const raw = await callGemini<GeminiIdentifyRaw>({
    apiKey: params.apiKey,
    model: params.model,
    audio: params.audio,
    prompt,
    schema: IDENTIFY_SCHEMA
  });

  const ranges = validateRanges(raw.ranges || []);

  return {
    transcript: raw.transcript,
    confidence: raw.confidence,
    notes: raw.notes,
    ranges
  };
}

/** Cap on how much text one identify pass may hand to the aligner. Generous --
 * a full medium surah easily clears 50 ayahs -- but wide enough to catch a
 * hallucinated range before it reaches `getRange` and the sidecar. */
const MAX_TOTAL_AYAHS = 200;

/**
 * Drops or clamps anything the sidecar/`getRange` can't act on: surah numbers
 * outside 1-114, ayah numbers outside that surah's real range, and inverted
 * ranges. Forced alignment can't fail loudly (docs/ALIGNMENT.md again) --
 * a bad range doesn't error, it produces a complete, confident-looking, wrong
 * timeline -- so bad input is worth rejecting here rather than downstream.
 */
function validateRanges(rawRanges: { surahNumber?: number; startAyah?: number; endAyah?: number }[]): GeminiRange[] {
  const valid: GeminiRange[] = [];
  let totalAyahs = 0;

  for (const r of rawRanges) {
    const surah = Math.trunc(Number(r.surahNumber));
    const meta = SURAHS_LIST.find(s => s.number === surah);
    if (!meta) continue;

    const start = Math.max(1, Math.trunc(Number(r.startAyah)));
    const end = Math.min(meta.numberOfAyahs, Math.trunc(Number(r.endAyah)));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;

    totalAyahs += end - start + 1;
    if (totalAyahs > MAX_TOTAL_AYAHS) {
      console.warn(`[geminiMatcher] identify returned over ${MAX_TOTAL_AYAHS} ayahs total -- dropping the rest as implausible.`);
      break;
    }
    valid.push({ surah, start, end });
  }

  return valid;
}
