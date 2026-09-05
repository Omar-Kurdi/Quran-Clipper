import { NextRequest, NextResponse } from 'next/server';
import { SURAHS_LIST } from '@/lib/quranData';
import { runGeminiMatch } from '@/lib/geminiMatcher';
import { runForcedAlignMatch } from '@/lib/forcedAligner';
import {
  fetchVersesByDetectedSegments,
  enforceTimelineOrder,
  getPrimaryTimelineSummary,
  estimateDurationFromSegments
} from '@/lib/matchTimeline';
import type { MatchResult } from '@/lib/matchTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `align` force-aligns the known text against the audio locally and is the
 * accurate path -- it cannot drop or garble a word. `gemini` is the zero-setup
 * cloud option, at the cost of estimated rather than measured timing. See
 * docs/ALIGNMENT.md.
 */
type Provider = 'gemini' | 'align';

const PROVIDERS: Provider[] = ['gemini', 'align'];

/**
 * Whether the UI should ask the user to check the result before publishing.
 *
 * Deliberately not a single threshold: the two providers' `confidence` values
 * are not the same kind of number, and only `align` can come back clean.
 */
function needsReview(provider: Provider, confidence: number, warned: boolean): boolean {
  // The sidecar's coverage check found the text didn't match the audio.
  if (warned) return true;

  switch (provider) {
    // Timing is an LLM estimate every single time -- there is no run where it
    // was measured. Gemini's self-reported score runs high regardless (0.97 on
    // a response whose final segment had to be clamped from 108s to 68.5s), so
    // gating on it would stay silent on exactly the least accurate provider.
    case 'gemini':
      return true;
    // The user asserted the range themselves and the coverage check passed, so
    // there is nothing left to flag.
    case 'align':
      return false;
  }
}

function defaultAsrServiceUrl() {
  return process.env.ASR_SERVICE_URL || 'http://127.0.0.1:8000';
}

/** Model IDs are retired regularly -- keep this current, and see .env.example. */
const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

