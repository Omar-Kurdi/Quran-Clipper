'use client';

import { isOpening } from '@/lib/openings';
import { useRef, useEffect, useState, useImperativeHandle, forwardRef, useCallback, useMemo, type ReactNode } from 'react';
import { useOffsetBox } from '@/hooks/useOffsetBox';
import { VerseData, arabicFontFamily, usableArabicFont } from '@/lib/quranData';
import { useStudioConfig } from '@/hooks/useStudioConfig';
import {
  mushafCaption, mushafRows, pagesUsedBy, ensureQpcPages, wrapCaption, FALLBACK_ARABIC_FAMILY, QPC_V2, SURAH_NAME_FAMILY,
  type MushafRow
} from '@/lib/mushafFonts';
import { blurPath } from '@/lib/glBlur';
import { ExportHealth, accumulateStarvation, emptyHealth } from '@/lib/exportHealth';
import { encodeOffline, canEncodeOffline, OFFLINE_BITRATE, type OfflineExportResult } from '@/lib/offlineExport';
import { openBackgroundClip, type BackgroundClip } from '@/lib/videoFrames';
import { knownLoopWindow, loadLoopWindow, loopFor, loopPhase } from '@/lib/clipLoop';
import { backgroundAt, backgroundPlaylist, mediaKind, BackgroundConfig, BackgroundMode, BackgroundSegment } from '@/lib/backgroundTimeline';
import { captionTranslations, DEFAULT_TRANSLATION_ID } from '@/lib/translations';
import { frameLayout, blockTop, textFits, splitFits } from '@/lib/frameLayout';
import { paintSurahBadge, badgeSurah, badgeRange, usableBadgeStyle, DEFAULT_BADGE_OPACITY } from '@/lib/surahBadge';
import { fillArabicLine } from '@/lib/waqfMarks';
import {
  captionLayers, leadingLayer, revealedWords, recitedWord, asCaptionTransition, asWordEffect, asMotionSpeed,
  type CaptionLayer, type CaptionMotion
} from '@/lib/captionMotion';
import { drawnWordTimes, fillLineByWord } from '@/lib/arabicWords';

/**
 * A background is a clip or a still, and the two are interchangeable
 * everywhere except where a clip has to be told to play.
 */
/**
 * `VideoFrame` is here for the offline encoder, which decodes a background
 * clip itself rather than playing one: it needs the background as it looked at
 * a particular moment, and a decoded frame *is* that, where an element only
 * ever holds "now". `drawImage` takes either.
 */
type BackgroundMedia = HTMLVideoElement | HTMLImageElement | VideoFrame;

/** Duck-typed: `VideoFrame` does not exist during server rendering. */
const isFrame = (el: BackgroundMedia): el is VideoFrame =>
  typeof (el as VideoFrame).codedWidth === 'number' && !('tagName' in el);

const isClip = (el: BackgroundMedia): el is HTMLVideoElement =>
  !isFrame(el) && (el as HTMLElement).tagName === 'VIDEO';

