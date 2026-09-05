'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import { 
  VideoCanvas, 
  VideoCanvasConfig, 
  VideoCanvasRef 
} from '@/components/VideoCanvas';
import { StyleConfigPanel } from '@/components/StyleConfigPanel';
import { AudioTrimModal, formatDuration } from '@/components/AudioTrimModal';
import { describeGpu } from '@/lib/gpuInfo';
import type { ExportHealth } from '@/lib/exportHealth';
import type { ExportPlan } from '@/lib/exportPresets';
import { createBooleanPreference } from '@/lib/uiPreference';

/** Module scope, so every render subscribes to the same store. */
const ripplePreference = createBooleanPreference('qc-ripple-edits', true);

/**
 * Whether to show tools that only mean something next to this repository.
 *
 * `npm run dev` yes, `npm run build` no. `NEXT_PUBLIC_DEV_TOOLS=1` forces them
 * on in a build, which is what to set if you want the ground-truth loop from a
 * production server you host yourself.
 */
const SHOW_DEV_TOOLS =
  process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEV_TOOLS === '1';
import { PaletteSwitcher } from '@/components/PaletteSwitcher';
import { HealthStrip } from '@/components/HealthStrip';
import { OverflowMenu, OverflowItem } from '@/components/OverflowMenu';
import { Timeline } from '@/components/Timeline';
import { Inspector } from '@/components/Inspector';
import { segmentAt } from '@/lib/verseEdits';
import { Button } from '@/components/Button';
import { trimTimeline } from '@/lib/matchTimeline';
import {
  backgroundSegments, moveSegmentTo, resizeSegment, rememberMediaName,
  BackgroundSegment, BACKGROUND_MODES, BackgroundMode
} from '@/lib/backgroundTimeline';
import { decodeAudioFile, buildTrimmedFile, type TrimResult } from '@/lib/audioTrim';
import { GpuExportModal } from '@/components/GpuExportModal';
import { SavedProjectsDrawer } from '@/components/SavedProjectsDrawer';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import { groundTruthFile, groundTruthFileName } from '@/lib/groundTruth';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { useTransportKeys } from '@/hooks/useTransportKeys';
import { useVideoExport } from '@/hooks/useVideoExport';
import { buildProjectPayload, projectTitle } from '@/lib/projectPayload';
import {
  buildDraft, clearDraft, forgetRecoverableDraft, recoverableDraft, serverRecoverableDraft, subscribeToDraft
} from '@/lib/draftStore';
import { useAutoSaveDraft } from '@/hooks/useAutoSaveDraft';
import { useTimelineEditing } from '@/hooks/useTimelineEditing';
import { DEFAULT_TRANSLATION_ID, missingTranslationIds } from '@/lib/translations';
import { useEditHistory, StudioSnapshot } from '@/hooks/useEditHistory';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useLocale } from '@/components/LocaleProvider';
import { 
  SURAHS_LIST,
  RECITERS,
  SAMPLE_PROJECTS,
  BACKGROUND_VIDEOS,
  VerseData
} from '@/lib/quranData';
import { 
  Sparkles, 
  Save, 
  FolderOpen, 
  Sliders, 
  Clock, 
  Upload, 
  Music, 
  BookOpen, 
  Check, 
  Video,
  Server,
  Scissors,
  AlertTriangle,
  Loader2,
  Film,
  ChevronDown,
  ClipboardCheck,
  Undo2,
  Redo2,
  Keyboard
} from 'lucide-react';

