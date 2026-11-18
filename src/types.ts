export type Annotation = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  time?: number;
  start?: number;
  end?: number;
};

export type Asset = {
  favorite?: boolean;
  trashedAt?: string;
  id: string;
  name: string;
  file: string;
  kind: 'image' | 'video' | 'font' | 'other';
  family?: string;
  weight?: number;
  weightMin?: number;
  weightMax?: number;
  isVariable?: boolean;
  style?: 'normal' | 'italic';
  fontSource?: 'local' | 'google' | 'upload' | 'capture';
  thumbnail?: string;
  /** Video frame time in seconds when the thumbnail was chosen by the user. */
  posterTime?: number;
  customThumbnail?: boolean;
  /** Small silent H.264 copy in `previews/`, used for looping previews instead of the original. */
  previewVideo?: string;
  palette?: string[];
  paletteVersion?: number;
  sourceUrl?: string;
  tags?: string[];
  notes?: string;
  annotations?: Annotation[];
  x?: number;
  y?: number;
};

export type Capture = {
  id: string;
  file: string;
  title: string;
  url: string;
  kind: 'image' | 'video' | 'font';
  name?: string;
  family?: string;
  weight?: number;
  weightMin?: number;
  weightMax?: number;
  isVariable?: boolean;
  style?: 'normal' | 'italic';
  fontSource?: 'local' | 'google' | 'upload' | 'capture';
  tags?: string[];
  notes?: string;
  annotations?: Annotation[];
  category?: string;
};

export type Source = {
  favorite?: boolean;
  coverId?: string;
  favicon?: string;
  trashedAt?: string;
  id: string;
  title: string;
  url: string;
  category: string;
  tags: string[];
  notes: string;
  folder?: string;
  assets: Asset[];
  x: number;
  y: number;
  created: string;
};

export const CATEGORIES = [
  'Web design',
  'Illustration',
  'Motion graphics',
  'Post Ideas',
  'Other',
] as const;
