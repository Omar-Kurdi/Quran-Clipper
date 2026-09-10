'use client';

import React, { useEffect, useState } from 'react';
import { Trash2, Copy, Plus, ChevronUp, ChevronDown, Eye, EyeOff, Minus, PlusCircle, SplitSquareHorizontal, Combine, Languages } from 'lucide-react';
import { VerseData } from '@/lib/quranData';
import { ensureWords, formatTime, MIN_SEGMENT } from '@/lib/verseEdits';
import {
  selectedOptions, knownTranslationName, captionTextFor, DEFAULT_TRANSLATION_ID,
  type TranslationOption
} from '@/lib/translations';
import { useTranslationCatalogue } from '@/hooks/useTranslationCatalogue';
import { TranslationPicker } from './TranslationPicker';
import { Button } from './Button';
import { Status } from './Status';
import { useT } from './LocaleProvider';

interface InspectorProps {
  verses: VerseData[];
  index: number;
  isActive: boolean;
  onText: (field: 'textUthmani' | 'translation', value: string) => void;
  onVerseNumber: (value: number) => void;
  onToggleWord: (wordIndex: number) => void;
  onNudge: (edge: 'startTime' | 'endTime', delta: number) => void;
  onReorder: (to: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAdd: () => void;
  /**
   * Cut this caption in two at the playhead, and join it to the one after it.
   *
   * The escape hatch for segmentation the aligner got wrong. Some of those
   * calls are undecidable from the audio alone -- a held ghunnah and a drawn
   * breath measure the same -- so rather than chase the last few percent, a
   * wrong one is meant to be a two-second fix.
   */
  onSplit: () => void;
  onMerge: () => void;
  /** Where the playhead is, so the split control can say whether it would work. */
  currentTime: number;
  /**
   * Which translations the card carries, chosen here rather than in the Style
   * panel: this is the panel about the words, and the choice is read straight
   * after it in the boxes below.
   */
  translationIds: string[];
  onTranslationIds: (ids: string[]) => void;
  /**
   * Edits one of the *additional* translations for this caption.
   *
   * The first translation is `verse.translation`, overridden by
   * `displayTranslation` and edited through `onText`. The rest live in
   * `verse.translations`, keyed by id, and had no way to be corrected at all --
   * choosing a second language gave you a line on the card and no box to fix it
   * in.
   */
  onTranslationText: (id: string, value: string) => void;
  /**
   * Whether the card's English follows the word mask instead of the ayah.
   *
   * A project-wide setting rather than a per-caption one, offered here because
   * this is the panel the mask lives in -- the label says so.
   */
  translationFollowsWords: boolean;
  onTranslationFollowsWords: (follows: boolean) => void;
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
  onText, onVerseNumber, onToggleWord, onNudge, onReorder, onDuplicate, onDelete, onAdd,
  onSplit, onMerge, currentTime,
  translationIds, onTranslationIds, onTranslationText,
  translationFollowsWords, onTranslationFollowsWords
}) => {
  const t = useT();
  const verse = verses[index];

  /**
   * Which translations the card carries.
   *
   * The list itself is a dialog -- 130 editions across 40 languages is not a
   * panel section -- so what sits here is the answer: a chip each and a way
   * back into the list. The catalogue is only fetched once the picker has been
   * opened, so a name it does not know yet falls back to the two this studio
   * ships defaults for, and then to the id, which is at least not a claim.
   */
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const { options: catalogue } = useTranslationCatalogue(isPickerOpen);
  const chosen = selectedOptions(translationIds, catalogue);
  const nameOf = (option: { id: string; name: string; language: string; rtl?: boolean }) =>
    option.language ? option.name : knownTranslationName(option.id);

  /**
   * Where else this caption's words occur in the Quran.
   *
   * The aligner's hardest calls are the passages it cannot settle from the
   * audio, because a phrase repeated in seventy places sounds the same in all
   * seventy. This says so while a caption is being reviewed, which is the
   * moment a wrong pick is cheap to fix -- and it narrows to the words actually
   * on screen, so a caption is not warned about a repeat in the half it is not
   * showing.
   *
   * Silent when the QUL export is not on this machine.
   */
  /**
   * The translation boxes to draw, in the order the card stacks them.
   *
   * Built rather than hardcoded as "the first one plus the rest" because those
   * were two different slots: the first box drew the caption's own
   * `translation` field while the card's first line came from whichever id was
   * chosen first, so dropping the default from the selection made the panel and
   * the video disagree about which translation was being edited.
   *
   * `collapsed` counts the slots that fell away because they resolved to text
   * already shown -- which, with the word mask on, is every one of them after
   * the first: the glosses are a single word-by-word English, not one per
   * edition. The card collapses them the same way, so the note under the boxes
   * is describing what is actually on screen.
   */
  const boxes: { option: TranslationOption; text: string }[] = [];
  let collapsed = 0;
  const alreadyShown = new Set<string>();
  for (const option of chosen) {
    const text = verse ? captionTextFor(verse, option.id, translationFollowsWords) : '';
    const key = text.trim();
    if (key && alreadyShown.has(key)) { collapsed += 1; continue; }
    if (key) alreadyShown.add(key);
    boxes.push({ option, text });
  }

  const shownWords = verse ? ensureWords(verse) : [];
  const firstShown = shownWords.findIndex(word => !word.excluded);
  const lastShown = shownWords.length - 1 - [...shownWords].reverse().findIndex(word => !word.excluded);
  const range = firstShown >= 0 ? `${firstShown + 1}-${lastShown + 1}` : '';
  const verseKey = verse?.verseKey || '';
  // Stamped with the caption and word range it answers, so "still loading" and
  // "belongs to the caption before this one" are both derived rather than
  // cleared -- clearing synchronously inside the effect is the cascading render
  // the lint rule is about, and the waveform loader beside it works the same way.
  const asked = verseKey && range ? `${verseKey}|${range}` : '';
  const [found, setFound] = useState<{ asked: string; phrases: { from: number; to: number; elsewhere: { verseKey: string }[] }[] } | null>(null);
  const similar = found?.asked === asked ? found.phrases : [];
  useEffect(() => {
    if (!asked) return;
    const [key, words] = asked.split('|');
    const [from, to] = words.split('-');
    let cancelled = false;
    fetch(`/api/quran/similar?verse=${key}&from=${from}&to=${to}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled) setFound({ asked, phrases: data?.phrases || [] }); })
      .catch(() => { if (!cancelled) setFound({ asked, phrases: [] }); });
    return () => { cancelled = true; };
  }, [asked]);

  /**
   * Rendered above the early return below, so it is reachable before a
   * timeline exists -- which is exactly when someone picks the translation
   * they want the captions built in.
   */
  const chooser = (
    <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800">
      <label className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5 text-xs">
        <Languages className="w-3.5 h-3.5 text-amber-400" />
        <span>{t.translations.panelLabel}</span>
      </label>
      <p className="text-[11px] text-slate-400 mb-2">{t.translations.panelHelp}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {chosen.map((option, position) => (
          <span
            key={option.id}
            className="flex items-center gap-1.5 rounded-full bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-200"
          >
            <span className="font-mono text-[10px] text-amber-400">{position + 1}</span>
            <span className="truncate max-w-44">{nameOf(option)}</span>
            {option.language && <span className="text-slate-500">· {option.language}</span>}
          </span>
        ))}
      </div>
      <Button icon={<Languages className="w-3.5 h-3.5" />} onClick={() => setIsPickerOpen(true)}>
        {t.translations.choose}
      </Button>
      <TranslationPicker
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        value={translationIds}
        onChange={onTranslationIds}
      />
    </div>
  );

  // Mirrors what `splitSegment` and `mergeWithNext` will actually do, so a
  // control that would be a no-op is disabled rather than silently ignored.
  // That includes the word count: a caption showing one word has nothing to
  // give the second half, and `splitSegment` refuses it.
  const next = verses[index + 1];
  const onScreen = verse ? ensureWords(verse).filter(word => !word.excluded).length : 0;
  const longEnough = !!verse
    && currentTime > verse.startTime + MIN_SEGMENT
    && currentTime < verse.endTime - MIN_SEGMENT;
  const canSplit = longEnough && onScreen >= 2;
  const canMerge = !!verse && !!next && verse.verseKey === next.verseKey;

  if (!verse) {
    return (
      <div className="flex flex-col gap-3 p-3">
        {chooser}
        <p className="text-[11px] text-slate-400 text-center">{t.inspector.empty}</p>
      </div>
    );
  }

  const words = ensureWords(verse);
  const duration = verse.endTime - verse.startTime;

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      {chooser}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[11px] text-gold" dir="ltr">{verse.verseKey}</span>
        {isActive && <Status tone="live">{t.common.playing}</Status>}
        {typeof verse.matchConfidence === 'number' && (
          <Status tone={verse.matchConfidence >= 0.75 ? 'success' : 'warning'}>
            {t.inspector.matchConfidence(Math.round(verse.matchConfidence * 100))}
          </Status>
        )}
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-slate-400 tabular-nums">{formatTime(duration)}</span>
      </div>

      {/* Timing. Fine adjustment lives here; coarse adjustment is dragging the
          block on the timeline. Both write through the same functions. */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
          <span>{t.inspector.starts(formatTime(verse.startTime))}</span>
          <span>{t.inspector.ends(formatTime(verse.endTime))}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['startTime', 'endTime'] as const).map(edge => (
            <div key={edge} className="flex items-center gap-1">
              <button
                onClick={() => onNudge(edge, -0.2)}
                aria-label={edge === 'startTime' ? t.inspector.moveStartEarlier : t.inspector.moveEndEarlier}
                className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-md text-slate-200 flex items-center justify-center"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-[10px] text-slate-400 w-10 text-center">
                {edge === 'startTime' ? t.inspector.edgeStart : t.inspector.edgeEnd}
              </span>
              <button
                onClick={() => onNudge(edge, 0.2)}
                aria-label={edge === 'startTime' ? t.inspector.moveStartLater : t.inspector.moveEndLater}
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
          {t.inspector.ayahNumber}
        </label>
        <input
          id="insp-ayah-number"
          type="number"
          min={1}
          value={verse.verseNumber}
          onChange={e => onVerseNumber(parseInt(e.target.value, 10))}
          dir="ltr"
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono"
        />
      </div>

      {/* Both boxes open at the same height -- explicitly, because `rows` counts
          lines and the two use different type sizes, so matching row counts
          still rendered the translation shorter than the Arabic. Both are
          drag-resizable, and the grip is easy to miss on a dark panel, so each
          one says so. */}
      <div>
        <label htmlFor="insp-arabic" className="text-[11px] font-semibold text-slate-400 mb-1 flex items-baseline justify-between gap-2">
          <span>{t.inspector.arabic}</span>
          <span className="font-normal text-slate-400">{t.inspector.dragToResize}</span>
        </label>
        <textarea
          id="insp-arabic"
          value={verse.displayTextUthmani || verse.textUthmani}
          onChange={e => onText('textUthmani', e.target.value)}
          dir="rtl"
          rows={4}
          className="w-full min-h-38 resize-y bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-base text-parchment font-amiri leading-loose"
        />
      </div>

      {/* A box for every translation on the card, resolved through the same
          function the canvas draws with -- so the box and the video cannot
          disagree, in any language rather than only the first. Editing the
          caption's own slot writes `translation`; the rest write into
          `displayTranslations`, which outranks the fetched text. */}
      {boxes.map(box => (
        <div key={box.option.id}>
          <label
            htmlFor={`insp-translation-${box.option.id}`}
            className="text-[11px] font-semibold text-slate-400 mb-1 flex items-baseline justify-between gap-2"
          >
            <span>
              {t.inspector.translation}
              {/* Named once there is more than one, so the boxes below are
                  telling apart rather than guessing at. */}
              {chosen.length > 1 && (
                <span className="ms-1.5 font-normal text-slate-500">{nameOf(box.option)}</span>
              )}
            </span>
            <span className="font-normal text-slate-400">{t.inspector.dragToResize}</span>
          </label>
          <textarea
            id={`insp-translation-${box.option.id}`}
            value={box.text}
            onChange={e =>
              box.option.id === DEFAULT_TRANSLATION_ID
                ? onText('translation', e.target.value)
                : onTranslationText(box.option.id, e.target.value)
            }
            // An Arabic-script translation is written right to left; the card
            // already draws it that way, and typing into a box that does not
            // is its own small misery.
            dir={box.option.rtl ? 'rtl' : 'ltr'}
            rows={5}
            className="w-full min-h-38 resize-y bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 leading-relaxed"
          />
        </div>
      ))}

      {collapsed > 0 && (
        <p className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-[11px] leading-relaxed text-slate-400">
          {t.inspector.oneGlossLine(collapsed)}
        </p>
      )}

      {similar.length > 0 && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-200">
          {t.inspector.alsoAppears(
            verseKey,
            similar[0].elsewhere.length,
            similar[0].elsewhere.slice(0, 4).map(place => place.verseKey).join(', ')
          )}
        </p>
      )}

      <div>
        <span className="text-[11px] font-semibold text-slate-400 block mb-1">
          {t.inspector.wordsOnScreen}
          <span className="block font-normal text-[11px] text-slate-400">{t.inspector.wordsHint}</span>
        </span>

        {/* Beside the mask because that is what it follows, though it applies
            to every caption rather than this one. */}
        <label className="mb-2 flex items-start gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={translationFollowsWords}
            onChange={e => onTranslationFollowsWords(e.target.checked)}
            className="mt-0.5 accent-amber-500"
          />
          <span>
            {t.inspector.translationFollowsWords}
            <span className="block text-slate-400">{t.inspector.translationFollowsWordsHint}</span>
          </span>
        </label>
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
        <Button
          icon={<SplitSquareHorizontal className="w-3.5 h-3.5" />}
          onClick={onSplit}
          disabled={!canSplit}
          title={
            canSplit
              ? t.inspector.splitHint
              : onScreen < 2
                ? t.inspector.splitOneWord
                : t.inspector.splitTooShort
          }
        >
          {t.inspector.split}
        </Button>
        <Button
          icon={<Combine className="w-3.5 h-3.5" />}
          onClick={onMerge}
          disabled={!canMerge}
          title={canMerge ? t.inspector.mergeHint : t.inspector.mergeNotSameAyah}
        >
          {t.inspector.merge}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-800">
        <Button icon={<ChevronUp className="w-3.5 h-3.5" />} onClick={() => onReorder(index - 1)} disabled={index === 0} aria-label={t.inspector.moveAyahEarlier} />
        <Button icon={<ChevronDown className="w-3.5 h-3.5" />} onClick={() => onReorder(index + 1)} disabled={index === verses.length - 1} aria-label={t.inspector.moveAyahLater} />
        <Button icon={<Copy className="w-3.5 h-3.5" />} onClick={onDuplicate}>{t.common.duplicate}</Button>
        <Button icon={<Plus className="w-3.5 h-3.5" />} onClick={onAdd}>{t.common.add}</Button>
        <span className="flex-1" />
        <Button variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={onDelete} disabled={verses.length <= 1} aria-label={t.inspector.deleteAyah} />
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-800 pt-2">
        <strong className="text-slate-200">{t.inspector.beforeYouPublish}</strong>{' '}
        {t.inspector.beforeYouPublishBody}
      </p>
    </div>
  );
};
