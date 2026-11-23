'use client';

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { 
  VideoCanvasConfig 
} from './VideoCanvas';
import {
  backgroundLabel, appendSegment, removeSegment, mediaKind, rememberMediaKind, MediaKind,
  BackgroundSegment
} from '@/lib/backgroundTimeline';
import { formatClipLength } from '@/lib/mediaDuration';
import { useMediaDurations } from '@/hooks/useMediaDurations';
import { ColorField } from './ColorField';
import { ConfirmDialog } from './ConfirmDialog';
import { useT } from './LocaleProvider';
import { useFileDrop } from '@/hooks/useFileDrop';
import { AYAH_MARKER_STYLES, AYAH_NUMBER_PLACEMENTS, markerStyleOf, placementOf } from '@/lib/ayahMarker';
import {
  subscribeToLibrary, librarySnapshot, serverLibrarySnapshot, hydrateLibrary,
  addLibraryUpload, addLibraryLink, removeLibraryItem
} from '@/lib/backgroundLibrary';
import { 
  BACKGROUND_VIDEOS, 
  FONTS_ARABIC, 
  usableArabicFont,
  FONT_ARABIC_BUILTIN
} from '@/lib/quranData';
import { useStudioConfig } from '@/hooks/useStudioConfig';
import { 
  Image as ImageIcon, 
  Upload, 
  Check,
  ExternalLink,
  X,
  Trash2,
  Film,
  FileQuestion,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Layers, SlidersHorizontal, ArrowDownUp, Plus, RefreshCw
} from 'lucide-react';
import { PresetGallery } from './PresetGallery';
import { StyleSection } from './StyleSection';
import { PanelHead } from './PanelHead';
import { GroupNav, PanelGroup } from './PanelGroup';
import { ChoiceRow, CompactRow, SliderRow, SwitchRow } from './CompactRow';
import { CompactBar } from './CompactBar';
import { applyStylePreset, matchingPreset } from '@/lib/stylePresets';
import { FRAME_LAYOUTS, asFrameLayout } from '@/lib/frameLayout';
import { GALLERY_SORTS, DEFAULT_GALLERY_SORT, sortGallery, type GallerySort } from '@/lib/gallerySort';
import { CAPTION_TRANSITIONS, WORD_EFFECTS, MOTION_SPEEDS, asCaptionTransition, asWordEffect, asMotionSpeed, asHighlightColour } from '@/lib/captionMotion';
import { PRESETS as COLOUR_PRESETS } from './ColorField';
import { BADGE_STYLES, SURAH_NAME_FONT_ID, usableBadgeStyle, DEFAULT_BADGE_OPACITY } from '@/lib/surahBadge';

interface StyleConfigPanelProps {
  config: VideoCanvasConfig;
  onChangeConfig: (newConfig: VideoCanvasConfig) => void;
  /** Length of the clip, so a background added here lands somewhere real on the lane. */
  clipDuration?: number;
  /**
   * Where the backgrounds currently sit in time, whichever mode produced them.
   *
   * Only needed to *enter* the hand-cut lane: switching to it bakes whatever is
   * on screen into blocks, so choosing it changes nothing about the video and
   * everything about whether it can be moved.
   */
  laneBlocks?: BackgroundSegment[];
  /** The block picked on the timeline, so both surfaces act on the same one. */
  selectedBackground?: number | null;
  onSelectBackground?: (index: number | null) => void;
  /** Show only this part of the look, as the rail opens it; every part, collapsible, without. */
  only?: StyleArea | null;
  /** Swaps the background for another about as long as the clip, from Pexels or the built-ins. */
  onAnotherBackground?: () => void;
  findingBackground?: boolean;
}

/** The parts of the look, each of which the rail can open on its own. */
export type StyleArea = 'presets' | 'text' | 'background' | 'card' | 'branding';

const WATERMARK_POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const;
type WatermarkPosition = typeof WATERMARK_POSITIONS[number];

/** The Text panel's groups, in the order they are laid out. */
const TEXT_GROUPS = ['font', 'size', 'ayah', 'motion', 'colours'] as const;

