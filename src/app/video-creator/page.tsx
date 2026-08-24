'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  VideoCanvas, 
  VideoCanvasConfig, 
  VideoCanvasRef 
} from '@/components/VideoCanvas';
import { TimelineSyncEditor } from '@/components/TimelineSyncEditor';
import { StyleConfigPanel } from '@/components/StyleConfigPanel';
import { AudioTrimModal, formatDuration } from '@/components/AudioTrimModal';
import { describeGpu } from '@/lib/gpuInfo';
import { PaletteSwitcher } from '@/components/PaletteSwitcher';
import { OverflowMenu, OverflowItem } from '@/components/OverflowMenu';
import { EmptyStep } from '@/components/EmptyStep';
import { Button } from '@/components/Button';
import { trimTimeline } from '@/lib/matchTimeline';
import type { TrimResult } from '@/lib/audioTrim';
import { GpuExportModal } from '@/components/GpuExportModal';
import { SavedProjectsDrawer } from '@/components/SavedProjectsDrawer';
import { 
  SURAHS_LIST,
  RECITERS,
  SAMPLE_PROJECTS,
  BACKGROUND_VIDEOS,
  VerseData
} from '@/lib/quranData';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Volume2, 
  VolumeX, 
  Sparkles, 
  Save, 
  FolderOpen, 
  Cpu, 
  Sliders, 
  Clock, 
  Layers, 
  Upload, 
  Music, 
  BookOpen, 
  Check, 
  ChevronRight,
  Video,
  Server,
  Scissors,
  AlertTriangle,
  Loader2,
  Film,
  ChevronDown
} from 'lucide-react';

