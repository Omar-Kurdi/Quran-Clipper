'use client';

import React, { useMemo, useState } from 'react';
import { Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { buildPublishMetadata, PublishInput, TITLE_MAX } from '@/lib/publishMetadata';
import { selectedOptions } from '@/lib/translations';
import { useTranslationCatalogue } from '@/hooks/useTranslationCatalogue';
import { useT } from './LocaleProvider';

interface PublishCaptionProps {
  /** Everything about the clip except what this panel resolves or owns itself. */
  publish: Omit<PublishInput, 'includeVerseText' | 'translationNames'>;
  /** Which translations are on screen. Turned into names here -- see below. */
  translationIds: string[];
  /**
   * Whether the ayah text goes in the description.
   *
   * Held by the caller rather than here: this panel is mounted inside the
   * result screen, which unmounts on "Render Another Export", and a choice
   * about the post should survive re-rendering the video it describes.
   */
  includeVerseText: boolean;
  onIncludeVerseText: (include: boolean) => void;
}

/**
 * The caption to post the clip with.
 *
 * Sits on the result screen because that is the moment it is wanted: the file
 * has just been written and the next thing that happens to it is an upload
 * form. Everything in it is already known -- the surah, the range the timeline
 * actually holds, the reciter, the translation on screen -- and typing it again
 * by hand is how a description ends up describing a different clip.
 *
 * Collapsed by default. It is one more thing on a screen whose job is the
 * download button, and nobody needs it on the render they are about to discard.
 */
export const PublishCaption: React.FC<PublishCaptionProps> = ({
  publish, translationIds, includeVerseText, onIncludeVerseText
}) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  /** Which field was last copied, so the confirmation lands on that button. */
  const [copied, setCopied] = useState<string | null>(null);
  /** Set when the clipboard refused, so a dead button says why. */
  const [copyFailed, setCopyFailed] = useState(false);

  /**
   * Translator names for the credit.
   *
   * Fetched only once this panel is opened. The catalogue is not on the
   * studio's startup path -- the picker is what usually asks for it -- and an
   * export is not a reason to go to the network on its own. Opening the
   * caption is: it is the moment the name is about to be published.
   *
   * Until it arrives the credit names the source and not the translator, which
   * is a shorter credit rather than a wrong one.
   */
  const catalogue = useTranslationCatalogue(open);
  const translationNames = useMemo(
    () =>
      catalogue.options.length
        ? selectedOptions(translationIds, catalogue.options).map(option => option.name)
        : [],
    [translationIds, catalogue.options]
  );

  const meta = useMemo(
    () => buildPublishMetadata({ ...publish, translationNames, includeVerseText }),
    [publish, translationNames, includeVerseText]
  );

  const copy = async (field: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(field);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(current => (current === field ? null : current)), 1600);
    } catch {
      // Clipboard refused -- an insecure context, a browser that wants a
      // trusted gesture, a denied permission. Saying so matters more than it
      // looks: without it the button simply does nothing, and the text is
      // quietly not on the clipboard when it is pasted into the upload form.
      setCopied(null);
      setCopyFailed(true);
    }
  };

  const field = (key: string, label: string, value: string, extra?: string) => (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] font-semibold text-slate-300">
          {label}
          {extra && <span className="ms-1.5 font-mono font-normal text-slate-500">{extra}</span>}
        </span>
        <button
          onClick={() => copy(key, value)}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-slate-300 hover:text-emerald-300 hover:bg-slate-800 transition-colors"
        >
          {copied === key ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied === key ? t.publish.copied : t.publish.copy}
        </button>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-950 p-2 text-[11px] leading-relaxed text-slate-200">
        {value}
      </pre>
    </div>
  );

  return (
    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold text-slate-200 hover:text-amber-300"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {t.publish.title}
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-slate-800 p-3">
          <label className="flex items-start gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeVerseText}
              onChange={e => onIncludeVerseText(e.target.checked)}
              className="mt-0.5 accent-amber-500"
            />
            <span>
              {t.publish.includeText}
              <span className="block text-slate-400">{t.publish.includeTextHelp}</span>
            </span>
          </label>

          {field('title', t.publish.titleField, meta.title, `${meta.title.length}/${TITLE_MAX}`)}
          {field('description', t.publish.descriptionField, meta.description)}
          {field('tags', t.publish.tagsField, meta.tags.join(', '))}

          {copyFailed && (
            <p role="status" className="text-[11px] text-red-300">
              {t.publish.copyFailed}
            </p>
          )}

          {meta.truncated && (
            <p role="status" className="text-[11px] text-amber-300/90">
              {t.publish.truncated}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
