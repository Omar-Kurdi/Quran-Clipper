import { NextResponse } from 'next/server';
import { isRtlLanguage, displayLanguage, TranslationOption } from '@/lib/translations';
import { quranApiJson, defaultTranslationId, quranApiSource } from '@/lib/quranApi';
import { localEditions } from '@/lib/localTranslations';

/**
 * Every translation quran.com publishes, trimmed to what the picker needs.
 *
 * Proxied rather than fetched from the browser for the reason the rest of this
 * API is: one place decides what the studio trusts, and the response is cached
 * here for a day instead of in every visitor's tab. The list changes about as
 * often as new translations are published.
 *
 * Which list it is depends on the upstream -- the open API or the Quran
 * Foundation's -- and `source` says which one answered, so the studio can
 * explain an absence rather than let it look like a bug. Editions installed on
 * this machine (`localTranslations`) are added to whichever it was.
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
    const wanted = defaultTranslationId();
    const { data, source } = await quranApiJson<{ translations?: ApiTranslation[] }>(
      '/resources/translations',
      { next: { revalidate: 86400 } },
      // A list without the translation this studio is configured to show is
      // not the list to offer: the Foundation's sandbox carries fourteen, and
      // the open API's 126 are more useful than a subset that is missing the
      // one the captions are supposed to be in.
      body =>
        localEditions().some(edition => edition.id === wanted) ||
        (body.translations || []).some(item => String(item?.id) === wanted)
    );
    if (!data) return NextResponse.json({ success: false, translations: [] }, { status: 502 });

    const list: ApiTranslation[] = Array.isArray(data.translations) ? data.translations : [];

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

    // Editions this machine holds that the upstream does not list. Without
    // this the picker would show one of them as a bare id, and the caption
    // would credit a number rather than its translator.
    for (const edition of localEditions()) {
      if (translations.some(item => item.id === edition.id)) continue;
      translations.unshift({
        id: edition.id,
        name: edition.name,
        language: displayLanguage(edition.language),
        rtl: isRtlLanguage(edition.language)
      });
    }

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
