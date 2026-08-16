'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { 
  VideoCanvas, 
  VideoCanvasConfig, 
  VideoCanvasRef 
} from '@/components/VideoCanvas';
import { TimelineSyncEditor } from '@/components/TimelineSyncEditor';
import { StyleConfigPanel } from '@/components/StyleConfigPanel';
import { GpuExportModal } from '@/components/GpuExportModal';
import { SavedProjectsDrawer } from '@/components/SavedProjectsDrawer';
import { 
  SURAHS_LIST, 
  RECITERS, 
  SAMPLE_PROJECTS, 
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
  Server
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
  const [matchStatus, setMatchStatus] = useState<string | null>(null);
  const [isMatching, setIsMatching] = useState<boolean>(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [matchProvider, setMatchProvider] = useState<'gemini' | 'asr' | 'align' | 'hybrid'>('align');
  const [providerStatus, setProviderStatus] = useState<{
    gemini: { configured: boolean };
    asr: { configured: boolean; serviceUrl: string };
    align: { configured: boolean; serviceUrl: string; canAutoDetectRange?: boolean };
    hybrid: { configured: boolean; serviceUrl: string };
  } | null>(null);

  // Loaded Surah / Verse Data
  const [surahNameArabic, setSurahNameArabic] = useState<string>('الفاتحة');
  const [surahNameEnglish, setSurahNameEnglish] = useState<string>('Al-Fatihah');
  const [audioUrl, setAudioUrl] = useState<string>('https://server11.mp3quran.net/download/sds/001.mp3');
  const [verses, setVerses] = useState<VerseData[]>(SAMPLE_PROJECTS[0].verses);

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

  // UI Tabs & Drawer
  const [sidebarTab, setSidebarTab] = useState<'quran' | 'timings' | 'style'>('quran');
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isProjectsDrawerOpen, setIsProjectsDrawerOpen] = useState<boolean>(false);

  // Video Export & Progress State
  const canvasRef = useRef<VideoCanvasRef | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportSpeed, setExportSpeed] = useState<string>('1.0x');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

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
    accentColor: '#fbbf24',
    translationColor: '#e2e8f0',
    textShadow: true,
    showTransliteration: false,
    showTranslation: true,
    showWaveform: true,
    showSurahBadge: true,
    surahBadgeText: '',
    surahBadgeSubtitleText: '',
    bgType: 'video',
    bgUrl: 'https://videos.pexels.com/video-files/18953366/18953366-hd_1080_1920_30fps.mp4',
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
    try {
      const res = await fetch(`/api/quran/verses?surah=${selectedSurah}&start=${ayahStart}&end=${ayahEnd}&reciter=${selectedReciter}`);
      if (res.ok) {
        const data = await res.json();
        setSurahNameArabic(data.surahNameArabic || 'الفاتحة');
        setSurahNameEnglish(data.surahNameEnglish || 'Al-Fatihah');
        if (!customAudioUrl) {
          setAudioUrl(data.audioUrl);
        }
        setVerses(data.verses || []);
      }
    } catch {
      // Fallback
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

  // Handle Custom Audio MP3 File Upload
  const handleCustomAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setCustomAudioUrl(url);
      setCustomAudioName(file.name);
      setCustomAudioFile(file);
      setCustomAudioBuffer(await file.arrayBuffer());
      setMatchStatus('Audio uploaded. Choose AI Auto-match to detect and sync ayahs, or Manual Match to time segments yourself.');
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
    setSaveStatus('Saving...');
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
        setSaveStatus('Project Saved!');
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        const data = await res.json().catch(() => null);
        setSaveStatus(data?.error ? 'Save Failed' : 'Save Failed');
        setTimeout(() => setSaveStatus(null), 3000);
      }
    } catch {
      setSaveStatus('Save Failed');
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

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
          gpuDevice: 'NVIDIA GeForce RTX 5080 (WebGPU Acceleration)'
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
      accentColor: proj.accentColor || '#fbbf24',
      translationColor: proj.translationColor || '#e2e8f0',
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

      {/* Top Navbar */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md px-4 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400 group-hover:scale-105 transition-transform border border-amber-500/30">
              <Video className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-slate-100 text-sm tracking-tight block leading-tight">
                Quran Clip Helper <span className="text-amber-400 font-mono text-xs">Studio</span>
              </span>
              <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                <Cpu className="w-3 h-3 inline animate-pulse" /> RTX 5080 GPU Active
              </span>
            </div>
          </Link>

          <div className="hidden md:flex items-center gap-2 ml-4 pl-4 border-l border-slate-800 text-xs text-slate-400 font-medium">
            <span>Project:</span>
            <span className="text-slate-200 font-semibold">{surahNameEnglish} ({selectedSurah}:{ayahStart}-{ayahEnd})</span>
          </div>
        </div>

        {/* Action Controls Header */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsProjectsDrawerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Saved Clips</span>
          </button>

          <button
            onClick={handleSaveProject}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700"
          >
            {saveStatus ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Save className="w-3.5 h-3.5 text-amber-400" />}
            <span>{saveStatus || 'Save Project'}</span>
          </button>

          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-amber-500 via-amber-600 to-emerald-500 hover:from-amber-600 hover:to-emerald-600 text-slate-950 font-bold text-xs rounded-lg shadow-md transition-all active:scale-95"
          >
            <Sparkles className="w-4 h-4 fill-current" />
            <span>Export 60 FPS GPU Video</span>
          </button>
        </div>
      </header>

      {/* Main Studio Workspace Split Screen */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Left Control Sidebar */}
        <aside className="w-full md:w-[420px] border-r border-slate-800 bg-slate-900/60 backdrop-blur-sm flex flex-col h-1/2 md:h-full shrink-0 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="flex items-center border-b border-slate-800 bg-slate-950/80 p-1.5">
            <button
              onClick={() => setSidebarTab('quran')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-lg transition-all ${
                sidebarTab === 'quran' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>1. Quran & Reciter</span>
            </button>

            <button
              onClick={() => setSidebarTab('timings')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-lg transition-all ${
                sidebarTab === 'timings' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>2. Tap-To-Sync</span>
            </button>

            <button
              onClick={() => setSidebarTab('style')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-lg transition-all ${
                sidebarTab === 'style' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>3. Styling & FX</span>
            </button>
          </div>

          {/* Sidebar Content Area */}
          <div className="flex-1 overflow-y-auto p-4">
            {/* TAB 1: Quran & Audio Selection */}
            {sidebarTab === 'quran' && (
              <div className="flex flex-col gap-4 text-xs">
                {/* Workflow instructions */}
                <div className="p-3 rounded-xl bg-gradient-to-r from-amber-500/10 via-amber-600/5 to-emerald-500/10 border border-amber-500/20">
                  <h4 className="font-semibold text-amber-400 text-xs uppercase tracking-wider mb-1.5">How it works</h4>
                  <ol className="list-decimal list-inside text-slate-300 space-y-1 text-[11px] leading-relaxed">
                    <li><strong>Select a reciter</strong> below (e.g. Sudais, Raad Al-Kurdi).</li>
                    <li><strong>Choose a surah and ayah range</strong> (start &amp; end).</li>
                    <li>Click <strong>&quot;Load Ayahs &amp; Audio Data&quot;</strong> to fetch the verses and audio.</li>
                    <li>Switch to the <strong>Tap-To-Sync</strong> tab above.</li>
                    <li>Press <strong>Play</strong> and tap <kbd className="px-1 py-0.5 bg-slate-800 text-amber-300 rounded text-[10px] font-mono">SPACEBAR</kbd> at the end of each ayah to mark its boundary.</li>
                    <li>Adjust timings with the sliders, then style and export.</li>
                  </ol>
                  <p className="text-[10px] text-slate-400 mt-2">Note: Built-in reciter timings are estimates. Use Tap-To-Sync for accurate alignment. AI auto-matching is only for <strong>uploaded</strong> custom audio files.</p>
                </div>

                {/* Surah Selector */}
                <div>
                  <label className="font-semibold text-slate-200 block mb-1.5">Select Surah:</label>
                  <select
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
                    <label className="text-slate-400 block mb-1">Start Ayah:</label>
                    <input
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
                    <label className="text-slate-400 block mb-1">End Ayah:</label>
                    <input
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
                  <label className="font-semibold text-slate-200 block mb-1.5">Select Reciter / Voice:</label>
                  <div className="grid grid-cols-1 gap-2">
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
                        <span className="text-[10px] font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded">
                          {r.style}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Upload Custom Audio */}
                <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800">
                  <label className="font-semibold text-slate-200 block mb-1 flex items-center gap-1.5">
                    <Music className="w-3.5 h-3.5 text-amber-400" />
                    <span>Upload Custom Quran Recitation (MP3 / WAV / M4A):</span>
                  </label>
                  <p className="text-[11px] text-slate-400 mb-2">
                    Upload your own Quran recitation audio. AI auto-matching supports files up to ~18 MB (roughly 15–20 minutes of MP3). For longer recordings, compress the audio first or split into smaller segments.
                  </p>

                  {/* AI Matcher Provider */}
                  <div className="mb-3">
                    <label className="text-[11px] font-semibold text-slate-400 block mb-1.5">AI Matcher:</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setMatchProvider('align')}
                        className={`py-2 px-2.5 rounded-lg border text-left flex items-center gap-1.5 transition-all ${
                          matchProvider === 'align'
                            ? 'bg-amber-500/15 border-amber-500 text-slate-100 ring-1 ring-amber-500/40'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <Server className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[11px] font-bold truncate">Forced Align</span>
                          <span className={`block text-[10px] ${providerStatus?.align.configured ? 'text-emerald-400' : 'text-slate-500'}`}>
                            {providerStatus ? (providerStatus.align.configured ? 'Sidecar online' : 'Sidecar unreachable') : 'Checking…'}
                          </span>
                        </span>
                      </button>
                      <button
                        onClick={() => setMatchProvider('hybrid')}
                        className={`py-2 px-2.5 rounded-lg border text-left flex items-center gap-1.5 transition-all ${
                          matchProvider === 'hybrid'
                            ? 'bg-amber-500/15 border-amber-500 text-slate-100 ring-1 ring-amber-500/40'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <Sparkles className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[11px] font-bold truncate">Gemini + Align</span>
                          <span className={`block text-[10px] ${providerStatus?.hybrid.configured ? 'text-emerald-400' : 'text-slate-500'}`}>
                            {providerStatus
                              ? providerStatus.hybrid.configured
                                ? 'Key + sidecar ready'
                                : providerStatus.gemini.configured
                                  ? 'Sidecar unreachable'
                                  : 'Needs API key'
                              : 'Checking…'}
                          </span>
                        </span>
                      </button>
                      <button
                        onClick={() => setMatchProvider('gemini')}
                        className={`py-2 px-2.5 rounded-lg border text-left flex items-center gap-1.5 transition-all ${
                          matchProvider === 'gemini'
                            ? 'bg-amber-500/15 border-amber-500 text-slate-100 ring-1 ring-amber-500/40'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <Sparkles className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[11px] font-bold truncate">Gemini (cloud)</span>
                          <span className={`block text-[10px] ${providerStatus?.gemini.configured ? 'text-emerald-400' : 'text-slate-500'}`}>
                            {providerStatus ? (providerStatus.gemini.configured ? 'Configured' : 'Not configured') : 'Checking…'}
                          </span>
                        </span>
                      </button>
                      <button
                        onClick={() => setMatchProvider('asr')}
                        className={`py-2 px-2.5 rounded-lg border text-left flex items-center gap-1.5 transition-all ${
                          matchProvider === 'asr'
                            ? 'bg-amber-500/15 border-amber-500 text-slate-100 ring-1 ring-amber-500/40'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <Server className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[11px] font-bold truncate">Local ASR</span>
                          <span className={`block text-[10px] ${providerStatus?.asr.configured ? 'text-emerald-400' : 'text-slate-500'}`}>
                            {providerStatus ? (providerStatus.asr.configured ? 'Sidecar online' : 'Sidecar unreachable') : 'Checking…'}
                          </span>
                        </span>
                      </button>
                    </div>
                    {matchProvider === 'align' && (
                      <p className="text-[10px] text-slate-500 mt-1.5">
                        {providerStatus && providerStatus.align.configured && !providerStatus.align.canAutoDetectRange
                          ? 'Times each word against the real Quran text — so no word can be dropped or misheard, and repeated phrases get their own segments. This sidecar can’t work out the range from audio, so set the surah and range below to match your recording first.'
                          : 'Detects the surah and ayah range from the audio itself, then times each word against the real Quran text — so no word can be dropped or misheard, and repeated phrases get their own segments. The surah and range selected below aren’t used.'}
                      </p>
                    )}
                    {matchProvider === 'hybrid' && (
                      <p className="text-[10px] text-slate-500 mt-1.5">
                        Gemini identifies which ayahs were recited — what it&apos;s genuinely good at — then the local aligner times each word against the real Quran text. Audio is sent to Google. If Gemini can&apos;t identify the passage, the surah and range selected below are used instead.
                      </p>
                    )}
                    {matchProvider === 'gemini' && (
                      <p className="text-[10px] text-slate-500 mt-1.5">
                        Gemini both identifies and times the recitation in one pass. Zero setup, but timings are estimates rather than measurements — for accurate timing use Gemini + Align, which keeps the identification and fixes the timing.
                      </p>
                    )}
                    {matchProvider === 'asr' && (
                      <p className="text-[10px] text-slate-500 mt-1.5">
                        Local ASR detects the surah/ayah itself from the audio — the surah and range selected below aren&apos;t used to restrict matching.
                      </p>
                    )}
                  </div>
                  
                  <div className="relative flex items-center justify-center p-3 border-2 border-dashed border-slate-700 hover:border-amber-500/50 rounded-lg cursor-pointer bg-slate-900/60 transition-colors">
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={handleCustomAudioUpload}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <div className="flex items-center gap-2 text-slate-300">
                      <Upload className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-semibold">{customAudioName || 'Choose Audio File'}</span>
                    </div>
                  </div>

                  {(customAudioFile || customAudioUrl) && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
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
                  <BookOpen className="w-4 h-4" />
                  <span>{isLoadingVerses ? 'Fetching Verses...' : 'Load Ayahs & Audio Data'}</span>
                </button>
              </div>
            )}

            {/* TAB 2: Timings & Tap-To-Sync */}
            {sidebarTab === 'timings' && (
              <TimelineSyncEditor
                verses={verses}
                onChangeVerses={setVerses}
                currentTime={currentTime}
                isPlaying={isPlaying}
                audioDuration={audioDuration}
                onSeek={handleSeek}
                onPlayPauseToggle={togglePlayPause}
              />
            )}

            {/* TAB 3: Visual Styling & FX */}
            {sidebarTab === 'style' && (
              <StyleConfigPanel
                config={canvasConfig}
                onChangeConfig={setCanvasConfig}
              />
            )}
          </div>
        </aside>

        {/* Right Main Studio Preview Area */}
        <main className="flex-1 flex flex-col items-center justify-between p-4 bg-slate-950 relative overflow-hidden">
          {/* Main Video Canvas WYSIWYG Renderer */}
          <div className="flex-1 w-full flex items-center justify-center relative">
            {/* Click-to-play is scoped to the video itself, not the whole
                preview area, so clicking the surrounding background doesn't
                toggle playback. */}
            <div className="relative cursor-pointer" onClick={togglePlayPause} title={isPlaying ? 'Pause' : 'Play'}>
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
              />
            </div>
          </div>

          {/* Audio Error Banner */}
          {audioError && (
            <div className="w-full max-w-2xl bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-2 text-center z-20">
              <p className="text-xs text-red-400 font-medium">{audioError}</p>
              <p className="text-[10px] text-slate-400 mt-1">
                Try switching reciters, or upload a custom audio file.
              </p>
              <button
                onClick={() => setAudioError(null)}
                className="mt-1.5 text-[10px] text-amber-400 hover:text-amber-300 underline"
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
                  className="text-slate-400 hover:text-slate-100"
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
                  className="w-20 accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          </div>
        </main>
      </div>

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
    </div>
  );
}
