'use client';

import React, { useState } from 'react';
import { 
  VideoCanvasConfig 
} from './VideoCanvas';
import { ColorField } from './ColorField';
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
  ExternalLink
} from 'lucide-react';

interface StyleConfigPanelProps {
  config: VideoCanvasConfig;
  onChangeConfig: (newConfig: VideoCanvasConfig) => void;
}

export const StyleConfigPanel: React.FC<StyleConfigPanelProps> = ({
  config,
  onChangeConfig
}) => {
  const [activeTab, setActiveTab] = useState<'design' | 'background' | 'card'>('design');

  const updateConfig = (key: keyof VideoCanvasConfig, value: unknown) => {
    onChangeConfig({
      ...config,
      [key]: value
    });
  };

  const handleCustomFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith('video');
      onChangeConfig({
        ...config,
        bgType: isVideo ? 'video' : 'image',
        bgUrl: url
      });
    }
  };

  const [urlDraft, setUrlDraft] = useState('');
  const [urlStatus, setUrlStatus] = useState<{ kind: 'busy' | 'error' | 'ok'; message: string } | null>(null);

  const applyDirectUrl = (url: string) => {
    const isVideo = /\.(mp4|webm|mov|avi)(\?|$)/i.test(url);
    onChangeConfig({
      ...config,
      bgType: isVideo ? 'video' : 'image',
      bgUrl: url
    });
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
      applyDirectUrl(url);
      setUrlStatus({ kind: 'ok', message: 'Background set.' });
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
      applyDirectUrl(data.url);
      setUrlStatus({
        kind: 'ok',
        message: data.credit ? `Background set — ${data.credit} on Pexels.` : 'Background set.'
      });
      setUrlDraft('');
    } catch {
      setUrlStatus({ kind: 'error', message: 'Could not reach the resolver.' });
    }
  };

  return (
    <div className="flex flex-col gap-4 text-xs">
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
                  onClick={() => onChangeConfig({ ...config, bgMode: mode })}
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                    (config.bgMode || 'single') === mode
                      ? 'bg-amber-500 text-slate-950 border-amber-500'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {(config.bgMode || 'single') === 'cycle' && (
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

            {(config.bgMode || 'single') !== 'single' && (
              <p className="text-[11px] text-slate-400 mt-2">
                {(config.bgUrls || []).length === 0
                  ? 'Tap thumbnails below to add backgrounds. With none selected this behaves as a single background.'
                  : `${(config.bgUrls || []).length} selected — tap to add or remove, in the order they play.`}
              </p>
            )}
          </div>

          <div>
            <label className="font-semibold text-slate-200 text-sm block mb-2">
              {(config.bgMode || 'single') === 'single' ? 'Preset Video Loop Backgrounds:' : 'Pick your backgrounds:'}
            </label>
            {/* No inner scroller. Capping this at 224px put a second scrollbar
                inside a panel that was already scrolling, and showed four
                thumbnails above a screen of empty space. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {BACKGROUND_VIDEOS.map((bg) => (
                <button
                  key={bg.id}
                  onClick={() => {
                    const multi = (config.bgMode || 'single') !== 'single';
                    if (!multi) {
                      onChangeConfig({ ...config, bgType: 'video', bgUrl: bg.url });
                      return;
                    }
                    const current = config.bgUrls || [];
                    const next = current.includes(bg.url)
                      ? current.filter(u => u !== bg.url)
                      : [...current, bg.url];
                    // Keep bgUrl pointing at something real: it is the
                    // single-mode value, the saved-project field, and the
                    // fallback when the list is emptied.
                    onChangeConfig({
                      ...config,
                      bgType: 'video',
                      bgUrls: next,
                      bgUrl: next[0] || config.bgUrl
                    });
                  }}
                  className={`relative group rounded-xl overflow-hidden border transition-all aspect-[9/16] ${
                    ((config.bgMode || 'single') === 'single'
                      ? config.bgUrl === bg.url
                      : (config.bgUrls || []).includes(bg.url))
                      ? 'border-amber-500 ring-2 ring-amber-500/50 shadow-lg'
                      : 'border-slate-800 hover:border-slate-600'
                  }`}
                >
                  {/* Play order, so a multi-background sequence is readable at a glance. */}
                  {(config.bgMode || 'single') !== 'single' && (config.bgUrls || []).includes(bg.url) && (
                    <span className="absolute top-1 left-1 z-10 w-5 h-5 rounded-full bg-amber-500 text-slate-950 text-[11px] font-bold flex items-center justify-center shadow">
                      {(config.bgUrls || []).indexOf(bg.url) + 1}
                    </span>
                  )}
                  <img
                    src={bg.thumbnail}
                    alt={bg.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => {
                      const t = e.currentTarget;
                      t.style.display = 'none';
                      t.parentElement!.style.background = 'linear-gradient(180deg, #0f172a, #1e1b4b)';
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent flex flex-col justify-end p-2 text-left">
                    <span className="text-[11px] font-semibold text-slate-100 leading-tight">{bg.title}</span>
                    <span className="text-[9px] text-amber-400 uppercase tracking-wider">{bg.category}</span>
                  </div>
                  {config.bgUrl === bg.url && (
                    <div className="absolute top-2 right-2 bg-amber-500 text-slate-950 p-1 rounded-full shadow">
                      <Check className="w-3 h-3" />
                    </div>
                  )}
                </button>
              ))}
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
                  <span className="block text-lg font-amiri text-amber-400 mt-1" dir="rtl">
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

      {/* Layout & Text, section 3: branding */}
      {activeTab === 'design' && (
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