/** Drawable: decoded enough to have pixels. A broken source never gets here. */
const mediaReady = (el: BackgroundMedia | null): boolean =>
  !!el && (isFrame(el)
    ? el.codedWidth > 0
    : isClip(el) ? el.readyState >= 2 : (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);

/**
 * Starts a decorative clip and measures where its black ends are, so neither
 * the preview nor the export ever loops through them -- see `clipLoop`.
 */
function playDecorative(media: HTMLVideoElement, url: string): void {
  media.play().catch(() => {});
  void loadLoopWindow(url);
}

/**
 * Sends a playing clip back to the start of its loop once it reaches its black
 * tail. The element loops on its own only at the end of the file, which is
 * where the black is.
 */
function keepInsideLoop(media: BackgroundMedia | null): void {
  if (!media || !isClip(media) || media.paused || media.seeking) return;
  const loop = loopFor(knownLoopWindow(media.currentSrc || media.src), media.duration);
  const trimmed = loop.start > 0 || loop.end < media.duration;
  if (trimmed && (media.currentTime >= loop.end || media.currentTime < loop.start - 0.05)) {
    // Its length is known, so its metadata is in and the seek cannot throw.
    media.currentTime = loop.start;
  }
}

const mediaSize = (el: BackgroundMedia) =>
  isFrame(el)
    ? { w: el.displayWidth || el.codedWidth, h: el.displayHeight || el.codedHeight }
    : isClip(el)
      ? { w: el.videoWidth, h: el.videoHeight }
      : { w: (el as HTMLImageElement).naturalWidth, h: (el as HTMLImageElement).naturalHeight };

export interface VideoCanvasConfig {
  aspectRatio: string;
  fontArabic: string;
  fontTranslation: string;
  arabicFontSize: number;
  translationFontSize: number;
  ayahNumberFontSize: number;
  textAlignment: string;
  textColor: string;
  accentColor: string;
  translationColor: string;
  textShadow: boolean;
  showTranslation: boolean;
  /**
   * Which translations the card shows, by quran.com resource id, in the order
   * they appear. Absent means the one every project started with.
   */
  translationIds?: string[];
  /**
   * Break the Arabic where the printed mushaf breaks it, instead of wherever
   * the card runs out of width. Only the mushaf face has the line data; other
   * faces wrap as before. Absent means off, which is every project saved
   * before it existed.
   */
  mushafLines?: boolean;
  /**
   * Draw the English of the visible words instead of the whole ayah's.
   *
   * Off by default: an unchanged project keeps the translator's sentence.
   */
  translationFollowsWords?: boolean;
  showWaveform: boolean;
  showSurahBadge: boolean;
  /** How the badge is drawn: see `BADGE_STYLES`. Absent reads as the pill every older project has. */
  badgeStyle?: string;
  /** 0-100, the plate behind the badge. Absent reads as the 74 every older project was drawn with. */
  badgeOpacity?: number;
  surahBadgeText: string;
  surahBadgeSubtitleText: string;
  /** Where the text sits on the frame: see `FRAME_LAYOUTS`. Absent reads as the centred card. */
  layout?: string;
  /** How one ayah gives way to the next: see `CAPTION_TRANSITIONS`. Absent reads as the cut every older project has. */
  captionTransition?: string;
  /** Words revealed or picked out as they are recited: see `WORD_EFFECTS`. Absent reads as neither. */
  wordEffect?: string;
  /** How quickly a caption gives way to the next: see `MOTION_SPEEDS`. */
  motionSpeed?: string;
  /** The colour of the word being recited under the highlight. Absent or empty is the accent. */
  highlightColor?: string;
  bgType: string;
  bgUrl: string;
  /** Extra backgrounds for the non-single modes. `bgUrl` stays the single-background case. */
  bgUrls?: string[];
  bgMode?: BackgroundMode;
  /** Seconds each background holds in 'cycle' mode. */
  bgCycleSeconds?: number;
  /** Hand-placed background blocks, authoritative in 'custom' mode. */
  bgSegments?: BackgroundSegment[];
  bgOverlayOpacity: number;
  bgBlur: number;
  cardBgOpacity: number;
  cardBorder: boolean;
  watermarkText: string;
  watermarkPosition: string;
  fps: number;
  gpuAccelerated: boolean;
}

export interface VideoCanvasRef {
  getCanvas: () => HTMLCanvasElement | null;
  exportVideo: (
    audioElement: HTMLAudioElement,
    /** Where in the recording the clip begins and ends, in seconds. */
    range: { start: number; end: number },
    onProgress: (progress: number, speed: string, frame: number) => void,
    /**
     * `health` says whether the recording is actually watchable. Capture is
     * real-time off the canvas, so a render that stalled produces a file that
     * looks fine everywhere except in the picture. See `exportHealth.ts`.
     */
    onComplete: (blob: Blob, renderTimeMs: number, health: ExportHealth) => void,
    targetFps?: number
  ) => void;
  stopExport: () => void;
  /**
   * Encodes the clip frame by frame instead of recording it in real time.
   *
   * Returns null when this project cannot take that path -- a video background,
   * or a browser without an H.264 encoder -- so the caller can fall back to
   * `exportVideo` rather than having to know the rules itself.
   */
  exportVideoOffline: (
    range: { start: number; end: number },
    audio: AudioBuffer,
    targetFps: number,
    onProgress: (fraction: number, framesDone: number, framesTotal: number) => void,
    /**
     * Frame size and bitrate for this render, when they are not the preview's.
     *
     * The preview is 1080-class whatever the export is: it is a thumbnail of
     * the frame, and painting 4K sixty times a second to show it in a 340px
     * column would cost the studio its responsiveness for no picture. Nothing
     * in `paintFrame` is written in pixels -- every size is scaled by
     * `height / 1920` -- so the same drawing produces the same frame at any
     * resolution.
     */
    output?: { width: number; height: number; bitrate: number }
  ) => Promise<OfflineExportResult | null>;
  /** Whether `exportVideoOffline` can run for the project as configured. */
  canExportOffline: () => boolean;
  /**
   * The frame the real-time recorder would produce.
   *
   * It captures this canvas, so it can only ever record the preview's own
   * 1080-class frame however large a render was asked for -- and a fallback to
   * that path is where a saved record started claiming a resolution the file
   * does not have.
   */
  captureSize: () => { width: number; height: number };
  /**
   * Whether every still background has loaded. The frame-by-frame path draws
   * stills from the preview's own elements, so a render that starts before
   * they arrive paints its first frames without one. Clips are decoded by the
   * render itself and need no wait.
   */
  backgroundsReady: () => boolean;
}

interface VideoCanvasProps {
  config: VideoCanvasConfig;
  verses: VerseData[];
  currentTime: number;
  /**
   * The playback position as of now, read once per painted frame while
   * playing. `currentTime` arrives a few times a second, which is plenty to
   * pick the caption but would make every fade between two of them step.
   */
  playhead?: () => number;
  audioAnalyser?: AnalyserNode | null;
  surahNameArabic: string;
  surahNameEnglish: string;
  reciterName?: string;
  surahNumber: number;
  ayahStart: number;
  ayahEnd: number;
  /**
   * Set when the background video *is* the uploaded recitation, rather than
   * decorative footage. A decorative clip loops on its own; a recitation has to
   * track playback frame-for-frame or the reciter's lips drift out of sync.
   */
  syncBackgroundVideo?: boolean;
  /** Whether playback is running, so a synced background can start and stop with it. */
  isPlaying?: boolean;
  /**
   * Seconds trimmed off the front of the audio that the background video still
   * contains. Trimming re-encodes audio only, so the original video stays
   * whole -- adding this offset keeps the two lined up instead of forcing the
   * background to be discarded after a trim.
   */
  backgroundTimeOffset?: number;
  /**
   * Drawn over the canvas, exactly over its picture and never into it -- the
   * platform safe-area guide. Nothing here can reach an export.
   */
  overlay?: ReactNode;
  /** The render loop's frame rate and paint time, for development. */
  showStats?: boolean;
}

// ---------------------------------------------------------------------------
// RoundRect polyfill
// ---------------------------------------------------------------------------
//: Floors for the verse-card shrink-to-fit. Reached only by a segment far
//: longer than the card was designed for; below these the frame is unreadable
//: anyway, and overflowing is the better failure than dropping recited words.
/**
 * Arabic that is not Quran text -- the surah badge, the ayah numeral, a
 * translation in Urdu or Persian -- draws in the face the studio has always
 * used for it. The mushaf faces are for the Quran alone.
 */
const LABEL_FAMILY = 'Amiri';

const MIN_ARABIC_PX = 16;
const MIN_TRANSLATION_PX = 10;
/** How faint the words still to come are under the highlight. */
const HIGHLIGHT_REST = 0.35;

// Handed to `document.fonts.load` so the subsets a webfont actually needs are
// the ones fetched. Google splits a family by unicode range, and the card
// spans two of them: letters, harakat and the ornate brackets are Arabic,
// while the ayah number itself is drawn from a JS number -- Western digits,
// which live in the Latin subset -- as does the space between two words.
const ARABIC_SAMPLE = 'بِسْمِ ٱللَّهِ ﴾١٢٣﴿ 0123456789';

/**
 * The calligraphic badge's face. The encoder paints without waiting for fonts,
 * so a render starts only once this has landed -- before it, the ligature is
 * never formed and the frame shows the literal `surah009`.
 */
const SURAH_NAME_FONT_SPEC: [string, string] = [`60px '${SURAH_NAME_FAMILY}'`, 'surah001'];

/**
 * Row pitch for a block of fully vocalised Arabic.
 *
 * A flat multiple of the type size cannot know how far a face stacks its
 * marks. The 1.45em used here sat under the ink of every Naskh on offer, so a
 * fatha on one row landed inside the sukun of the row above it -- measured at
 * 100px, Noto Naskh's ink spans 175px and Scheherazade New's 167px. Measure
 * the rows instead: what has to clear is the deepest descender of each row
 * against the highest mark of the row beneath it, and the widest such pair
 * sets the pitch for the block. The rest is leading.
 *
 * Measured on the alphabetic baseline on purpose. actualBoundingBox* is
 * reported against whatever `textBaseline` is current, and only from the
 * baseline the glyphs are actually built on do the two numbers describe the
 * gap between one row and the next.
 */
function arabicRowPitch(
  ctx: CanvasRenderingContext2D,
  lines: MushafRow[],
  size: number,
  fontFor: (family: string, size: number) => string
) {
  const previousBaseline = ctx.textBaseline;
  ctx.textBaseline = 'alphabetic';
  const ascents: number[] = [];
  const descents: number[] = [];
  for (const line of lines) {
    // Per row: a row that follows the mushaf is drawn in its own page's face.
    ctx.font = fontFor(line.family, size);
    const m = ctx.measureText(line.text);
    ascents.push(m.actualBoundingBoxAscent || 0);
    descents.push(m.actualBoundingBoxDescent || 0);
  }
  ctx.textBaseline = previousBaseline;

  let gap = 0;
  for (let i = 0; i + 1 < lines.length; i++) {
    gap = Math.max(gap, descents[i] + ascents[i + 1]);
  }
  // Nothing to clear, but the pitch is still this block's height for the
  // centring above, so it is the one row's own ink.
  if (lines.length < 2) gap = Math.max(0, ...ascents) + Math.max(0, ...descents);

  // An engine that reports no ink metrics gets the tallest face's ratio.
  if (!Number.isFinite(gap) || gap <= 0) return size * 1.8;
  return Math.max(gap, size * 1.45) * 1.06;
}

/** One translation, wrapped to the card at the size the fitting loop settled on. */
type TranslationBlockLayout = {
  lines: string[];
  /** Right-to-left blocks are drawn in the verse face, on a looser line. */
  rtl: boolean;
  lineHeight: number;
};

type CardTextLayout = {
  /** Each row with the family it is drawn in -- one per page when the rows follow the mushaf. */
  arabicLines: MushafRow[];
  arabicLineHeight: number;
  /** One entry per translation on the card, in the order they are drawn. */
  blocks: TranslationBlockLayout[];
  widest: number;
  /** The widest Arabic row and the widest translation line, for a split layout's boxes. */
  arabicWidest: number;
  translationWidest: number;
  arabicSize: number;
  translationSize: number;
  stackHeight: number;
};

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (typeof (ctx as any).roundRect === 'function') {
    ctx.beginPath();
    (ctx as any).roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Canvas component
// ---------------------------------------------------------------------------
export const VideoCanvas = forwardRef<VideoCanvasRef, VideoCanvasProps>(({
  config,
  verses,
  currentTime,
  playhead,
  audioAnalyser,
  surahNameArabic,
  surahNameEnglish,
  surahNumber,
  ayahStart,
  ayahEnd,
  syncBackgroundVideo = false,
  isPlaying = false,
  backgroundTimeOffset = 0,
  overlay,
  showStats = false
}, ref) => {
  // The face this installation can actually draw -- see `usableArabicFont`.
  const { missingFonts } = useStudioConfig();
  const arabicFontId = usableArabicFont(config.fontArabic, missingFonts);
  const badgeStyle = usableBadgeStyle(config.badgeStyle, missingFonts);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayBox = useOffsetBox(canvasRef, !!overlay);
  const bgMediaRef = useRef<BackgroundMedia | null>(null);
  const isExportingRef = useRef<boolean>(false);
  /**
   * Set when an export was stopped on purpose, as opposed to finishing.
   *
   * `MediaRecorder.stop()` fires `onstop` either way, so without this a
   * cancelled render still delivered whatever it had captured and the dialog
   * showed a result screen for a video nobody asked to keep.
   */
  const cancelledRef = useRef<boolean>(false);
  const videoErrorRef = useRef<boolean>(false);
  /**
   * Total frames this canvas has ever painted. The export compares it against
   * the audio clock to tell a slow render from a stopped one -- see
   * `exportHealth.ts`. Monotonic and never reset, so a sample is always the
   * difference between two readings.
   */
  const paintedFramesRef = useRef<number>(0);

  const [fpsDisplay, setFpsDisplay] = useState<number>(60);
  const [renderMs, setRenderMs] = useState<number>(1.2);

  const dimensions = useMemo(() => {
    switch (config.aspectRatio) {
      case '16:9': return { width: 1920, height: 1080 };
      case '1:1': return { width: 1080, height: 1080 };
      case '4:5': return { width: 1080, height: 1350 };
      case '9:16':
      default: return { width: 1080, height: 1920 };
    }
  }, [config.aspectRatio]);

  // Active verse
  const sortedVerses = useMemo(() => [...verses].sort((a, b) => a.startTime - b.startTime), [verses]);
  const motion = useMemo<CaptionMotion>(() => ({
    transition: asCaptionTransition(config.captionTransition),
    words: asWordEffect(config.wordEffect),
    speed: asMotionSpeed(config.motionSpeed),
  }), [config.captionTransition, config.wordEffect, config.motionSpeed]);
  /**
   * Backgrounds in play, in order.
   *
   * `bgUrl` remains the single-background case so existing projects, the saved
   * schema and the API payload keep working untouched; `bgUrls` only takes over
   * once a multi mode is selected and something is actually in the list.
   */
  const mediaPoolRef = useRef<Map<string, BackgroundMedia>>(new Map());

  /**
   * Two memos, not one, because they feed things with very different costs.
   *
   * `config` is a fresh object on every edit, so keying the pool effect off it
   * would reload every clip whenever any slider moved. Narrowing to the fields
   * that choose backgrounds fixes that -- but the cycle length is not one of
   * them, and leaving it in meant dragging "seconds per background" rebuilt the
   * playlist, and with it the pool, on every input event.
   */
  const bgSources = useMemo<BackgroundConfig>(() => ({
    bgType: config.bgType,
    bgUrl: config.bgUrl,
    bgUrls: config.bgUrls,
    bgMode: config.bgMode,
    bgSegments: config.bgSegments
  }), [config.bgType, config.bgUrl, config.bgUrls, config.bgMode, config.bgSegments]);

  const bgConfig = useMemo<BackgroundConfig>(
    () => ({ ...bgSources, bgCycleSeconds: config.bgCycleSeconds }),
    [bgSources, config.bgCycleSeconds]
  );

  /**
   * Keyed on the clips themselves rather than the list object.
   *
   * Dragging a block on the timeline rewrites `bgSegments` on every pointer
   * move; without this the pool effect would see a new array each frame and
   * re-`play()` every background for the length of the drag. The set of clips
   * to keep warm is what it actually cares about, and that rarely changes.
   */
  const playlistKey = useMemo(() => backgroundPlaylist(bgSources).join('\n'), [bgSources]);
  const bgPlaylist = useMemo(() => (playlistKey ? playlistKey.split('\n') : []), [playlistKey]);

  const verseStarts = useMemo(() => sortedVerses.map(v => v.startTime), [sortedVerses]);

  /**
   * Which background is on screen, and when its turn began.
   *
   * Shared with the timeline lane through `backgroundTimeline`, so the strip
   * under the preview is drawn from the same answer the canvas paints.
   */
  const activeBg = useMemo(
    () => backgroundAt(bgConfig, verseStarts, currentTime),
    [bgConfig, verseStarts, currentTime]
  );
  const bgVideoSrc = activeBg?.url ?? '';

  /**
   * One element per background, all loaded at once -- a <video> for footage, an
   * <img> for a still.
   *
   * Swapping `src` on a single element would stall while the next clip buffers,
   * and export records the canvas in real time -- so that stall bakes into the
   * output as black frames rather than merely looking rough in the preview.
   * Keeping every background warm makes switching a choice of which element to
   * draw.
   */
  useEffect(() => {
    videoErrorRef.current = false;
    const pool = mediaPoolRef.current;

    for (const url of bgPlaylist) {
      let media = pool.get(url);
      if (!media) {
        if (mediaKind(url) === 'image') {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.decoding = 'async';
          img.src = url;
          media = img;
        } else {
          const vid = document.createElement('video');
          vid.crossOrigin = 'anonymous';
          vid.muted = true;
          vid.playsInline = true;
          vid.preload = 'auto';
          vid.src = url;
          vid.addEventListener('error', () => { videoErrorRef.current = true; }, { once: true });
          vid.load();
          media = vid;
        }
        pool.set(url, media);
      }
      if (!isClip(media)) continue;
      // Decorative footage loops forever on its own. A synced recitation must
      // not: it is driven by the sync effect below, and looping would send it
      // back to 0 mid-verse.
      media.loop = !syncBackgroundVideo;
      if (!syncBackgroundVideo) playDecorative(media, url);
    }

    for (const [url, media] of Array.from(pool.entries())) {
      if (bgPlaylist.includes(url)) continue;
      // A still needs no unwinding, and blanking its `src` would only fire a
      // spurious error on the way out.
      if (isClip(media)) {
        media.pause();
        media.removeAttribute('src');
        media.load();
      }
      pool.delete(url);
    }
  }, [bgPlaylist, syncBackgroundVideo]);

  // Point the draw loop at whichever pooled clip is current.
  useEffect(() => {
    bgMediaRef.current = bgVideoSrc ? mediaPoolRef.current.get(bgVideoSrc) ?? null : null;
  }, [bgVideoSrc]);

  /**
   * Starts a decorative clip at its own beginning when its turn comes round.
   *
   * The pool plays and loops from the moment a background is chosen, so without
   * this a clip is simply wherever its loop happened to have reached -- which is
   * why exports opened mid-clip, ran to the end and jumped back to the start a
   * second later. Only a *new* occurrence restarts: a sequence that repeats the
   * same clip back to back keeps playing rather than stuttering at the seam.
   */
  const bgSegmentRef = useRef<{ key: string; url: string } | null>(null);
  // Verse-card layouts, keyed by the text and sizing that produced them. The
  // shrink-to-fit search wraps the text once per trial size, which is far too
  // much to redo every frame for text that only changes per segment.
  const textLayoutCache = useRef<Map<string, CardTextLayout>>(new Map());

  // Fetch the faces the canvas is about to name.
  //
  // Naming a webfont in `ctx.font` does not load it the way rendering DOM text
  // does: an absent family silently resolves to the system fallback, and the
  // studio has been drawing every verse in whatever Naskh the OS ships rather
  // than the font the user picked -- Scheherazade New, the default, appears
  // nowhere in the DOM, so it was never fetched at all. The fallback places
  // the harakat by its own anchors, which is what left marks sitting away from
  // the letters they belong to.
  //
  // The layouts already in the cache were measured against those wrong
  // metrics, so they go when the real faces land.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    let cancelled = false;
    const wanted: [string, string][] = [
      [`bold 60px '${arabicFontFamily(arabicFontId)}'`, ARABIC_SAMPLE],
      [`600 60px '${arabicFontFamily(arabicFontId)}'`, ARABIC_SAMPLE],
      [`60px '${arabicFontFamily(arabicFontId)}'`, ARABIC_SAMPLE],
      // The badge, the ayah numeral and right-to-left translations are not
      // Quran text, so they draw in the studio's own face whatever the verse font is.
      [`bold 60px '${LABEL_FAMILY}'`, ARABIC_SAMPLE],
      [`600 60px '${LABEL_FAMILY}'`, '0123456789'],
      [`60px '${config.fontTranslation}'`, 'Ag'],
      // Named only when drawn: a face nothing asks for is never fetched.
      ...(badgeStyle === 'calligraphic' ? [SURAH_NAME_FONT_SPEC] : []),
    ];
    Promise.all(
      wanted.map(([spec, sample]) => document.fonts.load(spec, sample).catch(() => []))
    ).then(() => {
      if (cancelled) return;
      textLayoutCache.current.clear();
    });
    return () => { cancelled = true; };
  }, [arabicFontId, config.fontTranslation, badgeStyle]);

  /**
   * Register and fetch the mushaf page fonts this project needs.
   *
   * There are 604 of them, one per printed page, so they cannot sit in CSS:
   * each is added to `document.fonts` by hand the first time a word on that
   * page appears. Every page in the project is fetched rather than only the
   * one on screen, because the offline encoder walks the whole timeline
   * without pausing for a font -- a page that arrived late would export as
   * blank glyphs, and `ctx.font` reports no error when it falls back.
   *
   * A missing file is not an error either: a clone that has not run
   * `scripts/qul-import.mjs` has no fonts at all, and `mushafCaption` keeps
   * returning glyph text regardless, so the guard is that the font simply
   * never becomes available and the caption draws in the fallback face.
   */
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') return;
    // Nothing to fetch on a server without them: 604 requests that all 404.
    if (missingFonts.has(QPC_V2)) return;
    const pages = pagesUsedBy(sortedVerses.flatMap(verse => verse.words || []));
    if (!pages.length) return;
    let cancelled = false;
    ensureQpcPages(pages).then(() => {
      // Layouts measured before the page font landed were measured against
      // the fallback's metrics, which are not these.
      if (!cancelled) textLayoutCache.current.clear();
    });
    return () => { cancelled = true; };
  }, [sortedVerses, missingFonts]);

  useEffect(() => {
    if (syncBackgroundVideo) return;
    if (!activeBg) {
      // A gap in a hand-cut lane. Forgetting the segment we came from means the
      // clip restarts on the far side rather than resuming wherever it drifted
      // to while nothing was watching it.
      bgSegmentRef.current = null;
      return;
    }
    const previous = bgSegmentRef.current;
    if (previous?.key === activeBg.key) return;
    bgSegmentRef.current = { key: activeBg.key, url: activeBg.url };
    if (previous?.url === activeBg.url) return;

    const vid = mediaPoolRef.current.get(activeBg.url);
    // A still has no playhead to rewind; its turn beginning is simply the draw
    // loop pointing at it.
    if (!vid || !isClip(vid)) return;
    // Only seek if it is not already there. A seek briefly drops `readyState`
    // below the level the draw loop requires, which during a real-time export
    // bakes a gradient frame into the file -- and a clip parked at 0 by the
    // export setup below is already exactly where it needs to be.
    const opening = loopFor(knownLoopWindow(activeBg.url), vid.duration).start;
    if (Math.abs(vid.currentTime - opening) > 0.05) {
      try {
        vid.currentTime = opening;
      } catch {
        // Seeking before metadata lands throws; the clip plays from 0 anyway.
      }
    }
    vid.play().catch(() => {});
  }, [activeBg, syncBackgroundVideo]);

  /**
   * Keeps a decorative background at the phase the export will encode.
   *
   * The preview and the export agreed on *which* clip is on screen -- both read
   * `backgroundAt` -- and disagreed about where inside it. The pooled element
   * ran on its own clock, so the frame shown was wherever its loop happened to
   * have reached, while the export computes `(time - block start) % clip
   * length` and decodes exactly that. During playback the two stayed roughly
   * together by accident, since both advance in real time. Scrubbing broke it
   * completely: nothing seeked the background at all, so dragging the playhead
   * moved the ayahs and left the picture where it was -- which is precisely
   * when someone is looking for the cuts, and why a clip that repeats gave no
   * sign of repeating until the file was watched.
   *
   * So the phase is computed rather than drifted into, and the clip holds still
   * when playback does. Nudged past a quarter second rather than assigned every
   * tick, for the same reason the synced case below is: `currentTime` arrives
   * from `timeupdate` about four times a second, and seeking on each one
   * stutters what should be smooth playback.
   *
   * Never during an export. A seek briefly drops `readyState` under what the
   * draw loop requires, which on the real-time path bakes a gradient frame into
   * the file -- and that path parks and plays these clips itself.
   */
  useEffect(() => {
    if (syncBackgroundVideo || isExportingRef.current || !activeBg) return;
    const vid = mediaPoolRef.current.get(activeBg.url);
    if (!vid || !isClip(vid)) return;

    const length = vid.duration;
    if (Number.isFinite(length) && length > 0) {
      // A block longer than its footage simply plays it again, inside the part
      // with a picture: the same arithmetic the export uses.
      const target = loopPhase(loopFor(knownLoopWindow(activeBg.url), length), currentTime - activeBg.start);
      if (Math.abs(vid.currentTime - target) > 0.25) {
        try {
          vid.currentTime = target;
        } catch {
          // Seeking before metadata lands throws; the next tick retries.
        }
      }
    }

    if (isPlaying && vid.paused) vid.play().catch(() => {});
    else if (!isPlaying && !vid.paused) vid.pause();
  }, [activeBg, currentTime, isPlaying, syncBackgroundVideo]);

  /**
   * Keeps a synced background video in step with playback.
   *
   * Correction is threshold-based rather than a seek on every tick: `currentTime`
   * updates from the audio element's `timeupdate`, which fires only ~4x a second,
   * so assigning it every time would stutter the video. Letting it run at its own
   * rate and nudging it only when it drifts past a quarter-second keeps playback
   * smooth while staying visually in sync.
   */
  useEffect(() => {
    const vid = bgMediaRef.current;
    if (!vid || !isClip(vid) || !bgVideoSrc || !syncBackgroundVideo || videoErrorRef.current) return;

    const target = currentTime + backgroundTimeOffset;
    if (Number.isFinite(target) && Math.abs(vid.currentTime - target) > 0.25) {
      try {
        vid.currentTime = Math.max(0, target);
      } catch {
        // Seeking before metadata lands throws; the next tick retries.
      }
    }

    if (isPlaying && vid.paused) vid.play().catch(() => {});
    else if (!isPlaying && !vid.paused) vid.pause();
  }, [bgVideoSrc, syncBackgroundVideo, currentTime, isPlaying, backgroundTimeOffset]);

  // Cleanup on unmount -- the whole pool, not just the visible clip, or every
  // background ever selected keeps its buffer alive for the page's lifetime.
  useEffect(() => {
    const pool = mediaPoolRef.current;
    return () => {
      for (const media of pool.values()) {
        if (!isClip(media)) continue;
        media.pause();
        media.removeAttribute('src');
        media.load();
      }
      pool.clear();
      bgMediaRef.current = null;
    };
  }, []);

  const getDisplayArabic = useCallback((verse: VerseData) => {
    if ('words' in verse && verse.words?.length && verse.words.some(word => word.excluded)) {
      const visibleWords = verse.words.filter(word => !word.excluded).map(word => word.arabic).filter(Boolean);
      if (visibleWords.length > 0) return visibleWords.join(' ');
    }
    if ('displayTextUthmani' in verse && verse.displayTextUthmani?.trim()) {
      return verse.displayTextUthmani.trim();
    }
    if ('words' in verse && verse.words?.length) {
      const visibleWords = verse.words.filter(word => !word.excluded).map(word => word.arabic).filter(Boolean);
      if (visibleWords.length > 0) return visibleWords.join(' ');
    }
    return verse.textUthmani || '';
  }, []);

  const wrapCanvasText = useCallback((
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    maxLines = 2
  ) => {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(testLine).width > maxWidth && line) {
        lines.push(line);
        line = word;
        if (lines.length === maxLines) break;
      } else {
        line = testLine;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length === maxLines) {
      const usedWords = lines.join(' ').split(/\s+/).length;
      if (usedWords < words.length) {
        lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+$/, '')}…`;
      }
    }
    return lines;
  }, []);

  /**
   * Draws one complete frame.
   *
   * Split out of the animation loop so a frame can be produced for *any*
   * moment rather than only for "now". The live preview calls it once per
   * animation frame with whatever the player and the analyser currently hold;
   * the offline encoder calls it thousands of times with values it computes
   * itself. Everything time-dependent arrives as an argument for that reason --
   * reaching for the playhead or the analyser in here would silently tie the
   * drawing back to the present moment and make offline rendering impossible.
   */
  const paintFrame = useCallback((
    ctx: CanvasRenderingContext2D,
    frame: {
      /** The frame's moment on the recording, for the words recited by then. */
      time: number;
      /** The captions to show, bottom up, already resolved for that moment by `captionLayers`. */
      captions: CaptionLayer<VerseData>[];
      /** Frequency magnitudes for the bars, or null to leave them out. */
      spectrum: Uint8Array | null;
      /** Background to paint under it, already positioned for this frame. */
      media: BackgroundMedia | null;
    }
  ) => {
    const { captions, media } = frame;
    // The badge follows whichever ayah the frame is showing more of.
    const leading = leadingLayer(captions)?.verse ?? null;
      const { width, height } = dimensions;

      // The offline encoder hands in a detached canvas of its own, so sizing
      // belongs here rather than to whoever owns the element.
      if (ctx.canvas.width !== width || ctx.canvas.height !== height) {
        ctx.canvas.width = width;
        ctx.canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      // The frame is the user's content, so nothing on it may follow the
      // language the studio happens to be in. `ctx.direction` defaults to
      // 'inherit', which resolves against the document -- so with the interface
      // in Arabic this drew the watermark as "QuranClipper@" and put the
      // transliteration before the surah name in the badge, neither of which is
      // a choice anyone made.
      //
      // Worse, the three surfaces this paints onto did not even agree with each
      // other. Measured under `<html dir="rtl">`: the preview's canvas and the
      // encoder's OffscreenCanvas both inherit 'rtl', while the detached
      // element the encoder falls back to when OffscreenCanvas is missing does
      // not -- so on that path the exported file disagreed with the preview it
      // was rendered from.
      //
      // Everything below therefore starts left to right, on every surface. The
      // ayah and any right-to-left translation set their own direction, and the
      // save/restore they sit inside returns to this.
      ctx.direction = 'ltr';

      // 1. Background (clip, still, or gradient fallback).
      //
      // Readiness alone decides. It used to also require `!videoErrorRef`, a
      // single flag shared by every background in the pool -- so one clip that
      // failed to load blanked the ones that had not.
      if (mediaReady(media)) {
        const source = media as BackgroundMedia;
        const { w, h } = mediaSize(source);
        const vRatio = w / h;
        const cRatio = width / height;
        let dw = width, dh = height, dx = 0, dy = 0;
        if (vRatio > cRatio) { dw = height * vRatio; dx = (width - dw) / 2; }
        else { dh = width / vRatio; dy = (height - dh) / 2; }
        // A blurred background goes through WebGL where that is the faster
        // way in this browser -- `blurPath` measures once and remembers, for
        // the preview and the encoder alike -- and through the 2D filter
        // otherwise. `gpuAccelerated` is the project's switch for it.
        const sigma = config.bgBlur * 2.5;
        const blurred = sigma > 0 && config.gpuAccelerated !== false
          ? blurPath()?.blurCover(source, width, height, [dx / width, dy / height, dw / width, dh / height], sigma)
          : null;
        ctx.save();
        if (blurred) {
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(blurred, 0, 0, width, height);
        } else {
          if (sigma > 0) ctx.filter = `blur(${sigma}px)`;
          ctx.drawImage(source, dx, dy, dw, dh);
        }
        ctx.restore();
      } else {
        // Gradient fallback
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, '#0f172a');
        grad.addColorStop(0.5, '#020617');
        grad.addColorStop(1, '#1e1b4b');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      }

      // 2. Dark overlay
      if (config.bgOverlayOpacity > 0) {
        ctx.fillStyle = `rgba(2, 6, 23, ${config.bgOverlayOpacity / 100})`;
        ctx.fillRect(0, 0, width, height);
      }

      const goldAccent = config.accentColor || '#b8c7dc';
      const arrangement = frameLayout(config.layout, width, height);

      // 3. Audio waveform
      //
      // From the argument, never from the analyser: an AnalyserNode only ever
      // reports what is audible *now*, so reading it here would have made the
      // bars the one part of the frame that could not be drawn for a past or
      // future moment -- and offline they would have frozen at whatever the
      // last live reading happened to be.
      const dataArray = frame.spectrum;
      if (config.showWaveform && dataArray && dataArray.length > 0) {
        ctx.save();
        const bufferLength = dataArray.length;
        const barCount = 48;
        const barWidth = (width * 0.7) / barCount;
        const startX = (width - barCount * barWidth) / 2;
        const waveY = arrangement.waveY;
        for (let i = 0; i < barCount; i++) {
          const index = Math.floor((i / barCount) * (bufferLength / 2));
          const value = dataArray[index] || 0;
          const barHeight = (value / 255) * 70;
          const x = startX + i * barWidth;
          const y = waveY - barHeight / 2;
          ctx.fillStyle = goldAccent;
          ctx.globalAlpha = 0.75;
          ctx.fillRect(x, y + barHeight / 2, barWidth - 3, -barHeight / 2);
          ctx.fillStyle = goldAccent;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(x, y + barHeight / 2, barWidth - 3, barHeight / 4);
        }
        ctx.restore();
      }

      // 4. Surah badge
      //
      // Ordinary text -- a name, a bullet, a range -- so it draws in the label
      // face, not a Quran one: the mushaf faces carry no Latin. The calligraphic
      // style is the exception, and brings QUL's surah-name face of its own.
      if (config.showSurahBadge) {
        paintSurahBadge(ctx, {
          // Until its face has landed the heading would draw as the literal
          // `surah001`, so the preview shows the pill for that moment. A render
          // waits for the face before it starts, so this never reaches a file.
          style: badgeStyle === 'calligraphic' && typeof document !== 'undefined'
            && !document.fonts.check(...SURAH_NAME_FONT_SPEC) ? 'pill' : badgeStyle,
          width,
          height,
          y: arrangement.badgeY,
          accent: goldAccent,
          surah: badgeSurah(leading?.verseKey, { number: surahNumber, nameArabic: surahNameArabic, nameEnglish: surahNameEnglish }),
          range: badgeRange(verses.find(verse => !isOpening(verse))?.verseKey, verses[verses.length - 1]?.verseKey, { surah: surahNumber, start: ayahStart, end: ayahEnd }),
          customTitle: config.surahBadgeText?.trim() || '',
          subtitle: config.surahBadgeSubtitleText?.trim() || '',
          watermarkPosition: config.watermarkPosition,
          labelFamily: LABEL_FAMILY,
          plateOpacity: (config.badgeOpacity ?? DEFAULT_BADGE_OPACITY) / 100,
        });
      }

      // 5. Verse card
      ctx.save();
      const { x: cardX, width: cardWidth, height: cardHeight } = arrangement.text;
      const translationBox = arrangement.translation;

      for (const box of arrangement.drawsCard && config.cardBgOpacity > 0
        ? [arrangement.text, translationBox].filter(b => b !== null) : []) {
        ctx.fillStyle = `rgba(15, 23, 42, ${config.cardBgOpacity / 100})`;
        drawRoundRect(ctx, box.x, box.y, box.width, box.height, 28);
        ctx.fill();
        if (config.cardBorder) {
          // Follows the accent colour like the badge, the ayah numeral and the
          // divider do. It used to be hardcoded amber, so setting the accent to
          // anything else left one stray gold rectangle behind with no control
          // anywhere that explained it.
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.strokeStyle = goldAccent;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
      }

      ctx.textAlign = (config.textAlignment as CanvasTextAlign) || 'center';
      const textX = config.textAlignment === 'right' ? cardX + cardWidth - 40
        : config.textAlignment === 'left' ? cardX + 40 : width / 2;

      for (const layer of captions) {
        const activeVerse = layer.verse;
        const displayArabic = getDisplayArabic(activeVerse);
        if (!displayArabic || (layer.opacity <= 0 && layer.translationOpacity <= 0)) continue;
        // The mushaf draws each word as one glyph from its page's own font, so
        // the text and the family change together or not at all. Glyphs are
        // space-separated characters, which is why everything below -- wrapping,
        // measuring, the shrink-to-fit search -- needs no other change.
        const mushaf = mushafCaption(activeVerse.words, arabicFontId);
        // Rows as the page prints them, when asked for and the words carry their
        // lines. They take precedence over `mushaf`, and unlike it they can span
        // a page break: each row is on one page and brings that page's family.
        const pageRows = config.mushafLines ? mushafRows(activeVerse.words, arabicFontId) : null;
        const arabicText = pageRows ? pageRows.map(row => row.text).join('\n') : mushaf ? mushaf.text : displayArabic;
        const arabicFamily = mushaf ? mushaf.family : arabicFontFamily(arabicFontId);
        ctx.save();
        // Moved and sized about the middle of the text's own box, so a zoom
        // grows from where the text sits rather than from the frame's corner.
        const centreY = arrangement.text.y + arrangement.text.height / 2;
        ctx.translate(width / 2, centreY + layer.dy * height);
        ctx.scale(layer.scale, layer.scale);
        ctx.translate(-width / 2, -centreY);
        ctx.globalAlpha = layer.opacity;
        // One block per chosen translation, in the order they were chosen. A
        // language whose text has not arrived yet is absent rather than blank,
        // so the card never reserves space for nothing.
        const translationBlocks = captionTranslations(
          activeVerse,
          config.translationIds || [DEFAULT_TRANSLATION_ID],
          config.translationFollowsWords
        );
        const withTranslation = Boolean(config.showTranslation && translationBlocks.length);
        const maxTextWidth = cardWidth - 80;
        const ayahFontSize = (config.ayahNumberFontSize || 34) * (height / 1920);
        // Ayah numeral, the gap around the divider, and the room under it. The
        // split layout has neither under the Arabic: its numeral sits in the gap
        // between the two cards, where it joins them rather than leaving the
        // Arabic card with a numeral and an empty stretch beneath it.
        const belowArabic = translationBox ? 0 : ayahFontSize + 48;
        const cardPadding = 40;

        /**
         * No weight is named, and that is deliberate.
         *
         * Every mushaf face here ships one weight -- `usWeightClass` 400,
         * Regular, no bold sibling -- so asking for `bold` does not select a
         * face, it makes the browser *synthesise* one by drawing the glyph
         * again at an offset. On dense Quranic text that smears the harakat
         * into the letters, and because the Arabic is drawn with a shadow
         * (`rgba(0,0,0,0.9)`, blur 12, below) the shadow is smeared with it,
         * which is the black wash that appeared over the text. The Google
         * faces this replaced did ship a 700, so the bold was real and this
         * never showed.
         */
        const arabicFontIn = (family: string, size: number) =>
          `${size}px '${family}', '${FALLBACK_ARABIC_FAMILY}', 'Amiri', serif`;
        const arabicFont = (size: number) => arabicFontIn(arabicFamily, size);
        const translationFont = (size: number) =>
          `${size}px '${config.fontTranslation}', sans-serif`;
        /**
         * Urdu, Persian and the rest are in the Arabic script, and the
         * translation face is a Latin one -- naming it for them draws tofu or
         * unjoined letters. A translation is not Quran text, so they take the
         * label face rather than a mushaf one, with Noto Naskh behind it for
         * the letters Amiri lacks, on a looser line so the harakat have room.
         */
        const rtlTranslationFont = (size: number) =>
          `${size}px '${LABEL_FAMILY}', 'Noto Naskh Arabic', serif`;
        const blockLineHeight = (size: number, rtl: boolean) => size * (rtl ? 1.85 : 1.55);
        /** The breathing space between two translations, so they read as two. */
        const blockGap = (size: number) => size * 0.7;

        const wrapAll = (text: string, limit: number) =>
          wrapCaption(text, limit, line => ctx.measureText(line).width);

        const layoutAt = (arabic: number, translation: number) => {
          ctx.font = arabicFont(arabic);
          // Following the mushaf, the rows are given; otherwise they are wrapped
          // to the card. Either way the shrink-to-fit below is what makes the
          // widest row fit, so a long printed line gets smaller type, never a cut.
          const arabicLines: MushafRow[] = pageRows
            ?? wrapAll(arabicText, maxTextWidth).map(text => ({ text, family: arabicFamily }));
          const arabicLineHeight = arabicRowPitch(ctx, arabicLines, arabic, arabicFontIn);
          let arabicWidest = 0;
          for (const line of arabicLines) {
            ctx.font = arabicFontIn(line.family, arabic);
            arabicWidest = Math.max(arabicWidest, ctx.measureText(line.text).width);
          }
          let translationWidest = 0;
          const blocks: { lines: string[]; rtl: boolean; lineHeight: number }[] = [];
          let translationHeight = 0;
          if (withTranslation) {
            translationBlocks.forEach((block, index) => {
              ctx.font = block.rtl ? rtlTranslationFont(translation) : translationFont(translation);
              const lines = wrapAll(block.text, maxTextWidth);
              const lineHeight = blockLineHeight(translation, block.rtl);
              for (const line of lines) translationWidest = Math.max(translationWidest, ctx.measureText(line).width);
              blocks.push({ lines, rtl: block.rtl, lineHeight });
              translationHeight += lines.length * lineHeight + (index > 0 ? blockGap(translation) : 0);
            });
          }
          return {
            arabicLines, arabicLineHeight, blocks, widest: Math.max(arabicWidest, translationWidest),
            arabicWidest, translationWidest,
            arabicSize: arabic, translationSize: translation,
            stackHeight: arabicLines.length * arabicLineHeight + translationHeight,
          };
        };

        // Shrink this segment's type until the whole stack fits. The previous
        // behaviour capped the Arabic at five lines and the translation at
        // whatever the card had room for, each with an ellipsis -- which drops
        // recited words off the frame, the one thing a Quran caption must never
        // do. A long segment gets smaller type; it does not get cut.
        //
        // Cached because the search runs a wrap per trial size and the frame
        // loop is 144fps; the layout only changes when the text, the card or
        // the configured sizes do. Font loading is in the key, so metrics
        // measured against a fallback are recomputed once the real face lands.
        const layoutKey = [
          arabicText,
          translationBlocks.map(block => `${block.id}:${block.text}`).join('\u0001'),
          withTranslation, cardWidth, cardHeight, arrangement.id,
          arabicFontId, config.mushafLines, config.fontTranslation, config.arabicFontSize,
          config.translationFontSize, config.ayahNumberFontSize,
          typeof document !== 'undefined' ? document.fonts.status : '',
        ].join('|');

        let layout = textLayoutCache.current.get(layoutKey);
        if (!layout) {
          let arabicSize = config.arabicFontSize * (height / 1920) * 1.5;
          let translationSize = config.translationFontSize * (height / 1920) * 1.3;
          layout = layoutAt(arabicSize, translationSize);
          const fits = (trial: CardTextLayout) => {
            const arabic = trial.arabicLines.length * trial.arabicLineHeight;
            return trial.widest <= maxTextWidth && textFits(
              arrangement, { arabic, belowArabic, translation: trial.stackHeight - arabic }, cardPadding
            );
          };
          const halves = (trial: CardTextLayout) => {
            const arabic = trial.arabicLines.length * trial.arabicLineHeight;
            const fit = splitFits(arrangement, { arabic, belowArabic, translation: trial.stackHeight - arabic }, cardPadding);
            return {
              arabic: fit.arabic && trial.arabicWidest <= maxTextWidth,
              translation: fit.translation && trial.translationWidest <= maxTextWidth,
            };
          };
          if (translationBox) {
            // Two boxes, each sized on its own: the Arabic shrinks only for
            // its card and the translation only for its own.
            while (!halves(layout).arabic && arabicSize > MIN_ARABIC_PX) {
              arabicSize -= 1;
              layout = layoutAt(arabicSize, translationSize);
            }
            while (!halves(layout).translation && translationSize > MIN_TRANSLATION_PX) {
              translationSize = Math.max(MIN_TRANSLATION_PX, translationSize - 0.6);
              layout = layoutAt(arabicSize, translationSize);
            }
          }
          while (!translationBox && !fits(layout) && arabicSize > MIN_ARABIC_PX) {
            arabicSize -= 1;
            translationSize = Math.max(MIN_TRANSLATION_PX, translationSize - 0.6);
            layout = layoutAt(arabicSize, translationSize);
          }
          if (textLayoutCache.current.size > 64) textLayoutCache.current.clear();
          textLayoutCache.current.set(layoutKey, layout);
        }

        // Baselines are 'top' throughout, so the block occupies exactly the
        // height the fitting loop measured. Drawing the first line on an
        // alphabetic baseline at the top of the block put its ascenders --
        // which in Arabic carry the harakat -- above the space budgeted for it.
        const arabicHeight = layout.arabicLines.length * layout.arabicLineHeight;
        let y = translationBox
          ? blockTop(arrangement.text, arabicHeight + belowArabic, cardPadding)
          : blockTop(arrangement.text, layout.stackHeight + belowArabic, cardPadding);

        ctx.textBaseline = 'top';
        ctx.direction = 'rtl';
        ctx.font = arabicFont(layout.arabicSize);
        ctx.fillStyle = config.textColor || '#ffffff';
        if (config.textShadow) {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
          ctx.shadowBlur = 12;
          ctx.shadowOffsetY = 4;
        }
        // Each drawn word's recited time, when a word effect is on and the
        // drawing lines up with the word list; otherwise the lines are drawn
        // whole, as with no effect.
        const wordTimes = motion.words === 'none'
          ? null : drawnWordTimes(activeVerse.words, layout.arabicLines.map(line => line.text));
        const allTimes = wordTimes?.flat() ?? [];
        // The highlight is the reveal with the words to come left faint
        // rather than gone, and the one being recited in the accent.
        const shown = wordTimes ? revealedWords(allTimes, activeVerse.startTime, frame.time) : null;
        const rest = motion.words === 'highlight' ? HIGHLIGHT_REST : 0;
        const recited = motion.words === 'highlight' ? recitedWord(allTimes, activeVerse.endTime, frame.time) : -1;
        const highlight = config.highlightColor || goldAccent;
        let firstWord = 0;
        layout.arabicLines.forEach((line, index) => {
          ctx.font = arabicFontIn(line.family, layout.arabicSize);
          const text = line.text.trim();
          const count = wordTimes?.[index].length ?? 0;
          if (shown) {
            const from = firstWord;
            fillLineByWord(ctx, text, { x: textX, y, size: layout.arabicSize }, word => ({
              amount: rest + (1 - rest) * shown[from + word],
              colour: from + word === recited ? highlight : undefined,
            }));
          } else {
            fillArabicLine(ctx, text, textX, y, layout.arabicSize);
          }
          firstWord += count;
          y += layout.arabicLineHeight;
        });
        ctx.direction = 'ltr';
        ctx.shadowColor = 'transparent';
        ctx.shadowOffsetY = 0;

        // The numeral is a label too. The mushaf faces have no Latin digits, so
        // it was drawn in whatever serif the browser falls back to.
        // U+FD3E opens and U+FD3F closes when read right-to-left, despite their
        // Unicode names ("ornate left/right parenthesis") suggesting the reverse.
        // An isti'adha or basmala before the passage is verse 0: no numeral.
        const numeral = activeVerse.verseNumber > 0 ? `﴾ ${activeVerse.verseNumber} ﴿` : '';
        ctx.fillStyle = goldAccent;
        if (translationBox) {
          // Centred in the gap between the cards, and no larger than it.
          const top = arrangement.text.y + arrangement.text.height;
          const gap = translationBox.y - top;
          ctx.font = `600 ${Math.min(ayahFontSize * 0.75, gap * 0.7)}px '${LABEL_FAMILY}', serif`;
          ctx.textBaseline = 'middle';
          if (config.textShadow) { ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8; }
          ctx.fillText(numeral, width / 2, top + gap / 2);
          ctx.shadowColor = 'transparent';
          ctx.textBaseline = 'top';
        } else {
          ctx.font = `600 ${ayahFontSize}px '${LABEL_FAMILY}', serif`;
          ctx.fillText(numeral, width / 2, y);
          y += ayahFontSize + 24;

          ctx.strokeStyle = goldAccent;
          ctx.globalAlpha = layer.opacity * 0.4;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(width / 2 - 120, y);
          ctx.lineTo(width / 2 + 120, y);
          ctx.stroke();
          ctx.globalAlpha = layer.opacity;
          y += 24;
        }

        if (withTranslation) {
          if (translationBox) y = blockTop(translationBox, layout.stackHeight - arabicHeight, cardPadding);
          ctx.fillStyle = config.translationColor || '#e2e8f0';
          ctx.globalAlpha = layer.translationOpacity;
          if (config.textShadow) { ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8; }
          layout.blocks.forEach((block, index) => {
            if (index > 0) {
              // A short rule between two translations, in the gap already
              // there rather than a line of its own.
              const gap = blockGap(layout.translationSize);
              const mid = y + (gap - (layout.blocks[index - 1].lineHeight - layout.translationSize)) / 2;
              const half = 45 * (height / 1920);
              const centre = config.textAlignment === 'right' ? textX - half
                : config.textAlignment === 'left' ? textX + half : textX;
              ctx.save();
              ctx.shadowColor = 'transparent';
              ctx.strokeStyle = config.translationColor || '#e2e8f0';
              ctx.globalAlpha *= 0.45;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(centre - half, mid);
              ctx.lineTo(centre + half, mid);
              ctx.stroke();
              ctx.restore();
              y += gap;
            }
            ctx.font = block.rtl ? rtlTranslationFont(layout.translationSize) : translationFont(layout.translationSize);
            // Set per block, not once: two translations in one card can run in
            // opposite directions, and the second would otherwise inherit
            // whatever the first left behind.
            ctx.direction = block.rtl ? 'rtl' : 'ltr';
            for (const line of block.lines) {
              ctx.fillText(line.trim(), textX, y);
              y += block.lineHeight;
            }
          });
          ctx.direction = 'ltr';
        }
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
      }
      ctx.restore();

      // 6. Watermark
      if (config.watermarkText) {
        ctx.save();
        ctx.font = `600 20px 'Inter', sans-serif`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 6;
        let wx = width - 40, wy = height - 40;
        ctx.textAlign = 'right';
        if (config.watermarkPosition === 'bottom-left') { wx = 40; ctx.textAlign = 'left'; }
        else if (config.watermarkPosition === 'top-right') { wy = 50; }
        else if (config.watermarkPosition === 'top-left') { wx = 40; wy = 50; ctx.textAlign = 'left'; }
        ctx.fillText(config.watermarkText, wx, wy);
        ctx.restore();
      }

  }, [config, verses, surahNameArabic, surahNameEnglish, dimensions,
      getDisplayArabic, surahNumber, ayahStart, ayahEnd, arabicFontId, badgeStyle, motion]);

  // ---- LIVE PREVIEW LOOP ----
  useEffect(() => {
    let animationFrameId: number;
    let frameCount = 0;
    let lastFpsCalc = performance.now();
    const spectrum = new Uint8Array(audioAnalyser ? audioAnalyser.frequencyBinCount : 0);

    const drawFrame = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const renderStart = performance.now();
      if (audioAnalyser) audioAnalyser.getByteFrequencyData(spectrum);
      // While playing, the element's own position, read now; paused, the
      // position the studio holds, which is where a scrub left it.
      const time = isPlaying && playhead ? playhead() : currentTime;
      if (!syncBackgroundVideo) keepInsideLoop(bgMediaRef.current);
      paintFrame(ctx, {
        time,
        captions: captionLayers(sortedVerses, time, motion, 'show'),
        spectrum: audioAnalyser ? spectrum : null,
        media: bgMediaRef.current,
      });

      frameCount++;
      paintedFramesRef.current++;
      const now = performance.now();
      if (now - lastFpsCalc >= 1000) {
        setFpsDisplay(Math.round((frameCount * 1000) / (now - lastFpsCalc)));
        frameCount = 0;
        lastFpsCalc = now;
      }
      setRenderMs(Math.round((performance.now() - renderStart) * 10) / 10);
      animationFrameId = requestAnimationFrame(drawFrame);
    };

    animationFrameId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(animationFrameId);
    // Everything the drawing itself depends on now lives inside `paintFrame`,
    // so this loop only needs the things it feeds in.
  }, [paintFrame, audioAnalyser, sortedVerses, currentTime, isPlaying, playhead, motion, syncBackgroundVideo]);

  // ---- EXPORT ----
  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,

    canExportOffline: () => canEncodeOffline(config),

    captureSize: () => dimensions,

    backgroundsReady: () =>
      Array.from(mediaPoolRef.current.values()).every(media => isClip(media) || mediaReady(media)),

    exportVideoOffline: async (range, audio, targetFps, onProgress, output) => {
      if (!canEncodeOffline(config)) return null;
      if (badgeStyle === 'calligraphic') await document.fonts.load(...SURAH_NAME_FONT_SPEC).catch(() => []);
      isExportingRef.current = true;
      cancelledRef.current = false;

      /**
       * Background clips, decoded in order rather than played -- and only a
       * couple of them open at a time.
       *
       * These used to be opened lazily and then kept for the whole render, on
       * the grounds that a playlist revisits a clip and demuxing it again is
       * the expensive part. It is, but it is not the expensive thing: an open
       * clip holds the whole video file, every encoded sample of it in a
       * second array, a live `VideoDecoder` and a queue of raw 1080x1920
       * frames at about 3 MB each. Seven backgrounds in one lane -- an
       * ordinary thing to want, and the reason the hand-cut lane exists -- was
       * therefore several hundred megabytes of that before the muxer had
       * written a single byte, and it killed the renderer outright on a
       * thirty-four second 1080p export. Reproduced at seven; the file being
       * produced had nothing to do with it.
       *
       * Output time only moves forward, so the render needs the clip it is on
       * and, across a boundary, the one it is leaving. Anything else is closed
       * and re-opened if the lane comes back to it, which costs a re-fetch
       * (from the browser's cache) and a re-demux once per block rather than
       * the tab.
       */
      const OPEN_CLIPS = 2;
      const clips = new Map<string, BackgroundClip | null>();
      const clipFor = async (url: string) => {
        if (clips.has(url)) {
          // Re-insert so insertion order is least-recently-used first.
          const open = clips.get(url) ?? null;
          clips.delete(url);
          clips.set(url, open);
          return open;
        }
        const clip = await openBackgroundClip(url);
        clips.set(url, clip);
        while (clips.size > OPEN_CLIPS) {
          const oldest = clips.keys().next().value as string;
          clips.get(oldest)?.close();
          clips.delete(oldest);
        }
        return clip;
      };

      /** The background as it looked at `atSeconds`, whatever kind it is. */
      const backgroundFor = async (atSeconds: number): Promise<BackgroundMedia | null> => {
        const active = backgroundAt(bgConfig, verseStarts, atSeconds);
        if (!active) return null;
        if (mediaKind(active.url) !== 'video') {
          // A still is the same at every moment, so the element already loaded
          // for the preview serves.
          return mediaPoolRef.current.get(active.url) ?? null;
        }
        const clip = await clipFor(active.url);
        // Null here means the browser could not play the file at all --
        // `videoFrames` already tried demuxing it and then seeking it. That is
        // not a background-less frame: painting on without it would hand back
        // an export with the gradient fallback where the clip should be, and
        // nothing would say so. The throw reaches `useVideoExport`, which
        // falls back to recording in real time.
        if (!clip) throw new Error(`background cannot be decoded frame by frame: ${active.url.slice(0, 80)}`);
        // Backgrounds loop, which is the whole reason this can be sequential:
        // the clip's own time sweeps 0 to its length over and over while
        // output time only moves forward.
        // Black at either end of the clip is left out of the loop, as in the
        // preview; a recitation video is the picture of the audio and plays whole.
        const into = Math.max(0, atSeconds - active.start);
        if (!(clip.duration > 0)) return clip.frameAt(into);
        const loop = loopFor(syncBackgroundVideo ? null : await loadLoopWindow(active.url), clip.duration);
        return clip.frameAt(loopPhase(loop, into));
      };

      try {
        // The same `paintFrame` the preview uses, which is the point of having
        // split it out: one drawing, two ways of driving it. Backgrounds come
        // from `videoFrames`, demuxed where that works and seeked where it
        // does not; one it cannot read at all aborts this path rather than
        // being left out of the picture.
        return await encodeOffline({
          width: output?.width ?? dimensions.width,
          height: output?.height ?? dimensions.height,
          fps: targetFps,
          range,
          audio,
          videoBitrate: output?.bitrate ?? OFFLINE_BITRATE,
          onProgress,
          signal: { get aborted() { return !isExportingRef.current; } },
          paint: async (ctx, frame) => {
            paintFrame(ctx, {
              time: frame.atSeconds,
              // Nothing before the first caption, as before: it arrives.
              captions: captionLayers(sortedVerses, frame.atSeconds, motion, 'hide'),
              spectrum: frame.spectrum,
              media: await backgroundFor(frame.atSeconds),
            });
          },
        });
      } finally {
        isExportingRef.current = false;
        clips.forEach(clip => clip?.close());
      }
    },
    stopExport: () => {
      cancelledRef.current = true;
      isExportingRef.current = false;
    },
    /**
     * Records the canvas and the audio between two points on the recording.
     *
     * It used to always start at 0 and run to the full length of whatever was
     * loaded. With a built-in reciter that is the entire chapter, so a
     * three-ayah clip from Al-Baqarah exported as eighty-seven minutes of
     * video, nearly all of it showing an ayah nobody selected. Capture is
     * real-time, so that was also eighty-seven minutes of waiting.
     */
    exportVideo: (
      audioElement: HTMLAudioElement,
      range: { start: number; end: number },
      onProgress: (p: number, s: string, f: number) => void,
      onComplete: (blob: Blob, ms: number, health: ExportHealth) => void,
      targetFps = 60
    ) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const startSec = Math.max(0, range.start);
      const endSec = Math.max(startSec + 0.1, range.end);
      const span = endSec - startSec;
      isExportingRef.current = true;
      cancelledRef.current = false;
      const exportStart = performance.now();
      const prevMuted = audioElement.muted;
      const prevVol = audioElement.volume;
      const canvasStream = canvas.captureStream(targetFps);

      // Per export, not per component: two exports must not pool their
      // stalls, and a stall in the first must not warn about the second.
      const healthRef = { current: emptyHealth() };
      /**
       * Painted-frame count at the moment recording actually began -- after
       * the seeks and the background parking, which take real time and paint
       * no frames anyone records. Counting from the export request instead
       * would blame that setup on the render's frame rate.
       */
      let paintedAtStart = 0;

      /**
       * Ask the system not to blank the screen while this runs.
       *
       * Real-time capture means a 10-minute recitation is 10 minutes of the
       * machine being left alone, which is exactly long enough for the display
       * to sleep -- and a slept display stops painting, which stops the
       * recording's picture without stopping its audio. The lock is dropped
       * whenever the tab is hidden (the API requires it), so it is re-taken on
       * the way back rather than requested once and assumed held.
       *
       * Best-effort throughout: unsupported browsers, insecure contexts and a
       * user gesture requirement all reject, and none of that is a reason to
       * refuse to export.
       */
      let wakeLock: WakeLockSentinel | null = null;
      const holdScreenAwake = async () => {
        try {
          wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
        } catch {
          wakeLock = null;
        }
      };

      /**
       * Filled in by `run` once the recorder and its audio element exist, so
       * the visibility handler can act on them. Registered before them because
       * the listener has to outlive every path out of `run`, including the
       * ones that fail before a recorder is built.
       */
      let recorder: MediaRecorder | null = null;
      let clipAudio: HTMLAudioElement | null = null;

      /**
       * Hold everything still while the tab is in the background, rather than
       * recording a frozen picture over live audio.
       *
       * This is what makes a backgrounded export survivable. The canvas stops
       * being painted the moment the tab is hidden -- that is deliberate
       * browser behaviour and no timer trick gets around it -- but the audio
       * would carry on, so the recording would come out complete, correct
       * length, and frozen over the gap. Pausing the recorder *and* both audio
       * elements stops the clocks together: the export simply waits, resumes
       * where it left off, and the file has no gap in it at all. It takes
       * longer in wall-clock time and loses nothing.
       *
       * `wasHidden` is still recorded, and the frame-starvation measurement
       * still runs, because pausing cannot cover every way a render stalls --
       * a sleeping display or a saturated GPU are not visibility changes.
       */
      const onVisibility = () => {
        if (!isExportingRef.current) return;
        if (document.hidden) {
          healthRef.current.wasHidden = true;
          if (recorder?.state === 'recording') {
            recorder.pause();
            healthRef.current.pauses += 1;
            audioElement.pause();
            clipAudio?.pause();
          }
          return;
        }
        if (!wakeLock) void holdScreenAwake();
        if (recorder?.state === 'paused') {
          recorder.resume();
          void audioElement.play().catch(() => {});
          void clipAudio?.play().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', onVisibility);
      const releaseScreen = () => {
        document.removeEventListener('visibilitychange', onVisibility);
        wakeLock?.release().catch(() => {});
        wakeLock = null;
      };

      const run = async () => {
        const expAudio = new Audio(audioElement.currentSrc || audioElement.src);
        expAudio.crossOrigin = 'anonymous';
        expAudio.preload = 'auto';
        expAudio.volume = 1;
        expAudio.muted = false;

        await new Promise<void>(resolve => {
          const onReady = () => { expAudio.removeEventListener('canplaythrough', onReady); expAudio.removeEventListener('loadeddata', onReady); resolve(); };
          if (expAudio.readyState >= 3) resolve();
          else { expAudio.addEventListener('canplaythrough', onReady, { once: true }); expAudio.addEventListener('loadeddata', onReady, { once: true }); setTimeout(() => { expAudio.removeEventListener('canplaythrough', onReady); expAudio.removeEventListener('loadeddata', onReady); resolve(); }, 8000); }
          expAudio.load();
        });

        const actx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const src = actx.createMediaElementSource(expAudio);
        const dest = actx.createMediaStreamDestination();
        src.connect(dest);
        const combined = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);

        let mt = 'video/webm;codecs=vp9,opus';
        if (!MediaRecorder.isTypeSupported(mt)) mt = 'video/webm;codecs=vp8,opus';
        if (!MediaRecorder.isTypeSupported(mt)) mt = 'video/webm';

        const rec = new MediaRecorder(combined, { mimeType: mt, videoBitsPerSecond: 18000000 });
        recorder = rec;
        clipAudio = expAudio;
        const chunks: Blob[] = [];
        rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        rec.onstop = () => {
          const rt = performance.now() - exportStart;
          const health = healthRef.current;
          if (cancelledRef.current) {
            // Stopped on purpose. Tear down, hand back nothing.
            expAudio.pause();
            actx.close().catch(() => {});
            audioElement.muted = prevMuted;
            audioElement.volume = prevVol;
            releaseScreen();
            isExportingRef.current = false;
            return;
          }
          onComplete(new Blob(chunks, { type: mt }), rt, {
            ...health,
            effectiveFps:
              health.recordedSeconds > 0
                ? (paintedFramesRef.current - paintedAtStart) / health.recordedSeconds
                : 0,
          });
          expAudio.pause();
          actx.close().catch(() => {});
          audioElement.muted = prevMuted;
          audioElement.volume = prevVol;
          releaseScreen();
          isExportingRef.current = false;
        };

        // Both elements have to be *at* the start before recording begins.
        // Assigning `currentTime` only requests a seek, so playing straight
        // afterwards captures however much of the previous position the
        // browser had not finished leaving.
        const seekTo = (el: HTMLMediaElement, time: number) =>
          new Promise<void>(resolve => {
            if (Math.abs(el.currentTime - time) < 0.05) return resolve();
            const done = () => { el.removeEventListener('seeked', done); resolve(); };
            el.addEventListener('seeked', done, { once: true });
            setTimeout(done, 3000);
            try { el.currentTime = time; } catch { done(); }
          });

        audioElement.muted = true;
        audioElement.volume = 0;
        await seekTo(audioElement, startSec);
        await seekTo(expAudio, startSec);

        /**
         * Park the backgrounds before the first frame is captured.
         *
         * They have been playing and looping since the moment they were picked,
         * so a recording started now would open at whatever arbitrary phase the
         * loop had reached -- and because VP9 spends bits on motion, two exports
         * of the same clip that only differed by where the background happened
         * to be came out tens of megabytes apart. Every clip goes back to its
         * own start; the one on screen picks up wherever the export begins
         * inside its segment, which is 0 for the usual whole-clip export.
         */
        const current = syncBackgroundVideo ? null : bgMediaRef.current;
        const activeBgVideo = current && isClip(current) ? current : null;
        for (const media of Array.from(mediaPoolRef.current.values())) {
          if (media === current || syncBackgroundVideo || !isClip(media)) continue;
          media.pause();
          try { media.currentTime = 0; } catch { /* metadata not in yet */ }
        }
        if (activeBgVideo) {
          bgSegmentRef.current = activeBg ? { key: activeBg.key, url: activeBg.url } : null;
          const loop = activeBg ? await loadLoopWindow(activeBg.url) : null;
          await seekTo(activeBgVideo, loopPhase(loopFor(loop, activeBgVideo.duration), startSec - (activeBg?.start ?? 0)));
          activeBgVideo.play().catch(() => {});
        }

        if (!isExportingRef.current) {
          releaseScreen();
          return;
        }

        await holdScreenAwake();
        paintedAtStart = paintedFramesRef.current;

        audioElement.play();
        expAudio.play();
        rec.start();

        let frames = 0;
        // Sampled against the audio clock rather than wall-clock, because the
        // condition being measured -- a backgrounded tab -- throttles this very
        // timer to about one tick a second. Audio playback is not throttled, so
        // its clock still measures real time and painted-frames-per-audio-second
        // stays honest however rarely it is read.
        let lastAudioTime = audioElement.currentTime;
        let lastPainted = paintedFramesRef.current;
        const iv = setInterval(() => {
          // A paused export is waiting for the tab to come back, not finished.
          // Without this the `ended`/position check below would stop it while
          // it was deliberately held, which is the exact failure pausing exists
          // to avoid.
          if (rec.state === 'paused') {
            onProgress(
              Math.min(99, Math.round((Math.max(0, audioElement.currentTime - startSec) / span) * 100)),
              'paused',
              frames
            );
            return;
          }
          if (!isExportingRef.current || audioElement.ended || audioElement.currentTime >= endSec) {
            clearInterval(iv);
            rec.stop();
            audioElement.pause();
            expAudio.pause();
            actx.close().catch(() => {});
            audioElement.muted = prevMuted;
            audioElement.volume = prevVol;
            return;
          }
          frames++;
          const played = Math.max(0, audioElement.currentTime - startSec);

          if (document.hidden) healthRef.current.wasHidden = true;
          healthRef.current = accumulateStarvation(
            healthRef.current,
            paintedFramesRef.current - lastPainted,
            audioElement.currentTime - lastAudioTime,
            targetFps
          );
          lastPainted = paintedFramesRef.current;
          lastAudioTime = audioElement.currentTime;

          const pct = Math.min(99, Math.round((played / span) * 100));
          const elapsed = (performance.now() - exportStart) / 1000;
          const speed = elapsed > 0 ? (played / elapsed).toFixed(1) : '1.0';
          onProgress(pct, `${speed}x`, frames);
        }, 1000 / targetFps);
      };

      run().catch(() => {
        audioElement.muted = prevMuted;
        audioElement.volume = prevVol;
        releaseScreen();
        isExportingRef.current = false;
      });
    }
  }));

  return (
    <div className="relative flex flex-col items-center justify-center w-full h-full group">
      {/* The render loop's own numbers, for development only: in a
          published studio they were the first thing on the video and meant
          nothing to the person making it. The frame size is in the bar above
          the preview now. */}
      {showStats && (
        <div className="absolute top-3 start-3 z-20 pointer-events-none flex items-center gap-2 whitespace-nowrap bg-slate-900/85 backdrop-blur-md px-3 py-1.5 rounded-full border border-emerald-500/30 text-xs font-mono text-emerald-400 shadow-lg">
          <span>{fpsDisplay} FPS</span>
          <span className="text-slate-400">|</span>
          <span>{renderMs} ms</span>
        </div>
      )}
      <div className="relative w-full h-full flex items-center justify-center p-2">
        <canvas
          ref={canvasRef}
          className="max-h-[var(--preview-max-h,72vh)] max-w-full object-contain rounded-xl shadow-2xl border border-slate-800 bg-slate-950 transition-all duration-300"
          style={{ aspectRatio: dimensions.width / dimensions.height }}
        />
        {overlayBox && (
          <div
            className="absolute pointer-events-none"
            style={{ left: overlayBox.left, top: overlayBox.top, width: overlayBox.width, height: overlayBox.height }}
          >
            {overlay}
          </div>
        )}
      </div>
    </div>
  );
});

VideoCanvas.displayName = 'VideoCanvas';
