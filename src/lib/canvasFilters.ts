export type CanvasFilters = {
  media: string[];
  category: string[];
  tags: string[];
  colors: string[];
  years: string[];
  sources: string[];
  industries: string[];
  discoverTags: string[];
  statuses: string[];
};

export const CANVAS_FILTERS_KEY = 'sightline:canvas-filters:v1';

export const EMPTY_CANVAS_FILTERS: CanvasFilters = {
  media: [],
  category: [],
  tags: [],
  colors: [],
  years: [],
  sources: [],
  industries: [],
  discoverTags: [],
  statuses: [],
};

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Accepts partial objects so older saved shapes still load; unknown/invalid fields fall back to empty. */
export function isCanvasFilters(value: unknown): value is Partial<CanvasFilters> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (Object.keys(EMPTY_CANVAS_FILTERS) as (keyof CanvasFilters)[]).every((k) => rec[k] === undefined || isStringArray(rec[k]));
}

export function normalizeCanvasFilters(value: Partial<CanvasFilters>): CanvasFilters {
  return { ...EMPTY_CANVAS_FILTERS, ...value };
}
