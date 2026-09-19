'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from './LocaleProvider';

export interface TourStep {
  /** A `data-tour` value on the element this step points at. */
  target: string;
  /**
   * On a phone, the `data-tour` value of the bottom tab that shows `target`.
   * There the target is a whole surface filling the screen, so spotlighting it
   * picked out nothing; the tab is what someone new needs to find again.
   */
  tab?: string;
  title: string;
  body: string;
  /** Said instead of `body` in the phone layout, where the keyboard and the three columns it describes are not there. */
  compactBody?: string;
}

interface OnboardingTourProps {
  steps: TourStep[];
  isOpen: boolean;
  /** Finished or skipped -- both mean "do not show this again on its own". */
  onClose: () => void;
  /**
   * Called before a step is shown, so the page can bring its target into
   * view: on a phone only one surface is on screen at a time, and a step
   * pointing at a hidden panel would point at nothing.
   */
  onStep?: (index: number) => void;
}

/** The studio's phone layout: one surface at a time, switched by the bottom tabs. Below Tailwind's `lg`. */
const COMPACT_LAYOUT = '(max-width: 1023.98px)';

/** Room around the highlighted element, so its border is not flush with the cut-out. */
const HALO = 6;
/** The card's width; it is placed beside the target when that fits, below or above otherwise. */
const CARD_WIDTH = 320;

type Rect = { top: number; left: number; width: number; height: number };

/**
 * The first-visit walkthrough: three steps, each pointing at the part of the
 * studio it describes.
 *
 * A spotlight rather than a modal over everything. The page stays visible and
 * the step's own panel is cut out of the dimming, so "choose a reciter here"
 * is said while the reciter list is in plain sight. Nothing behind it can be
 * clicked while it is open -- a tour that can be half-followed leaves the
 * studio in a state its next step does not describe.
 *
 * Keyboard: focus moves to the card, Tab stays inside it, the arrow keys step,
 * Escape skips. It renders through a portal for the same reason `Dialog`
 * does: the studio's columns establish containing blocks.
 */
export const OnboardingTour: React.FC<OnboardingTourProps> = ({ steps, isOpen, onClose, onStep }) => {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const targetRect = useTargetRect(isOpen ? step?.target : undefined);
  // The tabs are only laid out below `lg`, so this measures nothing on a wide screen.
  const tabRect = useTargetRect(isOpen ? step?.tab : undefined);
  const rect = tabRect ?? targetRect;

  useEffect(() => {
    if (isOpen) onStep?.(index);
    // `onStep` is the page's and changes identity every render; the step is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, index]);

  /** Closing starts the next opening from the first step. */
  const finish = () => {
    setIndex(0);
    onClose();
  };
  const last = index === steps.length - 1;
  const next = () => (last ? finish() : setIndex(i => i + 1));
  const back = () => setIndex(i => Math.max(0, i - 1));

  if (!isOpen || !step || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[80]" onKeyDown={tourKeys({ finish, next, back })}>
      <Spotlight rect={rect} onTab={Boolean(tabRect)} />
      <TourCard
        rect={rect}
        docked={Boolean(tabRect)}
        step={step}
        index={index}
        total={steps.length}
        onSkip={finish}
        onBack={index > 0 ? back : undefined}
        onNext={next}
      />
    </div>,
    document.body
  );
};

/** Where the element tagged `data-tour={target}` is now, re-read as the page moves under it. */
function useTargetRect(target: string | undefined): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  const measure = useCallback(() => {
    const element = target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null;
    const box = element?.getBoundingClientRect();
    setRect(box && box.width > 0 ? { top: box.top, left: box.left, width: box.width, height: box.height } : null);
  }, [target]);

  useLayoutEffect(() => {
    if (!target) return;
    // The page's surface switch for this step lands on the next frame.
    const frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [target, measure]);
  return rect;
}

/** Escape skips, the arrows step in reading order, and Tab stays inside the card. */
function tourKeys(actions: { finish: () => void; next: () => void; back: () => void }) {
  return (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      actions.finish();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      // Reading order is right-to-left in Arabic, so "forward" follows the page.
      const forward = (event.key === 'ArrowRight') !== (document.documentElement.dir === 'rtl');
      event.preventDefault();
      if (forward) actions.next();
      else actions.back();
    } else if (event.key === 'Tab') {
      trapFocus(event, (event.currentTarget as HTMLElement).querySelector<HTMLElement>('[role="dialog"]'));
    }
  };
}

/**
 * The dimming, with the target cut out of it by an outsized shadow. Lighter
 * when the target is a tab, so the surface it opens stays readable above it.
 */
function Spotlight({ rect, onTab }: { rect: Rect | null; onTab: boolean }) {
  if (!rect) return <div aria-hidden className="absolute inset-0 bg-slate-950/72" />;
  return (
    <div
      aria-hidden
      className="absolute rounded-xl ring-2 ring-amber-400/80 transition-all duration-200 pointer-events-none"
      style={{
        top: rect.top - HALO,
        left: rect.left - HALO,
        width: rect.width + HALO * 2,
        height: rect.height + HALO * 2,
        boxShadow: `0 0 0 9999px rgba(2, 6, 23, ${onTab ? 0.4 : 0.72})`
      }}
    />
  );
}

function TourCard({
  rect, docked, step, index, total, onSkip, onBack, onNext
}: {
  rect: Rect | null;
  /** Pointing at a bottom tab: sit just above the tab bar, full width. */
  docked: boolean;
  step: TourStep;
  index: number;
  total: number;
  onSkip: () => void;
  onBack?: () => void;
  onNext: () => void;
}) {
  const t = useT();
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    primaryRef.current?.focus();
  }, [index]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
      className="absolute rounded-xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl p-4"
      style={{ width: CARD_WIDTH, ...(docked && rect ? dockedPosition(rect) : cardPosition(rect)) }}
    >
      <p className="text-[11px] font-mono text-amber-400">{t.tour.progress(index + 1, total)}</p>
      <h2 id="tour-title" className="mt-1 text-sm font-bold">{step.title}</h2>
      <p id="tour-body" className="mt-1.5 text-xs text-slate-300 leading-relaxed">{stepBody(step)}</p>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={onSkip} className="me-auto text-[11px] text-slate-400 hover:text-slate-200 px-1 py-1">
          {t.tour.skip}
        </button>
        {onBack && (
          <button onClick={onBack} className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-200 hover:bg-slate-800">
            {t.tour.back}
          </button>
        )}
        <button
          ref={primaryRef}
          onClick={onNext}
          className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold"
        >
          {index === total - 1 ? t.tour.done : t.tour.next}
        </button>
      </div>
    </div>
  );
}

