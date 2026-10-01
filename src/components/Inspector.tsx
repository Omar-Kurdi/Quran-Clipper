'use client';

import React, { useEffect, useState } from 'react';
import { wordFace, pagesUsedBy, ensureQpcPages, QPC_V2 } from '@/lib/mushafFonts';
import { useStudioConfig } from '@/hooks/useStudioConfig';
import { Trash2, Copy, Plus, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Minus, SplitSquareHorizontal, Combine, AlertTriangle } from 'lucide-react';
import { VerseData } from '@/lib/quranData';
import { ensureWords, formatTime, MIN_SEGMENT } from '@/lib/verseEdits';
import {
  selectedOptions, knownTranslationName, captionText, DEFAULT_TRANSLATION_ID,
  WORD_BY_WORD_LANGUAGE, WORD_BY_WORD_PROVIDER,
  type TranslationOption, type CaptionTextSource
} from '@/lib/translations';
import { useTranslationCatalogue } from '@/hooks/useTranslationCatalogue';
import { Button } from './Button';
import { Status } from './Status';
import { captionChecks } from '@/lib/captionChecks';
import { useT } from './LocaleProvider';

interface InspectorProps {
  verses: VerseData[];
  index: number;
  isActive: boolean;
  onText: (field: 'translation', value: string) => void;
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
  /** "Looks right": clears this caption's mark for checking. See `captionChecks`. */
  onChecked: () => void;
  /** Where the playhead is, so the split control can say whether it would work. */
  currentTime: number;
  /** Moves to another caption: the panel's previous / next. */
  onSelect: (index: number) => void;
  /**
   * Which translations the card carries, for the boxes below. They are chosen
   * in Style, since the choice is the same for every caption.
   */
  translationIds: string[];
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
  onSplit, onMerge, onChecked, currentTime, onSelect,
  translationIds, onTranslationText,
  translationFollowsWords, onTranslationFollowsWords
}) => {
  const t = useT();
  const verse = verses[index];

  /**
   * Which translations the card carries, named from the catalogue once Style's
   * picker has fetched it; until then a name falls back to the two this studio
   * ships defaults for, and then to the id, which is at least not a claim.
   */
  const { options: catalogue } = useTranslationCatalogue(false);
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
  const boxes: { option: TranslationOption; text: string; source: CaptionTextSource }[] = [];
  let collapsed = 0;
  const alreadyShown = new Set<string>();
  for (const option of chosen) {
    const { text, source } = verse
      ? captionText(verse, option.id, translationFollowsWords)
      : { text: '', source: 'none' as CaptionTextSource };
    const key = text.trim();
    if (key && alreadyShown.has(key)) { collapsed += 1; continue; }
    if (key) alreadyShown.add(key);
    boxes.push({ option, text, source });
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

  // The chips show the mushaf's own drawing of each word, which needs that
  // page's font. The canvas asks for the same ones, but the inspector can be
  // showing a word before the canvas has painted it, so it asks too --
  // `ensureQpcPages` is idempotent and `document.fonts` is shared. Above the
  // early return because a hook cannot be called conditionally.
  const glyphs = !useStudioConfig().missingFonts.has(QPC_V2);
  const shownPages = glyphs ? pagesUsedBy(verse ? ensureWords(verse) : []).join(',') : '';
  useEffect(() => {
    void ensureQpcPages(shownPages ? shownPages.split(',').map(Number) : []);
  }, [shownPages]);

  if (!verse) {
    return <p className="p-4 text-[13px] text-slate-400 text-center">{t.inspector.empty}</p>;
  }

  const words = ensureWords(verse);
  const duration = verse.endTime - verse.startTime;
  const checks = captionChecks(verse);

  return (
    <div className="flex flex-col gap-4 p-4 text-[13px]">
      <CaptionHeader
        index={index}
        total={verses.length}
        span={t.inspector.ayahSpan(verse.verseKey, formatTime(verse.startTime), formatTime(verse.endTime), formatTime(duration))}
        onSelect={onSelect}
      >
        {isActive && <Status tone="live">{t.common.playing}</Status>}
        {typeof verse.matchConfidence === 'number' && (
          <Status tone={verse.matchConfidence >= 0.75 ? 'success' : 'warning'}>
            {t.inspector.matchConfidence(Math.round(verse.matchConfidence * 100))}
          </Status>
        )}
      </CaptionHeader>

      {/* Why this caption is marked on the timeline, and the two ways to
          settle it, right where the caption is being read. */}
      {checks.length > 0 && (
        <CheckNote onChecked={onChecked} onMerge={canMerge ? onMerge : undefined}>
          {checks.includes('stop_mark') && <p>{t.inspector.checkStopMark}</p>}
          {checks.includes('low_match') && (
            <p>{t.inspector.checkLowMatch(Math.round((verse.matchConfidence ?? 0) * 100))}</p>
          )}
        </CheckNote>
      )}

      {/* The Arabic is shown, never edited: it is the corpus's text for this
          verse key, and the Quran text may not be modified. Which of its words
          are on screen is the one thing a caption chooses -- so the words
          themselves are the control, rather than a read-only copy of the ayah
          above a second row of chips. */}
      <WordPicker words={words} glyphs={glyphs} onToggleWord={onToggleWord} />

      {/* A box for every translation on the card, resolved through the same
          function the canvas draws with -- so the box and the video cannot
          disagree, in any language rather than only the first. Editing the
          caption's own slot writes `translation`; the rest write into
          `displayTranslations`, which outranks the fetched text. */}
      {boxes.map(box => (
        <div key={box.option.id} className="flex flex-col gap-1.5">
          <label htmlFor={`insp-translation-${box.option.id}`} className="text-xs font-semibold text-slate-300">
            {/* The label follows what the box is drawing, not what was
                chosen. With the mask on, that is quran.com's own word-by-word
                edition -- a separate work from every translation in the
                picker -- and naming the chosen translator over it was putting
                their name to words they never wrote. */}
            {box.source === 'words' ? t.inspector.wordByWord : t.inspector.translation}
            <span className="ms-1.5 font-normal text-slate-400">
              {box.source === 'words'
                ? t.inspector.wordByWordFrom(WORD_BY_WORD_LANGUAGE, WORD_BY_WORD_PROVIDER)
                : nameOf(box.option)}
            </span>
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
            rows={3}
            className="w-full resize-y bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 leading-relaxed"
          />
        </div>
      ))}

      {/* Beside the translation because that is what it changes, though it
          applies to every caption rather than this one. */}
      <label className="flex items-start gap-2 text-[13px] text-slate-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={translationFollowsWords}
          onChange={e => onTranslationFollowsWords(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-amber-500"
        />
        <span>
          {t.inspector.translationFollowsWords}
          <span className="block text-xs text-slate-400">{t.inspector.translationFollowsWordsHint}</span>
        </span>
      </label>

      {collapsed > 0 && (
        <p className="rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-xs leading-relaxed text-slate-400">
          {t.inspector.oneGlossLine(collapsed)}
        </p>
      )}

      {similar.length > 0 && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-200">
          {t.inspector.alsoAppears(
            verseKey,
            similar[0].elsewhere.length,
            similar[0].elsewhere.slice(0, 4).map(place => place.verseKey).join(', ')
          )}
        </p>
      )}

      {/* Timing. Fine adjustment lives here; coarse adjustment is dragging the
          block on the timeline. Both write through the same functions. */}
      <TimingNudge start={verse.startTime} end={verse.endTime} onNudge={onNudge} />

      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-800">
        <Button
          icon={<SplitSquareHorizontal className="w-3.5 h-3.5" />}
          onClick={onSplit}
          disabled={!canSplit}
          title={canSplit ? t.inspector.splitHint : onScreen < 2 ? t.inspector.splitOneWord : t.inspector.splitTooShort}
        >
          {t.inspector.splitHere}
        </Button>
        <Button
          icon={<Combine className="w-3.5 h-3.5" />}
          onClick={onMerge}
          disabled={!canMerge}
          title={canMerge ? t.inspector.mergeHint : t.inspector.mergeNotSameAyah}
        >
          {t.inspector.merge}
        </Button>
        <Button icon={<Copy className="w-3.5 h-3.5" />} onClick={onDuplicate}>{t.common.duplicate}</Button>
        <span className="flex-1" />
        <Button variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={onDelete} disabled={verses.length <= 1}>
          {t.inspector.delete}
        </Button>
      </div>

      {/* Rarer edits, kept rather than dropped: reordering, adding a caption,
          and renumbering one the matcher labelled wrong. */}
      <details className="text-[13px] text-slate-300">
        <summary className="cursor-pointer select-none text-slate-400 hover:text-slate-200">{t.inspector.moreActions}</summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={<ChevronUp className="w-3.5 h-3.5" />} onClick={() => onReorder(index - 1)} disabled={index === 0}>
              {t.inspector.moveAyahEarlier}
            </Button>
            <Button icon={<ChevronDown className="w-3.5 h-3.5" />} onClick={() => onReorder(index + 1)} disabled={index === verses.length - 1}>
              {t.inspector.moveAyahLater}
            </Button>
            <Button icon={<Plus className="w-3.5 h-3.5" />} onClick={onAdd}>{t.inspector.addCaption}</Button>
          </div>
          <label className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-300">{t.inspector.ayahNumber}</span>
            <input
              type="number"
              min={1}
              value={verse.verseNumber}
              onChange={e => onVerseNumber(parseInt(e.target.value, 10))}
              dir="ltr"
              className="w-24 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-slate-100 font-mono"
            />
          </label>
        </div>
      </details>
    </div>
  );
};

const ICON_BUTTON =
  'w-9 h-9 shrink-0 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold';

/** "Caption 5 of 7", its ayah and times, and the way to the captions either side. */
const CaptionHeader: React.FC<{
  index: number;
  total: number;
  span: string;
  onSelect: (index: number) => void;
  children?: React.ReactNode;
}> = ({ index, total, span, onSelect, children }) => {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onSelect(index - 1)} disabled={index === 0} aria-label={t.inspector.previous} title={t.inspector.previous} className={ICON_BUTTON}>
        <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-semibold text-slate-100">{t.inspector.captionOf(index + 1, total)}</span>
          {children}
        </div>
        <div className="text-xs text-slate-400 tabular-nums">{span}</div>
      </div>
      <button onClick={() => onSelect(index + 1)} disabled={index >= total - 1} aria-label={t.inspector.next} title={t.inspector.next} className={ICON_BUTTON}>
        <ChevronRight className="w-4 h-4 rtl:rotate-180" />
      </button>
    </div>
  );
};

