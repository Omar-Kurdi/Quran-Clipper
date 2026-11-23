import { describe, expect, it } from 'vitest';
import { matchView, type MatchRun } from './matchSteps';

const states = (run: MatchRun) => matchView(run).steps.map(step => `${step.id}:${step.state}`);

describe('matchView for an upload', () => {
  it('starts on reading the file, everything else to come', () => {
    expect(states({ flow: 'upload', phase: 'reading', file: true }))
      .toEqual(['read:current', 'listen:pending', 'find:pending', 'align:pending', 'retime:pending']);
  });

  it('shows its place in the queue while it waits, and nothing heard yet', () => {
    const view = matchView({ flow: 'upload', phase: 'matching', file: true, queue: { position: 2, wait: '1 min' } });
    expect(view.steps.map(step => `${step.id}:${step.state}`)).toEqual(['read:done', 'queue:current', 'listen:pending', 'find:pending', 'align:pending', 'retime:pending']);
    expect(view.steps[1]).toMatchObject({ position: 2, wait: '1 min' });
  });

  it('counts the phrases heard, and moves on as the aligner does', () => {
    const listening = matchView({ flow: 'upload', phase: 'matching', file: true, aligner: { stage: 'listening', done: 10, total: 40 } });
    expect(listening.steps.find(step => step.id === 'listen')).toEqual({ id: 'listen', state: 'current', count: { done: 11, total: 40 } });
    expect(states({ flow: 'upload', phase: 'matching', file: true, aligner: { stage: 'aligning', done: null, total: null } }))
      .toEqual(['read:done', 'listen:done', 'find:done', 'align:current', 'retime:pending']);
    const placing = matchView({ flow: 'upload', phase: 'matching', file: true, aligner: { stage: 'aligning', done: 79, total: 161 } });
    expect(placing.steps.find(step => step.id === 'align')).toEqual({ id: 'align', state: 'current', count: { done: 80, total: 161 } });
    expect(states({ flow: 'upload', phase: 'matching', file: true, aligner: { stage: 'retiming', done: null, total: null } }).slice(-2))
      .toEqual(['align:done', 'retime:current']);
  });

  it('only ever moves forward through the stages', () => {
    const stages = [
      { stage: 'reading', done: null, total: null },
      { stage: 'listening', done: 0, total: 20 },
      { stage: 'listening', done: 19, total: 20 },
      { stage: 'finding', done: null, total: null },
      { stage: 'aligning', done: null, total: null },
      { stage: 'aligning', done: 0, total: 50 },
      { stage: 'aligning', done: 49, total: 50 },
      { stage: 'retiming', done: null, total: null },
    ];
    const fractions = stages.map(aligner => matchView({ flow: 'upload', phase: 'matching', file: true, aligner }).fraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.every(f => f > 0 && f < 1)).toBe(true);
  });

  it('has no reading step for a reciter’s recording', () => {
    expect(states({ flow: 'upload', phase: 'matching', file: false })[0]).toBe('listen:current');
  });
});

describe('matchView for a long recording', () => {
  it('reads it whole, then splits it into parts and matches them in turn', () => {
    expect(states({ flow: 'long', phase: 'longRead', file: true }))
      .toEqual(['read:done', 'longRead:current', 'split:pending', 'parts:pending']);
    const view = matchView({ flow: 'long', phase: 'matching', file: true, parts: { done: 1, total: 5 }, aligner: { stage: 'finding', done: null, total: null } });
    expect(view.steps.map(step => `${step.id}:${step.state}`)).toEqual(['read:done', 'longRead:done', 'split:done', 'parts:current']);
    expect(view.steps[2].count).toEqual({ done: 5, total: 5 });
    expect(view.steps[3].count).toEqual({ done: 2, total: 5 });
    expect(view.inner).toEqual({ id: 'find', state: 'current' });
  });

  it('is as far along as its parts are, and the part under way', () => {
    const at = (done: number, stage: string | null) =>
      matchView({ flow: 'long', phase: 'matching', parts: { done, total: 4 }, aligner: { stage, done: null, total: null } }).fraction;
    expect(at(0, null)).toBeCloseTo(0.1);
    expect(at(2, null)).toBeCloseTo(0.55);
    expect(at(2, 'aligning')).toBeGreaterThan(at(2, 'finding'));
    expect(at(3, 'aligning')).toBeLessThan(1);
  });
});

describe('matchView for a recording matched in parts in the browser', () => {
  it('has no server read: split, then the parts in turn', () => {
    expect(states({ flow: 'parts', phase: 'matching', file: true })).toEqual(['read:done', 'split:current', 'parts:pending']);
    const view = matchView({ flow: 'parts', phase: 'matching', file: true, parts: { done: 0, total: 3 }, aligner: { stage: 'listening', done: 2, total: 9 } });
    expect(view.steps.map(step => `${step.id}:${step.state}`)).toEqual(['read:done', 'split:done', 'parts:current']);
    expect(view.steps[2].count).toEqual({ done: 1, total: 3 });
  });
});
