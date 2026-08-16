'use client';

import React, { useState } from 'react';
import { Play, Pause, Clock, Plus, Trash2, Mic, Zap, Edit3, Check, Eye, EyeOff, Minus, PlusCircle, Copy, GripVertical, ChevronUp, ChevronDown, HelpCircle } from 'lucide-react';
import { VerseData, SURAHS_LIST } from '@/lib/quranData';

interface TimelineSyncEditorProps {
  verses: VerseData[];
  onChangeVerses: (newVerses: VerseData[]) => void;
  currentTime: number;
  isPlaying: boolean;
  audioDuration: number;
  onSeek: (time: number) => void;
  onPlayPauseToggle: () => void;
}

export const TimelineSyncEditor: React.FC<TimelineSyncEditorProps> = ({
  verses,
  onChangeVerses,
  currentTime,
  isPlaying,
  audioDuration,
  onSeek,
  onPlayPauseToggle
}) => {
  const [activeSyncIndex, setActiveSyncIndex] = useState<number>(0);
  /**
   * Seconds as `12.4s` under a minute, `2:05.30` over it. Long recitations run
   * to ten minutes or more, where a raw seconds count stops being readable.
   */
  const formatTime = (seconds: number) => {
    const safe = Math.max(0, seconds);
    if (safe < 60) return `${safe.toFixed(1)}s`;
    const minutes = Math.floor(safe / 60);
    const rest = safe - minutes * 60;
    return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
  };

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [showTimingHelp, setShowTimingHelp] = useState(false);

  const handleTapToSyncMark = () => {
    if (activeSyncIndex >= verses.length) return;
    const updated = [...verses];
    const markTime = Math.round(currentTime * 10) / 10;
    // Guard: reject marks that would create a negative or zero duration segment
    if (markTime <= updated[activeSyncIndex].startTime) return;
    updated[activeSyncIndex].endTime = markTime;
    if (activeSyncIndex + 1 < updated.length) {
      updated[activeSyncIndex + 1].startTime = markTime;
      setActiveSyncIndex(activeSyncIndex + 1);
    }
    onChangeVerses(updated);
  };

  const handleTimeChange = (index: number, field: 'startTime' | 'endTime', value: number) => {
    const updated = [...verses];
    const val = Math.max(0, Math.round(value * 10) / 10);
    updated[index] = { ...updated[index], [field]: val };
    onChangeVerses(updated);
  };

  /**
   * Nudges one edge of a segment. Moving the end cascades through the
   * following segments so the timeline stays contiguous; moving the start only
   * trims this segment, since pushing everything earlier would fight whatever
   * the previous segment's end was deliberately set to.
   */
  const handleTimeNudge = (index: number, field: 'startTime' | 'endTime', delta: number) => {
    const updated = [...verses];
    const verse = updated[index];

    if (field === 'startTime') {
      const floor = index > 0 ? updated[index - 1].endTime : 0;
      const next = Math.round((verse.startTime + delta) * 10) / 10;
      updated[index] = { ...verse, startTime: Math.max(floor, Math.min(verse.endTime - 0.2, next)) };
      onChangeVerses(updated);
      return;
    }

    const newEnd = Math.max(
      verse.startTime + 0.2,
      Math.min(audioDuration || 9999, Math.round((verse.endTime + delta) * 10) / 10)
    );
    updated[index] = { ...verse, endTime: newEnd };
    for (let i = index + 1; i < updated.length; i++) {
      const prevEnd = updated[i - 1].endTime;
      const duration = Math.max(0.2, updated[i].endTime - updated[i].startTime);
      updated[i] = {
        ...updated[i],
        startTime: Math.round(prevEnd * 10) / 10,
        endTime: Math.round((prevEnd + duration) * 10) / 10
      };
    }
    onChangeVerses(updated);
  };

  /** Ctrl + wheel over a time control nudges it by 0.1s per tick. */
  const handleTimeWheel = (index: number, field: 'startTime' | 'endTime') => (event: React.WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    handleTimeNudge(index, field, event.deltaY < 0 ? 0.1 : -0.1);
  };

  /**
   * Reorders segments, then relays the timeline from the earliest start so the
   * new order is actually reflected in playback -- each segment keeps its own
   * duration but is re-seated back-to-back in the new sequence.
   */
  const handleReorder = (from: number, to: number) => {
    if (from === to || to < 0 || to >= verses.length) return;
    const updated = [...verses];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);

    let cursor = Math.min(...verses.map(verse => verse.startTime));
    for (let i = 0; i < updated.length; i++) {
      const duration = Math.max(0.2, updated[i].endTime - updated[i].startTime);
      updated[i] = {
        ...updated[i],
        startTime: Math.round(cursor * 10) / 10,
        endTime: Math.round((cursor + duration) * 10) / 10
      };
      cursor += duration;
    }
    onChangeVerses(updated);
  };

  const handleTextChange = (index: number, field: 'textUthmani' | 'transliteration' | 'translation', value: string) => {
    const updated = [...verses];
    const current = updated[index];

    if (field === 'textUthmani') {
      updated[index] = {
        ...current,
        textUthmani: value,
        displayTextUthmani: value,
        words: value.split(/\s+/).filter(Boolean).map(arabic => ({
          arabic,
          transliteration: '',
          translation: '',
          excluded: false
        }))
      };
    } else if (field === 'transliteration') {
      updated[index] = { ...current, transliteration: value, displayTransliteration: value };
    } else {
      updated[index] = { ...current, translation: value, displayTranslation: value };
    }

    onChangeVerses(updated);
  };

  const handleVerseNumberChange = (index: number, value: number) => {
    const updated = [...verses];
    const currentSurah = updated[index].verseKey.split(':')[0] || '1';
    const verseNumber = Math.max(1, Math.round(value || updated[index].verseNumber));
    updated[index] = {
      ...updated[index],
      verseNumber,
      verseKey: `${currentSurah}:${verseNumber}`
    };
    onChangeVerses(updated);
  };

  const ensureWords = (verse: VerseData) => {
    if (verse.words?.length) return verse.words;
    return verse.textUthmani.split(/\s+/).filter(Boolean).map((arabic) => ({ arabic, transliteration: '', translation: '', excluded: false }));
  };

  const handleToggleWord = (verseIndex: number, wordIndex: number) => {
    const updated = [...verses];
    const words = ensureWords(updated[verseIndex]).map((word, idx) => idx === wordIndex ? { ...word, excluded: !word.excluded } : word);
    const displayTextUthmani = words.filter(word => !word.excluded).map(word => word.arabic).join(' ');
    updated[verseIndex] = { ...updated[verseIndex], words, displayTextUthmani };
    onChangeVerses(updated);
  };

  const handleAddVerse = () => {
    // Insert right after whichever card is currently open for editing, not always at the
    // end -- and derive the surah/next-ayah from that anchor verse rather than assuming
    // Surah 1, which produced invalid verse keys like "1:24" when the timeline was in a
    // different surah entirely.
    const anchorIndex = editingIndex !== null && editingIndex < verses.length ? editingIndex : verses.length - 1;
    const anchor = verses[anchorIndex];

    const [anchorSurahStr] = (anchor?.verseKey || '1:1').split(':');
    let surahNumber = Math.max(1, parseInt(anchorSurahStr, 10) || 1);
    let nextNum = (anchor ? anchor.verseNumber : 0) + 1;

    const surahMeta = SURAHS_LIST.find(s => s.number === surahNumber);
    if (surahMeta && nextNum > surahMeta.numberOfAyahs) {
      // Ran past this surah's last ayah -- continue into the next surah instead of
      // producing an ayah number that doesn't exist.
      surahNumber = Math.min(114, surahNumber + 1);
      nextNum = 1;
    }

    const startT = anchor ? anchor.endTime : 0;
    const newVerse: VerseData = {
      verseNumber: nextNum,
      verseKey: `${surahNumber}:${nextNum}`,
      textUthmani: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ',
      transliteration: 'New Verse Transliteration',
      translation: 'New verse translation text',
      startTime: startT,
      endTime: startT + 5.0,
      words: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ'.split(/\s+/).map(arabic => ({ arabic, transliteration: '', translation: '', excluded: false })),
      displayTextUthmani: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ',
      displayTransliteration: 'New Verse Transliteration',
      displayTranslation: 'New verse translation text'
    };

    const insertAt = anchorIndex + 1;
    const updated = [...verses.slice(0, insertAt), newVerse, ...verses.slice(insertAt)];
    onChangeVerses(updated);
    setEditingIndex(insertAt);
  };


  const handleDeleteVerse = (index: number) => {
    if (verses.length <= 1) return;

    const removed = verses[index];
    const removedDuration = Math.max(0, removed.endTime - removed.startTime);

    const updated = verses
      .filter((_, i) => i !== index)
      .map((verse, i) => {
        if (i < index) return verse;

        return {
          ...verse,
          startTime: Math.max(0, Math.round((verse.startTime - removedDuration) * 10) / 10),
          endTime: Math.max(0, Math.round((verse.endTime - removedDuration) * 10) / 10)
        };
      });

    onChangeVerses(updated);
  };

  const handleDuplicateVerse = (index: number) => {
    const source = verses[index];
    if (!source) return;

    const duration = Math.max(0.8, source.endTime - source.startTime || 3);
    const duplicated: VerseData = {
      ...source,
      startTime: source.endTime,
      endTime: Math.min(audioDuration || source.endTime + duration, source.endTime + duration),
      words: source.words?.map(word => ({ ...word }))
    };

    const updated = [
      ...verses.slice(0, index + 1),
      duplicated,
      ...verses.slice(index + 1)
    ];

    // Shift following segments forward by the duplicated duration so the inserted
    // segment is visible immediately and does not overlap the next timeline item.
    for (let i = index + 2; i < updated.length; i++) {
      updated[i] = {
        ...updated[i],
        startTime: Math.round((updated[i].startTime + duration) * 10) / 10,
        endTime: Math.round((updated[i].endTime + duration) * 10) / 10
      };
    }

    onChangeVerses(updated);
  };


  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/15 via-amber-600/10 to-emerald-500/15 border border-amber-500/30 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/20 text-amber-400 rounded-lg shrink-0">
            <Zap className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h4 className="font-semibold text-slate-100 flex items-center gap-2">
              Tap-To-Sync Verse Timings
              <span className="text-xs bg-amber-500/30 text-amber-300 px-2 py-0.5 rounded-full font-mono">
                Assisted Alignment
              </span>
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">
              Auto-match uploaded audio first, then refine by tapping <kbd className="px-1.5 py-0.5 bg-slate-800 text-amber-300 rounded text-[10px]">SPACEBAR</kbd> or editing each ayah duration.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            onClick={onPlayPauseToggle}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium transition-colors border border-slate-700"
          >
            {isPlaying ? <Pause className="w-4 h-4 text-amber-400" /> : <Play className="w-4 h-4 text-emerald-400" />}
            {isPlaying ? 'Pause Audio' : 'Play Audio'}
          </button>


          <button
            onClick={handleTapToSyncMark}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-semibold rounded-lg shadow-md transition-all active:scale-95"
          >
            <Clock className="w-4 h-4" />
            <span>Mark Ayah #{verses[activeSyncIndex]?.verseNumber || 1} End</span>
          </button>
        </div>
      </div>

      <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/70 text-xs text-slate-400">
        <span className="font-semibold text-amber-300">Before you publish:</span> please use this in a way that pleases Allah. Review every ayah, its timing, and its translation yourself before publishing — you are responsible for what you publish, and you may be asked about it by Allah.
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/70">
        <button
          onClick={() => setShowTimingHelp(v => !v)}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:text-amber-300 transition-colors"
        >
          <HelpCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium">How to adjust segments</span>
          {showTimingHelp ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
        </button>
        {showTimingHelp && (
          <ul className="px-3 pb-3 text-[11px] text-slate-400 space-y-1.5 list-disc list-inside">
            <li><span className="text-slate-200">Reorder:</span> drag a segment card, or use the up/down arrows. Times are re-seated back-to-back in the new order, keeping each segment&apos;s length.</li>
            <li><span className="text-slate-200">Nudge:</span> the −0.2s / +0.2s buttons under Start Time and End Time move that edge only.</li>
            <li><span className="text-slate-200">Fine tune:</span> hold <kbd className="px-1 py-0.5 bg-slate-800 rounded text-slate-200">Ctrl</kbd> and scroll over a Start or End control to move it 0.1s per tick.</li>
            <li><span className="text-slate-200">Cascade:</span> changing an End time shifts every later segment to stay contiguous. Changing a Start time only trims that segment.</li>
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 max-h-[70vh] overflow-y-auto pr-1">
        {verses.map((verse, idx) => {
          const isActive = currentTime >= verse.startTime && currentTime <= verse.endTime;
          const isSyncTarget = idx === activeSyncIndex;
          const isEditing = editingIndex === idx;
          const duration = Math.max(0, verse.endTime - verse.startTime);
          const words = ensureWords(verse);

          return (
            <div
              key={idx}
              // Card-level dragging is off while editing: otherwise selecting
              // text inside the edit fields starts a card drag instead of a
              // text selection, making the fields impossible to edit.
              draggable={!isEditing}
              onDragStart={() => setDragIndex(idx)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOverIndex !== idx) setDragOverIndex(idx);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) handleReorder(dragIndex, idx);
                setDragIndex(null);
                setDragOverIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDragOverIndex(null);
              }}
              className={`p-3.5 rounded-xl border transition-all ${
                dragOverIndex === idx && dragIndex !== null && dragIndex !== idx
                  ? 'ring-2 ring-amber-400/70 border-amber-400/60'
                  : ''
              } ${dragIndex === idx ? 'opacity-50' : ''} ${
                isActive
                  ? 'bg-amber-500/10 border-amber-500/50 shadow-md ring-1 ring-amber-500/30'
                  : isSyncTarget
                  ? 'bg-slate-900/90 border-slate-700'
                  : 'bg-slate-900/50 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-300 shrink-0"
                    title="Drag to reorder this segment"
                  >
                    <GripVertical className="w-4 h-4" />
                  </span>
                  <div className="flex flex-col -my-1">
                    <button
                      onClick={() => handleReorder(idx, idx - 1)}
                      disabled={idx === 0}
                      title="Move up"
                      className="text-slate-500 hover:text-amber-300 disabled:opacity-25 disabled:hover:text-slate-500"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleReorder(idx, idx + 1)}
                      disabled={idx === verses.length - 1}
                      title="Move down"
                      className="text-slate-500 hover:text-amber-300 disabled:opacity-25 disabled:hover:text-slate-500"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* Segment position in the timeline. The ayah itself is
                      already shown next to it as surah:ayah. */}
                  <span
                    title={`Segment ${idx + 1} of ${verses.length}`}
                    className={`flex items-center justify-center w-7 h-7 rounded-lg font-mono font-bold text-xs ${isActive ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}
                  >
                    {idx + 1}
                  </span>
                  <span className="text-xs font-mono text-slate-400">{verse.verseKey}</span>
                  {isActive && (
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                      <Mic className="w-3 h-3 animate-pulse" /> Playing Now
                    </span>
                  )}
                  {typeof verse.matchConfidence === 'number' && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${verse.matchConfidence >= 0.75 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                      Match {Math.round(verse.matchConfidence * 100)}%
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button onClick={() => onSeek(verse.startTime)} title="Jump to ayah start" className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors">
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditingIndex(isEditing ? null : idx)} title="Edit ayah text" className={`p-1.5 rounded-md transition-colors ${isEditing ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
                    {isEditing ? <Check className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => handleDuplicateVerse(idx)}
                    title="Duplicate ayah segment below"
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 rounded-md transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>

                  {verses.length > 1 && (
                    <button onClick={() => handleDeleteVerse(idx)} title="Delete ayah" className="p-1.5 bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-md transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {isEditing ? (
                <div className="flex flex-col gap-2 my-2 p-2 bg-slate-950 rounded-lg border border-slate-800">
                  <div>
                    <label className="text-[11px] text-amber-400 font-medium block mb-1">Arabic Text (Uthmani):</label>
                    <input type="text" dir="rtl" value={verse.displayTextUthmani || verse.textUthmani} onChange={(e) => handleTextChange(idx, 'textUthmani', e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-sm font-amiri text-slate-100" />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 font-medium block mb-1">Transliteration:</label>
                    <input type="text" value={verse.displayTransliteration || verse.transliteration} onChange={(e) => handleTextChange(idx, 'transliteration', e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200" />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 font-medium block mb-1">English Translation:</label>
                    <input type="text" value={verse.displayTranslation || verse.translation} onChange={(e) => handleTextChange(idx, 'translation', e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200" />
                  </div>
                </div>
              ) : (
                <div className="my-1.5">
                  <p dir="rtl" className="font-amiri text-base font-bold text-right text-slate-100 line-clamp-2">{verse.displayTextUthmani || verse.textUthmani}</p>
                  <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">{verse.displayTranslation || verse.translation}</p>
                </div>
              )}

              <div className="my-2 p-2 bg-slate-950/60 rounded-lg border border-slate-800/70">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-slate-300">Word-by-word display</span>
                  <span className="text-[10px] text-slate-500">Click a word to exclude/include it from the canvas</span>
                </div>
                <div className="flex flex-wrap gap-1.5 justify-end" dir="rtl">
                  {words.map((word, wordIndex) => (
                    <button
                      key={`${word.arabic}-${wordIndex}`}
                      onClick={() => handleToggleWord(idx, wordIndex)}
                      title={word.excluded ? 'Include word' : 'Exclude word'}
                      className={`px-2 py-1 rounded-lg border font-amiri text-sm transition-all flex items-center gap-1 ${word.excluded ? 'bg-red-500/10 border-red-500/40 text-red-300 line-through opacity-60' : 'bg-slate-900 border-slate-700 text-slate-100 hover:border-amber-500/60'}`}
                    >
                      {word.excluded ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      <span>{word.arabic}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-2.5 pt-2 border-t border-slate-800/60 text-xs">
                <label className="flex items-center justify-between gap-3 text-slate-400 text-[11px] mb-2">
                  <span>Manual ayah assignment for this audio segment:</span>
                  <input
                    type="number"
                    min={1}
                    value={verse.verseNumber}
                    onChange={(e) => handleVerseNumberChange(idx, parseInt(e.target.value, 10))}
                    className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono font-bold"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-2 pt-2 border-t border-slate-800/60 text-xs">
                {(['startTime', 'endTime'] as const).map(field => {
                  const isStart = field === 'startTime';
                  // Full class strings, not interpolated -- Tailwind only emits
                  // classes it can find literally in the source.
                  const accentClass = isStart ? 'accent-amber-500' : 'accent-emerald-500';
                  return (
                    <div key={field} onWheel={handleTimeWheel(idx, field)} title="Ctrl + scroll to nudge by 0.1s">
                      <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                        <span>{isStart ? 'Start Time:' : 'End Time:'}</span>
                        <span className={`font-mono font-semibold ${isStart ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {formatTime(verse[field])}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={audioDuration || 300}
                        step={0.1}
                        value={verse[field]}
                        onChange={(e) => handleTimeChange(idx, field, parseFloat(e.target.value))}
                        className={`w-full ${accentClass} h-1.5 bg-slate-800 rounded-lg cursor-pointer`}
                      />
                      <div className="flex items-center gap-1 mt-1.5">
                        <button
                          onClick={() => handleTimeNudge(idx, field, -0.2)}
                          className="flex-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center gap-1"
                        >
                          <Minus className="w-3 h-3" />0.2s
                        </button>
                        <button
                          onClick={() => handleTimeNudge(idx, field, 0.2)}
                          className="flex-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center gap-1"
                        >
                          <PlusCircle className="w-3 h-3" />0.2s
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-400">Displayed duration: <span className="font-mono text-slate-200">{duration.toFixed(1)}s</span></span>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={handleAddVerse} className="w-full py-2.5 border border-dashed border-slate-700 hover:border-amber-500/50 hover:bg-amber-500/5 rounded-xl text-slate-400 hover:text-amber-300 font-medium flex items-center justify-center gap-2 transition-all">
        <Plus className="w-4 h-4" />
        <span>Add Next Ayah Entry</span>
      </button>
    </div>
  );
};
