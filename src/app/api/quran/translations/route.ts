import { NextResponse } from 'next/server';
import { isRtlLanguage, displayLanguage, TranslationOption } from '@/lib/translations';
import { quranApiFetch, defaultTranslationId, quranApiSource } from '@/lib/quranApi';

/**
 * Every translation quran.com publishes, trimmed to what the picker needs.
 *
 * Proxied rather than fetched from the browser for the reason the rest of this
 * API is: one place decides what the studio trusts, and the response is cached
 * here for a day instead of in every visitor's tab. The list changes about as
 * often as new translations are published.
 *
 * Which list it is depends on the upstream: the open API publishes 126
 * translations and The Clear Quran is not among them, while the Quran
 * Foundation API -- credentials permitting -- does carry it. `source` says
 * which one answered, so the studio can explain an absence rather than let it
 * look like a bug.
 */
export const revalidate = 86400;

interface ApiTranslation {
  id?: number;
  name?: string;
  author_name?: string;
  language_name?: string;
}

export async function GET() {
  try {
    const { res, source } = await quranApiFetch('/resources/translations', {
      next: { revalidate: 86400 }
    });
    if (!res?.ok) return NextResponse.json({ success: false, translations: [] }, { status: 502 });

    const data = await res.json();
    const list: ApiTranslation[] = Array.isArray(data?.translations) ? data.translations : [];

    const translations: TranslationOption[] = list
      .filter(item => typeof item?.id === 'number' && (item.name || item.author_name))
      .map(item => {
        const language = displayLanguage(item.language_name || '');
        return {
          id: String(item.id),
          // The edition's name where there is one -- "Saheeh International" is
          // not a person -- and the translator where there is not.
          name: (item.name || item.author_name || '').trim(),
          language,
          rtl: isRtlLanguage(item.language_name || '')
        };
      });

    return NextResponse.json({
      success: true,
      translations,
      /** Which translation a caption's own `translation` field already holds. */
      defaultId: defaultTranslationId(),
      source: quranApiSource() === 'foundation' ? source : 'public'
    });
  } catch {
    // The picker falls back to the translation already loaded, which is the
    // one every existing project uses.
    return NextResponse.json({ success: false, translations: [] }, { status: 502 });
  }
}
