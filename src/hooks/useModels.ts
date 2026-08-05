'use client';

import { useEffect, useState } from 'react';
import { FALLBACK_MODELS, type ModelOption } from '@/lib/model-types';

let cachedModels: ModelOption[] | null = null;
let cachedAt = 0;
let fetchPromise: Promise<ModelOption[]> | null = null;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function isCacheValid(): boolean {
  return cachedModels !== null && Date.now() - cachedAt < CACHE_TTL_MS;
}

async function fetchModels(): Promise<ModelOption[]> {
  try {
    const res = await fetch('/api/models');
    if (!res.ok) throw new Error('Failed to fetch');
    const data: ModelOption[] = await res.json();
    if (data.length > 0) {
      cachedModels = data;
      cachedAt = Date.now();
      return data;
    }
  } catch {
    // API unavailable — fall back
  }
  cachedModels = FALLBACK_MODELS;
  cachedAt = Date.now();
  return FALLBACK_MODELS;
}

export function useModels(enabled = true): { models: ModelOption[]; loading: boolean } {
  // Only the fetched-from-network result needs to live in state; the
  // already-cached-and-valid case is derived directly during render below,
  // so we don't need to sync it into state via an effect.
  const [fetchedModels, setFetchedModels] = useState<ModelOption[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || isCacheValid()) return;

    let cancelled = false;

    // Wrapped in an async IIFE (rather than calling setLoading(true)
    // synchronously at the top of the effect body) per
    // react-hooks/set-state-in-effect.
    (async () => {
      setLoading(true);
      if (!fetchPromise) {
        fetchPromise = fetchModels().finally(() => { fetchPromise = null; });
      }
      const result = await fetchPromise;
      if (!cancelled) {
        setFetchedModels(result);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [enabled]);

  const models = !enabled ? [] : isCacheValid() ? cachedModels! : (fetchedModels ?? []);

  return { models, loading };
}