export default function VideoCreatorPage() {
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
  const [customAudioBuffer, setCustomAudioBuffer] = useState<ArrayBuffer | null>(null);
  const [showTrimModal, setShowTrimModal] = useState(false);
  /** Set when the upload was a video file, so its footage can double as the background. */
  const [uploadIsVideo, setUploadIsVideo] = useState(false);
  const [useVideoAsBackground, setUseVideoAsBackground] = useState(true);
  /** Blob URL of the original video, kept whole even after the audio is trimmed. */
  const [videoBgUrl, setVideoBgUrl] = useState<string | null>(null);
  /** Seconds trimmed off the front of the audio that `videoBgUrl` still contains. */
  const [videoBgOffset, setVideoBgOffset] = useState(0);
  const [matchStatus, setMatchStatus] = useState<string | null>(null);
  const [isMatching, setIsMatching] = useState<boolean>(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [matchProvider, setMatchProvider] = useState<'gemini' | 'asr' | 'align' | 'hybrid'>('align');
  const [providerStatus, setProviderStatus] = useState<{
    gemini: { configured: boolean };
    asr: { configured: boolean; serviceUrl: string };
    align: {
      configured: boolean;
      serviceUrl: string;
      canAutoDetectRange?: boolean;
      alignReady?: boolean;
      alignError?: string | null;
    };
    hybrid: { configured: boolean; serviceUrl: string; alignReady?: boolean; alignError?: string | null };
  } | null>(null);

  // Loaded Surah / Verse Data
  const [surahNameArabic, setSurahNameArabic] = useState<string>('الفاتحة');
  const [surahNameEnglish, setSurahNameEnglish] = useState<string>('Al-Fatihah');
  const [audioUrl, setAudioUrl] = useState<string>('https://server11.mp3quran.net/download/sds/001.mp3');
  const [verses, setVerses] = useState<VerseData[]>(SAMPLE_PROJECTS[0].verses);
  /**
   * The studio opens with Al-Fatihah already in the timeline so the preview is
   * not blank on a first visit. That is useful, but it is indistinguishable
   * from a project you loaded yourself -- so say which it is until you replace
   * it. Cleared as soon as anything real arrives.
   */
  const [isSampleProject, setIsSampleProject] = useState<boolean>(true);

  // Audio Playback & Web Audio API
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [audioAnalyserNode, setAudioAnalyserNode] = useState<AnalyserNode | null>(null);
  
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(43.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(0.9);
  const [isLoadingVerses, setIsLoadingVerses] = useState<boolean>(false);
  const [loadResult, setLoadResult] = useState<{ ok: boolean; message: string; count?: number } | null>(null);

  // UI Tabs & Drawer
  const [sidebarTab, setSidebarTab] = useState<'quran' | 'timings' | 'style'>('quran');
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isProjectsDrawerOpen, setIsProjectsDrawerOpen] = useState<boolean>(false);

  // Video Export & Progress State
  const canvasRef = useRef<VideoCanvasRef | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportSpeed, setExportSpeed] = useState<string>('1.0x');
  const [saveStatus, setSaveStatus] = useState<{ text: string; kind: 'pending' | 'ok' | 'error' } | null>(null);

  // Studio Canvas Configuration
  const [canvasConfig, setCanvasConfig] = useState<VideoCanvasConfig>({
    aspectRatio: '9:16',
    fontArabic: 'Scheherazade New',
    fontTranslation: 'Inter',
    arabicFontSize: 38,
    transliterationFontSize: 24,
    translationFontSize: 20,
    ayahNumberFontSize: 34,
    textAlignment: 'center',
    textColor: '#ffffff',
    accentColor: '#b8c7dc',
    translationColor: '#d5dfec',
    textShadow: true,
    showTransliteration: false,
    showTranslation: true,
    showWaveform: true,
    showSurahBadge: true,
    surahBadgeText: '',
    surahBadgeSubtitleText: '',
    bgType: 'video',
    bgUrl: 'https://videos.pexels.com/video-files/18953366/18953366-hd_1080_1920_30fps.mp4',
    bgUrls: [],
    bgMode: 'single',
    bgCycleSeconds: 5,
    bgOverlayOpacity: 40,
    bgBlur: 0,
    cardBgOpacity: 30,
    cardBorder: true,
    watermarkText: '@QuranClips',
    watermarkPosition: 'bottom-right',
    fps: 60,
    gpuAccelerated: true
  });

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
        setLoadResult({ ok: false, message: 'Could not load those ayahs. Check your connection and try again.' });
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
      // The response is usually cached, so it returns faster than a frame and
      // the spinner never paints -- leaving the click with no visible result at
      // all, since the verses themselves appear on a different step. Confirm
      // what arrived and point at where it went.
      setLoadResult({ ok: true, message: `Loaded ${loaded.length} ${loaded.length === 1 ? 'ayah' : 'ayahs'}.`, count: loaded.length });
    } catch {
      setLoadResult({ ok: false, message: 'Could not load those ayahs. Check your connection and try again.' });
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
      setCustomAudioBuffer(await file.arrayBuffer());
      setUploadIsVideo(video);
      // A fresh upload starts un-trimmed, so the video and its audio share a
      // timeline until a trim introduces an offset.
      setVideoBgOffset(0);
      setVideoBgUrl(video ? url : null);
      if (video && useVideoAsBackground) {
        setCanvasConfig(prev => ({ ...prev, bgType: 'video', bgUrl: url }));
      }
      setMatchStatus(
        video
          ? 'Video uploaded — its audio will be used for matching, and its footage as the background. Choose AI Auto-match to detect and sync ayahs, or Manual Match to time segments yourself.'
          : 'Audio uploaded. Choose AI Auto-match to detect and sync ayahs, or Manual Match to time segments yourself.'
      );
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
    setCustomAudioBuffer(null);
    setAudioUrl(result.url);
    setAudioDuration(result.duration);
    setVerses(prev => trimTimeline(prev, result.trimStart, result.trimEnd));
    setCurrentTime(0);
    // Trimming re-encodes audio only, so the background video is still the full
    // original. Accumulate how far into it the new clip now starts, and the
    // canvas keeps the two lined up rather than losing the footage.
    setVideoBgOffset(prev => prev + result.trimStart);
    if (audioElementRef.current) {
      audioElementRef.current.src = result.url;
      audioElementRef.current.currentTime = 0;
      audioElementRef.current.load();
    }
    setMatchStatus(
      `Trimmed to ${formatDuration(result.duration)}. Re-run AI Auto-match for the trimmed clip, or review the adjusted timeline below.`
    );
    setShowTrimModal(false);
  };

  const handleAutoMatchUploadedAudio = async () => {
    if (!customAudioFile) {
      setMatchStatus('Upload an audio file before running AI auto-match.');
      return;
    }

    setIsMatching(true);
    setMatchStatus(
      matchProvider === 'align'
        ? 'Force-aligning the selected ayah range against your audio (first run loads the model — may take longer)...'
        : matchProvider === 'hybrid'
          ? 'Asking Gemini which ayahs these are, then timing them locally (first run loads the model — may take longer)...'
          : matchProvider === 'asr'
            ? 'Sending audio to the local ASR aligner (searching the full Quran — first run may take longer)...'
            : 'Sending audio to Gemini for analysis...'
    );

    const formData = new FormData();
    formData.append('audio', customAudioFile);
    formData.append('surah', String(selectedSurah));
    formData.append('start', String(ayahStart));
    formData.append('end', String(ayahEnd));
    formData.append('reciter', selectedReciter);
    formData.append('provider', matchProvider);
    // Measured from this exact file at upload time, not read off the player.
    // Gemini only estimates duration -- on the test clip it reported 108s for a
    // 68.5s file -- and the server has no decode of its own on that path, so
    // without this the timeline runs past the end of the audio.
    if (customAudioDuration > 0) {
      formData.append('audioDuration', String(customAudioDuration));
    }

    try {
      const res = await fetch('/api/audio/match', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setMatchStatus(data?.error || 'AI matcher is not configured. Use manual matching for this audio.');
        setSidebarTab('timings');
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
      const providerLabel =
        data.provider === 'align'
          ? 'Forced alignment'
          : data.provider === 'hybrid'
            ? 'Gemini + forced alignment'
            : data.provider === 'asr'
              ? 'Local ASR'
              : 'Gemini';
      // Kept user-facing and short: what was found, and what to do next. The
      // provider name, model, phrase counts and acoustic scores are diagnostics
      // -- they go to the console, not to someone making a video.
      console.log(`[match] ${providerLabel} • confidence ${(data.confidence ?? 0).toFixed(3)} • ${data.notes || ''}`);
      const detectedLabel = data.timelineTitle || data.surahNameEnglish || `Surah ${data.surahNumber}`;
      // A forced-aligned timeline looks equally confident whether or not the
      // range is right -- the acoustic score can't tell those apart (see
      // README.md). So when the range wasn't the user's own choice, ask them to
      // check it explicitly rather than implying the match verified itself.
      const confirmRange =
        data.provider === 'hybrid' || data.provider === 'align' || data.provider === 'asr';
      setMatchStatus(
        (data.warning ? `⚠ ${data.warning} ` : '') +
          `Detected ${detectedLabel} — ${(data.verses || []).length} segment(s). ` +
          (confirmRange
            ? 'Check that this is the right surah and ayah range for your audio, then review the timings below before publishing.'
            : 'Review the timings and text below before publishing.')
      );
      setSidebarTab('timings');
      setIsMatching(false);
    } catch {
      setMatchStatus('AI matcher failed. Use manual matching, or configure the server-side AI matcher and try again.');
      setSidebarTab('timings');
      setIsMatching(false);
    }
  };

  const handleManualMatchUploadedAudio = () => {
    setMatchStatus('Manual matching mode: assign ayah numbers and adjust start/end times for each audio segment.');
    setSidebarTab('timings');
  };

  // Audio Play / Pause Sync with Web Audio API Analyser
  const togglePlayPauseRef = useRef<() => void>(() => {});

  const togglePlayPause = useCallback(() => {
    const audio = audioElementRef.current;
    if (!audio) return;

    if (!audioContextRef.current) {
      try {
        const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        const source = ctx.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(ctx.destination);

        audioContextRef.current = ctx;
        analyserRef.current = analyser;
        setAudioAnalyserNode(analyser);
      } catch {
        // Audio node already connected or fallback
      }
    }

    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [isPlaying]);

  useEffect(() => {
    togglePlayPauseRef.current = togglePlayPause;
  }, [togglePlayPause]);

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

  // Seek time
  const handleSeek = (seconds: number) => {
    if (audioElementRef.current) {
      audioElementRef.current.currentTime = seconds;
      setCurrentTime(seconds);
    }
  };

  // Spacebar hotkey for Tap-To-Sync — uses ref to avoid stale closure
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault();
        togglePlayPauseRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Audio time update loop
  const handleTimeUpdate = () => {
    if (audioElementRef.current) {
      setCurrentTime(audioElementRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioElementRef.current) {
      setAudioDuration(audioElementRef.current.duration || 43.0);
      setAudioError(null); // clear any previous error on successful load
    }
  };

  // Save Project to Database
  const handleSaveProject = async () => {
    setSaveStatus({ text: 'Saving…', kind: 'pending' });
    try {
      const payload = {
        title: `${surahNameEnglish} (${selectedSurah}:${ayahStart}-${ayahEnd}) Clip`,
        surahNumber: selectedSurah,
        surahNameArabic,
        surahNameEnglish,
        ayahStart,
        ayahEnd,
        reciterId: selectedReciter,
        reciterName: RECITERS.find(r => r.id === selectedReciter)?.name || RECITERS[0]?.name || 'Abdul Rahman Al-Sudais',
        audioUrl,
        audioDuration: `${Math.floor(audioDuration / 60)}:${Math.floor(audioDuration % 60).toString().padStart(2, '0')}`,
        aspectRatio: canvasConfig.aspectRatio,
        fontArabic: canvasConfig.fontArabic,
        fontTranslation: canvasConfig.fontTranslation,
        arabicFontSize: canvasConfig.arabicFontSize,
        translationFontSize: canvasConfig.translationFontSize,
        transliterationFontSize: canvasConfig.transliterationFontSize,
        ayahNumberFontSize: canvasConfig.ayahNumberFontSize,
        textAlignment: canvasConfig.textAlignment,
        textColor: canvasConfig.textColor,
        accentColor: canvasConfig.accentColor,
        translationColor: canvasConfig.translationColor,
        textShadow: canvasConfig.textShadow,
        showTransliteration: canvasConfig.showTransliteration,
        showTranslation: canvasConfig.showTranslation,
        showWaveform: canvasConfig.showWaveform,
        showSurahBadge: canvasConfig.showSurahBadge,
        surahBadgeText: canvasConfig.surahBadgeText,
        surahBadgeSubtitleText: canvasConfig.surahBadgeSubtitleText,
        bgType: canvasConfig.bgType,
        bgUrl: canvasConfig.bgUrl,
        bgUrls: canvasConfig.bgUrls,
        bgMode: canvasConfig.bgMode,
        bgCycleSeconds: canvasConfig.bgCycleSeconds,
        bgOverlayOpacity: canvasConfig.bgOverlayOpacity,
        bgBlur: canvasConfig.bgBlur,
        cardBgOpacity: canvasConfig.cardBgOpacity,
        cardBorder: canvasConfig.cardBorder,
        watermarkText: canvasConfig.watermarkText,
        watermarkPosition: canvasConfig.watermarkPosition,
        versesJson: verses,
        fps: canvasConfig.fps,
        gpuAccelerated: canvasConfig.gpuAccelerated
      };

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
          text: data?.source === 'memory' ? 'Saved (this session)' : 'Project Saved!',
          kind: 'ok'
        });
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        const data = await res.json().catch(() => null);
        console.error('Save failed:', data?.error || res.status);
        setSaveStatus({ text: 'Save Failed', kind: 'error' });
        setTimeout(() => setSaveStatus(null), 5000);
      }
    } catch (err) {
      console.error('Save failed:', err);
      setSaveStatus({ text: 'Save Failed', kind: 'error' });
      setTimeout(() => setSaveStatus(null), 5000);
    }
  };

  /**
   * Matching options, named by the outcome the user is choosing between.
   *
   * These used to be labelled with their implementations -- "Forced Align",
   * "Gemini + Align", "Local ASR" -- and three of them reported "Sidecar
   * unreachable", which is the vocabulary of the failing subsystem and tells
   * someone who never installed a sidecar nothing they can act on. The real
   * decision is only ever: how accurate do you need the timing, and will you
   * send audio to the cloud. The implementation name is kept on hover for
   * anyone who does want it.
   */
  const matchOptions = [
    {
      id: 'align' as const,
      label: 'Most accurate',
      technical: 'local forced alignment',
      Icon: Server,
      ready: !!providerStatus?.align.configured && providerStatus.align.alignReady !== false,
      status: !providerStatus
        ? 'Checking…'
        : providerStatus.align.configured
          ? providerStatus.align.alignReady === false
            ? 'Helper needs restarting'
            : 'Ready'
          : 'Helper not running',
      blurb:
        'Finds the passage in the audio, then times every word against the real Quran text, so no word can be dropped or misheard. Nothing leaves your machine.',
      fix: 'This needs the local helper app running. Start it, then reload this page.'
    },
    {
      id: 'hybrid' as const,
      label: 'Best for unknown passages',
      technical: 'Gemini identification + local alignment',
      Icon: Sparkles,
      ready: !!providerStatus?.hybrid.configured,
      status: !providerStatus
        ? 'Checking…'
        : providerStatus.hybrid.configured
          ? 'Ready'
          : providerStatus.gemini.configured
            ? 'Helper not running'
            : 'Needs an API key',
      blurb:
        'Identifies which ayahs were recited in the cloud, then times them on your machine. Your audio is sent to Google. Best when you are not sure what the recording contains.',
      fix: 'This needs both an API key and the local helper running.'
    },
    {
      id: 'gemini' as const,
      label: 'No setup',
      technical: 'Gemini cloud matching',
      Icon: Sparkles,
      ready: !!providerStatus?.gemini.configured,
      status: !providerStatus ? 'Checking…' : providerStatus.gemini.configured ? 'Ready' : 'Needs an API key',
      blurb:
        'Works with nothing installed, but the timing is estimated rather than measured, so expect to correct it by hand. Your audio is sent to Google.',
      fix: 'Add a Gemini API key to use this option.'
    },
    {
      id: 'asr' as const,
      label: 'Roughest',
      technical: 'local transcription and search',
      Icon: Server,
      ready: !!providerStatus?.asr.configured,
      status: !providerStatus ? 'Checking…' : providerStatus.asr.configured ? 'Ready' : 'Helper not running',
      blurb:
        'Transcribes the audio locally and searches the Quran for a match. The least reliable option; useful mainly when the others are unavailable.',
      fix: 'This needs the local helper app running.'
    }
  ];
  const selectedMatchOption = matchOptions.find(o => o.id === matchProvider) ?? matchOptions[0];

  /**
   * On a phone the panel and the preview each got half the height, which
   * served neither: the panel was too short to work in and the preview -- a
   * 9:16 video, on the one device shaped for it -- overflowed its pane by
   * about 180px. Below `md` one surface is shown at a time instead.
   */
  const [mobileSurface, setMobileSurface] = useState<'panel' | 'preview'>('panel');

  const headerOverflowItems: OverflowItem[] = [
    {
      key: 'saved',
      label: 'Saved clips',
      icon: <FolderOpen className="w-4 h-4" />,
      onSelect: () => setIsProjectsDrawerOpen(true)
    },
    ...(customAudioFile
      ? [{
          key: 'trim',
          label: 'Trim audio',
          hint: customAudioDuration > 0 ? formatDuration(customAudioDuration) : undefined,
          icon: <Scissors className="w-4 h-4" />,
          onSelect: () => setShowTrimModal(true)
        }]
      : []),
    {
      key: 'save',
      label: 'Save project',
      hint: saveStatus?.text,
      icon: <Save className="w-4 h-4" />,
      onSelect: handleSaveProject
    }
  ];


  // Start Video Export Pipeline
  const handleStartExport = (targetFps: number, onComplete: (blob: Blob, renderMs: number) => void) => {
    if (!canvasRef.current || !audioElementRef.current) return;

    setIsExporting(true);
    setExportProgress(0);

    canvasRef.current.exportVideo(
      audioElementRef.current,
      audioDuration,
      (progress, speed) => {
        setExportProgress(progress);
        setExportSpeed(speed);
      },
      (blob, renderMs) => {
        setIsExporting(false);
        onComplete(blob, renderMs);
      },
      targetFps
    );
  };

  // Save Export record to DB
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
          resolution: canvasConfig.aspectRatio === '16:9' ? '1920x1080' : '1080x1920',
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
      transliterationFontSize: proj.transliterationFontSize || 24,
      translationFontSize: proj.translationFontSize || 20,
      ayahNumberFontSize: proj.ayahNumberFontSize || 34,
      textColor: proj.textColor || '#ffffff',
      accentColor: proj.accentColor || '#b8c7dc',
      translationColor: proj.translationColor || '#d5dfec',
      textAlignment: proj.textAlignment || 'center',
      textShadow: proj.textShadow ?? true,
      showTransliteration: proj.showTransliteration ?? false,
      showTranslation: proj.showTranslation ?? true,
      showWaveform: proj.showWaveform ?? true,
      showSurahBadge: proj.showSurahBadge ?? true,
      surahBadgeText: proj.surahBadgeText || '',
      surahBadgeSubtitleText: proj.surahBadgeSubtitleText || '',
      bgType: proj.bgType || 'video',
      bgUrl: proj.bgUrl || 'https://videos.pexels.com/video-files/18953366/18953366-hd_1080_1920_30fps.mp4',
      bgUrls: Array.isArray(proj.bgUrls) ? proj.bgUrls : [],
      bgMode: ['single', 'per-ayah', 'cycle', 'shuffle'].includes(proj.bgMode) ? proj.bgMode : 'single',
      bgCycleSeconds: proj.bgCycleSeconds || 5,
      bgOverlayOpacity: proj.bgOverlayOpacity ?? 40,
      bgBlur: proj.bgBlur ?? 0,
      cardBgOpacity: proj.cardBgOpacity ?? 30,
      cardBorder: proj.cardBorder ?? true,
      watermarkText: proj.watermarkText || '@QuranClips',
      watermarkPosition: proj.watermarkPosition || 'bottom-right',
      fps: proj.fps || 60,
      gpuAccelerated: proj.gpuAccelerated ?? true
    });
  };

  const currentSurahObj = SURAHS_LIST.find(s => s.number === selectedSurah) || SURAHS_LIST[0];

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Hidden Audio Element */}
      <audio
        ref={audioElementRef}
        src={audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
        onError={(e) => {
          const audio = e.currentTarget;
          const err = audio.error;
          const codes: Record<number, string> = {
            1: 'Audio loading was aborted.',
            2: 'Network error — could not reach the audio server. Check your internet connection.',
            3: 'Audio decoding failed. The file may be corrupted or in an unsupported format.',
            4: 'Audio source not supported or not found. The reciter URL may be incorrect for this surah.',
          };
          setAudioError(codes[err?.code || 4] || `Audio failed to load (error ${err?.code || 'unknown'}).`);
          setIsPlaying(false);
        }}
        crossOrigin="anonymous"
      />

      <h1 className="sr-only">
        Quran Clip Studio — {surahNameEnglish} {selectedSurah}:{ayahStart}&ndash;{ayahEnd}
      </h1>

      {/* Top Navbar */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md px-4 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3">
          {/* Not a link. The studio is the only page, so the wordmark had
              nowhere to go -- and because the whole project lives in component
              state, clicking it navigated away and silently discarded unsaved
              work. */}
          <span className="flex items-baseline gap-2">
            <span className="font-display text-xl leading-none text-parchment">Quran Clip</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold">Studio</span>
          </span>

          {/* The reference, set the way a mushaf cites itself: surah name, then
              the ayah span. Mono keeps the numerals aligned as they change. */}
          <div className="hidden md:flex items-baseline gap-2.5 ml-3 pl-4 border-l border-slate-800">
            <span className="font-display text-base text-parchment/90">{surahNameEnglish}</span>
            <span className="font-mono text-[11px] text-gold tracking-wider">
              {selectedSurah}:{ayahStart}&ndash;{ayahEnd}
            </span>
          </div>
        </div>

        {/* Action Controls Header.

            Below `lg` the secondary actions collapse into an overflow menu so
            the primary one keeps its place: five side-by-side controls pushed
            Export to 42% visible at 375px and made the bar scroll sideways
            with nothing to indicate it. */}
        <div className="flex items-center gap-2">
          <div className="hidden lg:flex items-center gap-2">
            <PaletteSwitcher />

            <Button onClick={() => setIsProjectsDrawerOpen(true)} icon={<FolderOpen className="w-3.5 h-3.5 text-amber-400" />}>
              Saved clips
            </Button>

            {/* Trimming is not a step you do once up front -- wanting to shave a
                second off the end after matching and editing is normal, and the
                timeline survives it. Keep it reachable from every step rather
                than only from the upload panel back in Quran & Reciter. */}
            {customAudioFile && (
              <Button
                onClick={() => setShowTrimModal(true)}
                title="Trim the uploaded audio — your timeline edits are kept"
                icon={<Scissors className="w-3.5 h-3.5 text-amber-400" />}
              >
                {`Trim audio${customAudioDuration > 0 ? ` (${formatDuration(customAudioDuration)})` : ''}`}
              </Button>
            )}

            <Button
              onClick={handleSaveProject}
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
              {saveStatus?.text || 'Save project'}
            </Button>
          </div>

          <div className="lg:hidden">
            <OverflowMenu items={headerOverflowItems} />
          </div>

          <Button variant="primary" size="md" onClick={() => setIsExportModalOpen(true)} icon={<Sparkles className="w-4 h-4 fill-current" />}>
            Export
          </Button>
        </div>
      </header>

      {/* Main Studio Workspace Split Screen */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Left Control Sidebar */}
        <aside
          className={`w-full md:w-[420px] border-r border-slate-800 bg-slate-900/60 backdrop-blur-sm flex-col h-full shrink-0 overflow-hidden ${
            mobileSurface === 'panel' ? 'flex' : 'hidden'
          } md:flex`}
        >
          {/* Sidebar steps.

              These are numbered because they genuinely are a sequence: you
              cannot sync timings before there is text and audio, and styling a
              timeline that does not exist yet is meaningless. The numeral is
              drawn as an ayah marker -- the mushaf's own device for marking
              position in a recitation -- rather than a bare digit. */}
          <nav aria-label="Studio steps" className="border-b border-slate-800 bg-ink/80">
            <div className="flex items-stretch">
              {([
                ['quran', 'Text & Voice', BookOpen],
                ['timings', 'Timing', Clock],
                ['style', 'Setting', Sliders]
              ] as const).map(([id, label, Icon], i) => {
                const active = sidebarTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setSidebarTab(id)}
                    aria-current={active ? 'step' : undefined}
                    className={`group relative flex-1 flex items-center justify-center gap-2 py-3 px-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold focus-visible:ring-inset ${
                      active ? 'text-parchment' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className={`ayah-marker ${active ? 'ayah-marker-active' : ''}`}>{i + 1}</span>
                    <span className="flex items-center gap-1.5">
                      <Icon className={`w-3.5 h-3.5 ${active ? 'text-gold' : 'opacity-60'}`} />
                      <span className="text-[11px] font-semibold tracking-wide">{label}</span>
                    </span>
                    {/* Gold rule marks the current step, the way a manuscript
                        rules the line it is working on. */}
                    <span
                      className={`absolute inset-x-0 bottom-0 h-px transition-opacity ${
                        active ? 'bg-gold opacity-100' : 'opacity-0'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Sidebar Content Area */}
          <div className="flex-1 overflow-y-auto p-4">
            {isSampleProject && (
              <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5 text-[11px] text-amber-200 flex items-start gap-2">
                <BookOpen className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  <span className="font-semibold">This is a sample.</span> The timeline is
                  pre-filled with Al-Fatihah so the preview isn&apos;t blank. Load a surah or
                  upload a recitation to replace it.
                </span>
              </div>
            )}
            {/* TAB 1: Quran & Audio Selection */}
            {sidebarTab === 'quran' && (
              <div className="flex flex-col gap-4 text-xs">
                {/* Workflow instructions.

                    Collapsible, and open only while the timeline is still the
                    seeded sample -- i.e. on a genuine first run. It took about
                    40% of the panel on every visit, pushing the controls it
                    describes below the fold for someone who had already read it. */}
                <details
                  open={isSampleProject}
                  className="group p-3 rounded-xl bg-gradient-to-r from-amber-500/10 via-amber-600/5 to-emerald-500/10 border border-amber-500/20"
                >
                  <summary className="font-semibold text-amber-400 text-xs uppercase tracking-wider cursor-pointer list-none flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded">
                    <span>How it works</span>
                    <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
                  </summary>
                  <ol className="list-decimal list-inside text-slate-300 space-y-1 text-[11px] leading-relaxed mt-1.5">
                    <li><strong>Select a reciter</strong> below (e.g. Sudais, Raad Al-Kurdi).</li>
                    <li><strong>Choose a surah and ayah range</strong> (start &amp; end).</li>
                    <li>Click <strong>&quot;Load ayahs &amp; audio&quot;</strong> to fetch the verses and audio.</li>
                    <li>Switch to the <strong>Timing</strong> step above.</li>
                    <li>Press <strong>Play</strong> and tap <kbd className="px-1 py-0.5 bg-slate-800 text-amber-300 rounded text-[11px] font-mono">SPACEBAR</kbd> at the end of each ayah to mark its boundary.</li>
                    <li>Adjust timings with the sliders, then style and export.</li>
                  </ol>
                  <p className="text-[11px] text-slate-400 mt-2">Note: built-in reciter timings are estimates. Use the Timing step for accurate alignment. Auto-matching only works on <strong>uploaded</strong> files.</p>
                </details>

                {/* Surah Selector */}
                <div>
                  <label htmlFor="surah-select" className="font-semibold text-slate-200 block mb-1.5">Select Surah:</label>
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
                        {s.number}. {s.nameEnglish} ({s.nameArabic}) - {s.numberOfAyahs} Ayahs
                      </option>
                    ))}
                  </select>
                </div>

                {/* Ayah Range */}
                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950/80 rounded-xl border border-slate-800">
                  <div>
                    <label htmlFor="ayah-start" className="text-slate-400 block mb-1">Start Ayah:</label>
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
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100 font-mono font-bold"
                    />
                  </div>

                  <div>
                    <label htmlFor="ayah-end" className="text-slate-400 block mb-1">End Ayah:</label>
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
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100 font-mono font-bold"
                    />
                  </div>
                </div>

                {/* Reciter Selector */}
                <div>
                  <label id="reciter-label" className="font-semibold text-slate-200 block mb-1.5">Select Reciter / Voice:</label>
                  <div role="radiogroup" aria-labelledby="reciter-label" className="grid grid-cols-1 gap-2">
                    {RECITERS.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setSelectedReciter(r.id)}
                        className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all ${
                          selectedReciter === r.id
                            ? 'bg-amber-500/15 border-amber-500 text-slate-100 ring-1 ring-amber-500/40'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div>
                          <span className="font-bold block text-slate-200">{r.name}</span>
                          <span className="text-[11px] text-amber-400 font-amiri block" dir="rtl">{r.arabicName}</span>
                        </div>
                        <span className="text-[11px] font-mono text-slate-300 bg-slate-900 px-2 py-0.5 rounded">
                          {r.style}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Upload Custom Audio */}
                <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800">
                  <label htmlFor="recitation-upload" className="font-semibold text-slate-200 block mb-1 flex items-center gap-1.5">
                    <Music className="w-3.5 h-3.5 text-amber-400" />
                    <span>Upload Recitation — Audio or Video:</span>
                  </label>
                  <p className="text-[11px] text-slate-400 mb-2">
                    Audio (MP3 / WAV / M4A / OGG) or video (MP4 / MOV / WebM / MKV). For a video, the audio track is used for matching and the footage becomes the background. AI auto-matching supports files up to ~18 MB (roughly 15–20 minutes of MP3); compress or split longer recordings.
                  </p>

                  {/* AI Matcher Provider */}
                  <div className="mb-3">
                    <label id="matcher-label" className="text-[11px] font-semibold text-slate-400 block mb-1.5">AI Matcher:</label>
                    <div role="radiogroup" aria-labelledby="matcher-label" className="grid grid-cols-2 gap-2">
                      {matchOptions.map(opt => {
                        const selected = matchProvider === opt.id;
                        return (
                          <button
                            key={opt.id}
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setMatchProvider(opt.id)}
                            title={`Uses ${opt.technical}`}
                            className={`py-2 px-2.5 rounded-lg border text-left flex items-center gap-1.5 transition-all ${
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
                        Passage detection is switched off on your helper, so it will time the surah and range selected above instead of finding them in the audio. Unset <code className="font-mono">ASR_ALIGN_BACKEND</code> and restart it to turn detection back on.
                      </p>
                    )}
                    {matchProvider === 'align' && providerStatus?.align.alignReady === false && (
                      <div className="text-[11px] text-red-300 mt-1.5 rounded-md bg-red-500/10 border border-red-500/25 p-2 space-y-1">
                        <p className="font-semibold">The helper is running but could not load its alignment engine, so matching will fail.</p>
                        <p>This is almost always the service being started by the wrong Python. Restart it from its virtualenv:</p>
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
                      <span className="text-xs font-semibold">{customAudioName || 'Choose Audio or Video File'}</span>
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
                        Use this video as the background
                        <span className="block text-[11px] text-slate-300">
                          Its frames follow the audio, so the recitation stays in sync{videoBgOffset > 0 ? ` (offset ${formatDuration(videoBgOffset)} after trimming)` : ''}.
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
                        <span>Trim audio{customAudioDuration > 0 ? ` (${formatDuration(customAudioDuration)})` : ''}</span>
                      </button>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={handleAutoMatchUploadedAudio}
                          className="py-2 px-3 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>AI Auto-match</span>
                        </button>
                        <button
                          onClick={handleManualMatchUploadedAudio}
                          className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          <span>Manual Match</span>
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Trim before matching to crop dead air first, or after to cut the AI-matched timeline down — either way the segment times adjust to the new clip automatically.
                      </p>
                    </div>
                  )}

                  {matchStatus && (
                    <div className={`mt-2 text-[11px] rounded-lg p-3 flex items-start gap-2.5 ${
                      isMatching
                        ? 'bg-blue-500/10 border border-blue-500/30'
                        : matchStatus.includes('fail') || matchStatus.includes('not configured')
                        ? 'bg-red-500/10 border border-red-500/20 text-red-300'
                        : matchStatus.includes('complete')
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/10 border border-amber-500/20 text-amber-300'
                    }`}>
                      {isMatching && (
                        <span className="shrink-0 mt-0.5">
                          <span className="flex h-4 w-4 items-center justify-center">
                            <span className="animate-spin h-3.5 w-3.5 border-2 border-blue-400 border-t-transparent rounded-full"></span>
                          </span>
                        </span>
                      )}
                      {!isMatching && matchStatus.includes('complete') && (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      )}
                      <span className="flex-1">{matchStatus}</span>
                    </div>
                  )}
                </div>

                {/* Load & Fetch Button */}
                <button
                  onClick={handleLoadSurahVerses}
                  disabled={isLoadingVerses}
                  className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  {isLoadingVerses ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
                  <span>{isLoadingVerses ? 'Loading ayahs…' : 'Load ayahs & audio'}</span>
                </button>

                {loadResult && (
                  <div
                    role="status"
                    className={`mt-2 rounded-lg border p-2.5 text-[11px] ${
                      loadResult.ok
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                        : 'bg-red-500/10 border-red-500/30 text-red-200'
                    }`}
                  >
                    <span className="font-semibold">{loadResult.message}</span>
                    {loadResult.ok && (
                      <button
                        onClick={() => setSidebarTab('timings')}
                        className="ml-1.5 underline underline-offset-2 hover:text-emerald-100"
                      >
                        Go to Timing
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Steps 2 and 3 used to render their full interface with nothing
                loaded -- offering to mark ayah boundaries that did not exist and
                to style a video with no verses in it. Numbering promises a
                sequence, so the sequence has to hold. */}
            {sidebarTab === 'timings' && (
              verses.length === 0 ? (
                <EmptyStep
                  icon={<Clock className="w-6 h-6" />}
                  title="No ayahs to time yet"
                  body="Timing lines up each ayah with the recitation, so there has to be a recitation first. Load a surah and its audio, then come back."
                  actionLabel="Go to Text & Voice"
                  onAction={() => setSidebarTab('quran')}
                />
              ) : (
                <TimelineSyncEditor
                  verses={verses}
                  onChangeVerses={setVerses}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  audioDuration={audioDuration}
                  onSeek={handleSeek}
                  onPlayPauseToggle={togglePlayPause}
                />
              )
            )}

            {sidebarTab === 'style' && (
              verses.length === 0 ? (
                <EmptyStep
                  icon={<Sliders className="w-6 h-6" />}
                  title="Nothing to style yet"
                  body="These controls change how the ayahs look on screen. Load a surah first and the preview will show your changes as you make them."
                  actionLabel="Go to Text & Voice"
                  onAction={() => setSidebarTab('quran')}
                />
              ) : (
                <StyleConfigPanel
                  config={canvasConfig}
                  onChangeConfig={setCanvasConfig}
                />
              )
            )}
          </div>
        </aside>

        {/* Right Main Studio Preview Area */}
        <main
          className={`flex-1 flex-col items-center justify-between p-4 bg-slate-950 relative overflow-hidden ${
            mobileSurface === 'preview' ? 'flex' : 'hidden'
          } md:flex`}
        >
          {/* Main Video Canvas WYSIWYG Renderer */}
          <div className="flex-1 w-full flex items-center justify-center relative">
            {/* Click-to-play is scoped to the video itself, not the whole
                preview area, so clicking the surrounding background doesn't
                toggle playback. */}
            {/* The preview sits inside a jadwal -- the ruled frame a mushaf
                draws around its text block -- because that is exactly what the
                preview is. Chrome only; it is not in the exported video. */}
            <div className="jadwal relative cursor-pointer" onClick={togglePlayPause} title={isPlaying ? 'Pause' : 'Play'}>
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
              <p className="text-[11px] text-slate-400 mt-1">
                Try switching reciters, or upload a custom audio file.
              </p>
              <button
                onClick={() => setAudioError(null)}
                className="mt-1.5 text-[11px] text-amber-400 hover:text-amber-300 underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Interactive Player Scrubber Bar (Bottom) */}
          <div className="w-full max-w-2xl bg-slate-900/90 backdrop-blur-md p-3 rounded-2xl border border-slate-800 shadow-2xl flex flex-col gap-2 mt-2 z-20">
            {/* Timeline Progress Slider */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-slate-400 w-10 text-right">
                {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')}
              </span>

              <input
                type="range"
                min={0}
                max={audioDuration || 100}
                step={0.1}
                value={currentTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                aria-label="Seek through the recitation"
                className="flex-1 accent-amber-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
              />

              <span className="text-xs font-mono text-slate-400 w-10">
                {Math.floor(audioDuration / 60)}:{Math.floor(audioDuration % 60).toString().padStart(2, '0')}
              </span>
            </div>

            {/* Scrubber Controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={togglePlayPause}
                  aria-label={isPlaying ? 'Pause recitation' : 'Play recitation'}
                  title={isPlaying ? 'Pause' : 'Play'}
                  className="p-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-full font-bold shadow-md transition-transform active:scale-95"
                >
                  {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                </button>

                <button
                  onClick={() => handleSeek(0)}
                  className="p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
                  title="Reset to beginning"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>

              {/* Volume Slider */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const newMute = !isMuted;
                    setIsMuted(newMute);
                    if (audioElementRef.current) {
                      audioElementRef.current.muted = newMute;
                    }
                  }}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  title={isMuted ? 'Unmute' : 'Mute'}
                  className="p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
                </button>

                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setVolume(val);
                    setIsMuted(false);
                    if (audioElementRef.current) {
                      audioElementRef.current.volume = val;
                      audioElementRef.current.muted = false;
                    }
                  }}
                  aria-label="Volume"
                  className="w-20 accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Mobile surface switch.

          Sits at the bottom because that is where a thumb rests, and it names
          the two things a phone can usefully show one at a time. Hidden from
          `md` up, where both surfaces are visible at once and the switch would
          mean nothing. */}
      <nav
        aria-label="Switch view"
        className="md:hidden shrink-0 border-t border-slate-800 bg-slate-900/95 backdrop-blur-md p-1.5 flex gap-1.5 z-30"
      >
        {([
          ['panel', 'Edit', Sliders],
          ['preview', 'Preview', Film]
        ] as const).map(([id, label, Icon]) => {
          const active = mobileSurface === id;
          return (
            <button
              key={id}
              onClick={() => setMobileSurface(id)}
              aria-pressed={active}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
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
        surahNameEnglish={surahNameEnglish}
        surahNumber={selectedSurah}
        ayahStart={ayahStart}
        ayahEnd={ayahEnd}
        aspectRatio={canvasConfig.aspectRatio}
        onSaveExportRecord={handleSaveExportRecord}
      />

      {/* Saved Projects Drawer */}
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
          audioUrl={customAudioUrl}
          onCancel={() => setShowTrimModal(false)}
          onApply={handleApplyTrim}
        />
      )}
    </div>
  );
}