/** Keeps Tab and Shift+Tab cycling inside `container`. */
function trapFocus(event: React.KeyboardEvent, container: HTMLElement | null) {
  const focusable = container ? [...container.querySelectorAll<HTMLElement>('button')] : [];
  if (!focusable.length) return;
  const first = focusable[0];
  const final = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    final.focus();
  } else if (!event.shiftKey && document.activeElement === final) {
    event.preventDefault();
    first.focus();
  }
}

/** What the step says here: its phone wording, where it has one and this is the phone layout. */
function stepBody(step: TourStep): string {
  return step.compactBody && window.matchMedia(COMPACT_LAYOUT).matches ? step.compactBody : step.body;
}

/** Just above the bottom tab bar, across the screen, so the surface above the card stays in view. */
function dockedPosition(rect: Rect): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return { bottom: vh - rect.top + HALO + 10, left: 12, width: vw - 24 };
}

/**
 * Beside the target if the viewport has room, else below it, else above it,
 * else centred. Always clamped inside the viewport with a 12px margin.
 */
function cardPosition(rect: Rect | null): React.CSSProperties {
  const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 768 : window.innerHeight;
  const width = Math.min(CARD_WIDTH, vw - 24);
  const clampLeft = (x: number) => Math.max(12, Math.min(x, vw - width - 12));
  const clampTop = (y: number) => Math.max(12, Math.min(y, vh - 200));
  if (!rect) return { top: clampTop(vh / 2 - 100), left: clampLeft(vw / 2 - width / 2), width };

  const gap = HALO + 12;
  if (rect.left + rect.width + gap + width < vw) {
    return { top: clampTop(rect.top), left: rect.left + rect.width + gap, width };
  }
  if (rect.left - gap - width > 0) {
    return { top: clampTop(rect.top), left: rect.left - gap - width, width };
  }
  if (rect.top + rect.height + gap + 180 < vh) {
    return { top: rect.top + rect.height + gap, left: clampLeft(rect.left), width };
  }
  return { top: clampTop(rect.top - gap - 190), left: clampLeft(rect.left), width };
}
