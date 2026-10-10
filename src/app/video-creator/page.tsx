'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import { 
  VideoCanvas, 
  VideoCanvasConfig
} from '@/components/VideoCanvas';
import { StyleConfigPanel } from '@/components/StyleConfigPanel';
import { AudioTrimModal, formatDuration } from '@/components/AudioTrimModal';
import { describeGpu } from '@/lib/gpuInfo';
import { useFileDrop } from '@/hooks/useFileDrop';
import type { ExportHealth } from '@/lib/exportHealth';
import type { ExportPlan } from '@/lib/exportPresets';
import { createBooleanPreference, createNumberPreference } from '@/lib/uiPreference';
import type { ScreenBreaks } from '@/lib/forcedAligner';

/** Module scope, so every render subscribes to the same store. */
const ripplePreference = createBooleanPreference('qc-ripple-edits', true);
/** Local + QUL: time a built-in reciter from its published timings alone, without the aligner. */
const skipAlignerPreference = createBooleanPreference('qc-qul-skip-aligner', true);
/** Local matchers: fewer (-1), normal (0) or more (1) captions from the pauses inside an ayah. */
const screenBreaksPreference = createNumberPreference('qc-screen-breaks', 0, { min: -1, max: 1 });
const SCREEN_BREAKS: ScreenBreaks[] = ['fewer', 'normal', 'more'];
/**
 * The platform the frame is shaped for, as an index into `EXPORT_PRESETS`.
 * Per browser rather than per project: the project keeps its shape, and a
 * shape that no longer matches the platform falls back -- see `framePreset`.
 */
const framePreference = createNumberPreference('qc-frame-platform', 0, { min: 0, max: EXPORT_PRESETS.length - 1 });
/** Whether the preview outlines what a vertical feed's own buttons cover. */
const safeAreaPreference = createBooleanPreference('qc-safe-area', false);

/**
 * Whether to show the preview's frame-rate and paint-time readout.
 *
 * `npm run dev` yes, `npm run build` no; `NEXT_PUBLIC_DEV_TOOLS=1` forces it on
 * in a build. Ground truth is not behind this: a personal studio offers it in
 * either, a public one never (see the overflow menu).
 */
const SHOW_DEV_TOOLS =
  process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEV_TOOLS === '1';
import { PaletteList } from '@/components/PaletteSwitcher';
import { PanelTabs, type PanelTab } from '@/components/PanelTabs';
import { FrameBar, SafeAreaOverlay } from '@/components/FrameBar';
import { framePreset, coveredAreas } from '@/lib/frame';
import { EXPORT_PRESETS } from '@/lib/exportPresets';
import { isOpening } from '@/lib/openings';
import { isPhonemeProvider, phonemeTrialOffered, LAB_CHOICES, LAB_DEFAULTS, type PhonemeLab, type PhonemeProvider } from '@/lib/phonemeTrial';
import { HealthStrip } from '@/components/HealthStrip';
import { OverflowMenu, OverflowItem } from '@/components/OverflowMenu';
import { Timeline } from '@/components/Timeline';
import { Inspector } from '@/components/Inspector';
import { segmentAt, trimTimeline, fitVersesToAudio, fillFromCorpus } from '@/lib/verseEdits';
import { Button } from '@/components/Button';
import {
  backgroundSegments, moveSegmentTo, resizeSegment, rememberMediaName, trimLane,
  BackgroundSegment, BACKGROUND_MODES, BackgroundMode
} from '@/lib/backgroundTimeline';
import { asBadgeStyle, DEFAULT_BADGE_STYLE, DEFAULT_BADGE_OPACITY, NEW_PROJECT_BADGE_OPACITY } from '@/lib/surahBadge';
import { asFrameLayout, DEFAULT_FRAME_LAYOUT } from '@/lib/frameLayout';
import { asCaptionTransition, asWordEffect, asMotionSpeed, asHighlightColour, MOTION_DEFAULTS, motionForNewMatch } from '@/lib/captionMotion';
import { clipWindow, timelineView, playFrom, pastClipEnd } from '@/lib/clipWindow';
import { nextToCheck, captionChecks } from '@/lib/captionChecks';
import { decodeAudioFile, buildTrimmedFile, type TrimResult } from '@/lib/audioTrim';
import { newAudioKey, storeProjectAudio, loadProjectAudio } from '@/lib/projectAudio';
import { GpuExportModal } from '@/components/GpuExportModal';
import { SavedProjectsDrawer } from '@/components/SavedProjectsDrawer';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import { groundTruthFile, groundTruthFileName, groundTruthAudioName } from '@/lib/groundTruth';
import { groundTruthClip, saveGroundTruth } from '@/lib/groundTruthSave';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { useTransportKeys } from '@/hooks/useTransportKeys';
import { useVideoExport } from '@/hooks/useVideoExport';
import { buildProjectPayload, projectTitle } from '@/lib/projectPayload';
import {
  buildDraft, clearDraft, forgetRecoverableDraft, recoverableDraft, replaceRecoverableDraft, serverRecoverableDraft, subscribeToDraft
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
  listedReciters,
  SAMPLE_PROJECTS,
  BACKGROUND_VIDEOS,
  VerseData,
  FONT_ARABIC_DEFAULT,
  resolveArabicFont
} from '@/lib/quranData';
import { canDrawAsMushaf, withGlyphs } from '@/lib/mushafFonts';
import { needsContentSync } from '@/lib/contentSyncAge';
import { applyContentSync } from '@/lib/contentSyncCore';
import type { CorpusVerse } from '@/lib/quranCorpus';
import { hydrateLibrary, withStoredBackgrounds, withRestoredBackgrounds } from '@/lib/backgroundLibrary';
import { InspectorSkeleton } from '@/components/Skeleton';
import { OnboardingTour, type TourStep } from '@/components/OnboardingTour';
import { useGuidedTour } from '@/hooks/useGuidedTour';
import { TrimStep } from '@/components/TrimStep';
import { BatchMatchDialog } from '@/components/BatchMatchDialog';
import type { BatchResult } from '@/lib/batchMatch';
import { buildRenderForm } from '@/lib/serverRenderForm';
import { exportFileName } from '@/lib/exportName';
import { exportRangeFor } from '@/lib/exportRange';
import { saveProject } from '@/lib/projectStore';
import { newMatchTicket, watchQueue, roughWait } from '@/lib/queueWatch';
import { useStudioConfig } from '@/hooks/useStudioConfig';
import { useRegroup } from '@/hooks/useRegroup';
import { ScreenBreaksRecut } from '@/components/ScreenBreaksRecut';
import { withAspect } from '@/lib/exportQueue';

import { 
  Sparkles, 
  Save, 
  FolderOpen, 
  Sliders, 
  Clock, 
  Upload, 
  BookOpen, 
  Layers,
  Library,
  Video,
  Server,
  Scissors,
  AlertTriangle,
  Loader2,
  Film,
  ClipboardCheck,
  Undo2,
  Redo2,
  Keyboard,
  HelpCircle,
  FlaskConical
} from 'lucide-react';

/** What "Save" reports, by where the project went: see `projectStore`. */
function savedStatusText(
  source: string | undefined,
  header: { saved: string; savedThisSession: string; savedInBrowser: string }
): string {
  if (source === 'memory') return header.savedThisSession;
  if (source === 'browser') return header.savedInBrowser;
  return header.saved;
}

/**
 * What plays before a passage is loaded: the sample's own recording, through
 * the proxy like every other. Taken from the sample, whose captions were timed
 * on it: this once named mp3quran's Al-Fatihah while Load played quran.com's,
 * so the same passage opened and loaded as two different recitations.
 */
const DEFAULT_AUDIO_URL = `/api/audio/proxy?url=${encodeURIComponent(SAMPLE_PROJECTS[0].audioUrl)}`;

