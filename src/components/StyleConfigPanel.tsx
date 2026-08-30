'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { 
  VideoCanvasConfig 
} from './VideoCanvas';
import {
  backgroundLabel, appendSegment, removeSegment, mediaKind, rememberMediaKind, MediaKind
} from '@/lib/backgroundTimeline';
import { ColorField } from './ColorField';
import { ConfirmDialog } from './ConfirmDialog';
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
  ChevronRight
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
  const [activeTab, setActiveTab] = useState<'design' | 'background' | 'card'>('design');

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
        ? { kind: 'ok', message: `“${file.name}” added — it will still be here next time.` }
        : {
            kind: 'error',
            message:
              `“${file.name}” is in this video, but could not be stored for next time — ` +
              'the browser refused it, usually because it is out of space for this site.'
          }
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
      title: bg.title,
      category: bg.category,
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
        category: missing ? 'Missing' : 'Yours',
        thumbnail: !missing && item.kind === 'image' ? item.url : null,
        kind: item.kind,
        removable: true,
        missing
      };
    })
  ];

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
      setUrlStatus({ kind: 'error', message: 'That does not look like a link.' });
      return;
    }

    const isPexelsPage = /(^|\.)pexels\.com$/.test(host) && !/^videos?\.|^images\./.test(host);
    if (!isPexelsPage) {
      setUrlStatus({ kind: 'busy', message: 'Checking that link…' });
      await applyDirectUrl(url);
      setUrlStatus({ kind: 'ok', message: 'Added to your backgrounds.' });
      setUrlDraft('');
      return;
    }

    setUrlStatus({ kind: 'busy', message: 'Looking that up on Pexels…' });
    try {
      const res = await fetch(`/api/background/resolve?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok || !data?.url) {
        setUrlStatus({ kind: 'error', message: data?.error || 'Could not resolve that Pexels link.' });
        return;
      }
      await applyDirectUrl(data.url, data.credit ? `${data.credit} (Pexels)` : undefined);
      setUrlStatus({
        kind: 'ok',
        message: data.credit ? `Added — ${data.credit} on Pexels.` : 'Added to your backgrounds.'
      });
      setUrlDraft('');
    } catch {
      setUrlStatus({ kind: 'error', message: 'Could not reach the resolver.' });
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
          ['design', 'Layout & Text', Type],
          ['background', 'Background', ImageIcon],
          ['card', 'Card & FX', Sliders]
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
            Format
          </h3>
          <label className="font-semibold text-slate-200 text-sm">Select Video Aspect Ratio:</label>
          <div className="grid grid-cols-2 gap-2.5">
            {ASPECT_RATIOS.map((ar) => (
              <button
                key={ar.id}
                onClick={() => updateConfig('aspectRatio', ar.id)}
                className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all ${
                  config.aspectRatio === ar.id
                    ? 'bg-amber-500/15 border-amber-500 text-slate-100 ring-1 ring-amber-500/40'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-100">{ar.id}</span>
                  {config.aspectRatio === ar.id && <Check className="w-4 h-4 text-amber-400" />}
                </div>
                <span className="text-[11px] text-slate-400">{ar.name}</span>
                <span className="text-[11px] font-mono text-slate-400">{ar.width}x{ar.height}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Background */}
      {activeTab === 'background' && (
        <div className="flex flex-col gap-4">
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <label className="font-semibold text-slate-200 text-sm block mb-2">How backgrounds are used:</label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                ['single', 'One background', 'A single looping clip.'],
                ['per-ayah', 'One per ayah', 'Steps to the next clip on each ayah.'],
                ['cycle', 'Cycle on a timer', 'Changes every few seconds.'],
                ['shuffle', 'Shuffle', 'Picks per ayah, repeatably.']
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
                  <span>Seconds per background:</span>
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
                  Cut by hand on the timeline — {laneSegments.length} block{laneSegments.length === 1 ? '' : 's'}.
                  Drag a block to move it, or an edge to change how long it runs; stretching one past the
                  clip&apos;s own length just plays it again. Pick a mode above to go back to automatic.
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
                        <span className="flex-1 min-w-0 truncate text-[11px] text-slate-200">{backgroundLabel(seg.url)}</span>
                        <span className="shrink-0 text-[10px] font-mono text-slate-400 tabular-nums">
                          {seg.start.toFixed(1)}–{seg.end.toFixed(1)}s
                        </span>
                        <button
                          onClick={() =>
                            setPendingDelete({
                              title: 'Remove this block?',
                              message: `“${backgroundLabel(seg.url)}” runs from ${seg.start.toFixed(1)}s to ${seg.end.toFixed(1)}s. Removing it leaves a gap there, which shows the plain gradient.`,
                              confirmLabel: 'Remove block',
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
                          aria-label={`Remove ${backgroundLabel(seg.url)} at ${seg.start.toFixed(1)}s`}
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
                <p className="text-[11px] text-slate-400 mt-2">
                  Tap thumbnails below to add backgrounds. With none selected this behaves as a single background.
                </p>
              ) : (
                <div className="mt-3">
                  <p className="text-[11px] text-slate-400 mb-1.5">
                    {bgSequence.length} in the sequence, in play order — the same clip may appear more than once.
                  </p>
                  <ol className="flex flex-col gap-1">
                    {bgSequence.map((url, i) => (
                      <li
                        key={`${url}-${i}`}
                        className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5"
                      >
                        <span className="w-4 shrink-0 text-[11px] font-mono text-amber-400">{i + 1}</span>
                        <span className="flex-1 min-w-0 truncate text-[11px] text-slate-200">{backgroundLabel(url)}</span>
                        <button
                          onClick={() => moveInSequence(i, i - 1)}
                          disabled={i === 0}
                          aria-label={`Move ${backgroundLabel(url)} earlier`}
                          className="p-0.5 text-slate-400 hover:text-slate-100 disabled:opacity-30"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => moveInSequence(i, i + 1)}
                          disabled={i === bgSequence.length - 1}
                          aria-label={`Move ${backgroundLabel(url)} later`}
                          className="p-0.5 text-slate-400 hover:text-slate-100 disabled:opacity-30"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            setPendingDelete({
                              title: 'Remove from the sequence?',
                              message: `“${backgroundLabel(url)}” will stop playing at position ${i + 1}. It stays in your backgrounds below, ready to add again.`,
                              confirmLabel: 'Remove',
                              run: () => setSequence(bgSequence.filter((_, j) => j !== i))
                            })
                          }
                          aria-label={`Remove ${backgroundLabel(url)} from position ${i + 1}`}
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
                ? 'Add a background to the end of the lane:'
                : (config.bgMode || 'single') === 'single' ? 'Backgrounds:' : 'Pick your backgrounds:'}
            </label>
            <p className="text-[11px] text-slate-400 mb-2">
              Presets first, then anything you have uploaded or pasted below. Hover one of your own to
              delete it.
            </p>
            {/* No inner scroller. Capping this at 224px put a second scrollbar
                inside a panel that was already scrolling, and showed four
                thumbnails above a screen of empty space. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {gallery.map((bg) => {
                const inUse = !bg.url ? false : customBackground
                  ? laneSegments.some(seg => seg.url === bg.url)
                  : multiBackground ? bgSequence.includes(bg.url) : config.bgUrl === bg.url;
                return (
                  <div key={bg.id} className="relative group rounded-xl overflow-hidden">
                    <button
                      disabled={bg.missing}
                      title={
                        bg.missing
                          ? 'This file is no longer on this computer, or the link stopped working'
                          : customBackground ? 'Add a block for this clip at the end of the lane'
                          : multiBackground ? 'Add to the sequence — tap again to use it more than once'
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
                        <span className="absolute top-1 left-1 z-10 min-w-5 h-5 px-1 rounded-full bg-amber-500 text-slate-950 text-[11px] font-bold flex items-center justify-center shadow">
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
                          <span className="text-[9px] text-slate-400 leading-tight">
                            File not found — add it again, or remove it
                          </span>
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
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent flex flex-col justify-end p-2 text-left">
                        <span className="text-[11px] font-semibold text-slate-100 leading-tight line-clamp-2">{bg.title}</span>
                        <span className={`text-[9px] uppercase tracking-wider flex items-center gap-1 ${
                          bg.missing ? 'text-slate-400' : 'text-amber-400'
                        }`}>
                          {bg.missing
                            ? <FileQuestion className="w-2.5 h-2.5" />
                            : bg.kind === 'image' ? <ImageIcon className="w-2.5 h-2.5" /> : <Film className="w-2.5 h-2.5" />}
                          {bg.category}
                        </span>
                      </div>
                      {!multiBackground && !customBackground && config.bgUrl === bg.url && (
                        <div className="absolute top-2 right-2 bg-amber-500 text-slate-950 p-1 rounded-full shadow">
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
                            title: 'Remove this background?',
                            message: bg.missing
                              ? `“${bg.title}” cannot be found any more. Removing it just clears the entry.`
                              : `“${bg.title}” will be taken out of your backgrounds${
                                  inUse ? ', and out of this video where it is used' : ''
                                }. Presets are not affected.`,
                            run: () => { if (bg.libraryId) removeFromEverywhere(bg.libraryId, bg.url); }
                          })
                        }
                        title="Remove from your backgrounds"
                        aria-label={`Remove ${bg.title} from your backgrounds`}
                        className={`absolute top-1 right-1 z-10 p-1 rounded-full bg-slate-950/80 text-slate-300 hover:text-red-300 hover:bg-slate-950 border border-slate-700 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 ${
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
                <span>Browse free stock videos on Pexels</span>
              </a>
              <p className="text-[11px] text-slate-400 mt-1">
                Copy the page link from the address bar and paste it below.
              </p>
            </div>
          </div>

          {/* Paste a link -- file or Pexels page */}
          <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800">
            <label htmlFor="bg-url" className="font-semibold text-slate-200 block mb-1.5">Paste a video or image link:</label>
            <div className="flex gap-2">
              <input
                id="bg-url"
                type="text"
                value={urlDraft}
                onChange={e => { setUrlDraft(e.target.value); setUrlStatus(null); }}
                placeholder="A .mp4 link, or a Pexels page link"
                className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleApplyUrl(urlDraft);
                }}
              />
              <button
                onClick={() => handleApplyUrl(urlDraft)}
                disabled={urlStatus?.kind === 'busy'}
                className="px-3 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 font-semibold rounded-lg text-xs transition-colors shrink-0"
              >
                Apply
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              A Pexels page link from the address bar works here — it is looked up and turned into the
              video file for you.
            </p>
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
            <label className="font-semibold text-slate-200 block mb-1.5">Upload Custom Video or Image Loop:</label>
            <div className="relative flex items-center justify-center p-3 border-2 border-dashed border-slate-700 hover:border-amber-500/50 rounded-lg cursor-pointer bg-slate-950/50 transition-colors">
              <input
                type="file"
                accept="video/*,image/*"
                onChange={handleCustomFileUpload}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <div className="flex items-center gap-2 text-slate-400 hover:text-amber-300">
                <Upload className="w-4 h-4" />
                <span className="text-xs font-medium">Browse Video or Image file</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              Kept in this browser, so it is still in the list next time. Clearing site data
              removes it, and the entry then shows as missing rather than disappearing.
            </p>
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
                <span>Dark Overlay Opacity:</span>
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
                <span>Background Blur:</span>
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
            Typography
          </h3>
          <div>
            <label className="font-semibold text-slate-200 text-sm block mb-1.5">Arabic Calligraphy Font:</label>
            <div className="grid grid-cols-2 gap-2">
              {FONTS_ARABIC.map((f) => (
                <button
                  key={f.id}
                  onClick={() => updateConfig('fontArabic', f.id)}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    config.fontArabic === f.id
                      ? 'bg-amber-500/15 border-amber-500 text-amber-300 ring-1 ring-amber-500/40'
                      : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <span className="block font-bold text-sm text-slate-100">{f.name}</span>
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
                <span>Arabic Font Size:</span>
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
                <span>Translation Font Size:</span>
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
                <span>Ayah Number Size:</span>
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
              <span>Colours:</span>
            </label>
            <div className="flex flex-col gap-2">
              <ColorField
                label="Arabic text"
                description="The ayah itself."
                value={config.textColor}
                onChange={hex => updateConfig('textColor', hex)}
              />
              <ColorField
                label="Accent"
                description="Surah badge, ayah number, the divider, the visualiser bars and the card border."
                value={config.accentColor}
                onChange={hex => updateConfig('accentColor', hex)}
              />
              <ColorField
                label="Translation text"
                description="The English line under the Arabic."
                value={config.translationColor}
                onChange={hex => updateConfig('translationColor', hex)}
              />
            </div>
          </div>
        </div>
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

      {/* Card & FX */}
      {activeTab === 'card' && (
        <div className="flex flex-col gap-3">
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 flex flex-col gap-3">
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Card Glass Opacity:</span>
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
              <label className="font-semibold text-slate-200 block mb-1">
                Surah Badge Text:
              </label>
              <input
                type="text"
                value={config.surahBadgeText}
                onChange={(e) => updateConfig('surahBadgeText', e.target.value)}
                placeholder="Leave blank for automatic surah/range title"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Leave empty to auto-generate from detected surah and ayah range.
              </p>
            </div>

            <div className="pt-2 border-t border-slate-800">
              <label className="font-semibold text-slate-200 block mb-1">
                Surah Badge Subtitle:
              </label>
              <input
                type="text"
                value={config.surahBadgeSubtitleText}
                onChange={(e) => updateConfig('surahBadgeSubtitleText', e.target.value)}
                placeholder="Optional subtitle under the badge title"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Leave empty to hide the second badge line.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={config.cardBorder}
                  onChange={(e) => updateConfig('cardBorder', e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <span>Card border</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={config.textShadow}
                  onChange={(e) => updateConfig('textShadow', e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <span>Text Shadow</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={config.showWaveform}
                  onChange={(e) => updateConfig('showWaveform', e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <span>Audio Visualizer</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={config.showSurahBadge}
                  onChange={(e) => updateConfig('showSurahBadge', e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <span>Surah Badge</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={config.showTranslation}
                  onChange={(e) => updateConfig('showTranslation', e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <span>English Translation</span>
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
            Branding
          </h3>
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 flex flex-col gap-3">
            <div>
              <label className="font-semibold text-slate-200 block mb-1">Watermark / Social Handle:</label>
              <input
                type="text"
                value={config.watermarkText}
                onChange={(e) => updateConfig('watermarkText', e.target.value)}
                placeholder="@MyDawahChannel"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-200 block mb-1">Watermark Position:</label>
              <select
                value={config.watermarkPosition}
                onChange={(e) => updateConfig('watermarkPosition', e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                <option value="bottom-right">Bottom Right</option>
                <option value="bottom-left">Bottom Left</option>
                <option value="top-right">Top Right</option>
                <option value="top-left">Top Left</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
