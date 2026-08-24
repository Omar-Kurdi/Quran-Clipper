'use client';

import React from 'react';

export type StatusTone = 'live' | 'success' | 'warning' | 'error' | 'neutral';

/**
 * A state pill.
 *
 * Semantic colour is separate from the accent: "playing" and "matched well"
 * are different facts and should not both borrow whatever hue the theme
 * happens to use for emphasis. Tones map to the palette's live/success/error
 * variables, so they follow a theme change without being restyled.
 */
const TONES: Record<StatusTone, string> = {
  live: 'bg-blue-500/20 text-blue-400',
  success: 'bg-emerald-500/20 text-emerald-300',
  warning: 'bg-amber-500/20 text-amber-300',
  error: 'bg-red-500/20 text-red-300',
  neutral: 'bg-slate-800 text-slate-300'
};

export const Status: React.FC<{
  tone?: StatusTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ tone = 'neutral', icon, children, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${TONES[tone]} ${className}`}
  >
    {icon}
    {children}
  </span>
);