export default function VideoCreatorPage() {
  const { locale, t } = useLocale();

  // Quran & Audio Selection State
  const [selectedSurah, setSelectedSurah] = useState<number>(1);
  const [ayahStart, setAyahStart] = useState<number>(1);
  const [ayahEnd, setAyahEnd] = useState<number>(7);
  const [ayahStartInput, setAyahStartInput] = useState<string>('1');
  const [ayahEndInput, setAyahEndInput] = useState<string>('7');
  const [selectedReciter, setSelectedReciter] = useState<string>('sudais');
  const [customAudioUrl, setCustomAudioUrl] = useState<string | null>(null);
  const [customAudioName, setCustomAudioName] = useState<string>('');
  const [customAudioFile, setCustomAudioFile] = useState<File | null>(null);
  /** Measured from the uploaded file itself — see `measureAudioDuration`. */
  const [customAudioDuration, setCustomAudioDuration] = useState<number>(0);
  /**
   * Which part of the *original* file the current audio came from, or null
   * when nothing has been trimmed.
   *
   * Trimming is destructive here -- the clip is re-encoded and the original is
   * dropped -- so after two trims the studio would otherwise have no idea that
   * "0s" now means 34s into the file the user still has on disk. Accumulated
   * in original-file time so ground truth stays reproducible from that file.
   */
  const [trimWindow, setTrimWindow] = useState<{ start: number; end: number } | null>(null);
  /**
   * Whether moving a segment's end carries everything after it along.
   *
   * On by default, which is how the timeline has always behaved -- one drag
   * re-seats the rest instead of twenty. Off is for fixing a single boundary,
   * where carrying the rest along is exactly the problem: it undoes gaps as
   * fast as you make them. Remembered per browser like the palette, because it
   * is a way of working rather than a property of a project.
   */
  const rippleEdits = useSyncExternalStore(
    ripplePreference.subscribe,
    ripplePreference.get,
    ripplePreference.getServerSnapshot
  );
  const toggleRippleEdits = () => ripplePreference.set(!rippleEdits);
  const [showTrimModal, setShowTrimModal] = useState(false);
  /** Set when the upload was a video file, so its footage can double as the background. */
  const [uploadIsVideo, setUploadIsVideo] = useState(false);
  const [useVideoAsBackground, setUseVideoAsBackground] = useState(true);
  /** Blob URL of the original video, kept whole even after the audio is trimmed. */
  const [videoBgUrl, setVideoBgUrl] = useState<string | null>(null);
  /** Seconds trimmed off the front of the audio that `videoBgUrl` still contains. */
  const [videoBgOffset, setVideoBgOffset] = useState(0);
  /**
   * The banner under the upload box: what happened, and how it should read.
   *
   * The tone used to be guessed by searching the message for "fail" and "not
   * configured". That cannot survive translation -- and it was already fragile
   * in English -- so whoever sets the message now also says what kind it is.
   */
  const [matchStatus, setMatchStatus] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [isMatching, setIsMatching] = useState<boolean>(false);
  const [matchProvider, setMatchProvider] = useState<'gemini' | 'align'>('align');
  const [providerStatus, setProviderStatus] = useState<{
    gemini: { configured: boolean };
    align: {
      configured: boolean;
      serviceUrl: string;
      canAutoDetectRange?: boolean;
      alignReady?: boolean;
      alignError?: string | null;
    };
  } | null>(null);

  // Loaded Surah / Verse Data
  const [surahNameArabic, setSurahNameArabic] = useState<string>('الفاتحة');
  const [surahNameEnglish, setSurahNameEnglish] = useState<string>('Al-Fatihah');
  const [audioUrl, setAudioUrl] = useState<string>('https://server11.mp3quran.net/download/sds/001.mp3');
  const { verses, setVerses, selectedIndex, setSelectedIndex, edit } = useTimelineEditing(SAMPLE_PROJECTS[0].verses);
  /**
   * The studio opens with Al-Fatihah already in the timeline so the preview is
   * not blank on a first visit. That is useful, but it is indistinguishable
   * from a project you loaded yourself -- so say which it is until you replace
   * it. Cleared as soon as anything real arrives.
   */
  const [isSampleProject, setIsSampleProject] = useState<boolean>(true);

  // Audio Playback & Web Audio API
  // Transport, clock and Web Audio graph. Destructured to the names the rest of
  // this component already used, so only the ownership moved.
  const {
    elementRef: audioElementRef,
    analyserNode: audioAnalyserNode,
    isPlaying, setIsPlaying,
    currentTime, setCurrentTime,
    duration: audioDuration,
    setDuration: setAudioDuration,
    isMuted, setIsMuted,
    volume, setVolume,
    error: audioError,
    setError: setAudioError,
    togglePlayPause,
    seek: handleSeek,
    queueSeek,
    applyPendingSeek,
    onTimeUpdate: handleTimeUpdate,
    onLoadedMetadata: handleLoadedMetadata,
  } = useAudioPlayback();
  
  const [isLoadingVerses, setIsLoadingVerses] = useState<boolean>(false);
  const [loadResult, setLoadResult] = useState<{
    ok: boolean;
    count?: number;
    /** 'measured' timings came from the recording; 'estimated' ones were guessed from text length. */
    timingSource?: 'measured' | 'estimated';
    /** Set when the playhead was moved to the first ayah of the range. */
    seeked?: boolean;
    /**
     * Set when an uploaded file is still the audio being played. The ayah times
     * that just arrived belong to the reciter's recording, not to that file, so
     * they cannot be trusted against it.
     */
    againstUpload?: boolean;
  } | null>(null);
  /**
   * Where in the new recording playback should resume once its metadata
   * arrives. A range that starts past ayah 1 starts minutes into the chapter
   * file, and `currentTime` cannot be set before the browser knows the
   * duration. Stamped with the url it belongs to so a seek meant for one
   * recording is never applied to the next.
   */

  // UI Tabs & Drawer
  /** Which ayah the timeline and inspector are focused on. */
  const [inspectorTab, setInspectorTab] = useState<'ayah' | 'style'>('ayah');
  const [isProjectsDrawerOpen, setIsProjectsDrawerOpen] = useState<boolean>(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState<boolean>(false);

  // Video Export & Progress State
  const {
    canvasRef,
    isExporting,
    progress: exportProgress,
    speed: exportSpeed,
    willEncodeOffline,
    cancel: cancelExport,
    isModalOpen: isExportModalOpen,
    setIsModalOpen: setIsExportModalOpen,
    start: startExport,
  } = useVideoExport();
  /** `detail` carries why a save failed, so the reason is one hover away rather than console-only. */
  const [saveStatus, setSaveStatus] = useState<{ text: string; kind: 'pending' | 'ok' | 'error'; detail?: string } | null>(null);
  // Which background block the panel acts on, so picking one in the lane and
  // removing it in the Style panel refer to the same block.
  const [selectedBackground, setSelectedBackground] = useState<number | null>(null);

  // Studio Canvas Configuration
  const [canvasConfig, setCanvasConfig] = useState<VideoCanvasConfig>({
    aspectRatio: '9:16',
    fontArabic: 'Scheherazade New',
    fontTranslation: 'Inter',
    arabicFontSize: 38,
    translationFontSize: 38,
    ayahNumberFontSize: 40,
    textAlignment: 'center',
    textColor: '#ffffff',
    accentColor: '#b8c7dc',
    translationColor: '#d5dfec',
    textShadow: true,
    showTranslation: true,
    // The translation every project has always shown. Choosing others adds to
    // this list; the first one is still the text `verse.translation` holds.
    translationIds: [DEFAULT_TRANSLATION_ID],
    showWaveform: true,
    showSurahBadge: true,
    surahBadgeText: '',
    surahBadgeSubtitleText: '',
    bgType: 'video',
    bgUrl: 'https://videos.pexels.com/video-files/18953366/18953366-hd_1080_1920_30fps.mp4',
    bgUrls: [],
    bgMode: 'single',
    bgSegments: [],
    bgCycleSeconds: 5,
    bgOverlayOpacity: 40,
    bgBlur: 0,
    cardBgOpacity: 30,
    cardBorder: true,
    watermarkText: '@QuranClipper',
    watermarkPosition: 'bottom-right',
    fps: 60,
    gpuAccelerated: true
  });

  /**
   * Undo and redo over the project.
   *
   * Split, merge and delete are all easy to regret, and until now the only way
   * back from one was to notice immediately and rebuild it by hand. The history
   * watches the timeline and the styling config; restoring hands the very same
   * state objects back, so nothing here has to be told which edit happened.
   */
  const restoreSnapshot = useCallback((snapshot: StudioSnapshot<VideoCanvasConfig>) => {
    setVerses(snapshot.verses);
    setSelectedIndex(snapshot.selectedIndex);
    setCanvasConfig(snapshot.config);
    // A block index is meaningless against a lane that may have just changed
    // under it, and the panel would act on whatever now sits at that position.
    setSelectedBackground(null);
  }, [setVerses, setSelectedIndex]);

  const history = useEditHistory({
    verses,
    selectedIndex,
    config: canvasConfig,
    restore: restoreSnapshot
  });

  /**
   * The draft, rebuilt only when something that belongs in it changes.
   *
   * Identity is the whole point: the page re-renders several times a second
   * while the audio plays, and the auto-save waits for the draft to stop
   * changing before writing. A new object every render would postpone that
   * write forever.
   *
   * Nothing is written for the seeded sample -- it is not the user's work, and
   * offering it back next visit would be inventing a draft they never made.
   */
  const draft = useMemo(
    () =>
      isSampleProject || verses.length === 0
        ? null
        : buildDraft({
            surahNumber: selectedSurah,
            surahNameArabic,
            surahNameEnglish,
            ayahStart,
            ayahEnd,
            reciterId: selectedReciter,
            audioUrl,
            audioUploadName: customAudioName,
            verses,
            config: canvasConfig as unknown as Record<string, unknown>
          }),
    [
      isSampleProject, verses, canvasConfig, selectedSurah, surahNameArabic, surahNameEnglish,
      ayahStart, ayahEnd, selectedReciter, audioUrl, customAudioName
    ]
  );
  const draftSavedAt = useAutoSaveDraft(draft);

  /**
   * A draft found from a previous visit, until it is restored or discarded.
   *
   * Never applied on its own: waking up to someone else's timeline -- your own
   * from two days ago -- in place of the studio you expected is worse than
   * losing it. The banner says what it is and both answers are one click.
   */
  const pendingDraft = useSyncExternalStore(
    subscribeToDraft,
    recoverableDraft,
    serverRecoverableDraft
  );

  const handleRestoreDraft = () => {
    const found = pendingDraft;
    if (!found) return;
    setVerses(found.verses);
    setSelectedIndex(0);
    // Merged rather than replaced: a styling knob added since the draft was
    // written keeps its default instead of arriving as `undefined`.
    setCanvasConfig(prev => ({ ...prev, ...(found.config as Partial<VideoCanvasConfig>) }));
    setSelectedSurah(found.surahNumber);
    if (found.surahNameArabic) setSurahNameArabic(found.surahNameArabic);
    if (found.surahNameEnglish) setSurahNameEnglish(found.surahNameEnglish);
    setAyahStart(found.ayahStart);
    setAyahEnd(found.ayahEnd);
    setAyahStartInput(String(found.ayahStart));
    setAyahEndInput(String(found.ayahEnd));
    if (found.reciterId) setSelectedReciter(found.reciterId);
    // An uploaded recitation cannot be reopened for them; the banner said so,
    // and whatever is loaded now is left alone rather than pointed at nothing.
    if (found.audioUrl) setAudioUrl(found.audioUrl);
    setIsSampleProject(false);
    // The work is in the studio now; auto-save writes over the stored copy.
    forgetRecoverableDraft();
    setMatchStatus({ text: t.draft.restored, tone: 'info' });
  };

  const handleDiscardDraft = () => clearDraft();

  const selectedReciterMeta = RECITERS.find(r => r.id === selectedReciter) || RECITERS[0];

  const commitAyahRangeInput = (field: 'start' | 'end') => {
    const maxAyah = currentSurahObj.numberOfAyahs;
    if (field === 'start') {
      const parsed = parseInt(ayahStartInput, 10);
      const nextStart = Number.isFinite(parsed) ? Math.min(maxAyah, Math.max(1, parsed)) : ayahStart;
      setAyahStart(nextStart);
      if (ayahEnd < nextStart) setAyahEnd(nextStart);
      setAyahStartInput(String(nextStart));
      setAyahEndInput(String(Math.max(ayahEnd, nextStart)));
    } else {
      const parsed = parseInt(ayahEndInput, 10);
      const nextEnd = Number.isFinite(parsed) ? Math.min(maxAyah, Math.max(ayahStart, parsed)) : ayahEnd;
      setAyahEnd(nextEnd);
      setAyahEndInput(String(nextEnd));
    }
  };

  // Fetch Verses on Surah / Reciter / Ayah change
  const handleLoadSurahVerses = async () => {
    setIsLoadingVerses(true);
    setLoadResult(null);
    try {
      const res = await fetch(`/api/quran/verses?surah=${selectedSurah}&start=${ayahStart}&end=${ayahEnd}&reciter=${selectedReciter}`);
      if (!res.ok) {
        // A failed load used to be swallowed: `if (res.ok)` with no else and an
        // empty catch, so a broken fetch looked exactly like a successful one.
        setLoadResult({ ok: false });
        return;
      }
      const data = await res.json();
      setSurahNameArabic(data.surahNameArabic || 'الفاتحة');
      setSurahNameEnglish(data.surahNameEnglish || 'Al-Fatihah');
      if (!customAudioUrl) {
        setAudioUrl(data.audioUrl);
      }
      const loaded = data.verses || [];
      setVerses(loaded);
      setIsSampleProject(false);
      setSelectedIndex(0);
      // Measured timings are absolute positions in the whole chapter file, so
      // ayah 5 of Ya-Sin genuinely begins at 0:14 and ayah 255 of Al-Baqarah at
      // 1:13:42. Start the playhead there rather than at 0:00, which would play
      // ayah 1 while the canvas showed the ayah the user asked for.
      const firstStart = loaded[0]?.startTime ?? 0;
      const willSeek = !customAudioUrl && !!data.audioUrl && firstStart > 0;
      if (willSeek) {
        queueSeek(data.audioUrl, firstStart);
      }
      // The response is usually cached, so it returns faster than a frame and
      // the spinner never paints -- leaving the click with no visible result at
      // all, since the verses themselves appear on a different step. Confirm
      // what arrived and point at where it went.
      setLoadResult({
        ok: true,
        count: loaded.length,
        timingSource: data.timingSource === 'measured' ? 'measured' : 'estimated',
        seeked: willSeek,
        againstUpload: !!customAudioUrl
      });

      // Loading and aligning are one action, not two. Even the reciters with
      // published timings only get one caption per ayah from them, however
      // long the ayah, so this is what turns a loaded passage into a timeline
      // worth editing. Against an upload it is the upload that should be
      // aligned, not the reciter's recording.
      if (!customAudioUrl && data.audioUrl && loaded.length) {
        const totalSeconds = Math.max(...loaded.map((v: VerseData) => v.endTime));
        await alignLoadedReciter(loaded, data.audioUrl, totalSeconds);
      }
    } catch {
      setLoadResult({ ok: false });
    } finally {
      setIsLoadingVerses(false);
    }
  };

  /**
   * The uploaded file's true length, read before anything else uses it.
   *
   * Kept separate from `audioDuration`, which tracks whatever the player
   * currently holds and is only updated on the audio element's
   * `loadedmetadata`. Auto-match can be clicked before that fires, which would
   * otherwise send the *previous* audio's length to the server — and the
   * server clamps the timeline to whatever it is told.
   */
  const measureAudioDuration = (url: string): Promise<number> =>
    new Promise(resolve => {
      const probe = new Audio();
      // Resolve exactly once, and always: a codec the browser half-supports can
      // fire neither `loadedmetadata` nor `error`, and an un-resolved promise
      // here would strand the upload handler with the UI mid-update.
      let settled = false;
      const finish = (value: number) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = setTimeout(() => finish(0), 10_000);
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        clearTimeout(timer);
        finish(Number.isFinite(probe.duration) ? probe.duration : 0);
      };
      probe.onerror = () => {
        clearTimeout(timer);
        finish(0);
      };
      probe.src = url;
    });

  /** True for a video container. Checked by extension too, because some browsers
   *  hand over an empty or `application/octet-stream` type for `.mkv`/`.mov`. */
  const isVideoFile = (file: File) =>
    file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(file.name);

  // Handle Custom Audio / Video File Upload
  const handleCustomAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const video = isVideoFile(file);
      setCustomAudioUrl(url);
      setCustomAudioName(file.name);
      setCustomAudioFile(file);
      setUploadIsVideo(video);
      // A fresh upload starts un-trimmed, so the video and its audio share a
      // timeline until a trim introduces an offset.
      setVideoBgOffset(0);
      setTrimWindow(null);
      setVideoBgUrl(video ? url : null);
      // The object url says nothing about the file behind it, so the timeline
      // would label this block "Uploaded clip" like every other upload.
      if (video) rememberMediaName(url, file.name);
      if (video && useVideoAsBackground) {
        setCanvasConfig(prev => ({ ...prev, bgType: 'video', bgUrl: url }));
      }
      setMatchStatus({
        text: video ? t.match.videoUploaded : t.match.audioUploaded,
        tone: 'info'
      });
      setAudioUrl(url);
      if (audioElementRef.current) {
        audioElementRef.current.src = url;
        audioElementRef.current.load();
      }
      // Measured last, so a slow or unreadable file delays only this value and
      // not the rest of the upload. Auto-match simply omits the duration if it
      // isn't ready, which costs the clamp rather than the whole request.
      const measured = await measureAudioDuration(url);
      setCustomAudioDuration(measured);
      if (measured > 0) setAudioDuration(measured);
    }
  };

  /**
   * Replaces the uploaded audio with a trimmed clip.
   *
   * Works identically whether the file hasn't been matched yet (no verses to
   * adjust -- the filter/map below is a no-op on whatever's currently showing)
   * or already has a timeline from AI/manual matching, in which case that
   * timeline is clipped and rebased to the new clip's start alongside it.
   * One "Trim Audio" control therefore covers both "before analysis" and
   * "after analysis" without needing to know which situation it's in.
   */
  const handleApplyTrim = (result: TrimResult & { trimStart: number; trimEnd: number }) => {
    // Only revoke the *audio* URL. When the source was a video, `videoBgUrl`
    // points at the same blob and the background still needs it -- revoking
    // here would blank the canvas the moment anyone trims a video.
    if (customAudioUrl?.startsWith('blob:') && customAudioUrl !== videoBgUrl) {
      URL.revokeObjectURL(customAudioUrl);
    }
    setCustomAudioFile(result.file);
    setCustomAudioUrl(result.url);
    setCustomAudioName(result.file.name);
    setCustomAudioDuration(result.duration);
    setAudioUrl(result.url);
    setAudioDuration(result.duration);
    setVerses(prev => trimTimeline(prev, result.trimStart, result.trimEnd));
    setCurrentTime(0);
    // Trimming re-encodes audio only, so the background video is still the full
    // original. Accumulate how far into it the new clip now starts, and the
    // canvas keeps the two lined up rather than losing the footage.
    setVideoBgOffset(prev => prev + result.trimStart);
    // Compounding, not replacing: a second trim's 0s is the first trim's start.
    setTrimWindow(prev => {
      const base = prev ? prev.start : 0;
      return { start: base + result.trimStart, end: base + result.trimEnd };
    });
    if (audioElementRef.current) {
      audioElementRef.current.src = result.url;
      audioElementRef.current.currentTime = 0;
      audioElementRef.current.load();
    }
    setMatchStatus({ text: t.match.trimmed(formatDuration(result.duration)), tone: 'info' });
    setShowTrimModal(false);
  };

  /**
   * The trim dialog's edit, applied from the timeline.
   *
   * Same decode, same slice, same `handleApplyTrim` -- the only difference is
   * where the two numbers came from. Decoding here rather than holding a buffer
   * open costs a second on a long file and keeps exactly one copy of the audio
   * in memory the rest of the time.
   */
  const handleTrimRange = async (start: number, end: number) => {
    if (!customAudioFile || !(end > start)) return;
    setMatchStatus({ text: t.match.trimmingRange, tone: 'info' });
    try {
      const buffer = await decodeAudioFile(customAudioFile);
      const result = buildTrimmedFile(buffer, start, end, customAudioFile.name);
      handleApplyTrim({ ...result, trimStart: start, trimEnd: end });
    } catch {
      setMatchStatus({ text: t.match.trimRangeFailed, tone: 'error' });
    }
  };

  /**
   * The address the *sidecar* should fetch, given what the player is using.
   *
   * A measured reciter timeline plays through `/api/audio/proxy`, which is a
   * path on this app and means nothing to another process. The upstream URL is
   * sitting in its query string.
   */
  const upstreamAudioUrl = (url: string): string => {
    if (!url) return '';
    if (/^https:\/\//.test(url)) return url;
    const match = url.match(/[?&]url=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  };

  /**
   * Longest passage worth sending for alignment, in seconds.
   *
   * Alignment cost grows with the square of the recording, and the sidecar
   * refuses anything over its own memory budget. Catching it here means saying
   * "pick fewer ayahs" before a minute of fetching rather than after.
   */
  const MAX_ALIGN_SPAN_SEC = 2400;

  const runAutoMatch = async (
    source: { kind: 'file'; file: File } | { kind: 'url'; url: string; start: number; end: number },
    /**
     * Vetoes a result before it replaces the timeline. Used by the automatic
     * pass after Load, which must never leave someone worse off than the
     * estimate it was improving on.
     */
    accept?: (verses: VerseData[]) => string | null
  ) => {
    setIsMatching(true);
    setMatchStatus({
      text: matchProvider === 'align' ? t.match.aligning : t.match.sendingToGemini,
      tone: 'info'
    });

    const formData = new FormData();
    if (source.kind === 'file') {
      formData.append('audio', source.file);
    } else {
      formData.append('audioUrl', source.url);
      formData.append('windowStart', String(source.start));
      formData.append('windowEnd', String(source.end));
    }
    formData.append('surah', String(selectedSurah));
    formData.append('start', String(ayahStart));
    formData.append('end', String(ayahEnd));
    formData.append('reciter', selectedReciter);
    formData.append('provider', matchProvider);
    // Measured from this exact file at upload time, not read off the player.
    // Gemini only estimates duration -- on the test clip it reported 108s for a
    // 68.5s file -- and the server has no decode of its own on that path, so
    // without this the timeline runs past the end of the audio.
    if (source.kind === 'file' && customAudioDuration > 0) {
      formData.append('audioDuration', String(customAudioDuration));
    }

    try {
      const res = await fetch('/api/audio/match', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        // An upstream reason is passed through as it came: it names a key, a
        // status code or a service, and translating it would make it
        // unsearchable.
        setMatchStatus({ text: data?.error || t.match.notConfigured, tone: 'error' });
        setMobileSurface('preview');
        setIsMatching(false);
        return;
      }

      const rejection = accept?.(data.verses || []);
      if (rejection) {
        setMatchStatus({ text: rejection, tone: 'error' });
        setMobileSurface('preview');
        setIsMatching(false);
        return;
      }

      if (data.surahNameArabic) setSurahNameArabic(data.surahNameArabic);
      if (data.surahNameEnglish) setSurahNameEnglish(data.surahNameEnglish);
      if (typeof data.surahNumber === 'number') setSelectedSurah(data.surahNumber);
      if (typeof data.ayahStart === 'number') {
        setAyahStart(data.ayahStart);
        setAyahStartInput(String(data.ayahStart));
      }
      if (typeof data.ayahEnd === 'number') {
        setAyahEnd(data.ayahEnd);
        setAyahEndInput(String(data.ayahEnd));
      }
      if (typeof data.audioDuration === 'number') setAudioDuration(data.audioDuration);
      setVerses(data.verses || verses);
      setIsSampleProject(false);
      const providerLabel = data.provider === 'align' ? 'Forced alignment' : 'Gemini';
      // Kept user-facing and short: what was found, and what to do next. The
      // provider name, model, phrase counts and acoustic scores are diagnostics
      // -- they go to the console, not to someone making a video.
      console.log(`[match] ${providerLabel} • confidence ${(data.confidence ?? 0).toFixed(3)} • ${data.notes || ''}`);
      const detectedLabel =
        data.timelineTitle || data.surahNameEnglish || t.match.fallbackSurahLabel(data.surahNumber);
      // A forced-aligned timeline looks equally confident whether or not the
      // range is right -- the acoustic score can't tell those apart (see
      // README.md). So when the range wasn't the user's own choice, ask them to
      // check it explicitly rather than implying the match verified itself.
      const confirmRange = data.provider === 'align';
      setMatchStatus({
        text:
          (data.warning ? `⚠ ${data.warning} ` : '') +
          t.match.detected(detectedLabel, (data.verses || []).length) +
          (confirmRange ? t.match.confirmRange : t.match.reviewTimings),
        tone: 'info'
      });
      setMobileSurface('preview');
      setIsMatching(false);
    } catch {
      setMatchStatus({ text: t.match.failed, tone: 'error' });
      setMobileSurface('preview');
      setIsMatching(false);
    }
  };

  const handleAutoMatchUploadedAudio = () => {
    if (!customAudioFile) {
      setMatchStatus({ text: t.match.needUpload, tone: 'error' });
      return;
    }
    void runAutoMatch({ kind: 'file', file: customAudioFile });
  };

  /**
   * Align a built-in reciter's recording, instead of estimating its boundaries.
   *
   * Loading a reciter gives a timeline either way, but for the three reciters
   * quran.com publishes no timings for it is a guess from average pace, and
   * even a measured one is per *ayah* -- one caption for a whole ayah, however
   * long. Alignment gives both groups the same phrase-level boundaries an
   * uploaded file gets.
   *
   * The window comes from the timeline already on screen, padded. It only has
   * to be roughly right: a phrase the reference does not account for simply
   * goes unclaimed, which is what already happens with an upload that has
   * extra audio at either end.
   */
  /**
   * The stretch of the recording to hand the aligner for a loaded passage.
   *
   * Padded generously, because for a reciter with no published timings the
   * timeline being padded is itself a guess from average pace. Padding is safe:
   * a phrase the reference does not account for simply goes unclaimed, exactly
   * as it does for an upload with extra audio at either end. Bounded, because
   * every padded second is audio that has to be fetched and read.
   */
  const alignWindowFor = (loaded: VerseData[], totalSeconds: number) => {
    const first = Math.min(...loaded.map(v => v.startTime));
    const last = Math.max(...loaded.map(v => v.endTime));
    const span = Math.max(1, last - first);
    const pad = Math.min(90, Math.max(10, span * 0.15));
    return {
      start: Math.max(0, first - pad),
      end: Math.min(totalSeconds > 0 ? totalSeconds : last + pad, last + pad),
    };
  };

  /**
   * Aligns a freshly loaded reciter passage, if the aligner is there.
   *
   * Loading and aligning are one action from the user's side -- "give me these
   * ayahs against this recitation" -- and splitting them meant the first thing
   * anyone saw was a timeline of estimates with a button asking them to fix it.
   * Takes the verses as an argument rather than reading state, because this
   * runs inside the same handler that set them and that state has not landed
   * yet.
   *
   * Gemini is deliberately not a fallback here. It needs the audio inline and a
   * reciter's file is the whole chapter -- up to 87 MB against its ~18 MB limit
   * -- so offering it would fail after a long upload rather than up front.
   */
  const alignLoadedReciter = async (loaded: VerseData[], rawUrl: string, totalSeconds: number) => {
    const url = upstreamAudioUrl(rawUrl);
    if (!url || loaded.length === 0) return;

    const { start, end } = alignWindowFor(loaded, totalSeconds);
    if (end - start > MAX_ALIGN_SPAN_SEC) {
      setMatchStatus({
        text: t.match.passageTooLong(Math.round((end - start) / 60), Math.round(MAX_ALIGN_SPAN_SEC / 60)),
        tone: 'error'
      });
      return;
    }

    // Asked before trying, so a missing sidecar is one clear sentence rather
    // than a failed upload and a stack of retries.
    const health = await fetch('/api/health', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
    const alignerUp = health?.aligner?.state === 'up' && health.aligner.ready !== false;
    if (!alignerUp) {
      setMatchStatus({ text: t.match.noAlignerOnLoad, tone: 'error' });
      return;
    }
    await runAutoMatch({ kind: 'url', url, start, end }, aligned => {
      // Alignment can swallow an ayah whose neighbours run into it -- short
      // ones especially, which is most of Al-Fatihah. Replacing a timeline
      // that had every ayah with one that has fewer is not an improvement,
      // however much better the surviving boundaries are, so the estimate
      // stands and the offer to align by hand remains.
      const asked = new Set(loaded.map(v => v.verseKey));
      const got = new Set(aligned.map(v => v.verseKey));
      const missing = [...asked].filter(key => !got.has(key));
      return missing.length
        ? t.match.alignLostAyahs(missing.length, missing.slice(0, 4).join(', '))
        : null;
    });
  };

  const handleAutoMatchReciter = () => {
    const url = upstreamAudioUrl(audioUrl);
    if (!url) {
      setMatchStatus({ text: t.match.reciterNoUrl, tone: 'error' });
      return;
    }
    if (verses.length === 0) {
      setMatchStatus({ text: t.match.needLoad, tone: 'error' });
      return;
    }
    void alignLoadedReciter(verses, audioUrl, audioDuration);
  };

  const handleManualMatchUploadedAudio = () => {
    setMatchStatus({ text: t.match.manualMode, tone: 'info' });
    setMobileSurface('preview');
  };

  // Audio Play / Pause Sync with Web Audio API Analyser

  // Check which audio-match providers are actually usable (API key set / ASR sidecar reachable).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/audio/match')
      .then(res => res.json())
      .then(data => {
        if (cancelled || !data?.providers) return;
        setProviderStatus(data.providers);
        setMatchProvider(prev => (data.providers[prev]?.configured ? prev : data.defaultProvider || prev));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Fetches the text of any translation chosen but not yet loaded.
   *
   * Keyed on the passage rather than on how the timeline was built: a timeline
   * from the aligner never went through the verses route, and a language picked
   * an hour into an edit has no load step to ride along with. What is asked for
   * is remembered, so a translation quran.com does not actually serve for this
   * surah is requested once rather than on every render that notices it missing.
   */
  const requestedTranslations = useRef<Set<string>>(new Set());
  useEffect(() => {
    const wanted = canvasConfig.translationIds || [];
    const missing = missingTranslationIds(verses, wanted);
    if (!missing.length) return;

    // A recording can cross a surah boundary, and the API is per chapter.
    const passages = new Map<number, { start: number; end: number }>();
    for (const verse of verses) {
      const [surah, ayah] = verse.verseKey.split(':').map(Number);
      if (!surah || !ayah) continue;
      const found = passages.get(surah);
      if (!found) passages.set(surah, { start: ayah, end: ayah });
      else {
        found.start = Math.min(found.start, ayah);
        found.end = Math.max(found.end, ayah);
      }
    }

    const jobs: { surah: number; start: number; end: number; ids: string[] }[] = [];
    for (const [surah, range] of passages) {
      const ids = missing.filter(id => !requestedTranslations.current.has(`${surah}:${id}`));
      if (!ids.length) continue;
      ids.forEach(id => requestedTranslations.current.add(`${surah}:${id}`));
      jobs.push({ surah, ...range, ids });
    }
    if (!jobs.length) return;

    let cancelled = false;
    void (async () => {
      const arrived: Record<string, Record<string, string>> = {};
      for (const job of jobs) {
        try {
          const res = await fetch(
            `/api/quran/translation?surah=${job.surah}&start=${job.start}&end=${job.end}&ids=${job.ids.join(',')}`
          );
          if (!res.ok) continue;
          const data = await res.json();
          for (const [key, texts] of Object.entries(data?.verses || {})) {
            arrived[key] = { ...arrived[key], ...(texts as Record<string, string>) };
          }
        } catch {
          // Offline, or the resource is gone. The card shows what it has.
        }
      }
      if (cancelled || !Object.keys(arrived).length) return;
      setVerses(prev =>
        prev.map(verse => {
          const extra = arrived[verse.verseKey];
          return extra ? { ...verse, translations: { ...verse.translations, ...extra } } : verse;
        })
      );
    })();

    return () => { cancelled = true; };
  }, [canvasConfig.translationIds, verses, setVerses]);

  /** Which ayah the playhead is currently inside. */
  const activeVerseIndex = useMemo(() => segmentAt(verses, currentTime), [verses, currentTime]);

  const handleMarkHere = useCallback(() => edit.markHere(currentTime), [edit, currentTime]);

  useTransportKeys({
    onTogglePlay: togglePlayPause,
    onMarkHere: handleMarkHere,
    onUndo: history.undo,
    onRedo: history.redo,
    onShowShortcuts: () => setIsShortcutsOpen(true)
  });


  // Covers the case where the url did not change -- reloading the same surah
  // and reciter fires no `loadedmetadata`, so the seek would never be applied.
  useEffect(() => {
    applyPendingSeek();
  }, [applyPendingSeek, verses, audioUrl]);

  // Save Project to Database
  /**
   * Writes the corrected timeline out as a ground-truth file.
   *
   * The point of the loop: segmentation quality has been measured against a
   * single clip, which made "did this change help?" unanswerable more than
   * once. Whoever is correcting captions by ear here already knows the right
   * answer for their own recording; this is what turns that into a test the
   * next change has to pass. Drop the file in `scripts/` and point
   * `eval_segments.py` at it.
   */
  const handleDownloadGroundTruth = () => {
    const contents = groundTruthFile(verses, {
      clipName: customAudioName,
      duration: customAudioDuration || audioDuration,
      trim: trimWindow,
    });
    if (!contents) return;
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = groundTruthFileName(customAudioName);
    link.click();
    // Revoking immediately can cancel the download in some browsers; a tick is
    // enough for it to have been handed over.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleSaveProject = async () => {
    setSaveStatus({ text: t.header.saving, kind: 'pending' });
    try {
      const payload = buildProjectPayload({
        surahNumber: selectedSurah,
        surahNameArabic,
        surahNameEnglish,
        ayahStart,
        ayahEnd,
        reciterId: selectedReciter,
        reciterName: RECITERS.find(r => r.id === selectedReciter)?.name || RECITERS[0]?.name || 'Abdul Rahman Al-Sudais',
        audioUrl,
        audioDurationSeconds: audioDuration,
        verses,
        config: canvasConfig as unknown as Record<string, unknown>,
      });

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        // The route falls back to in-memory storage when DATABASE_URL is unset;
        // say so rather than implying the project survived a restart.
        setSaveStatus({
          text: data?.source === 'memory' ? t.header.savedThisSession : t.header.saved,
          kind: 'ok'
        });
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        const data = await res.json().catch(() => null);
        const reason = data?.error || t.header.saveFailedStatus(res.status);
        console.error('Save failed:', reason);
        // The reason rides along on the status rather than living only in the
        // console: "Save Failed" on its own is the one thing nobody can act on,
        // and the usual cause -- a database that is not running -- is fixable in
        // one command once it is named.
        setSaveStatus({ text: t.header.saveFailed, kind: 'error', detail: reason });
        setTimeout(() => setSaveStatus(null), 8000);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error('Save failed:', reason);
      setSaveStatus({ text: t.header.saveFailed, kind: 'error', detail: reason });
      setTimeout(() => setSaveStatus(null), 8000);
    }
  };

  /**
   * Matching options, named by where the work happens.
   *
   * These used to be labelled with their implementations -- "Forced Align",
   * "Gemini + Align", "Local ASR" -- and most of them reported "Sidecar
   * unreachable", which is the vocabulary of the failing subsystem and tells
   * someone who never installed a sidecar nothing they can act on. What the
   * user is actually choosing between is running it on this machine or sending
   * the audio to Google, so the labels say that and the blurb underneath
   * carries the consequence (measured timing vs estimated). The implementation
   * name is kept on hover for anyone who does want it.
   */
  const matchOptions = [
    {
      id: 'align' as const,
      label: t.source.matcherLocal,
      technical: t.source.matcherLocalTechnical,
      Icon: Server,
      ready: !!providerStatus?.align.configured && providerStatus.align.alignReady !== false,
      status: !providerStatus
        ? t.source.matcherChecking
        : providerStatus.align.configured
          ? providerStatus.align.alignReady === false
            ? t.source.matcherHelperNeedsRestart
            : t.source.matcherReady
          : t.source.matcherHelperNotRunning,
      blurb: t.source.matcherLocalBlurb,
      fix: t.source.matcherLocalFix
    },
    {
      id: 'gemini' as const,
      label: t.source.matcherOnline,
      technical: t.source.matcherOnlineTechnical,
      Icon: Sparkles,
      ready: !!providerStatus?.gemini.configured,
      status: !providerStatus
        ? t.source.matcherChecking
        : providerStatus.gemini.configured
          ? t.source.matcherReady
          : t.source.matcherNeedsApiKey,
      blurb: t.source.matcherOnlineBlurb,
      fix: t.source.matcherOnlineFix
    }
  ];
  const selectedMatchOption = matchOptions.find(o => o.id === matchProvider) ?? matchOptions[0];

  /**
   * On a phone the panel and the preview each got half the height, which
   * served neither: the panel was too short to work in and the preview -- a
   * 9:16 video, on the one device shaped for it -- overflowed its pane by
   * about 180px. Below `md` one surface is shown at a time instead.
   */
  const [mobileSurface, setMobileSurface] = useState<'source' | 'preview' | 'inspect'>('preview');

  const headerOverflowItems: OverflowItem[] = [
    {
      key: 'saved',
      label: t.header.savedClips,
      icon: <FolderOpen className="w-4 h-4" />,
      onSelect: () => setIsProjectsDrawerOpen(true)
    },
    ...(customAudioFile
      ? [{
          key: 'trim',
          label: t.header.trimAudio,
          hint: customAudioDuration > 0 ? formatDuration(customAudioDuration) : undefined,
          icon: <Scissors className="w-4 h-4" />,
          onSelect: () => setShowTrimModal(true)
        }]
      : []),
    {
      key: 'shortcuts',
      label: t.shortcuts.open,
      icon: <Keyboard className="w-4 h-4" />,
      onSelect: () => setIsShortcutsOpen(true)
    },
    {
      key: 'save',
      label: t.header.saveProject,
      hint: saveStatus?.detail || saveStatus?.text,
      icon: <Save className="w-4 h-4" />,
      onSelect: handleSaveProject
    }
  ];


  /**
   * The stretch of audio an export should cover: the first ayah's start to the
   * last one's end.
   *
   * Not the whole file. A built-in reciter's audio is the entire chapter, so
   * exporting `audioDuration` turned a three-ayah clip from Al-Baqarah into an
   * eighty-seven minute video -- and because capture runs in real time, an
   * eighty-seven minute wait for it.
   */
  const exportRange = useMemo(() => {
    if (verses.length === 0 || !(audioDuration > 0)) {
      return { start: 0, end: audioDuration, span: audioDuration };
    }
    const start = Math.max(0, Math.min(...verses.map(v => v.startTime)));
    const end = Math.min(audioDuration, Math.max(...verses.map(v => v.endTime)));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { start: 0, end: audioDuration, span: audioDuration };
    }
    return { start, end, span: end - start };
  }, [verses, audioDuration]);

  /**
   * The passage the export actually contains, read off the timeline.
   *
   * `ayahStart`/`ayahEnd` are the *request* -- what was asked for from the
   * reciter, or what a match reported -- and the timeline drifts from them as
   * soon as it is edited: trimming drops the ayahs that fell outside the cut
   * without rewriting either number. Naming a file, or labelling a clip, from
   * the request would then describe ayahs the video does not contain. A
   * timeline spanning more than one surah has no single range to state, so that
   * falls back to the request.
   */
  const clipPassage = useMemo(() => {
    const parsed = verses
      .map(verse => (verse.verseKey || '').split(':').map(Number))
      .filter(([surah, ayah]) => Number.isFinite(surah) && Number.isFinite(ayah));
    const surahs = new Set(parsed.map(([surah]) => surah));
    if (parsed.length === 0 || surahs.size !== 1) {
      return { surahNumber: selectedSurah, start: ayahStart, end: ayahEnd };
    }
    const ayahs = parsed.map(([, ayah]) => ayah);
    return { surahNumber: parsed[0][0], start: Math.min(...ayahs), end: Math.max(...ayahs) };
  }, [verses, selectedSurah, ayahStart, ayahEnd]);

  /**
   * The background lane under the timeline: the same segments the canvas plays,
   * so clip changes are visible next to the ayahs they land on.
   */
  const verseStarts = useMemo(
    () => [...verses].sort((a, b) => a.startTime - b.startTime).map(v => v.startTime),
    [verses]
  );

  const bgSegments = useMemo(
    () => backgroundSegments(canvasConfig, verseStarts, audioDuration),
    [canvasConfig, verseStarts, audioDuration]
  );

  /**
   * The selection, derived rather than stored, so it cannot outlive the block
   * it points at. A lane that shrinks -- a block removed, or an automatic mode
   * picked, which throws the lane away entirely -- would otherwise leave the
   * index dangling past the end and the highlight sitting on nothing.
   */
  const activeBackground =
    selectedBackground !== null && selectedBackground < bgSegments.length ? selectedBackground : null;

  /**
   * Applies an edit to the background lane.
   *
   * The automatic modes have no blocks to move -- where a clip sits is derived
   * from the ayah timings or a timer. So the first drag bakes whatever is
   * currently on screen into a hand-cut lane and edits that. Picking an
   * automatic mode again in the Style panel throws the lane away.
   */
  const editBackgroundLane = useCallback(
    (mutate: (segments: BackgroundSegment[]) => BackgroundSegment[]) => {
      setCanvasConfig(cfg => {
        const base = cfg.bgMode === 'custom' && cfg.bgSegments?.length
          ? cfg.bgSegments
          : backgroundSegments(cfg, verseStarts, audioDuration);
        if (base.length === 0) return cfg;
        return { ...cfg, bgMode: 'custom' as BackgroundMode, bgSegments: mutate(base) };
      });
    },
    [verseStarts, audioDuration]
  );

  // Start Video Export Pipeline
  /**
   * What the last render was actually planned at, so the saved record can say
   * the truth rather than the 1080-or-1920 guess it used to make from the
   * aspect ratio alone.
   */
  const exportedResolution = useRef('1080x1920');

  const handleStartExport = (
    plan: ExportPlan,
    onComplete: (blob: Blob, renderMs: number, health: ExportHealth) => void
  ) => {
    exportedResolution.current = `${plan.width}x${plan.height}`;
    startExport(audioElementRef.current, { start: exportRange.start, end: exportRange.end }, plan, onComplete);
  };

  const handleSaveExportRecord = async (fileUrl: string, durationSec: number, renderMs: number) => {
    try {
      await fetch('/api/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${surahNameEnglish} GPU Clip`,
          fileUrl,
          aspectRatio: canvasConfig.aspectRatio,
          duration: Math.round(durationSec),
          resolution: exportedResolution.current,
          fps: canvasConfig.fps,
          renderTimeMs: Math.round(renderMs),
          gpuDevice: describeGpu()
        })
      });
    } catch {
      // ignore
    }
  };

  // Load project from saved projects
  const handleLoadSavedProject = (proj: any) => {
    if (!proj) return;
    setSelectedSurah(proj.surahNumber || 1);
    setAyahStart(proj.ayahStart || 1);
    setAyahEnd(proj.ayahEnd || 7);
    setAyahStartInput(String(proj.ayahStart || 1));
    setAyahEndInput(String(proj.ayahEnd || 7));
    setSurahNameArabic(proj.surahNameArabic || 'الفاتحة');
    setSurahNameEnglish(proj.surahNameEnglish || 'Al-Fatihah');
    setSelectedReciter(proj.reciterId || 'sudais');
    setAudioUrl(proj.audioUrl || 'https://server11.mp3quran.net/download/sds/001.mp3');
    setVerses(proj.versesJson || []);
    setIsSampleProject(false);

    setCanvasConfig({
      ...canvasConfig,
      aspectRatio: proj.aspectRatio || '9:16',
      fontArabic: proj.fontArabic || 'Scheherazade New',
      fontTranslation: proj.fontTranslation || 'Inter',
      arabicFontSize: proj.arabicFontSize || 38,
      translationFontSize: proj.translationFontSize || 20,
      ayahNumberFontSize: proj.ayahNumberFontSize || 34,
      textColor: proj.textColor || '#ffffff',
      accentColor: proj.accentColor || '#b8c7dc',
      translationColor: proj.translationColor || '#d5dfec',
      textAlignment: proj.textAlignment || 'center',
      textShadow: proj.textShadow ?? true,
      showTranslation: proj.showTranslation ?? true,
      showWaveform: proj.showWaveform ?? true,
      showSurahBadge: proj.showSurahBadge ?? true,
      surahBadgeText: proj.surahBadgeText || '',
      surahBadgeSubtitleText: proj.surahBadgeSubtitleText || '',
      bgType: proj.bgType || 'video',
      bgUrl: proj.bgUrl || 'https://videos.pexels.com/video-files/18953366/18953366-hd_1080_1920_30fps.mp4',
      bgUrls: Array.isArray(proj.bgUrls) ? proj.bgUrls : [],
      bgMode: BACKGROUND_MODES.includes(proj.bgMode) ? proj.bgMode : 'single',
      bgSegments: Array.isArray(proj.bgSegments) ? proj.bgSegments : [],
      bgCycleSeconds: proj.bgCycleSeconds || 5,
      bgOverlayOpacity: proj.bgOverlayOpacity ?? 40,
      bgBlur: proj.bgBlur ?? 0,
      cardBgOpacity: proj.cardBgOpacity ?? 30,
      cardBorder: proj.cardBorder ?? true,
      watermarkText: proj.watermarkText || '@QuranClipper',
      watermarkPosition: proj.watermarkPosition || 'bottom-right',
      fps: proj.fps || 60,
      gpuAccelerated: proj.gpuAccelerated ?? true
    });
  };

  const currentSurahObj = SURAHS_LIST.find(s => s.number === selectedSurah) || SURAHS_LIST[0];

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Hidden Audio Element */}
      {/* onPlay/onPause track the element rather than only our own toggle.
          Playback can start or stop by routes this component does not own --
          clicking the preview, the export pipeline, media keys -- and
          `isPlaying` decides whether SPACE plays or pauses, so a desync makes
          the key do the wrong thing. */}
      <audio
        ref={audioElementRef}
        src={audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={(e) => {
          const audio = e.currentTarget;
          const err = audio.error;
          const codes: Record<number, string> = {
            1: t.audioErrors.aborted,
            2: t.audioErrors.network,
            3: t.audioErrors.decode,
            4: t.audioErrors.unsupported,
          };
          setAudioError(codes[err?.code || 4] || t.audioErrors.unknown(err?.code || '?'));
          setIsPlaying(false);
        }}
        crossOrigin="anonymous"
      />

      <h1 className="sr-only">
        {t.header.pageTitle(surahNameEnglish, selectedSurah, ayahStart, ayahEnd)}
      </h1>

      {/* Top Navbar */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md px-4 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3">
          {/* Not a link. The studio is the only page, so the wordmark had
              nowhere to go -- and because the whole project lives in component
              state, clicking it navigated away and silently discarded unsaved
              work. */}
          <span className="flex items-baseline gap-2">
            <span className="font-display text-xl leading-none text-parchment">{t.header.wordmark}</span>
            <span className="text-[11px] uppercase tracking-[0.22em] text-gold">{t.header.wordmarkSuffix}</span>
          </span>

          {/* The reference, set the way a mushaf cites itself: surah name, then
              the ayah span. Mono keeps the numerals aligned as they change. */}
          <div className="hidden md:flex items-baseline gap-2.5 ms-3 ps-4 border-s border-slate-800">
            <span className="font-display text-base text-parchment/90">
              {locale === 'ar' ? currentSurahObj.nameArabic : surahNameEnglish}
            </span>
            <span className="font-mono text-[11px] text-gold tracking-wider" dir="ltr">
              {selectedSurah}:{ayahStart}&ndash;{ayahEnd}
            </span>
          </div>

          <HealthStrip />
        </div>

        {/* Action Controls Header.

            Below `lg` the secondary actions collapse into an overflow menu so
            the primary one keeps its place: five side-by-side controls pushed
            Export to 42% visible at 375px and made the bar scroll sideways
            with nothing to indicate it. */}
        <div className="flex items-center gap-2">
          {/* Outside the `lg` group on purpose: undoing a mis-drag is not a
              secondary action, and it is the one control that has to be there
              the moment something goes wrong. */}
          <div className="flex items-center gap-1">
            <Button
              onClick={history.undo}
              disabled={!history.canUndo}
              title={t.header.undoTitle}
              aria-label={t.header.undo}
              icon={<Undo2 className="w-3.5 h-3.5" />}
            />
            <Button
              onClick={history.redo}
              disabled={!history.canRedo}
              title={t.header.redoTitle}
              aria-label={t.header.redo}
              icon={<Redo2 className="w-3.5 h-3.5" />}
            />
          </div>

          <LanguageSwitcher />

          <div className="hidden lg:flex items-center gap-2">
            <PaletteSwitcher />

            <Button
              onClick={() => setIsShortcutsOpen(true)}
              title={t.shortcuts.openTitle}
              aria-label={t.shortcuts.dialogLabel}
              icon={<Keyboard className="w-3.5 h-3.5 text-amber-400" />}
            />

            <Button onClick={() => setIsProjectsDrawerOpen(true)} icon={<FolderOpen className="w-3.5 h-3.5 text-amber-400" />}>
              {t.header.savedClips}
            </Button>

            {/* Trimming is not a step you do once up front -- wanting to shave a
                second off the end after matching and editing is normal, and the
                timeline survives it. Keep it reachable from every step rather
                than only from the upload panel back in Quran & Reciter. */}
            {customAudioFile && (
              <Button
                onClick={() => setShowTrimModal(true)}
                title={t.header.trimAudioTitle}
                icon={<Scissors className="w-3.5 h-3.5 text-amber-400" />}
              >
                {customAudioDuration > 0
                  ? t.header.trimAudioWithLength(formatDuration(customAudioDuration))
                  : t.header.trimAudio}
              </Button>
            )}

            {/* A development tool, not a feature.

                The file it writes is only useful next to this repo's
                `gauge.sh`, and an end user who clicks it gets a text file in
                their Downloads folder that means nothing to them and never
                reaches anyone who could act on it -- there is no upload path
                and no telemetry, by design. So it is shown while developing
                and hidden in a production build. Deleting this condition is
                all it takes to put it back. */}
            {SHOW_DEV_TOOLS && (
              <Button
                onClick={handleDownloadGroundTruth}
                disabled={verses.length === 0}
                title={t.header.groundTruthTitle}
                icon={<ClipboardCheck className="w-3.5 h-3.5 text-sky-400" />}
              >
                {t.header.groundTruth}
              </Button>
            )}

            <Button
              onClick={handleSaveProject}
              title={saveStatus?.detail || t.header.saveProjectTitle}
              icon={saveStatus?.kind === 'ok' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : saveStatus?.kind === 'error' ? (
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              ) : saveStatus?.kind === 'pending' ? (
                <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5 text-amber-400" />
              )}
              className={saveStatus?.kind === 'error' ? 'text-red-300' : undefined}
            >
              {saveStatus?.text || t.header.saveProject}
            </Button>
          </div>

          <div className="lg:hidden">
            <OverflowMenu items={headerOverflowItems} />
          </div>

          <Button variant="primary" size="md" onClick={() => setIsExportModalOpen(true)} icon={<Sparkles className="w-4 h-4 fill-current" />}>
            {t.header.export}
          </Button>
        </div>
      </header>

      {/* Studio workspace.

          Three columns over one full-width timeline. The previous layout put
          the entire product -- source form, timeline and styling -- through a
          single 420px column, which is why the timeline could not show time and
          why the styling step showed four cards in a screen of empty space.
          Each surface now gets the shape its content actually needs. */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* Source */}
          <aside
            aria-label={t.surfaces.source}
            className={`w-full lg:w-[340px] shrink-0 border-e border-slate-800 bg-slate-900/60 backdrop-blur-sm flex-col overflow-hidden ${
              mobileSurface === 'source' ? 'flex' : 'hidden'
            } lg:flex`}
          >
            <h2 className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 border-b border-slate-800">
              {t.surfaces.source}
            </h2>
            <div className="flex-1 overflow-y-auto p-3">
              {pendingDraft && (
                <div className="mb-3 rounded-lg border border-lapis-bright/40 bg-lapis-bright/10 p-2.5 text-[11px] text-slate-200 flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-lapis-bright" />
                    <div className="min-w-0">
                      <p className="font-semibold">{t.draft.title}</p>
                      <p className="mt-0.5">
                        {t.draft.describe(
                          projectTitle(
                            pendingDraft.surahNameEnglish || String(pendingDraft.surahNumber),
                            pendingDraft.surahNumber,
                            pendingDraft.ayahStart,
                            pendingDraft.ayahEnd
                          ),
                          new Date(pendingDraft.savedAt).toLocaleString(locale)
                        )}
                      </p>
                      {pendingDraft.audioUploadName && (
                        <p className="mt-1 text-slate-300">
                          {t.draft.audioMissing(pendingDraft.audioUploadName)}
                        </p>
                      )}
                      {pendingDraft.droppedBackgrounds > 0 && (
                        <p className="mt-1 text-slate-300">
                          {t.draft.backgroundsMissing(pendingDraft.droppedBackgrounds)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="primary" onClick={handleRestoreDraft}>{t.draft.restore}</Button>
                    <Button onClick={handleDiscardDraft}>{t.draft.dismiss}</Button>
                  </div>
                </div>
              )}

              {draftSavedAt !== null && !pendingDraft && (
                <p
                  className="mb-3 text-[11px] text-slate-400 flex items-center gap-1.5"
                  title={t.draft.savedTitle}
                >
                  <Save className="w-3 h-3" />
                  {t.draft.savedAt(new Date(draftSavedAt).toLocaleTimeString(locale))}
                </p>
              )}

              {isSampleProject && (
                <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5 text-[11px] text-amber-200 flex items-start gap-2">
                  <BookOpen className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    <span className="font-semibold">{t.source.sampleTitle}</span> {t.source.sampleBody}
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-4 text-xs">
                {/* Workflow instructions.

                    Collapsible and closed. It took about 40% of the panel when
                    it opened by itself, pushing the controls it describes below
                    the fold -- including for the first-run visitor it was open
                    for, who cannot see the thing being described while reading
                    about it. */}
                <details
                  className="group p-3 rounded-xl bg-gradient-to-r from-amber-500/10 via-amber-600/5 to-emerald-500/10 border border-amber-500/20"
                >
                  <summary className="font-semibold text-amber-400 text-xs uppercase tracking-wider cursor-pointer list-none flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded">
                    <span>{t.source.howItWorks}</span>
                    <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
                  </summary>
                  <ol className="list-decimal list-inside text-slate-300 space-y-1 text-[11px] leading-relaxed mt-1.5">
                    <li><strong>{t.source.step1Strong}</strong> {t.source.step1}</li>
                    <li>{t.source.step2Before} <strong>{t.source.step2Button}</strong>. {t.source.step2After}</li>
                    <li>
                      {t.source.step3Before}{' '}
                      <kbd className="px-1 py-0.5 bg-slate-800 text-amber-300 rounded text-[11px] font-mono">SPACE</kbd>{' '}
                      {t.source.step3Middle}{' '}
                      <kbd className="px-1 py-0.5 bg-slate-800 text-amber-300 rounded text-[11px] font-mono">B</kbd>{' '}
                      {t.source.step3After}
                    </li>
                    <li><strong>{t.source.step4Strong}</strong> {t.source.step4}</li>
                    <li>{t.source.step5}</li>
                    <li>{t.source.step6Before} <strong>{t.source.step6Strong}</strong>{t.source.step6After}</li>
                  </ol>
                  <p className="text-[11px] text-slate-400 mt-2">
                    {t.source.howItWorksNoteBefore} <strong>{t.source.howItWorksNoteTimed}</strong>{' '}
                    {t.source.howItWorksNoteMiddle} <strong>{t.source.howItWorksNoteUploaded}</strong>{' '}
                    {t.source.howItWorksNoteEnd}
                  </p>
                </details>

                {/* Upload first.

                    The two ways in are "bring your own recording" and "use a
                    built-in reciter", and the upload is the one that produces a
                    real, matched timeline -- it was below three other controls
                    that only matter to the other path. */}
                {/* Upload Custom Audio */}
                <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800">
                  <label htmlFor="recitation-upload" className="font-semibold text-slate-200 block mb-1 flex items-center gap-1.5">
                    <Music className="w-3.5 h-3.5 text-amber-400" />
                    <span>{t.source.uploadLabel}</span>
                  </label>
                  <p className="text-[11px] text-slate-400 mb-2">{t.source.uploadHelp}</p>

                  {/* AI Matcher Provider */}
                  <div className="mb-3">
                    <label id="matcher-label" className="text-[11px] font-semibold text-slate-400 block mb-1.5">{t.source.matcherLabel}</label>
                    <div role="radiogroup" aria-labelledby="matcher-label" className="grid grid-cols-2 gap-2">
                      {matchOptions.map(opt => {
                        const selected = matchProvider === opt.id;
                        return (
                          <button
                            key={opt.id}
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setMatchProvider(opt.id)}
                            title={t.source.matcherUses(opt.technical)}
                            className={`py-2 px-2.5 rounded-lg border text-start flex items-center gap-1.5 transition-all ${
                              selected
                                ? 'bg-amber-500/15 border-amber-500 text-slate-100 ring-1 ring-amber-500/40'
                                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                            }`}
                          >
                            <opt.Icon className={`w-3.5 h-3.5 shrink-0 ${opt.ready ? 'text-emerald-400' : 'text-slate-400'}`} />
                            <span className="flex-1 min-w-0">
                              <span className="block text-[11px] font-bold truncate">{opt.label}</span>
                              <span className={`block text-[11px] ${opt.ready ? 'text-emerald-300' : 'text-slate-300'}`}>
                                {opt.status}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1.5">{selectedMatchOption.blurb}</p>
                    {!selectedMatchOption.ready && selectedMatchOption.fix && (
                      <p className="text-[11px] text-amber-400/90 mt-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 p-2">
                        {selectedMatchOption.fix}
                      </p>
                    )}
                    {/* Kept because they are diagnostics with a fix, not descriptions:
                        the blurb above already says what the option does. */}
                    {matchProvider === 'align' && providerStatus?.align.configured && providerStatus.align.canAutoDetectRange === false && (
                      <p className="text-[11px] text-amber-400/90 mt-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 p-2">
                        {t.source.matcherDetectionOffBefore}{' '}
                        <code className="font-mono">ASR_ALIGN_BACKEND</code>{' '}
                        {t.source.matcherDetectionOffAfter}
                      </p>
                    )}
                    {matchProvider === 'align' && providerStatus?.align.alignReady === false && (
                      <div className="text-[11px] text-red-300 mt-1.5 rounded-md bg-red-500/10 border border-red-500/25 p-2 space-y-1">
                        <p className="font-semibold">{t.source.matcherEngineFailedTitle}</p>
                        <p>{t.source.matcherEngineFailedBody}</p>
                        <code className="block font-mono bg-slate-950/70 rounded px-1.5 py-1 text-[11px] text-slate-300">cd asr-service &amp;&amp; hash -r &amp;&amp; ./run.sh</code>
                        {providerStatus.align.alignError && (
                          <p className="text-red-400/80 break-words">{providerStatus.align.alignError.slice(0, 180)}</p>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="relative flex items-center justify-center p-3 border-2 border-dashed border-slate-700 hover:border-amber-500/50 rounded-lg cursor-pointer bg-slate-900/60 transition-colors">
                    <input
                      type="file"
                      accept="audio/*,video/*,.mkv,.m4v,.mov"
                      onChange={handleCustomAudioUpload}
                      id="recitation-upload"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <div className="flex items-center gap-2 text-slate-300">
                      {uploadIsVideo ? <Video className="w-4 h-4 text-amber-400" /> : <Upload className="w-4 h-4 text-amber-400" />}
                      <span className="text-xs font-semibold">{customAudioName || t.source.chooseFile}</span>
                    </div>
                  </div>

                  {uploadIsVideo && videoBgUrl && (
                    <label className="mt-2 flex items-start gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={useVideoAsBackground}
                        onChange={e => {
                          const on = e.target.checked;
                          setUseVideoAsBackground(on);
                          // Turning it off restores the previously chosen background
                          // rather than leaving the canvas pointing at a video the
                          // user just opted out of.
                          setCanvasConfig(prev =>
                            on
                              ? { ...prev, bgType: 'video', bgUrl: videoBgUrl }
                              : { ...prev, bgType: 'video', bgUrl: BACKGROUND_VIDEOS[0]?.url || '' }
                          );
                        }}
                        className="mt-0.5 accent-amber-500"
                      />
                      <span>
                        {t.source.useVideoAsBackground}
                        <span className="block text-[11px] text-slate-300">
                          {t.source.useVideoAsBackgroundHelp}
                          {videoBgOffset > 0
                            ? t.source.useVideoAsBackgroundOffset(formatDuration(videoBgOffset))
                            : ''}
                          .
                        </span>
                      </span>
                    </label>
                  )}

                  {(customAudioFile || customAudioUrl) && (
                    <div className="mt-3 space-y-2">
                      <button
                        onClick={() => setShowTrimModal(true)}
                        disabled={!customAudioFile}
                        className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 font-bold rounded-lg border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Scissors className="w-3.5 h-3.5 text-amber-400" />
                        <span>
                          {customAudioDuration > 0
                            ? t.header.trimAudioWithLength(formatDuration(customAudioDuration))
                            : t.header.trimAudio}
                        </span>
                      </button>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={handleAutoMatchUploadedAudio}
                          className="py-2 px-3 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>{t.source.autoMatch}</span>
                        </button>
                        <button
                          onClick={handleManualMatchUploadedAudio}
                          className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          <span>{t.source.manualMatch}</span>
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-400">{t.source.trimHelp}</p>
                    </div>
                  )}

                  {matchStatus && (
                    <div className={`mt-2 text-[11px] rounded-lg p-3 flex items-start gap-2.5 ${
                      isMatching
                        ? 'bg-blue-500/10 border border-blue-500/30'
                        : matchStatus.tone === 'error'
                        ? 'bg-red-500/10 border border-red-500/20 text-red-300'
                        : 'bg-amber-500/10 border border-amber-500/20 text-amber-300'
                    }`}>
                      {isMatching && (
                        <span className="shrink-0 mt-0.5">
                          <span className="flex h-4 w-4 items-center justify-center">
                            <span className="animate-spin h-3.5 w-3.5 border-2 border-blue-400 border-t-transparent rounded-full"></span>
                          </span>
                        </span>
                      )}
                      <span className="flex-1">{matchStatus.text}</span>
                    </div>
                  )}
                </div>

                {/* Surah Selector */}
                <div>
                  <label htmlFor="surah-select" className="font-semibold text-slate-200 block mb-1.5">{t.source.selectSurah}</label>
                  <select
                    id="surah-select"
                    value={selectedSurah}
                    onChange={(e) => {
                      const num = parseInt(e.target.value, 10);
                      setSelectedSurah(num);
                      const s = SURAHS_LIST.find(item => item.number === num);
                      if (s) {
                        const defaultEnd = Math.min(7, s.numberOfAyahs);
                        setAyahStart(1);
                        setAyahEnd(defaultEnd);
                        setAyahStartInput('1');
                        setAyahEndInput(String(defaultEnd));
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-100 text-sm font-medium"
                  >
                    {SURAHS_LIST.map((s) => (
                      <option key={s.number} value={s.number}>
                        {t.source.surahOption(s.number, s.nameEnglish, s.nameArabic, s.numberOfAyahs)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Ayah Range */}
                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950/80 rounded-xl border border-slate-800">
                  <div>
                    <label htmlFor="ayah-start" className="text-slate-400 block mb-1">{t.source.startAyah}</label>
                    <input
                      id="ayah-start"
                      type="text"
                      inputMode="numeric"
                      value={ayahStartInput}
                      onChange={(e) => setAyahStartInput(e.target.value.replace(/[^0-9]/g, ''))}
                      onBlur={() => commitAyahRangeInput('start')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitAyahRangeInput('start');
                      }}
                      dir="ltr"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100 font-mono font-bold text-start"
                    />
                  </div>

                  <div>
                    <label htmlFor="ayah-end" className="text-slate-400 block mb-1">{t.source.endAyah}</label>
                    <input
                      id="ayah-end"
                      type="text"
                      inputMode="numeric"
                      value={ayahEndInput}
                      onChange={(e) => setAyahEndInput(e.target.value.replace(/[^0-9]/g, ''))}
                      onBlur={() => commitAyahRangeInput('end')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitAyahRangeInput('end');
                      }}
                      dir="ltr"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100 font-mono font-bold text-start"
                    />
                  </div>
                </div>

                {/* Reciter Selector */}
                <div>
                  <label id="reciter-label" className="font-semibold text-slate-200 block mb-1.5">{t.source.selectReciter}</label>
                  <div role="radiogroup" aria-labelledby="reciter-label" className="grid grid-cols-1 gap-2">
                    {RECITERS.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setSelectedReciter(r.id)}
                        className={`p-3 rounded-xl border text-start flex items-center justify-between transition-all ${
                          selectedReciter === r.id
                            ? 'bg-amber-500/15 border-amber-500 text-slate-100 ring-1 ring-amber-500/40'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div>
                          {locale === 'ar' ? (
                            <>
                              <span className="font-bold block text-slate-200 font-amiri text-base" dir="rtl">
                                {r.arabicName}
                              </span>
                              <span className="text-[11px] text-amber-400 block" dir="ltr">{r.name}</span>
                            </>
                          ) : (
                            <>
                              <span className="font-bold block text-slate-200">{r.name}</span>
                              <span className="text-[11px] text-amber-400 font-amiri block" dir="rtl">{r.arabicName}</span>
                            </>
                          )}
                        </div>
                        {/* Whether this voice has published ayah timings decides
                            whether "Load ayahs & audio" produces a real timeline
                            or one you have to set by hand, so it belongs on the
                            choice rather than in a note underneath it. */}
                        <span className="flex items-center gap-1.5">
                          {r.quranApiId > 0 && (
                            <span
                              title={t.source.reciterTimedTitle}
                              className="text-[11px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded"
                            >
                              {t.source.reciterTimed}
                            </span>
                          )}
                          <span className="text-[11px] text-slate-300 bg-slate-900 px-2 py-0.5 rounded">
                            {t.source.reciterStyles[r.style as keyof typeof t.source.reciterStyles] ?? r.style}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Load & Fetch Button */}
                <button
                  onClick={handleLoadSurahVerses}
                  disabled={isLoadingVerses}
                  className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  {isLoadingVerses ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
                  <span>{isLoadingVerses ? t.source.loadingVerses : t.source.loadVerses}</span>
                </button>

                {loadResult && (
                  <div
                    role="status"
                    className={`mt-2 rounded-lg border p-2.5 text-[11px] ${
                      !loadResult.ok
                        ? 'bg-red-500/10 border-red-500/30 text-red-200'
                        : loadResult.againstUpload
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                    }`}
                  >
                    <span className="font-semibold">
                      {loadResult.ok ? t.source.loadedCount(loadResult.count ?? 0) : t.source.loadFailed}
                    </span>
                    {loadResult.ok && (
                      <button
                        onClick={() => { setSelectedIndex(0); setMobileSurface('preview'); }}
                        className="ms-1.5 underline underline-offset-2 hover:text-emerald-100"
                      >
                        {t.source.showOnTimeline}
                      </button>
                    )}
                    {loadResult.ok && (
                      <span className="block mt-1 font-normal">
                        {loadResult.againstUpload
                          ? t.source.loadedAgainstUpload
                          : loadResult.timingSource === 'measured'
                            ? t.source.loadedMeasured(!!loadResult.seeked)
                            : t.source.loadedEstimated}
                      </span>
                    )}
                    {/* The way out of both cases. An estimated timeline is a
                        guess from average pace, and even a measured one is per
                        *ayah* -- one caption however long the ayah. Reading the
                        reciter's own recording gives the phrase-level
                        boundaries an uploaded file gets. */}
                    {loadResult.ok && !loadResult.againstUpload && (
                      <button
                        onClick={handleAutoMatchReciter}
                        disabled={isMatching}
                        title={t.match.alignReciterTitle}
                        className="mt-2 w-full py-2 px-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{isMatching ? t.match.aligning : t.match.alignReciter}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </aside>

          {/* Preview */}
          <main
            aria-label={t.surfaces.preview}
            className={`flex-1 flex-col items-center justify-center p-4 bg-slate-950 relative overflow-hidden min-w-0 ${
              mobileSurface === 'preview' ? 'flex' : 'hidden'
            } lg:flex`}
          >
          {/* Main Video Canvas WYSIWYG Renderer */}
          <div className="flex-1 w-full flex items-center justify-center relative">
            {/* Click-to-play is scoped to the video itself, not the whole
                preview area, so clicking the surrounding background doesn't
                toggle playback. */}
            {/* The preview sits inside a jadwal -- the ruled frame a mushaf
                draws around its text block -- because that is exactly what the
                preview is. Chrome only; it is not in the exported video. */}
            <div className="jadwal relative cursor-pointer" onClick={togglePlayPause} title={isPlaying ? t.common.pause : t.common.play}>
              <div className="jadwal-inner overflow-hidden">
              <VideoCanvas
                ref={canvasRef}
                config={canvasConfig}
                verses={verses}
                currentTime={currentTime}
                audioAnalyser={audioAnalyserNode}
                surahNameArabic={surahNameArabic}
                surahNameEnglish={surahNameEnglish}
                reciterName={selectedReciterMeta?.name}
                surahNumber={selectedSurah}
                ayahStart={ayahStart}
                ayahEnd={ayahEnd}
                syncBackgroundVideo={uploadIsVideo && useVideoAsBackground && canvasConfig.bgUrl === videoBgUrl}
                isPlaying={isPlaying}
                backgroundTimeOffset={videoBgOffset}
              />
              </div>
            </div>
          </div>

          {/* Audio Error Banner */}
          {audioError && (
            <div className="w-full max-w-2xl bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-2 text-center z-20">
              <p className="text-xs text-red-400 font-medium">{audioError}</p>
              <p className="text-[11px] text-slate-400 mt-1">{t.audioErrors.hint}</p>
              <button
                onClick={() => setAudioError(null)}
                className="mt-1.5 text-[11px] text-amber-400 hover:text-amber-300 underline"
              >
                {t.common.dismiss}
              </button>
            </div>
          )}
          </main>

          {/* Inspector */}
          <aside
            aria-label={t.surfaces.inspector}
            className={`w-full lg:w-[340px] shrink-0 border-s border-slate-800 bg-slate-900/60 backdrop-blur-sm flex-col overflow-hidden ${
              mobileSurface === 'inspect' ? 'flex' : 'hidden'
            } lg:flex`}
          >
            <div className="flex border-b border-slate-800 shrink-0">
              {([['ayah', t.inspector.tabAyah], ['style', t.inspector.tabStyle]] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setInspectorTab(id)}
                  aria-current={inspectorTab === id ? 'true' : undefined}
                  className={`relative flex-1 py-2.5 text-[11px] font-semibold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold focus-visible:ring-inset ${
                    inspectorTab === id ? 'text-parchment' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                  <span className={`absolute inset-x-0 bottom-0 h-px ${inspectorTab === id ? 'bg-gold' : 'bg-transparent'}`} />
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {inspectorTab === 'ayah' ? (
                <Inspector
                  verses={verses}
                  index={selectedIndex}
                  isActive={selectedIndex === activeVerseIndex}
                  onText={edit.text}
                  onVerseNumber={edit.verseNumber}
                  onToggleWord={edit.toggleWord}
                  onNudge={(edge, delta) => edit.nudge(edge, delta, audioDuration, rippleEdits)}
                  onReorder={edit.reorder}
                  onDuplicate={() => edit.duplicate(audioDuration)}
                  onDelete={edit.remove}
                  onAdd={edit.add}
                  currentTime={currentTime}
                  onSplit={() => edit.split(currentTime)}
                  onMerge={edit.merge}
                />
              ) : (
                <StyleConfigPanel
                  config={canvasConfig}
                  onChangeConfig={setCanvasConfig}
                  clipDuration={audioDuration}
                  selectedBackground={activeBackground}
                  onSelectBackground={setSelectedBackground}
                />
              )}
            </div>
          </aside>
        </div>

        <Timeline
          verses={verses}
          audioUrl={customAudioUrl || audioUrl}
          audioDuration={audioDuration}
          currentTime={currentTime}
          isPlaying={isPlaying}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          onSeek={handleSeek}
          onPlayPause={togglePlayPause}
          backgroundSegments={bgSegments}
          selectedBackground={activeBackground}
          onSelectBackground={setSelectedBackground}
          onMoveBackground={(i, start) =>
            editBackgroundLane(segs => moveSegmentTo(segs, i, start, audioDuration))}
          onResizeBackground={(i, edge, value) =>
            editBackgroundLane(segs => resizeSegment(segs, i, edge, value, audioDuration))}
          onMoveBoundary={(i, edge, value) => edit.boundary(i, edge, value, audioDuration, rippleEdits)}
          rippleEdits={rippleEdits}
          onToggleRippleEdits={toggleRippleEdits}
          onMarkHere={handleMarkHere}
          onTrim={customAudioFile ? () => setShowTrimModal(true) : undefined}
          onTrimRange={customAudioFile ? handleTrimRange : undefined}
          trimHint={customAudioDuration > 0 ? formatDuration(customAudioDuration) : undefined}
          isMuted={isMuted}
          volume={volume}
          onToggleMute={() => {
            const next = !isMuted;
            setIsMuted(next);
            if (audioElementRef.current) audioElementRef.current.muted = next;
          }}
          onVolume={v => {
            setVolume(v);
            setIsMuted(v === 0);
            if (audioElementRef.current) { audioElementRef.current.volume = v; audioElementRef.current.muted = v === 0; }
          }}
        />
      </div>

      {/* Mobile surface switch.

          Sits at the bottom because that is where a thumb rests. Three
          surfaces now, matching the three columns above -- a phone can show
          exactly one of them usefully at a time. Hidden from `lg` up, where all
          three are visible at once and the switch would mean nothing. */}
      <nav
        aria-label={t.surfaces.switchView}
        className="lg:hidden shrink-0 border-t border-slate-800 bg-slate-900/95 backdrop-blur-md p-1.5 flex gap-1.5 z-30"
      >
        {([
          ['source', t.surfaces.source, BookOpen],
          ['preview', t.surfaces.preview, Film],
          ['inspect', t.surfaces.edit, Sliders]
        ] as const).map(([id, label, Icon]) => {
          const active = mobileSurface === id;
          return (
            <button
              key={id}
              onClick={() => setMobileSurface(id)}
              aria-pressed={active}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                active ? 'bg-gold text-ink' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Export Modal */}
      <GpuExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        onStartExport={handleStartExport}
        isExporting={isExporting}
        exportProgress={exportProgress}
        exportSpeed={exportSpeed}
        fastPath={willEncodeOffline()}
        onCancelExport={cancelExport}
        surahNameEnglish={surahNameEnglish}
        surahNumber={clipPassage.surahNumber}
        ayahStart={clipPassage.start}
        ayahEnd={clipPassage.end}
        aspectRatio={canvasConfig.aspectRatio}
        onAspectRatio={(ratio: string) => setCanvasConfig(prev => ({ ...prev, aspectRatio: ratio }))}
        exportSeconds={exportRange.span}
        onSaveExportRecord={handleSaveExportRecord}
      />

      {/* Saved Projects Drawer */}
      <ShortcutsDialog isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />

      <SavedProjectsDrawer
        isOpen={isProjectsDrawerOpen}
        onClose={() => setIsProjectsDrawerOpen(false)}
        onLoadProject={handleLoadSavedProject}
      />

      {/* Audio Trim Modal */}
      {customAudioFile && customAudioUrl && (
        <AudioTrimModal
          key={`${customAudioFile.name}-${customAudioFile.size}-${customAudioFile.lastModified}`}
          isOpen={showTrimModal}
          file={customAudioFile}
          onCancel={() => setShowTrimModal(false)}
          onApply={handleApplyTrim}
        />
      )}
    </div>
  );
}
