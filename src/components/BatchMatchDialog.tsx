'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle, FolderOpen, Layers, Loader2, Play, Save, Square, Upload, X, AlertTriangle } from 'lucide-react';
import { Dialog } from './Dialog';
import { useT } from './LocaleProvider';
import {
  addBatchFiles, matchFile, nextBatchItem, updateBatchItem,
  type BatchItem, type BatchResult
} from '@/lib/batchMatch';

interface BatchMatchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The local matcher the batch runs through, as `/api/audio/match` names it. */
  provider: string;
  /** Its name as the studio shows it. */
  providerLabel: string;
  /** Whether that matcher can run now; the batch cannot start otherwise. */
  providerReady: boolean;
  /** The recording's length, read the same way a single upload's is. */
  measureDuration: (file: File) => Promise<number>;
  /** Loads one result into the studio, closing the dialog. */
  onOpen: (file: File, result: BatchResult) => void;
  /** Saves one result as a project with the studio's current look. Resolves to whether it saved. */
  onSave: (file: File, result: BatchResult) => Promise<boolean>;
}

const ACCEPT = 'audio/*,video/*,.mp3,.wav,.m4a,.ogg,.opus,.webm,.flac,.mp4,.mov,.mkv';

/**
 * Runs the list: one file at a time, in order, until it is done or stopped.
 *
 * Timers rather than animation frames, which stop in a background tab -- and
 * a batch is exactly what someone leaves running there.
 */
function useBatchRunner(provider: string, measureDuration: (file: File) => Promise<number>, failedText: string) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  useEffect(() => {
    if (!running || items.some(item => item.status === 'matching')) return;
    const item = nextBatchItem(items);
    const timer = window.setTimeout(() => {
      if (!item || stopRef.current) {
        setRunning(false);
        return;
      }
      setItems(current => updateBatchItem(current, item.id, { status: 'matching' }));
      measureDuration(item.file)
        .then(duration => matchFile(item.file, provider, duration, failedText))
        .then(result => setItems(current => updateBatchItem(current, item.id, { status: 'done', result })))
        .catch((err: Error) => setItems(current => updateBatchItem(current, item.id, { status: 'failed', error: err.message })));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [running, items, provider, measureDuration, failedText]);

  return {
    items,
    setItems,
    running,
    start: () => {
      stopRef.current = false;
      // Failed files are tried again: the usual cause is a helper that was not running.
      setItems(current => current.map(item => (item.status === 'failed' ? { ...item, status: 'waiting', error: undefined } : item)));
      setRunning(true);
    },
    stop: () => {
      stopRef.current = true;
    }
  };
}

/**
 * Match a folder of recitations, then open or save each.
 *
 * Only the local matchers. Gemini is told which passage to look for, and a
 * batch has no one to tell it; the aligner finds the passage in each file
 * itself, which is the whole point of handing it ten at once.
 */
export const BatchMatchDialog: React.FC<BatchMatchDialogProps> = ({
  isOpen, onClose, provider, providerLabel, providerReady, measureDuration, onOpen, onSave
}) => {
  const t = useT();
  const batch = useBatchRunner(provider, measureDuration, t.match.failed);
  const { items, setItems, running } = batch;

  // All at once: each save stores its own recording under its own key.
  const saveAll = async () => {
    const unsaved = items.filter(item => item.status === 'done' && item.result && !item.saved);
    const saved = await Promise.all(unsaved.map(item => onSave(item.file, item.result!)));
    const ids = new Set(unsaved.filter((_, i) => saved[i]).map(item => item.id));
    setItems(current => current.map(item => (ids.has(item.id) ? { ...item, saved: true } : item)));
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      label={t.batch.title}
      panelClassName="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl"
    >
      <BatchHeader help={t.batch.help(providerLabel)} onClose={onClose} />
      <FilePicker disabled={running} onFiles={files => setItems(current => addBatchFiles(current, files))} />
      {items.length > 0 && (
        <ol className="mt-3 flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {items.map(item => (
            <BatchRow
              key={item.id}
              item={item}
              running={running}
              onOpen={() => item.result && onOpen(item.file, item.result)}
              onRemove={() => setItems(current => current.filter(other => other.id !== item.id))}
            />
          ))}
        </ol>
      )}
      {!providerReady && <p className="mt-2 text-[11px] text-amber-300/90">{t.batch.notReady}</p>}
      {running && <p className="mt-2 text-[11px] text-amber-300/90">{t.batch.keepOpen}</p>}
      <BatchFooter items={items} running={running} ready={providerReady} onStart={batch.start} onStop={batch.stop} onSaveAll={() => void saveAll()} />
    </Dialog>
  );
};

