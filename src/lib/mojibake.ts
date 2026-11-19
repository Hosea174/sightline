// Repairs text that was UTF-8 bytes decoded as Windows-1252/Latin-1 (up to four layers deep).
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

// A UTF-8 lead byte (C2-F4) rendered as a letter, immediately followed by a continuation byte (80-BF) rendered as a symbol.
const TRAIL = '[\\u0080-\\u00bf\\u0152\\u0153\\u0160\\u0161\\u0178\\u017d\\u017e\\u0192\\u02c6\\u02dc\\u2013\\u2014\\u2018-\\u201e\\u2020-\\u2022\\u2026\\u2030\\u2039\\u203a\\u20ac\\u2122]';
const MARKER = new RegExp(`[\\u00c2-\\u00f4]${TRAIL}`);
const utf8 = new TextDecoder('utf-8', { fatal: true });

function reverseOnce(value: string): string | null {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const byte = code < 0x100 ? code : CP1252[code];
    if (byte === undefined) return null;
    bytes[i] = byte;
  }
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}

export function fixMojibake(value: string): string {
  let current = value;
  for (let pass = 0; pass < 4 && MARKER.test(current); pass++) {
    const next = reverseOnce(current);
    if (next === null || next.length >= current.length || next.includes('\ufffd')) break;
    current = next;
  }
  return current;
}

/** Deep-repairs every string in a parsed JSON value. Returns the same reference when nothing changed. */
export function fixMojibakeDeep<T>(value: T): T {
  if (typeof value === 'string') return fixMojibake(value) as unknown as T;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const fixed = fixMojibakeDeep(item);
      if (fixed !== item) changed = true;
      return fixed;
    });
    return (changed ? out : value) as unknown as T;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const fixed = fixMojibakeDeep(item);
      if (fixed !== item) changed = true;
      out[key] = fixed;
    }
    return (changed ? out : value) as T;
  }
  return value;
}
