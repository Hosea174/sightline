import { useEffect, useRef, useSyncExternalStore } from 'react';

export type GridViewKey = 'compact' | 'small' | 'medium' | 'large' | 'list';

export const viewWidths: Record<Exclude<GridViewKey, 'list'>, number> = { compact: 180, small: 240, medium: 320, large: 420 };
/** Hard cap on columns per row for a view; the extra small view never shows more than six cards. */
export const viewMaxColumns: Partial<Record<GridViewKey, number>> = { compact: 6 };

/** CSS `grid-template-columns` for a view. Columns still adapt to the width, but never exceed the view's cap. */
export function gridColumnsCss(view: GridViewKey): string | undefined {
  if (view === 'list') return undefined;
  const min = viewWidths[view];
  const max = viewMaxColumns[view];
  if (!max) return `repeat(auto-fill,minmax(min(${min}px,100%),1fr))`;
  return `repeat(auto-fill,minmax(min(max(${min}px,calc((100% - ${max - 1}*var(--card-gap,12px))/${max})),100%),1fr))`;
}

const BASE_PAGE_SIZES = [10, 20, 30, 50, 100];

/** Page-size choices where every page holds whole rows of `columns` cards. */
export function pageSizeOptions(columns: number): number[] {
  const c = Math.max(1, Math.floor(columns) || 1);
  return [...new Set(BASE_PAGE_SIZES.map((n) => Math.max(c, Math.round(n / c) * c)))].sort((a, b) => a - b);
}

/** The option closest to `size` for the given column count (ties go to the larger page). */
export function snapPageSize(size: number, columns: number): number {
  const options = pageSizeOptions(columns);
  return options.reduce((best, n) => (Math.abs(n - size) < Math.abs(best - size) || (Math.abs(n - size) === Math.abs(best - size) && n > best) ? n : best), options[0]);
}

let columns = 1;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const setColumns = (next: number) => {
  if (next === columns) return;
  columns = next;
  listeners.forEach((fn) => fn());
};

/** Columns per row of the card grid currently on screen (kept from the last grid when none is mounted). */
export const useGridColumnsValue = () => useSyncExternalStore(subscribe, () => columns, () => 1);

const GRID_SELECTOR = '.reference-grid, .study-grid, .font-list';

/** Measures the rendered grid's real column count (resolved by CSS) and publishes it. Call once near the app root. */
export function useGridColumnsMeasure(view: GridViewKey) {
  const observed = useRef<{ el: Element | null; ro: ResizeObserver | null }>({ el: null, ro: null });
  const measureRef = useRef<() => void>(() => {});
  measureRef.current = () => {
    const el = document.querySelector(GRID_SELECTOR);
    if (!el) return;
    const tracks = getComputedStyle(el).gridTemplateColumns;
    setColumns(view === 'list' || !tracks || tracks === 'none' ? 1 : tracks.trim().split(/\s+/).length);
    if (observed.current.el !== el) {
      observed.current.ro?.disconnect();
      observed.current.el = el;
      observed.current.ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measureRef.current());
      observed.current.ro?.observe(el);
    }
  };
  // Runs after every render so a grid that mounts later (loading finished, view switched) is picked up.
  useEffect(() => measureRef.current());
  useEffect(() => {
    const onResize = () => measureRef.current();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      observed.current.ro?.disconnect();
      observed.current = { el: null, ro: null };
    };
  }, []);
}
