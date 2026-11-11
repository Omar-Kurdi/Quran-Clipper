'use client';

import React from 'react';

/**
 * The top of the working panel beside the rail: what is open, and in a few
 * words what it is set to.
 */
export const PanelHead: React.FC<{ title: string; summary?: string; className?: string }> = ({ title, summary, className = '' }) => (
  <div className={`h-12 shrink-0 sticky top-0 z-10 flex items-center gap-3 px-4 border-b border-slate-800 bg-slate-900/95 backdrop-blur-sm ${className}`}>
    <h2 className="text-[15px] font-semibold text-slate-100">{title}</h2>
    {summary && <span className="flex-1 min-w-0 truncate text-end text-xs text-slate-400">{summary}</span>}
  </div>
);
