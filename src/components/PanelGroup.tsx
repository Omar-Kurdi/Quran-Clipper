'use client';

import React, { useEffect, useRef, useState } from 'react';

/** One named group of settings inside a panel, which `GroupNav` can jump to. */
export const PanelGroup: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section id={`group-${id}`} data-group={id} className="scroll-mt-28 flex flex-col gap-2">
    <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</h4>
    {children}
  </section>
);

/** The nearest ancestor that scrolls: the panel, whose top the sticky bars hold to. */
export function scrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
  }
  return null;
}

/** The panel's head is 48px tall and sticky; a group counts as reached once it passes under it. */
const HEAD = 48;

/**
 * The groups of a long panel as a row of chips held at its top: one press
 * jumps to a group, and the chip of the group being read is lit, so a panel
 * of twenty settings reads as five short ones.
 */
export const GroupNav: React.FC<{ items: { id: string; label: string }[] }> = ({ items }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(items[0]?.id);
  // The groups by name, so a re-render of the panel -- a setting changed, a
  // note appearing under it -- does not re-read the position and drop the
  // chip being read for the one above it; only scrolling does.
  const ids = items.map(item => item.id).join(' ');
  useEffect(() => {
    const groups = ids.split(' ');
    const root = scrollParent(ref.current);
    if (!root) return;
    const onScroll = () => {
      const top = root.getBoundingClientRect().top + HEAD + 56;
      let current = groups[0];
      for (const id of groups) {
        const el = root.querySelector(`[data-group="${id}"]`);
        if (el && el.getBoundingClientRect().top <= top) current = id;
      }
      // The last group may be too short to reach the top: at the bottom, it is the one being read.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) current = groups[groups.length - 1];
      setActive(current);
    };
    onScroll();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [ids]);
  return (
    <div ref={ref} className="sticky top-12 z-20 -mx-4 -mt-4 mb-1 px-3 py-2 flex gap-1 overflow-x-auto bg-slate-900/95 backdrop-blur-sm border-b border-slate-800">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          aria-current={active === item.id ? 'true' : undefined}
          onClick={() => document.getElementById(`group-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className={`shrink-0 px-2 py-1 rounded-full border text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
            active === item.id ? 'border-gold bg-gold/10 text-gold' : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};
