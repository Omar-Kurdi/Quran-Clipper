'use client';

import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react';
import { VerseData } from '@/lib/quranData';

export interface VideoCanvasConfig {
  aspectRatio: string;
  fontArabic: string;
  fontTranslation: string;
  arabicFontSize: number;
  transliterationFontSize: number;
  translationFontSize: number;
  /** 'ayah' draws the sentence translation; 'words' pairs each shown word with its own gloss. */
  translationMode?: 'ayah' | 'words';
  ayahNumberFontSize: number;
  textAlignment: string;
  textColor: string;
  accentColor: string;
  translationColor: string;
  textShadow: boolean;
  showTransliteration: boolean;
  showTranslation: boolean;
  showWaveform: boolean;
  showSurahBadge: boolean;
  surahBadgeText: string;
  surahBadgeSubtitleText: string;
  bgType: string;
  bgUrl: string;
  /** Extra backgrounds for the non-single modes. `bgUrl` stays the single-background case. */
  bgUrls?: string[];
  bgMode?: 'single' | 'per-ayah' | 'cycle' | 'shuffle';
  /** Seconds each background holds in 'cycle' mode. */
  bgCycleSeconds?: number;
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
    durationSec: number,
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
      || { verseNumber: 1, textUthmani: '', transliteration: '', translation: '' } as VerseData,
    [sortedVerses, currentTime]
  );
  const activeVerseIndex = useMemo(
    () => Math.max(0, sortedVerses.indexOf(activeVerse as VerseData)),
    [sortedVerses, activeVerse]
  );

  /**
   * Backgrounds in play, in order.
   *
   * `bgUrl` remains the single-background case so existing projects, the saved
   * schema and the API payload keep working untouched; `bgUrls` only takes over
   * once a multi mode is selected and something is actually in the list.
   */
  const videoPoolRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  const bgPlaylist = useMemo(() => {
    if (config.bgType !== 'video') return [] as string[];
    const many = (config.bgUrls || []).filter(Boolean);
    if (config.bgMode && config.bgMode !== 'single' && many.length > 0) return many;
    return config.bgUrl ? [config.bgUrl] : [];
  }, [config.bgType, config.bgUrl, config.bgUrls, config.bgMode]);

  const bgVideoSrc = useMemo(() => {
    const count = bgPlaylist.length;
    if (count === 0) return '';
    if (count === 1) return bgPlaylist[0];
    switch (config.bgMode) {
      case 'per-ayah':
        return bgPlaylist[activeVerseIndex % count];
      case 'cycle': {
        const hold = Math.max(1, config.bgCycleSeconds || 5);
        return bgPlaylist[Math.floor(Math.max(0, currentTime) / hold) % count];
      }
      case 'shuffle': {
        // Seeded from the segment index, never Math.random(): the value has to
        // be identical on every frame and identical again during export, or the
        // background would flicker and the render would not match the preview.
        const hashed = Math.imul(activeVerseIndex + 1, 2654435761) >>> 0;
        return bgPlaylist[hashed % count];
      }
      default:
        return bgPlaylist[0];
    }
  }, [bgPlaylist, config.bgMode, config.bgCycleSeconds, activeVerseIndex, currentTime]);

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

  /**
   * Lays visible words out as right-to-left columns, each Arabic word sitting
   * above its own English gloss.
   *
   * This exists because the sentence translation describes the *whole* ayah:
   * exclude a word from the canvas and the English underneath still claims the
   * full verse. Pairing each word with its own gloss keeps the two in step.
   *
   * Word order is right-to-left, so words[0] is placed at the right edge and
   * each subsequent column moves left. The Arabic is drawn per column rather
   * than as one string, so we position it ourselves instead of letting the
   * browser's bidi pass do it -- a single word is a contiguous RTL run, which
   * renders correctly either way.
   */
  const buildWordColumns = useCallback((
    ctx: CanvasRenderingContext2D,
    words: { arabic: string; gloss: string }[],
    maxWidth: number,
    arabicFont: string,
    glossFont: string,
    gap: number
  ) => {
    const measured = words.map(w => {
      ctx.font = arabicFont;
      const arabicWidth = ctx.measureText(w.arabic).width;
      ctx.font = glossFont;
      // An empty gloss simply collapses the column to the Arabic width; the
      // API returns '' for some tokens and a forced gap would read as a bug.
      const glossWidth = w.gloss ? ctx.measureText(w.gloss).width : 0;
      return { ...w, width: Math.max(arabicWidth, glossWidth) };
    });

    const rows: { columns: typeof measured; width: number }[] = [];
    let current: typeof measured = [];
    let currentWidth = 0;
    for (const col of measured) {
      const added = col.width + (current.length ? gap : 0);
      if (currentWidth + added > maxWidth && current.length) {
        rows.push({ columns: current, width: currentWidth });
        current = [col];
        currentWidth = col.width;
      } else {
        current.push(col);
        currentWidth += added;
      }
    }
    if (current.length) rows.push({ columns: current, width: currentWidth });
    return rows;
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
      const goldAccent = config.accentColor || '#fbbf24';
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
        const badgeWidth = width * 0.65;
        const badgeHeight = 70;
        const badgeX = (width - badgeWidth) / 2;
        const badgeY = height * 0.12;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
        ctx.strokeStyle = goldAccent;
        ctx.lineWidth = 1.5;
        drawRoundRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 35);
        ctx.fill();
        ctx.stroke();
        ctx.font = `bold 22px 'Amiri', serif`;
        ctx.fillStyle = goldAccent;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const firstVK = verses[0]?.verseKey;
        const lastVK = verses[verses.length - 1]?.verseKey;
        const range = firstVK && lastVK
          ? firstVK.split(':')[0] === lastVK.split(':')[0]
            ? `${firstVK}-${lastVK.split(':')[1]}`
            : `${firstVK} → ${lastVK}`
          : `${surahNumber}:${ayahStart}-${ayahEnd}`;
        const title = config.surahBadgeText?.trim() || `سُورَةُ ${surahNameArabic} • ${surahNameEnglish} (${range})`;
        const subtitle = config.surahBadgeSubtitleText?.trim() || '';
        ctx.fillText(title, width / 2, badgeY + badgeHeight / 2 - (subtitle ? 10 : 0));
        if (subtitle) {
          ctx.font = `600 16px 'Inter', sans-serif`;
          ctx.fillStyle = 'rgba(226, 232, 240, 0.88)';
          ctx.fillText(subtitle, width / 2, badgeY + badgeHeight / 2 + 18);
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
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      ctx.textAlign = (config.textAlignment as CanvasTextAlign) || 'center';
      const textX = config.textAlignment === 'right' ? cardX + cardWidth - 40
        : config.textAlignment === 'left' ? cardX + 40 : width / 2;

      const displayArabic = activeVerse ? getDisplayArabic(activeVerse) : '';

      // Word-by-word only works when the ayah actually carries per-word glosses
      // (the Quran.com fetch supplies them; hand-added segments may not), so
      // fall back to the sentence translation rather than rendering blanks.
      const glossWords = (activeVerse?.words || [])
        .filter(w => !w.excluded && w.arabic)
        .map(w => ({ arabic: w.arabic, gloss: (w.translation || '').trim() }));
      const wordByWord =
        config.translationMode === 'words' &&
        config.showTranslation &&
        glossWords.length > 0 &&
        glossWords.some(w => w.gloss);

      if (activeVerse && displayArabic) {
        let arabicRenderSize = config.arabicFontSize * (height / 1920) * 1.5;
        const maxArabicBlockHeight = cardHeight * 0.34;
        ctx.font = `bold ${arabicRenderSize}px '${config.fontArabic}', 'Scheherazade New', 'Amiri', serif`;
        ctx.fillStyle = config.textColor || '#ffffff';
        ctx.direction = 'rtl';
        if (config.textShadow) {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
          ctx.shadowBlur = 12;
          ctx.shadowOffsetY = 4;
        }
        const maxTextWidth = cardWidth - 80;
        const arabicWords = displayArabic.split(/\s+/).filter(Boolean);
        let lineHeight = arabicRenderSize * 1.45;
        const buildArabicLines = (): string[] => {
          const ls: string[] = [];
          let cur = '';
          for (const w of arabicWords) {
            const t = cur ? `${cur} ${w}` : w;
            if (ctx.measureText(t).width > maxTextWidth && cur) {
              ls.push(cur);
              cur = w;
            } else { cur = t; }
          }
          if (cur) ls.push(cur);
          return ls;
        };
        let lines = buildArabicLines();
        while (lines.length * lineHeight > maxArabicBlockHeight && arabicRenderSize > 30) {
          arabicRenderSize -= 2;
          ctx.font = `bold ${arabicRenderSize}px '${config.fontArabic}', 'Scheherazade New', 'Amiri', serif`;
          lineHeight = arabicRenderSize * 1.45;
          lines = buildArabicLines();
        }

        // Word-by-word stacks a gloss under every word, so a row is far taller
        // than a paragraph line and the block gets its own shrink-to-fit pass
        // against a larger budget (it carries the translation too).
        const arabicFontFor = (size: number) =>
          `bold ${size}px '${config.fontArabic}', 'Scheherazade New', 'Amiri', serif`;
        let glossSize = (config.translationFontSize || 20) * (height / 1920) * 1.05;
        const glossFontFor = (size: number) => `${size}px '${config.fontTranslation}', sans-serif`;
        const columnGap = Math.max(14, arabicRenderSize * 0.35);
        let glossRows = wordByWord
          ? buildWordColumns(ctx, glossWords, maxTextWidth, arabicFontFor(arabicRenderSize), glossFontFor(glossSize), columnGap)
          : [];
        let glossRowHeight = arabicRenderSize * 1.15 + glossSize * 1.45;
        if (wordByWord) {
          const glossBudget = cardHeight * 0.62;
          while (glossRows.length * glossRowHeight > glossBudget && arabicRenderSize > 26) {
            arabicRenderSize -= 2;
            glossSize = Math.max(11, glossSize - 1);
            glossRows = buildWordColumns(
              ctx, glossWords, maxTextWidth,
              arabicFontFor(arabicRenderSize), glossFontFor(glossSize),
              Math.max(14, arabicRenderSize * 0.35)
            );
            glossRowHeight = arabicRenderSize * 1.15 + glossSize * 1.45;
          }
        }
        // Measure the blocks below the Arabic before drawing anything, so the
        // whole stack can be centred in the card. Anchoring the Arabic to a
        // fixed top offset made short ayahs hug the top border and leave the
        // card bottom-heavy with empty space, while long ones filled it -- the
        // visual balance changed with every segment.
        const ayahFontSize = (config.ayahNumberFontSize || 34) * (height / 1920);
        const shownArabicLines = Math.min(lines.length, 5);
        const arabicBlockHeight = wordByWord
          ? glossRows.length * glossRowHeight
          : shownArabicLines * lineHeight;

        let belowHeight = ayahFontSize * 0.65 + 48; // ayah number + divider gap

        const translitText = activeVerse.displayTransliteration || activeVerse.transliteration || '';
        if (config.showTransliteration && translitText) {
          const tSize = (config.transliterationFontSize || 24) * (height / 1920) * 1.15;
          ctx.font = `italic ${tSize}px 'Inter', sans-serif`;
          belowHeight += wrapCanvasText(ctx, translitText, maxTextWidth, 2).length * tSize * 1.45 + 14;
        } else {
          belowHeight += 18;
        }

        const measuredTranslation = activeVerse.displayTranslation || activeVerse.translation || '';
        if (config.showTranslation && measuredTranslation && !wordByWord) {
          const ts = config.translationFontSize * (height / 1920) * 1.3;
          ctx.font = `${ts}px '${config.fontTranslation}', sans-serif`;
          belowHeight += wrapCanvasText(ctx, measuredTranslation, maxTextWidth, 12).length * ts * 1.55;
        }

        // Centre when it fits; otherwise fall back to a top margin and let the
        // existing shrink-to-fit logic below handle the overflow.
        const minPadding = 40;
        const stackHeight = arabicBlockHeight + belowHeight;
        let arabicStartY = cardHeight - stackHeight > minPadding * 2
          ? cardY + (cardHeight - stackHeight) / 2
          : cardY + minPadding;

        ctx.fillStyle = config.textColor || '#ffffff';
        if (wordByWord) {
          const prevAlign = ctx.textAlign;
          ctx.textAlign = 'center';
          for (const row of glossRows) {
            // Rows are centred on textX; words[0] is the rightmost column and
            // each following one steps left, which is the reading order.
            let cursor = textX + row.width / 2;
            for (const col of row.columns) {
              const centre = cursor - col.width / 2;
              ctx.direction = 'rtl';
              ctx.font = arabicFontFor(arabicRenderSize);
              ctx.fillStyle = config.textColor || '#ffffff';
              ctx.fillText(col.arabic, centre, arabicStartY);
              if (col.gloss) {
                ctx.direction = 'ltr';
                ctx.font = glossFontFor(glossSize);
                ctx.fillStyle = config.translationColor || '#e2e8f0';
                ctx.fillText(col.gloss, centre, arabicStartY + arabicRenderSize * 0.35 + glossSize);
              }
              cursor -= col.width + columnGap;
            }
            arabicStartY += glossRowHeight;
          }
          ctx.textAlign = prevAlign;
        } else {
          ctx.font = `bold ${arabicRenderSize}px '${config.fontArabic}', 'Scheherazade New', 'Amiri', serif`;
          lines.slice(0, 5).forEach((line, li) => {
            ctx.fillText(`${line.trim()}${li === 4 && lines.length > 5 ? '…' : ''}`, textX, arabicStartY);
            arabicStartY += lineHeight;
          });
        }
        ctx.direction = 'ltr';
        ctx.shadowColor = 'transparent';
        ctx.font = `600 ${ayahFontSize}px '${config.fontArabic}', serif`;
        ctx.fillStyle = goldAccent;
        // U+FD3E opens and U+FD3F closes when read right-to-left, despite their
        // Unicode names ("ornate left/right parenthesis") suggesting the reverse.
        ctx.fillText(`﴾ ${activeVerse.verseNumber} ﴿`, width / 2, arabicStartY - 6);

        const dividerY = arabicStartY + ayahFontSize * 0.65;
        ctx.strokeStyle = goldAccent;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(width / 2 - 120, dividerY);
        ctx.lineTo(width / 2 + 120, dividerY);
        ctx.stroke();
        ctx.globalAlpha = 1.0;

        let transY = dividerY + 48;

        if (config.showTransliteration && (activeVerse.displayTransliteration || activeVerse.transliteration)) {
          const tSize = (config.transliterationFontSize || 24) * (height / 1920) * 1.15;
          ctx.font = `italic ${tSize}px 'Inter', sans-serif`;
          ctx.fillStyle = goldAccent;
          wrapCanvasText(ctx, activeVerse.displayTransliteration || activeVerse.transliteration, maxTextWidth, 2)
            .forEach(line => { ctx.fillText(line, textX, transY); transY += tSize * 1.45; });
          transY += 14;
        } else { transY += 18; }

        const translationText = activeVerse.displayTranslation || activeVerse.translation || '';
        if (config.showTranslation && translationText && !wordByWord) {
          let ts = config.translationFontSize * (height / 1920) * 1.3;
          let tlh = ts * 1.55;
          const bottom = cardY + cardHeight - 44;
          transY = Math.max(transY, dividerY + 42);
          const avail = Math.max(tlh, bottom - transY);
          ctx.textBaseline = 'top';
          ctx.font = `${ts}px '${config.fontTranslation}', sans-serif`;
          let tl = wrapCanvasText(ctx, translationText, maxTextWidth, 12);
          while (tl.length * tlh > avail && ts > 12) {
            ts -= 1; tlh = ts * 1.55;
            ctx.font = `${ts}px '${config.fontTranslation}', sans-serif`;
            tl = wrapCanvasText(ctx, translationText, maxTextWidth, 12);
          }
          ctx.fillStyle = config.translationColor || '#e2e8f0';
          if (config.textShadow) { ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8; }
          const maxFit = Math.max(1, Math.floor(avail / tlh));
          tl.slice(0, maxFit).forEach((l, li) => {
            ctx.fillText(`${l.trim()}${li === maxFit - 1 && tl.length > maxFit ? '…' : ''}`, textX, transY);
            transY += tlh;
          });
          ctx.textBaseline = 'alphabetic';
        }
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
      dimensions, getDisplayArabic, wrapCanvasText, buildWordColumns,
      surahNumber, ayahStart, ayahEnd, activeVerse]);

  // ---- EXPORT ----
  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    stopExport: () => { isExportingRef.current = false; },
    exportVideo: (
      audioElement: HTMLAudioElement,
      durationSec: number,
      onProgress: (p: number, s: string, f: number) => void,
      onComplete: (blob: Blob, ms: number) => void,
      targetFps = 60
    ) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
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

        audioElement.currentTime = 0;
        audioElement.muted = true;
        audioElement.volume = 0;
        audioElement.play();
        expAudio.currentTime = 0;
        expAudio.play();
        rec.start();

        let frames = 0;
        const iv = setInterval(() => {
          if (!isExportingRef.current || audioElement.ended || audioElement.currentTime >= durationSec) {
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
          const pct = Math.min(99, Math.round((audioElement.currentTime / durationSec) * 100));
          const elapsed = (performance.now() - exportStart) / 1000;
          const speed = elapsed > 0 ? (audioElement.currentTime / elapsed).toFixed(1) : '1.0';
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
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2 bg-slate-900/85 backdrop-blur-md px-3 py-1.5 rounded-full border border-emerald-500/30 text-xs font-mono text-emerald-400 shadow-lg">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <span>GPU Active</span>
        <span className="text-slate-500">|</span>
        <span>{fpsDisplay} FPS</span>
        <span className="text-slate-500">|</span>
        <span>{renderMs} ms/frame</span>
      </div>
      <div className="absolute top-3 right-3 z-20 bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded-md text-[11px] font-mono text-slate-300 border border-slate-700/50">
        {dimensions.width} x {dimensions.height} ({config.aspectRatio})
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
