/**
 * What a match under way has done and has left, for the progress card: its
 * steps, each done, under way or still to come, and how far along it is in
 * all, 0 to 1.
 *
 * Only what is known is said. The aligner reports its stage while it works
 * (`/progress` in the sidecar, through the queue's ticket), and while it reads
 * the recitation phrase by phrase, how many of how many; a long recording's
 * parts are counted as they finish. Where nothing more is known -- a word
 * being timed, which the aligner does in one go -- the share holds where that
 * step began rather than creeping on by guesswork.
 */

/** The aligner's stage for one match, as `/progress` gives it. */
export interface AlignerProgress {
  stage: string | null;
  done: number | null;
  total: number | null;
}

/** Where a match has got to, from what the studio knows. */
export interface MatchRun {
  /**
   * An upload matched whole; a long recording, read on the server and then
   * mapped a part at a time; or a shorter one mapped in parts in the browser,
   * with nothing read on the server first.
   */
  flow: 'upload' | 'long' | 'parts';
  /**
   * `reading`: the upload being measured and looked up in Projects.
   * `longRead`: a long one being read whole on the server.
   * `matching`: being matched -- a long one's parts, one after another.
   */
  phase: 'reading' | 'longRead' | 'matching';
  /** Whether a file was uploaded, so reading it is a step; a reciter's recording is not. */
  file?: boolean;
  /** A long recording's parts: how many are matched, of how many. */
  parts?: { done: number; total: number };
  /** Its place in the queue while it waits for the aligner: 1 is next. */
  queue?: { position: number; wait: string | null } | null;
  /** Where the aligner has got to with it, when it has said. */
  aligner?: AlignerProgress | null;
}

export type StepId = 'read' | 'queue' | 'listen' | 'find' | 'align' | 'retime' | 'longRead' | 'split' | 'parts';
export type StepState = 'done' | 'current' | 'pending';

export interface Step {
  id: StepId;
  state: StepState;
  /** How many of how many: phrases heard, parts split into or matched. */
  count?: { done: number; total: number };
  /** For `queue`: its place, and roughly how long. */
  position?: number;
  wait?: string | null;
}

export interface MatchView {
  steps: Step[];
  /** How far along in all, 0 to 1. */
  fraction: number;
  /** For a long recording's part under way: the step its match is at. */
  inner: Step | null;
}

/** One match's own steps, from the aligner's stage: what it has heard, found and timed. */
const ALIGN_STEPS: StepId[] = ['listen', 'find', 'align', 'retime'];

/**
 * How far through one match the aligner is, 0 to 1, by its stage: where each
 * stage starts, as measured on a four- and a fourteen-minute recording
 * (2026-11-22). Reading the file and hearing each phrase took 4-7% of the
 * time, timing the words 57-70%, re-timing their starts the rest. Timing the
 * words opens with one pass of a phoneme model -- about a quarter of the
 * whole, uncounted, so the share holds there -- and then places the phrases
 * one by one, which is counted.
 */
function alignerShare(aligner: AlignerProgress | null | undefined): number {
  switch (aligner?.stage) {
    case 'reading': return 0.005;
    case 'pauses': return 0.01;
    case 'listening': {
      const share = aligner.total ? Math.min(1, (aligner.done ?? 0) / aligner.total) : 0;
      return 0.02 + 0.04 * share;
    }
    case 'finding': return 0.06;
    case 'aligning': {
      if (!aligner.total) return 0.08;
      return 0.32 + 0.42 * Math.min(1, (aligner.done ?? 0) / aligner.total);
    }
    case 'retiming': return 0.76;
    default: return 0;
  }
}

/** Which of a match's own steps is under way, by the aligner's stage. */
function alignerStep(aligner: AlignerProgress | null | undefined): StepId {
  if (aligner?.stage === 'finding') return 'find';
  if (aligner?.stage === 'aligning') return 'align';
  if (aligner?.stage === 'retiming') return 'retime';
  return 'listen';
}

/** A match's own steps, the one under way marked, before it nothing and after it all to come. */
function alignSteps(run: MatchRun, started: boolean): Step[] {
  const current = alignerStep(run.aligner);
  const at = ALIGN_STEPS.indexOf(current);
  return ALIGN_STEPS.map((id, i) => {
    const state: StepState = !started || i > at ? 'pending' : i < at ? 'done' : 'current';
    // The phrase being heard, or placed, counted from one.
    const count = state === 'current' && (id === 'listen' || id === 'align') && run.aligner?.total
      ? { done: Math.min(run.aligner.total, (run.aligner.done ?? 0) + 1), total: run.aligner.total } : undefined;
    return count ? { id, state, count } : { id, state };
  });
}

/** The queue's step, while it waits its turn: none once it has had it. */
function queueStep(run: MatchRun): Step[] {
  return run.queue && run.queue.position > 0
    ? [{ id: 'queue', state: 'current', position: run.queue.position, wait: run.queue.wait }] : [];
}

/** Whether it is waiting its turn for the aligner. */
const isWaiting = (run: MatchRun) => !!run.queue && run.queue.position > 0;

/** An upload matched whole: read, its turn waited for, then heard, found and timed. */
function uploadView(run: MatchRun, read: Step[]): MatchView {
  const matching = run.phase === 'matching';
  const waiting = isWaiting(run);
  const steps = [...read, ...(matching ? queueStep(run) : []), ...alignSteps(run, matching && !waiting)];
  const fraction = !matching ? 0.02 : 0.05 + 0.95 * (waiting ? 0 : alignerShare(run.aligner));
  return { steps, fraction, inner: null };
}

/** The step the part under way is at: waiting its turn, or the aligner's stage once it has said. */
function partInner(run: MatchRun): Step | null {
  if (isWaiting(run)) return queueStep(run)[0];
  return run.aligner?.stage ? alignSteps(run, true).find(step => step.state === 'current') ?? null : null;
}

/** A long recording's own steps: read whole, split, and its parts matched -- counted once they are known. */
function longSteps(run: MatchRun, parts: MatchRun['parts']): Step[] {
  const read: Step[] = run.flow === 'parts' ? [] : [{ id: 'longRead', state: run.phase === 'reading' ? 'pending' : run.phase === 'longRead' ? 'current' : 'done' }];
  if (parts) {
    return [
      ...read,
      { id: 'split', state: 'done', count: { done: parts.total, total: parts.total } },
      { id: 'parts', state: 'current', count: { done: Math.min(parts.total, parts.done + 1), total: parts.total } },
    ];
  }
  return [...read, { id: 'split', state: run.phase === 'matching' ? 'current' : 'pending' }, { id: 'parts', state: 'pending' }];
}

/** A recording matched in parts: read whole on the server when it is long, split, and the parts matched in turn. */
function longView(run: MatchRun, read: Step[]): MatchView {
  const parts = run.phase === 'matching' ? run.parts : undefined;
  const steps = [...read, ...longSteps(run, parts)];
  if (run.phase !== 'matching') return { steps, fraction: run.phase === 'reading' ? 0.01 : 0.03, inner: null };
  if (!parts || !parts.total) return { steps, fraction: 0.1, inner: null };
  const share = isWaiting(run) ? 0 : alignerShare(run.aligner);
  return { steps, fraction: 0.1 + 0.9 * Math.min(1, (parts.done + share) / parts.total), inner: partInner(run) };
}

export function matchView(run: MatchRun): MatchView {
  const read: Step[] = run.file === false ? [] : [{ id: 'read', state: run.phase === 'reading' ? 'current' : 'done' }];
  return run.flow === 'upload' ? uploadView(run, read) : longView(run, read);
}
