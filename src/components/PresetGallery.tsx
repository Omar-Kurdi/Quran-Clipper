'use client';

import React from 'react';
import { Check, Palette } from 'lucide-react';
import { FONTS_ARABIC } from '@/lib/quranData';
import { STYLE_PRESETS, presetBackground, type StylePreset, type PresetLook } from '@/lib/stylePresets';
import { frameLayout, type Box } from '@/lib/frameLayout';
import { useT } from './LocaleProvider';

interface PresetGalleryProps {
  /** The preset the project currently matches exactly, to mark it. */
  current: string | null;
  onApply: (preset: StylePreset) => void;
}

/**
 * The presets, each drawn as a miniature of the frame it produces.
 *
 * The thumbnail is built from the preset itself rather than a stored image:
 * the stock background's poster, dimmed and blurred as the preset says, the
 * card at its opacity and border, and a line of Arabic in the preset's face
 * and colours. So it cannot drift from what applying the preset does.
 */
export const PresetGallery: React.FC<PresetGalleryProps> = ({ current, onApply }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 border-b border-slate-800 pb-1.5 flex items-center gap-1.5">
        <Palette className="w-3.5 h-3.5 text-amber-400" />
        {t.presets.heading}
      </h3>
      <p className="text-[11px] text-slate-400">{t.presets.help}</p>
      <div className="grid grid-cols-3 gap-2">
        {STYLE_PRESETS.map(preset => {
          const names = t.presets.items[preset.id as keyof typeof t.presets.items];
          const selected = current === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => onApply(preset)}
              aria-pressed={selected}
              title={names?.note}
              className={`group rounded-lg border p-1 text-start transition-all ${
                selected
                  ? 'border-amber-500 ring-1 ring-amber-500/40 bg-amber-500/10'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-600'
              }`}
            >
              <PresetThumb preset={preset} />
              <span className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-slate-100">
                {selected && <Check className="w-3 h-3 text-amber-400 shrink-0" />}
                <span className="truncate">{names?.name ?? preset.id}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const BOX = 'absolute rounded flex items-center px-1';

/** A box of the layout, as a share of the miniature, with the preset's card behind it. */
const boxStyle = (box: Box, look: PresetLook, drawsCard: boolean): React.CSSProperties => ({
  left: `${box.x * 100}%`,
  top: `${box.y * 100}%`,
  width: `${box.width * 100}%`,
  height: `${box.height * 100}%`,
  backgroundColor: drawsCard ? `rgba(15, 23, 42, ${look.cardBgOpacity / 100})` : undefined,
  border: drawsCard && look.cardBorder && look.cardBgOpacity > 0 ? `1px solid ${look.accentColor}66` : undefined,
});

function TranslationBars({ colour }: { colour: string }) {
  return (
    <>
      <span className="block h-1 w-3/4 rounded-full" style={{ backgroundColor: colour, opacity: 0.7 }} />
      <span className="block h-1 w-1/2 rounded-full" style={{ backgroundColor: colour, opacity: 0.7 }} />
    </>
  );
}

/** A 9:16 miniature of the frame, from the preset's own values. */
function PresetThumb({ preset }: { preset: StylePreset }) {
  const { look } = preset;
  const layout = frameLayout(look.layout, 1, 1);
  const background = presetBackground(look.background);
  const fontClass = FONTS_ARABIC.find(font => font.id === look.fontArabic)?.className ?? '';
  return (
    <span aria-hidden className="relative block aspect-[9/16] w-full overflow-hidden rounded-md bg-slate-950">
      {background && (
        // The stock background's poster, as a CSS background: decorative, and
        // at thumbnail size there is no layout for an image element to protect.
        <span
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url("${background.thumbnail}")`,
            filter: look.bgBlur ? `blur(${Math.min(4, look.bgBlur / 2)}px)` : undefined
          }}
        />
      )}
      <span className="absolute inset-0 bg-black" style={{ opacity: look.bgOverlayOpacity / 100 }} />
      {/* Placed where the preset's layout puts the text, so a lower third
          reads as one before it is applied. */}
      <span className={`${BOX} flex-col justify-center gap-1`} style={boxStyle(layout.text, look, layout.drawsCard)}>
        <span
          dir="rtl"
          className={`${fontClass} text-[13px] leading-tight`}
          style={{ color: look.textColor, textShadow: look.textShadow ? '0 1px 3px rgba(0,0,0,0.9)' : undefined }}
        >
          بِسْمِ ٱللَّهِ
        </span>
        <span className="block h-px w-1/2" style={{ backgroundColor: look.accentColor, opacity: 0.6 }} />
        {!layout.translation && <TranslationBars colour={look.translationColor} />}
      </span>
      {layout.translation && (
        <span className={`${BOX} flex-col justify-center gap-1`} style={boxStyle(layout.translation, look, layout.drawsCard)}>
          <TranslationBars colour={look.translationColor} />
        </span>
      )}
    </span>
  );
}
