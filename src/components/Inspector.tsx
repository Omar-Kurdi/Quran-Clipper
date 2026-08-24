'use client';

import React from 'react';
import { Trash2, Copy, Plus, ChevronUp, ChevronDown, Eye, EyeOff, Minus, PlusCircle } from 'lucide-react';
import { VerseData } from '@/lib/quranData';
import { ensureWords, formatTime } from '@/lib/verseEdits';
import { Button } from './Button';
import { Status } from './Status';

interface InspectorProps {
  verses: VerseData[];
  index: number;
  isActive: boolean;
  onText: (field: 'textUthmani' | 'transliteration' | 'translation', value: string) => void;
  onVerseNumber: (value: number) => void;
  onToggleWord: (wordIndex: number) => void;
  onNudge: (edge: 'startTime' | 'endTime', delta: number) => void;
  onReorder: (to: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAdd: () => void;
}

/**
 * Everything about the selected ayah that is not its position in time.
 *
 * These controls used to live inside 353px-tall cards stacked in the timeline
 * column, which is why the timeline could not also be a timeline. Position is
 * the timeline's job now; meaning, text and per-word visibility are this
 * panel's. Nothing was dropped in the move.
 */
export const Inspector: React.FC<InspectorProps> = ({
  verses, index, isActive,
  onText, onVerseNumber, onToggleWord, onNudge, onReorder, onDuplicate, onDelete, onAdd
}) => {
  const verse = verses[index];

  if (!verse) {
    return (
      <div className="p-4 text-center">
        <p className="text-[11px] text-slate-400">
          Select an ayah on the timeline to edit its text, translation and words.
        </p>
      </div>
    );
  }

  const words = ensureWords(verse);
  const duration = verse.endTime - verse.startTime;

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[11px] text-gold">{verse.verseKey}</span>
        {isActive && <Status tone="live">Playing</Status>}
        {typeof verse.matchConfidence === 'number' && (
          <Status tone={verse.matchConfidence >= 0.75 ? 'success' : 'warning'}>
            Match {Math.round(verse.matchConfidence * 100)}%
          </Status>
        )}
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-slate-400 tabular-nums">{formatTime(duration)}</span>
      </div>

      {/* Timing. Fine adjustment lives here; coarse adjustment is dragging the
          block on the timeline. Both write through the same functions. */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
          <span>Starts {formatTime(verse.startTime)}</span>
          <span>Ends {formatTime(verse.endTime)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['startTime', 'endTime'] as const).map(edge => (
            <div key={edge} className="flex items-center gap-1">
              <button
                onClick={() => onNudge(edge, -0.2)}
                aria-label={`Move ${edge === 'startTime' ? 'start' : 'end'} earlier`}
                className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-md text-slate-200 flex items-center justify-center"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-[10px] font-mono text-slate-400 w-10 text-center">
                {edge === 'startTime' ? 'start' : 'end'}
              </span>
              <button
                onClick={() => onNudge(edge, 0.2)}
                aria-label={`Move ${edge === 'startTime' ? 'start' : 'end'} later`}
                className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-md text-slate-200 flex items-center justify-center"
              >
                <PlusCircle className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="insp-ayah-number" className="text-[11px] font-semibold text-slate-400 block mb-1">
          Ayah number
        </label>
        <input
          id="insp-ayah-number"
          type="number"
          min={1}
          value={verse.verseNumber}
          onChange={e => onVerseNumber(parseInt(e.target.value, 10))}
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono"
        />
      </div>

      <div>
        <label htmlFor="insp-arabic" className="text-[11px] font-semibold text-slate-400 block mb-1">Arabic</label>
        <textarea
          id="insp-arabic"
          value={verse.displayTextUthmani || verse.textUthmani}
          onChange={e => onText('textUthmani', e.target.value)}
          dir="rtl"
          rows={2}
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-base text-parchment font-amiri leading-loose"
        />
      </div>

      <div>
        <label htmlFor="insp-translation" className="text-[11px] font-semibold text-slate-400 block mb-1">Translation</label>
        <textarea
          id="insp-translation"
          value={verse.displayTranslation || verse.translation}
          onChange={e => onText('translation', e.target.value)}
          rows={2}
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 leading-relaxed"
        />
      </div>

      <div>
        <span className="text-[11px] font-semibold text-slate-400 block mb-1">
          Words on screen
          <span className="block font-normal text-[11px] text-slate-400">Tap a word to hide it from the video.</span>
        </span>
        <div className="flex flex-wrap gap-1.5" dir="rtl">
          {words.map((word, wi) => (
            <button
              key={`${word.arabic}-${wi}`}
              onClick={() => onToggleWord(wi)}
              aria-pressed={!word.excluded}
              className={`flex items-center gap-1 px-2 py-1 rounded-md border font-amiri text-sm transition-colors ${
                word.excluded
                  ? 'bg-red-500/10 border-red-500/30 text-red-300 line-through'
                  : 'bg-slate-800 border-slate-700 text-parchment'
              }`}
            >
              {word.arabic}
              {word.excluded ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3 opacity-50" />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-800">
        <Button icon={<ChevronUp className="w-3.5 h-3.5" />} onClick={() => onReorder(index - 1)} disabled={index === 0} aria-label="Move ayah earlier" />
        <Button icon={<ChevronDown className="w-3.5 h-3.5" />} onClick={() => onReorder(index + 1)} disabled={index === verses.length - 1} aria-label="Move ayah later" />
        <Button icon={<Copy className="w-3.5 h-3.5" />} onClick={onDuplicate}>Duplicate</Button>
        <Button icon={<Plus className="w-3.5 h-3.5" />} onClick={onAdd}>Add</Button>
        <span className="flex-1" />
        <Button variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={onDelete} disabled={verses.length <= 1} aria-label="Delete ayah" />
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-800 pt-2">
        <strong className="text-slate-200">Before you publish:</strong> review every ayah, its timing
        and its translation yourself. You are responsible for what you publish.
      </p>
    </div>
  );
};
