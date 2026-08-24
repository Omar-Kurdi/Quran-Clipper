'use client';

import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Rendered before the label. Icon-only buttons must still pass aria-label. */
  icon?: React.ReactNode;
  /** Hides the label below `sm`, keeping the icon. For crowded toolbars. */
  labelFrom?: 'sm' | 'md' | 'lg';
}

/**
 * The studio's button.
 *
 * There were 53 distinct button class strings across six files for what is
 * really four kinds of button in two sizes. That sprawl is the main reason
 * unrelated parts of the interface stopped looking related -- padding, radius
 * and hover treatment all drifted independently.
 *
 * Focus is visible on every variant. Radius comes from the shared control
 * token rather than whichever `rounded-*` the call site happened to pick.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gold hover:bg-gold-bright text-ink font-semibold shadow-[0_2px_12px_-2px_rgba(0,0,0,0.45)] active:scale-[0.98]',
  secondary:
    'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold',
  ghost: 'text-slate-300 hover:text-slate-100 hover:bg-slate-800 font-medium',
  danger: 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 font-semibold'
};

const SIZES: Record<Size, string> = {
  sm: 'text-[11px] px-2.5 py-1.5 gap-1.5',
  md: 'text-xs px-3.5 py-2 gap-2'
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'sm',
  icon,
  labelFrom,
  className = '',
  children,
  ...rest
}) => (
  <button
    {...rest}
    className={`inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
  >
    {icon}
    {children != null && (
      <span className={labelFrom ? `hidden ${labelFrom}:inline` : undefined}>{children}</span>
    )}
  </button>
);