export default function VideoCreatorPage() {
  const { locale, t } = useLocale();
  // Personal or public, and which fonts this server has -- see `/api/studio`.
  const studio = useStudioConfig();

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
   * The name of the file the user actually has, which `customAudioName` stops
   * being the moment anything is trimmed -- it becomes `x-trimmed.wav`, and
   * then `x-trimmed-trimmed.wav`. Asking someone to find that file on disk
   * would be asking for something that never existed.
   */
  const [uploadOriginalName, setUploadOriginalName] = useState<string>('');
  /**
   * Where this session's audio is stored in the browser, so a saved project can
   * find it again. Minted on upload and re-minted on every trim, because a trim
   * produces a different file and any project already saved against the old one
   * still needs it.
   */
  const [audioKey, setAudioKey] = useState<string>('');
  /**
   * A loaded project whose stored audio could not be found, waiting for the
   * original file to be offered again.
   *
   * Holding the window here rather than in `trimWindow` keeps the two questions
   * apart: `trimWindow` is where the *current* audio came from, this is what the
   * next upload has to be cut to before it matches the timeline on screen.
   */
  const [awaitingAudio, setAwaitingAudio] = useState<{ fileName: string; trim: { start: number; end: number } | null } | null>(null);
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
  const skipAlignerSetting = useSyncExternalStore(
    skipAlignerPreference.subscribe,
    skipAlignerPreference.get,
    skipAlignerPreference.getServerSnapshot
  );
  const screenBreaks = SCREEN_BREAKS[Math.round(useSyncExternalStore(
    screenBreaksPreference.subscribe,
    screenBreaksPreference.get,
    screenBreaksPreference.getServerSnapshot
  )) + 1];
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
  const [chosenProvider, setMatchProvider] = useState<'gemini' | 'align' | 'qul' | PhonemeProvider>('align');
  /** The phoneme lab's model for each stage -- development only, see `phonemeTrial`. */
  const [lab, setLab] = useState<PhonemeLab>(LAB_DEFAULTS);
  // Whatever was picked before, a public studio matches locally: it offers
  // only that engine, and its route refuses the others.
  const matchProvider = studio.mode === 'public' ? 'align' : chosenProvider;
  // A public visitor is making a video, not testing the timing engines: where
  // the timings came from and the other ways of getting them are for the
  // person running the studio.
  const isPublic = studio.mode === 'public';
  /** Built-in reciters with a QUL timing export on this machine. */
  const [qulTimedReciters, setQulTimedReciters] = useState<string[]>([]);
  const [providerStatus, setProviderStatus] = useState<{
    gemini: { configured: boolean };
    align: {
      configured: boolean;
      serviceUrl: string;
      canAutoDetectRange?: boolean;
      alignReady?: boolean;
      alignError?: string | null;
    };
    /** Absent from an older server, which is the same as not available. */
    qul?: { configured: boolean; canAutoDetectRange?: boolean; qulAssist?: boolean; qulSupported?: boolean };
  } | null>(null);

  // Loaded Surah / Verse Data
  const [surahNameArabic, setSurahNameArabic] = useState<string>('الفاتحة');
  const [surahNameEnglish, setSurahNameEnglish] = useState<string>('Al-Fatihah');
  const [audioUrl, setAudioUrl] = useState<string>(DEFAULT_AUDIO_URL);
  const { verses, setVerses, selectedIndex, setSelectedIndex, edit, reorderAt } = useTimelineEditing(SAMPLE_PROJECTS[0].verses);
  /**
   * The studio opens with Al-Fatihah already in the timeline so the preview is
   * not blank on a first visit. That is useful, but it is indistinguishable
   * from a project you loaded yourself -- so say which it is until you replace
   * it. Cleared as soon as anything real arrives.
   */
  const [isSampleProject, setIsSampleProject] = useState<boolean>(true);

  /**
   * What the corpus said for each ayah this session has asked about, by key.
   *
   * Kept so an ayah is fetched once however often the timeline is rearranged:
   * adding a segment or changing an ayah number usually lands on an ayah that
   * is already here, and the text is filled from this without a request.
   * `corpusRequested` covers the other half -- an ayah that was asked for and
   * came back unusable is not asked for again on the render its absence
   * causes.
   */
  const corpusCache = useRef<Map<string, VerseData>>(new Map());
  const corpusRequested = useRef<Set<string>>(new Set());

  /**
   * Give the timeline the text and page glyphs the corpus has for it.
   *
   * Three things arrive without them. `SAMPLE_PROJECTS` carries ayah text and
   * timings but no word list; a project saved before the page fonts existed
   * carries words with no `glyph`; and a segment added, or pointed at another
   * ayah, is empty on purpose -- the Arabic is not editable, so the corpus is
   * the only place its text can come from (`fillFromCorpus`). Without glyphs
   * the mushaf face falls back to the Unicode one, which is also what the
   * Digital Khatt option uses, so choosing between the two appeared to do
   * nothing.
   *
   * Only what is missing is filled in. Timings, translations, exclusions and
   * the spelling a segment already has are left exactly as they were.
   */
  useEffect(() => {
    // An isti'adha or basmala before the passage is no ayah of it: nothing to fetch.
    const needs = (verse: VerseData) =>
      Boolean(verse.verseKey) && !isOpening(verse) && (
        !verse.textUthmani?.trim() ||
        !canDrawAsMushaf(verse.words) ||
        // Saved before the printed lines were carried: fetched once so the
        // caption can follow the mushaf's breaks.
        !(verse.words || []).every(word => word.glyphLine)
      );
    if (!verses.some(needs)) return;

    // What is already known applies at once. Both functions hand the array
    // back by identity when they change nothing, so this cannot loop.
    const known = [...corpusCache.current.values()];
    if (known.length) setVerses(current => withGlyphs(fillFromCorpus(current, known), known));

    const asking = verses.filter(
      verse => needs(verse) && !corpusCache.current.has(verse.verseKey) && !corpusRequested.current.has(verse.verseKey)
    );
    if (!asking.length) return;
    // One surah per request, which is all a timeline has ever held. Anything
    // else is left for the next pass rather than marked as asked about.
    const surah = Number(asking[0].verseKey.split(':')[0]);
    const sameSurah = asking.filter(verse => verse.verseKey.startsWith(`${surah}:`));
    const numbers = sameSurah.map(verse => Number(verse.verseKey.split(':')[1])).filter(Number.isFinite);
    if (!numbers.length) return;
    sameSurah.forEach(verse => corpusRequested.current.add(verse.verseKey));
    const start = Math.min(...numbers);
    const end = Math.max(...numbers);

    // Not cancelled when the timeline changes underneath it, deliberately: the
    // effect re-runs on every edit, and the ayahs are already marked as asked
    // about, so an answer thrown away here would never be asked for again.
    // Applying it to whatever the timeline is by then is safe -- both
    // functions fill only what is still missing.
    fetch(`/api/quran/verses?surah=${surah}&start=${start}&end=${end}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        const fetched: VerseData[] = data?.verses || [];
        fetched.forEach(verse => corpusCache.current.set(verse.verseKey, verse));
        if (fetched.length) setVerses(current => withGlyphs(fillFromCorpus(current, fetched), fetched));
      })
      .catch(() => {});
  }, [verses, setVerses]);

  // Audio Playback & Web Audio API
  // Transport, clock and Web Audio graph. Destructured to the names the rest of
  // this component already used, so only the ownership moved.
  const {
    elementRef: audioElementRef,
    analyserNode: audioAnalyserNode,
    isPlaying, setIsPlaying,
    currentTime, setCurrentTime,
    playhead,
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
    onCanPlay: handleCanPlay,
    recover: recoverAudio,
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
    /** Why a load failed, when the route said. */
    error?: string;
  } | null>(null);
  /**
   * Where in the new recording playback should resume once its metadata
   * arrives. A range that starts past ayah 1 starts minutes into the chapter
   * file, and `currentTime` cannot be set before the browser knows the
   * duration. Stamped with the url it belongs to so a seek meant for one
   * recording is never applied to the next.
   */

  // UI Tabs & Drawer
  /**
   * Which tab the working panel shows. One panel with three tabs replaced a
   * Source column and an Inspector column: Source is used once per clip, and
   * keeping it on screen for good left the preview the least room.
   */
  const [panelTab, setPanelTab] = useState<PanelTab>('source');
  /** Which way into a clip the Source tab shows: a built-in reciter, or the user's own recording. */
  const [sourceMode, setSourceMode] = useState<'reciter' | 'recording'>('reciter');
  /** Set while the source is being edited; otherwise a loaded clip shows as a summary. */
  const [sourceEditing, setSourceEditing] = useState(false);
  // Set by "New clip" and cleared by whatever follows it: loading or matching
  // the new clip resets its motion, going back to the current one does not.
  const newClipPending = useRef(false);
  /** Advanced (screen breaks) opens itself when the clip's source is reopened to re-match. */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** Fewer / More re-cut a match the aligner still holds -- see `useRegroup`. */
  const regroup = useRegroup();
  /** A screen-break level waiting on a yes, because the captions were edited since the match. */
  const [recutConfirm, setRecutConfirm] = useState<ScreenBreaks | null>(null);
  const [isProjectsDrawerOpen, setIsProjectsDrawerOpen] = useState<boolean>(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState<boolean>(false);

  // Video Export & Progress State
  const {
    canvasRef,
    isExporting,
    progress: exportProgress,
    speed: exportSpeed,
    willEncodeOffline,
    lastOutput: exportOutput,
    renderPreview,
    previewing,
    previewProgress,
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
    fontArabic: FONT_ARABIC_DEFAULT,
    fontTranslation: 'Inter',
    arabicFontSize: 45,
    translationFontSize: 45,
    ayahNumberFontSize: 50,
    textAlignment: 'center',
    textColor: '#ffffff',
    accentColor: '#b8c7dc',
    translationColor: '#d5dfec',
    textShadow: true,
    showTranslation: true,
    // The translation every project has always shown. Choosing others adds to
    // this list; the first one is still the text `verse.translation` holds.
    translationIds: [DEFAULT_TRANSLATION_ID],
    // Off, so an existing project reads exactly as it did.
    translationFollowsWords: false,
    // Off by default: a full printed line is about 18 em wide, so on a 9:16
    // card it forces the Arabic down to roughly half the size wrapping gives.
    mushafLines: false,
    showWaveform: true,
    showSurahBadge: true,
    badgeStyle: DEFAULT_BADGE_STYLE,
    badgeOpacity: NEW_PROJECT_BADGE_OPACITY,
    layout: DEFAULT_FRAME_LAYOUT,
    ...MOTION_DEFAULTS,
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
    watermarkText: 'Quran-Clipper',
    watermarkPosition: 'bottom-right',
    fps: 60,
    gpuAccelerated: true
  });
  /** A new clip starts with no motion, whatever the last one had; the rest of its style carries over. */
  const beginClip = () => {
    if (!newClipPending.current) return;
    newClipPending.current = false;
    setCanvasConfig(prev => ({ ...prev, ...MOTION_DEFAULTS }));
  };

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

  /**
   * Keeps the waiting draft's Quran content current.
   *
   * The draft is a stored copy like any saved project, and the same rule
   * applies: checked against the upstream at least every seven days, or not
   * kept. The server checks saved projects itself; it never sees this one, so
   * the studio sends it. Once per draft offered, and nothing is applied to the
   * timeline -- only the stored copy is refreshed.
   */
  useEffect(() => {
    const draft = pendingDraft;
    if (!draft || !needsContentSync(draft.syncedAt ?? draft.savedAt)) return;
    const translationIds = Array.isArray(draft.config?.translationIds)
      ? (draft.config.translationIds as string[])
      : [];
    // Ranges rather than every key, to keep the request small: one per surah.
    const bySurah = new Map<number, number[]>();
    for (const verse of draft.verses) {
      const [surah, ayah] = verse.verseKey.split(':').map(Number);
      if (Number.isFinite(surah) && Number.isFinite(ayah)) bySurah.set(surah, [...(bySurah.get(surah) || []), ayah]);
    }
    const ranges = [...bySurah].map(([surah, ayahs]) => `${surah}:${Math.min(...ayahs)}-${Math.max(...ayahs)}`);
    const keyed = [...new Set(draft.verses.flatMap(verse => Object.keys(verse.translations || {})))];
    if (!ranges.length) return;
    fetch(`/api/content/current?ranges=${ranges.join(',')}&ids=${keyed.join(',')}`)
      .then(res => (res.ok ? res.json() : null))
      .then(sources => {
        if (!sources?.success) return;
        const result = applyContentSync({
          verses: draft.verses,
          translationIds,
          corpus: new Map((sources.corpus as CorpusVerse[]).map(verse => [verse.verseKey, verse])),
          texts: sources.texts,
          available: new Set(sources.available as string[]),
          defaultId: sources.defaultId
        });
        // A check that could not cover every ayah is not recorded as one.
        if (!result.complete) return;
        replaceRecoverableDraft(draft, {
          ...draft,
          verses: result.verses,
          config: { ...draft.config, translationIds: result.translationIds },
          syncedAt: Date.now()
        });
      })
      .catch(() => {});
  }, [pendingDraft]);

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
    beginClip();
    setCanvasConfig(prev => ({ ...prev, ...motionForNewMatch(prev.captionTransition) }));
    // Back to the clip's summary in Source, which reports how the load went.
    setSourceEditing(false);
    setIsLoadingVerses(true);
    setLoadResult(null);
    try {
      const res = await fetch(`/api/quran/verses?surah=${selectedSurah}&start=${ayahStart}&end=${ayahEnd}&reciter=${selectedReciter}`);
      if (!res.ok) {
        // A failed load used to be swallowed: `if (res.ok)` with no else and an
        // empty catch, so a broken fetch looked exactly like a successful one.
        // The route's own reason where it gave one: a QUL-only reciter whose
        // timings are broken in this passage is not a connection problem.
        const reason = await res.json().then((body: { error?: string }) => body?.error).catch(() => undefined);
        setLoadResult({ ok: false, error: reason });
        return;
      }
      const data = await res.json();
      setSurahNameArabic(data.surahNameArabic || 'الفاتحة');
      setSurahNameEnglish(data.surahNameEnglish || 'Al-Fatihah');
      if (!customAudioUrl) {
        setAudioUrl(data.audioUrl);
      }
      // Against an upload the reciter's absolute timings put the passage
      // outside the recording entirely -- see `fitVersesToAudio`. They are
      // wrong for this audio whatever happens; this is what makes them
      // reachable enough to correct.
      const loaded = customAudioUrl
        ? fitVersesToAudio(data.verses || [], customAudioDuration || audioDuration)
        : data.verses || [];
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
        await alignLoadedReciter(loaded, data.audioUrl, totalSeconds, data.timingSource === 'measured');
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

  /**
   * The original file, offered again for a project whose stored audio was gone.
   *
   * Cuts it back to the window that project was saved with and adopts the
   * result *without touching the timeline*. Those verse times were rebased to
   * this clip when it was first trimmed and saved that way, so running
   * `trimTimeline` over them again would rebase them a second time and pull
   * every caption `start` seconds early. This shares the decode and the slice
   * with `handleApplyTrim` and nothing else: that one is making a new edit,
   * this one is reproducing an edit already made.
   */
  const adoptAwaitedAudio = async (file: File, expecting: { fileName: string; trim: { start: number; end: number } | null }) => {
    let adopted: TrimResult;
    if (expecting.trim) {
      const buffer = await decodeAudioFile(file);
      adopted = buildTrimmedFile(buffer, expecting.trim.start, expecting.trim.end, expecting.fileName);
    } else {
      const url = URL.createObjectURL(file);
      adopted = { file, url, duration: await measureAudioDuration(url) };
    }
    setCustomAudioFile(adopted.file);
    setCustomAudioUrl(adopted.url);
    setCustomAudioName(adopted.file.name);
    setCustomAudioDuration(adopted.duration);
    setUploadOriginalName(expecting.fileName);
    setAudioKey(newAudioKey());
    setAudioUrl(adopted.url);
    if (adopted.duration > 0) setAudioDuration(adopted.duration);
    setTrimWindow(expecting.trim);
    setVideoBgOffset(expecting.trim ? expecting.trim.start : 0);
    setUploadIsVideo(false);
    setAwaitingAudio(null);
    setCurrentTime(0);
    if (audioElementRef.current) {
      audioElementRef.current.src = adopted.url;
      audioElementRef.current.currentTime = 0;
      audioElementRef.current.load();
    }
    setMatchStatus({ text: t.match.audioRestored, tone: 'info' });
  };

  /**
   * Takes a recitation, however it arrived -- picked or dropped.
   *
   * Extracted from the change handler so a dropped file goes through exactly
   * this path and not a shortened copy of it. The branch below is the reason
   * that matters: a project restored without its audio is waiting for one
   * particular file, and starting a fresh upload with it would rebase an
   * already-rebased timeline and put every caption `trimStart` seconds early.
   */
  const acceptRecitationFile = async (file: File | undefined) => {
    if (file) {
      setSourceMode('recording');
      // A project is waiting for its recitation back. Reproduce the clip it was
      // saved against rather than starting a fresh upload, which would leave the
      // restored timeline describing a file it no longer matches.
      if (awaitingAudio && !isVideoFile(file)) {
        await adoptAwaitedAudio(file, awaitingAudio);
        return;
      }
      const url = URL.createObjectURL(file);
      const video = isVideoFile(file);
      setCustomAudioUrl(url);
      setCustomAudioName(file.name);
      setCustomAudioFile(file);
      setUploadIsVideo(video);
      // The name the user would recognise, kept apart from `customAudioName`
      // because a trim renames that to `-trimmed.wav`. A fresh key too: this is
      // a different recording from whatever was here before.
      setUploadOriginalName(file.name);
      setAudioKey(newAudioKey());
      setAwaitingAudio(null);
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

  // Handle Custom Audio / Video File Upload
  const handleCustomAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Let the same file be chosen again -- re-picking the recitation a
    // restored project is asking for is an ordinary thing to do twice.
    e.target.value = '';
    await acceptRecitationFile(file);
  };

  /**
   * One recitation, not a set: the studio has a single audio track, and
   * silently taking the first of five dropped files would be a guess.
   */
  const recitationDrop = useFileDrop(
    files => { void acceptRecitationFile(files[0]); },
    file => file.type.startsWith('audio') || file.type.startsWith('video') || isVideoFile(file)
  );

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
    // A different file from the one stored a moment ago, and a project already
    // saved against that one still needs it -- so this gets its own key rather
    // than overwriting.
    setAudioKey(newAudioKey());
    setAudioUrl(result.url);
    setAudioDuration(result.duration);
    setVerses(prev => trimTimeline(prev, result.trimStart, result.trimEnd));
    // A hand-cut background lane is on the same clock, so it moves with them.
    setCanvasConfig(prev =>
      prev.bgMode === 'custom' && prev.bgSegments?.length
        ? { ...prev, bgSegments: trimLane(prev.bgSegments, result.trimStart, result.trimEnd) }
        : prev
    );
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
   * A reciter timeline plays through `/api/audio/proxy`, which is a path on
   * this app and means nothing to another process -- so it is made absolute
   * rather than unwrapped.
   *
   * Sending the sidecar the CDN address directly is what this used to do, and
   * it is why one reciter could fail while another worked: ffmpeg takes
   * whichever address `getaddrinfo` returns first and has no `-4` to force the
   * matter, so a host publishing a AAAA record is unreachable from a machine
   * with no IPv6 route. Both CDNs publish one. Going back through this app
   * puts a Node fetch in the middle, which tries both families and falls back
   * -- the same reason the proxy exists for the browser, in its own words.
   */
  const alignableAudioUrl = (url: string): string => {
    if (!url) return '';
    if (url.startsWith('/')) return `${window.location.origin}${url}`;
    if (/^https:\/\//.test(url)) {
      return `${window.location.origin}/api/audio/proxy?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  /**
   * Longest passage worth sending for alignment, in seconds.
   *
   * Alignment cost grows with the square of the recording, and the sidecar
   * refuses anything over its own memory budget. Catching it here means saying
   * "pick fewer ayahs" before a minute of fetching rather than after.
   */
  const MAX_ALIGN_SPAN_SEC = 2400;

  /** Put a match's answer on screen -- a first match and a re-cut alike. */
  const applyMatchData = (data: any) => {
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
  };

  const runAutoMatch = async (
    source: { kind: 'file'; file: File } | { kind: 'url'; url: string; start: number; end: number; skipAligner?: boolean },
    /**
     * Vetoes a result before it replaces the timeline. Used by the automatic
     * pass after Load, which must never leave someone worse off than the
     * estimate it was improving on.
     */
    accept?: (verses: VerseData[]) => string | null
  ) => {
    setIsMatching(true);
    // A built-in reciter's passage keeps its loaded timings when this fails,
    // and its summary already says whether those are estimates and offers to
    // align again, so a public visitor is not shown the server's reason too.
    const quietFailure = isPublic && source.kind === 'url';
    setMatchStatus({
      text: matchProvider === 'gemini' ? t.match.sendingToGemini
        : source.kind === 'url' && source.skipAligner ? t.match.timingPublished : t.match.aligning,
      tone: 'info'
    });

    const formData = new FormData();
    if (source.kind === 'file') {
      formData.append('audio', source.file);
    } else {
      formData.append('audioUrl', source.url);
      formData.append('windowStart', String(source.start));
      formData.append('windowEnd', String(source.end));
      // A built-in reciter's recording: where it has published timings the
      // server times the captions from them and only asks the aligner where the
      // reciter paused. Any other audio is aligned as before. The phoneme lab
      // can set them aside, so its models' own work is what shows.
      if (!isPhonemeProvider(matchProvider) || lab.published) formData.append('timing', 'published');
      if (source.skipAligner) formData.append('aligner', 'skip');
    }
    formData.append('surah', String(selectedSurah));
    formData.append('start', String(ayahStart));
    formData.append('end', String(ayahEnd));
    formData.append('reciter', selectedReciter);
    formData.append('provider', matchProvider);
    if (isPhonemeProvider(matchProvider)) formData.append('lab', JSON.stringify(lab));
    if (matchProvider !== 'gemini' && screenBreaks !== 'normal') formData.append('breaks', screenBreaks);
    // Measured from this exact file at upload time, not read off the player.
    // Gemini only estimates duration -- on the test clip it reported 108s for a
    // 68.5s file -- and the server has no decode of its own on that path, so
    // without this the timeline runs past the end of the audio.
    if (source.kind === 'file' && customAudioDuration > 0) {
      formData.append('audioDuration', String(customAudioDuration));
    }

    // A ticket, so that while this request waits behind other people's
    // matches the studio can say where it stands -- see `matchQueue`.
    const ticket = newMatchTicket();
    formData.append('ticket', ticket);
    const stopWatching = matchProvider === 'gemini' ? () => {} : watchQueue(ticket, seen => {
      setMatchStatus({
        text: seen.position > 0
          ? t.match.queued(seen.position, seen.etaSeconds === null ? null : roughWait(seen.etaSeconds))
          : t.match.aligning,
        tone: 'info'
      });
    });

    try {
      const res = await fetch('/api/audio/match', {
        method: 'POST',
        body: formData
      }).finally(stopWatching);
      const data = await res.json();

      if (!res.ok || !data.success) {
        // An upstream reason is passed through as it came: it names a key, a
        // status code or a service, and translating it would make it
        // unsearchable.
        setMatchStatus(quietFailure ? null : { text: data?.error || t.match.notConfigured, tone: 'error' });
        setIsMatching(false);
        return;
      }

      // An empty reason vetoes the result without a word: what was there stays.
      const rejection = accept?.(data.verses || []);
      if (rejection != null) {
        setMatchStatus(rejection ? { text: rejection, tone: 'error' } : null);
        setIsMatching(false);
        return;
      }

      applyMatchData(data);
      regroup.remember(data, {
        audioUrl,
        provider: data.provider,
        surah: data.surahNumber ?? selectedSurah,
        start: data.ayahStart ?? ayahStart,
        end: data.ayahEnd ?? ayahEnd,
        audioDuration: data.audioDuration ?? audioDuration,
        wholeClip: source.kind === 'file'
      });
      const providerLabel =
        data.provider === 'qul' ? 'Forced alignment + QUL'
          : data.provider === 'align' ? 'Forced alignment'
            : isPhonemeProvider(data.provider) ? `Phoneme lab ${JSON.stringify(lab)}` : 'Gemini';
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
      const confirmRange = data.provider === 'align' || data.provider === 'qul' || isPhonemeProvider(data.provider);
      if (isPublic && data.timedFrom) setMatchStatus(null);
      else setMatchStatus({
        text: data.timedFrom === 'measured'
          ? t.match.measuredTimed((data.verses || []).length)
          : data.timedFrom
          ? t.match.publishedTimed(
              (data.verses || []).length,
              data.timedFrom === 'qul' ? 'QUL' : 'quran.com',
              data.pausesFromAudio ? 'pauses' : data.alignerSkipped ? 'skipped' : 'unheard'
            )
          : (data.warning ? `⚠ ${data.warning} ` : '') +
            t.match.detected(detectedLabel, (data.verses || []).length) +
            (confirmRange ? t.match.confirmRange : t.match.reviewTimings),
        tone: 'info'
      });
      setIsMatching(false);
    } catch {
      setMatchStatus(quietFailure ? null : { text: t.match.failed, tone: 'error' });
      setIsMatching(false);
    }
  };

  const screenBreaksName = (level: ScreenBreaks) =>
    level === 'fewer' ? t.source.screenBreaksFewer : level === 'more' ? t.source.screenBreaksMore : t.source.screenBreaksNormal;

  /** Re-cut the match on screen at `level`, without matching again -- see `useRegroup`. */
  const runRecut = async (level: ScreenBreaks) => {
    setRecutConfirm(null);
    screenBreaksPreference.set(SCREEN_BREAKS.indexOf(level) - 1);
    const outcome = await regroup.recut(level);
    if (!outcome) return;
    if (!outcome.ok) {
      setMatchStatus({ text: outcome.expired ? t.match.recutExpired : t.match.recutFailed(outcome.error), tone: 'error' });
      return;
    }
    applyMatchData(outcome.data);
    regroup.recutApplied(outcome.data);
    setMatchStatus({ text: t.match.recutDone(screenBreaksName(level), outcome.data.verses?.length ?? 0), tone: 'info' });
  };

  /** A level picked on the summary: applied at once, or asked about first if the captions were edited. */
  const chooseScreenBreaks = (level: ScreenBreaks) => {
    if (level === screenBreaks && !recutConfirm) return;
    if (regroup.edited(verses)) {
      setRecutConfirm(level);
      return;
    }
    void runRecut(level);
  };

  const handleAutoMatchUploadedAudio = () => {
    beginClip();
    setCanvasConfig(prev => ({ ...prev, ...motionForNewMatch(prev.captionTransition) }));
    setSourceEditing(false);
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
  const alignLoadedReciter = async (loaded: VerseData[], rawUrl: string, totalSeconds: number, timed: boolean) => {
    const url = alignableAudioUrl(rawUrl);
    if (!url || loaded.length === 0) return;

    const { start, end } = alignWindowFor(loaded, totalSeconds);
    if (end - start > MAX_ALIGN_SPAN_SEC) {
      setMatchStatus({
        text: t.match.passageTooLong(Math.round((end - start) / 60), Math.round(MAX_ALIGN_SPAN_SEC / 60)),
        tone: 'error'
      });
      return;
    }

    // Local + QUL can be set to leave the aligner out for a timed reciter: the
    // published timings alone, one caption per ayah, and no model needed.
    if (timed && matchProvider === 'qul' && skipAlignerSetting) {
      await runAutoMatch({ kind: 'url', url, start, end, skipAligner: true });
      return;
    }

    // Asked before trying, so a missing sidecar is one clear sentence rather
    // than a failed upload and a stack of retries. A passage loaded with
    // published timings goes ahead regardless: the server times it from them,
    // and the aligner only adds where the reciter paused.
    const health = await fetch('/api/health', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
    const alignerUp = health?.aligner?.state === 'up' && health.aligner.ready !== false;
    if (!alignerUp && !timed) {
      setMatchStatus(isPublic ? null : { text: t.match.noAlignerOnLoad, tone: 'error' });
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
      if (!missing.length) return null;
      return isPublic ? '' : t.match.alignLostAyahs(missing.length, missing.slice(0, 4).join(', '));
    });
  };

  const handleAutoMatchReciter = () => {
    const url = alignableAudioUrl(audioUrl);
    if (!url) {
      setMatchStatus({ text: t.match.reciterNoUrl, tone: 'error' });
      return;
    }
    if (verses.length === 0) {
      setMatchStatus({ text: t.match.needLoad, tone: 'error' });
      return;
    }
    void alignLoadedReciter(verses, audioUrl, audioDuration, loadResult?.timingSource === 'measured' && !loadResult.againstUpload);
  };

  /**
   * Times the passage from the reciter's own published segments.
   *
   * Deliberately separate from the two matchers rather than folded into them.
   * It is not inference: quran.com measured these recordings and publishes a
   * start for every word, and the studio has been asking for that data on
   * every load and reading only the ayah bounds off it. Nothing here can run
   * against an uploaded file -- the timings belong to one specific recording --
   * so the aligner and the manual path are untouched by it.
   */
  const handleReciterSegments = async () => {
    const apiId = selectedReciterMeta?.quranApiId;
    if (!apiId) {
      setMatchStatus({ text: t.match.segmentsUnavailable, tone: 'error' });
      return;
    }
    setIsMatching(true);
    setMatchStatus({ text: t.match.segmentsLoading, tone: 'info' });
    try {
      const res = await fetch(
        `/api/quran/segments?surah=${selectedSurah}&start=${ayahStart}&end=${ayahEnd}&reciter=${apiId}`
      );
      const data = await res.json();
      if (!res.ok || !data?.success || !Array.isArray(data.verses) || !data.verses.length || !data.audioUrl) {
        setMatchStatus({ text: t.match.segmentsNone, tone: 'error' });
        return;
      }
      setVerses(data.verses);
      setSelectedIndex(0);
      // quran.com's recording, as the QUL button plays QUL's: these times were
      // measured on it, and against whatever was loaded before they are not.
      setAudioUrl(data.audioUrl);
      if (data.totalSeconds > 0) setAudioDuration(data.totalSeconds);
      const firstStart = data.verses[0]?.startTime ?? 0;
      if (firstStart > 0) queueSeek(data.audioUrl, firstStart);
      const { timedWords = 0, boundsOnly = 0 } = data.coverage || {};
      setMatchStatus({
        text: t.match.segmentsDone(data.verses.length, timedWords, boundsOnly),
        tone: 'info'
      });
    } catch {
      setMatchStatus({ text: t.match.segmentsNone, tone: 'error' });
    } finally {
      setIsMatching(false);
    }
  };

  /** "Match several recordings": the batch dialog, and what it hands back. */
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const measureFileDuration = async (file: File) => {
    const url = URL.createObjectURL(file);
    try {
      return await measureAudioDuration(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  /** Loads one batch result as if that file had been uploaded and matched here. */
  const openBatchResult = async (file: File, result: BatchResult) => {
    setIsBatchOpen(false);
    await acceptRecitationFile(file);
    setSurahNameArabic(result.surahNameArabic || surahNameArabic);
    setSurahNameEnglish(result.surahNameEnglish || surahNameEnglish);
    setSelectedSurah(result.surahNumber);
    setAyahStart(result.ayahStart);
    setAyahStartInput(String(result.ayahStart));
    setAyahEnd(result.ayahEnd);
    setAyahEndInput(String(result.ayahEnd));
    if (result.audioDuration > 0) setAudioDuration(result.audioDuration);
    setVerses(result.verses);
    setSelectedIndex(0);
    setIsSampleProject(false);
    setMatchStatus({
      text: (result.warning ? `⚠ ${result.warning} ` : '') +
        t.match.detected(result.title, result.verses.length) + t.match.confirmRange,
      tone: 'info'
    });
  };

  /**
   * Saves one batch result as a project, styled as the studio is now. The
   * recording is stored in this browser first, as a single save does, so the
   * project can find it again when opened.
   */
  const saveBatchResult = async (file: File, result: BatchResult): Promise<boolean> => {
    const key = newAudioKey();
    const stored = await storeProjectAudio(key, file);
    const payload = buildProjectPayload({
      surahNumber: result.surahNumber,
      surahNameArabic: result.surahNameArabic,
      surahNameEnglish: result.surahNameEnglish,
      ayahStart: result.ayahStart,
      ayahEnd: result.ayahEnd,
      reciterId: selectedReciter,
      reciterName: RECITERS.find(r => r.id === selectedReciter)?.name || RECITERS[0]?.name || '',
      // An upload's address is a blob url that dies with this tab; the stored copy is what counts.
      audioUrl: '',
      audioDurationSeconds: result.audioDuration,
      audioFileName: file.name,
      audioKey: stored ? key : '',
      trimWindow: null,
      verses: result.verses,
      config: withStoredBackgrounds(canvasConfig) as unknown as Record<string, unknown>,
    });
    const res = await saveProject(payload, studio.mode).catch(() => null);
    return Boolean(res?.ok);
  };

  /**
   * Times the passage from QUL's word timings, with QUL's recording.
   *
   * The QUL counterpart of `handleReciterSegments`, and a button of its own so
   * the two can be tried on the same passage and compared. It changes the audio
   * as well as the timeline, because QUL measured its own recording of the
   * reciter -- its times are wrong against the mp3quran file played otherwise.
   */
  const handleQulSegments = async () => {
    if (!qulTimedReciters.includes(selectedReciter)) {
      setMatchStatus({ text: t.match.qulSegmentsUnavailable(selectedReciter), tone: 'error' });
      return;
    }
    setIsMatching(true);
    setMatchStatus({ text: t.match.qulSegmentsLoading, tone: 'info' });
    try {
      const res = await fetch(
        `/api/quran/qul-segments?surah=${selectedSurah}&start=${ayahStart}&end=${ayahEnd}&reciter=${encodeURIComponent(selectedReciter)}`
      );
      const data = await res.json();
      if (!res.ok || !data?.success || !Array.isArray(data.verses) || !data.verses.length || !data.audioUrl) {
        setMatchStatus({ text: t.match.qulSegmentsNone, tone: 'error' });
        return;
      }
      setVerses(data.verses);
      setSelectedIndex(0);
      setAudioUrl(data.audioUrl);
      if (data.totalSeconds > 0) setAudioDuration(data.totalSeconds);
      const firstStart = data.verses[0]?.startTime ?? 0;
      if (firstStart > 0) queueSeek(data.audioUrl, firstStart);
      const { timedWords = 0, boundsOnly = 0 } = data.coverage || {};
      setMatchStatus({ text: t.match.qulSegmentsDone(data.verses.length, timedWords, boundsOnly), tone: 'info' });
    } catch {
      setMatchStatus({ text: t.match.qulSegmentsNone, tone: 'error' });
    } finally {
      setIsMatching(false);
    }
  };

  const handleManualMatchUploadedAudio = () => {
    beginClip();
    setSourceEditing(false);
    setMatchStatus({ text: t.match.manualMode, tone: 'info' });
  };

  // Audio Play / Pause Sync with Web Audio API Analyser

  // Which built-in reciters have a QUL timing export on this machine.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/quran/qul-segments')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled && Array.isArray(data?.reciters)) setQulTimedReciters(data.reciters);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
  /**
   * `surah:id` pairs the upstream has already refused to serve.
   *
   * Only the *empty* answers are remembered. This used to record every request
   * the moment it was made, which stopped a translation quran.com does not
   * carry from being asked for on every render -- and also stopped a
   * translation that had arrived perfectly well from ever being fetched again.
   * "Load ayahs & audio" replaces the captions with fresh ones that carry no
   * translations, so the second language silently vanished and could not be
   * brought back without a reload: chosen, shown, then gone the moment the
   * passage was loaded.
   *
   * A successful fetch needs no memory. Once it is merged the captions are no
   * longer missing it, and if they are replaced then asking again is exactly
   * the right thing to do.
   */
  const unavailableTranslations = useRef<Set<string>>(new Set());
  /** In flight right now, so a re-render cannot start the same request twice. */
  const fetchingTranslations = useRef<Set<string>>(new Set());
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
      const ids = missing.filter(
        id =>
          !unavailableTranslations.current.has(`${surah}:${id}`) &&
          !fetchingTranslations.current.has(`${surah}:${id}`)
      );
      if (!ids.length) continue;
      ids.forEach(id => fetchingTranslations.current.add(`${surah}:${id}`));
      jobs.push({ surah, ...range, ids });
    }
    if (!jobs.length) return;

    let cancelled = false;
    void (async () => {
      const arrived: Record<string, Record<string, string>> = {};
      for (const job of jobs) {
        const answered = new Set<string>();
        try {
          const res = await fetch(
            `/api/quran/translation?surah=${job.surah}&start=${job.start}&end=${job.end}&ids=${job.ids.join(',')}`
          );
          if (res.ok) {
            const data = await res.json();
            for (const [key, texts] of Object.entries(data?.verses || {})) {
              const map = texts as Record<string, string>;
              Object.keys(map).forEach(id => answered.add(id));
              arrived[key] = { ...arrived[key], ...map };
            }
          }
        } catch {
          // Offline, or the resource is gone. The card shows what it has.
        } finally {
          // Anything that did not come back is one this upstream does not serve
          // for this surah; asking again on every render would be a loop.
          // Anything that did is simply forgotten, so a later reload re-fetches.
          job.ids.forEach(id => {
            fetchingTranslations.current.delete(`${job.surah}:${id}`);
            if (!answered.has(id)) unavailableTranslations.current.add(`${job.surah}:${id}`);
          });
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

  /** The stretch of audio an export should cover -- see `exportRangeFor`. */
  const exportRange = useMemo(
    () => exportRangeFor(verses, audioDuration, !!customAudioUrl),
    [verses, audioDuration, customAudioUrl]
  );

  /**
   * A built-in reciter's passage inside its chapter file, and the stretch of
   * that file the timeline draws -- see `clipWindow`. Null for an upload.
   */
  const passage = useMemo(
    () => clipWindow(exportRange, audioDuration, !!customAudioUrl),
    [exportRange, audioDuration, customAudioUrl]
  );
  const timelineWindow = useMemo(() => timelineView(passage, audioDuration), [passage, audioDuration]);

  /**
   * Play the clip, not the chapter: from the passage's first ayah when the
   * playhead is outside it, which is what the export will contain.
   */
  const playClip = useCallback(() => {
    const from = isPlaying ? null : playFrom(currentTime, passage);
    if (from !== null) handleSeek(from);
    togglePlayPause();
  }, [isPlaying, currentTime, passage, handleSeek, togglePlayPause]);

  // ...and stop at its last ayah, where the export ends.
  useEffect(() => {
    if (!isPlaying || !pastClipEnd(currentTime, passage)) return;
    audioElementRef.current?.pause();
    setIsPlaying(false);
  }, [isPlaying, currentTime, passage, audioElementRef, setIsPlaying]);

  /** Which ayah the playhead is currently inside. */
  const activeVerseIndex = useMemo(() => segmentAt(verses, currentTime), [verses, currentTime]);

  const handleMarkHere = useCallback(() => edit.markHere(currentTime), [edit, currentTime]);

  /**
   * A caption picked on the timeline opens in the Captions tab -- except from
   * Style, where clicking through captions is how a look is checked against
   * each of them, and being sent away from the controls would undo that.
   */
  const selectCaption = (index: number) => {
    setSelectedIndex(index);
    setPanelTab(tab => (tab === 'style' ? tab : 'captions'));
  };

  /** Selects the next caption marked for checking and puts the playhead on it. */
  const goToNextCheck = useCallback(() => {
    const next = nextToCheck(verses, selectedIndex);
    if (next === null) return;
    setSelectedIndex(next);
    handleSeek(verses[next].startTime);
    // Reviewing is the Captions tab's job, so the caption opens there.
    setPanelTab('captions');
  }, [verses, selectedIndex, setSelectedIndex, handleSeek]);

  useTransportKeys({
    onTogglePlay: playClip,
    onMarkHere: handleMarkHere,
    onUndo: history.undo,
    onRedo: history.redo,
    onShowShortcuts: () => setIsShortcutsOpen(true),
    onNextToCheck: goToNextCheck
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
  const handleDownloadGroundTruth = async () => {
    const duration = customAudioDuration || audioDuration;

    /**
     * The audio goes with it, or the file describes a recording nobody has.
     *
     * Trimming here is destructive and never writes to disk: `customAudioFile`
     * after a trim is `x-trimmed.wav`, which exists in this tab and nowhere
     * else. A ground-truth file naming it was naming a file the evaluator could
     * not open -- which is exactly why two of them have sat in `scripts/`
     * unscoreable. Saving the trimmed copy alongside means the audio the
     * captions were corrected against is the audio they are scored against,
     * with no cut to reproduce: hence `trim: null` on this path, and the window
     * kept only as provenance under `from`.
     */
    setSaveStatus({ text: t.header.groundTruthWriting, kind: 'pending' });
    const clip = groundTruthClip(
      customAudioFile ? { file: customAudioFile, name: customAudioName } : null,
      { url: audioUrl, id: selectedReciter, surah: selectedSurah, start: ayahStart, end: ayahEnd },
      verses
    );
    const saved = groundTruthAudioName(clip?.name ?? customAudioName);
    const withAudio = groundTruthFile(verses, {
      clipName: saved,
      duration,
      trim: null,
      from: trimWindow && uploadOriginalName
        ? { name: uploadOriginalName, start: trimWindow.start, end: trimWindow.end }
        : null,
    });
    if (!withAudio) {
      setSaveStatus(null);
      return;
    }

    const outcome = clip ? await saveGroundTruth(withAudio, clip, saved) : null;
    if (outcome && 'written' in outcome) {
      setSaveStatus({ text: t.header.groundTruthWritten, kind: 'ok', detail: outcome.written.map(name => `scripts/${name}`).join('  ·  ') });
      setTimeout(() => setSaveStatus(null), 8000);
      return;
    }
    // A reciter's passage has nothing to download in its place: say why.
    if (outcome && !outcome.fallback) {
      setSaveStatus({ text: t.header.groundTruthFailed, kind: 'error', detail: outcome.error });
      return;
    }

    // No server able to write, or no audio to write: the text file on its own,
    // naming the recording the person still has on disk and the window to cut
    // from it. Less convenient than the path above and better than nothing --
    // silently writing nothing would be worse than what this replaced.
    const contents = groundTruthFile(verses, {
      clipName: uploadOriginalName || customAudioName,
      duration,
      trim: trimWindow,
    });
    if (!contents) {
      setSaveStatus(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = groundTruthFileName(customAudioName);
    link.click();
    if (customAudioFile) {
      setSaveStatus({ text: t.header.groundTruthDownloaded, kind: 'ok', detail: t.header.groundTruthNeedsAudio(uploadOriginalName || customAudioName) });
      setTimeout(() => setSaveStatus(null), 10000);
    } else {
      setSaveStatus(null);
    }
    // Revoking immediately can cancel the download in some browsers; a tick is
    // enough for it to have been handed over.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** The project as it stands, in the shape a save sends. */
  const currentProjectPayload = () => buildProjectPayload({
    surahNumber: selectedSurah,
    surahNameArabic,
    surahNameEnglish,
    ayahStart,
    ayahEnd,
    reciterId: selectedReciter,
    reciterName: RECITERS.find(r => r.id === selectedReciter)?.name || RECITERS[0]?.name || 'Abdul Rahman Al-Sudais',
    audioUrl,
    audioDurationSeconds: audioDuration,
    audioFileName: customAudioFile ? uploadOriginalName : '',
    audioKey,
    trimWindow,
    verses,
    // An uploaded background is a `blob:` url that dies with this tab, so
    // what goes to the row is the library's id for the file instead. A
    // pasted link is already durable and passes through untouched.
    config: withStoredBackgrounds(canvasConfig) as unknown as Record<string, unknown>,
  });

  /**
   * The audio goes to the browser before the row goes to the server, so a
   * project never claims a recording that was not stored. A refusal here is
   * almost always quota; the row still saves, and the file name and trim
   * window in it are what let the recitation be offered back by hand.
   */
  const storeUploadFor = async (payload: Record<string, unknown>) => {
    if (!customAudioFile || !audioKey) return { payload, storedAudio: true };
    const storedAudio = await storeProjectAudio(audioKey, customAudioFile);
    return { payload: storedAudio ? payload : { ...payload, audioKey: '' }, storedAudio };
  };

  /**
   * Which saved project the clip on screen is: one per clip, so saving it
   * again, and every render of it, updates that row instead of adding
   * another. Each render used to save a project of its own and a hand save
   * yet another, so one clip filled the list with copies of itself. Tied to
   * the passage and the recording, so changing either starts a new project
   * rather than overwriting the old one with a different clip.
   */
  const clipProject = useRef<{ id: string; clip: string } | null>(null);
  const clipIdentity = (payload: Record<string, unknown>) =>
    `${payload.surahNumber}:${payload.ayahStart}-${payload.ayahEnd}|${payload.audioKey || payload.audioUrl || ''}`;
  const clipProjectId = (payload: Record<string, unknown>) =>
    clipProject.current?.clip === clipIdentity(payload)
      ? clipProject.current.id
      : `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const rememberClipProject = (id: string, payload: Record<string, unknown>) => {
    clipProject.current = { id, clip: clipIdentity(payload) };
  };

  const handleSaveProject = async () => {
    setSaveStatus({ text: t.header.saving, kind: 'pending' });
    try {
      const current = currentProjectPayload();
      const id = clipProjectId(current);
      const { payload, storedAudio } = await storeUploadFor(current);
      const res = await saveProject({ ...payload, id }, studio.mode);

      if (res.ok) {
        rememberClipProject(id, current);
        const data = await res.json().catch(() => null) as { source?: string } | null;
        // The route falls back to in-memory storage when DATABASE_URL is unset;
        // say so rather than implying the project survived a restart. A public
        // studio keeps it in this browser, which is worth saying too.
        setSaveStatus({
          text: savedStatusText(data?.source, t.header),
          kind: 'ok',
          // Saved, but the recitation did not fit alongside it. Better said now
          // than discovered on reopening, when the only clue would be silence.
          detail: storedAudio ? undefined : t.header.audioNotStored
        });
        setTimeout(() => setSaveStatus(null), storedAudio ? 3000 : 8000);
      } else {
        const data = await res.json().catch(() => null) as { error?: string } | null;
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
  const allMatchOptions = [
    {
      id: 'align' as const,
      label: studio.mode === 'public' ? t.source.matcherPublic : t.source.matcherLocal,
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
      blurb: studio.mode === 'public' ? t.source.matcherPublicBlurb : t.source.matcherLocalBlurb,
      fix: t.source.matcherLocalFix,
      experimental: false
    },
    {
      // Its own option rather than a switch on Local, so one recording can be
      // matched both ways and the results compared.
      id: 'qul' as const,
      label: t.source.matcherQul,
      technical: t.source.matcherQulTechnical,
      Icon: Library,
      ready: !!providerStatus?.qul?.configured,
      status: !providerStatus
        ? t.source.matcherChecking
        : providerStatus.qul?.configured
          ? t.source.matcherReady
          : !providerStatus.align.configured
            ? t.source.matcherHelperNotRunning
            : providerStatus.qul?.qulSupported
              ? t.source.matcherQulMissing
              : t.source.matcherQulRestart,
      blurb: t.source.matcherQulBlurb,
      fix: providerStatus?.align.configured && !providerStatus.qul?.qulSupported
        ? t.source.matcherQulRestartFix
        : t.source.matcherQulFix,
      // No gain measured over Local yet (FutureIdeas #40), so it says so.
      experimental: true
    },
    {
      id: 'gemini' as const,
      label: t.source.matcherOnline,
      technical: t.source.matcherOnlineTechnical,
      Icon: Sparkles,
      ready: !!providerStatus?.gemini.configured,
      status: studio.mode === 'public'
        ? t.source.matcherOnlinePublic
        : !providerStatus
          ? t.source.matcherChecking
          : providerStatus.gemini.configured
            ? t.source.matcherReady
            : t.source.matcherNeedsApiKey,
      blurb: t.source.matcherOnlineBlurb,
      fix: t.source.matcherOnlineFix,
      experimental: false
    }
  ];
  // A public studio offers the one engine it uses, under a name that says
  // what it does: visitors have nothing to choose between.
  // Development only: Match with each stage handed to the model chosen for
  // it -- see `phonemeTrial`. It runs wherever Match runs.
  const phonemeOptions = phonemeTrialOffered(studio.mode, process.env.NODE_ENV)
    ? [{
        ...allMatchOptions[0],
        id: 'phoneme-lab' as const,
        label: t.source.matcherPhonemeLab,
        technical: t.source.matcherPhonemeTechnical,
        Icon: FlaskConical,
        blurb: t.source.matcherPhonemeBlurb,
        experimental: true
      }]
    : [];
  const matchOptions = studio.mode === 'public'
    ? allMatchOptions.filter(opt => opt.id === 'align')
    : [...allMatchOptions, ...phonemeOptions];
  const selectedMatchOption = matchOptions.find(o => o.id === matchProvider) ?? matchOptions[0];



  /**
   * The guided tour: once per language by itself, and from the Help menu.
   * Each step points at the part of the studio it describes, and opens it --
   * on a phone only one surface shows at a time.
   */
  const guide = useGuidedTour(locale, !pendingDraft);
  const tourSteps: (TourStep & { panel: PanelTab })[] = [
    { target: 'tab-source', tab: 'mtab-source', focus: 'panel-source', panel: 'source', light: true, title: t.tour.sourceTitle, body: t.tour.sourceBody },
    { target: 'tab-captions', tab: 'mtab-captions', focus: 'panel-captions', panel: 'captions', light: true, title: t.tour.captionsTitle, body: t.tour.captionsBody },
    { target: 'tab-style', tab: 'mtab-style', focus: 'panel-style', panel: 'style', light: true, title: t.tour.styleTitle, body: t.tour.styleBody },
    { target: 'timeline', panel: 'captions', title: t.tour.timelineTitle, body: t.tour.timelineBody, compactBody: t.tour.timelineBodyCompact },
    { target: 'export', panel: 'captions', title: t.tour.exportTitle, body: t.tour.exportBody }
  ];
  const closeTour = () => {
    guide.close();
    setPanelTab('source');
  };

  const frameIndex = useSyncExternalStore(framePreference.subscribe, framePreference.get, framePreference.getServerSnapshot);
  const showSafeArea = useSyncExternalStore(safeAreaPreference.subscribe, safeAreaPreference.get, safeAreaPreference.getServerSnapshot);
  const frame = framePreset(Math.round(frameIndex), canvasConfig.aspectRatio);
  const frameAreas = showSafeArea ? coveredAreas(frame.id) : [];
  /** Choosing a platform sets the frame's shape, through the same config undo covers. */
  const chooseFrame = (index: number) => {
    framePreference.set(index);
    const ratio = EXPORT_PRESETS[index].aspectRatio;
    setCanvasConfig(prev => (prev.aspectRatio === ratio ? prev : { ...prev, aspectRatio: ratio }));
  };

  /** "New clip" in Projects: the Source tab, on its form rather than the current clip's summary. */
  const startNewClip = () => {
    newClipPending.current = true;
    setPanelTab('source');
    setSourceEditing(true);
  };

  /** Help: learning the studio, kept apart from the tools in the ⋯ menu. */
  const helpItems: OverflowItem[] = [
    {
      key: 'how',
      label: t.tour.open,
      icon: <BookOpen className="w-4 h-4" />,
      onSelect: guide.open
    },
    {
      key: 'shortcuts',
      label: t.shortcuts.open,
      icon: <Keyboard className="w-4 h-4" />,
      onSelect: () => setIsShortcutsOpen(true)
    }
  ];
  /**
   * Everything secondary, so Export is the one primary action in the bar.
   * Projects and Save show here only below the widths where the header carries
   * them itself.
   */
  const moreItems: OverflowItem[] = [
    ...helpItems.map(item => ({ ...item, className: 'sm:hidden' })),
    {
      key: 'saved',
      label: t.header.savedClips,
      icon: <FolderOpen className="w-4 h-4" />,
      onSelect: () => setIsProjectsDrawerOpen(true),
      className: 'sm:hidden'
    },
    {
      key: 'save',
      label: t.header.saveToProjects,
      hint: saveStatus?.detail || saveStatus?.text,
      icon: <Save className="w-4 h-4" />,
      onSelect: handleSaveProject,
      className: 'md:hidden'
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
    // A development tool, not a feature: the file it writes is only useful
    // next to this repo's `gauge.sh`. Offered in a personal studio, built or
    // not; never in a public one, whose server does not take the files.
    ...(studio.mode !== 'public' && verses.length > 0
      ? [{
          key: 'ground-truth',
          label: t.header.groundTruth,
          hint: t.header.groundTruthTitle,
          icon: <ClipboardCheck className="w-4 h-4" />,
          onSelect: () => void handleDownloadGroundTruth()
        }]
      : [])
  ];
  /** How many captions are marked for checking, for the Captions tab's badge. */
  const toCheckCount = useMemo(() => verses.filter(verse => captionChecks(verse).length > 0).length, [verses]);
  /** The header's second line: where the work is kept right now. */
  const saveLine = saveStatus?.text
    ?? (draftSavedAt !== null
      ? t.header.draftKept(new Date(draftSavedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }))
      : t.header.notSavedYet);


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
   * What the caption offered after a render says about the clip.
   *
   * Built from `clipPassage` for the same reason the file name is: a trim
   * narrows what the video contains without rewriting the request, and a
   * description that names the ayahs that were *asked for* describes a
   * different video.
   *
   * The reciter is named only when the recitation is one of ours. Crediting a
   * preset reciter for a file the user recorded or uploaded would be putting
   * someone's name to work that is not theirs -- so an upload is left
   * unattributed here rather than attributed wrongly.
   *
   * Translator names are not resolved here. The catalogue that holds them is
   * fetched lazily, and the caption panel is what asks for it -- only once it
   * is opened, which is the moment those names are about to be published.
   */
  const publishInput = useMemo(
    () => ({
      surahNumber: clipPassage.surahNumber,
      surahNameArabic,
      surahNameEnglish,
      ayahStart: clipPassage.start,
      ayahEnd: clipPassage.end,
      reciterName: customAudioFile ? '' : selectedReciterMeta?.name || '',
      wordByWord: !!canvasConfig.translationFollowsWords,
      verses
    }),
    [
      clipPassage, surahNameArabic, surahNameEnglish, customAudioFile,
      selectedReciterMeta, canvasConfig.translationFollowsWords, verses
    ]
  );

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
   *
   * The plan is only the request. What the render *produced* is reported by
   * the export hook once it knows which path it took, and that is what is
   * filed -- a render that could not be encoded frame by frame comes back as
   * the preview canvas, not as the 4K it was asked for.
   */
  const exportedResolution = useRef('1080x1920');

  /**
   * The project each render was made from, so any exported video can be
   * reopened and rendered again. Taken when the render starts -- the export
   * queue changes the shape between jobs -- and saved when it finishes, into
   * the clip's own project (`clipProjectId`), never as a new one.
   */
  const renderedProject = useRef<Record<string, unknown> | null>(null);

  /** Saves the project behind a render, into this clip's project, and says under which id. */
  const saveRenderedProject = async (planned: Record<string, unknown> | null): Promise<string | null> => {
    if (!planned) return null;
    const id = clipProjectId(planned);
    const { payload } = await storeUploadFor(planned);
    const res = await saveProject({ ...payload, id }, studio.mode).catch(() => null);
    if (!res?.ok) return null;
    rememberClipProject(id, planned);
    return id;
  };

  const handleStartExport = (
    plan: ExportPlan,
    onComplete: (blob: Blob, renderMs: number, health: ExportHealth) => void
  ) => {
    exportedResolution.current = `${plan.width}x${plan.height}`;
    renderedProject.current = currentProjectPayload();
    startExport(audioElementRef.current, { start: exportRange.start, end: exportRange.end }, plan, onComplete);
  };

  /**
   * What the export dialog would render here, as a job for the server. See
   * `lib/serverRender.ts`. The project is saved as the job is sent -- the tab
   * may be closed long before the file is ready -- and the job carries its id
   * for the export log.
   */
  const buildServerRender = async (plan: ExportPlan) => {
    const audio = audioElementRef.current;
    const fileName = exportFileName(surahNameEnglish, clipPassage.surahNumber, clipPassage.start, clipPassage.end, 'mp4');
    const projectId = await saveRenderedProject({ ...currentProjectPayload(), aspectRatio: plan.aspectRatio });
    return buildRenderForm({
      config: { ...canvasConfig, aspectRatio: plan.aspectRatio },
      verses,
      surahNameArabic,
      surahNameEnglish,
      reciterName: selectedReciterMeta?.name,
      surahNumber: selectedSurah,
      ayahStart,
      ayahEnd,
      syncBackgroundVideo: uploadIsVideo && useVideoAsBackground && canvasConfig.bgUrl === videoBgUrl,
      backgroundTimeOffset: videoBgOffset,
      range: { start: exportRange.start, end: exportRange.end },
      plan: { width: plan.width, height: plan.height, fps: plan.fps, bitrate: plan.bitrate },
      fileName: withAspect(fileName, plan.aspectRatio),
      title: `${surahNameEnglish} GPU Clip`,
      projectId: projectId ?? undefined,
    }, audio?.currentSrc || audio?.src || '');
  };

  /** The background lane over what is about to be rendered, for the export dialog to check. */
  const exportLane = useMemo(() => ({
    segments: bgSegments,
    handCut: canvasConfig.bgMode === 'custom',
    start: exportRange.start,
    end: exportRange.end,
  }), [bgSegments, canvasConfig.bgMode, exportRange.start, exportRange.end]);

  /** What a finished render is checked against: see `lib/renderCheck.ts`. */
  const renderCheckInput = useMemo(() => ({
    range: { start: exportRange.start, end: exportRange.end },
    fps: canvasConfig.fps,
    sourceUrl: customAudioUrl || audioUrl,
    lane: bgSegments,
    layout: canvasConfig.layout,
    overlayOpacity: canvasConfig.bgOverlayOpacity,
  }), [exportRange.start, exportRange.end, canvasConfig.fps, customAudioUrl, audioUrl,
      bgSegments, canvasConfig.layout, canvasConfig.bgOverlayOpacity]);

  /** The frame the finished file has, whichever path produced it. */
  const renderedResolution = () => {
    const made = exportOutput.current;
    return made ? `${made.width}x${made.height}` : exportedResolution.current;
  };

  const handleSaveExportRecord = async ({ fileName, fileSizeBytes, durationSec, renderMs }: { fileName: string; fileSizeBytes: number; durationSec: number; renderMs: number }) => {
    try {
      const projectId = await saveRenderedProject(renderedProject.current);
      // A public studio keeps no render log; the project is in this browser.
      if (studio.mode === 'public') return;
      await fetch('/api/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          title: `${surahNameEnglish} GPU Clip`,
          fileName,
          fileSizeBytes,
          aspectRatio: canvasConfig.aspectRatio,
          duration: Math.round(durationSec),
          resolution: renderedResolution(),
          fps: canvasConfig.fps,
          renderTimeMs: Math.round(renderMs),
          gpuDevice: describeGpu()
        })
      });
    } catch {
      // ignore
    }
  };

  /**
   * Puts back the recitation a saved project was built from.
   *
   * The stored copy first, which needs nothing from the user. Failing that the
   * project still knows which file it came from and where in it its audio sat,
   * so it asks for that file rather than leaving a dead `blob:` url and silence.
   *
   * Every field here is set on both paths, including to nothing: loading a
   * reciter project after working on an upload has to clear the upload, or the
   * next save writes that file's name against audio it has no relation to.
   */
  const restoreProjectAudio = async (proj: any) => {
    const fileName: string = proj.audioFileName || '';
    const trim = proj.trimWindow && proj.trimWindow.end > proj.trimWindow.start ? proj.trimWindow : null;

    if (!fileName) {
      setCustomAudioFile(null);
      setCustomAudioUrl(null);
      setCustomAudioName('');
      setCustomAudioDuration(0);
      setUploadOriginalName('');
      setAudioKey('');
      setAwaitingAudio(null);
      setTrimWindow(null);
      setVideoBgOffset(0);
      setUploadIsVideo(false);
      return;
    }

    const blob = proj.audioKey ? await loadProjectAudio(proj.audioKey) : null;
    setUploadOriginalName(fileName);
    setTrimWindow(trim);
    setVideoBgOffset(trim ? trim.start : 0);
    setUploadIsVideo(false);

    if (!blob) {
      // Nothing to play yet, so the timeline on screen is waiting for a file.
      setCustomAudioFile(null);
      setCustomAudioUrl(null);
      setCustomAudioName('');
      setCustomAudioDuration(0);
      setAudioKey('');
      setAwaitingAudio({ fileName, trim });
      setMatchStatus({ text: t.match.awaitingAudio(fileName), tone: 'info' });
      return;
    }

    // Stored as the file the timeline belongs to, so it is adopted as it is --
    // no re-cut, and nothing to recompute.
    const file = new File([blob], fileName, { type: blob.type || 'audio/wav' });
    const url = URL.createObjectURL(file);
    setCustomAudioFile(file);
    setCustomAudioUrl(url);
    setCustomAudioName(fileName);
    setAudioKey(proj.audioKey);
    setAwaitingAudio(null);
    setAudioUrl(url);
    const measured = await measureAudioDuration(url);
    setCustomAudioDuration(measured);
    if (measured > 0) setAudioDuration(measured);
    if (audioElementRef.current) {
      audioElementRef.current.src = url;
      audioElementRef.current.currentTime = 0;
      audioElementRef.current.load();
    }
  };

  /**
   * Load a project from the saved-projects drawer.
   *
   * Asynchronous for one reason: an uploaded background is stored in the
   * library by id, and turning that id back into something the canvas can play
   * needs the library read from IndexedDB first. `hydrateLibrary` runs once per
   * session and the Style panel calls it too -- but only once that panel has
   * been opened, and a project can be loaded without ever opening it.
   */
  const handleLoadSavedProject = async (proj: any) => {
    if (!proj) return;
    // Saving or rendering it from here updates this project.
    if (typeof proj.id === 'string') rememberClipProject(proj.id, proj);
    setSelectedSurah(proj.surahNumber || 1);
    setAyahStart(proj.ayahStart || 1);
    setAyahEnd(proj.ayahEnd || 7);
    setAyahStartInput(String(proj.ayahStart || 1));
    setAyahEndInput(String(proj.ayahEnd || 7));
    setSurahNameArabic(proj.surahNameArabic || 'الفاتحة');
    setSurahNameEnglish(proj.surahNameEnglish || 'Al-Fatihah');
    setSelectedReciter(proj.reciterId || 'sudais');
    setAudioUrl(proj.audioUrl || DEFAULT_AUDIO_URL);
    setVerses(proj.versesJson || []);
    setIsSampleProject(false);
    // Overrides the url just set whenever this project came from an upload --
    // `proj.audioUrl` is that upload's `blob:` url, which died with the tab
    // that made it.
    void restoreProjectAudio(proj);
    // The list checked this project's content on the way here and took out an
    // edition nobody serves any more. Said once, now, since it changes what
    // the card shows.
    if (Array.isArray(proj.syncRemovedIds) && proj.syncRemovedIds.length) {
      setMatchStatus({ text: t.match.translationsRemoved(proj.syncRemovedIds.join(', ')), tone: 'info' });
    }

    // Before the config is set, not after: an unresolved reference reaching
    // the canvas would be a url it cannot play.
    await hydrateLibrary();

    setCanvasConfig(withRestoredBackgrounds({
      ...canvasConfig,
      aspectRatio: proj.aspectRatio || '9:16',
      // A project saved before the Google faces were removed still names one.
      fontArabic: resolveArabicFont(proj.fontArabic),
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
      // An empty list is what a row written before this column existed holds,
      // and it means "the default" rather than "no translation at all".
      translationIds: Array.isArray(proj.translationIds) && proj.translationIds.length
        ? proj.translationIds
        : [DEFAULT_TRANSLATION_ID],
      translationFollowsWords: proj.translationFollowsWords ?? false,
      mushafLines: proj.mushafLines ?? false,
      showWaveform: proj.showWaveform ?? true,
      showSurahBadge: proj.showSurahBadge ?? true,
      badgeStyle: asBadgeStyle(proj.badgeStyle),
      badgeOpacity: proj.badgeOpacity ?? DEFAULT_BADGE_OPACITY,
      layout: asFrameLayout(proj.layout),
      captionTransition: asCaptionTransition(proj.captionTransition),
      wordEffect: asWordEffect(proj.wordEffect),
      motionSpeed: asMotionSpeed(proj.motionSpeed),
      highlightColor: asHighlightColour(proj.highlightColor),
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
      watermarkText: proj.watermarkText || 'Quran-Clipper',
      watermarkPosition: proj.watermarkPosition || 'bottom-right',
      fps: proj.fps || 60,
      gpuAccelerated: proj.gpuAccelerated ?? true
    }));
  };

  const currentSurahObj = SURAHS_LIST.find(s => s.number === selectedSurah) || SURAHS_LIST[0];

  /** Whether a passage is loaded or matched, as opposed to the sample the studio opens on. */
  const hasClip = !isSampleProject && verses.length > 0;
  /** A restored project waiting for its recording needs the drop zone, whatever was chosen. */
  const shownSourceMode = awaitingAudio ? 'recording' : sourceMode;

  /**
   * The timing engine, as a compact list with each option's live status, and
   * the settings that go with it. Shown in full for a recording, and folded
   * away for a built-in reciter, where it only drives "Align to the recording".
   */
  const engineSettings = (
    <div className="flex flex-col gap-2">
      <fieldset className="min-w-0">
        <legend className="text-xs font-semibold text-slate-300 mb-1.5">{t.source.engineLabel}</legend>
        <div className="flex flex-col gap-1.5">
          {matchOptions.map(opt => {
            const selected = matchProvider === opt.id;
            // Only ever true in an older public build; a public studio now
            // lists only its own engine.
            const offline = studio.mode === 'public' && opt.id === 'gemini';
            return (
              <label
                key={opt.id}
                title={offline ? t.source.matcherOnlinePublic : t.source.matcherUses(opt.technical)}
                className={`px-3 py-2.5 rounded-lg border flex items-center gap-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold ${
                  offline ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                } ${selected ? 'border-amber-500 bg-amber-500/10' : 'border-slate-800 hover:border-slate-700'}`}
              >
                <input
                  type="radio"
                  name="matcher"
                  value={opt.id}
                  checked={selected}
                  disabled={offline}
                  onChange={() => setMatchProvider(opt.id)}
                  className="w-4 h-4 accent-amber-500"
                />
                <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-100">
                  {opt.label}
                  {opt.experimental && (
                    <span className="ms-1.5 align-middle rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      {t.source.matcherExperimental}
                    </span>
                  )}
                </span>
                <span className={`text-xs ${opt.ready ? 'text-emerald-300' : 'text-amber-300'}`}>{opt.status}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <p className="text-xs leading-relaxed text-slate-400">{selectedMatchOption.blurb}</p>
                    {matchProvider === 'phoneme-lab' && (
                      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-300">
                        {(Object.keys(LAB_CHOICES) as (keyof typeof LAB_CHOICES)[]).map(stage => (
                          <label key={stage} className="flex flex-col gap-0.5">
                            <span>{t.source.labStage[stage]}</span>
                            <select
                              value={lab[stage]}
                              onChange={e => setLab(prev => ({ ...prev, [stage]: e.target.value }))}
                              className="rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-slate-100"
                            >
                              {LAB_CHOICES[stage].map(choice => (
                                <option key={choice} value={choice}>{t.source.labModel[choice]}</option>
                              ))}
                            </select>
                          </label>
                        ))}
                        <label className="flex items-center gap-2 self-end pb-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={lab.published}
                            onChange={e => setLab(prev => ({ ...prev, published: e.target.checked }))}
                            className="accent-amber-500"
                          />
                          <span>{t.source.labPublished}</span>
                        </label>
                      </div>
                    )}
                    {matchProvider === 'qul' && (
                      <label className="flex items-start gap-2 mt-1.5 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={skipAlignerSetting}
                          onChange={e => skipAlignerPreference.set(e.target.checked)}
                          className="mt-0.5 accent-amber-500"
                        />
                        <span>
                          <span className="block">{t.source.skipAlignerTimed}</span>
                          <span className="block text-slate-400">{t.source.skipAlignerTimedHelp}</span>
                        </span>
                      </label>
                    )}
      {matchProvider !== 'gemini' && (
        <details className="text-[13px]" open={advancedOpen} onToggle={e => setAdvancedOpen(e.currentTarget.open)}>
          <summary className="cursor-pointer select-none text-slate-400 hover:text-slate-200">
            {t.source.advanced(screenBreaks === 'fewer' ? t.source.screenBreaksFewer : screenBreaks === 'more' ? t.source.screenBreaksMore : t.source.screenBreaksNormal)}
          </summary>
          <div className="mt-2">
                      <fieldset className="min-w-0">
                        <legend className="text-xs font-semibold text-slate-400 block mb-1">{t.source.screenBreaksLabel}</legend>
                        <div className="grid grid-cols-3 gap-1.5">
                          {SCREEN_BREAKS.map((level, index) => (
                            <label
                              key={level}
                              className={`py-1 rounded-md border text-center text-xs font-bold transition-all cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-amber-400 ${
                                screenBreaks === level
                                  ? 'bg-amber-500/15 border-amber-500 text-slate-100'
                                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                              }`}
                            >
                              <input
                                type="radio"
                                name="screen-breaks"
                                value={level}
                                checked={screenBreaks === level}
                                onChange={() => screenBreaksPreference.set(index - 1)}
                                className="sr-only"
                              />
                              {level === 'fewer' ? t.source.screenBreaksFewer : level === 'more' ? t.source.screenBreaksMore : t.source.screenBreaksNormal}
                            </label>
                          ))}
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{t.source.screenBreaksHelp}</p>
                        {/* Built-in reciters timed from published timings alone
                            never reach the aligner, so the setting cannot touch them. */}
                        {matchProvider === 'qul' && skipAlignerSetting && (
                          <p className="text-xs text-slate-300 mt-1">{t.source.screenBreaksUploadsOnly}</p>
                        )}
                      </fieldset>
          </div>
        </details>
      )}
                    {!selectedMatchOption.ready && selectedMatchOption.fix && (
                      <p className="text-xs text-amber-400/90 mt-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 p-2">
                        {selectedMatchOption.fix}
                      </p>
                    )}
                    {/* Kept because they are diagnostics with a fix, not descriptions:
                        the blurb above already says what the option does. */}
                    {matchProvider !== 'gemini' && providerStatus?.align.alignReady === false && (
                      <div className="text-xs text-red-300 mt-1.5 rounded-md bg-red-500/10 border border-red-500/25 p-2 space-y-1">
                        <p className="font-semibold">{t.source.matcherEngineFailedTitle}</p>
                        <p>{t.source.matcherEngineFailedBody}</p>
                        <code className="block font-mono bg-slate-950/70 rounded px-1.5 py-1 text-xs text-slate-300">cd asr-service &amp;&amp; hash -r &amp;&amp; ./run.sh</code>
                        {providerStatus.align.alignError && (
                          <p className="text-red-400/80 break-words">{providerStatus.align.alignError.slice(0, 180)}</p>
                        )}
                      </div>
                    )}
    </div>
  );

  /** Where a match has got to, or why it stopped. */
  const matchStatusBlock = matchStatus && (
    <div className={`text-xs rounded-lg p-3 flex items-start gap-2.5 ${
      isMatching
        ? 'bg-blue-500/10 border border-blue-500/30 text-slate-200'
        : matchStatus.tone === 'error'
        ? 'bg-red-500/10 border border-red-500/20 text-red-300'
        : 'bg-amber-500/10 border border-amber-500/20 text-amber-300'
    }`}>
      {isMatching && (
        <span className="shrink-0 mt-0.5 flex h-4 w-4 items-center justify-center">
          <span className="animate-spin h-3.5 w-3.5 border-2 border-blue-400 border-t-transparent rounded-full"></span>
        </span>
      )}
      <span className="flex-1">{matchStatus.text}</span>
    </div>
  );

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
        onCanPlay={handleCanPlay}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={(e) => {
          if (recoverAudio()) return;
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

      {/* Top Navbar.

          One primary action, Export. Everything else is either the project
          itself (its name and where it is kept, on the left) or secondary
          (Projects, Help, and the ⋯ menu holding theme, language and tools).
          Ten controls of equal weight used to compete with Export here. */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md px-2 sm:px-4 flex items-center justify-between gap-2 shrink-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          {/* Not a link. The studio is the only page, so the wordmark had
              nowhere to go -- and because the whole project lives in component
              state, clicking it navigated away and silently discarded unsaved
              work. */}
          <span className="font-display text-xl leading-none text-parchment truncate">{t.header.wordmark}</span>

          {/* The clip: the reference set the way a mushaf cites itself, who
              recites it, and where the work is kept right now. */}
          <div className="hidden md:flex flex-col min-w-0 ms-1 ps-4 border-s border-slate-800">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-display text-base text-parchment/90 truncate">
                {locale === 'ar' ? currentSurahObj.nameArabic : surahNameEnglish}
              </span>
              <span className="font-mono text-[11px] text-gold tracking-wider shrink-0" dir="ltr">
                {selectedSurah}:{ayahStart}&ndash;{ayahEnd}
              </span>
              <span className="text-xs text-slate-400 truncate">
                {customAudioFile ? customAudioName : selectedReciterMeta?.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400 min-w-0">
              {saveStatus?.kind === 'pending' ? (
                <Loader2 className="w-3 h-3 text-amber-400 animate-spin shrink-0" />
              ) : saveStatus?.kind === 'error' ? (
                <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
              ) : (
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${saveStatus?.kind === 'ok' || draftSavedAt !== null ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              )}
              <span className={`truncate ${saveStatus?.kind === 'error' ? 'text-red-300' : ''}`} title={saveStatus?.detail}>{saveLine}</span>
              <span aria-hidden="true">·</span>
              <button
                onClick={handleSaveProject}
                title={t.header.saveProjectTitle}
                className="shrink-0 text-amber-400 hover:text-amber-300 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded"
              >
                {t.header.saveToProjects}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Outside the menus on purpose: undoing a mis-drag is not a
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

          {/* The interface language is a choice people look for on the page
              itself, so it stays in the bar; only a phone, short of room,
              moves it into the ⋯ menu. */}
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>

          <div className="hidden sm:block">
            <Button onClick={() => setIsProjectsDrawerOpen(true)} icon={<FolderOpen className="w-3.5 h-3.5 text-amber-400" />}>
              {t.header.savedClips}
            </Button>
          </div>

          {/* On a phone the bar holds undo, ⋯ and Export only; Help's
              entries join the ⋯ menu there. */}
          <div className="hidden sm:block">
            <OverflowMenu items={helpItems} label={t.header.help} icon={<HelpCircle className="w-4 h-4" />} />
          </div>
          <OverflowMenu
            items={moreItems}
            label={t.header.moreMenu}
            footer={
              <>
                <div className="px-2.5 py-2 sm:hidden"><LanguageSwitcher /></div>
                <PaletteList />
                <div className="mt-1 border-t border-slate-800"><HealthStrip /></div>
              </>
            }
          />

          <Button variant="primary" size="md" onClick={() => setIsExportModalOpen(true)} icon={<Sparkles className="w-4 h-4 fill-current" />} data-tour="export">
            {t.header.export}
          </Button>
        </div>
      </header>

      {/* Studio workspace.

          One working panel and the preview, over one full-width timeline. The
          panel's tabs follow the order a clip is made -- Source, Captions,
          Style -- and every tab stays reachable at any time. It replaced a
          Source column and an Inspector column, which kept the once-per-clip
          Source form on screen for good and left the preview the least room. */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* Below `lg` the preview sits above the panel (hence the reverse) and
            the bottom bar picks the panel's tab. */}
        <div className="flex-1 flex flex-col-reverse lg:flex-row overflow-hidden min-h-0">

          {/* Working panel */}
          <aside
            aria-label={t.panel.label}
            className="w-full lg:w-[400px] flex-1 lg:flex-none min-h-0 border-e border-slate-800 bg-slate-900/60 backdrop-blur-sm flex flex-col overflow-hidden"
          >
            <PanelTabs value={panelTab} onChange={setPanelTab} toCheck={toCheckCount} />
            {/* Source stays mounted while hidden, so a half-filled form or a
                pending upload is where it was left on coming back. */}
            <div
              id="panel-source"
              role="tabpanel"
              aria-labelledby="panel-tab-source"
              hidden={panelTab !== 'source'}
              data-tour="panel-source"
              className="flex-1 overflow-y-auto p-3"
            >
              {pendingDraft && (
                <div className="mb-3 rounded-lg border border-lapis-bright/40 bg-lapis-bright/10 p-2.5 text-xs text-slate-200 flex flex-col gap-2">
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

              {isSampleProject && !pendingDraft && (
                <p className="mb-4 text-[13px] leading-relaxed text-slate-400 flex items-start gap-2">
                  <BookOpen className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" aria-hidden="true" />
                  {t.source.sampleHint}
                </p>
              )}
              <div className="flex flex-col gap-4 text-[13px]">
                {/* A loaded clip shows as a summary: the form has done its
                    job, and what matters now is what the clip is and where to
                    go next. "Edit source and match" brings the form back,
                    with the screen breaks open, since a re-match is usually
                    for those. */}
                {hasClip && !sourceEditing && !awaitingAudio ? (
                  <>
                    <section aria-label={t.source.summaryLabel} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex flex-col gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-slate-100">
                          {locale === 'ar' ? currentSurahObj.nameArabic : surahNameEnglish}{' '}
                          <span className="font-mono text-sm text-gold" dir="ltr">{selectedSurah}:{ayahStart}&ndash;{ayahEnd}</span>
                        </h3>
                        <p className="text-[13px] text-slate-400">
                          {customAudioFile ? `${t.source.yourRecording} · ${customAudioName}` : selectedReciterMeta?.name}
                        </p>
                      </div>
                      <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-[13px]">
                        <dt className="text-slate-400">{t.source.lengthLabel}</dt>
                        <dd className="font-mono text-slate-200" dir="ltr">{formatDuration(audioDuration)}</dd>
                        <dt className="text-slate-400">{t.source.captionsLabel}</dt>
                        <dd className="text-slate-200">{verses.length}</dd>
                      </dl>
                      {regroup.available(audioUrl) && (
                        <ScreenBreaksRecut
                          value={screenBreaks}
                          busy={regroup.busy}
                          confirming={recutConfirm}
                          onChoose={chooseScreenBreaks}
                          onConfirm={() => recutConfirm && void runRecut(recutConfirm)}
                          onCancel={() => setRecutConfirm(null)}
                        />
                      )}
                      {matchStatusBlock}
                {hasClip && loadResult && !(isPublic && loadResult.ok && !loadResult.againstUpload && loadResult.timingSource === 'measured') && (
                  <div
                    role="status"
                    className={`mt-2 rounded-lg border p-2.5 text-xs ${
                      !loadResult.ok
                        ? 'bg-red-500/10 border-red-500/30 text-red-200'
                        : loadResult.againstUpload
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                    }`}
                  >
                    <span className="font-semibold">
                      {loadResult.ok ? t.source.loadedCount(loadResult.count ?? 0) : loadResult.error || t.source.loadFailed}
                    </span>
                    {loadResult.ok && (
                      <button
                        onClick={() => setSelectedIndex(0)}
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
                      <div className={`mt-2 grid gap-2 ${isPublic ? 'grid-cols-1' : 'grid-cols-2'}`}>
                        <button
                          onClick={handleAutoMatchReciter}
                          disabled={isMatching}
                          title={t.match.alignReciterTitle}
                          className="py-2 px-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                        >
                          {isMatching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          <span>{t.match.alignReciter}</span>
                        </button>
                        {!isPublic && (<>
                        {/* The third way to time a recitation, and the only one
                            that is not inference. Offered only where it exists:
                            three of the built-in reciters have no quran.com id
                            at all, and their recordings were never measured. */}
                        <button
                          onClick={handleReciterSegments}
                          disabled={isMatching || !selectedReciterMeta?.quranApiId}
                          title={
                            selectedReciterMeta?.quranApiId
                              ? t.match.segmentsTitle
                              : t.match.segmentsUnavailable
                          }
                          className="py-2 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 font-bold rounded-lg border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          <span>{t.match.segments}</span>
                        </button>
                        {/* QUL's timings, beside quran.com's rather than instead
                            of them, so one passage can be timed both ways. */}
                        <button
                          onClick={handleQulSegments}
                          disabled={isMatching || !qulTimedReciters.includes(selectedReciter)}
                          title={
                            qulTimedReciters.includes(selectedReciter)
                              ? t.match.qulSegmentsTitle
                              : t.match.qulSegmentsUnavailable(selectedReciter)
                          }
                          className="col-span-2 py-2 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 font-bold rounded-lg border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Library className="w-3.5 h-3.5 text-amber-400" />
                          <span>{t.match.qulSegments}</span>
                        </button>
                        </>)}
                      </div>
                    )}
                  </div>
                )}
                  {uploadIsVideo && videoBgUrl && (
                    <label className="mt-2 flex items-start gap-2 text-xs text-slate-300 cursor-pointer select-none">
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
                        <span className="block text-xs text-slate-300">
                          {t.source.useVideoAsBackgroundHelp}
                          {videoBgOffset > 0
                            ? t.source.useVideoAsBackgroundOffset(formatDuration(videoBgOffset))
                            : ''}
                          .
                        </span>
                      </span>
                    </label>
                  )}

                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => { setSourceMode(customAudioFile ? 'recording' : 'reciter'); setAdvancedOpen(true); newClipPending.current = false; setSourceEditing(true); }}>
                          {t.source.editSource}
                        </Button>
                        {customAudioFile && (
                          <Button icon={<Scissors className="w-3.5 h-3.5 text-amber-400" />} onClick={() => setShowTrimModal(true)}>
                            {customAudioDuration > 0
                              ? t.header.trimAudioWithLength(formatDuration(customAudioDuration))
                              : t.header.trimAudio}
                          </Button>
                        )}
                      </div>
                    </section>

                    {/* Where the work goes next, said once the passage is in. */}
                    <div className="rounded-xl border border-amber-500/40 p-4 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-100">{t.source.nextReview}</p>
                        <p className="text-xs text-slate-400">{t.source.nextReviewBody(toCheckCount)}</p>
                      </div>
                      <Button variant="primary" onClick={() => setPanelTab('captions')}>{t.source.review}</Button>
                    </div>
                  </>
                ) : (
                  <>
                    {hasClip && (
                      <button
                        onClick={() => { newClipPending.current = false; setSourceEditing(false); }}
                        className="self-start text-[13px] font-semibold text-amber-300 hover:text-amber-200"
                      >
                        {t.source.backToClip}
                      </button>
                    )}

                    {/* The two ways in, one at a time: each person sees only
                        their own path, with its main action above the fold. */}
                    <fieldset className="min-w-0">
                      <legend className="sr-only">{t.source.modeLabel}</legend>
                      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl border border-slate-800 bg-slate-950">
                        {(['reciter', 'recording'] as const).map(mode => (
                          <label
                            key={mode}
                            className={`h-10 rounded-lg flex items-center justify-center text-[13px] font-semibold cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold ${
                              shownSourceMode === mode ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
                            }`}
                          >
                            <input
                              type="radio"
                              name="source-mode"
                              checked={shownSourceMode === mode}
                              onChange={() => setSourceMode(mode)}
                              className="sr-only"
                            />
                            {mode === 'reciter' ? t.source.modeReciter : t.source.modeRecording}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {shownSourceMode === 'reciter' ? (
                      <>
                {/* Surah Selector */}
                <div>
                  <label htmlFor="surah-select" className="text-xs font-semibold text-slate-300 block mb-1.5">{t.source.selectSurah}</label>
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
                    className="w-full h-11 bg-slate-950 border border-slate-700 rounded-lg px-3 text-slate-100 text-sm"
                  >
                    {SURAHS_LIST.map((s) => (
                      <option key={s.number} value={s.number}>
                        {t.source.surahOption(s.number, s.nameEnglish, s.nameArabic, s.numberOfAyahs)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Ayah Range */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="ayah-start" className="text-xs font-semibold text-slate-300 block mb-1.5">{t.source.startAyah}</label>
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
                      className="w-full h-11 bg-slate-950 border border-slate-700 rounded-lg px-3 text-sm text-slate-100 font-mono text-start"
                    />
                  </div>

                  <div>
                    <label htmlFor="ayah-end" className="text-xs font-semibold text-slate-300 block mb-1.5">{t.source.endAyah}</label>
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
                      className="w-full h-11 bg-slate-950 border border-slate-700 rounded-lg px-3 text-sm text-slate-100 font-mono text-start"
                    />
                  </div>
                </div>

                {/* Reciter Selector */}
                <div>
                  <label htmlFor="reciter-select" className="text-xs font-semibold text-slate-300 block mb-1.5">{t.source.selectReciter}</label>
                  <select
                    id="reciter-select"
                    value={selectedReciter}
                    onChange={(e) => setSelectedReciter(e.target.value)}
                    className="w-full h-11 bg-slate-950 border border-slate-700 rounded-lg px-3 text-slate-100 text-sm"
                  >
                    {/* A project saved with a reciter since hidden still shows who it is. */}
                    {[
                      ...listedReciters(qulTimedReciters),
                      ...RECITERS.filter(r => r.id === selectedReciter && !listedReciters(qulTimedReciters).includes(r)),
                    ].map((r) => (
                      <option key={r.id} value={r.id}>
                        {locale === 'ar' ? `${r.arabicName} — ${r.name}` : `${r.name} — ${r.arabicName}`}
                      </option>
                    ))}
                  </select>
                  {/* Whether this voice has published ayah timings decides
                      whether "Load ayahs & audio" produces a real timeline
                      or one you have to set by hand, so it stays beside the
                      choice rather than in a note underneath it. */}
                  {selectedReciterMeta && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {/* Timed by quran.com, or by a QUL export on this machine. */}
                      {(selectedReciterMeta.quranApiId > 0 || qulTimedReciters.includes(selectedReciterMeta.id)) && (
                        <span
                          title={t.source.reciterTimedTitle}
                          className="text-xs font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded"
                        >
                          {t.source.reciterTimed}
                        </span>
                      )}
                      <span className="text-xs text-slate-300 bg-slate-900 px-2 py-0.5 rounded">
                        {t.source.reciterStyles[selectedReciterMeta.style as keyof typeof t.source.reciterStyles] ?? selectedReciterMeta.style}
                      </span>
                    </div>
                  )}
                </div>

                        <button
                          onClick={handleLoadSurahVerses}
                          disabled={isLoadingVerses}
                          className="w-full h-12 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 text-[15px] font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                        >
                          {isLoadingVerses ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
                          <span>{isLoadingVerses ? t.source.loadingVerses : t.source.loadVerses}</span>
                        </button>
                        {!hasClip && loadResult && !loadResult.ok && (
                          <p role="status" className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200">
                            {loadResult.error || t.source.loadFailed}
                          </p>
                        )}
                        {/* The engine matters here too: it is what "Align to the
                            recording" uses after a load, and Local + QUL can time
                            a built-in reciter from published timings alone. */}
                        <details className="text-[13px]">
                          <summary className="cursor-pointer select-none text-slate-400 hover:text-slate-200">
                            {t.source.engineSummary(selectedMatchOption.label)}
                          </summary>
                          <div className="mt-3">{engineSettings}</div>
                        </details>
                      </>
                    ) : (
                      <>
                        <div
                          {...recitationDrop.dropHandlers}
                          className={`relative rounded-xl border-2 border-dashed px-4 py-6 flex flex-col items-center gap-2 text-center cursor-pointer transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold ${
                            recitationDrop.isOver ? 'border-amber-400 bg-amber-500/10' : 'border-slate-700 hover:border-amber-500/50 bg-slate-950/70'
                          }`}
                        >
                          <input
                            type="file"
                            accept="audio/*,video/*,.mkv,.m4v,.mov"
                            onChange={handleCustomAudioUpload}
                            id="recitation-upload"
                            aria-describedby="recitation-upload-help"
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                          {uploadIsVideo ? <Video className="w-6 h-6 text-amber-400" /> : <Upload className="w-6 h-6 text-amber-400" />}
                          <span className="text-sm font-semibold text-slate-100">
                            {recitationDrop.isOver ? t.source.dropHere : customAudioName || t.source.dropTitle}
                          </span>
                          <span id="recitation-upload-help" className="text-xs leading-relaxed text-slate-400">{t.source.dropHelp}</span>
                        </div>

                        {customAudioFile && (
                          <TrimStep
                            length={customAudioDuration > 0 ? formatDuration(customAudioDuration) : ''}
                            onTrim={() => setShowTrimModal(true)}
                          />
                        )}

                        {engineSettings}

                        <div className="flex flex-col gap-2">
                          <button
                            onClick={handleAutoMatchUploadedAudio}
                            disabled={!customAudioFile && !customAudioUrl}
                            className="w-full h-12 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-950 text-[15px] font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                          >
                            <Sparkles className="w-4 h-4" />
                            {t.source.matchRecording}
                          </button>
                          {customAudioFile || customAudioUrl ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <Button icon={<Clock className="w-3.5 h-3.5 text-amber-400" />} onClick={handleManualMatchUploadedAudio}>
                                {t.source.timeByHand}
                              </Button>
                            </div>
                          ) : (
                            <p className="text-xs text-slate-400 text-center">{t.source.chooseFileFirst}</p>
                          )}
                        </div>
                  {uploadIsVideo && videoBgUrl && (
                    <label className="mt-2 flex items-start gap-2 text-xs text-slate-300 cursor-pointer select-none">
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
                        <span className="block text-xs text-slate-300">
                          {t.source.useVideoAsBackgroundHelp}
                          {videoBgOffset > 0
                            ? t.source.useVideoAsBackgroundOffset(formatDuration(videoBgOffset))
                            : ''}
                          .
                        </span>
                      </span>
                    </label>
                  )}

                        {!hasClip && matchStatusBlock}
                        <button
                          onClick={() => setIsBatchOpen(true)}
                          className="self-start flex items-center gap-1.5 text-[13px] font-semibold text-amber-300 hover:text-amber-200"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          {t.batch.button}
                        </button>
                      </>
                    )}
                  </>
                )}


              </div>
            </div>
            {panelTab === 'captions' && (
              <div id="panel-captions" role="tabpanel" aria-labelledby="panel-tab-captions" data-tour="panel-captions" className="flex-1 overflow-y-auto">
                {isLoadingVerses ? (
                  <InspectorSkeleton />
                ) : (
                  <Inspector
                    verses={verses}
                    index={selectedIndex}
                    isActive={selectedIndex === activeVerseIndex}
                    onText={edit.text}
                    translationIds={canvasConfig.translationIds?.length ? canvasConfig.translationIds : [DEFAULT_TRANSLATION_ID]}
                    onTranslationIds={ids => setCanvasConfig(prev => ({ ...prev, translationIds: ids }))}
                    onTranslationText={edit.translationText}
                    translationFollowsWords={!!canvasConfig.translationFollowsWords}
                    onTranslationFollowsWords={follows =>
                      setCanvasConfig(prev => ({ ...prev, translationFollowsWords: follows }))}
                    onVerseNumber={edit.verseNumber}
                    onToggleWord={edit.toggleWord}
                    onNudge={(edge, delta) => edit.nudge(edge, delta, audioDuration, rippleEdits)}
                    onReorder={edit.reorder}
                    onDuplicate={() => edit.duplicate(audioDuration)}
                    onDelete={edit.remove}
                    onAdd={edit.add}
                    currentTime={currentTime}
                    onSelect={i => {
                      setSelectedIndex(i);
                      handleSeek(verses[i].startTime);
                    }}
                    onSplit={() => edit.split(currentTime)}
                    onMerge={edit.merge}
                    onChecked={edit.checked}
                  />
                )}
              </div>
            )}
            {panelTab === 'style' && (
              <div id="panel-style" role="tabpanel" aria-labelledby="panel-tab-style" data-tour="panel-style" className="flex-1 overflow-y-auto">
                <StyleConfigPanel
                  config={canvasConfig}
                  onChangeConfig={setCanvasConfig}
                  clipDuration={audioDuration}
                  laneBlocks={bgSegments}
                  selectedBackground={activeBackground}
                  onSelectBackground={setSelectedBackground}
                />
              </div>
            )}
          </aside>

          {/* Preview */}
          <main
            aria-label={t.surfaces.preview}
            // On a phone: pinned above the panel while captions or style are
            // being worked on, so what changes is in view; on Source there is
            // nothing to look at yet, and the form gets the height.
            className={`lg:flex-1 flex-col items-center justify-center p-2 lg:p-4 bg-slate-950 relative overflow-hidden min-w-0 max-lg:h-[36vh] max-lg:shrink-0 ${
              panelTab === 'source' ? 'hidden' : 'flex'
            } lg:flex`}
          >
          {/* On a phone the frame is chosen from the Style tab, where its
              bar still sits over the preview. */}
          <div className={`w-full ${panelTab === 'style' ? '' : 'max-lg:hidden'}`}>
            <FrameBar
              aspectRatio={canvasConfig.aspectRatio}
              chosenIndex={Math.round(frameIndex)}
              onChoose={chooseFrame}
              safeArea={showSafeArea}
              onSafeArea={safeAreaPreference.set}
            />
          </div>
          {/* Main Video Canvas WYSIWYG Renderer.

              Sized to the space left under the frame bar rather than to the
              window: a size container, whose height the canvas reads through
              `--preview-max-h` (less the frame's own padding). Sized to 72vh,
              the canvas pushed the bar out of the top of the pane. */}
          <div
            className="flex-1 min-h-0 w-full flex items-center justify-center relative [container-type:size]"
            style={{ '--preview-max-h': 'calc(100cqh - 2.75rem)' } as React.CSSProperties}
          >
            {/* Click-to-play is scoped to the video itself, not the whole
                preview area, so clicking the surrounding background doesn't
                toggle playback. */}
            {/* The preview sits inside a jadwal -- the ruled frame a mushaf
                draws around its text block -- because that is exactly what the
                preview is. Chrome only; it is not in the exported video. */}
            <div className="jadwal relative cursor-pointer" onClick={playClip} title={isPlaying ? t.common.pause : t.common.play}>
              <div className="jadwal-inner overflow-hidden">
              <VideoCanvas
                ref={canvasRef}
                config={canvasConfig}
                verses={verses}
                currentTime={currentTime}
                playhead={playhead}
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
                showStats={SHOW_DEV_TOOLS}
                overlay={frameAreas.length > 0 ? (
                  <SafeAreaOverlay
                    areas={frameAreas}
                    platform={t.exportModal.presets[frame.id as keyof typeof t.exportModal.presets]}
                  />
                ) : undefined}
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

        </div>

        {/* Not on a phone's Source tab, which has nothing on it yet worth timing. */}
        <div className={panelTab === 'source' ? 'max-lg:hidden' : ''} data-tour="timeline">
        <Timeline
          verses={verses}
          audioUrl={customAudioUrl || audioUrl}
          audioDuration={audioDuration}
          currentTime={currentTime}
          isPlaying={isPlaying}
          selectedIndex={selectedIndex}
          onSelect={selectCaption}
          onSeek={handleSeek}
          onPlayPause={playClip}
          clip={passage}
          view={timelineWindow}
          loading={isLoadingVerses || isMatching}
          onReorder={reorderAt}
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
          onNextToCheck={goToNextCheck}
          onTrim={customAudioFile ? () => setShowTrimModal(true) : undefined}
          onTrimRange={customAudioFile ? handleTrimRange : undefined}
          trimHint={customAudioDuration > 0 ? formatDuration(customAudioDuration) : undefined}
          isMuted={isMuted}
          volume={volume}
          // The element is no longer poked here: `useAudioPlayback` keeps it in
          // step with whatever these set, which is also what applies a stored
          // volume on load rather than only once the slider is touched.
          onToggleMute={() => setIsMuted(!isMuted)}
          onVolume={v => {
            setVolume(v);
            setIsMuted(v === 0);
          }}
        />
        </div>
      </div>

      {/* The panel's tabs, where a thumb rests. The same three as on a desktop,
          in the same order, so one way of working holds on both. */}
      <nav
        aria-label={t.panel.label}
        className="lg:hidden shrink-0 border-t border-slate-800 bg-slate-900/95 backdrop-blur-md p-1.5 grid grid-cols-3 gap-1.5 z-30"
      >
        {([
          ['source', t.panel.source, BookOpen],
          ['captions', t.panel.captions, Film],
          ['style', t.panel.style, Sliders]
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            data-tour={`mtab-${id}`}
            onClick={() => setPanelTab(id)}
            aria-current={panelTab === id ? 'page' : undefined}
            className={`min-h-11 flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
              panelTab === id ? 'bg-gold text-ink' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span>{label}</span>
            {id === 'captions' && toCheckCount > 0 && (
              <span className="min-w-5 h-5 px-1.5 rounded-full bg-amber-500/90 text-ink text-[11px] font-bold flex items-center justify-center">{toCheckCount}</span>
            )}
          </button>
        ))}
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
        framePresetId={frame.id}
        onAspectRatio={(ratio: string) => setCanvasConfig(prev => ({ ...prev, aspectRatio: ratio }))}
        exportSeconds={exportRange.span}
        onSaveExportRecord={handleSaveExportRecord}
        publish={publishInput}
        translationIds={canvasConfig.translationIds || []}
        onRenderPreview={output =>
          renderPreview(
            audioElementRef.current,
            { start: exportRange.start, end: exportRange.end },
            output
          )
        }
        isPreviewing={previewing}
        previewProgress={previewProgress}
        buildServerRender={buildServerRender}
        exportLane={exportLane}
        renderCheck={renderCheckInput}
      />

      {/* Saved Projects Drawer */}
      <ShortcutsDialog isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />
      <OnboardingTour steps={tourSteps} isOpen={guide.isOpen} onClose={closeTour} onStep={index => setPanelTab(tourSteps[index].panel)} />
      <BatchMatchDialog
        isOpen={isBatchOpen}
        onClose={() => setIsBatchOpen(false)}
        provider="align"
        providerLabel={t.source.matcherLocal}
        providerReady={!!providerStatus?.align.configured && providerStatus.align.alignReady !== false}
        breaks={screenBreaks}
        measureDuration={measureFileDuration}
        onOpen={openBatchResult}
        onSave={saveBatchResult}
      />

      <SavedProjectsDrawer
        isOpen={isProjectsDrawerOpen}
        onClose={() => setIsProjectsDrawerOpen(false)}
        onLoadProject={handleLoadSavedProject}
        onNewClip={startNewClip}
        onSaveCurrent={handleSaveProject}
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
