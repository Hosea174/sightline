import { convertFileSrc, invoke } from '@tauri-apps/api/core';

import { fixMojibakeDeep } from './mojibake';

export type DiscoverCatalog<T> = { sites: T[]; imageDir: string };

let cached: Promise<DiscoverCatalog<unknown>> | null = null;

const isNative = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function attachDiscoverPalettes<T extends { url: string; colors?: string[] }>(rows: T[]): Promise<T[]> {
  rows = fixMojibakeDeep(rows);
  if (!isNative()) return rows;
  try {
    const raw = await invoke<string | null>('load_discover_palettes');
    if (!raw) return rows;
    const results = JSON.parse(raw) as { url: string; colors: string[] }[];
    const paletteByUrl = new Map(
      results
        .filter((x) => Array.isArray(x.colors))
        .map((x) => [x.url, x.colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 2)])
    );
    return rows.map((row) => (row.colors?.length ? row : { ...row, colors: paletteByUrl.get(row.url) || [] }));
  } catch {
    return rows;
  }
}

async function fetchCatalog(): Promise<DiscoverCatalog<unknown>> {
  if (isNative()) {
    const imageDir = await invoke<string>('discover_images_dir');
    const saved = await invoke<string | null>('load_discover_catalog');
    if (saved !== null) return { sites: await attachDiscoverPalettes(JSON.parse(saved)), imageDir };
    const bundled = await fetchBundled();
    await invoke('initialize_discover_catalog', { data: bundled });
    const initialized = await invoke<string | null>('load_discover_catalog');
    return { sites: await attachDiscoverPalettes(JSON.parse(initialized || bundled)), imageDir };
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
    cached.then(
      () => {
        // Build the small cover copies in the background so later visits never decode full-size captures.
        if (isNative()) void invoke('warm_discover_thumbs').catch(() => {});
      },
      () => {
        cached = null;
      }
    );
  }
  return cached as Promise<DiscoverCatalog<T>>;
}

export function invalidateDiscoverCatalog() {
  cached = null;
}

/**
 * URL for a Discover cover in grids and the canvas. Cached (`local:`) images go through the
 * `sthumb` scheme, which serves a 960px copy. Use the original path only where full size matters.
 */
export function discoverCoverSrc(image: string, imageDir: string): string {
  if (!image.startsWith('local:')) return image;
  const name = image.slice(6);
  if (isNative()) return convertFileSrc(name, 'sthumb');
  return imageDir ? convertFileSrc(`${imageDir}\\${name}`) : image;
}