function geminiModel() {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

function resolveProvider(requested: string | null): Provider {
  const normalized = (requested || '').trim().toLowerCase() as Provider;
  if (PROVIDERS.includes(normalized)) return normalized;
  const envDefault = (process.env.AUDIO_MATCH_PROVIDER || 'gemini').trim().toLowerCase() as Provider;
  return PROVIDERS.includes(envDefault) ? envDefault : 'gemini';
}

export async function POST(req: NextRequest) {
  let provider: Provider = 'gemini';
  try {
    /**
     * A body too large to have arrived whole reads as a parse failure.
     *
     * Middleware runs on every path here, so the framework buffers the request
     * body up to `proxyClientMaxBodySize` (`next.config.ts`) and *truncates*
     * past it rather than refusing -- the route then sees a half-written
     * multipart stream and throws "Failed to parse body as FormData", which
     * says nothing about the actual cause. Name it.
     */
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (parseError) {
      const size = Number(req.headers.get('content-length') || 0);
      const megabytes = size > 0 ? Math.round(size / 1_048_576) : 0;
      return NextResponse.json(
        {
          success: false,
          provider,
          error: megabytes
            ? `The upload (${megabytes} MB) did not arrive whole. Raise \`experimental.proxyClientMaxBodySize\` in next.config.ts, or send a shorter recording.`
            : `Could not read the upload: ${(parseError as Error)?.message || 'unknown error'}`
        },
        { status: 413 }
      );
    }
    provider = resolveProvider(String(formData.get('provider') || req.nextUrl.searchParams.get('provider') || ''));
    const audio = formData.get('audio');
    // Either an upload, or one of the built-in reciters: a URL plus the window
    // of it to read. The reciter's file is the whole chapter, so sending it
    // here would mean carrying up to 87 MB through this process to use half a
    // minute of it.
    const audioUrl = String(formData.get('audioUrl') || '').trim();
    const windowStart = Number(formData.get('windowStart') ?? NaN);
    const windowEnd = Number(formData.get('windowEnd') ?? NaN);
    const hasWindow = !!audioUrl && Number.isFinite(windowStart) && Number.isFinite(windowEnd) && windowEnd > windowStart;

    if (!(audio instanceof File) && !hasWindow) {
      return NextResponse.json(
        { success: false, error: 'Send an audio file, or an audioUrl with windowStart and windowEnd.' },
        { status: 400 }
      );
    }
    if (hasWindow && provider !== 'align' && !(audio instanceof File)) {
      // Only the local aligner can be pointed at a URL. Gemini needs the bytes
      // inline, and sending it two hours of chapter to match three ayahs is
      // neither affordable nor within its upload limit.
      return NextResponse.json(
        { success: false, error: 'Matching a built-in reciter needs the local aligner. Choose "Local", or upload the audio.' },
        { status: 400 }
      );
    }

    const selectedSurah = parseInt(String(formData.get('surah') || '1'), 10);
    const selectedSurahMeta = SURAHS_LIST.find(s => s.number === selectedSurah) || SURAHS_LIST[0];
    const selectedStart = Math.max(1, parseInt(String(formData.get('start') || '1'), 10));
    const selectedEnd = Math.min(
      selectedSurahMeta.numberOfAyahs,
      Math.max(selectedStart, parseInt(String(formData.get('end') || String(selectedSurahMeta.numberOfAyahs)), 10))
    );
    const reciter = String(formData.get('reciter') || '');

    let result: MatchResult;

    if (provider === 'align') {
      const serviceUrl = defaultAsrServiceUrl();
      try {
        // Auto-detect by default: the sidecar reads the audio and finds the
        // passage itself. Send `autoDetect=false` to align the range the user
        // picked in the UI instead.
        const autoDetect = String(formData.get('autoDetect') ?? 'true').toLowerCase() !== 'false';
        result = await runForcedAlignMatch({
          serviceUrl,
          source: audio instanceof File
            ? { kind: 'file', audio }
            : { kind: 'url', audioUrl, windowStart, windowEnd },
          autoDetect,
          surah: selectedSurah,
          start: selectedStart,
          end: selectedEnd
        });
      } catch (err) {
        const error = err as Error;
        return NextResponse.json({ success: false, provider, error: error.message }, { status: 502 });
      }
    } else {
      const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!geminiApiKey) {
        return NextResponse.json(
          {
            success: false,
            provider,
            error:
              'Gemini matcher is not configured. Set GEMINI_API_KEY or GOOGLE_API_KEY to enable it, or switch the provider to "align" (requires the asr-service sidecar). Manual matching is available now.'
          },
          { status: 503 }
        );
      }
      // Narrowing for the compiler and a real guarantee for the reader: the
      // guards above have already turned away every path that reaches here
      // without a file, since Gemini needs the bytes inline.
      if (!(audio instanceof File)) {
        return NextResponse.json(
          { success: false, provider, error: 'Gemini matching needs an uploaded audio file.' },
          { status: 400 }
        );
      }
      try {
        result = await runGeminiMatch({
          apiKey: geminiApiKey,
          model: geminiModel(),
          audio,
          selectedSurah,
          selectedStart,
          selectedEnd,
          reciter
        });
      } catch (err) {
        const error = err as Error;
        return NextResponse.json({ success: false, provider, error: error.message }, { status: 502 });
      }
    }

    const segments = result.segments;
    if (segments.length === 0) {
      const providerLabel = provider === 'align' ? 'The forced aligner' : 'Gemini';
      return NextResponse.json(
        { success: false, provider, error: `${providerLabel} did not return any detected ayah segments. Try a clearer/shorter audio clip or use manual matching.` },
        { status: 422 }
      );
    }

    // Order matters, because the timeline gets clamped to this value and a
    // wrong one silently truncates a correct result.
    //
    // `align` runs through the sidecar, which actually decodes the file -- that
    // duration is a measurement and wins outright.
    // Gemini only *estimates* it (108s for a 68.5s clip on the test file) and
    // stretches its segment times to match, so there the client's value, taken
    // from the browser's own decode of the uploaded file, is the better source.
    const measuredDuration = provider === 'gemini' ? 0 : Number(result.audioDuration || 0);
    const clientDuration = Number(formData.get('audioDuration') || 0);
    const audioDuration =
      measuredDuration ||
      (Number.isFinite(clientDuration) && clientDuration > 0 ? clientDuration : 0) ||
      Number(result.audioDuration || 0) ||
      estimateDurationFromSegments(segments) ||
      segments.length * 5;
    const rawTimeline = await fetchVersesByDetectedSegments({ segments, selectedSurah, audioDuration });
    const timeline = enforceTimelineOrder(rawTimeline, audioDuration);

    // `enforceTimelineOrder` drops segments that start past the end of the
    // audio. If that emptied a timeline that had rows going in, the duration is
    // far more likely wrong than every segment -- say so instead of returning
    // `success: true` with nothing to show.
    if (rawTimeline.length > 0 && timeline.length === 0) {
      return NextResponse.json(
        {
          success: false,
          provider,
          error:
            `Every detected segment starts after the ${audioDuration}s end of the audio, so the timeline is empty. ` +
            `The audio duration and the segment times disagree -- try re-uploading the file, or use manual matching.`
        },
        { status: 422 }
      );
    }

    const summary = getPrimaryTimelineSummary(segments, selectedSurah);
    const confidence =
      typeof result.confidence === 'number'
        ? Math.max(0, Math.min(1, result.confidence))
        : timeline.length
          ? timeline.reduce((sum, verse) => sum + (verse.matchConfidence || 0), 0) / timeline.length
          : 0;

    return NextResponse.json({
      success: true,
      method: provider === 'align' ? 'ctc_forced_alignment' : 'gemini_quran_audio_timeline_alignment',
      provider,
      model: provider === 'gemini' ? geminiModel() : undefined,
      confidence,
      needsReview: needsReview(provider, confidence, Boolean(result.warning)),
      warning: result.warning || null,
      transcript: result.transcript || '',
      notes: result.notes || '',
      timelineTitle: summary.timelineTitle,
      surahNumber: summary.surahNumber,
      surahNameArabic: summary.surahNameArabic,
      surahNameEnglish: summary.surahNameEnglish,
      ayahStart: summary.ayahStart,
      ayahEnd: summary.ayahEnd,
      audioDuration,
      verses: timeline
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Audio match API failed:', error);
    return NextResponse.json({ success: false, provider, error: error.message }, { status: 500 });
  }
}

/** Lets the UI show which providers are actually usable before the user picks one. */
export async function GET() {
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  const asrServiceUrl = defaultAsrServiceUrl();

  let asrAvailable = false;
  // Whether the sidecar can work the ayah range out from the audio on its own.
  // False on a CPU-only host, where the align backend is the character model
  // rather than NeMo -- `align` then aligns the UI's selected range instead.
  let canAutoDetectRange = false;
  // A sidecar can be reachable and still be unable to align at all, if its
  // backend failed to import. Surfacing that here means the studio can say so
  // before someone uploads a file, rather than after a failed match.
  let alignReady = true;
  let alignError: string | null = null;
  try {
    // The sidecar resolves its align backend at startup so this stays a few
    // milliseconds, but allow headroom for a loaded host -- timing out here
    // greys out every local provider in the UI on a service that is actually up.
    const res = await fetch(`${asrServiceUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(4000) });
    asrAvailable = res.ok;
    if (res.ok) {
      const health = await res.json().catch(() => null);
      canAutoDetectRange = Boolean(health?.canAutoDetectRange);
      // Absent on an older sidecar, which is indistinguishable from healthy.
      alignReady = health?.alignReady !== false;
      alignError = health?.alignError ?? null;
    }
  } catch {
    asrAvailable = false;
  }

  return NextResponse.json({
    providers: {
      gemini: { configured: geminiConfigured },
      // `configured` means the provider can actually run, so a sidecar whose
      // align backend won't load is reported as not configured rather than as
      // online-but-failing.
      align: {
        configured: asrAvailable && alignReady,
        serviceUrl: asrServiceUrl,
        canAutoDetectRange,
        alignReady,
        alignError
      }
    },
    defaultProvider: resolveProvider(null)
  });
}
