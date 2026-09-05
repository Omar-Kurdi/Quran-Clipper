'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { 
  VideoCanvasConfig 
} from './VideoCanvas';
import {
  backgroundLabel, appendSegment, removeSegment, mediaKind, rememberMediaKind, MediaKind
} from '@/lib/backgroundTimeline';
import { formatClipLength } from '@/lib/mediaDuration';
import { useMediaDurations } from '@/hooks/useMediaDurations';
import { ColorField } from './ColorField';
import { ConfirmDialog } from './ConfirmDialog';
import { TranslationPicker } from './TranslationPicker';
import { Button } from './Button';
import { DEFAULT_TRANSLATION_ID, selectedOptions } from '@/lib/translations';
import { useTranslationCatalogue } from '@/hooks/useTranslationCatalogue';
import { useT } from './LocaleProvider';
import {
  LibraryItem, subscribeToLibrary, librarySnapshot, serverLibrarySnapshot, hydrateLibrary,
  addLibraryUpload, addLibraryLink, removeLibraryItem
} from '@/lib/backgroundLibrary';
import { 
  BACKGROUND_VIDEOS, 
  FONTS_ARABIC, 
  ASPECT_RATIOS 
} from '@/lib/quranData';
import { 
  Layout, 
  Type, 
  Image as ImageIcon, 
  Sliders, 
  Sparkles, 
  ShieldCheck, 
  Upload, 
  Palette,
  Check,
  ExternalLink,
  X,
  Trash2,
  Film,
  FileQuestion,
  ChevronLeft,
  ChevronRight,
  Languages
} from 'lucide-react';

interface StyleConfigPanelProps {
  config: VideoCanvasConfig;
  onChangeConfig: (newConfig: VideoCanvasConfig) => void;
  /** Length of the clip, so a background added here lands somewhere real on the lane. */
  clipDuration?: number;
  /** The block picked on the timeline, so both surfaces act on the same one. */
  selectedBackground?: number | null;
  onSelectBackground?: (index: number | null) => void;
}

