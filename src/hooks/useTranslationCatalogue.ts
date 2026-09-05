'use client';

import { useEffect, useState } from 'react';
import { TranslationOption } from '@/lib/translations';
import { cachedCatalogue, catalogueSource, loadTranslationCatalogue } from '@/lib/translationCatalogue';

export interface CatalogueState {
  options: TranslationOption[];
  loading: boolean;
  /** True when the list could not be fetched -- offline, or quran.com unreachable. */
  failed: boolean;
  /** Which upstream the list came from; `public` is the one missing The Clear Quran. */
  source: 'public' | 'foundation' | null;
}

/**
 * The translation catalogue, fetched when something actually needs it.
 *
 * `enabled` is what keeps this off the studio's startup path: the chips in the
 * style panel want names, but only once the picker has been opened at least
 * once, and the picker itself is what asks.
 */
export function useTranslationCatalogue(enabled = true): CatalogueState {
  const [options, setOptions] = useState<TranslationOption[]>(() => cachedCatalogue() ?? []);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>(
    cachedCatalogue() ? 'ready' : 'idle'
  );

  useEffect(() => {
    if (!enabled || state === 'ready') return;
    let cancelled = false;
    loadTranslationCatalogue().then(list => {
      if (cancelled) return;
      setOptions(list);
      setState(list.length ? 'ready' : 'failed');
    });
    return () => { cancelled = true; };
  }, [enabled, state]);

  return {
    options,
    loading: enabled && state !== 'ready' && state !== 'failed',
    failed: state === 'failed',
    source: catalogueSource()
  };
}
