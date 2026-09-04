'use client';

import React, { useEffect, useState } from 'react';
import type { HealthReport, ServiceState } from '@/app/api/health/route';
import { useT } from './LocaleProvider';

/** Slow: nothing here changes minute to minute, and a dead sidecar is a 2s probe. */
const POLL_MS = 30_000;

const TONE: Record<ServiceState | 'unknown', string> = {
  up: 'bg-emerald-400',
  down: 'bg-red-400',
  not_configured: 'bg-slate-500',
  unknown: 'bg-slate-600 animate-pulse',
};

/**
 * Whether the database and the alignment sidecar are up, in the header.
 *
 * The studio is three processes -- this app, a Postgres container and a Python
 * sidecar -- each logging into its own terminal, and the app used to report on
 * none of them. Working out whether the database had come up meant reading
 * `start.sh`'s output again, and whether the model had loaded meant uploading a
 * file and waiting for the failure.
 *
 * Deliberately not an alarm. Neither service is required: without a database
 * the app saves to memory, without the sidecar it matches with Gemini. Grey
 * means "not set up", which is a legitimate way to run this, and only red means
 * something that was supposed to work does not.
 */
export const HealthStrip: React.FC = () => {
  const t = useT();
  const [report, setReport] = useState<HealthReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const body = (await res.json()) as HealthReport;
        if (!cancelled) setReport(body);
      } catch {
        // The app itself is unreachable, which the user can see without help.
        if (!cancelled) setReport(null);
      }
    };
    check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const dot = (state: ServiceState | 'unknown', label: string, detail?: string) => (
    <span className="flex items-center gap-1.5" title={detail || label}>
      <span className={`h-1.5 w-1.5 rounded-full ${TONE[state]}`} />
      <span className="text-[11px] text-slate-400">{label}</span>
    </span>
  );

  // The sidecar being reachable is not the same as it being able to align:
  // its backend can fail to load and leave the process answering /health
  // perfectly well. That case is what the amber state is for.
  const alignerState: ServiceState = !report
    ? 'not_configured'
    : report.aligner.state === 'up' && report.aligner.ready === false
      ? 'down'
      : report.aligner.state;

  return (
    <div className="hidden xl:flex items-center gap-3 ms-3 ps-4 border-s border-slate-800">
      {dot(
        report ? report.database.state : 'unknown',
        t.header.healthDatabase,
        report?.database.detail
      )}
      {dot(
        report ? alignerState : 'unknown',
        t.header.healthAligner,
        report?.aligner.detail || report?.aligner.model
      )}
    </div>
  );
};
