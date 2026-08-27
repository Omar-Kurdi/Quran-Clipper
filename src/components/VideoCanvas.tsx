'use client';

import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react';
import { VerseData } from '@/lib/quranData';
import { backgroundAt, backgroundPlaylist, BackgroundConfig, BackgroundMode, BackgroundSegment } from '@/lib/backgroundTimeline';

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
  showWaveform: boolean;
  showSurahBadge: boolean;
  surahBadgeText: string;
  surahBadgeSubtitleText: string;
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
    onComplete: (blob: Blob, renderTimeMs: number) => void,
    targetFps?: number
  ) => void;
  stopExport: () => void;
}

interface VideoCanvasProps {
  config: VideoCanvasConfig;
  verses: VerseData[];
  currentTime: number;
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
}

// ---------------------------------------------------------------------------
// RoundRect polyfill
// ---------------------------------------------------------------------------
//: Floors for the verse-card shrink-to-fit. Reached only by a segment far
//: longer than the card was designed for; below these the frame is unreadable
//: anyway, and overflowing is the better failure than dropping recited words.
const MIN_ARABIC_PX = 16;
const MIN_TRANSLATION_PX = 10;

type CardTextLayout = {
  arabicLines: string[];
  arabicLineHeight: number;
  translationLines: string[];
  translationLineHeight: number;
  widest: number;
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
  audioAnalyser,
  surahNameArabic,
  surahNameEnglish,
  surahNumber,
  ayahStart,
  ayahEnd,
  syncBackgroundVideo = false,
  isPlaying = false,
  backgroundTimeOffset = 0
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoBgRef = useRef<HTMLVideoElement | null>(null);
  const isExportingRef = useRef<boolean>(false);
  const videoErrorRef = useRef<boolean>(false);

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
  const activeVerse = useMemo(
    () => [...sortedVerses].reverse().find(v => currentTime >= v.startTime)
      || sortedVerses[0]
      || { verseNumber: 1, textUthmani: '', translation: '' } as unknown as VerseData,
    [sortedVerses, currentTime]
  );
  /**
   * Backgrounds in play, in order.
   *
   * `bgUrl` remains the single-background case so existing projects, the saved
   * schema and the API payload keep working untouched; `bgUrls` only takes over
   * once a multi mode is selected and something is actually in the list.
   */
  const videoPoolRef = useRef<Map<string, HTMLVideoElement>>(new Map());

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
   * One <video> per background, all loaded and running at once.
   *
   * Swapping `src` on a single element would stall while the next clip buffers,
   * and export records the canvas in real time -- so that stall bakes into the
   * output as black frames rather than merely looking rough in the preview.
   * Keeping every clip warm makes switching a choice of which element to draw.
   */
  useEffect(() => {
    videoErrorRef.current = false;
    const pool = videoPoolRef.current;

    for (const url of bgPlaylist) {
      let vid = pool.get(url);
      if (!vid) {
        vid = document.createElement('video');
        vid.crossOrigin = 'anonymous';
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = 'auto';
        vid.src = url;
        vid.addEventListener('error', () => { videoErrorRef.current = true; }, { once: true });
        pool.set(url, vid);
        vid.load();
      }
      // Decorative footage loops forever on its own. A synced recitation must
      // not: it is driven by the sync effect below, and looping would send it
      // back to 0 mid-verse.
      vid.loop = !syncBackgroundVideo;
      if (!syncBackgroundVideo) vid.play().catch(() => {});
    }

    for (const [url, vid] of Array.from(pool.entries())) {
      if (bgPlaylist.includes(url)) continue;
      vid.pause();
      vid.removeAttribute('src');
      vid.load();
      pool.delete(url);
    }
  }, [bgPlaylist, syncBackgroundVideo]);

  // Point the draw loop at whichever pooled clip is current.
  useEffect(() => {
    videoBgRef.current = bgVideoSrc ? videoPoolRef.current.get(bgVideoSrc) ?? null : null;
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

    const vid = videoPoolRef.current.get(activeBg.url);
    if (!vid) return;
    // Only seek if it is not already there. A seek briefly drops `readyState`
    // below the level the draw loop requires, which during a real-time export
    // bakes a gradient frame into the file -- and a clip parked at 0 by the
    // export setup below is already exactly where it needs to be.
    if (vid.currentTime > 0.05) {
      try {
        vid.currentTime = 0;
      } catch {
        // Seeking before metadata lands throws; the clip plays from 0 anyway.
      }
    }
    vid.play().catch(() => {});
  }, [activeBg, syncBackgroundVideo]);

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
    const vid = videoBgRef.current;
    if (!vid || !bgVideoSrc || !syncBackgroundVideo || videoErrorRef.current) return;

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
    const pool = videoPoolRef.current;
    return () => {
      for (const vid of pool.values()) {
        vid.pause();
        vid.removeAttribute('src');
        vid.load();
      }
      pool.clear();
      videoBgRef.current = null;
    };
  }, []);

  const getDisplayArabic = useCallback((verse: VerseData | typeof activeVerse) => {
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

  // ---- RENDER LOOP ----
  useEffect(() => {
    let animationFrameId: number;
    let frameCount = 0;
    let lastFpsCalc = performance.now();

    const drawFrame = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const renderStart = performance.now();
      const { width, height } = dimensions;

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      // 1. Background (video or gradient fallback)
      const vid = videoBgRef.current;
      if (vid && vid.readyState >= 2 && !videoErrorRef.current) {
        ctx.save();
        if (config.bgBlur > 0) ctx.filter = `blur(${config.bgBlur * 2.5}px)`;
        const vRatio = vid.videoWidth / vid.videoHeight;
        const cRatio = width / height;
        let dw = width, dh = height, dx = 0, dy = 0;
        if (vRatio > cRatio) { dw = height * vRatio; dx = (width - dw) / 2; }
        else { dh = width / vRatio; dy = (height - dh) / 2; }
        ctx.drawImage(vid, dx, dy, dw, dh);
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

      // 3. Subtle ambient particles
      ctx.save();
      const goldAccent = config.accentColor || '#b8c7dc';
      for (let i = 0; i < 12; i++) {
        const px = (Math.sin(frameCount * 0.02 + i * 2.1) * 0.5 + 0.5) * width;
        const py = ((frameCount * 0.15 + i * 73) % height);
        ctx.beginPath();
        ctx.arc(px, py, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = goldAccent;
        ctx.globalAlpha = 0.2;
        ctx.shadowColor = goldAccent;
        ctx.shadowBlur = 6;
        ctx.fill();
      }
      ctx.restore();

      // 4. Audio waveform
      if (config.showWaveform && audioAnalyser) {
        ctx.save();
        const bufferLength = audioAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        audioAnalyser.getByteFrequencyData(dataArray);
        const barCount = 48;
        const barWidth = (width * 0.7) / barCount;
        const startX = (width - barCount * barWidth) / 2;
        const waveY = height * 0.88;
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

      // 5. Surah badge
      if (config.showSurahBadge) {
        ctx.save();
        // Everything else on the canvas scales with height; this badge used a
        // fixed 22px on a 1080-wide frame, which rendered as an illegible strip
        // and could overflow its own plate on a long surah name.
        const scale = height / 1920;
        const badgeWidth = width * 0.72;
        const badgeX = (width - badgeWidth) / 2;
        const badgeY = height * 0.12;

        const firstVK = verses[0]?.verseKey;
        const lastVK = verses[verses.length - 1]?.verseKey;
        const range = firstVK && lastVK
          ? firstVK.split(':')[0] === lastVK.split(':')[0]
            ? `${firstVK}-${lastVK.split(':')[1]}`
            : `${firstVK} → ${lastVK}`
          : `${surahNumber}:${ayahStart}-${ayahEnd}`;
        const title = config.surahBadgeText?.trim() || `سُورَةُ ${surahNameArabic} • ${surahNameEnglish} (${range})`;
        const subtitle = config.surahBadgeSubtitleText?.trim() || '';

        // Shrink to fit rather than spill past the plate.
        let titleSize = 34 * scale;
        const innerWidth = badgeWidth - 44 * scale;
        ctx.font = `bold ${titleSize}px 'Amiri', serif`;
        while (ctx.measureText(title).width > innerWidth && titleSize > 16 * scale) {
          titleSize -= scale;
          ctx.font = `bold ${titleSize}px 'Amiri', serif`;
        }
        const subtitleSize = 20 * scale;

        // Place the text by where its glyphs actually are, not by the baseline
        // convention. `textBaseline: 'middle'` centres on the font's em box,
        // and Amiri's Arabic ink -- harakat and all -- sits well above that:
        // measured on the default title it put the text 8px high in a 68px
        // plate and pushed the diacritics of سُورَةُ through the gold border.
        // actualBoundingBox* is where the glyphs really land.
        const titleFont = `bold ${titleSize}px 'Amiri', serif`;
        const subtitleFont = `600 ${subtitleSize}px 'Inter', sans-serif`;
        const inkHeight = (text: string, font: string) => {
          ctx.font = font;
          const m = ctx.measureText(text);
          return { ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent };
        };
        const titleInk = inkHeight(title, titleFont);
        const subtitleInk = subtitle ? inkHeight(subtitle, subtitleFont) : { ascent: 0, descent: 0 };
        const stackGap = subtitle ? 8 * scale : 0;
        const contentHeight =
          titleInk.ascent + titleInk.descent + stackGap + subtitleInk.ascent + subtitleInk.descent;

        // The plate keeps its old height so the badge doesn't resize itself
        // with every change of wording; the max() is only a floor, for a title
        // whose ink genuinely cannot fit inside the border.
        const badgeHeight = Math.max(
          subtitle ? titleSize + subtitleSize + 34 * scale : titleSize + 34 * scale,
          contentHeight + 12 * scale
        );

        // Darker plate than before: the badge sits over arbitrary footage, so
        // it has to carry its own contrast rather than hope the frame is dark.
        ctx.fillStyle = 'rgba(6, 9, 16, 0.74)';
        ctx.strokeStyle = goldAccent;
        ctx.lineWidth = Math.max(1, 2 * scale);
        drawRoundRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, badgeHeight / 2);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
        ctx.shadowBlur = 6 * scale;

        // Centre the whole stack's ink box in the plate, then sit each line on
        // its own baseline within it.
        let inkTop = badgeY + (badgeHeight - contentHeight) / 2;
        ctx.font = titleFont;
        ctx.fillStyle = goldAccent;
        ctx.fillText(title, width / 2, inkTop + titleInk.ascent);
        if (subtitle) {
          inkTop += titleInk.ascent + titleInk.descent + stackGap;
          ctx.font = subtitleFont;
          ctx.fillStyle = 'rgba(237, 241, 247, 0.92)';
          ctx.fillText(subtitle, width / 2, inkTop + subtitleInk.ascent);
        }
        ctx.restore();
      }

      // 6. Verse card
      ctx.save();
      const cardMargin = width * 0.08;
      const cardWidth = width - cardMargin * 2;
      const cardHeight = height * 0.52;
      const cardX = cardMargin;
      const cardY = height * 0.23;

      if (config.cardBgOpacity > 0) {
        ctx.fillStyle = `rgba(15, 23, 42, ${config.cardBgOpacity / 100})`;
        drawRoundRect(ctx, cardX, cardY, cardWidth, cardHeight, 28);
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

      const displayArabic = activeVerse ? getDisplayArabic(activeVerse) : '';
      if (activeVerse && displayArabic) {
        const translationText = activeVerse.displayTranslation || activeVerse.translation || '';
        const withTranslation = Boolean(config.showTranslation && translationText);
        const maxTextWidth = cardWidth - 80;
        const ayahFontSize = (config.ayahNumberFontSize || 34) * (height / 1920);
        // Ayah numeral, the gap around the divider, and the room under it.
        const belowArabic = ayahFontSize + 48;
        const cardPadding = 40;
        const availableHeight = cardHeight - cardPadding * 2 - belowArabic;

        const arabicFont = (size: number) =>
          `bold ${size}px '${config.fontArabic}', 'Scheherazade New', 'Amiri', serif`;
        const translationFont = (size: number) =>
          `${size}px '${config.fontTranslation}', sans-serif`;

        // Wraps greedily and never drops a word. A word too wide for the card
        // still gets its own line; the fitting loop then shrinks the type until
        // even that line fits, which is what keeps this from silently cutting.
        const wrapAll = (text: string, limit: number) => {
          const out: string[] = [];
          let line = '';
          for (const word of text.split(/\s+/).filter(Boolean)) {
            const test = line ? `${line} ${word}` : word;
            if (ctx.measureText(test).width > limit && line) { out.push(line); line = word; }
            else line = test;
          }
          if (line) out.push(line);
          return out;
        };

        const layoutAt = (arabic: number, translation: number) => {
          ctx.font = arabicFont(arabic);
          const arabicLines = wrapAll(displayArabic, maxTextWidth);
          const arabicLineHeight = arabic * 1.45;
          let widest = 0;
          for (const line of arabicLines) widest = Math.max(widest, ctx.measureText(line).width);
          let translationLines: string[] = [];
          let translationLineHeight = 0;
          if (withTranslation) {
            ctx.font = translationFont(translation);
            translationLines = wrapAll(translationText, maxTextWidth);
            translationLineHeight = translation * 1.55;
            for (const line of translationLines) widest = Math.max(widest, ctx.measureText(line).width);
          }
          return {
            arabicLines, arabicLineHeight, translationLines, translationLineHeight, widest,
            arabicSize: arabic, translationSize: translation,
            stackHeight: arabicLines.length * arabicLineHeight
              + translationLines.length * translationLineHeight,
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
          displayArabic, translationText, withTranslation, cardWidth, cardHeight,
          config.fontArabic, config.fontTranslation, config.arabicFontSize,
          config.translationFontSize, config.ayahNumberFontSize,
          typeof document !== 'undefined' ? document.fonts.status : '',
        ].join('|');

        let layout = textLayoutCache.current.get(layoutKey);
        if (!layout) {
          let arabicSize = config.arabicFontSize * (height / 1920) * 1.5;
          let translationSize = config.translationFontSize * (height / 1920) * 1.3;
          layout = layoutAt(arabicSize, translationSize);
          while (
            (layout.stackHeight > availableHeight || layout.widest > maxTextWidth)
            && arabicSize > MIN_ARABIC_PX
          ) {
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
        let y = cardY + Math.max(
          cardPadding,
          (cardHeight - (layout.stackHeight + belowArabic)) / 2
        );

        ctx.textBaseline = 'top';
        ctx.direction = 'rtl';
        ctx.font = arabicFont(layout.arabicSize);
        ctx.fillStyle = config.textColor || '#ffffff';
        if (config.textShadow) {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
          ctx.shadowBlur = 12;
          ctx.shadowOffsetY = 4;
        }
        for (const line of layout.arabicLines) {
          ctx.fillText(line.trim(), textX, y);
          y += layout.arabicLineHeight;
        }
        ctx.direction = 'ltr';
        ctx.shadowColor = 'transparent';
        ctx.shadowOffsetY = 0;

        ctx.font = `600 ${ayahFontSize}px '${config.fontArabic}', serif`;
        ctx.fillStyle = goldAccent;
        // U+FD3E opens and U+FD3F closes when read right-to-left, despite their
        // Unicode names ("ornate left/right parenthesis") suggesting the reverse.
        ctx.fillText(`﴾ ${activeVerse.verseNumber} ﴿`, width / 2, y);
        y += ayahFontSize + 24;

        ctx.strokeStyle = goldAccent;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(width / 2 - 120, y);
        ctx.lineTo(width / 2 + 120, y);
        ctx.stroke();
        ctx.globalAlpha = 1.0;
        y += 24;

        if (withTranslation) {
          ctx.font = translationFont(layout.translationSize);
          ctx.fillStyle = config.translationColor || '#e2e8f0';
          if (config.textShadow) { ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8; }
          for (const line of layout.translationLines) {
            ctx.fillText(line.trim(), textX, y);
            y += layout.translationLineHeight;
          }
        }
        ctx.textBaseline = 'alphabetic';
      }
      ctx.restore();

      // 7. Watermark
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

      frameCount++;
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
  }, [config, verses, currentTime, audioAnalyser, surahNameArabic, surahNameEnglish,
      dimensions, getDisplayArabic, wrapCanvasText, surahNumber, ayahStart, ayahEnd, activeVerse]);

  // ---- EXPORT ----
  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    stopExport: () => { isExportingRef.current = false; },
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
      onComplete: (blob: Blob, ms: number) => void,
      targetFps = 60
    ) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const startSec = Math.max(0, range.start);
      const endSec = Math.max(startSec + 0.1, range.end);
      const span = endSec - startSec;
      isExportingRef.current = true;
      const exportStart = performance.now();
      const prevMuted = audioElement.muted;
      const prevVol = audioElement.volume;
      const canvasStream = canvas.captureStream(targetFps);

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
        const chunks: Blob[] = [];
        rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        rec.onstop = () => {
          const rt = performance.now() - exportStart;
          onComplete(new Blob(chunks, { type: mt }), rt);
          expAudio.pause();
          actx.close().catch(() => {});
          audioElement.muted = prevMuted;
          audioElement.volume = prevVol;
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
        const activeBgVideo = syncBackgroundVideo ? null : videoBgRef.current;
        for (const vid of Array.from(videoPoolRef.current.values())) {
          if (vid === activeBgVideo || syncBackgroundVideo) continue;
          vid.pause();
          try { vid.currentTime = 0; } catch { /* metadata not in yet */ }
        }
        if (activeBgVideo) {
          bgSegmentRef.current = activeBg ? { key: activeBg.key, url: activeBg.url } : null;
          await seekTo(activeBgVideo, Math.max(0, startSec - (activeBg?.start ?? 0)));
          activeBgVideo.play().catch(() => {});
        }

        if (!isExportingRef.current) return;

        audioElement.play();
        expAudio.play();
        rec.start();

        let frames = 0;
        const iv = setInterval(() => {
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
          const pct = Math.min(99, Math.round((played / span) * 100));
          const elapsed = (performance.now() - exportStart) / 1000;
          const speed = elapsed > 0 ? (played / elapsed).toFixed(1) : '1.0';
          onProgress(pct, `${speed}x`, frames);
        }, 1000 / targetFps);
      };

      run().catch(() => {
        audioElement.muted = prevMuted;
        audioElement.volume = prevVol;
        isExportingRef.current = false;
      });
    }
  }));

  return (
    <div className="relative flex flex-col items-center justify-center w-full h-full group">
      {/* One row rather than two independently-anchored corners. Pinned to
          opposite edges of the same pane, these overlapped by 141px whenever
          the preview was narrow -- the resolution pill sat on top of half the
          render stats. `justify-between` makes that impossible, and the stats
          truncate rather than push. */}
      <div className="absolute top-3 inset-x-3 z-20 flex flex-wrap items-start justify-between gap-2 pointer-events-none">
        <div className="flex items-center gap-2 shrink-0 whitespace-nowrap bg-slate-900/85 backdrop-blur-md px-3 py-1.5 rounded-full border border-emerald-500/30 text-xs font-mono text-emerald-400 shadow-lg">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span>{fpsDisplay} FPS</span>
          <span className="text-slate-400">|</span>
          {/* Short unit: the pane is narrow and "ms/frame" is what pushed this
              badge into truncating mid-word. */}
          <span>{renderMs} ms</span>
        </div>
        <div className="shrink-0 bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded-md text-[11px] font-mono text-slate-300 border border-slate-700/50">
          {dimensions.width} x {dimensions.height} ({config.aspectRatio})
        </div>
      </div>
      <div className="relative w-full h-full flex items-center justify-center p-2">
        <canvas
          ref={canvasRef}
          className="max-h-[72vh] max-w-full object-contain rounded-xl shadow-2xl border border-slate-800 bg-slate-950 transition-all duration-300"
          style={{ aspectRatio: dimensions.width / dimensions.height }}
        />
      </div>
    </div>
  );
});

VideoCanvas.displayName = 'VideoCanvas';
