'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import { 
  VideoCanvas, 
  VideoCanvasConfig
} from '@/components/VideoCanvas';
import { StyleConfigPanel } from '@/components/StyleConfigPanel';
import { AudioTrimModal, formatDuration } from '@/components/AudioTrimModal';
import { AudioEditModal } from '@/components/AudioEditModal';
import {
  NO_EDIT, editedAddress, editedLength, encodeEdit, isEdited, normalizeEdit, retime, splitAddress, toEdited, toSource,
  toTheEnd, trimmedTo, uploadEditAddress, withCuts, type AudioEdit,
} from '@/lib/audioEdit';
import { describeGpu } from '@/lib/gpuInfo';
import { useFileDrop } from '@/hooks/useFileDrop';
import type { ExportHealth } from '@/lib/exportHealth';
import type { ExportPlan } from '@/lib/exportPresets';
import { createBooleanPreference, createNumberPreference } from '@/lib/uiPreference';
import { recentReciters, reciterGroups, usedLast, type PassageBookmark } from '@/lib/sourceShortcuts';
import { FavouriteStar, PassageBookmarks, useFavouriteReciters } from '@/components/SourceShortcuts';
import { useTafsir } from '@/hooks/useTafsir';
import { shownTafsir, TAFSIR_NAME } from '@/lib/tafsirName';
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
/** Whether the panel's rail shows each item's name beside its icon. */
const railExpandedPreference = createBooleanPreference('qc-rail-expanded', false);

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
import { PanelRail, type PanelTab, type RailItem } from '@/components/PanelRail';
import { PanelHead } from '@/components/PanelHead';
import type { StyleArea } from '@/components/StyleConfigPanel';
import { useWideLayout } from '@/hooks/useWideLayout';
import { FrameBar, SafeAreaOverlay } from '@/components/FrameBar';
import { framePreset, coveredAreas } from '@/lib/frame';
import { EXPORT_PRESETS } from '@/lib/exportPresets';
import { isOpening } from '@/lib/openings';
import { markerStyleOf, placementOf } from '@/lib/ayahMarker';
import { isPhonemeProvider, phonemeTrialOffered, LAB_CHOICES, LAB_DEFAULTS, type PhonemeLab, type PhonemeProvider } from '@/lib/phonemeTrial';
import { HealthStrip } from '@/components/HealthStrip';
import { OverflowMenu, OverflowItem } from '@/components/OverflowMenu';
import { Timeline } from '@/components/Timeline';
import { Inspector } from '@/components/Inspector';
import { segmentAt, trimTimeline, shiftTimeline, fitVersesToAudio, fillFromCorpus } from '@/lib/verseEdits';
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
import { cutLong, cutLongStretch, isLongFile } from '@/hooks/useLongAudio';
import { isLongAudio } from '@/lib/longAudio';
import { STYLE_PRESETS, applyStylePreset, matchingPreset } from '@/lib/stylePresets';
import { backgroundSeconds, builtInCandidates, chooseBackground, sample, searchOrientation, type BackgroundCandidate } from '@/lib/backgroundMatch';
import { newAudioKey, storeProjectAudio, loadProjectAudio, forgetProjectAudio } from '@/lib/projectAudio';
import { GpuExportModal } from '@/components/GpuExportModal';
import { SavedProjectsDrawer } from '@/components/SavedProjectsDrawer';
import { ShortcutsDialog } from '@/components/ShortcutsDialog';
import { groundTruthFile, groundTruthFileName, groundTruthAudioName } from '@/lib/groundTruth';
import { groundTruthClip, saveGroundTruth } from '@/lib/groundTruthSave';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { useTransportKeys } from '@/hooks/useTransportKeys';
import { staysUp, useSaveStatus } from '@/hooks/useSaveStatus';
import { SaveNotice } from '@/components/SaveNotice';
import { useVideoExport, type StretchAudio } from '@/hooks/useVideoExport';
import { buildProjectPayload, formatStoredDuration, projectTitle, timelinePassage } from '@/lib/projectPayload';
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
import { canDrawAsMushaf, withGlyphs, withIndopak } from '@/lib/mushafFonts';
import { needsContentSync } from '@/lib/contentSyncAge';
import { applyContentSync } from '@/lib/contentSyncCore';
import type { CorpusVerse } from '@/lib/quranCorpus';
import { hydrateLibrary, withStoredBackgrounds, withRestoredBackgrounds } from '@/lib/backgroundLibrary';
import { InspectorSkeleton } from '@/components/Skeleton';
import { OnboardingTour, type TourStep } from '@/components/OnboardingTour';
import { useGuidedTour } from '@/hooks/useGuidedTour';
import { TrimStep } from '@/components/TrimStep';
import { MatchProgress } from '@/components/MatchProgress';
import type { MatchRun } from '@/lib/matchSteps';
import { BatchMatchDialog } from '@/components/BatchMatchDialog';
import type { BatchResult } from '@/lib/batchMatch';
import { buildRenderForm } from '@/lib/serverRenderForm';
import { exportFileName } from '@/lib/exportName';
import { exportRangeFor } from '@/lib/exportRange';
import { usePlayableUpload } from '@/hooks/usePlayableUpload';
import { useRecordingPauses } from '@/hooks/useRecordingPauses';
import { cutFromSavedRecording } from '@/lib/recordingCut';
import { suggestClips, suggestionId, suggestionLabel, type SectionKind, type SurahSection } from '@/lib/clipSuggestions';
import { useAyahMap } from '@/hooks/useAyahMap';
import { clipFromMap, coverage, matchesInParts, nudgedStretch, seedFromClips, writeClipToMap } from '@/lib/ayahMap';
import { FolderPicker } from '@/components/FolderPicker';
import { normalizeAudioTags, readAudioTags, TAG_HEAD_BYTES, type AudioTags } from '@/lib/audioTags';
import { ayahWindow, MIN_CLIP_SEC, normalizeClips, windowClipProject, type RecordingClip } from '@/lib/recordingClips';
import { isAwaitedRecording, recordingSource } from '@/lib/recordingSource';
import { ClipsPanel, sectionName, ClipEnds, SuggestedClips } from '@/components/ClipsPanel';
import { deleteProject, listProjects, saveProject } from '@/lib/projectStore';
import { asLibraryProjects, clipTabLabel, familyOf, type LibraryProject } from '@/lib/projectLibrary';
import { ClipTabs } from '@/components/ClipTabs';
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
  AudioLines,
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
const DEFAULT_AUDIO_URL = SAMPLE_PROJECTS[0].audioUrl;


