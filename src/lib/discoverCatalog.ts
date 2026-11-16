import { invoke } from '@tauri-apps/api/core';

export type DiscoverCatalog<T> = { sites: T[]; imageDir: string };

let cached: Promise<DiscoverCatalog<unknown>> | null = null;

const isNative = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function fetchCatalog(): Promise<DiscoverCatalog<unknown>> {
  if (isNative()) {
    const imageDir = await invoke<string>('discover_images_dir');
    const saved = await invoke<string | null>('load_discover_catalog');
    if (saved !== null) return { sites: JSON.parse(saved), imageDir };
    const bundled = await fetchBundled();
    await invoke('initialize_discover_catalog', { data: bundled });
    const initialized = await invoke<string | null>('load_discover_catalog');
    return { sites: JSON.parse(initialized || bundled), imageDir };
  }
  return { sites: JSON.parse(await fetchBundled()), imageDir: '' };
}

async function fetchBundled(): Promise<string> {
  const response = await fetch('/study-sites.json');
  if (!response.ok) throw new Error('Bundled catalog unavailable');
  return response.text();
}

/** Loads the Discover catalog once per session. Call `invalidateDiscoverCatalog` after it changes on disk. */
export function loadDiscoverCatalog<T>(): Promise<DiscoverCatalog<T>> {
  if (!cached) {
    cached = fetchCatalog();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached as Promise<DiscoverCatalog<T>>;
}

export function invalidateDiscoverCatalog() {
  cached = null;
}
