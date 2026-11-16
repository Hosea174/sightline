import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openNativeDialog } from '@tauri-apps/plugin-dialog';
import {
  Check,
  Globe,
  HardDrive,
  Plus,
  Search,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import {
  FONT_EXTENSIONS,
  formatFontWeightLabel,
  getFileExtension,
  isFontFilename,
  parseFontFilenameMeta,
} from './logic';
import { Asset, Source } from './types';

export type AddFontTab = 'google' | 'local' | 'upload';

export type GoogleFontCatalogEntry = {
  family: string;
  category: string;
  variants: string[];
  popularity: number;
  designers: string[];
};

export type SystemFontVariant = {
  family: string;
  fullName: string;
  weight: number;
  style: string;
  path: string;
  format: string;
};

type UploadedFontRow = {
  id: string;
  name: string;
  format: string;
  weight: number;
  style: 'normal' | 'italic';
  fileObj?: File;
  nativePath?: string;
};

const FALLBACK_GOOGLE_FONTS: GoogleFontCatalogEntry[] = [
  { family: 'Inter', category: 'Sans Serif', variants: ['300', '400', '500', '600', '700'], popularity: 1, designers: ['Rasmus Andersson'] },
  { family: 'Plus Jakarta Sans', category: 'Sans Serif', variants: ['400', '500', '600', '700', '400i'], popularity: 2, designers: ['Tokotype'] },
  { family: 'DM Sans', category: 'Sans Serif', variants: ['400', '500', '700', '400i'], popularity: 3, designers: ['Colophon Foundry'] },
  { family: 'Space Grotesk', category: 'Sans Serif', variants: ['300', '400', '500', '600', '700'], popularity: 4, designers: ['Florian Karsten'] },
  { family: 'Instrument Serif', category: 'Serif', variants: ['400', '400i'], popularity: 5, designers: ['Rodrigo Fuenzalida'] },
  { family: 'Playfair Display', category: 'Serif', variants: ['400', '500', '600', '700', '400i', '700i'], popularity: 6, designers: ['Claus Eggers Sørensen'] },
  { family: 'Fraunces', category: 'Serif', variants: ['300', '400', '600', '700', '400i'], popularity: 7, designers: ['Undercase Type'] },
  { family: 'Newsreader', category: 'Serif', variants: ['400', '500', '600', '400i'], popularity: 8, designers: ['Production Type'] },
  { family: 'Syne', category: 'Display', variants: ['400', '500', '600', '700', '800'], popularity: 9, designers: ['Bonjour Monde'] },
  { family: 'JetBrains Mono', category: 'Monospace', variants: ['400', '500', '600', '700', '400i'], popularity: 10, designers: ['JetBrains'] },
  { family: 'IBM Plex Mono', category: 'Monospace', variants: ['400', '500', '600', '700'], popularity: 11, designers: ['Mike Abbink'] },
  { family: 'Manrope', category: 'Sans Serif', variants: ['300', '400', '500', '600', '700', '800'], popularity: 12, designers: ['Mikhail Sharanda'] },
];

const GOOGLE_CATEGORIES = ['All', 'Sans Serif', 'Serif', 'Display', 'Handwriting', 'Monospace'];
const WEIGHT_OPTIONS = [100, 200, 300, 350, 400, 500, 600, 700, 800, 900];

function formatGoogleVariantLabel(v: string): string {
  const isItalic = v.endsWith('i');
  const w = Number(v.replace(/i$/i, '')) || 400;
  return `${w} ${formatFontWeightLabel(w)}${isItalic ? ' Italic' : ''}`;
}

export function AddFontDialog({
  open,
  initialTab,
  nativeApp,
  rootReady,
  onOpenChange,
  onImportGoogleFont,
  onImportSystemFont,
  onImportManualFiles,
}: {
  open: boolean;
  initialTab: AddFontTab;
  nativeApp: boolean;
  rootReady: boolean;
  onOpenChange: (open: boolean) => void;
  onImportGoogleFont: (family: string, variants: string[]) => Promise<void>;
  onImportSystemFont: (family: string, variants: SystemFontVariant[]) => Promise<void>;
  onImportManualFiles: (payload: {
    family: string;
    tags: string[];
    notes: string;
    rows: Array<{
      name: string;
      weight: number;
      style: 'normal' | 'italic';
      fileObj?: File;
      nativePath?: string;
    }>;
  }) => Promise<void>;
}) {
  const [tab, setTab] = useState<AddFontTab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Google Fonts state
  const [googleCatalog, setGoogleCatalog] = useState<GoogleFontCatalogEntry[]>([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleQuery, setGoogleQuery] = useState('');
  const [googleCategory, setGoogleCategory] = useState('All');
  const [googleLimit, setGoogleLimit] = useState(30);
  const [selectedGoogle, setSelectedGoogle] = useState<GoogleFontCatalogEntry | null>(null);
  const [selectedGoogleVariants, setSelectedGoogleVariants] = useState<string[]>(['400']);

  // Local System Fonts state
  const [localVariants, setLocalVariants] = useState<SystemFontVariant[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [localReload, setLocalReload] = useState(0);
  const [localQuery, setLocalQuery] = useState('');
  const [localLimit, setLocalLimit] = useState(40);
  const [selectedLocalFamily, setSelectedLocalFamily] = useState<string | null>(null);
  const [selectedLocalPaths, setSelectedLocalPaths] = useState<string[]>([]);

  // Manual Upload state
  const [uploadFamily, setUploadFamily] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploadRows, setUploadRows] = useState<UploadedFontRow[]>([]);
  const [uploadDragging, setUploadDragging] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setError('');
  }, [open, initialTab]);

  // Fetch Google Fonts catalog when Google tab is opened
  useEffect(() => {
    if (!open || tab !== 'google' || googleCatalog.length > 0) return;
    let alive = true;
    setGoogleLoading(true);
    setError('');
    const load = async () => {
      try {
        if (nativeApp) {
          const entries = await invoke<GoogleFontCatalogEntry[]>('fetch_google_fonts_catalog');
          if (alive) setGoogleCatalog(entries);
        } else if (alive) {
          setGoogleCatalog(FALLBACK_GOOGLE_FONTS);
        }
      } catch (e) {
        if (alive) {
          setGoogleCatalog(FALLBACK_GOOGLE_FONTS);
          setError(String(e));
        }
      } finally {
        if (alive) setGoogleLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [open, tab, nativeApp, googleCatalog.length]);

  // Fetch system fonts when Local tab is opened
  useEffect(() => {
    if (!open || tab !== 'local' || localVariants.length > 0) return;
    if (!nativeApp) return;
    let alive = true;
    setLocalLoading(true);
    setLocalError('');
    invoke<SystemFontVariant[]>('list_system_fonts')
      .then((rows) => {
        if (alive) setLocalVariants(rows);
      })
      .catch((e) => {
        if (alive) setLocalError(String(e));
      })
      .finally(() => {
        if (alive) setLocalLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, tab, nativeApp, localVariants.length, localReload]);

  const filteredGoogle = useMemo(() => {
    const q = googleQuery.trim().toLowerCase();
    return googleCatalog.filter(
      (f) =>
        (googleCategory === 'All' || f.category.toLowerCase() === googleCategory.toLowerCase()) &&
        (!q ||
          f.family.toLowerCase().includes(q) ||
          f.designers.some((d) => d.toLowerCase().includes(q)))
    );
  }, [googleCatalog, googleCategory, googleQuery]);

  const visibleGoogle = useMemo(
    () => filteredGoogle.slice(0, googleLimit),
    [filteredGoogle, googleLimit]
  );

  // Inject preview CSS stylesheet for visible Google Fonts
  useEffect(() => {
    if (!open || tab !== 'google' || !visibleGoogle.length) return;
    const familiesParam = visibleGoogle
      .slice(0, 24)
      .map((f) => `family=${encodeURIComponent(f.family).replace(/%20/g, '+')}`)
      .join('&');
    const href = `https://fonts.googleapis.com/css2?${familiesParam}&display=swap`;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [open, tab, visibleGoogle]);

  const groupedLocal = useMemo(() => {
    const map = new Map<string, SystemFontVariant[]>();
    for (const v of localVariants) {
      const key = v.family;
      const list = map.get(key);
      if (list) list.push(v);
      else map.set(key, [v]);
    }
    const q = localQuery.trim().toLowerCase();
    return Array.from(map.entries())
      .map(([family, variants]) => ({ family, variants }))
      .filter(
        (g) =>
          !q ||
          g.family.toLowerCase().includes(q) ||
          g.variants.some((v) => v.fullName.toLowerCase().includes(q))
      );
  }, [localVariants, localQuery]);

  const visibleLocal = useMemo(
    () => groupedLocal.slice(0, localLimit),
    [groupedLocal, localLimit]
  );

  const selectedLocalGroup = useMemo(
    () => groupedLocal.find((g) => g.family === selectedLocalFamily) || null,
    [groupedLocal, selectedLocalFamily]
  );

  const selectGoogleFont = (entry: GoogleFontCatalogEntry) => {
    setSelectedGoogle(entry);
    const preferred = entry.variants.filter((v) => ['400', '500', '600', '700'].includes(v));
    setSelectedGoogleVariants(preferred.length ? preferred : [entry.variants[0] || '400']);
  };

  const selectLocalGroup = (family: string, variants: SystemFontVariant[]) => {
    setSelectedLocalFamily(family);
    setSelectedLocalPaths(variants.map((v) => v.path));
  };

  const stageUploadFiles = (files: File[]) => {
    const nextRows: UploadedFontRow[] = [];
    for (const file of files) {
      if (!isFontFilename(file.name)) {
        setError(`"${file.name}" does not have a recognized font extension.`);
        continue;
      }
      const meta = parseFontFilenameMeta(file.name);
      const ext = getFileExtension(file.name).toUpperCase();
      nextRows.push({
        id: crypto.randomUUID(),
        name: file.name,
        format: ext || 'FONT',
        weight: meta.weight,
        style: meta.style,
        fileObj: file,
      });
    }
    if (nextRows.length) {
      setError('');
      setUploadRows((prev) => [...prev, ...nextRows]);
      if (!uploadFamily.trim()) {
        const firstMeta = parseFontFilenameMeta(nextRows[0].name);
        setUploadFamily(firstMeta.family);
      }
    }
  };

  const browseUploadFiles = async () => {
    if (!nativeApp) {
      uploadInputRef.current?.click();
      return;
    }
    try {
      const picked = await openNativeDialog({
        multiple: true,
        directory: false,
        filters: [
          {
            name: 'All font files',
            extensions: [...FONT_EXTENSIONS],
          },
        ],
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      const nextRows: UploadedFontRow[] = [];
      for (const p of paths) {
        const name = p.split(/[\\/]/).pop() || 'Font';
        if (!isFontFilename(name)) continue;
        const meta = parseFontFilenameMeta(name);
        const ext = getFileExtension(name).toUpperCase();
        nextRows.push({
          id: crypto.randomUUID(),
          name,
          format: ext || 'FONT',
          weight: meta.weight,
          style: meta.style,
          nativePath: p,
        });
      }
      if (nextRows.length) {
        setError('');
        setUploadRows((prev) => [...prev, ...nextRows]);
        if (!uploadFamily.trim()) {
          const firstMeta = parseFontFilenameMeta(nextRows[0].name);
          setUploadFamily(firstMeta.family);
        }
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleImportGoogle = async () => {
    if (!selectedGoogle || !selectedGoogleVariants.length || busy) return;
    setBusy(true);
    setError('');
    try {
      await onImportGoogleFont(selectedGoogle.family, selectedGoogleVariants);
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleImportLocal = async () => {
    if (!selectedLocalGroup || !selectedLocalPaths.length || busy) return;
    const chosen = selectedLocalGroup.variants.filter((v) =>
      selectedLocalPaths.includes(v.path)
    );
    if (!chosen.length) return;
    setBusy(true);
    setError('');
    try {
      await onImportSystemFont(selectedLocalGroup.family, chosen);
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleImportUpload = async () => {
    if (!uploadRows.length || busy) return;
    const family =
      uploadFamily.trim() || parseFontFilenameMeta(uploadRows[0].name).family || 'Custom Font';
    setBusy(true);
    setError('');
    try {
      await onImportManualFiles({
        family,
        tags: uploadTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        notes: uploadNotes.trim(),
        rows: uploadRows.map((r) => ({
          name: r.name,
          weight: r.weight,
          style: r.style,
          fileObj: r.fileObj,
          nativePath: r.nativePath,
        })),
      });
      setUploadRows([]);
      setUploadFamily('');
      setUploadTags('');
      setUploadNotes('');
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="font-add-dialog">
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          accept={FONT_EXTENSIONS.map((e) => `.${e}`).join(',')}
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) stageUploadFiles(files);
            e.currentTarget.value = '';
          }}
        />
        <div className="font-add-head">
          <div>
            <DialogTitle>Add fonts</DialogTitle>
            <DialogDescription>
              Search Google Fonts, browse fonts installed on your computer, or drop multi-weight
              font files.
            </DialogDescription>
          </div>
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as AddFontTab);
            setError('');
          }}
          className="font-add-tabs"
        >
          <TabsList className="font-add-tablist">
            <TabsTrigger value="google">
              <Globe size={14} /> Google Fonts
            </TabsTrigger>
            <TabsTrigger value="local">
              <HardDrive size={14} /> Installed Fonts
            </TabsTrigger>
            <TabsTrigger value="upload">
              <Upload size={14} /> Upload Files
            </TabsTrigger>
          </TabsList>

          <TabsContent value="google" className="font-add-pane">
            <div className="font-search-bar">
              <div className="font-search-input-wrap">
                <Search size={15} />
                <Input
                  placeholder="Search 1,900+ Google Fonts..."
                  value={googleQuery}
                  onChange={(e) => {
                    setGoogleQuery(e.target.value);
                    setGoogleLimit(30);
                  }}
                />
              </div>
              <div className="font-cat-pills">
                {GOOGLE_CATEGORIES.map((c) => (
                  <Button
                    key={c}
                    type="button"
                    size="sm"
                    variant={googleCategory === c ? 'secondary' : 'ghost'}
                    onClick={() => {
                      setGoogleCategory(c);
                      setGoogleLimit(30);
                    }}
                  >
                    {c}
                  </Button>
                ))}
              </div>
            </div>

            <div className="font-picker-split">
              <div className="font-picker-list">
                {googleLoading && googleCatalog.length === 0 ? (
                  <div className="font-picker-empty">Loading Google Fonts catalog...</div>
                ) : visibleGoogle.length === 0 ? (
                  <div className="font-picker-empty">No Google Fonts match "{googleQuery}".</div>
                ) : (
                  <>
                    {visibleGoogle.map((entry) => {
                      const isSel = selectedGoogle?.family === entry.family;
                      return (
                        <button
                          type="button"
                          key={entry.family}
                          className={'font-picker-row' + (isSel ? ' selected' : '')}
                          onClick={() => selectGoogleFont(entry)}
                        >
                          <div className="font-picker-row-head">
                            <strong>{entry.family}</strong>
                            <span>
                              {entry.category} &middot; {entry.variants.length}{' '}
                              {entry.variants.length === 1 ? 'style' : 'styles'}
                            </span>
                          </div>
                          <div
                            className="font-picker-specimen"
                            style={{ fontFamily: `"${entry.family}", sans-serif` }}
                          >
                            The quick brown fox jumps over the lazy dog
                          </div>
                        </button>
                      );
                    })}
                    {filteredGoogle.length > visibleGoogle.length && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="font-load-more"
                        onClick={() => setGoogleLimit((n) => n + 30)}
                      >
                        Show more ({filteredGoogle.length - visibleGoogle.length} remaining)
                      </Button>
                    )}
                  </>
                )}
              </div>

              <div className="font-picker-detail">
                {selectedGoogle ? (
                  <>
                    <div className="font-detail-head">
                      <div>
                        <h4>{selectedGoogle.family}</h4>
                        <small>
                          {selectedGoogle.category}
                          {selectedGoogle.designers.length
                            ? ` · ${selectedGoogle.designers.slice(0, 2).join(', ')}`
                            : ''}
                        </small>
                      </div>
                      <Badge variant="secondary">TTF</Badge>
                    </div>
                    <p
                      className="font-detail-preview"
                      style={{ fontFamily: `"${selectedGoogle.family}", sans-serif` }}
                    >
                      Aa Bb Cc 0123456789
                    </p>
                    <div className="font-variants-header">
                      <span>Weights to import ({selectedGoogleVariants.length})</span>
                      <div className="font-variants-quick">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedGoogleVariants([...selectedGoogle.variants])}
                        >
                          All
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const core = selectedGoogle.variants.filter((v) =>
                              ['400', '700'].includes(v)
                            );
                            setSelectedGoogleVariants(
                              core.length ? core : [selectedGoogle.variants[0] || '400']
                            );
                          }}
                        >
                          Regular &amp; Bold
                        </Button>
                      </div>
                    </div>
                    <div className="font-variant-chips">
                      {selectedGoogle.variants.map((v) => {
                        const checked = selectedGoogleVariants.includes(v);
                        return (
                          <button
                            type="button"
                            key={v}
                            className={'font-variant-chip' + (checked ? ' active' : '')}
                            onClick={() =>
                              setSelectedGoogleVariants((prev) =>
                                prev.includes(v)
                                  ? prev.length > 1
                                    ? prev.filter((x) => x !== v)
                                    : prev
                                  : [...prev, v]
                              )
                            }
                          >
                            {checked && <Check size={12} />}
                            {formatGoogleVariantLabel(v)}
                          </button>
                        );
                      })}
                    </div>
                    <div className="font-detail-footer">
                      <Button
                        type="button"
                        disabled={!rootReady || busy || !selectedGoogleVariants.length}
                        onClick={() => void handleImportGoogle()}
                      >
                        {busy ? 'Downloading font...' : `Add ${selectedGoogle.family} to library`}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="font-detail-placeholder">
                    <Type size={20} />
                    <strong>Select a font family</strong>
                    <span>Choose weights and import directly into your Sightline library.</span>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="local" className="font-add-pane">
            <div className="font-search-bar">
              <div className="font-search-input-wrap">
                <Search size={15} />
                <Input
                  placeholder="Search fonts installed on your computer..."
                  value={localQuery}
                  onChange={(e) => {
                    setLocalQuery(e.target.value);
                    setLocalLimit(40);
                  }}
                />
              </div>
              <span className="font-local-count">
                {groupedLocal.length} {groupedLocal.length === 1 ? 'family' : 'families'}
              </span>
            </div>

            <div className="font-picker-split">
              <div className="font-picker-list">
                {!nativeApp ? (
                  <div className="font-picker-empty">
                    Open Sightline on your Windows desktop to search locally installed fonts.
                  </div>
                ) : localLoading ? (
                  <div className="font-picker-empty">Scanning installed system fonts...</div>
                ) : localError ? (
                  <div className="font-picker-empty" role="alert">
                    <p>Couldn't load installed fonts.</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => setLocalReload((n) => n + 1)}>
                      Retry
                    </Button>
                  </div>
                ) : visibleLocal.length === 0 ? (
                  <div className="font-picker-empty">
                    {localQuery.trim() ? `No installed fonts match "${localQuery.trim()}".` : 'No installed fonts were found.'}
                  </div>
                ) : (
                  <>
                    {visibleLocal.map((group) => {
                      const isSel = selectedLocalFamily === group.family;
                      const formats = Array.from(new Set(group.variants.map((v) => v.format)));
                      return (
                        <button
                          type="button"
                          key={group.family}
                          className={'font-picker-row' + (isSel ? ' selected' : '')}
                          onClick={() => selectLocalGroup(group.family, group.variants)}
                        >
                          <div className="font-picker-row-head">
                            <strong>{group.family}</strong>
                            <span>
                              {group.variants.length}{' '}
                              {group.variants.length === 1 ? 'variant' : 'variants'} &middot;{' '}
                              {formats.join(', ')}
                            </span>
                          </div>
                          <div
                            className="font-picker-specimen"
                            style={{ fontFamily: `"${group.family}", sans-serif` }}
                          >
                            The quick brown fox jumps over the lazy dog
                          </div>
                        </button>
                      );
                    })}
                    {groupedLocal.length > visibleLocal.length && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="font-load-more"
                        onClick={() => setLocalLimit((n) => n + 40)}
                      >
                        Show more ({groupedLocal.length - visibleLocal.length} remaining)
                      </Button>
                    )}
                  </>
                )}
              </div>

              <div className="font-picker-detail">
                {selectedLocalGroup ? (
                  <>
                    <div className="font-detail-head">
                      <div>
                        <h4>{selectedLocalGroup.family}</h4>
                        <small>
                          {selectedLocalGroup.variants.length}{' '}
                          {selectedLocalGroup.variants.length === 1
                            ? 'installed file'
                            : 'installed files'}
                        </small>
                      </div>
                      <Badge variant="secondary">LOCAL</Badge>
                    </div>
                    <p
                      className="font-detail-preview"
                      style={{ fontFamily: `"${selectedLocalGroup.family}", sans-serif` }}
                    >
                      Aa Bb Cc 0123456789
                    </p>
                    <div className="font-variants-header">
                      <span>Variants to import ({selectedLocalPaths.length})</span>
                      <div className="font-variants-quick">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setSelectedLocalPaths(selectedLocalGroup.variants.map((v) => v.path))
                          }
                        >
                          Select all
                        </Button>
                      </div>
                    </div>
                    <div className="font-variant-chips">
                      {selectedLocalGroup.variants.map((v) => {
                        const checked = selectedLocalPaths.includes(v.path);
                        return (
                          <button
                            type="button"
                            key={v.path}
                            className={'font-variant-chip' + (checked ? ' active' : '')}
                            onClick={() =>
                              setSelectedLocalPaths((prev) =>
                                prev.includes(v.path)
                                  ? prev.length > 1
                                    ? prev.filter((x) => x !== v.path)
                                    : prev
                                  : [...prev, v.path]
                              )
                            }
                          >
                            {checked && <Check size={12} />}
                            {v.weight} {formatFontWeightLabel(v.weight)}
                            {v.style === 'italic' ? ' Italic' : ''} &middot; {v.format}
                          </button>
                        );
                      })}
                    </div>
                    <div className="font-detail-footer">
                      <Button
                        type="button"
                        disabled={!rootReady || busy || !selectedLocalPaths.length}
                        onClick={() => void handleImportLocal()}
                      >
                        {busy
                          ? 'Importing...'
                          : `Add ${selectedLocalGroup.family} to library`}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="font-detail-placeholder">
                    <HardDrive size={20} />
                    <strong>Select an installed font</strong>
                    <span>
                      All weights for a family stay grouped into a single font entry in Sightline.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="upload" className="font-add-pane">
            <div
              className={'font-upload-dropzone' + (uploadDragging ? ' dragging' : '')}
              onDragOver={(e) => {
                e.preventDefault();
                setUploadDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node)) {
                  setUploadDragging(false);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setUploadDragging(false);
                stageUploadFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <Upload size={20} />
              <div>
                <strong>Drop font files here for 1 font family</strong>
                <small>
                  Supports multiple weights &amp; styles in any format (TTF, OTF, WOFF, WOFF2, EOT,
                  TTC, PFB, DFONT, etc.)
                </small>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void browseUploadFiles()}>
                <Plus size={14} /> Choose files
              </Button>
            </div>

            <div className="font-upload-meta">
              <label>
                <span>Font family name</span>
                <Input
                  value={uploadFamily}
                  onChange={(e) => setUploadFamily(e.target.value)}
                  placeholder="e.g. Satoshi, PP Neue Montreal"
                />
              </label>
              <label>
                <span>Tags (optional)</span>
                <Input
                  value={uploadTags}
                  onChange={(e) => setUploadTags(e.target.value)}
                  placeholder="Grotesk, display, editorial"
                />
              </label>
            </div>

            {uploadRows.length > 0 && (
              <div className="font-upload-variants">
                <div className="font-variants-header">
                  <span>
                    Staged variants ({uploadRows.length}{' '}
                    {uploadRows.length === 1 ? 'file' : 'files'} &rarr; 1 font family)
                  </span>
                </div>
                <div className="font-upload-list">
                  {uploadRows.map((row) => (
                    <div className="font-upload-row" key={row.id}>
                      <div className="font-upload-file">
                        <Badge variant="secondary">{row.format}</Badge>
                        <span title={row.name}>{row.name}</span>
                      </div>
                      <select
                        aria-label={`Weight for ${row.name}`}
                        value={row.weight}
                        onChange={(e) =>
                          setUploadRows((prev) =>
                            prev.map((r) =>
                              r.id === row.id ? { ...r, weight: Number(e.target.value) } : r
                            )
                          )
                        }
                      >
                        {WEIGHT_OPTIONS.map((w) => (
                          <option key={w} value={w}>
                            {w} {formatFontWeightLabel(w)}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`Style for ${row.name}`}
                        value={row.style}
                        onChange={(e) =>
                          setUploadRows((prev) =>
                            prev.map((r) =>
                              r.id === row.id
                                ? { ...r, style: e.target.value as 'normal' | 'italic' }
                                : r
                            )
                          )
                        }
                      >
                        <option value="normal">Normal</option>
                        <option value="italic">Italic</option>
                      </select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${row.name}`}
                        onClick={() =>
                          setUploadRows((prev) => prev.filter((r) => r.id !== row.id))
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="font-detail-footer">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!rootReady || busy || uploadRows.length === 0}
                onClick={() => void handleImportUpload()}
              >
                {busy
                  ? 'Importing...'
                  : `Add ${uploadFamily.trim() || 'font'} (${uploadRows.length} ${
                      uploadRows.length === 1 ? 'file' : 'files'
                    })`}
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {error && (
          <p className="form-error" role="alert" style={{ marginTop: 4 }}>
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