/** A new project's id, the shape every saved project's has. */
const newClipProjectId = () => `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

/**
 * What a recording saved before anything was matched in it holds: none of the
 * sample's captions, and for its passage the surah its track number names --
 * a surah file's usually is its surah -- until a clip of it is matched.
 */
const unmatchedPassage = (track: number | undefined) => {
  const surah = SURAHS_LIST.find(each => each.number === track);
  return {
    verses: [] as VerseData[],
    ...(surah && {
      surahNumber: surah.number, surahNameArabic: surah.nameArabic, surahNameEnglish: surah.nameEnglish,
      ayahStart: 1, ayahEnd: surah.numberOfAyahs,
    }),
  };
};

/** The one surah a map's captions are from, or undefined for none or several. */
const surahOfMap = (map: VerseData[]) => {
  const surahs = new Set(map.map(verse => Number((verse.verseKey || '').split(':')[0])).filter(Number.isFinite));
  return surahs.size === 1 ? [...surahs][0] : undefined;
};

/** An upload's own tag, read from the start of the file; null for none, or when it cannot be read. */
const tagsOf = (file: File): Promise<AudioTags | null> =>
  file.slice(0, TAG_HEAD_BYTES).arrayBuffer().then(bytes => readAudioTags(new Uint8Array(bytes))).catch(() => null);
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
  const [selectedReciter, setSelectedReciter] = useState<string>(RECITERS[0].id);
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
  /** What the upload's own tag says -- its reciter, title, track (`audioTags.ts`) -- saved for naming it in Projects. */
  const [uploadTags, setUploadTags] = useState<AudioTags | null>(null);
  /** Who an upload is by, as its tags or its folder say: blank rather than a built-in reciter it is not. */
  const uploadReciter = uploadTags?.artist || uploadTags?.folder || '';
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
  const [awaitingAudio, setAwaitingAudio] = useState<{ fileName: string; trim: { start: number; end: number } | null; key?: string; source?: string } | null>(null);
  /**
   * The edit of the recording (`audioEdit`): what is cut, how fast it plays,
   * the clean-ups. `audioUrl` stays the recording itself -- what the aligner
   * reads and a built-in reciter's passage is named by -- and the player plays
   * `playUrl`, the edit applied. The captions are on the edited clock.
   */
  const [audioEdit, setAudioEdit] = useState<AudioEdit>(NO_EDIT);
  /** The same, for handlers that run after an await, when the state they closed over may be old. */
  const audioEditRef = useRef<AudioEdit>(NO_EDIT);
  /** An upload's edits as rendered by the server, by `encodeEdit`, for the upload they were made from. */
  const [uploadRenders, setUploadRenders] = useState<{ file: File | null; urls: Record<string, string> }>({ file: null, urls: {} });
  const uploadRendersRef = useRef(uploadRenders);
  /** The server's name for the upload it keeps for editing, so the next edit sends only that. */
  const uploadSourceId = useRef<{ file: File | null; id: string }>({ file: null, id: '' });
  /** A passage's own length, unedited, once read: what its cuts are bounded by. */
  const sourceDurationRef = useRef<{ url: string; seconds: number }>({ url: '', seconds: 0 });
  const [showEditAudio, setShowEditAudio] = useState(false);
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
  const favouriteReciterIds = useFavouriteReciters();
  const recentReciterIds = useSyncExternalStore(recentReciters.subscribe, recentReciters.get, recentReciters.getServerSnapshot);
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
  const [matchStatus, setMatchStatus] = useState<{
    text: string; tone: 'info' | 'error';
  } | null>(null);
  /** Where a match under way has got to, step by step, for its progress card (`matchSteps.ts`); null when none is. */
  const [matchRun, setMatchRun] = useState<MatchRun | null>(null);
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
  const { verses, setVerses, selectedIndex, setSelectedIndex, edit, reorderAt, setTafsir } = useTimelineEditing(SAMPLE_PROJECTS[0].verses);
  /**
   * The studio opens with Al-Fatihah already in the timeline so the preview is
   * not blank on a first visit. That is useful, but it is indistinguishable
   * from a project you loaded yourself -- so say which it is until you replace
   * it. Cleared as soon as anything real arrives.
   */
  const [isSampleProject, setIsSampleProject] = useState<boolean>(true);
  /** Whether what is open is a project yet: matched, or a reciter's passage loaded -- not the passage the studio opens on. */
  const canSaveProject = !isSampleProject && verses.length > 0;

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
        !(verse.words || []).every(word => word.glyphLine) ||
        // Or before the IndoPak spelling the IndoPak faces draw.
        !(verse.words || []).every(word => word.indopak)
      );
    if (!verses.some(needs)) return;

    // What is already known applies at once. Both functions hand the array
    // back by identity when they change nothing, so this cannot loop.
    const known = [...corpusCache.current.values()];
    if (known.length) setVerses(current => withIndopak(withGlyphs(fillFromCorpus(current, known), known), known));

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
        if (fetched.length) setVerses(current => withIndopak(withGlyphs(fillFromCorpus(current, fetched), fetched), fetched));
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
  /** Which part of the look the rail has open, on a desktop; a phone shows them all. */
  const [styleArea, setStyleArea] = useState<StyleArea>('text');
  const wide = useWideLayout();
  /** The rail with each item's name beside its icon: off unless asked for, and remembered by this browser. */
  const railExpanded = useSyncExternalStore(railExpandedPreference.subscribe, railExpandedPreference.get, railExpandedPreference.getServerSnapshot);
  const railItem: RailItem = panelTab === 'style' ? styleArea : panelTab;
  // Each part of the look opens at its top: the parts share one scrolling panel, which would otherwise keep the last one's place.
  useEffect(() => {
    document.getElementById('panel-style')?.scrollTo({ top: 0 });
  }, [styleArea]);
  const openRailItem = (item: RailItem) => {
    if (item === 'source' || item === 'captions') {
      setPanelTab(item);
      return;
    }
    setStyleArea(item);
    setPanelTab('style');
  };
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
  /** `detail` carries why a save failed; anything with one stays under the header until dismissed (`SaveNotice`). */
  const [saveStatus, setSaveStatus] = useSaveStatus();
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
    // A new project closes each ayah with its number, as the mushaf does.
    ayahNumberPlacement: 'end',
    ayahMarkerStyle: 'medallion',
    showTafsir: false,
    showRepeatMark: true,
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
  /** The brief tafsir as fetched, in memory only, while the style shows it; a hand edit is in `verses`. */
  const tafsir = useTafsir(verses, canvasConfig.showTafsir === true);
  /**
   * The clips an upload was cut into while clips were windows on it, before
   * each clip was a project of its own. Kept with the recording -- written
   * back unchanged on every save -- until each has been made a clip project
   * (`migrateWindowClips`), so nothing of the old layout is lost before the
   * new one is confirmed. Nothing draws or edits them any more.
   */
  const windowClips = useRef<RecordingClip[]>([]);
  /** Maps the open long recording (`startMapping`), for what is declared before it. */
  const startMappingRef = useRef<(() => Promise<void>) | null>(null);
  /**
   * The recording that may be mapped by itself once its audio is in, known by
   * the key its audio is kept under: until that key is the one loaded, the
   * page may still hold the last project's file and tags. Never a clip.
   */
  const mapCandidate = useRef<string | null>(null);
  /** A fresh upload's key and measured length, until it is matched by itself. */
  const matchUploadOnMeasure = useRef<{ key: string; seconds: number } | null>(null);
  /** The saved project open now, which the clip tabs mark; null for one not saved yet. */
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  /**
   * The open upload's recording and the clip projects cut from it, as saved,
   * for the tabs -- read again whenever a save or a delete may have changed
   * them -- and which of them have a render on record.
   */
  const [family, setFamily] = useState<{ source: string; recording: LibraryProject | null; clips: LibraryProject[]; done: ReadonlySet<string> } | null>(null);
  const [familyVersion, setFamilyVersion] = useState(0);
  /** The length suggested clips are about, and which of them are ticked: in Source's list and on the timeline alike. */
  const [suggestTarget, setSuggestTarget] = useState(60);
  const [tickedSuggestions, setTickedSuggestions] = useState<ReadonlySet<string>>(() => new Set());
  const toggleSuggestion = (id: string) => setTickedSuggestions(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  /** Ayahs chosen in Source's grid: selected on the timeline and brought into view there. */
  const [picked, setPicked] = useState<{ start: number; end: number; seq: number } | null>(null);
  /**
   * The project whose windows wait to be made projects once its recording is
   * in -- known by the key its audio is kept under, since until that is loaded
   * the file on hand is still the last project's -- and which to open then.
   */
  const pendingWindows = useRef<{ id: string; key: string } | null>(null);
  const openAfterMigration = useRef<string | null>(null);
  /**
   * A clip project being given another stretch of its recording, which is
   * open meanwhile with the clip's stretch selected (`startAdjust`): the clip
   * as it was saved, and that stretch on the recording's clock.
   */
  const [adjusting, setAdjusting] = useState<{ payload: Record<string, unknown>; verses: VerseData[]; window: { start: number; end: number } } | null>(null);
  /** Set by `makeReciterClip` so the passage loads once its ayahs are the ones asked for, then saved once loaded. */
  const loadPassageNext = useRef(false);
  const [loadedClips, setLoadedClips] = useState(0);
  /** Set by Projects' New clip until a clip is made: the timeline says how to choose its stretch. */
  const [newClipHint, setNewClipHint] = useState(false);
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
    // The captions were timed against this edit of the recording.
    const audio = (snapshot.audio as AudioEdit | undefined) ?? NO_EDIT;
    audioEditRef.current = audio;
    setAudioEdit(audio);
    // A block index is meaningless against a lane that may have just changed
    // under it, and the panel would act on whatever now sits at that position.
    setSelectedBackground(null);
  }, [setVerses, setSelectedIndex]);

  const history = useEditHistory({
    verses,
    selectedIndex,
    config: canvasConfig,
    audio: audioEdit,
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
            config: canvasConfig as unknown as Record<string, unknown>,
            audioEdit
          }),
    [
      isSampleProject, verses, canvasConfig, selectedSurah, surahNameArabic, surahNameEnglish,
      ayahStart, ayahEnd, selectedReciter, audioUrl, customAudioName, audioEdit
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
    // Merged rather than replaced: a styling knob added since the draft was
    // written keeps its default instead of arriving as `undefined`.
    const config = { ...canvasConfig, ...(found.config as Partial<VideoCanvasConfig>) };
    // An upload's draft comes back without its recording, so without its edit.
    const audio = found.audioUrl && found.audioEdit ? found.audioEdit : NO_EDIT;
    setVerses(found.verses);
    setSelectedIndex(0);
    setCanvasConfig(config);
    audioEditRef.current = audio;
    setAudioEdit(audio);
    // The draft is where undo stops: walking back past it would put the
    // sample's captions over the draft's recording.
    history.reset({ verses: found.verses, selectedIndex: 0, config, audio });
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

  /** A bookmarked passage chosen: its surah and ayahs together, so nothing resets the range after. */
  const pickPassage = (passage: PassageBookmark) => {
    const surah = SURAHS_LIST.find(s => s.number === passage.surah);
    if (!surah) return;
    const start = Math.min(passage.start, surah.numberOfAyahs);
    const end = Math.min(Math.max(passage.end, start), surah.numberOfAyahs);
    setSelectedSurah(surah.number);
    setAyahStart(start);
    setAyahEnd(end);
    setAyahStartInput(String(start));
    setAyahEndInput(String(end));
  };

  /** A new recording: nothing of the last one's edit applies. */
  const resetAudioEdit = () => {
    audioEditRef.current = NO_EDIT;
    setAudioEdit(NO_EDIT);
  };

  // Fetch Verses on Surah / Reciter / Ayah change
  const handleLoadSurahVerses = async () => {
    beginClip();
    windowClips.current = [];
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
        // Another recording: nothing of the last one's edit applies to it.
        resetAudioEdit();
      }
      // Against an upload the reciter's absolute timings put the passage
      // outside the recording entirely -- see `fitVersesToAudio`. They are
      // wrong for this audio whatever happens; this is what makes them
      // reachable enough to correct. Fitted to the upload as recorded, then
      // onto the clock its edit plays at.
      const loaded = customAudioUrl
        ? retime(fitVersesToAudio(data.verses || [], customAudioDuration || audioDuration), NO_EDIT, audioEditRef.current)
        : data.verses || [];
      setVerses(loaded);
      if (!customAudioUrl) recentReciters.set(usedLast(recentReciters.get(), selectedReciter));
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
  const adoptAwaitedAudio = async (file: File, expecting: NonNullable<typeof awaitingAudio>) => {
    let adopted: TrimResult;
    if (expecting.trim && (await isLongFile(file))) {
      // Too long for the browser to decode: cut on the server, as it was trimmed (`useLongAudio`).
      adopted = await cutLong(file, { id: '', duration: Infinity }, expecting.trim.start, expecting.trim.end);
    } else if (expecting.trim) {
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
    // The project's own tags, where it has them -- a clip's say which recording it was cut from -- else the file's.
    void tagsOf(file).then(read => setUploadTags(kept => kept ?? read));
    // Stored again under the key the project already names, so it is still that project when saved.
    setAudioKey(expecting.key || newAudioKey());
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
  /** A new upload's name as the user knows it, what its own tag says, and the folder it was picked from, if it was. */
  const nameUpload = (file: File, folder?: string, fresh = false) => {
    setUploadOriginalName(file.name);
    setUploadTags(folder ? { folder } : null);
    // Its source with its tags from the start, so the project is the same one each time it is saved.
    void Promise.all([tagsOf(file), recordingSource(file)]).then(([tags, source]) => {
      setUploadTags(tags || folder || source ? { ...tags, ...(folder ? { folder } : {}), ...(source ? { source } : {}) } : null);
      // A recording uploaded over the sample is named by its own track until it is matched.
      if (fresh) takePassage(unmatchedPassage(tags?.track ?? undefined));
    });
  };
  /**
   * A recording uploaded starts with no captions at all, and as no saved
   * project: neither the sample's nor the last project's are this recording's.
   * Left on screen they were in the way until it was matched, and a save
   * before then wrote them -- under the last project's own row -- as this
   * recording's.
   */
  const startFresh = () => {
    setVerses([]);
    setIsSampleProject(false);
    setSelectedIndex(0);
    // Its new key and source make it a project of its own when saved (`clipIdentity`).
    setOpenProjectId(null);
  };
  /** The surah and ayahs a passage names, as the project's own: what a fresh recording is called before it is matched. */
  const takePassage = ({ surahNumber, surahNameArabic: arabic, surahNameEnglish: english, ayahStart: first, ayahEnd: last }: ReturnType<typeof unmatchedPassage>) => {
    if (!surahNumber || !arabic || !english || !first || !last) return;
    setSelectedSurah(surahNumber);
    setSurahNameArabic(arabic);
    setSurahNameEnglish(english);
    setAyahStart(first);
    setAyahStartInput(String(first));
    setAyahEnd(last);
    setAyahEndInput(String(last));
  };

  const acceptRecitationFile = async (file: File | undefined, folder?: string) => {
    if (file) {
      setSourceMode('recording');
      // A project is waiting for its recitation back. Reproduce the clip it was
      // saved against rather than starting a fresh upload, which would leave the
      // restored timeline describing a file it no longer matches.
      // Only that file, though: any other is a recording of its own, uploaded fresh below.
      if (awaitingAudio && !isVideoFile(file) && isAwaitedRecording({ source: await recordingSource(file), name: file.name }, awaitingAudio)) {
        await adoptAwaitedAudio(file, awaitingAudio);
        return;
      }
      const url = URL.createObjectURL(file);
      const video = isVideoFile(file);
      resetAudioEdit();
      // A different recording: the clips were windows on the last one.
      windowClips.current = [];
      setCustomAudioUrl(url);
      setCustomAudioName(file.name);
      setCustomAudioFile(file);
      setUploadIsVideo(video);
      // The name the user would recognise, kept apart from `customAudioName`
      // because a trim renames that to `-trimmed.wav`. A fresh key too: this is
      // a different recording from whatever was here before.
      startFresh();
      nameUpload(file, folder, true);
      const key = newAudioKey();
      setAudioKey((mapCandidate.current = key));
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
      setMatchStatus(null);
      setMatchRun({ flow: 'upload', phase: 'reading', file: true });
      setAudioUrl(url);
      if (audioElementRef.current) {
        audioElementRef.current.src = url;
        audioElementRef.current.load();
      }
      await settleUpload(file, url, key);
    }
  };

  /**
   * An upload measured, then opened as the recording it already is in
   * Projects, or else matched by itself -- whatever its length: a long one is
   * mapped a stretch at a time instead. Measured last, so a slow or unreadable
   * file delays only this value and not the rest of the upload.
   */
  const settleUpload = async (file: File, url: string, key: string) => {
    const measured = await measureAudioDuration(url);
    setCustomAudioDuration(measured);
    if (measured > 0) setAudioDuration(measured);
    const opened = studio.mode === 'public' ? null : await openSavedRecording(file, key);
    if (opened === false) return;
    if (opened?.verses) {
      setMatchRun(prev => (prev?.phase === 'reading' ? null : prev));
      return;
    }
    if (matchedOtherwise(file, measured)) return;
    matchUploadOnMeasure.current = { key: opened?.key ?? key, seconds: measured };
  };
  /** An upload not matched whole by itself: a long one's choices offered, a shorter one matched in parts. Whether it was. */
  const matchedOtherwise = (file: File, measured: number) => {
    if (!(measured > 0) || isLongAudio(measured)) {
      // Not matched by itself after all: its choices are offered instead, and a long one read whole on the server first.
      const offer = isVideoFile(file) ? t.match.videoUploaded : t.match.audioUploaded;
      setMatchStatus(prev => prev ?? { text: offer, tone: 'info' });
      setMatchRun(prev => (prev?.phase !== 'reading' ? prev
        : measured > 0 && studio.mode !== 'public' ? { flow: 'long', phase: 'longRead', file: true } : null));
      return true;
    }
    if (!matchesInParts(measured) || studio.mode === 'public') return false;
    // Matched a part at a time once its pauses are known, each part's captions shown as it lands (`startMapping`).
    setMatchRun(prev => (prev?.phase === 'reading' ? { flow: 'parts', phase: 'matching', file: true } : prev));
    return true;
  };

  /**
   * The same file uploaded again is the recording already in Projects: that
   * recording is opened, with its captions and its clips, rather than matched
   * and saved as another. The key its audio is kept under, and whether it has
   * captions; null when it is not in Projects, false when another file was
   * chosen meanwhile.
   */
  const openSavedRecording = async (file: File, key: string): Promise<{ key: string; verses: boolean } | null | false> => {
    const source = await recordingSource(file);
    const row = source ? await savedRecordingOf(source) : null;
    if (mapCandidate.current !== key) return false;
    if (!row) return null;
    const kept = typeof row.audioKey === 'string' && row.audioKey ? row.audioKey : key;
    if (!(await storeProjectAudio(kept, file))) return null;
    await handleLoadSavedProject({ ...row, audioKey: kept });
    setMatchStatus({ text: t.clips.reopened, tone: 'info' });
    return { key: kept, verses: Array.isArray(row.versesJson) && row.versesJson.length > 0 };
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
    if (!(end > start)) return;
    // A built-in reciter's passage, or an upload already edited: the trim is
    // a cut of the edit, so the recording itself is kept to edit again.
    const current = audioEditRef.current;
    if (customAudioFile ? isEdited(current) : editedAddress(audioUrl, current)) {
      const keep = { start: toSource(start, current, 'start'), end: toSource(end, current, 'end') };
      await applyAudioEdit(trimmedTo(current, keep, await sourceDuration()));
      return;
    }
    if (!customAudioFile) {
      // A recording the server cannot edit -- the sample's: the captions are
      // cut to the range, which is what plays and exports.
      setVerses(prev => trimTimeline(prev, start, end, false));
      setMatchStatus({ text: t.match.trimmedCaptions(formatDuration(end - start)), tone: 'info' });
      return;
    }
    setMatchStatus({ text: t.match.trimmingRange, tone: 'info' });
    try {
      const buffer = await decodeAudioFile(customAudioFile);
      const result = buildTrimmedFile(buffer, start, end, customAudioFile.name);
      handleApplyTrim({ ...result, trimStart: start, trimEnd: end });
    } catch {
      setMatchStatus({ text: t.match.trimRangeFailed, tone: 'error' });
    }
  };

  /** The recording's own length, unedited: an upload's measured length, or a passage's, read once. */
  const sourceDuration = async (): Promise<number> => {
    if (customAudioFile) return customAudioDuration;
    // Unedited, the player is playing the recording itself.
    if (!isEdited(audioEditRef.current) && audioDuration > 0) return audioDuration;
    if (sourceDurationRef.current.url !== audioUrl || !(sourceDurationRef.current.seconds > 0)) {
      sourceDurationRef.current = { url: audioUrl, seconds: await measureAudioDuration(audioUrl) };
    }
    return sourceDurationRef.current.seconds;
  };

  /**
   * An upload's edit, as the server renders it (`/api/audio/edited`). The
   * upload goes once; after that only the server's name for it does, and the
   * file again only if the server has since let it go.
   */
  const renderUploadEdit = useCallback(async (file: File, edit: AudioEdit, duration: number): Promise<string> => {
    const key = encodeEdit(edit);
    const held = uploadRendersRef.current;
    if (held.file === file && held.urls[key]) return held.urls[key];
    const send = (withFile: boolean) => {
      const form = new FormData();
      form.append('edit', key);
      form.append('duration', String(duration));
      if (withFile) form.append('source', file);
      else form.append('sourceId', uploadSourceId.current.id);
      return fetch('/api/audio/edited', { method: 'POST', body: form });
    };
    const known = uploadSourceId.current.file === file && !!uploadSourceId.current.id;
    let res = await send(!known);
    if (known && res.status === 404) res = await send(true);
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
    const id = res.headers.get('x-source-id');
    if (id) uploadSourceId.current = { file, id };
    const url = URL.createObjectURL(await res.blob());
    const previous = uploadRendersRef.current;
    if (previous.file !== file) Object.values(previous.urls).forEach(old => URL.revokeObjectURL(old));
    const next = { file, urls: { ...(previous.file === file ? previous.urls : {}), [key]: url } };
    uploadRendersRef.current = next;
    setUploadRenders(next);
    return url;
  }, []);

  /**
   * Makes `requested` the edit of the recording: rendered first, so nothing
   * plays the old audio under the new captions, then the captions moved onto
   * its clock and the playhead kept on the same moment of the recitation.
   * The one way an edit changes; undo puts back both together.
   */
  const applyAudioEdit = async (requested: AudioEdit) => {
    const duration = await sourceDuration();
    const normalized = normalizeEdit(requested, duration || undefined);
    const next = isEdited(normalized) ? normalized : NO_EDIT;
    const current = audioEditRef.current;
    if (encodeEdit(next) === encodeEdit(current)) return;
    let url = audioUrl;
    if (isEdited(next)) {
      setMatchStatus({ text: t.editAudio.rendering, tone: 'info' });
      try {
        if (customAudioFile) {
          url = await renderUploadEdit(customAudioFile, next, duration);
        } else {
          const address = editedAddress(audioUrl, next);
          if (!address) throw new Error(t.editAudio.unavailable);
          // Rendered before it is played: one byte asked for, so the player
          // does not sit on a silent element while the server works.
          const res = await fetch(new URL(address, window.location.origin), { headers: { range: 'bytes=0-0' } });
          if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
          url = address;
        }
      } catch (err) {
        setMatchStatus({ text: t.editAudio.failed((err as Error).message), tone: 'error' });
        return;
      }
    }
    // Another edit landed while this one rendered.
    if (audioEditRef.current !== current) return;
    audioEditRef.current = next;
    setAudioEdit(next);
    setVerses(prev => toTheEnd(retime(prev, current, next), next, editedLength(next, duration)));
    queueSeek(url, toEdited(toSource(currentTime, current, 'start'), next));
    setMatchStatus({
      text: isEdited(next) ? t.editAudio.applied(formatDuration(editedLength(next, duration))) : t.editAudio.reset,
      tone: 'info'
    });
  };

  /**
   * Whether this recording can be edited: an upload on a studio that takes
   * them, or a built-in reciter's passage, which the server rebuilds.
   */
  // An upload can be edited before it is matched -- trimmed to the voice first;
  // a passage once it is loaded.
  // Not a recording too long to hold: it is cut a clip at a time instead.
  const canEditAudio = customAudioFile ? studio.mode !== 'public' && !isLongAudio(customAudioDuration) : verses.length > 0 && !!editedAddress(audioUrl, NO_EDIT);
  /** What Edit audio opens on: the recording, the edit, and the captions, all on the recording's clock. */
  const [editAudioStart, setEditAudioStart] = useState<{ edit: AudioEdit; captions: VerseData[] } | null>(null);
  const editAudioSource = useMemo(
    () => (customAudioFile ? { kind: 'file' as const, file: customAudioFile } : { kind: 'url' as const, url: audioUrl }),
    [customAudioFile, audioUrl]
  );
  const openEditAudio = async () => {
    if (!canEditAudio) {
      setMatchStatus({ text: t.editAudio.unavailable, tone: 'info' });
      return;
    }
    const current = audioEditRef.current;
    const captions = retime(verses, current, NO_EDIT);
    // A first edit starts with the loop-friendly ending on: what is made here
    // is a Short or a Reel, which plays again from the start.
    let start: AudioEdit = isEdited(current) ? current : { ...NO_EDIT, loop: true };
    // A passage starts and ends in its ayah files' silence, outside every
    // caption: cut from the edit at the outset, so its length is the clip's.
    if (!customAudioFile && !isEdited(current) && captions.length) {
      const duration = await sourceDuration();
      const first = Math.min(...captions.map(v => v.startTime));
      const last = Math.max(...captions.map(v => v.endTime));
      start = withCuts(start, [{ start: 0, end: first }, { start: last, end: duration }], duration);
    }
    setEditAudioStart({ edit: start, captions });
    setShowEditAudio(true);
  };
  /** "Delete with its audio": the selected caption goes, and its stretch of the recording with it. */
  const cutSelectedAudio = () => {
    const verse = verses[selectedIndex];
    const current = audioEditRef.current;
    if (!verse) return;
    void applyAudioEdit(withCuts(current, [{ start: toSource(verse.startTime, current, 'start'), end: toSource(verse.endTime, current, 'end') }]));
  };

  /**
   * The address the *sidecar* should fetch, given what the player is using.
   *
   * A reciter timeline plays its passage from `/api/audio/ayahs`, a path on
   * this app that means nothing to another process -- so it is made absolute.
   */
  const alignableAudioUrl = (url: string): string => {
    if (!url) return '';
    return url.startsWith('/') ? `${window.location.origin}${url}` : url;
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
    // The match is of the recording as recorded; what plays is its edit.
    const edit = audioEditRef.current;
    if (typeof data.audioDuration === 'number' && !isEdited(edit)) setAudioDuration(data.audioDuration);
    setVerses(data.verses ? retime(data.verses, NO_EDIT, edit) : verses);
    setIsSampleProject(false);
  };

  /**
   * A matched clip's look: a style preset at random, other than the one on
   * screen, and a background about as long as the clip (`backgroundMatch.ts`)
   * -- from Pexels, or from the built-ins when Pexels cannot be asked. One
   * edit, so undo puts the look before the match back.
   */
  const dressForMatch = async (matchedSeconds: number) => {
    const [preset] = sample(STYLE_PRESETS.filter(p => p.id !== matchingPreset(canvasConfig)), 1);
    const clipSeconds = backgroundSeconds(matchedSeconds, canvasConfig.aspectRatio);
    const query = new URLSearchParams({ seconds: String(clipSeconds), orientation: searchOrientation(canvasConfig.aspectRatio) });
    const found: BackgroundCandidate | null = await fetch(`/api/background/match?${query}`)
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null);
    const background = found ?? chooseBackground(builtInCandidates(), clipSeconds);
    setCanvasConfig(prev => {
      const styled = preset ? applyStylePreset(prev, preset) : prev;
      return background ? { ...styled, bgType: 'video', bgUrl: background.url, bgMode: 'single' } : styled;
    });
  };

  /** Whether another background is being looked for, which the Background section's button shows. */
  const [findingBackground, setFindingBackground] = useState(false);
  /**
   * Another background about as long as what is exported, other than the one on
   * screen: a few asked at once, as each asks Pexels for themes at random,
   * and the built-ins when none of them differs.
   */
  const findAnotherBackground = async (aspectRatio: string = canvasConfig.aspectRatio) => {
    // What the export renders -- a reciter's passage, not its whole chapter, or the upload -- as long as one video in this frame runs.
    const seconds = backgroundSeconds(exportRangeFor(verses, audioDuration, !!customAudioUrl).span, aspectRatio);
    if (!(seconds > 0)) return;
    setFindingBackground(true);
    const current = canvasConfig.bgUrl;
    const query = new URLSearchParams({ seconds: String(seconds), orientation: searchOrientation(aspectRatio) });
    const found: (BackgroundCandidate | null)[] = await Promise.all([0, 1, 2].map(() =>
      fetch(`/api/background/match?${query}`).then(res => (res.ok ? res.json() : null)).catch(() => null)));
    const background = found.find(each => each?.url && each.url !== current)
      ?? chooseBackground(builtInCandidates().filter(each => each.url !== current), seconds);
    setFindingBackground(false);
    if (background) setCanvasConfig(prev => ({ ...prev, bgType: 'video', bgUrl: background.url, bgMode: 'single' }));
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
    setMatchRun({ flow: 'upload', phase: 'matching', file: source.kind === 'file' });
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
      setMatchRun(prev => prev && {
        ...prev,
        queue: seen.position > 0 ? { position: seen.position, wait: seen.etaSeconds === null ? null : roughWait(seen.etaSeconds) } : null,
        aligner: seen.aligner,
      });
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
        setMatchRun(null);
        return;
      }

      // An empty reason vetoes the result without a word: what was there stays.
      const rejection = accept?.(data.verses || []);
      if (rejection != null) {
        setMatchStatus(rejection ? { text: rejection, tone: 'error' } : null);
        setIsMatching(false);
        setMatchRun(null);
        return;
      }

      applyMatchData(data);
      // Every match here is one someone asked for -- Match, or a reciter's Load -- and gets a look with it.
      const clipSeconds = source.kind === 'url' ? source.end - source.start : data.audioDuration ?? audioDuration;
      if (clipSeconds > 0) void dressForMatch(clipSeconds);
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
        text: data.timedFrom
          ? t.match.publishedTimed(
              (data.verses || []).length,
              data.timedFrom === 'cut' ? 'cut' : 'qf',
              data.pausesFromAudio ? 'pauses' : data.alignerSkipped ? 'skipped' : 'unheard'
            )
          : (data.warning ? `⚠ ${data.warning} ` : '') +
            t.match.detected(detectedLabel, (data.verses || []).length) +
            (confirmRange ? t.match.confirmRange : t.match.reviewTimings),
        tone: 'info'
      });
      setIsMatching(false);
      setMatchRun(null);
    } catch {
      setMatchStatus(quietFailure ? null : { text: t.match.failed, tone: 'error' });
      setIsMatching(false);
      setMatchRun(null);
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
    // Long enough to be matched in parts, its captions coming part by part, where the studio keeps projects.
    if (customAudioFile && !playable.isLong && !isEdited(audioEdit) && !uploadTags?.clip && studio.mode !== 'public' && matchesInParts(customAudioDuration)) {
      if (recordingPauses.length) void startMappingRef.current?.();
      return;
    }
    // Too long to match whole: a clip at a time is how it is matched.
    if (customAudioFile && playable.isLong && !isEdited(audioEdit)) {
      // Too long to match whole: mapped a stretch at a time instead.
      if (playable.long) void startMappingRef.current?.();
      else {
        setMatchRun(null);
        setMatchStatus({ text: t.match.makeClipFirst, tone: 'error' });
      }
      return;
    }
    beginClip();
    setCanvasConfig(prev => ({ ...prev, ...motionForNewMatch(prev.captionTransition) }));
    setSourceEditing(false);
    if (!customAudioFile) {
      setMatchRun(null);
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
    // The aligner reads the recording as recorded, so the window is found on
    // its clock: an edit's captions and length would stop it short of the end.
    const timed = loadResult?.timingSource === 'measured' && !loadResult.againstUpload;
    void sourceDuration().then(duration => alignLoadedReciter(retime(verses, audioEditRef.current, NO_EDIT), audioUrl, duration, timed));
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
      reciterName: '',
      // An upload's address is a blob url that dies with this tab; the stored copy is what counts.
      audioUrl: '',
      audioDurationSeconds: result.audioDuration,
      audioFileName: file.name,
      audioKey: stored ? key : '',
      trimWindow: null,
      audioTags: await tagsOf(file),
      verses: result.verses,
      config: withStoredBackgrounds(canvasConfig) as unknown as Record<string, unknown>,
    });
    const res = await saveProject(payload, studio.mode).catch(() => null);
    return Boolean(res?.ok);
  };

  const handleManualMatchUploadedAudio = () => {
    beginClip();
    setSourceEditing(false);
    setMatchStatus({ text: t.match.manualMode, tone: 'info' });
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

    // Not cancelled when this effect runs again: a run that starts while these
    // are in flight skips them (`fetchingTranslations`), so dropping what they
    // bring back left the captions without the translation until the choice
    // changed again -- switching Saheeh International for The Clear Quran
    // showed none. Merging by ayah is right whatever the timeline holds now.
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
      if (!Object.keys(arrived).length) return;
      setVerses(prev =>
        prev.map(verse => {
          const extra = arrived[verse.verseKey];
          return extra ? { ...verse, translations: { ...verse.translations, ...extra } } : verse;
        })
      );
    })();
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
   * What the player plays: the recording with its edit applied. A built-in
   * reciter's from the address the server rebuilds it at; an upload's from
   * the server's render of it, or the recording as it is until that arrives.
   */
  const editKey = isEdited(audioEdit) ? encodeEdit(audioEdit) : '';
  const renderedUpload = customAudioFile && uploadRenders.file === customAudioFile ? uploadRenders.urls[editKey] : undefined;
  /** An uploaded VBR MP3 plays from a copy that seeks exactly (`seekableAudio.ts`), once it is made. */
  const playable = usePlayableUpload(customAudioFile, customAudioUrl, customAudioDuration, !isPublic, {
    // Reading a long upload takes a while, so the studio says it is, and when it is done what comes next.
    started: () => {
      setMatchStatus({ text: t.match.readingLong, tone: 'info' });
      setMatchRun({ flow: 'long', phase: 'longRead', file: true });
    },
    // A clip opened before the recording was read: its note goes with it.
    abandoned: () => {
      setMatchStatus(prev => (prev?.text === t.match.readingLong ? null : prev));
      setMatchRun(prev => (prev?.phase === 'longRead' ? null : prev));
    },
    // A long upload is as long as the server read it: the clock its copy, its waveform and every cut are on.
    finished: long => {
      // Its mapping, if it is mapped, starts a card of its own.
      setMatchRun(prev => (prev?.phase === 'longRead' ? null : prev));
      if (long) setAudioDuration(long.duration);
      setMatchStatus({ text: long ? t.match.longReady : t.match.longUnread, tone: long ? 'info' : 'error' });
    },
  });
  /** Where the upload pauses: a stretch with no captions in it yet is let go on them. */
  const recordingPauses = useRecordingPauses(customAudioFile, customAudioDuration, playable.long);
  const seekableUrl = playable.url && audioUrl === customAudioUrl ? playable.url : null;
  const uploadPlayUrl = seekableUrl ?? audioUrl;
  const playUrl = !editKey ? uploadPlayUrl : customAudioFile ? renderedUpload ?? audioUrl : editedAddress(audioUrl, audioEdit) ?? audioUrl;

  // The copy replaces the upload under the element: it carries on from where the upload was, playing if it
  // was. Read from the render that swapped them -- by now the element has started over on the copy.
  const swappedToRef = useRef<string | null>(null);
  useEffect(() => {
    const audio = audioElementRef.current;
    if (!seekableUrl || !audio || uploadPlayUrl !== seekableUrl || swappedToRef.current === seekableUrl) return;
    swappedToRef.current = seekableUrl;
    queueSeek(seekableUrl, currentTime);
    if (isPlaying) audio.addEventListener('canplay', () => { audio.play().catch(() => {}); }, { once: true });
  }, [seekableUrl, uploadPlayUrl, queueSeek, currentTime, isPlaying, audioElementRef]);

  const longRereadRef = useRef(false);

  // An upload's edit restored by undo or redo past what this session rendered.
  useEffect(() => {
    // Not before the upload's length is read: the server needs it to bound the cuts.
    if (!customAudioFile || !editKey || renderedUpload || !(customAudioDuration > 0)) return;
    let stale = false;
    renderUploadEdit(customAudioFile, audioEditRef.current, customAudioDuration)
      .catch(err => { if (!stale) setMatchStatus({ text: t.editAudio.failed((err as Error).message), tone: 'error' }); });
    return () => { stale = true; };
  }, [customAudioFile, editKey, renderedUpload, renderUploadEdit, customAudioDuration, t]);

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
    onNextToCheck: goToNextCheck,
    onSave: () => void handleSaveProject(),
    onStepCaption: direction => {
      if (!verses.length) return;
      const next = Math.min(verses.length - 1, Math.max(0, selectedIndex + direction));
      selectCaption(next);
      handleSeek(verses[next].startTime);
    }
  });

  // A render in this tab dies with the tab, so closing or reloading mid-render
  // asks first. Nothing else needs it: the work itself is kept as a draft.
  useEffect(() => {
    if (!isExporting) return;
    const ask = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [isExporting]);


  // Covers the case where the url did not change -- reloading the same surah
  // and reciter fires no `loadedmetadata`, so the seek would never be applied.
  useEffect(() => {
    applyPendingSeek();
  }, [applyPendingSeek, verses, playUrl]);

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
    // Ground truth is of the recording as recorded -- the audio it is cut from
    // and scored on -- so an edit's captions go back onto that clock first.
    const recorded = retime(verses, audioEditRef.current, NO_EDIT);
    const duration = await sourceDuration();

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
      recorded
    );
    const saved = groundTruthAudioName(clip?.name ?? customAudioName);
    const withAudio = groundTruthFile(recorded, {
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
      return;
    }
    // A reciter's passage has nothing to download in its place: say why.
    if (outcome && !outcome.fallback) {
      setSaveStatus({ text: t.header.groundTruthFailed, kind: 'error', detail: outcome.error, action: 'ground-truth' });
      return;
    }

    // No server able to write, or no audio to write: the text file on its own,
    // naming the recording the person still has on disk and the window to cut
    // from it. Less convenient than the path above and better than nothing --
    // silently writing nothing would be worse than what this replaced.
    const contents = groundTruthFile(recorded, {
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
    } else {
      setSaveStatus(null);
    }
    // Revoking immediately can cancel the download in some browsers; a tick is
    // enough for it to have been handed over.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** The project as it stands, in the shape a save sends; `over` for a clip made from it (`makeClipProject`). */
  const currentProjectPayload = (over: Partial<Parameters<typeof buildProjectPayload>[0]> = {}) => {
    // The ayahs the timeline holds, not the ones first asked for: a project
    // trimmed down kept the old range in its title and passage.
    const held = timelinePassage(verses, { surahNumber: selectedSurah, start: ayahStart, end: ayahEnd });
    const storedBase = withStoredBackgrounds(canvasConfig);
    const payload = buildProjectPayload({
      surahNumber: selectedSurah,
      surahNameArabic,
      surahNameEnglish,
      ayahStart: held.start,
      ayahEnd: held.end,
      reciterId: selectedReciter,
      // An upload is its tagged reciter's, not whoever the built-in picker was left on.
      reciterName: customAudioFile ? uploadReciter : RECITERS.find(r => r.id === selectedReciter)?.name || RECITERS[0]?.name || 'Abdul Rahman Al-Sudais',
      // The edit rides in the address (`splitAddress` reads it back): a
      // reciter's plays from it as it is, an upload's names only the edit.
      audioUrl: !isEdited(audioEdit) ? audioUrl : customAudioFile ? uploadEditAddress(audioEdit) : editedAddress(audioUrl, audioEdit) ?? audioUrl,
      // How long the clip is, for the Projects list -- the whole chapter's
      // recording for a built-in reciter, which is not what anyone means by it.
      audioDurationSeconds: exportRange.span,
      audioFileName: customAudioFile ? uploadOriginalName : '',
      audioKey,
      trimWindow,
      audioTags: uploadTags,
      verses,
      // An uploaded background is a `blob:` url that dies with this tab, so
      // what goes to the row is the library's id for the file instead. A
      // pasted link is already durable and passes through untouched.
      config: storedBase as unknown as Record<string, unknown>,
      ...over,
    });
    // The old layout's clips, as they were stored, until each is a project of its own.
    return { ...payload, clips: windowClips.current };
  };

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
  const clipIdentity = (payload: Record<string, unknown>) => {
    // A recording kept by its source, and each clip of it by its cut: matching one changes its ayahs, not which it is.
    const source = (payload.audioTags as { source?: string } | null)?.source;
    if (source) return payload.trimWindow ? `clip|${payload.audioKey}` : `recording|${source}`;
    return `${payload.surahNumber}:${payload.ayahStart}-${payload.ayahEnd}|${payload.audioKey || splitAddress(String(payload.audioUrl || '')).source}`;
  };
  const clipProjectId = (payload: Record<string, unknown>) =>
    clipProject.current?.clip === clipIdentity(payload)
      ? clipProject.current.id
      : `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const rememberClipProject = (id: string, payload: Record<string, unknown>) => {
    clipProject.current = { id, clip: clipIdentity(payload) };
    setOpenProjectId(id);
  };

  const handleSaveProject = async () => {
    // A project starts with a match -- an upload matched, or a reciter's passage loaded -- never as the passage the studio opens on.
    if (!canSaveProject) return;
    setSaveStatus({ text: t.header.saving, kind: 'pending' });
    try {
      const current = currentProjectPayload();
      const id = clipProjectId(current);
      const { payload, storedAudio } = await storeUploadFor(current);
      const res = await saveProject({ ...payload, id }, studio.mode);

      if (res.ok) {
        rememberClipProject(id, current);
        // A clip's captions are its recording's: a fix made here is kept there, for every clip holding that ayah.
        await writeClipBack(current);
        setFamilyVersion(n => n + 1);
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
        }, 3000);
      } else {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        const reason = data?.error || t.header.saveFailedStatus(res.status);
        console.error('Save failed:', reason);
        // The reason rides along on the status rather than living only in the
        // console: "Save Failed" on its own is the one thing nobody can act on,
        // and the usual cause -- a database that is not running -- is fixable in
        // one command once it is named.
        setSaveStatus({ text: t.header.saveFailed, kind: 'error', detail: reason, action: 'save' });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error('Save failed:', reason);
      setSaveStatus({ text: t.header.saveFailed, kind: 'error', detail: reason, action: 'save' });
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
    // A stock video was found for the old frame's shape and length: a new shape gets one of its own.
    const stock = canvasConfig.bgType === 'video' && canvasConfig.bgMode !== 'custom' && /^https:\/\/videos\.pexels\.com\//.test(canvasConfig.bgUrl || '');
    if (stock && searchOrientation(ratio) !== searchOrientation(canvasConfig.aspectRatio)) void findAnotherBackground(ratio);
  };

  /**
   * A project deleted in Projects while it is open stays on screen, but as no
   * saved project: its row is gone, and a save, a switch of tab or a render
   * would otherwise write it back under the id it was deleted by.
   */
  const detachDeleted = (id: string) => {
    if (clipProject.current?.id !== id && openProjectId !== id) return;
    clipProject.current = null;
    setOpenProjectId(null);
    setFamilyVersion(n => n + 1);
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
    ...(canSaveProject ? [{
      key: 'save',
      label: t.header.saveToProjects,
      hint: saveStatus?.detail || saveStatus?.text,
      icon: <Save className="w-4 h-4" />,
      onSelect: handleSaveProject,
      className: 'md:hidden'
    }] : []),
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
   * A stretch of what is open made a clip of its own. Of an upload, a project
   * with its own cut of the audio (`makeClipProject`); of a built-in reciter,
   * the ayahs it holds loaded as a passage of their own.
   */
  const addRecordingClip = (start: number, end: number) => {
    if (adjusting) {
      void updateAdjustedClip(adjusting, start, end);
      return;
    }
    if (customAudioFile) {
      void makeClipProject(start, end);
      return;
    }
    void makeReciterClip(start, end);
  };
  /**
   * Several clips made at once -- suggested clips ticked -- each a project of
   * its own with its stretch of the map, cut together; the recording stays
   * open, its tabs showing them.
   */
  const makeClips = async (stretches: { start: number; end: number }[]) => {
    const file = customAudioFile;
    if (!file || !stretches.length) return;
    setMatchStatus({ text: t.clips.cutting, tone: 'info' });
    try {
      const { tags } = await saveRecordingForClip(file);
      const cuts = await cutClipsAudio(file, stretches);
      await Promise.all(stretches.map((stretch, i) => saveClipProject(cuts[i], stretch, clipFromMap(verses, stretch), { audioTags: tags })));
      setMatchStatus({ text: t.clips.madeMany(stretches.length), tone: 'info' });
    } catch (err) {
      setMatchStatus({ text: t.clips.cutFailed((err as Error).message), tone: 'error' });
    }
  };
  /**
   * Set when a clip project opens with no captions yet -- made from a stretch
   * nothing was heard in yet, or from an old window that held none -- and
   * matched once its own audio is in (the effect below): known by the key it
   * is kept under and its length, since until then the file on hand is the last one.
   */
  const matchClipOnOpen = useRef<{ key: string; seconds: number } | null>(null);
  /** Set while that match runs, so the clip is saved when it ends. */
  const saveClipAfterMatch = useRef(false);
  /**
   * A clip of an upload, made a project of its own: the stretch cut from the
   * recording -- by the server for a long one, as a WAV so it starts exactly
   * where it was asked to -- with the captions already heard in it, moved onto
   * its own clock. From then on it is a trimmed upload like any other, its
   * `trimWindow` and `source` saying where it came from. The recording is
   * saved first, so Projects lists the clip under it.
   */
  const makeClipProject = async (start: number, end: number) => {
    const file = customAudioFile;
    if (!file || !(end - start >= MIN_CLIP_SEC)) return;
    if (isEdited(audioEditRef.current)) {
      setMatchStatus({ text: t.clips.editFirst, tone: 'error' });
      return;
    }
    setNewClipHint(false);
    setMatchStatus({ text: t.clips.cutting, tone: 'info' });
    try {
      const { tags, unmatched } = await saveRecordingForClip(file);
      const cut = await cutClipAudio(file, start, end);
      const captions = trimTimeline(isSampleProject ? [] : verses, start, end);
      const clip = await saveClipProject(cut, { start, end }, captions, { audioTags: tags, ...unmatched });
      await handleLoadSavedProject(clip);
      if (captions.length) setMatchStatus({ text: t.clips.made(formatDuration(end - start)), tone: 'info' });
    } catch (err) {
      setMatchStatus({ text: t.clips.cutFailed((err as Error).message), tone: 'error' });
    }
  };
  /** The recording saved as it stands, before a clip is cut from it, with the source its clips name it by. */
  const saveRecordingForClip = async (file: File, recordingId?: string) => {
    // Which row this is, asked before it carries its source: a project saved before sources were kept is still that row.
    const opened = recordingId ?? (clipProject.current?.clip === clipIdentity(currentProjectPayload()) ? clipProject.current.id : null);
    const source = uploadTags?.source ?? (await recordingSource(file));
    const tags = source ? { ...uploadTags, source } : uploadTags;
    setUploadTags(tags);
    const unmatched = isSampleProject ? unmatchedPassage(tags?.track) : {};
    // The same file uploaded again is a recording already in Projects: its clips go under it, and it is left as it is.
    if (!opened && source && (await savedRecordingOf(source))) return { tags, unmatched };
    const recording = currentProjectPayload({ audioTags: tags, ...unmatched });
    const id = opened ?? clipProjectId(recording);
    const kept = await storeUploadFor(recording);
    const res = await saveProject({ ...kept.payload, id }, studio.mode);
    if (!res.ok) throw new Error(t.header.saveFailedStatus(res.status));
    rememberClipProject(id, recording);
    return { tags, unmatched };
  };
  /** The stretch cut from the recording: by the server for a long one, as a WAV, so it starts where it was asked to. */
  const cutClipAudio = async (file: File, start: number, end: number): Promise<File> => {
    if (!playable.long) return buildTrimmedFile(await decodeAudioFile(file), start, end, file.name).file;
    const wav = await cutLongStretch(file, playable.long, start, end, 'wav');
    return new File([wav], file.name.replace(/\.[^./]+$/, '-clip.wav'), { type: 'audio/wav' });
  };
  /** Several stretches cut at once: by the server for a long recording, else from one decode of it. */
  const cutClipsAudio = async (file: File, stretches: { start: number; end: number }[]): Promise<File[]> => {
    if (playable.long) return Promise.all(stretches.map(each => cutClipAudio(file, each.start, each.end)));
    const decoded = await decodeAudioFile(file);
    return stretches.map(each => buildTrimmedFile(decoded, each.start, each.end, file.name).file);
  };
  /** The clip saved as a project of its own, its audio kept in this browser, and the row returned to open. */
  const saveClipProject = async (
    cut: File, window: { start: number; end: number }, captions: VerseData[], over: Partial<Parameters<typeof buildProjectPayload>[0]>,
    made: { windowOf?: string; id?: string } = {}
  ) => {
    const key = newAudioKey();
    const stored = await storeProjectAudio(key, cut);
    const held = timelinePassage(captions, { surahNumber: selectedSurah, start: ayahStart, end: ayahEnd });
    // On the original's clock, however many trims deep the recording already is.
    const origin = trimWindow?.start ?? 0;
    const clip = {
      ...currentProjectPayload({
        ayahStart: held.start, ayahEnd: held.end, audioDurationSeconds: window.end - window.start,
        audioKey: stored ? key : '', trimWindow: { start: origin + window.start, end: origin + window.end },
        ...over, verses: captions,
        // A clip, not the recording, and made from a window of the old layout only when it was.
        audioTags: { ...over.audioTags, windowOf: made.windowOf, clip: true },
      }),
      id: made.id ?? newClipProjectId(),
      clips: [],
    };
    const res = await saveProject(clip, studio.mode);
    if (!res.ok) throw new Error(t.header.saveFailedStatus(res.status));
    setFamilyVersion(n => n + 1);
    return clip;
  };
  // A clip opened with nothing heard in it yet is matched as any upload is, once its own audio is the one
  // loaded and measured: until then the length on hand is still the recording's. A fresh upload is
  // matched by itself the same way, as soon as it is measured.
  useEffect(() => {
    const clip = matchClipOnOpen.current;
    const upload = matchUploadOnMeasure.current;
    const waiting = clip ?? upload;
    if (!waiting || !customAudioFile || audioKey !== waiting.key || Math.abs(customAudioDuration - waiting.seconds) > 1) return;
    matchClipOnOpen.current = null;
    matchUploadOnMeasure.current = null;
    if (!clip && isMatching) return;
    // Saved once matched, so Projects lists it.
    saveClipAfterMatch.current = !!clip || studio.mode !== 'public';
    handleAutoMatchUploadedAudio();
  });
  // ...and saved once matched, so Projects lists it by the ayahs it holds rather than as made.
  useEffect(() => {
    if (isMatching || !saveClipAfterMatch.current) return;
    saveClipAfterMatch.current = false;
    if (verses.length) void handleSaveProject();
  }, [isMatching]); // eslint-disable-line react-hooks/exhaustive-deps -- once, when that match ends

  /** Where a clip saved as `payload` sits in its recording, the recording as saved, and its map; null for anything else. */
  const clipInRecording = async (payload: Record<string, unknown>) => {
    const tags = normalizeAudioTags(payload.audioTags);
    const cut = payload.trimWindow as { start: number; end: number } | null | undefined;
    const recording = tags?.clip && tags.source && cut ? await savedRecordingOf(tags.source) : null;
    if (!recording || !cut) return null;
    const origin = (recording.trimWindow as { start: number } | null | undefined)?.start ?? 0;
    const map = Array.isArray(recording.versesJson) ? recording.versesJson : [];
    return { recording, map, window: { start: cut.start - origin, end: cut.end - origin } };
  };
  /** A clip's captions, saved, written into its recording's map over the clip's stretch. */
  const writeClipBack = async (payload: Record<string, unknown>) => {
    const clipVerses = Array.isArray(payload.versesJson) ? (payload.versesJson as VerseData[]) : [];
    const found = clipVerses.length ? await clipInRecording(payload) : null;
    if (!found) return;
    const next = writeClipToMap(found.map, clipVerses, found.window);
    if (JSON.stringify(next) !== JSON.stringify(found.map)) await saveProject({ ...found.recording, versesJson: next }, studio.mode);
  };
  /** A clip opened: its captions from its recording's map, where the map has that stretch -- fixed there, or in another clip. */
  const takeCaptionsFromMap = async (clip: Record<string, unknown>) => {
    const found = await clipInRecording(clip);
    if (!found || coverage(found.map, found.window) < 0.5 || clipProject.current?.id !== clip.id) return;
    const fromMap = clipFromMap(found.map, found.window);
    if (JSON.stringify(fromMap) === JSON.stringify(clip.versesJson)) return;
    matchClipOnOpen.current = null;
    setVerses(fromMap);
  };

  /** The recording saved in Projects with this source -- not a clip of it -- or null. */
  const savedRecordingOf = async (source: string) =>
    ((await listProjects(studio.mode)) ?? []).find(row => {
      const tags = normalizeAudioTags(row.audioTags);
      return tags?.source === source && !tags.clip;
    }) ?? null;

  /**
   * Each of the old layout's windows on the open recording made a clip
   * project, as Make clip makes one -- its stretch cut, its captions moved
   * onto its own clock, its own look if it had one -- unless it has been
   * already, from this project or a copy of it. The recording keeps its
   * windows (`windowClips`) until the new projects are confirmed; Projects
   * lists the projects in their place.
   */
  const migrateWindowClips = async (file: File, pending: { id: string; key: string }, windows: RecordingClip[]) => {
    // Measured here, not read off the page, which can still hold the last file's length: a long one is cut by the
    // server, once it has read it, and is waited for until then.
    const url = URL.createObjectURL(file);
    const seconds = await measureAudioDuration(url).finally(() => URL.revokeObjectURL(url));
    if (isLongAudio(seconds) && !playable.long) {
      pendingWindows.current = pending;
      return;
    }
    const source = uploadTags?.source ?? (await recordingSource(file));
    if (!source) throw new Error(t.clips.noSource);
    const plans = planWindowClips(await madeClipsOf(source), pending.id, windows);
    const opened = new Map(plans.map(plan => [plan.clip.id, plan.found?.row]));
    const missing = plans.filter(plan => !plan.found);
    // A copy of a project already made into clips joins them under the recording, by its source; nothing else to do.
    if (missing.length || !uploadTags?.source) {
      const { tags } = await saveRecordingForClip(file, pending.id);
      const saved = await saveWindowClips(file, missing, tags, pending.id);
      missing.forEach((plan, i) => opened.set(plan.clip.id, saved[i]));
    }
    // Opened from Projects on one of them: that one, now a project.
    const wanted = openAfterMigration.current;
    openAfterMigration.current = null;
    if (wanted && opened.get(wanted)) await handleLoadSavedProject(opened.get(wanted));
  };
  /** The clip projects saved from the recording `source`, as `windowClipProject` compares them. */
  const madeClipsOf = async (source: string) =>
    ((await listProjects(studio.mode)) ?? []).flatMap(row => {
      const tags = normalizeAudioTags(row.audioTags);
      return tags?.source === source && tags.clip
        ? [{ row: row as unknown, id: row.id, empty: !row.versesJson?.length, windowOf: tags.windowOf, cut: row.trimWindow as { start: number; end: number } | null | undefined }]
        : [];
    });
  /**
   * For each window: its captions, and the clip project already made from it,
   * if one -- unless that one was made from a copy's window with no captions
   * (it had the sample's), which this window's then fill, on the same row.
   */
  const planWindowClips = (made: Awaited<ReturnType<typeof madeClipsOf>>, recordingId: string, windows: RecordingClip[]) =>
    windows.map(clip => {
      const captions = trimTimeline(verses, clip.start, clip.end);
      const found = windowClipProject(made, recordingId, trimWindow?.start ?? 0, clip);
      const refill = !!found && found.empty && captions.length > 0;
      return { clip, captions, found: refill ? undefined : found, id: refill ? found.id : undefined };
    });
  /** The windows not made yet, each cut and saved as a clip project with the look it had; the rows saved. */
  const saveWindowClips = async (
    file: File, missing: ReturnType<typeof planWindowClips>, tags: AudioTags | null, recordingId: string
  ) => {
    if (!missing.length) return [];
    setMatchStatus({ text: t.clips.migrating(missing.length), tone: 'info' });
    const cuts = await cutClipsAudio(file, missing.map(plan => plan.clip));
    const saved = await Promise.all(missing.map(({ clip, captions, id }, i) => {
      const look = clip.style ? { ...canvasConfig, ...withRestoredBackgrounds(clip.style as Partial<VideoCanvasConfig>) } : canvasConfig;
      // Nothing heard in it yet: named by the recording's track until it is matched, when it is opened.
      const unheard = captions.length ? {} : unmatchedPassage(tags?.track);
      return saveClipProject(cuts[i], clip, captions,
        { ...unheard, audioTags: tags, config: withStoredBackgrounds(look) as unknown as Record<string, unknown> },
        { windowOf: `${recordingId}/${clip.id}`, id });
    }));
    setMatchStatus({ text: t.clips.migrated(missing.length), tone: 'info' });
    return saved;
  };

  /** Whether the project open is a clip cut from a recording, which `startAdjust` can widen past its cut. */
  const isClipProject = !!customAudioFile && !!uploadTags?.clip && !!uploadTags.source && !!trimWindow;
  /** Adjust in recording: the clip saved, then its recording opened on the clip's stretch, to drag its ends. */
  const startAdjust = async () => {
    const source = uploadTags?.source;
    const cut = trimWindow;
    if (!source || !cut) return;
    const recording = await savedRecordingOf(source);
    if (!recording) {
      setMatchStatus({ text: t.clips.adjustNoRecording, tone: 'error' });
      return;
    }
    await handleSaveProject();
    const id = clipProject.current?.id;
    if (!id) return;
    const origin = (recording.trimWindow as { start: number } | null | undefined)?.start ?? 0;
    const held = { payload: { ...currentProjectPayload(), id }, verses, window: { start: cut.start - origin, end: cut.end - origin } };
    await handleLoadSavedProject(recording);
    setAdjusting(held);
    setMatchStatus({ text: t.clips.adjustHint, tone: 'info' });
  };
  /**
   * The clip adjusted given the stretch `start`..`end` of the recording: cut
   * again, keeping its own captions as they were edited, moved with its start,
   * and the recording's for whatever the new stretch adds; then opened.
   */
  const updateAdjustedClip = async (held: NonNullable<typeof adjusting>, start: number, end: number) => {
    const file = customAudioFile;
    if (!file || !(end - start >= MIN_CLIP_SEC)) return;
    setMatchStatus({ text: t.clips.cutting, tone: 'info' });
    try {
      const cut = await cutClipAudio(file, start, end);
      // The recording's captions, which hold the clip's own since it was saved; else its own, moved with its start.
      const captions = coverage(verses, held.window) >= 0.5 ? clipFromMap(verses, { start, end }) : [
        ...trimTimeline(verses.filter(verse => verse.endTime <= held.window.start || verse.startTime >= held.window.end), start, end),
        ...trimTimeline(shiftTimeline(held.verses, held.window.start - start), 0, end - start, false),
      ].sort((a, b) => a.startTime - b.startTime);
      await saveRecutClip(held.payload, cut, { start, end }, trimWindow?.start ?? 0, captions);
    } catch (err) {
      setMatchStatus({ text: t.clips.cutFailed((err as Error).message), tone: 'error' });
    }
  };
  /**
   * A clip given a new stretch of its recording (`window`, on the recording's
   * clock, `origin` where that starts in the original): its new cut kept, its
   * row saved with `captions`, its ayahs and title -- the same project, its
   * look as it was -- and opened.
   */
  const saveRecutClip = async (
    payload: Record<string, unknown>, cut: File, window: { start: number; end: number }, origin: number, captions: VerseData[]
  ) => {
    const key = newAudioKey();
    const stored = await storeProjectAudio(key, cut);
    const surah = Number(payload.surahNumber);
    const passage = timelinePassage(captions, { surahNumber: surah, start: Number(payload.ayahStart), end: Number(payload.ayahEnd) });
    const ayahs = passage.surahNumber === surah ? { ayahStart: passage.start, ayahEnd: passage.end } : {};
    const clip = {
      ...payload, ...ayahs,
      title: projectTitle(String(payload.surahNameEnglish), surah, ayahs.ayahStart ?? Number(payload.ayahStart), ayahs.ayahEnd ?? Number(payload.ayahEnd)),
      audioKey: stored ? key : '', audioDuration: formatStoredDuration(window.end - window.start),
      trimWindow: { start: origin + window.start, end: origin + window.end }, versesJson: captions,
    };
    const res = await saveProject(clip, studio.mode);
    if (!res.ok) throw new Error(t.header.saveFailedStatus(res.status));
    setFamilyVersion(n => n + 1);
    await handleLoadSavedProject(clip);
    setMatchStatus({ text: t.clips.adjusted(formatDuration(window.end - window.start)), tone: 'info' });
  };
  /**
   * The open clip's start or end moved one whole ayah on its recording's map
   * (`nudgedStretch`), cut again from the recording -- the server's copy of a
   * long one, kept by its source, or the copy this browser keeps -- without
   * opening it. Saved first, so a fix made in it is in the map.
   */
  const nudgeClip = async (edge: 'start' | 'end', by: -1 | 1) => {
    await handleSaveProject();
    const id = clipProject.current?.id;
    const payload = { ...currentProjectPayload(), id };
    const found = await clipInRecording(payload);
    const map = (found?.map ?? []) as VerseData[];
    const reach = map.length ? map[map.length - 1].endTime + 30 : 0;
    const window = found && id ? nudgedStretch(map, found.window, edge, by, reach) : null;
    if (!found || !window) {
      setMatchStatus({ text: t.clips.nudgeNone, tone: 'error' });
      return;
    }
    setMatchStatus({ text: t.clips.cutting, tone: 'info' });
    try {
      const cut = await cutFromSavedRecording(found.recording, window, reach);
      const origin = (found.recording.trimWindow as { start: number } | null | undefined)?.start ?? 0;
      await saveRecutClip(payload, cut, window, origin, clipFromMap(map, window));
    } catch {
      setMatchStatus({ text: t.clips.nudgeNeedsRecording, tone: 'error' });
    }
  };

  /**
   * A stretch of a built-in reciter's passage made a clip: the ayahs it holds,
   * loaded as a passage of their own and saved as a project of their own, the
   * passage it came from saved first as it stands.
   */
  const makeReciterClip = async (start: number, end: number) => {
    const held = timelinePassage(trimTimeline(verses, start, end), { surahNumber: selectedSurah, start: ayahStart, end: ayahEnd });
    if (held.surahNumber !== selectedSurah || (held.start === ayahStart && held.end === ayahEnd)) return;
    await handleSaveProject();
    clipProject.current = null;
    setAyahStart(held.start);
    setAyahStartInput(String(held.start));
    setAyahEnd(held.end);
    setAyahEndInput(String(held.end));
    loadPassageNext.current = true;
  };
  useEffect(() => {
    if (!loadPassageNext.current) return;
    loadPassageNext.current = false;
    void handleLoadSurahVerses().then(() => setLoadedClips(n => n + 1));
  });
  // ...and saved, on the render that has its captions, so the clip is in Projects as soon as it is made.
  useEffect(() => {
    if (loadedClips && verses.length) void handleSaveProject();
  }, [loadedClips]); // eslint-disable-line react-hooks/exhaustive-deps -- once per clip, when its passage is in
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
  const clipPassage = useMemo(
    () => timelinePassage(verses, { surahNumber: selectedSurah, start: ayahStart, end: ayahEnd }),
    [verses, selectedSurah, ayahStart, ayahEnd]
  );

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
      // Credited only when the card draws it.
      tafsirName: canvasConfig.showTafsir && verses.some(verse => shownTafsir(verses, tafsir.texts, verse.verseKey)) ? TAFSIR_NAME : undefined,
      verses
    }),
    [
      clipPassage, surahNameArabic, surahNameEnglish, customAudioFile,
      selectedReciterMeta, canvasConfig.translationFollowsWords, canvasConfig.showTafsir, verses, tafsir.texts
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

  /**
   * What a render of a long upload decodes: only the stretch it renders, cut
   * exactly from the recording by the server -- two hours would not fit in
   * the tab. Undefined for any other recording, which renders from the player.
   */
  const long = playable.long;
  const longStretch: StretchAudio | undefined = long && customAudioFile
    ? async () => ({ blob: await cutLongStretch(customAudioFile, long, exportRange.start, exportRange.end, 'wav'), start: exportRange.start })
    : undefined;

  /** Opens Export -- of a clip, for a recording too long to render whole. */
  const openExport = () => {
    if (customAudioFile && isLongAudio(customAudioDuration)) {
      setMatchStatus({ text: t.clips.longExportNeedsClip, tone: 'error' });
      return;
    }
    setIsExportModalOpen(true);
  };

  const handleStartExport = (
    plan: ExportPlan,
    onComplete: (blob: Blob, renderMs: number, health: ExportHealth) => void
  ) => {
    exportedResolution.current = `${plan.width}x${plan.height}`;
    renderedProject.current = currentProjectPayload();
    startExport(audioElementRef.current, { start: exportRange.start, end: exportRange.end }, plan, onComplete, longStretch);
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
    const stretch = longStretch ? await longStretch() : null;
    return buildRenderForm({
      config: { ...canvasConfig, aspectRatio: plan.aspectRatio },
      verses,
      surahNameArabic,
      surahNameEnglish,
      reciterName: customAudioFile ? uploadReciter : selectedReciterMeta?.name,
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
      audioStart: stretch?.start,
    }, stretch?.blob ?? (audio?.currentSrc || audio?.src || ''));
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
    sourceUrl: playUrl,
    lane: bgSegments,
    layout: canvasConfig.layout,
    overlayOpacity: canvasConfig.bgOverlayOpacity,
  }), [exportRange.start, exportRange.end, canvasConfig.fps, playUrl,
      bgSegments, canvasConfig.layout, canvasConfig.bgOverlayOpacity]);

  /** The frame the finished file has, whichever path produced it. */
  const renderedResolution = () => {
    const made = exportOutput.current;
    return made ? `${made.width}x${made.height}` : exportedResolution.current;
  };

  const handleSaveExportRecord = async ({ fileName, fileSizeBytes, durationSec, renderMs }: { fileName: string; fileSizeBytes: number; durationSec: number; renderMs: number }) => {
    // Counted on every studio, public included, with nothing to say who
    // exported: the owner's /stats. Not waited on.
    fetch('/api/export-count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surah: selectedSurah, durationSec: Math.round(durationSec), aspectRatio: canvasConfig.aspectRatio }),
    }).catch(() => {});
    try {
      const projectId = await saveRenderedProject(renderedProject.current);
      // A public studio keeps no render log; the project is in this browser.
      if (studio.mode === 'public') return;
      await fetch('/api/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          clipId: '',
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
      setUploadTags(null);
      setAudioKey('');
      setAwaitingAudio(null);
      setTrimWindow(null);
      setVideoBgOffset(0);
      setUploadIsVideo(false);
      return;
    }

    const blob = proj.audioKey ? await loadProjectAudio(proj.audioKey) : null;
    setUploadOriginalName(fileName);
    setUploadTags(normalizeAudioTags(proj.audioTags));
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
      setAwaitingAudio({ fileName, trim, key: proj.audioKey || undefined, source: normalizeAudioTags(proj.audioTags)?.source });
      setMatchStatus({ text: t.match.awaitingAudio(fileName), tone: 'info' });
      return;
    }

    // Stored as the file the timeline belongs to, so it is adopted as it is --
    // no re-cut, and nothing to recompute.
    const file = new File([blob], fileName, { type: blob.type || 'audio/wav' });
    // Saved before tags were kept: the stored copy may still carry its own.
    if (!proj.audioTags) void tagsOf(file).then(setUploadTags);
    const url = URL.createObjectURL(file);
    // Unknown until measured below: the last file's length, left in the meantime, made a short clip read as long.
    setCustomAudioDuration(0);
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
   * What opening a project starts over: nothing waits to be adjusted or
   * chosen; a recording may be mapped once its own audio is in, a clip with
   * no captions matched, and a clip's captions taken from its recording's map.
   */
  const noteOpened = (proj: any) => {
    pendingWindows.current = null;
    setAdjusting(null);
    setPicked(null);
    setTickedSuggestions(new Set());
    const clip = proj.audioTags?.clip === true;
    mapCandidate.current = proj.audioFileName && proj.audioKey && !clip ? proj.audioKey : null;
    const cut = proj.trimWindow as { start: number; end: number } | null | undefined;
    matchClipOnOpen.current = clip && proj.audioKey && cut && !(proj.versesJson?.length) ? { key: proj.audioKey, seconds: cut.end - cut.start } : null;
    if (clip) void takeCaptionsFromMap(proj);
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
    noteOpened(proj);
    setSelectedSurah(proj.surahNumber || 1);
    setAyahStart(proj.ayahStart || 1);
    setAyahEnd(proj.ayahEnd || 7);
    setAyahStartInput(String(proj.ayahStart || 1));
    setAyahEndInput(String(proj.ayahEnd || 7));
    setSurahNameArabic(proj.surahNameArabic || 'الفاتحة');
    setSurahNameEnglish(proj.surahNameEnglish || 'Al-Fatihah');
    setSelectedReciter(proj.reciterId || RECITERS[0].id);
    // A project keeps its edit in its address: the recording, and the edit
    // its captions are timed against.
    const saved = splitAddress(proj.audioUrl || '');
    audioEditRef.current = saved.edit ?? NO_EDIT;
    setAudioEdit(audioEditRef.current);
    setAudioUrl(saved.source || proj.audioUrl || DEFAULT_AUDIO_URL);
    setVerses(proj.versesJson || []);
    setIsSampleProject(false);
    // Overrides the url just set whenever this project came from an upload --
    // `proj.audioUrl` is that upload's `blob:` url, which died with the tab
    // that made it.
    void restoreProjectAudio(proj);
    // The project before's note -- a long recording being read, say -- is not this one's.
    setMatchStatus(null);
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
      ayahNumberPlacement: placementOf(proj.ayahNumberPlacement),
      ayahMarkerStyle: markerStyleOf(proj.ayahMarkerStyle),
      showTafsir: proj.showTafsir === true,
      showRepeatMark: proj.showRepeatMark ?? true,
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
    // The old layout's clips, kept as stored, and made projects of their own once the recording is in.
    windowClips.current = normalizeClips(proj.clips);
    if (windowClips.current.length && proj.audioKey && typeof proj.id === 'string') pendingWindows.current = { id: proj.id, key: proj.audioKey };
  };

  /**
   * Opens a project from Projects: a clip of the old layout as the project it
   * is made into (`migrateWindowClips`), or the recording ready to choose the
   * next clip's stretch.
   */
  const openSavedProject = (project: unknown, open?: { clipId: string | null; newClip?: boolean }) => {
    openAfterMigration.current = open?.clipId ?? null;
    void handleLoadSavedProject(project).then(() => setNewClipHint(!!open?.newClip));
  };

  // Once the recording whose windows wait is in -- and read by the server, for a long one, which cuts it.
  useEffect(() => {
    const file = customAudioFile;
    const pending = pendingWindows.current;
    if (!file || !pending || awaitingAudio || audioKey !== pending.key || clipProject.current?.id !== pending.id || !(customAudioDuration > 0)) return;
    if (isLongAudio(customAudioDuration) && !playable.long) return;
    pendingWindows.current = null;
    void migrateWindowClips(file, pending, windowClips.current)
      .catch(err => setMatchStatus({ text: t.clips.cutFailed((err as Error).message), tone: 'error' }));
  });

  const familySource = studio.mode === 'public' ? undefined : uploadTags?.source;
  useEffect(() => {
    if (!familySource) return;
    let stale = false;
    void Promise.all([
      listProjects(studio.mode),
      fetch('/api/exports?done=1').then(res => (res.ok ? res.json() : null)).catch(() => null),
    ]).then(([rows, exports]: [unknown[] | null, { done?: { projectId: string; clipId: string }[] } | null]) => {
      if (stale) return;
      const { recording, clips } = familyOf(asLibraryProjects(rows ?? []), familySource);
      const done = new Set((exports?.done ?? []).map(row => `${row.projectId}/${row.clipId}`));
      // A clip made from a window of the old layout has that window's render too.
      const exported = new Set(clips.filter(clip => done.has(`${clip.id}/`) || (!!clip.audioTags?.windowOf && done.has(clip.audioTags.windowOf))).map(clip => clip.id));
      setFamily({ source: familySource, recording, clips, done: exported });
    });
    return () => { stale = true; };
  }, [familySource, familyVersion, studio.mode]);
  /** The tabs: the open upload's recording and its clips, once read; none for anything else. */
  const tabs = family && family.source === familySource ? family : null;
  /** Another tab opened: the page open now saved first, as each tab keeps its own work. */
  const openTab = async (project: LibraryProject | null, newClip = false) => {
    if (!project) return;
    if (project.id !== openProjectId) {
      const opened = await withClipAudio(project).catch(() => project);
      if (openProjectId && !isSampleProject) await handleSaveProject();
      await handleLoadSavedProject(opened);
    }
    setNewClipHint(newClip);
  };
  /**
   * A clip whose audio is not kept in this browser -- made in another, or
   * since cleared -- given it again, cut from the recording open now. Anything
   * else as it is.
   */
  const withClipAudio = async (clip: LibraryProject): Promise<LibraryProject> => {
    const file = customAudioFile;
    const window = clip.trimWindow;
    if (!file || !window || uploadTags?.clip || !uploadTags?.source || uploadTags.source !== clip.audioTags?.source) return clip;
    if (clip.audioKey && (await loadProjectAudio(clip.audioKey))) return clip;
    const origin = trimWindow?.start ?? 0;
    const key = clip.audioKey || newAudioKey();
    const cut = await cutClipAudio(file, window.start - origin, window.end - origin);
    return (await storeProjectAudio(key, cut)) ? { ...clip, audioKey: key } : clip;
  };
  /** A clip deleted from its tab: its row and, unless another project uses it, its audio; the recording opened if it was the one open. */
  const removeClipTab = async (id: string) => {
    const clip = tabs?.clips.find(each => each.id === id);
    const res = await deleteProject(id, studio.mode);
    if (!res.ok) {
      setMatchStatus({ text: t.clips.removeFailed(res.error || String(res.status)), tone: 'error' });
      return;
    }
    if (clip?.audioKey) {
      const others = ((await listProjects(studio.mode)) ?? []).map(row => row.audioKey).filter((key): key is string => typeof key === 'string' && !!key);
      await forgetProjectAudio(clip.audioKey, others);
    }
    setFamilyVersion(n => n + 1);
    if (id === openProjectId && tabs?.recording) await handleLoadSavedProject(tabs.recording);
  };

  /** The recording's ayah map, matched a stretch at a time (`useAyahMap`). */
  const ayahMap = useAyahMap();
  /** The project as it stands at the moment it is asked for, for saves made while a long run goes on. */
  const latestPayload = useRef(currentProjectPayload);
  useEffect(() => { latestPayload.current = currentProjectPayload; });
  /** The recording matched in parts: a long one on the server's copy, a shorter one sending itself (no copy). */
  const partsOf = () => playable.long
    ?? (customAudioFile && !playable.isLong && matchesInParts(customAudioDuration) && recordingPauses.length ? { id: '', duration: customAudioDuration } : null);
  /**
   * What mapping starts from: a long recording saved first, with its source,
   * as it was; a shorter one not yet, only its source known. Null when the
   * long one's save left no project.
   */
  const beginMapping = async (file: File): Promise<{ tags: AudioTags | null; recordingId?: string } | null> => {
    if (playable.long) {
      const { tags } = await saveRecordingForClip(file);
      const recordingId = clipProject.current?.id;
      return recordingId ? { tags, recordingId } : null;
    }
    const source = uploadTags?.source ?? (await recordingSource(file));
    return { tags: source ? { ...uploadTags, source } : uploadTags };
  };
  /** The recording's clips that have captions, on its clock -- read afresh, not from the tabs, which may not have loaded yet. */
  const captionedClips = async (source: string | undefined) => {
    const origin = trimWindow?.start ?? 0;
    const clips = source ? familyOf(asLibraryProjects((await listProjects(studio.mode)) ?? []), source).clips : [];
    return clips.flatMap(clip => (clip.trimWindow && Array.isArray(clip.versesJson) && clip.versesJson.length
      ? [{ verses: clip.versesJson as VerseData[], window: { start: clip.trimWindow.start - origin, end: clip.trimWindow.end - origin } }] : []));
  };
  /**
   * The map so far saved as the recording's project, named and numbered from
   * the map itself -- the last render's passage lags a part behind -- with its
   * audio stored the first time. The project's id.
   */
  const saveMapPart = async (next: VerseData[], tags: AudioTags | null, recordingId?: string): Promise<string> => {
    const named = SURAHS_LIST.find(each => each.number === surahOfMap(next));
    const held = timelinePassage(next, { surahNumber: named?.number ?? 0, start: 0, end: 0 });
    // The passage is the ayahs the map holds, not the whole surah: a recording of 32:13-25 is 32:13-25.
    if (named) takePassage({ ...unmatchedPassage(named.number), ...(held.start > 0 && { ayahStart: held.start, ayahEnd: held.end }) });
    const payload = latestPayload.current({
      verses: next, audioTags: tags,
      ...(named && { surahNumber: named.number, surahNameArabic: named.nameArabic, surahNameEnglish: named.nameEnglish }),
      ...(held.start > 0 && { ayahStart: held.start, ayahEnd: held.end }),
    });
    const id = recordingId ?? clipProjectId(payload);
    const kept = recordingId ? { payload } : await storeUploadFor(payload);
    const res = await saveProject({ ...kept.payload, id }, studio.mode);
    if (!res.ok) throw new Error(t.header.saveFailedStatus(res.status));
    if (!recordingId) rememberClipProject(id, payload);
    return id;
  };
  /**
   * Maps the open recording a part at a time: each stretch nothing covers yet
   * matched and merged in, the map shown and saved after each, seeded from the
   * captions it has and its clips' -- which a match never replaces. A long
   * recording is saved first, with its source; a shorter one once its first
   * part has captions, as nothing is a project before it is matched. Named by
   * the surah the map holds. Stops if another project is opened, and carries
   * on from where it was when this one is opened again.
   */
  const startMapping = async () => {
    const file = customAudioFile;
    const long = partsOf();
    if (!file || !long || ayahMap.running || studio.mode === 'public' || isEdited(audioEdit) || uploadTags?.clip) return;
    const key = audioKey;
    const begun = await beginMapping(file);
    if (!begun) return;
    const { tags } = begun;
    let recordingId = begun.recordingId;
    const mapping: MatchRun = { flow: playable.long ? 'long' : 'parts', phase: 'matching', file: true };
    setMatchRun(mapping);
    const captioned = await captionedClips(tags?.source);
    setMatchStatus({ text: t.clips.mapping(0, 0), tone: 'info' });
    const { map, error } = await ayahMap.start({
      file, long, pauses: recordingPauses, seed: seedFromClips(verses, captioned),
      surah: selectedSurah, ayahs: SURAHS_LIST.find(each => each.number === selectedSurah)?.numberOfAyahs ?? ayahEnd,
      reciter: selectedReciter, provider: matchProvider, breaks: screenBreaks,
      stillOpen: () => (recordingId ? clipProject.current?.id === recordingId : mapCandidate.current === key),
      onProgress: async next => {
        setVerses(next);
        recordingId = await saveMapPart(next, tags, recordingId);
      },
      onStep: (done, total) => {
        setMatchStatus({ text: t.clips.mapping(done, total), tone: 'info' });
        setMatchRun({ ...mapping, parts: { done, total } });
      },
      onAligner: seen => setMatchRun(prev => prev && {
        ...prev,
        queue: seen.position > 0 ? { position: seen.position, wait: seen.etaSeconds === null ? null : roughWait(seen.etaSeconds) } : null,
        aligner: seen.aligner,
      }),
    });
    setMatchRun(null);
    if (map) setMatchStatus({ text: t.clips.mapped(new Set(map.map(verse => verse.verseKey)).size), tone: 'info' });
    else if (error) setMatchStatus({ text: t.clips.mapFailed(error), tone: 'error' });
  };
  useEffect(() => { startMappingRef.current = startMapping; });
  /** The recordings a map has been started for this visit, so one that stopped is not started again by itself. */
  const mapTried = useRef(new Set<string>());
  // A recording matched in parts -- a long one once the server has read it -- is mapped by itself once its pauses are known.
  useEffect(() => {
    const long = partsOf();
    if (!long || !customAudioFile || !audioKey || mapCandidate.current !== audioKey || uploadTags?.clip) return;
    if (adjusting || ayahMap.running || !recordingPauses.length) return;
    if (studio.mode === 'public' || isEdited(audioEdit) || mapTried.current.has(audioKey)) return;
    if (coverage(isSampleProject ? [] : verses, { start: 0, end: long.duration }) >= 0.95) return;
    mapTried.current.add(audioKey);
    void startMappingRef.current?.();
  });

  /** The ayahs the open recording's clips hold, which the grid marks. */
  const clippedAyahs = useMemo(() => new Set((tabs?.clips ?? []).flatMap(clip =>
    (Array.isArray(clip.versesJson) ? clip.versesJson as VerseData[] : []).map(verse => verse.verseKey))), [tabs]);

  /** The suggestions chosen made clips, ticks cleared: from Suggested clips, or beside their bars on the timeline. */
  const makeSuggested = (stretches: { start: number; end: number }[]) => {
    setTickedSuggestions(new Set());
    void makeClips(stretches);
  };
  /** Clips suggested from an open recording's captions (`suggestClips`); none for a clip or anything else. */
  /** The surah the open recording's map holds, for its sections; none for a clip or a map of several. */
  const mapSurah = customAudioFile && !isClipProject ? surahOfMap(verses) : undefined;
  /** That surah's sections (`/api/quran/sections`) -- its topic groups, or its rukus -- once asked; suggestions go by them. */
  const [surahSections, setSurahSections] = useState<{ surah: number; kind: SectionKind; list: SurahSection[] } | null>(null);
  useEffect(() => {
    if (!mapSurah || surahSections?.surah === mapSurah) return;
    let stale = false;
    fetch(`/api/quran/sections?surah=${mapSurah}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (stale) return;
        const list: SurahSection[] = Array.isArray(data?.sections) ? data.sections : [];
        setSurahSections({ surah: mapSurah, kind: data?.kind === 'topic' ? 'topic' : 'ruku', list });
      })
      .catch(() => { /* by length, then, as before the sections were known */ });
    return () => { stale = true; };
  }, [mapSurah, surahSections?.surah]);
  const sections = surahSections && surahSections.surah === mapSurah ? surahSections : undefined;
  const suggestions = useMemo(
    () => (customAudioFile && !isClipProject && verses.length ? suggestClips(verses, suggestTarget, audioDuration, sections) : []),
    [customAudioFile, isClipProject, verses, suggestTarget, audioDuration, sections]
  );
  const makeTickedSuggestions = () => makeSuggested(suggestions.filter(each => tickedSuggestions.has(suggestionId(each))));

  const currentSurahObj = SURAHS_LIST.find(s => s.number === selectedSurah) || SURAHS_LIST[0];

  /** Whether a passage is loaded or matched, as opposed to the sample the studio opens on. */
  const hasClip = canSaveProject;
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

  /** A match, a long recording's mapping, or an upload about to be matched, under way. */
  const matchBusy = isMatching || ayahMap.running || matchRun !== null;
  /** Where a match has got to, or why it stopped. */
  const matchStatusBlock = matchBusy ? (
    <MatchProgress run={matchRun ?? { flow: 'upload', phase: 'matching', file: false }} />
  ) : matchStatus && (
    <div className={`text-xs rounded-lg p-3 flex items-start gap-2.5 ${
      matchStatus.tone === 'error'
        ? 'bg-red-500/10 border border-red-500/20 text-red-300'
        : 'bg-amber-500/10 border border-amber-500/20 text-amber-300'
    }`}>
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
        src={playUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          handleLoadedMetadata();
          // A long upload's length is the server's read of it, the clock its copy and every cut are on.
          if (playable.long) setAudioDuration(playable.long.duration);
        }}
        onCanPlay={handleCanPlay}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={(e) => {
          // The server's copy of a long upload is let go after a day: read the recording again, once.
          if (playable.long && !longRereadRef.current) {
            longRereadRef.current = true;
            playable.refresh();
            return;
          }
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
          {/* Reloads the studio. It used to be no link at all, because the
              project lived only in component state and leaving discarded
              unsaved work; the clip is now kept in this browser as a draft
              and offered back after the reload. */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="font-display text-xl leading-none text-parchment truncate hover:text-amber-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded"
          >
            {t.header.wordmark}
          </button>

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
            {canSaveProject && <div className="flex items-center gap-1.5 text-xs text-slate-400 min-w-0">
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
            </div>}
          </div>
        </div>

        {tabs && (tabs.recording || tabs.clips.length > 0) && (
          <div className="flex-1 min-w-0 flex">
            <ClipTabs
              clips={tabs.clips.map(clip => ({ id: clip.id, label: clipTabLabel(clip) }))}
              activeId={tabs.clips.some(clip => clip.id === openProjectId) ? openProjectId : null}
              exported={tabs.done}
              onOpen={id => { void openTab(id ? tabs.clips.find(clip => clip.id === id) ?? null : tabs.recording); }}
              onRemove={id => { void removeClipTab(id); }}
              onNew={() => { void openTab(tabs.recording, true); }}
            />
          </div>
        )}

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

          <Button variant="primary" size="md" onClick={openExport} icon={<Sparkles className="w-4 h-4 fill-current" />} data-tour="export">
            {t.header.export}
          </Button>
        </div>
      </header>

      {staysUp(saveStatus) && (
        <SaveNotice
          status={saveStatus}
          onRetry={saveStatus.action === 'save' ? handleSaveProject
            : saveStatus.action === 'ground-truth' ? () => void handleDownloadGroundTruth() : undefined}
          onDismiss={() => setSaveStatus(null)}
        />
      )}

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
            className="w-full lg:w-auto flex-1 lg:flex-none min-h-0 border-e border-slate-800 bg-slate-900/60 backdrop-blur-sm flex flex-col lg:flex-row overflow-hidden"
          >
            <PanelRail value={railItem} onChange={openRailItem} toCheck={toCheckCount} expanded={railExpanded} onExpandedChange={railExpandedPreference.set} />
            <div className="flex-1 lg:flex-none lg:w-[344px] min-w-0 min-h-0 flex flex-col overflow-hidden">
            {panelTab !== 'style' && (
              <PanelHead
                className="max-lg:hidden"
                title={panelTab === 'source' ? t.panel.source : t.panel.captions}
                summary={panelTab === 'source'
                  ? `${surahNameEnglish} ${selectedSurah}:${ayahStart}–${ayahEnd}`
                  : toCheckCount > 0 ? t.panel.toCheck(toCheckCount) : ''}
              />
            )}
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
                        <dd className="font-mono text-slate-200" dir="ltr">{formatDuration(exportRange.span)}</dd>
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
                      <div className="mt-2 grid gap-2 grid-cols-1">
                        <button
                          onClick={handleAutoMatchReciter}
                          disabled={isMatching}
                          title={t.match.alignReciterTitle}
                          className="py-2 px-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                        >
                          {isMatching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          <span>{t.match.alignReciter}</span>
                        </button>
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
                        {canEditAudio && (
                          <Button icon={<AudioLines className="w-3.5 h-3.5 text-amber-400" />} onClick={() => { void openEditAudio(); }} title={t.editAudio.openTitle}>
                            {t.editAudio.open}
                          </Button>
                        )}
                        {isClipProject && (
                          <Button icon={<Layers className="w-3.5 h-3.5 text-amber-400" />} onClick={() => { void startAdjust(); }} title={t.clips.adjustTitle}>
                            {t.clips.adjust}
                          </Button>
                        )}
                        {isClipProject && <ClipEnds onNudge={(edge, by) => { void nudgeClip(edge, by); }} />}
                        {adjusting && (
                          <Button onClick={() => { void handleLoadSavedProject(adjusting.payload); }}>
                            {t.clips.backToClip}
                          </Button>
                        )}
                      </div>
                    </section>

                    {customAudioFile && (
                      <ClipsPanel
                        captions={verses}
                        clipped={clippedAyahs}
                        onPick={(first, last) => {
                          const span = ayahWindow(verses, first, last, audioDuration);
                          if (span) setPicked(prev => ({ ...span, seq: (prev?.seq ?? 0) + 1 }));
                        }}
                        onAddByAyahs={(first, last) => {
                          const span = ayahWindow(verses, first, last, audioDuration);
                          if (span) addRecordingClip(span.start, span.end);
                        }}
                      />
                    )}
                    <SuggestedClips suggestions={suggestions} target={suggestTarget}
                      onTarget={seconds => { setSuggestTarget(seconds); setTickedSuggestions(new Set()); }}
                      ticked={tickedSuggestions} onToggle={toggleSuggestion} clipped={clippedAyahs}
                      onPreview={start => { handleSeek(start); void audioElementRef.current?.play(); }}
                      onMake={makeSuggested} />

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
                <PassageBookmarks passage={{ surah: selectedSurah, start: ayahStart, end: ayahEnd }} onPick={pickPassage} />

                {/* Reciter Selector */}
                <div>
                  <label htmlFor="reciter-select" className="text-xs font-semibold text-slate-300 block mb-1.5">{t.source.selectReciter}</label>
                  <div className="flex gap-2">
                  <select
                    id="reciter-select"
                    value={selectedReciter}
                    onChange={(e) => setSelectedReciter(e.target.value)}
                    className="w-full h-11 bg-slate-950 border border-slate-700 rounded-lg px-3 text-slate-100 text-sm"
                  >
                    {(() => {
                      // A project saved with a reciter since hidden still shows who it is.
                      const groups = reciterGroups([
                        ...listedReciters(),
                        ...RECITERS.filter(r => r.id === selectedReciter && !listedReciters().includes(r)),
                      ], favouriteReciterIds, recentReciterIds);
                      // An option's value appears once in a select, so a starred
                      // reciter is listed under its group and not again below.
                      const shortcut = new Set([...groups.favourites, ...groups.recent].map(r => r.id));
                      const options = (reciters: typeof groups.all) => reciters.map(r => (
                        <option key={r.id} value={r.id}>
                          {locale === 'ar' ? `${r.arabicName} — ${r.name}` : `${r.name} — ${r.arabicName}`}
                        </option>
                      ));
                      if (!shortcut.size) return options(groups.all);
                      return (
                        <>
                          {groups.favourites.length > 0 && <optgroup label={t.source.favouriteReciters}>{options(groups.favourites)}</optgroup>}
                          {groups.recent.length > 0 && <optgroup label={t.source.recentReciters}>{options(groups.recent)}</optgroup>}
                          <optgroup label={t.source.allReciters}>{options(groups.all.filter(r => !shortcut.has(r.id)))}</optgroup>
                        </>
                      );
                    })()}
                  </select>
                  <FavouriteStar reciterId={selectedReciter} />
                  </div>
                  {/* Whether this voice has published ayah timings decides
                      whether "Load ayahs & audio" produces a real timeline
                      or one you have to set by hand, so it stays beside the
                      choice rather than in a note underneath it. */}
                  {selectedReciterMeta && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {/* Every built-in reciter is one file per ayah, so every one is timed. */}
                      {(
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

                        <FolderPicker
                          accepts={file => file.type.startsWith('audio') || isVideoFile(file) || /\.(mp3|wav|m4a|ogg|opus|flac|aac)$/i.test(file.name)}
                          onPick={({ file, folder }) => { void acceptRecitationFile(file, folder); }}
                        />

                        {/* Every upload is matched by itself, so while that runs its options
                            are not offered: they are back if it fails, or with Edit source and match. */}
                        {!(matchBusy && !sourceEditing) && (<>
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
                        </>)}
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
                    ayahNumberAtEnd={placementOf(canvasConfig.ayahNumberPlacement) === 'end'}
                    translationIds={canvasConfig.translationIds?.length ? canvasConfig.translationIds : [DEFAULT_TRANSLATION_ID]}
                    onTranslationIds={ids => setCanvasConfig(prev => ({ ...prev, translationIds: ids }))}
                    onTranslationText={edit.translationText}
                    tafsir={canvasConfig.showTafsir ? tafsir.texts : undefined}
                    onTafsirText={setTafsir}
                    translationFollowsWords={!!canvasConfig.translationFollowsWords}
                    onTranslationFollowsWords={follows =>
                      setCanvasConfig(prev => ({ ...prev, translationFollowsWords: follows }))}
                    onVerseNumber={edit.verseNumber}
                    onRepeat={edit.repeat}
                    onToggleWord={edit.toggleWord}
                    onNudge={(edge, delta) => edit.nudge(edge, delta, audioDuration, rippleEdits)}
                    onReorder={edit.reorder}
                    onDuplicate={() => edit.duplicate(audioDuration)}
                    onDelete={edit.remove}
                    onCutAudio={canEditAudio ? cutSelectedAudio : undefined}
                    onAdd={edit.add}
                    currentTime={currentTime}
                    timeOrigin={passage?.start ?? 0}
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
              <div id="panel-style" role="tabpanel" aria-labelledby={`panel-tab-${styleArea}`} data-tour="panel-style" className="flex-1 overflow-y-auto">
                <StyleConfigPanel
                  config={canvasConfig}
                  onChangeConfig={setCanvasConfig}
                  clipDuration={audioDuration}
                  laneBlocks={bgSegments}
                  selectedBackground={activeBackground}
                  onSelectBackground={setSelectedBackground}
                  only={wide ? styleArea : null}
                  onAnotherBackground={() => { void findAnotherBackground(); }}
                  findingBackground={findingBackground}
                />
              </div>
            )}
            </div>
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
                tafsir={tafsir.texts}
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
          audioUrl={playUrl}
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
          onEditAudio={canEditAudio ? () => { void openEditAudio(); } : undefined}
          exportSeconds={verses.length ? exportRange.span : undefined}
          onTrimRange={(customAudioFile && !isLongAudio(customAudioDuration)) || (!customAudioFile && verses.length) ? handleTrimRange : undefined}
          // A clip is made of what is loaded: an upload, or a built-in reciter's passage -- not the sample.
          onAddClip={customAudioFile || (!isSampleProject && verses.length > 0) ? addRecordingClip : undefined}
          makeText={adjusting ? t.clips.updateClip : undefined}
          selection={adjusting?.window ?? picked}
          frame={adjusting ? null : picked}
          pauses={recordingPauses}
          suggestions={suggestions.map(each => ({ id: suggestionId(each), start: each.start, end: each.end, label: [suggestionLabel(each), each.section ? sectionName(t, each.section) : ''].filter(Boolean).join(' · '), ticked: tickedSuggestions.has(suggestionId(each)) }))}
          onToggleSuggestion={toggleSuggestion}
          onMakeSuggestions={makeTickedSuggestions}
          selectHint={newClipHint}
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
            output,
            longStretch
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
        onLoadProject={openSavedProject}
        onNewClip={startNewClip}
        onSaveCurrent={handleSaveProject}
        onDeleted={detachDeleted}
      />

      {/* Audio Trim Modal */}
      {customAudioFile && customAudioUrl && (
        <AudioTrimModal
          key={`${customAudioFile.name}-${customAudioFile.size}-${customAudioFile.lastModified}`}
          isOpen={showTrimModal}
          file={customAudioFile}
          onCancel={() => setShowTrimModal(false)}
          onApply={result => {
            if (!isEdited(audioEditRef.current)) {
              handleApplyTrim(result);
              return;
            }
            // The upload is edited: the trim is a cut of the edit, the file kept whole.
            setShowTrimModal(false);
            void applyAudioEdit(trimmedTo(audioEditRef.current, { start: result.trimStart, end: result.trimEnd }, customAudioDuration));
          }}
        />
      )}
      {showEditAudio && editAudioStart && (
        <AudioEditModal
          isOpen={showEditAudio}
          source={editAudioSource}
          edit={audioEdit}
          initial={editAudioStart.edit}
          nowLength={exportRange.span}
          captions={editAudioStart.captions}
          isUpload={!!customAudioFile}
          videoBackground={uploadIsVideo && useVideoAsBackground && canvasConfig.bgUrl === videoBgUrl}
          onCancel={() => setShowEditAudio(false)}
          onApply={next => {
            setShowEditAudio(false);
            void applyAudioEdit(next);
          }}
        />
      )}
    </div>
  );
}
