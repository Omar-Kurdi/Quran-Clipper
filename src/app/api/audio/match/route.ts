import { NextRequest, NextResponse } from 'next/server';
import { SURAHS_LIST } from '@/lib/quranData';
import { runGeminiMatch } from '@/lib/geminiMatcher';
import { runAsrMatch } from '@/lib/asrAligner';
import { runForcedAlignMatch } from '@/lib/forcedAligner';
import { runHybridMatch } from '@/lib/hybridMatcher';
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
 * `align` force-aligns the known text of the selected ayah range and is the
 * accurate path -- it cannot drop or garble a word. `hybrid` keeps that timing
 * but lets Gemini pick the range, so the user doesn't have to. `asr` discovers
 * the surah from the audio but is far less reliable; `gemini` is the zero-setup
 * cloud option. See docs/ALIGNMENT.md.
 */
type Provider = 'gemini' | 'asr' | 'align' | 'hybrid';

const PROVIDERS: Provider[] = ['gemini', 'asr', 'align', 'hybrid'];

/** Only `asr` reports a confidence that means anything on its own. */
const DECODE_REVIEW_THRESHOLD = 0.75;

/**
 * Whether the UI should ask the user to check the result before publishing.
 *
 * Deliberately not a single threshold, because the four providers' `confidence`
 * values are not the same kind of number and only one of them is worth gating
 * on. `align`, the recommended path, is the only one that can come back clean.
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
    // The range came from an LLM. Coverage catches an outright
    // misidentification, but not a near miss: if the audio is 33:21-24 and
    // Gemini says 21-23, coverage still reads 1.00 while ayah 24's audio gets
    // force-fit into ayah 23's words. A human can see that; no score can.
    case 'hybrid':
      return true;
    // The user asserted the range themselves and the coverage check passed, so
    // there is nothing left to flag.
    case 'align':
      return false;
    // Free decode plus a fuzzy search over the corpus -- its confidence is a
    // real match quality, so a threshold is meaningful here.
    case 'asr':
      return confidence < DECODE_REVIEW_THRESHOLD;
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
    const formData = await req.formData();
    const audio = formData.get('audio');
    if (!(audio instanceof File)) {
      return NextResponse.json({ success: false, error: 'No audio file was uploaded.' }, { status: 400 });
    }

    const selectedSurah = parseInt(String(formData.get('surah') || '1'), 10);
    const selectedSurahMeta = SURAHS_LIST.find(s => s.number === selectedSurah) || SURAHS_LIST[0];
    const selectedStart = Math.max(1, parseInt(String(formData.get('start') || '1'), 10));
    const selectedEnd = Math.min(
      selectedSurahMeta.numberOfAyahs,
      Math.max(selectedStart, parseInt(String(formData.get('end') || String(selectedSurahMeta.numberOfAyahs)), 10))
    );
    const reciter = String(formData.get('reciter') || '');
    provider = resolveProvider(String(formData.get('provider') || req.nextUrl.searchParams.get('provider') || ''));

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
          audio,
          autoDetect,
          surah: selectedSurah,
          start: selectedStart,
          end: selectedEnd
        });
      } catch (err) {
        const error = err as Error;
        return NextResponse.json({ success: false, provider, error: error.message }, { status: 502 });
      }
    } else if (provider === 'asr') {
      const serviceUrl = defaultAsrServiceUrl();
      try {
        result = await runAsrMatch({ serviceUrl, audio });
      } catch (err) {
        const error = err as Error;
        return NextResponse.json({ success: false, provider, error: error.message }, { status: 502 });
      }
    } else {
      // Both remaining providers call Gemini, so they share the key check.
      const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!geminiApiKey) {
        return NextResponse.json(
          {
            success: false,
            provider,
            error:
              'Gemini matcher is not configured. Set GEMINI_API_KEY or GOOGLE_API_KEY to enable it, or switch the provider to "align"/"asr" (requires the asr-service sidecar). Manual matching is available now.'
          },
          { status: 503 }
        );
      }
      try {
        result =
          provider === 'hybrid'
            ? await runHybridMatch({
                apiKey: geminiApiKey,
                model: geminiModel(),
                serviceUrl: defaultAsrServiceUrl(),
                audio,
                selectedSurah,
                selectedStart,
                selectedEnd
              })
            : await runGeminiMatch({
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
      const providerLabel =
        provider === 'align'
          ? 'The forced aligner'
          : provider === 'hybrid'
            ? 'The hybrid matcher'
            : provider === 'asr'
              ? 'The local ASR aligner'
              : 'Gemini';
      return NextResponse.json(
        { success: false, provider, error: `${providerLabel} did not return any detected ayah segments. Try a clearer/shorter audio clip or use manual matching.` },
        { status: 422 }
      );
    }

    // Order matters, because the timeline gets clamped to this value and a
    // wrong one silently truncates a correct result.
    //
    // Every provider except `gemini` runs through the sidecar, which actually
    // decodes the file -- that duration is a measurement and wins outright.
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
      method:
        provider === 'align'
          ? 'ctc_forced_alignment'
          : provider === 'hybrid'
            ? 'gemini_identify_ctc_forced_alignment'
            : provider === 'asr'
              ? 'local_asr_quran_alignment'
              : 'gemini_quran_audio_timeline_alignment',
      provider,
      model: provider === 'gemini' || provider === 'hybrid' ? geminiModel() : undefined,
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
      asr: { configured: asrAvailable, serviceUrl: asrServiceUrl },
      // Same sidecar as `asr`, different endpoint on it. `configured` means the
      // provider can actually run, so a sidecar whose align backend won't load
      // is reported as not configured rather than as online-but-failing.
      align: {
        configured: asrAvailable && alignReady,
        serviceUrl: asrServiceUrl,
        canAutoDetectRange,
        alignReady,
        alignError
      },
      // Needs both halves: Gemini to identify the passage, the sidecar to time
      // it. Gemini also *replaces* the sidecar's own range detection, which is
      // why this stays fully useful on a host where `canAutoDetectRange` is false.
      hybrid: {
        configured: geminiConfigured && asrAvailable && alignReady,
        serviceUrl: asrServiceUrl,
        alignReady,
        alignError
      }
    },
    defaultProvider: resolveProvider(null)
  });
}
