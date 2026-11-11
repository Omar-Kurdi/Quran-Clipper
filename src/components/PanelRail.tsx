'use client';

import React from 'react';
import { BookOpen, Captions, ChevronsRight, Droplet, Image as ImageIcon, LayoutGrid, RectangleHorizontal, Type } from 'lucide-react';
import { useT } from './LocaleProvider';
import type { StyleArea } from './StyleConfigPanel';

export type PanelTab = 'source' | 'captions' | 'style';

/** What the rail can open: the two working tabs, and each part of the look on its own. */
export type RailItem = 'source' | 'captions' | StyleArea;

const GROUPS: RailItem[][] = [['source', 'captions'], ['presets', 'text', 'background', 'card', 'branding']];
const ITEMS = GROUPS.flat();

const ICONS: Record<RailItem, React.ComponentType<{ className?: string }>> = {
  source: BookOpen, captions: Captions, presets: LayoutGrid, text: Type,
  card: RectangleHorizontal, background: ImageIcon, branding: Droplet
};

/**
 * The working panel's rail, on a desktop: one icon for each thing the panel
 * can show, in the order a clip is made -- what is recited, what each caption
 * says, then the look a part at a time. On a phone the bottom bar's three
 * tabs stand in for it.
 *
 * The WAI-ARIA tabs pattern, vertical: one Tab stop, the up and down arrows
 * move between items.
 *
 * Icons only unless `expanded`: the button at the top sets each item's name
 * beside its icon, for whoever would rather read than recognise.
 */
export const PanelRail: React.FC<{
  value: RailItem; onChange: (item: RailItem) => void; toCheck: number;
  expanded: boolean; onExpandedChange: (expanded: boolean) => void;
}> = ({ value, onChange, toCheck, expanded, onExpandedChange }) => {
  const t = useT();
  const labels: Record<RailItem, string> = {
    source: t.panel.source, captions: t.panel.captions, presets: t.presets.heading, text: t.style.tabDesign,
    card: t.style.tabCard, background: t.style.tabBackground, branding: t.style.headingBranding
  };
  const step = (from: RailItem, by: number) => {
    const next = ITEMS[(ITEMS.indexOf(from) + by + ITEMS.length) % ITEMS.length];
    onChange(next);
    document.getElementById(`panel-tab-${next}`)?.focus();
  };
  return (
    <div className={`hidden lg:flex shrink-0 flex-col gap-1.5 py-2 border-e border-slate-800 bg-slate-950/70 ${expanded ? 'w-44 px-2' : 'w-14 items-center'}`}>
      <NamesToggle expanded={expanded} onToggle={() => onExpandedChange(!expanded)} label={expanded ? t.panel.hideNames : t.panel.showNames} />
      <div
        role="tablist"
        aria-label={t.panel.label}
        aria-orientation="vertical"
        className={`flex flex-col gap-1.5 ${expanded ? '' : 'items-center'}`}
      >
      {GROUPS.map((group, g) => (
        <React.Fragment key={g}>
          {g > 0 && <div className="w-6 h-px bg-slate-800 my-1" aria-hidden="true" />}
          {group.map(item => (
            <RailButton
              key={item}
              item={item}
              label={labels[item]}
              on={value === item}
              toCheck={item === 'captions' ? toCheck : 0}
              toCheckLabel={t.panel.toCheck(toCheck)}
              expanded={expanded}
              onPick={() => onChange(item)}
              onStep={by => step(item, by)}
            />
          ))}
        </React.Fragment>
      ))}
      </div>
    </div>
  );
};

/** The `>>` at the top of the rail: names beside the icons, or icons alone. */
const NamesToggle: React.FC<{ expanded: boolean; onToggle: () => void; label: string }> = ({ expanded, onToggle, label }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={expanded}
    aria-label={label}
    title={label}
    className={`h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${expanded ? 'self-end w-7' : 'w-10'}`}
  >
    <ChevronsRight className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180 rtl:rotate-0' : 'rtl:rotate-180'}`} />
  </button>
);

/** The tour's anchor for each item: Source and Captions as before, and Presets for the look as a whole. */
const TOUR_ANCHOR: Partial<Record<RailItem, string>> = { source: 'tab-source', captions: 'tab-captions', presets: 'tab-style' };
/** The panel each item shows: the parts of the look all show in the Style panel. */
const panelOf = (item: RailItem) => (item === 'source' || item === 'captions' ? `panel-${item}` : 'panel-style');

/** One item of the rail: an icon, its name on hover, and on Captions the count still to check. */
const RailButton: React.FC<{
  item: RailItem; label: string; on: boolean; toCheck: number; toCheckLabel: string; expanded: boolean;
  onPick: () => void; onStep: (by: number) => void;
}> = ({ item, label, on, toCheck, toCheckLabel, expanded, onPick, onStep }) => {
  const Icon = ICONS[item];
  return (
    <button
      id={`panel-tab-${item}`}
      data-tour={TOUR_ANCHOR[item]}
      role="tab"
      aria-selected={on}
      aria-controls={panelOf(item)}
      aria-label={label}
      title={expanded ? undefined : label}
      tabIndex={on ? 0 : -1}
      onClick={onPick}
      onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); onStep(1); }
        if (e.key === 'ArrowUp') { e.preventDefault(); onStep(-1); }
      }}
      className={`relative h-10 rounded-[10px] border flex items-center transition-colors ${expanded ? 'w-full gap-3 px-2.5 text-sm font-medium' : 'w-10 justify-center'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
        on ? 'border-gold bg-gold/10 text-gold' : 'border-transparent text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
      }`}
    >
      {on && <span className="absolute -start-[9px] top-2 bottom-2 w-[3px] rounded-full bg-gold" aria-hidden="true" />}
      <Icon className="w-5 h-5 shrink-0" />
      {expanded && <span className="truncate">{label}</span>}
      {toCheck > 0 && (
        <span className={`${expanded ? 'ms-auto' : 'absolute -top-1 -end-1'} min-w-4 h-4 px-1 rounded-full bg-gold text-ink text-[10px] font-bold flex items-center justify-center`} title={toCheckLabel}>
          {toCheck}
          <span className="sr-only"> — {toCheckLabel}</span>
        </span>
      )}
    </button>
  );
};
