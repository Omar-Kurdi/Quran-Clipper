'use client';

import React, { useState } from 'react';
import { 
  VideoCanvasConfig 
} from './VideoCanvas';
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
  const [activeTab, setActiveTab] = useState<'aspect' | 'background' | 'font' | 'card' | 'watermark'>('aspect');

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

  const handleApplyUrl = (url: string) => {
    if (!url.trim()) return;
    const isVideo = /\.(mp4|webm|mov|avi)(\?|$)/i.test(url.trim());
    onChangeConfig({
      ...config,
      bgType: isVideo ? 'video' : 'image',
      bgUrl: url.trim()
    });
  };

  return (
    <div className="flex flex-col gap-4 text-xs">
      {/* Tab Navigation */}
      <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800 overflow-x-auto">
        <button
          onClick={() => setActiveTab('aspect')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all shrink-0 ${
            activeTab === 'aspect' ? 'bg-amber-500 text-slate-950 font-semibold shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layout className="w-3.5 h-3.5" />
          <span>Format</span>
        </button>

        <button
          onClick={() => setActiveTab('background')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all shrink-0 ${
            activeTab === 'background' ? 'bg-amber-500 text-slate-950 font-semibold shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Background</span>
        </button>

        <button
          onClick={() => setActiveTab('font')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all shrink-0 ${
            activeTab === 'font' ? 'bg-amber-500 text-slate-950 font-semibold shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Type className="w-3.5 h-3.5" />
          <span>Typography</span>
        </button>

        <button
          onClick={() => setActiveTab('card')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all shrink-0 ${
            activeTab === 'card' ? 'bg-amber-500 text-slate-950 font-semibold shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Card & FX</span>
        </button>

        <button
          onClick={() => setActiveTab('watermark')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all shrink-0 ${
            activeTab === 'watermark' ? 'bg-amber-500 text-slate-950 font-semibold shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Branding</span>
        </button>
      </div>

      {/* Tab 1: Aspect Ratio */}
      {activeTab === 'aspect' && (
        <div className="flex flex-col gap-3">
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
                <span className="text-[10px] font-mono text-slate-500">{ar.width}x{ar.height}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2: Background Selection */}
      {activeTab === 'background' && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="font-semibold text-slate-200 text-sm block mb-2">Preset Video Loop Backgrounds:</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
              {BACKGROUND_VIDEOS.map((bg) => (
                <button
                  key={bg.id}
                  onClick={() => {
                    onChangeConfig({
                      ...config,
                      bgType: 'video',
                      bgUrl: bg.url
                    });
                  }}
                  className={`relative group rounded-xl overflow-hidden border transition-all aspect-[9/16] ${
                    config.bgUrl === bg.url
                      ? 'border-amber-500 ring-2 ring-amber-500/50 shadow-lg'
                      : 'border-slate-800 hover:border-slate-600'
                  }`}
                >
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

            <div className="text-center">
              <a
                href="https://www.pexels.com/search/videos/mosque%20night/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors font-medium"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Browse free stock videos on Pexels</span>
              </a>
            </div>
          </div>

          {/* Paste Video URL */}
          <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800">
            <label className="font-semibold text-slate-200 block mb-1.5">Paste Custom Video or Image URL:</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="https://example.com/video.mp4"
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleApplyUrl((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).value = '';
                  }
                }}
              />
              <button
                onClick={(e) => {
                  const input = (e.currentTarget as HTMLButtonElement).parentElement?.querySelector('input') as HTMLInputElement | null;
                  const url = input?.value || '';
                  handleApplyUrl(url);
                  if (input) input.value = '';
                }}
                className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold rounded-lg text-xs transition-colors shrink-0"
              >
                Apply
              </button>
            </div>
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

      {/* Tab 3: Typography */}
      {activeTab === 'font' && (
        <div className="flex flex-col gap-3">
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
                <span>Transliteration Font Size:</span>
                <span className="font-mono text-amber-400">{config.transliterationFontSize}px</span>
              </div>
              <input
                type="range"
                min={16}
                max={52}
                value={config.transliterationFontSize}
                onChange={(e) => updateConfig('transliterationFontSize', parseInt(e.target.value, 10))}
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
          </div>

          {/* Colors */}
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
            <label className="font-semibold text-slate-200 block mb-2 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-amber-400" />
              <span>Color Themes:</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="text-[10px] text-slate-400 block mb-1">Arabic Text</span>
                <input
                  type="color"
                  value={config.textColor}
                  onChange={(e) => updateConfig('textColor', e.target.value)}
                  className="w-full h-8 rounded bg-slate-950 border border-slate-700 cursor-pointer"
                />
              </div>

              <div>
                <span className="text-[10px] text-slate-400 block mb-1">Accent Gold</span>
                <input
                  type="color"
                  value={config.accentColor}
                  onChange={(e) => updateConfig('accentColor', e.target.value)}
                  className="w-full h-8 rounded bg-slate-950 border border-slate-700 cursor-pointer"
                />
              </div>

              <div>
                <span className="text-[10px] text-slate-400 block mb-1">Translation</span>
                <input
                  type="color"
                  value={config.translationColor}
                  onChange={(e) => updateConfig('translationColor', e.target.value)}
                  className="w-full h-8 rounded bg-slate-950 border border-slate-700 cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Card & FX */}
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
              <p className="text-[10px] text-slate-500 mt-1">
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
              <p className="text-[10px] text-slate-500 mt-1">
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
                <span>Gold Border</span>
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
                  checked={config.showTransliteration}
                  onChange={(e) => updateConfig('showTransliteration', e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <span>Transliteration</span>
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

      {/* Tab 5: Branding */}
      {activeTab === 'watermark' && (
        <div className="flex flex-col gap-3">
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