/** Why a caption is marked for checking, with "Looks right" and, where it can apply, the merge that usually fixes it. */
const CheckNote: React.FC<{ onChecked: () => void; onMerge?: () => void; children: React.ReactNode }> = ({ onChecked, onMerge, children }) => {
  const t = useT();
  return (
    <div role="note" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 flex flex-col gap-2.5">
      <div className="flex gap-2.5 items-start">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" aria-hidden="true" />
        <div className="flex flex-col gap-1 text-amber-100 leading-relaxed">
          <span className="font-semibold text-amber-200">{t.inspector.checkTitle}</span>
          {children}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onChecked}
          className="h-8 px-3 rounded-lg border border-amber-500/60 text-amber-100 font-semibold hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          {t.inspector.looksRight}
        </button>
        {onMerge && (
          <button
            onClick={onMerge}
            className="h-8 px-3 rounded-lg border border-slate-700 text-slate-100 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            {t.inspector.mergeWithNext}
          </button>
        )}
      </div>
    </div>
  );
};

/** The caption's words in the mushaf's own drawing: tap one to take it off screen or put it back. */
const WordPicker: React.FC<{
  words: ReturnType<typeof ensureWords>;
  glyphs: boolean;
  onToggleWord: (wordIndex: number) => void;
}> = ({ words, glyphs, onToggleWord }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-300">{t.inspector.onScreen}</span>
        <span className="text-slate-400">{t.inspector.tapToHide}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5" dir="rtl">
        {words.map((word, wi) => {
          const face = wordFace(word, glyphs);
          return (
            <button
              key={`${word.arabic}-${wi}`}
              onClick={() => onToggleWord(wi)}
              aria-pressed={!word.excluded}
              className={`px-2.5 py-0.5 rounded-lg border font-quran text-2xl leading-loose transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                word.excluded
                  ? 'border-dashed border-slate-700 text-slate-500 line-through'
                  : 'border-slate-700 bg-slate-800/70 text-parchment hover:border-slate-500'
              }`}
            >
              <span style={face.family ? { fontFamily: face.family } : undefined}>{face.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** Start and end in steps of 0.2s, beside the times they change. */
const TimingNudge: React.FC<{ start: number; end: number; onNudge: (edge: 'startTime' | 'endTime', delta: number) => void }> = ({
  start, end, onNudge
}) => {
  const t = useT();
  const rows = [
    { edge: 'startTime' as const, label: t.inspector.startsLabel, time: start, earlier: t.inspector.moveStartEarlier, later: t.inspector.moveStartLater },
    { edge: 'endTime' as const, label: t.inspector.endsLabel, time: end, earlier: t.inspector.moveEndEarlier, later: t.inspector.moveEndLater }
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-slate-300">{t.inspector.timing}</span>
      <div className="grid grid-cols-[4rem_1fr_2.25rem_2.25rem] items-center gap-2">
        {rows.map(row => (
          <React.Fragment key={row.edge}>
            <span className="text-slate-400">{row.label}</span>
            <span className="font-mono tabular-nums text-slate-100" dir="ltr">{formatTime(row.time)}</span>
            <button onClick={() => onNudge(row.edge, -0.2)} aria-label={row.earlier} title={row.earlier} className={ICON_BUTTON}>
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onNudge(row.edge, 0.2)} aria-label={row.later} title={row.later} className={ICON_BUTTON}>
              <Plus className="w-3.5 h-3.5" />
            </button>
          </React.Fragment>
        ))}
      </div>
      <p className="text-xs text-slate-400">{t.inspector.nudgeHint}</p>
    </div>
  );
};