export const StyleConfigPanel: React.FC<StyleConfigPanelProps> = ({
  config,
  onChangeConfig,
  clipDuration = 0,
  selectedBackground = null,
  onSelectBackground
}) => {
  const t = useT();
  /** One name per clip, shared by the lane list, the sequence list and every tooltip. */
  const nameOf = (url: string) => backgroundLabel(url, t.backgrounds);
  const [activeTab, setActiveTab] = useState<'design' | 'background' | 'card'>('design');

  /**
   * Which translations the card shows.
   *
   * The list itself is a dialog -- 130 editions across 40 languages is not a
   * panel section -- so what lives here is the answer: two or three chips and
   * a way back into the list. The catalogue is only fetched once the picker
   * has been opened, so the names shown before that are whatever it already
   * knows; an id it cannot name is shown as itself rather than as nothing.
   */
  const [isTranslationPickerOpen, setIsTranslationPickerOpen] = useState(false);
  const translationIds = config.translationIds?.length ? config.translationIds : [DEFAULT_TRANSLATION_ID];
  const { options: catalogue } = useTranslationCatalogue(isTranslationPickerOpen);
  const chosenTranslations = selectedOptions(translationIds, catalogue);

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

  const handleCustomFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Let the same file be picked again after it has been removed from the list.
    e.target.value = '';
    const kind: MediaKind = file.type.startsWith('image') ? 'image' : 'video';
    const { item, stored } = await addLibraryUpload(file, kind);
    if (item.url) addBackground(item.url, kind);
    setUploadStatus(
      stored
        ? { kind: 'ok', message: t.style.uploadAdded(file.name) }
        : { kind: 'error', message: t.style.uploadNotStored(file.name) }
    );
  };

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
    activeTab === 'background'
  );

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

  return (
    // `p-3` matches the Inspector tab beside it. Without it this panel's cards,
    // sliders and section headings all sat flush against the column border,
    // because the container in page.tsx only scrolls -- it does not pad.
    <div className="flex flex-col gap-4 text-xs p-3">
      {/* Tab navigation.

          Format, Typography and Branding used to be three tabs of their own,
          which made five -- more than fits across a 340px column, so the strip
          scrolled sideways and the last two tabs were invisible until you
          found that out. They are all "how the frame is laid out and lettered"
          and now share one tab with headings inside it. Three fit. */}
      <div className="grid grid-cols-3 gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
        {([
          ['design', t.style.tabDesign, Type],
          ['background', t.style.tabBackground, ImageIcon],
          ['card', t.style.tabCard, Sliders]
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            aria-current={activeTab === id ? 'true' : undefined}
            className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[11px] font-medium transition-all min-w-0 ${
              activeTab === id ? 'bg-amber-500 text-slate-950 font-semibold shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      {/* Layout & Text, section 1: format */}
      {activeTab === 'design' && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 border-b border-slate-800 pb-1.5 flex items-center gap-1.5">
            <Layout className="w-3.5 h-3.5 text-amber-400" />
            {t.style.headingFormat}
          </h3>
          <label className="font-semibold text-slate-200 text-sm">{t.style.aspectRatioLabel}</label>
          <div className="grid grid-cols-2 gap-2.5">
            {ASPECT_RATIOS.map((ar) => (
              <button
                key={ar.id}
                onClick={() => updateConfig('aspectRatio', ar.id)}
                className={`p-3 rounded-xl border text-start flex flex-col gap-1 transition-all ${
                  config.aspectRatio === ar.id
                    ? 'bg-amber-500/15 border-amber-500 text-slate-100 ring-1 ring-amber-500/40'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-100" dir="ltr">{ar.id}</span>
                  {config.aspectRatio === ar.id && <Check className="w-4 h-4 text-amber-400" />}
                </div>
                <span className="text-[11px] text-slate-400">
                  {t.style.aspectRatios[ar.id as keyof typeof t.style.aspectRatios] ?? ar.name}
                </span>
                <span className="text-[11px] font-mono text-slate-400" dir="ltr">{ar.width}x{ar.height}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Background */}
      {activeTab === 'background' && (
        <div className="flex flex-col gap-4">
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
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                    !customBackground && (config.bgMode || 'single') === mode
                      ? 'bg-amber-500 text-slate-950 border-amber-500'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

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
                <p className="text-[11px] text-slate-300 bg-lapis-bright/10 border border-lapis-bright/30 rounded-lg p-2">
                  {t.style.laneSummary(laneSegments.length)} {t.style.laneHelp}
                </p>
                {laneSegments.length > 0 && (
                  <ol className="flex flex-col gap-1 mt-2">
                    {laneSegments.map((seg, i) => (
                      <li
                        key={`${seg.url}-${i}`}
                        onPointerDown={() => onSelectBackground?.(i)}
                        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 border cursor-pointer ${
                          selectedBackground === i
                            ? 'bg-lapis-bright/20 border-lapis-bright/60'
                            : 'bg-slate-950 border-slate-800'
                        }`}
                      >
                        <span className="w-4 shrink-0 text-[11px] font-mono text-amber-400">{i + 1}</span>
                        <span className="flex-1 min-w-0 truncate text-[11px] text-slate-200">{nameOf(seg.url)}</span>
                        <span className="shrink-0 text-[10px] font-mono text-slate-400 tabular-nums" dir="ltr">
                          {seg.start.toFixed(1)}–{seg.end.toFixed(1)}s
                        </span>
                        <button
                          onClick={() =>
                            setPendingDelete({
                              title: t.style.removeBlockTitle,
                              message: t.style.removeBlockMessage(
                                nameOf(seg.url),
                                seg.start.toFixed(1),
                                seg.end.toFixed(1)
                              ),
                              confirmLabel: t.style.removeBlockConfirm,
                              run: () => {
                                setLane(removeSegment(laneSegments, i));
                                onSelectBackground?.(
                                  selectedBackground === null || selectedBackground === i
                                    ? null
                                    : selectedBackground > i
                                      ? selectedBackground - 1
                                      : selectedBackground
                                );
                              }
                            })
                          }
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
                <p className="text-[11px] text-slate-400 mt-2">{t.style.sequenceEmpty}</p>
              ) : (
                <div className="mt-3">
                  <p className="text-[11px] text-slate-400 mb-1.5">{t.style.sequenceCount(bgSequence.length)}</p>
                  <ol className="flex flex-col gap-1">
                    {bgSequence.map((url, i) => (
                      <li
                        key={`${url}-${i}`}
                        className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5"
                      >
                        <span className="w-4 shrink-0 text-[11px] font-mono text-amber-400">{i + 1}</span>
                        <span className="flex-1 min-w-0 truncate text-[11px] text-slate-200">{nameOf(url)}</span>
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

          <div>
            <label className="font-semibold text-slate-200 text-sm block mb-2">
              {customBackground
                ? t.style.galleryLabelLane
                : (config.bgMode || 'single') === 'single'
                  ? t.style.galleryLabelSingle
                  : t.style.galleryLabelMulti}
            </label>
            <p className="text-[11px] text-slate-400 mb-2">{t.style.galleryHelp}</p>
            {/* No inner scroller. Capping this at 224px put a second scrollbar
                inside a panel that was already scrolling, and showed four
                thumbnails above a screen of empty space. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {gallery.map((bg) => {
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
                        <span className="absolute top-1 start-1 z-10 min-w-5 h-5 px-1 rounded-full bg-amber-500 text-slate-950 text-[11px] font-bold flex items-center justify-center shadow">
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
                        <span className="text-[11px] font-semibold text-slate-100 leading-tight line-clamp-2">{bg.title}</span>
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
              <p className="text-[11px] text-slate-400 mt-1">{t.style.browsePexelsHelp}</p>
            </div>
          </div>

          {/* Paste a link -- file or Pexels page */}
          <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800">
            <label htmlFor="bg-url" className="font-semibold text-slate-200 block mb-1.5">{t.style.pasteLinkLabel}</label>
            <div className="flex gap-2">
              <input
                id="bg-url"
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
            <p className="text-[11px] text-slate-400 mt-1.5">{t.style.pasteLinkHelp}</p>
            {urlStatus && (
              <p
                role="status"
                className={`text-[11px] mt-1.5 rounded-md p-2 border ${
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
            <div className="relative flex items-center justify-center p-3 border-2 border-dashed border-slate-700 hover:border-amber-500/50 rounded-lg cursor-pointer bg-slate-950/50 transition-colors">
              <input
                type="file"
                accept="video/*,image/*"
                onChange={handleCustomFileUpload}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <div className="flex items-center gap-2 text-slate-400 hover:text-amber-300">
                <Upload className="w-4 h-4" />
                <span className="text-xs font-medium">{t.style.uploadBrowse}</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">{t.style.uploadHelp}</p>
            {uploadStatus && (
              <p
                role="status"
                className={`text-[11px] mt-1.5 rounded-md p-2 border ${
                  uploadStatus.kind === 'error'
                    ? 'text-red-300 bg-red-500/10 border-red-500/25'
                    : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
                }`}
              >
                {uploadStatus.message}
              </p>
            )}
          </div>

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
        </div>
      )}

      {/* Layout & Text, section 2: typography and colour */}
      {activeTab === 'design' && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 border-b border-slate-800 pb-1.5 flex items-center gap-1.5">
            <Type className="w-3.5 h-3.5 text-amber-400" />
            {t.style.headingTypography}
          </h3>
          <div>
            <label className="font-semibold text-slate-200 text-sm block mb-1.5">{t.style.arabicFontLabel}</label>
            <div className="grid grid-cols-2 gap-2">
              {FONTS_ARABIC.map((f) => (
                <button
                  key={f.id}
                  onClick={() => updateConfig('fontArabic', f.id)}
                  className={`p-2.5 rounded-xl border text-start transition-all ${
                    config.fontArabic === f.id
                      ? 'bg-amber-500/15 border-amber-500 text-amber-300 ring-1 ring-amber-500/40'
                      : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <span className="block font-bold text-sm text-slate-100">
                    {t.style.fonts[f.id as keyof typeof t.style.fonts] ?? f.name}
                  </span>
                  {/* Each face previews itself. Hardcoding font-amiri here
                      showed five identical samples -- and kept every other
                      family out of the DOM, so the canvas never fetched the
                      one it was about to draw with. */}
                  <span className={`block text-lg ${f.className} text-amber-400 mt-1`} dir="rtl">
                    بِسْمِ ٱللَّهِ
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Font Sizes */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>{t.style.arabicFontSize}</span>
                <span className="font-mono text-amber-400">{config.arabicFontSize}px</span>
              </div>
              <input
                type="range"
                min={24}
                max={64}
                value={config.arabicFontSize}
                onChange={(e) => updateConfig('arabicFontSize', parseInt(e.target.value, 10))}
                className="w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>{t.style.translationFontSize}</span>
                <span className="font-mono text-amber-400">{config.translationFontSize}px</span>
              </div>
              <input
                type="range"
                min={14}
                max={48}
                value={config.translationFontSize}
                onChange={(e) => updateConfig('translationFontSize', parseInt(e.target.value, 10))}
                className="w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>{t.style.ayahNumberSize}</span>
                <span className="font-mono text-amber-400">{config.ayahNumberFontSize}px</span>
              </div>
              <input
                type="range"
                min={20}
                max={72}
                value={config.ayahNumberFontSize}
                onChange={(e) => updateConfig('ayahNumberFontSize', parseInt(e.target.value, 10))}
                className="w-full accent-amber-500"
              />
            </div>
          </div>

          {/* Which translations the card carries. One row of chips and a
              button: the list they came from is a dialog. */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <label className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
              <Languages className="w-3.5 h-3.5 text-amber-400" />
              <span>{t.translations.panelLabel}</span>
            </label>
            <p className="text-[11px] text-slate-400 mb-2">{t.translations.panelHelp}</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {chosenTranslations.map((option, index) => (
                <span
                  key={option.id}
                  className="flex items-center gap-1.5 rounded-full bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-200"
                >
                  <span className="font-mono text-[10px] text-amber-400">{index + 1}</span>
                  <span className="truncate max-w-44">
                    {option.id === DEFAULT_TRANSLATION_ID && !option.language
                      ? t.translations.defaultName
                      : option.name}
                  </span>
                  {option.language && <span className="text-slate-500">· {option.language}</span>}
                </span>
              ))}
            </div>
            <Button
              icon={<Languages className="w-3.5 h-3.5" />}
              onClick={() => setIsTranslationPickerOpen(true)}
            >
              {t.translations.choose}
            </Button>
          </div>

          {/* Colours.

              Three native `<input type="color">` used to sit here; on a
              multi-monitor setup the OS opened its dialog on another screen
              entirely. `ColorField` keeps the picker in the panel.

              "Accent Gold" was also the wrong name twice over: it is not
              necessarily gold, and it was never clear what it painted. It is
              named for its job now, and the card border -- which was hardcoded
              amber and stayed gold no matter what this was set to -- follows
              it like everything else in the list. */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <label className="font-semibold text-slate-200 mb-2 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-amber-400" />
              <span>{t.style.coloursLabel}</span>
            </label>
            <div className="flex flex-col gap-2">
              <ColorField
                label={t.style.colourArabic}
                description={t.style.colourArabicDescription}
                value={config.textColor}
                onChange={hex => updateConfig('textColor', hex)}
              />
              <ColorField
                label={t.style.colourAccent}
                description={t.style.colourAccentDescription}
                value={config.accentColor}
                onChange={hex => updateConfig('accentColor', hex)}
              />
              <ColorField
                label={t.style.colourTranslation}
                description={t.style.colourTranslationDescription}
                value={config.translationColor}
                onChange={hex => updateConfig('translationColor', hex)}
              />
            </div>
          </div>
        </div>
      )}

      <TranslationPicker
        isOpen={isTranslationPickerOpen}
        onClose={() => setIsTranslationPickerOpen(false)}
        value={translationIds}
        onChange={ids => updateConfig('translationIds', ids)}
      />

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

      {/* Card & FX */}
      {activeTab === 'card' && (
        <div className="flex flex-col gap-3">
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 flex flex-col gap-3">
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>{t.style.cardOpacity}</span>
                <span className="font-mono text-amber-400">{config.cardBgOpacity}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={80}
                value={config.cardBgOpacity}
                onChange={(e) => updateConfig('cardBgOpacity', parseInt(e.target.value, 10))}
                className="w-full accent-amber-500"
              />
            </div>

            <div className="pt-2 border-t border-slate-800">
              <label className="font-semibold text-slate-200 block mb-1">{t.style.badgeTextLabel}</label>
              <input
                type="text"
                value={config.surahBadgeText}
                onChange={(e) => updateConfig('surahBadgeText', e.target.value)}
                placeholder={t.style.badgeTextPlaceholder}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              />
              <p className="text-[11px] text-slate-400 mt-1">{t.style.badgeTextHelp}</p>
            </div>

            <div className="pt-2 border-t border-slate-800">
              <label className="font-semibold text-slate-200 block mb-1">{t.style.badgeSubtitleLabel}</label>
              <input
                type="text"
                value={config.surahBadgeSubtitleText}
                onChange={(e) => updateConfig('surahBadgeSubtitleText', e.target.value)}
                placeholder={t.style.badgeSubtitlePlaceholder}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              />
              <p className="text-[11px] text-slate-400 mt-1">{t.style.badgeSubtitleHelp}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={config.cardBorder}
                  onChange={(e) => updateConfig('cardBorder', e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <span>{t.style.cardBorder}</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={config.textShadow}
                  onChange={(e) => updateConfig('textShadow', e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <span>{t.style.textShadow}</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={config.showWaveform}
                  onChange={(e) => updateConfig('showWaveform', e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <span>{t.style.audioVisualizer}</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={config.showSurahBadge}
                  onChange={(e) => updateConfig('showSurahBadge', e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <span>{t.style.surahBadge}</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={config.showTranslation}
                  onChange={(e) => updateConfig('showTranslation', e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <span>{t.style.englishTranslation}</span>
              </label>
            </div>

          </div>
        </div>
      )}

      {/* Card & FX, section 2: branding. It belongs with the other things
          stamped on top of the frame rather than with the ayah's typography. */}
      {activeTab === 'card' && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 border-b border-slate-800 pb-1.5 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
            {t.style.headingBranding}
          </h3>
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 flex flex-col gap-3">
            <div>
              <label className="font-semibold text-slate-200 block mb-1">{t.style.watermarkLabel}</label>
              <input
                type="text"
                value={config.watermarkText}
                onChange={(e) => updateConfig('watermarkText', e.target.value)}
                placeholder={t.style.watermarkPlaceholder}
                dir="ltr"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-start"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-200 block mb-1">{t.style.watermarkPositionLabel}</label>
              <select
                value={config.watermarkPosition}
                onChange={(e) => updateConfig('watermarkPosition', e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value="bottom-right">{t.style.watermarkPositions['bottom-right']}</option>
                <option value="bottom-left">{t.style.watermarkPositions['bottom-left']}</option>
                <option value="top-right">{t.style.watermarkPositions['top-right']}</option>
                <option value="top-left">{t.style.watermarkPositions['top-left']}</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