export const StyleConfigPanel: React.FC<StyleConfigPanelProps> = ({
  config,
  onChangeConfig,
  clipDuration = 0,
  laneBlocks = [],
  selectedBackground = null,
  onSelectBackground,
  only = null,
  onAnotherBackground,
  findingBackground = false
}) => {
  const t = useT();
  const { missingFonts } = useStudioConfig();
  /** One name per clip, shared by the lane list, the sequence list and every tooltip. */
  const nameOf = (url: string) => backgroundLabel(url, t.backgrounds);
  /**
   * Which sections are open. Collapsible rather than tabs: a closed section
   * still says what it is set to, so the whole look reads at a glance, and
   * finishing with one part does not hide the others behind a tab.
   */
  const [openSections, setOpenSections] = useState<string[]>(['text']);
  // The one setting opened in place (`CompactRow`); pressing another closes it.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const row = (id: string) => ({ open: openRow === id, onToggle: () => setOpenRow(at => (at === id ? null : id)) });
  const toggleSection = (id: string) =>
    setOpenSections(current => (current.includes(id) ? current.filter(s => s !== id) : [...current, id]));
  const isOpen = (id: StyleArea) => (only ? only === id : openSections.includes(id));
  const shows = (id: StyleArea) => !only || only === id;
  /** The background's settings as laid out in full, which the chip bar stands in for once scrolled away. */
  const bgSettingsRef = useRef<HTMLDivElement | null>(null);

  const updateConfig = (key: keyof VideoCanvasConfig, value: unknown) => {
    onChangeConfig({
      ...config,
      [key]: value
    });
  };

  /** Backgrounds the user added, shown after the presets. */
  const library = useSyncExternalStore(subscribeToLibrary, librarySnapshot, serverLibrarySnapshot);
  const [pendingDelete, setPendingDelete] = useState<
    { title: string; message: string; confirmLabel?: string; run: () => void } | null
  >(null);
  /**
   * Links that turned out not to load. An upload announces itself missing by
   * having no url at all; a link only finds out when something tries to draw
   * it, so the thumbnail reports it here and the tile becomes a placeholder
   * like any other.
   */
  const [brokenUrls, setBrokenUrls] = useState<string[]>([]);
  /** Reported under the upload box. `urlStatus` belongs to the paste field, several cards away. */
  const [uploadStatus, setUploadStatus] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);
  const markBroken = (url: string) =>
    setBrokenUrls(prev => (prev.includes(url) ? prev : [...prev, url]));

  // Reading the stored files is asynchronous, so the list arrives after the
  // first paint rather than during it. The store notifies; nothing is copied
  // into component state.
  useEffect(() => { hydrateLibrary(); }, []);


  // A lane cut by hand on the timeline. It is not something you switch to from
  // here -- it is what dragging a block turns the layout into -- so it has no
  // button of its own; picking any automatic mode is how you leave it.
  const customBackground = config.bgMode === 'custom';
  const laneSegments = config.bgSegments || [];
  const multiBackground = !customBackground && (config.bgMode || 'single') !== 'single';
  const bgSequence = config.bgUrls || [];

  const setLane = (next: typeof laneSegments) =>
    onChangeConfig({ ...config, bgType: kindOf(next[0]?.url), bgSegments: next });

  /**
   * `bgType` for a list is the kind of whatever leads it.
   *
   * These setters used to hardcode `'video'`, which silently undid an image
   * selection the moment anything else in the panel was touched. It only really
   * matters for the single-background case now -- the playlist reads each url's
   * own kind -- but leaving a stale value in the saved payload would mislead
   * whoever reads it next.
   */
  function kindOf(url: string | undefined): string {
    return url ? mediaKind(url) : config.bgType;
  }

  /**
   * Rewrites the background sequence.
   *
   * Everything here works on *position*, never on url: the sequence is allowed
   * to repeat a clip -- "this one at the start and again at the end" -- and a
   * url-keyed remove would take out the wrong occurrence. `bgUrl` keeps
   * pointing at something real because it is still the single-mode value, the
   * saved-project field and the fallback when the list is emptied.
   */
  const setSequence = (next: string[]) => {
    onChangeConfig({
      ...config,
      bgType: kindOf(next[0] || config.bgUrl),
      bgUrls: next,
      bgUrl: next[0] || config.bgUrl
    });
  };

  /**
   * Puts a background wherever the current mode actually reads from.
   *
   * Uploading a file and pasting a link both used to write `bgUrl` and nothing
   * else. In every mode but `single` that field is not what plays: the sequence
   * reads `bgUrls` and a hand-cut lane reads `bgSegments`, so with "shuffle" or
   * "one per ayah" selected -- exactly when someone is gathering several
   * backgrounds -- adding one appeared to do nothing at all.
   */
  const addBackground = (url: string, kind: MediaKind) => {
    rememberMediaKind(url, kind);
    if (customBackground) {
      setLane(appendSegment(laneSegments, url, clipDuration));
      return;
    }
    if (multiBackground) {
      setSequence([...bgSequence, url]);
      return;
    }
    onChangeConfig({ ...config, bgType: kind, bgUrl: url });
  };

  /**
   * Takes however many background files it is given.
   *
   * One at a time was the only way in, which for the thing this is for --
   * gathering a set of clips to cut between -- meant repeating the whole
   * picker dance per file. They are stored in sequence rather than in
   * parallel: each is an IndexedDB write of a whole video, and starting six
   * at once is how a quota failure becomes six quota failures.
   *
   * A file that will not persist still gets added to the session, so the
   * status counts the two outcomes separately rather than calling a usable
   * background a failure.
   */
  const addBackgroundFiles = async (files: File[]) => {
    if (!files.length) return;
    const stored: string[] = [];
    const unstored: string[] = [];
    for (const file of files) {
      const kind: MediaKind = file.type.startsWith('image') ? 'image' : 'video';
      const result = await addLibraryUpload(file, kind);
      if (result.item.url) addBackground(result.item.url, kind);
      (result.stored ? stored : unstored).push(file.name);
    }

    if (unstored.length === 0) {
      setUploadStatus({
        kind: 'ok',
        message: stored.length === 1
          ? t.style.uploadAdded(stored[0])
          : t.style.uploadAddedMany(stored.length)
      });
      return;
    }
    setUploadStatus({
      kind: 'error',
      message: unstored.length === 1 && stored.length === 0
        ? t.style.uploadNotStored(unstored[0])
        : t.style.uploadSomeNotStored(unstored.length, stored.length)
    });
  };

  const handleCustomFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Let the same file be picked again after it has been removed from the list.
    e.target.value = '';
    await addBackgroundFiles(files);
  };

  const backgroundDrop = useFileDrop(
    addBackgroundFiles,
    file => file.type.startsWith('video') || file.type.startsWith('image')
  );

  /**
   * The presets and the user's own backgrounds, in one grid.
   *
   * They behave identically once added -- the only difference is that a preset
   * cannot be deleted, because it is not the user's to lose.
   */
  const gallery = [
    ...BACKGROUND_VIDEOS.map(bg => ({
      id: bg.id,
      libraryId: null as string | null,
      url: bg.url as string | null,
      title: t.backgrounds.titles[bg.id as keyof typeof t.backgrounds.titles] ?? bg.title,
      category: t.backgrounds.categories[bg.category as keyof typeof t.backgrounds.categories] ?? bg.category,
      thumbnail: bg.thumbnail as string | null,
      kind: 'video' as MediaKind,
      removable: false,
      missing: false
    })),
    ...library.map(item => {
      const missing = !item.url || brokenUrls.includes(item.url);
      return {
        id: `library-${item.id}`,
        libraryId: item.id,
        url: item.url,
        title: item.label,
        category: missing ? t.backgrounds.categories.Missing : t.backgrounds.categories.Yours,
        thumbnail: !missing && item.kind === 'image' ? item.url : null,
        kind: item.kind,
        removable: true,
        missing
      };
    })
  ];

  /**
   * How long each clip in the gallery runs.
   *
   * Measured only while this tab is open, and only for footage: a still has no
   * length, and probing ten preset urls for a tab nobody opened is ten requests
   * for nothing. A length that cannot be read is simply not shown.
   */
  const clipLengths = useMediaDurations(
    gallery.filter(bg => bg.url && !bg.missing && bg.kind === 'video').map(bg => bg.url as string),
    isOpen('background')
  );
  const [gallerySort, setGallerySort] = useState<GallerySort>(DEFAULT_GALLERY_SORT);
  const sortedGallery = sortGallery(gallery, gallerySort, clipLengths);

  /** What each closed section is set to, in a few words. */
  const presetId = matchingPreset(config);
  const presetSummary = presetId ? t.presets.items[presetId as keyof typeof t.presets.items]?.name ?? presetId : '';
  const fontName = (id: string) => t.style.fonts[id as keyof typeof t.style.fonts] ?? FONTS_ARABIC.find(f => f.id === id)?.name ?? id;
  const textSummary = `${FONTS_ARABIC.find(f => f.id === config.fontArabic)?.name ?? config.fontArabic} · ${config.arabicFontSize}px`;
  const badge = config.showSurahBadge ? t.style.badgeStyles[(config.badgeStyle ?? 'pill') as keyof typeof t.style.badgeStyles] : t.style.badgeStyles.none;
  const cardSummary = `${t.style.layouts[asFrameLayout(config.layout)]} · ${badge}`;
  const backgroundSummary = config.bgMode && config.bgMode !== 'single'
    ? t.style.bgModes[config.bgMode as keyof typeof t.style.bgModes]
    : gallery.find(bg => bg.url === config.bgUrl)?.title ?? '';
  const transition = asCaptionTransition(config.captionTransition);
  const wordEffect = asWordEffect(config.wordEffect);
  const brandingSummary = config.watermarkText ? `“${config.watermarkText}”` : '—';

  /**
   * Deletes a background the user added, and every use of it.
   *
   * Leaving it in the sequence or the lane after removing it from the list
   * would keep it in the exported video while showing nowhere in the panel --
   * the deletion has to mean what it says.
   */
  const removeFromEverywhere = (libraryId: string, url: string | null) => {
    removeLibraryItem(libraryId);
    if (!url) return;
    const nextUrls = bgSequence.filter(u => u !== url);
    const nextSegments = laneSegments.filter(seg => seg.url !== url);
    const fallback = nextUrls[0] || nextSegments[0]?.url || BACKGROUND_VIDEOS[0]?.url || '';
    const nextUrl = config.bgUrl === url ? fallback : config.bgUrl;
    onChangeConfig({
      ...config,
      bgUrl: nextUrl,
      bgType: kindOf(nextUrl),
      bgUrls: nextUrls,
      bgSegments: nextSegments
    });
  };

  /**
   * The sequence entry being dragged, and the one it is hovering over.
   *
   * The arrows reorder one position at a time, which is fine for a swap and
   * tedious for anything else -- moving the fifth clip to the front was four
   * clicks. Dragging says where it goes in one gesture. The arrows stay: they
   * are what works from a keyboard and on a touch screen, where HTML drag and
   * drop does not.
   */
  const [seqDragFrom, setSeqDragFrom] = useState<number | null>(null);
  const [seqDragOver, setSeqDragOver] = useState<number | null>(null);
  const [laneDragFrom, setLaneDragFrom] = useState<number | null>(null);
  const [laneDragOver, setLaneDragOver] = useState<number | null>(null);

  /**
   * Reorders the clips in the hand-cut lane, leaving the cuts alone.
   *
   * The urls move between the blocks; the blocks keep their times. That is the
   * only reading that makes sense here, because in this lane the order *is* the
   * times -- permuting `{start, end}` instead would move where the background
   * changes, which is what dragging a block on the timeline is for. This
   * answers the other question: the cuts are right, the clips are in the wrong
   * slots.
   */
  const moveInLane = (from: number, to: number) => {
    if (from === to || to < 0 || to >= laneSegments.length) return;
    const urls = laneSegments.map(seg => seg.url);
    const [moved] = urls.splice(from, 1);
    urls.splice(to, 0, moved);
    setLane(laneSegments.map((seg, i) => ({ ...seg, url: urls[i] })));
    onSelectBackground?.(to);
  };

  const moveInSequence = (from: number, to: number) => {
    if (to < 0 || to >= bgSequence.length) return;
    const next = [...bgSequence];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setSequence(next);
  };

  const [urlDraft, setUrlDraft] = useState('');
  const [urlStatus, setUrlStatus] = useState<{ kind: 'busy' | 'error' | 'ok'; message: string } | null>(null);

  /**
   * What a link points at, when the path does not say.
   *
   * Plenty of CDNs serve stills from extensionless urls, and guessing "video"
   * for one of those puts a <video> element on an image and draws nothing. An
   * `Image()` that loads is proof; one that fails is not proof of much, but
   * video is the right thing to assume for a background.
   */
  const probeKind = (url: string): Promise<MediaKind> =>
    new Promise(resolve => {
      const probe = new Image();
      const settle = (kind: MediaKind) => { probe.onload = null; probe.onerror = null; resolve(kind); };
      probe.onload = () => settle('image');
      probe.onerror = () => settle('video');
      probe.src = url;
      setTimeout(() => settle('video'), 6000);
    });

  const applyDirectUrl = async (url: string, label?: string) => {
    const extension = /\.(mp4|webm|mov|avi|m4v|ogv)(\?|#|$)/i.test(url)
      ? 'video'
      : /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?|#|$)/i.test(url)
        ? 'image'
        : null;
    const kind: MediaKind = extension ?? (await probeKind(url));
    addLibraryLink(url, kind, label || backgroundLabel(url));
    addBackground(url, kind);
  };

  /**
   * Accepts either a direct file link or a Pexels page link.
   *
   * What people actually copy from Pexels is the address bar, and that is a
   * web page -- pasting it here used to set the background to an HTML document
   * and quietly show nothing. `/api/background/resolve` turns one into the
   * file link it stands for.
   */
  const handleApplyUrl = async (raw: string) => {
    const url = raw.trim();
    if (!url) return;

    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      setUrlStatus({ kind: 'error', message: t.style.urlNotALink });
      return;
    }

    const isPexelsPage = /(^|\.)pexels\.com$/.test(host) && !/^videos?\.|^images\./.test(host);
    if (!isPexelsPage) {
      setUrlStatus({ kind: 'busy', message: t.style.urlChecking });
      await applyDirectUrl(url);
      setUrlStatus({ kind: 'ok', message: t.style.urlAdded });
      setUrlDraft('');
      return;
    }

    setUrlStatus({ kind: 'busy', message: t.style.urlLookingUp });
    try {
      const res = await fetch(`/api/background/resolve?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok || !data?.url) {
        setUrlStatus({ kind: 'error', message: data?.error || t.style.urlPexelsFailed });
        return;
      }
      await applyDirectUrl(data.url, data.credit ? `${data.credit} (Pexels)` : undefined);
      setUrlStatus({
        kind: 'ok',
        message: data.credit ? t.style.urlAddedWithCredit(data.credit) : t.style.urlAdded
      });
      setUrlDraft('');
    } catch {
      setUrlStatus({ kind: 'error', message: t.style.urlResolverUnreachable });
    }
  };

  /*
   * The background's settings, each built once and shown in two places: laid
   * out in full at the top of the section, and in the bar of chips that holds
   * them in reach while the gallery below is scrolled (`CompactBar`).
   */
  const bgModeBox = (
    <>
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <label className="font-semibold text-slate-200 text-sm block mb-2">{t.style.bgModeLabel}</label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                ['single', t.style.bgModes.single, t.style.bgModeHints.single],
                ['per-ayah', t.style.bgModes['per-ayah'], t.style.bgModeHints['per-ayah']],
                ['cycle', t.style.bgModes.cycle, t.style.bgModeHints.cycle],
                ['shuffle', t.style.bgModes.shuffle, t.style.bgModeHints.shuffle]
              ] as const).map(([mode, label, hint]) => (
                <button
                  key={mode}
                  title={hint}
                  onClick={() => {
                    onSelectBackground?.(null);
                    onChangeConfig({ ...config, bgMode: mode, bgSegments: [] });
                  }}
                  className={`px-2 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    !customBackground && (config.bgMode || 'single') === mode
                      ? 'bg-amber-500 text-slate-950 border-amber-500'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* The hand-cut lane, as a choice rather than a side effect.

                It used to have no button: it was what dragging a block on the
                timeline turned the layout into, and nothing else. That made the
                one arrangement with no rules -- any number of clips, each for
                as long as you like -- the only one you could not ask for, and
                left "I want several backgrounds" answerable only by the four
                automatic modes. Choosing it here bakes whatever is on screen
                into blocks, so the video does not change; what changes is that
                the blocks can now be moved. */}
            <button
              onClick={() => {
                onSelectBackground?.(null);
                onChangeConfig({ ...config, bgMode: 'custom', bgSegments: laneBlocks });
              }}
              title={t.style.bgModeHints.custom}
              className={`mt-1.5 w-full px-2 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                customBackground
                  ? 'bg-lapis-bright text-slate-950 border-lapis-bright'
                  : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'
              }`}
            >
              {t.style.bgModes.custom}
            </button>

            {!customBackground && (config.bgMode || 'single') === 'cycle' && (
              <div className="mt-3">
                <div className="flex justify-between text-slate-300 mb-1 text-xs">
                  <span>{t.style.secondsPerBackground}</span>
                  <span className="font-mono text-amber-400">{config.bgCycleSeconds || 5}s</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={30}
                  value={config.bgCycleSeconds || 5}
                  onChange={(e) => updateConfig('bgCycleSeconds', parseInt(e.target.value, 10))}
                  className="w-full accent-amber-500"
                />
              </div>
            )}

            {customBackground && (
              <div className="mt-3">
                <p className="text-xs text-slate-300 bg-lapis-bright/10 border border-lapis-bright/30 rounded-lg p-2">
                  {t.style.laneSummary(laneSegments.length)} {t.style.laneHelp}
                </p>
                {laneSegments.length > 0 && (
                  <ol className="flex flex-col gap-1 mt-2">
                    {laneSegments.map((seg, i) => (
                      <li
                        key={`${seg.url}-${i}`}
                        draggable
                        onPointerDown={() => onSelectBackground?.(i)}
                        onDragStart={e => {
                          setLaneDragFrom(i);
                          e.dataTransfer.effectAllowed = 'move';
                          // Firefox starts no drag at all without a payload.
                          e.dataTransfer.setData('text/plain', String(i));
                        }}
                        onDragEnter={() => setLaneDragOver(i)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault();
                          if (laneDragFrom !== null) moveInLane(laneDragFrom, i);
                          setLaneDragFrom(null);
                          setLaneDragOver(null);
                        }}
                        onDragEnd={() => { setLaneDragFrom(null); setLaneDragOver(null); }}
                        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 border cursor-pointer ${
                          laneDragFrom === i
                            ? 'bg-slate-950 border-slate-800 opacity-40'
                            : laneDragOver === i && laneDragFrom !== null
                              ? 'bg-slate-950 border-amber-500 ring-1 ring-amber-500/60'
                              : selectedBackground === i
                                ? 'bg-lapis-bright/20 border-lapis-bright/60'
                                : 'bg-slate-950 border-slate-800'
                        }`}
                      >
                        <GripVertical
                          aria-hidden="true"
                          className="w-3.5 h-3.5 shrink-0 text-slate-500 cursor-grab active:cursor-grabbing"
                        />
                        <span className="w-4 shrink-0 text-xs font-mono text-amber-400">{i + 1}</span>
                        <span className="flex-1 min-w-0 truncate text-xs text-slate-200">{nameOf(seg.url)}</span>
                        <span className="shrink-0 text-[11px] font-mono text-slate-400 tabular-nums" dir="ltr">
                          {seg.start.toFixed(1)}–{seg.end.toFixed(1)}s
                        </span>
                        {/* No confirmation, for the reason taking a clip out of
                            the sequence has none: nothing is lost. The clip is
                            still in the gallery above, the lane lives in the
                            styling config that the undo history snapshots, and
                            Ctrl+Z puts the block back where it was. A dialog
                            here was a second click on every adjustment. */}
                        <button
                          onClick={() => {
                            setLane(removeSegment(laneSegments, i));
                            onSelectBackground?.(
                              selectedBackground === null || selectedBackground === i
                                ? null
                                : selectedBackground > i
                                  ? selectedBackground - 1
                                  : selectedBackground
                            );
                          }}
                          aria-label={t.style.removeBlockAria(nameOf(seg.url), seg.start.toFixed(1))}
                          className="p-0.5 text-slate-400 hover:text-red-400"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {multiBackground && (
              bgSequence.length === 0 ? (
                <p className="text-xs text-slate-400 mt-2">{t.style.sequenceEmpty}</p>
              ) : (
                <div className="mt-3">
                  <p className="text-xs text-slate-400 mb-1.5">
                    {t.style.sequenceCount(bgSequence.length)} {t.style.sequenceReorder}
                  </p>
                  <ol className="flex flex-col gap-1">
                    {bgSequence.map((url, i) => (
                      <li
                        key={`${url}-${i}`}
                        draggable
                        onDragStart={e => {
                          setSeqDragFrom(i);
                          e.dataTransfer.effectAllowed = 'move';
                          // Firefox starts no drag at all without a payload.
                          e.dataTransfer.setData('text/plain', String(i));
                        }}
                        onDragEnter={() => setSeqDragOver(i)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault();
                          if (seqDragFrom !== null) moveInSequence(seqDragFrom, i);
                          setSeqDragFrom(null);
                          setSeqDragOver(null);
                        }}
                        onDragEnd={() => { setSeqDragFrom(null); setSeqDragOver(null); }}
                        className={`flex items-center gap-1.5 bg-slate-950 border rounded-lg px-2 py-1.5 ${
                          seqDragFrom === i
                            ? 'border-slate-800 opacity-40'
                            : seqDragOver === i && seqDragFrom !== null
                              ? 'border-amber-500 ring-1 ring-amber-500/60'
                              : 'border-slate-800'
                        }`}
                      >
                        <GripVertical
                          aria-hidden="true"
                          className="w-3.5 h-3.5 shrink-0 text-slate-500 cursor-grab active:cursor-grabbing"
                        />
                        <span className="w-4 shrink-0 text-xs font-mono text-amber-400">{i + 1}</span>
                        <span className="flex-1 min-w-0 truncate text-xs text-slate-200">{nameOf(url)}</span>
                        <button
                          onClick={() => moveInSequence(i, i - 1)}
                          disabled={i === 0}
                          aria-label={t.style.moveEarlier(nameOf(url))}
                          className="p-0.5 text-slate-400 hover:text-slate-100 disabled:opacity-30"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => moveInSequence(i, i + 1)}
                          disabled={i === bgSequence.length - 1}
                          aria-label={t.style.moveLater(nameOf(url))}
                          className="p-0.5 text-slate-400 hover:text-slate-100 disabled:opacity-30"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                        {/* No confirmation here, unlike deleting a background
                            from the library below. Taking a clip out of the
                            sequence loses nothing -- it is still in the gallery,
                            one tap from being added back -- and Ctrl+Z puts the
                            sequence back as it was. A dialog for that is a
                            second click on every reorder. */}
                        <button
                          onClick={() => setSequence(bgSequence.filter((_, j) => j !== i))}
                          aria-label={t.style.removeFromSequenceAria(nameOf(url), i + 1)}
                          className="p-0.5 text-slate-400 hover:text-red-400"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )
            )}
          </div>
    </>
  );
  const bgSortSelect = (
    <>
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                {t.style.gallerySortLabel}
                <select
                  value={gallerySort}
                  onChange={e => setGallerySort(e.target.value as GallerySort)}
                  className="rounded-md border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs text-slate-200"
                >
                  {GALLERY_SORTS.map(id => <option key={id} value={id}>{t.style.gallerySorts[id]}</option>)}
                </select>
              </label>
    </>
  );
  const bgLookBox = (
    <>
          {/* Overlay Sliders */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>{t.style.overlayOpacity}</span>
                <span className="font-mono text-amber-400">{config.bgOverlayOpacity}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={90}
                value={config.bgOverlayOpacity}
                onChange={(e) => updateConfig('bgOverlayOpacity', parseInt(e.target.value, 10))}
                className="w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>{t.style.backgroundBlur}</span>
                <span className="font-mono text-amber-400">{config.bgBlur}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={15}
                value={config.bgBlur}
                onChange={(e) => updateConfig('bgBlur', parseInt(e.target.value, 10))}
                className="w-full accent-amber-500"
              />
            </div>
          </div>
    </>
  );
  const bgAddBox = (
          <div className="flex flex-col gap-3">
          {/* Paste a link -- file or Pexels page */}
          <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800">
            <p className="font-semibold text-slate-200 block mb-1.5">{t.style.pasteLinkLabel}</p>
            <div className="flex gap-2">
              <input
                aria-label={t.style.pasteLinkLabel}
                type="text"
                value={urlDraft}
                onChange={e => { setUrlDraft(e.target.value); setUrlStatus(null); }}
                placeholder={t.style.pasteLinkPlaceholder}
                dir="ltr"
                className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 text-start"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleApplyUrl(urlDraft);
                }}
              />
              <button
                onClick={() => handleApplyUrl(urlDraft)}
                disabled={urlStatus?.kind === 'busy'}
                className="px-3 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 font-semibold rounded-lg text-xs transition-colors shrink-0"
              >
                {t.common.apply}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1.5">{t.style.pasteLinkHelp}</p>
            {urlStatus && (
              <p
                role="status"
                className={`text-xs mt-1.5 rounded-md p-2 border ${
                  urlStatus.kind === 'error'
                    ? 'text-red-300 bg-red-500/10 border-red-500/25'
                    : urlStatus.kind === 'ok'
                      ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
                      : 'text-slate-300 bg-slate-800/60 border-slate-700'
                }`}
              >
                {urlStatus.message}
              </p>
            )}
          </div>

          {/* Custom Upload */}
          <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800">
            <label className="font-semibold text-slate-200 block mb-1.5">{t.style.uploadLabel}</label>
            <div
              {...backgroundDrop.dropHandlers}
              className={`relative flex items-center justify-center p-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                backgroundDrop.isOver
                  ? 'border-amber-400 bg-amber-500/10'
                  : 'border-slate-700 hover:border-amber-500/50 bg-slate-950/50'
              }`}
            >
              <input
                type="file"
                accept="video/*,image/*"
                multiple
                onChange={handleCustomFileUpload}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <div className="flex items-center gap-2 text-slate-400 hover:text-amber-300">
                <Upload className="w-4 h-4" />
                <span className="text-xs font-medium">
                  {backgroundDrop.isOver ? t.style.uploadDropHere : t.style.uploadBrowse}
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-1.5">{t.style.uploadHelp}</p>
            {uploadStatus && (
              <p
                role="status"
                className={`text-xs mt-1.5 rounded-md p-2 border ${
                  uploadStatus.kind === 'error'
                    ? 'text-red-300 bg-red-500/10 border-red-500/25'
                    : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
                }`}
              >
                {uploadStatus.message}
              </p>
            )}
          </div>
          </div>
  );
  const bgModeName = customBackground ? t.style.bgModes.custom : t.style.bgModes[(config.bgMode || 'single') as keyof typeof t.style.bgModes];

  return (
    // `p-3` matches the Inspector tab beside it. Without it this panel's cards,
    // sliders and section headings all sat flush against the column border,
    // because the container in page.tsx only scrolls -- it does not pad.
    <div className={`flex flex-col text-[13px] ${only ? '' : 'gap-4 p-3'}`}>
      {/* Whole looks first: the quickest way to a finished frame, and the
          fields they set are all edited in the sections below. */}
      {shows('presets') && (only ? (
        <section id="style-section-presets">
          <PanelHead title={t.presets.heading} summary={presetSummary} />
          <div className="p-4"><PresetGallery full current={presetId} onApply={preset => onChangeConfig(applyStylePreset(config, preset))} /></div>
        </section>
      ) : (
        <PresetGallery
          current={matchingPreset(config)}
          onApply={preset => onChangeConfig(applyStylePreset(config, preset))}
        />
      ))}


      {shows('text') && (
      <StyleSection id="text" title={t.style.tabDesign} summary={textSummary} open={isOpen('text')} onToggle={() => toggleSection('text')} bare={!!only}>
        {/* Motion used to be a section of its own; it is how the text moves,
            so it is a group of the text, above its colours. */}
        {only && <GroupNav items={TEXT_GROUPS.map(id => ({ id, label: t.style.textGroups[id] }))} />}
        <div className="flex flex-col gap-5">
        <PanelGroup id="font" title={t.style.textGroups.font}>
          <div className="flex flex-col">
          <CompactRow label={t.style.arabicFontLabel} value={fontName(usableArabicFont(config.fontArabic, missingFonts))} {...row('font')}>
            <div className="grid grid-cols-2 gap-2">
              {FONTS_ARABIC.map((f) => (
                <button
                  key={f.id}
                  onClick={() => updateConfig('fontArabic', f.id)}
                  // A face whose files are not on this server cannot be drawn,
                  // so it cannot be chosen either -- see usableArabicFont.
                  disabled={missingFonts.has(f.id)}
                  title={missingFonts.has(f.id) ? t.style.fontNotInstalled : undefined}
                  className={`p-2.5 rounded-xl border text-start transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    usableArabicFont(config.fontArabic, missingFonts) === f.id
                      ? 'bg-amber-500/15 border-amber-500 text-amber-300 ring-1 ring-amber-500/40'
                      : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <span className="block font-bold text-sm text-slate-100">
                    {fontName(f.id)}
                  </span>
                  {/* Each face previews itself. Hardcoding one family here
                      showed five identical samples -- and kept every other
                      family out of the DOM, so the canvas never fetched the
                      one it was about to draw with. */}
                  <span className={`block text-lg ${f.className} text-amber-400 mt-1`} dir="rtl">
                    بِسْمِ ٱللَّهِ
                  </span>
                </button>
              ))}
            </div>
            {missingFonts.size > 0 && (
              <p className="text-xs text-slate-400">{t.style.fontNotInstalled}</p>
            )}
          </CompactRow>
          {/* The chosen face is missing and none is selected above: say what
              is drawing instead, in that face. */}
          {usableArabicFont(config.fontArabic, missingFonts) === FONT_ARABIC_BUILTIN && (
            <p className="px-2 text-xs text-amber-300/90">
              {t.style.fontFallback} <span className="font-amiri text-sm" dir="rtl">بِسْمِ ٱللَّهِ</span>
            </p>
          )}
          {/* Only the mushaf face knows where the printed lines break. */}
          {FONTS_ARABIC.find(f => f.id === usableArabicFont(config.fontArabic, missingFonts))?.mushaf && (
            <SwitchRow label={t.style.mushafLines} hint={t.style.mushafLinesHint} checked={!!config.mushafLines} onChange={on => updateConfig('mushafLines', on)} />
          )}
          </div>
        </PanelGroup>
        <PanelGroup id="size" title={t.style.textGroups.size}>
          <div className="flex flex-col">
            <SliderRow label={t.style.arabicFontSize} value={config.arabicFontSize} min={24} max={64} unit="px" onChange={v => updateConfig('arabicFontSize', v)} />
            <SliderRow label={t.style.translationFontSize} value={config.translationFontSize} min={14} max={48} unit="px" onChange={v => updateConfig('translationFontSize', v)} />
          </div>
        </PanelGroup>
        <PanelGroup id="ayah" title={t.style.textGroups.ayah}>
          <div className="flex flex-col">
            <ChoiceRow label={t.style.ayahNumberPlacement} {...row('placement')}
              options={AYAH_NUMBER_PLACEMENTS.map(id => ({ id, label: t.style.ayahNumberPlacements[id] }))}
              chosen={placementOf(config.ayahNumberPlacement)} onChoose={id => updateConfig('ayahNumberPlacement', id)} />
            {placementOf(config.ayahNumberPlacement) === 'end' && (
              <ChoiceRow label={t.style.ayahMarkerStyle} {...row('ending')}
                options={AYAH_MARKER_STYLES.map(id => ({ id, label: t.style.ayahMarkerStyles[id] }))}
                chosen={markerStyleOf(config.ayahMarkerStyle)} onChoose={id => updateConfig('ayahMarkerStyle', id)}>
                {markerStyleOf(config.ayahMarkerStyle) === 'page' && <p className="px-2 text-xs text-slate-400 leading-relaxed">{t.style.ayahMarkerPageHint}</p>}
              </ChoiceRow>
            )}
            {/* Between the cards it is the label's size; at the ayah's end it scales the marker against the Arabic. */}
            <SliderRow label={t.style.ayahNumberSize} value={config.ayahNumberFontSize} min={20} max={72} unit="px" onChange={v => updateConfig('ayahNumberFontSize', v)} />
            <SwitchRow label={t.style.showRepeatMark} hint={t.style.showRepeatMarkHint} checked={config.showRepeatMark !== false} onChange={on => updateConfig('showRepeatMark', on)} />
          </div>
        </PanelGroup>
        <PanelGroup id="motion" title={t.style.textGroups.motion}>
          <div className="flex flex-col">
            {/* How quickly it moves belongs to the move, so it opens with it. */}
            <ChoiceRow label={t.style.transitionLabel} {...row('transition')}
              options={CAPTION_TRANSITIONS.map(id => ({ id, label: t.style.transitions[id] }))}
              chosen={transition} onChoose={id => updateConfig('captionTransition', id)} />
            {transition !== 'cut' && (
              <ChoiceRow label={t.style.motionSpeedLabel} hint={t.style.transitionHelp} {...row('speed')}
                options={MOTION_SPEEDS.map(id => ({ id, label: t.style.motionSpeeds[id] }))}
                chosen={asMotionSpeed(config.motionSpeed)} onChoose={id => updateConfig('motionSpeed', id)} />
            )}
            <ChoiceRow label={t.style.wordEffectLabel} hint={t.style.wordEffectHelp} {...row('words')}
              options={WORD_EFFECTS.map(id => ({ id, label: t.style.wordEffects[id] }))}
              chosen={wordEffect} onChoose={id => updateConfig('wordEffect', id)} />
            {/* The highlight's colour is a setting of its own once there is one. */}
            {wordEffect === 'highlight' && (
              <CompactRow label={t.style.highlightColourLabel} value={asHighlightColour(config.highlightColor) || t.style.highlightAccent}
                swatch={asHighlightColour(config.highlightColor) || config.accentColor || '#b8c7dc'} {...row('highlight')}>
                <HighlightSwatches config={config} onChange={hex => updateConfig('highlightColor', hex)} />
              </CompactRow>
            )}
          </div>
        </PanelGroup>
        <PanelGroup id="colours" title={t.style.textGroups.colours}>
          {/* Colours.

              Three native `<input type="color">` used to sit here; on a
              multi-monitor setup the OS opened its dialog on another screen
              entirely. `ColorField` keeps the picker in the panel.

              "Accent Gold" was also the wrong name twice over: it is not
              necessarily gold, and it was never clear what it painted. It is
              named for its job now, and the card border -- which was hardcoded
              amber and stayed gold no matter what this was set to -- follows
              it like everything else in the list. */}
          <div className="flex flex-col">
            <ColorField compact {...row('colourArabic')}
              label={t.style.colourArabic}
              description={t.style.colourArabicDescription}
              value={config.textColor}
              onChange={hex => updateConfig('textColor', hex)}
            />
            <ColorField compact {...row('colourAccent')}
              label={t.style.colourAccent}
              description={t.style.colourAccentDescription}
              value={config.accentColor}
              onChange={hex => updateConfig('accentColor', hex)}
            />
            <ColorField compact {...row('colourTranslation')}
              label={t.style.colourTranslation}
              description={t.style.colourTranslationDescription}
              value={config.translationColor}
              onChange={hex => updateConfig('translationColor', hex)}
            />
          </div>
        </PanelGroup>
        </div>
      </StyleSection>
      )}

      {shows('background') && (
      <StyleSection id="background" title={t.style.tabBackground} summary={backgroundSummary} open={isOpen('background')} onToggle={() => toggleSection('background')} bare={!!only}>
        <div className="flex flex-col gap-4">
          {only && (
            <CompactBar
              watch={bgSettingsRef}
              items={[
                { id: 'mode', icon: Layers, label: t.style.bgModeLabel, value: bgModeName, panel: bgModeBox },
                { id: 'look', icon: SlidersHorizontal, label: t.style.bgBar.look, value: t.style.bgBar.lookValue(config.bgOverlayOpacity, config.bgBlur), panel: bgLookBox },
                { id: 'sort', icon: ArrowDownUp, label: `${t.style.gallerySortLabel} ${t.style.gallerySorts[gallerySort]}`, panel: bgSortSelect },
                { id: 'add', icon: Plus, label: t.style.bgBar.add, panel: bgAddBox }
              ]}
            />
          )}
          <div ref={bgSettingsRef} className="flex flex-col gap-4">
            {bgModeBox}
            {bgLookBox}
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="font-semibold text-slate-200 text-sm">
                {customBackground
                  ? t.style.galleryLabelLane
                  : (config.bgMode || 'single') === 'single'
                    ? t.style.galleryLabelSingle
                    : t.style.galleryLabelMulti}
              </span>
              {onAnotherBackground && !customBackground && !multiBackground && (
                <button type="button" onClick={onAnotherBackground} disabled={findingBackground} title={t.style.anotherBackgroundTitle}
                  className="ms-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-700 text-xs font-semibold text-slate-200 hover:border-amber-500/60 hover:text-amber-300 disabled:opacity-50 transition-colors">
                  <RefreshCw className={`w-3.5 h-3.5 ${findingBackground ? 'animate-spin' : ''}`} />
                  {t.style.anotherBackground}
                </button>
              )}
              {bgSortSelect}
            </div>
            <p className="text-xs text-slate-400 mb-2">{t.style.galleryHelp}</p>
            {/* No inner scroller. Capping this at 224px put a second scrollbar
                inside a panel that was already scrolling, and showed four
                thumbnails above a screen of empty space. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {sortedGallery.map((bg) => {
                const inUse = !bg.url ? false : customBackground
                  ? laneSegments.some(seg => seg.url === bg.url)
                  : multiBackground ? bgSequence.includes(bg.url) : config.bgUrl === bg.url;
                const clipLength = bg.url ? clipLengths[bg.url] : undefined;
                return (
                  <div key={bg.id} className="relative group rounded-xl overflow-hidden">
                    <button
                      disabled={bg.missing}
                      title={
                        bg.missing
                          ? t.style.tileMissing
                          : customBackground ? t.style.tileAddToLane
                          : multiBackground ? t.style.tileAddToSequence
                          : bg.title
                      }
                      onClick={() => { if (bg.url) addBackground(bg.url, bg.kind); }}
                      className={`block w-full rounded-xl overflow-hidden border transition-all aspect-[9/16] ${
                        bg.missing
                          ? 'border-dashed border-slate-700 bg-slate-950 cursor-not-allowed'
                          : inUse
                            ? 'border-amber-500 ring-2 ring-amber-500/50 shadow-lg'
                            : 'border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      {/* Play order, so a multi-background sequence is readable at a glance. */}
                      {multiBackground && bg.url && bgSequence.includes(bg.url) && (
                        <span className="absolute top-1 start-1 z-10 min-w-5 h-5 px-1 rounded-full bg-amber-500 text-slate-950 text-xs font-bold flex items-center justify-center shadow">
                          {(() => {
                            const uses = bgSequence.filter(u => u === bg.url).length;
                            return uses > 1 ? `x${uses}` : bgSequence.indexOf(bg.url) + 1;
                          })()}
                        </span>
                      )}
                      {bg.missing ? (
                        // Kept rather than dropped: the entry records a choice
                        // the user made, and only they can say whether to find
                        // the file again or let it go.
                        <span className="w-full h-full flex flex-col items-center justify-center gap-1 text-center px-2">
                          <FileQuestion className="w-5 h-5 text-slate-500" />
                          <span className="text-[9px] text-slate-400 leading-tight">{t.style.tileNotFound}</span>
                        </span>
                      ) : bg.thumbnail ? (
                        <img
                          src={bg.thumbnail}
                          alt={bg.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={() => { if (bg.libraryId && bg.url) markBroken(bg.url); }}
                        />
                      ) : (
                        // A clip the user added has no thumbnail to fetch, so it
                        // previews itself -- muted, unplayed, one poster frame.
                        <video
                          src={`${bg.url}#t=0.1`}
                          muted
                          playsInline
                          preload="metadata"
                          className="w-full h-full object-cover bg-slate-950"
                          onError={() => { if (bg.libraryId && bg.url) markBroken(bg.url); }}
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent flex flex-col justify-end p-2 text-start">
                        <span className="text-xs font-semibold text-slate-100 leading-tight line-clamp-2">{bg.title}</span>
                        <span className={`text-[9px] uppercase tracking-wider flex items-center gap-1 ${
                          bg.missing ? 'text-slate-400' : 'text-amber-400'
                        }`}>
                          {bg.missing
                            ? <FileQuestion className="w-2.5 h-2.5" />
                            : bg.kind === 'image' ? <ImageIcon className="w-2.5 h-2.5" /> : <Film className="w-2.5 h-2.5" />}
                          {bg.category}
                          {/* How long the footage is, which is what decides
                              whether a block on the lane will repeat. */}
                          {clipLength ? (
                            <span
                              dir="ltr"
                              title={t.style.tileLength(formatClipLength(clipLength))}
                              className="font-mono normal-case tracking-normal text-slate-300"
                            >
                              · {formatClipLength(clipLength)}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      {!multiBackground && !customBackground && config.bgUrl === bg.url && (
                        <div className="absolute top-2 end-2 bg-amber-500 text-slate-950 p-1 rounded-full shadow">
                          <Check className="w-3 h-3" />
                        </div>
                      )}
                    </button>

                    {/* Outside the tile button rather than inside it: a button
                        nested in a button is invalid, and the browser picks
                        whichever it likes when you click. */}
                    {bg.removable && (
                      <button
                        onClick={() =>
                          setPendingDelete({
                            title: t.style.removeBackgroundTitle,
                            message: bg.missing
                              ? t.style.removeBackgroundMissingMessage(bg.title)
                              : t.style.removeBackgroundMessage(bg.title, inUse),
                            run: () => { if (bg.libraryId) removeFromEverywhere(bg.libraryId, bg.url); }
                          })
                        }
                        title={t.style.removeBackgroundTooltip}
                        aria-label={t.style.removeBackgroundAria(bg.title)}
                        className={`absolute top-1 end-1 z-10 p-1 rounded-full bg-slate-950/80 text-slate-300 hover:text-red-300 hover:bg-slate-950 border border-slate-700 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 ${
                          bg.missing ? 'opacity-100' : 'opacity-0'
                        }`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="text-center mt-2">
              <a
                href="https://www.pexels.com/search/videos/mosque%20night/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors font-medium"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{t.style.browsePexels}</span>
              </a>
              <p className="text-xs text-slate-400 mt-1">{t.style.browsePexelsHelp}</p>
            </div>
          </div>
          {bgAddBox}
        </div>
      </StyleSection>
      )}

      {shows('card') && (
      <StyleSection id="card" title={t.style.tabCard} summary={cardSummary} open={isOpen('card')} onToggle={() => toggleSection('card')} bare={!!only}>
      {/* Card & FX */}
        <div className="flex flex-col gap-5">
          {/* Where things sit, then how the badge looks: the two choices
              that change the frame's arrangement rather than its colours. */}
          <div className="flex flex-col">
            <ChoiceRow label={t.style.layoutLabel} {...row('layout')}
              options={FRAME_LAYOUTS.map(id => ({ id, label: t.style.layouts[id] }))}
              chosen={asFrameLayout(config.layout)} onChoose={id => updateConfig('layout', id)} />
            {/* "None" is the badge switch, not a style: hiding the badge
                keeps the style it had for when it comes back. */}
            <ChoiceRow label={t.style.badgeStyleLabel} {...row('badge')}
              options={[
                { id: 'none', label: t.style.badgeStyles.none },
                ...BADGE_STYLES.map(id => ({ id: id as string, label: t.style.badgeStyles[id], disabled: id === 'calligraphic' && missingFonts.has(SURAH_NAME_FONT_ID) })),
              ]}
              chosen={config.showSurahBadge ? usableBadgeStyle(config.badgeStyle, missingFonts) : 'none'}
              onChoose={id => onChangeConfig(id === 'none'
                ? { ...config, showSurahBadge: false }
                : { ...config, showSurahBadge: true, badgeStyle: id })}>
              {missingFonts.has(SURAH_NAME_FONT_ID) && <p className="px-2 text-xs text-slate-400">{t.style.badgeFontMissing}</p>}
            </ChoiceRow>
            {/* Its own control, not the card's: a no-card layout sets the card
                to nothing, and the badge still has to read over the footage. */}
            {config.showSurahBadge && (
              <SliderRow label={t.style.badgeOpacity} value={config.badgeOpacity ?? DEFAULT_BADGE_OPACITY} min={0} max={100} unit="%" onChange={v => updateConfig('badgeOpacity', v)} />
            )}
            <SliderRow label={t.style.cardOpacity} value={config.cardBgOpacity} min={0} max={80} unit="%" onChange={v => updateConfig('cardBgOpacity', v)} />
          </div>

          <div className="flex flex-col">
            <CompactRow label={t.style.badgeTextLabel} hint={t.style.badgeTextHelp} value={config.surahBadgeText || t.style.automatic} {...row('badgeText')}>
              <input
                type="text"
                value={config.surahBadgeText}
                onChange={(e) => updateConfig('surahBadgeText', e.target.value)}
                placeholder={t.style.badgeTextPlaceholder}
                aria-label={t.style.badgeTextLabel}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              />
              <p className="text-xs text-slate-400">{t.style.badgeTextHelp}</p>
            </CompactRow>
            <CompactRow label={t.style.badgeSubtitleLabel} hint={t.style.badgeSubtitleHelp} value={config.surahBadgeSubtitleText || t.style.notSet} {...row('badgeSubtitle')}>
              <input
                type="text"
                value={config.surahBadgeSubtitleText}
                onChange={(e) => updateConfig('surahBadgeSubtitleText', e.target.value)}
                placeholder={t.style.badgeSubtitlePlaceholder}
                aria-label={t.style.badgeSubtitleLabel}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              />
              <p className="text-xs text-slate-400">{t.style.badgeSubtitleHelp}</p>
            </CompactRow>
          </div>

          <div className="flex flex-col">
            <SwitchRow label={t.style.cardBorder} checked={config.cardBorder} onChange={on => updateConfig('cardBorder', on)} />
            <SwitchRow label={t.style.textShadow} checked={config.textShadow} onChange={on => updateConfig('textShadow', on)} />
            <SwitchRow label={t.style.audioVisualizer} checked={config.showWaveform} onChange={on => updateConfig('showWaveform', on)} />
            <SwitchRow label={t.style.surahBadge} checked={config.showSurahBadge} onChange={on => updateConfig('showSurahBadge', on)} />
            <SwitchRow label={t.style.englishTranslation} checked={config.showTranslation} onChange={on => updateConfig('showTranslation', on)} />
            <SwitchRow label={t.style.tafsir} hint={t.style.tafsirHint} checked={config.showTafsir === true} onChange={on => updateConfig('showTafsir', on)} />
          </div>
        </div>

      </StyleSection>
      )}

      {shows('branding') && (
      <StyleSection id="branding" title={t.style.headingBranding} summary={brandingSummary} open={isOpen('branding')} onToggle={() => toggleSection('branding')} bare={!!only}>
      {/* Card & FX, section 2: branding. It belongs with the other things
          stamped on top of the frame rather than with the ayah's typography. */}
        <div className="flex flex-col">
          <CompactRow label={t.style.watermarkLabel} value={config.watermarkText || t.style.notSet} {...row('watermark')}>
            <input
              type="text"
              value={config.watermarkText}
              onChange={(e) => updateConfig('watermarkText', e.target.value)}
              placeholder={t.style.watermarkPlaceholder}
              aria-label={t.style.watermarkLabel}
              dir="ltr"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-start"
            />
          </CompactRow>
          <ChoiceRow label={t.style.watermarkPositionLabel} {...row('watermarkPosition')}
            options={WATERMARK_POSITIONS.map(id => ({ id, label: t.style.watermarkPositions[id] }))}
            chosen={config.watermarkPosition as WatermarkPosition} onChoose={id => updateConfig('watermarkPosition', id)} />
        </div>
      </StyleSection>
      )}
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={pendingDelete?.title || ''}
        message={pendingDelete?.message || ''}
        confirmLabel={pendingDelete?.confirmLabel}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          pendingDelete?.run();
          setPendingDelete(null);
        }}
      />
    </div>
  );
};

/** Red, which the general swatches leave out and a highlight is often wanted in. */
const HIGHLIGHT_RED = '#ef4444';

/**
 * Quick colours for the word being recited, under *Words* when it is the
 * highlight. The accent comes first and is what an unchanged project uses;
 * picking it again goes back to following the accent rather than fixing
 * today's accent in place.
 */
const HighlightSwatches: React.FC<{ config: VideoCanvasConfig; onChange: (hex: string) => void }> = ({ config, onChange }) => {
  const t = useT();
  const chosen = asHighlightColour(config.highlightColor);
  const options = [
    { value: '', colour: config.accentColor || '#b8c7dc', label: t.style.highlightAccent },
    ...[...COLOUR_PRESETS, HIGHLIGHT_RED].map(hex => ({ value: hex, colour: hex, label: hex })),
  ];
  return (
    <fieldset className="min-w-0">
      {/* Its row says what it is; the legend is for a screen reader. */}
      <legend className="sr-only">{t.style.highlightColourLabel}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(option => (
          <button
            key={option.value || 'accent'}
            type="button"
            title={option.label}
            aria-label={option.label}
            aria-pressed={chosen === option.value}
            onClick={() => onChange(option.value)}
            style={{ backgroundColor: option.colour }}
            className={`w-7 h-7 rounded-md border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
              chosen === option.value ? 'border-slate-100 ring-2 ring-amber-500' : 'border-slate-700 hover:border-slate-400'
            }`}
          />
        ))}
      </div>
      {/* Any colour at all, through the same picker as the text colours; the
          swatches above are only the quick picks. */}
      <div className="mt-2">
        <ColorField
          label={t.style.highlightCustom}
          value={chosen || options[0].colour}
          onChange={hex => onChange(asHighlightColour(hex))}
        />
      </div>
    </fieldset>
  );
};