function BatchHeader({ help, onClose }: { help: string; onClose: () => void }) {
  const t = useT();
  return (
    <>
      <div className="flex items-center gap-2">
        <Layers className="w-5 h-5 text-amber-400" />
        <h2 className="flex-1 text-sm font-bold text-slate-100">{t.batch.title}</h2>
        <button onClick={onClose} aria-label={t.common.close} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{help}</p>
    </>
  );
}

function FilePicker({ disabled, onFiles }: { disabled: boolean; onFiles: (files: File[]) => void }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={e => {
          const files = [...(e.target.files || [])];
          e.target.value = '';
          onFiles(files);
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-700 py-3 text-xs text-slate-300 hover:border-amber-500/60 disabled:opacity-50"
      >
        <Upload className="w-4 h-4" />
        {t.batch.choose}
      </button>
    </>
  );
}

function BatchFooter({
  items, running, ready, onStart, onStop, onSaveAll
}: { items: BatchItem[]; running: boolean; ready: boolean; onStart: () => void; onStop: () => void; onSaveAll: () => void }) {
  const t = useT();
  const waiting = items.filter(item => item.status === 'waiting' || item.status === 'failed').length;
  const unsaved = items.some(item => item.status === 'done' && !item.saved);
  return (
    <div className="mt-3 flex gap-2">
      {running ? (
        <button onClick={onStop} className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-red-500/40 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10">
          <Square className="w-3.5 h-3.5" />
          {t.batch.stop}
        </button>
      ) : (
        <button
          onClick={onStart}
          disabled={!waiting || !ready}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5" />
          {t.batch.start(waiting)}
        </button>
      )}
      <button
        onClick={onSaveAll}
        disabled={running || !unsaved}
        className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
      >
        <Save className="w-3.5 h-3.5" />
        {t.batch.saveAll}
      </button>
    </div>
  );
}

function StatusIcon({ status }: { status: BatchItem['status'] }) {
  if (status === 'matching') return <Loader2 className="w-3.5 h-3.5 shrink-0 text-amber-400 animate-spin" />;
  if (status === 'done') return <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-400" />;
  if (status === 'failed') return <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-400" />;
  return <span className="w-3.5 h-3.5 shrink-0 rounded-full border border-slate-600" />;
}

function BatchRow({
  item, running, onOpen, onRemove
}: { item: BatchItem; running: boolean; onOpen: () => void; onRemove: () => void }) {
  const t = useT();
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-[11px]">
      <div className="flex items-center gap-2">
        <StatusIcon status={item.status} />
        <span className="flex-1 min-w-0">
          <span className="block truncate text-slate-200">{item.file.name}</span>
          {item.result && (
            <span className="block truncate text-slate-400">
              {t.batch.found(item.result.title, item.result.verses.length)}
              {item.saved ? ` · ${t.batch.saved}` : ''}
            </span>
          )}
          {item.error && <span className="block truncate text-red-300" title={item.error}>{item.error}</span>}
        </span>
        {item.result && (
          <button onClick={onOpen} className="flex items-center gap-1 rounded-md bg-slate-800 px-1.5 py-0.5 text-slate-100 hover:bg-slate-700">
            <FolderOpen className="w-3 h-3" />
            {t.batch.open}
          </button>
        )}
        {!running && item.status !== 'matching' && (
          <button onClick={onRemove} aria-label={t.batch.remove} className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </li>
  );
}
