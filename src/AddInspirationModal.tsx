import { ChoiceMenu } from './components/ui/choice-menu';
import React, { useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open as openNativeDialog } from '@tauri-apps/plugin-dialog';
import {
  ChevronLeft,
  ChevronRight,
  Globe,
  Image as ImageIcon,
  MessageSquarePlus,
  Play,
  Plus,
  Sparkles,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { displayUrl, filterTagSuggestions, getFileExtension, safeHttpUrl } from './logic';
import { Annotation, Asset, CATEGORIES } from './types';

export type StagedInspirationAsset = {
  id: string;
  name: string;
  kind: 'image' | 'video';
  previewUrl: string;
  isObjectUrl: boolean;
  fileObj?: File;
  nativePath?: string;
  tags: string[];
  notes: string;
  annotations: Annotation[];
};

export type AddInspirationPayload = {
  title: string;
  url: string;
  category: string;
  tags: string[];
  notes: string;
  coverId: string | null;
  assets: StagedInspirationAsset[];
};

type Props = {
  open: boolean;
  defaultCategory: string;
  knownTags: string[];
  nativeApp: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: AddInspirationPayload) => Promise<void>;
  renderAnnotations: (props: {
    asset: Asset;
    onSave: (annotations: Annotation[]) => Promise<boolean>;
  }) => React.ReactNode;
  renderVideoPlayer: (url: string, keyId: string) => React.ReactNode;
};

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv']);

const isTextEntryElement = (el: EventTarget | null): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (/^(TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  if (el instanceof HTMLInputElement) {
    return !/^(range|button|checkbox|radio|submit|reset|color|file)$/i.test(el.type);
  }
  return false;
};

function TagInputField({
  id,
  tags,
  knownTags,
  placeholder,
  onChange,
}: {
  id: string;
  tags: string[];
  knownTags: string[];
  placeholder?: string;
  onChange: (next: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const options = dismissed ? [] : filterTagSuggestions(knownTags, input, tags);
  const safeActive = options.length ? Math.min(active, options.length - 1) : -1;

  useEffect(() => {
    if (safeActive < 0) return;
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [safeActive, options.length]);

  const addTag = (value: string) => {
    const clean = value.trim();
    const canonical = knownTags.find((t) => t.toLowerCase() === clean.toLowerCase()) || clean;
    if (canonical && !tags.some((t) => t.toLowerCase() === canonical.toLowerCase())) {
      onChange([...tags, canonical]);
    }
    setInput('');
    setActive(0);
    setDismissed(false);
  };

  return (
    <div className="viewer-tags">
      <div className="viewer-tag-field">
        {tags.map((tag) => (
          <span className="viewer-tag" key={tag}>
            {tag}
            <Button
              variant="ghost"
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => onChange(tags.filter((t) => t !== tag))}
            >
              <X size={12} aria-hidden="true" />
            </Button>
          </span>
        ))}
        <Input
          id={id}
          value={input}
          placeholder={placeholder || 'Add a tag...'}
          autoComplete="off"
          aria-autocomplete="list"
          onChange={(e) => {
            setInput(e.target.value);
            setActive(0);
            setDismissed(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && options.length) {
              e.preventDefault();
              setActive((Math.max(0, safeActive) + 1) % options.length);
            } else if (e.key === 'ArrowUp' && options.length) {
              e.preventDefault();
              setActive((Math.max(0, safeActive) + options.length - 1) % options.length);
            } else if (e.key === 'Escape' && options.length) {
              e.preventDefault();
              setDismissed(true);
            } else if (['Enter', 'Tab', ','].includes(e.key) && input.trim()) {
              e.preventDefault();
              addTag(e.key === ',' ? input : (safeActive >= 0 ? options[safeActive] : undefined) || input);
            } else if (e.key === 'Backspace' && !input && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (input.trim()) addTag(input);
            setDismissed(false);
          }}
        />
      </div>
      {options.length > 0 && (
        <div ref={listRef} className="viewer-tag-suggestions" role="listbox">
          {options.map((tag, i) => (
            <Button
              variant="ghost"
              type="button"
              role="option"
              aria-selected={i === safeActive}
              key={tag}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addTag(tag)}
            >
              {tag}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AddInspirationModal({
  open,
  defaultCategory,
  knownTags,
  nativeApp,
  saving,
  onClose,
  onSave,
  renderAnnotations,
  renderVideoPlayer,
}: Props) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState(
    CATEGORIES.includes(defaultCategory as (typeof CATEGORIES)[number])
      ? defaultCategory
      : 'Web design'
  );
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [assets, setAssets] = useState<StagedInspirationAsset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [coverId, setCoverId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [stageDragging, setStageDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setUrl('');
    setCategory(
      CATEGORIES.includes(defaultCategory as (typeof CATEGORIES)[number])
        ? defaultCategory
        : 'Web design'
    );
    setTags([]);
    setNotes('');
    setAssets([]);
    setActiveId(null);
    setCoverId(null);
    setFormError('');
    setStageDragging(false);
    return () => {
      for (const u of objectUrlsRef.current) {
        URL.revokeObjectURL(u);
      }
      objectUrlsRef.current = [];
    };
  }, [open, defaultCategory]);

  const stageFileObjects = (files: File[]) => {
    const added: StagedInspirationAsset[] = [];
    for (const file of files) {
      const ext = getFileExtension(file.name);
      const isVideo = VIDEO_EXTS.has(ext) || file.type.startsWith('video/');
      const isImage = IMAGE_EXTS.has(ext) || file.type.startsWith('image/');
      if (!isImage && !isVideo) {
        setFormError(`Unsupported file "${file.name}". Drop images or videos.`);
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      objectUrlsRef.current.push(previewUrl);
      added.push({
        id: crypto.randomUUID(),
        name: file.name,
        kind: isVideo ? 'video' : 'image',
        previewUrl,
        isObjectUrl: true,
        fileObj: file,
        tags: [],
        notes: '',
        annotations: [],
      });
    }
    if (added.length) {
      setFormError('');
      setAssets((prev) => [...prev, ...added]);
      setActiveId((prev) => prev || added[0].id);
      setCoverId((prev) => prev || added[0].id);
    }
  };

  const browseFiles = async () => {
    if (!nativeApp) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const picked = await openNativeDialog({
        multiple: true,
        directory: false,
        filters: [
          {
            name: 'Images & videos',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'mp4', 'webm', 'mov', 'mkv'],
          },
        ],
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      const added: StagedInspirationAsset[] = [];
      for (const path of paths) {
        const name = path.split(/[\\/]/).pop() || 'Asset';
        const ext = getFileExtension(name);
        const isVideo = VIDEO_EXTS.has(ext);
        const isImage = IMAGE_EXTS.has(ext);
        if (!isImage && !isVideo) continue;
        added.push({
          id: crypto.randomUUID(),
          name,
          kind: isVideo ? 'video' : 'image',
          previewUrl: convertFileSrc(path),
          isObjectUrl: false,
          nativePath: path,
          tags: [],
          notes: '',
          annotations: [],
        });
      }
      if (added.length) {
        setFormError('');
        setAssets((prev) => [...prev, ...added]);
        setActiveId((prev) => prev || added[0].id);
        setCoverId((prev) => prev || added[0].id);
      }
    } catch (e) {
      setFormError(String(e));
    }
  };

  const [reorderUi, setReorderUi] = useState<{
    dragId: string;
    overId: string | null;
    after: boolean;
  } | null>(null);
  const suppressAssetClickRef = useRef(false);

  const reorderStagedAssets = (dragId: string, targetId: string, after: boolean) => {
    if (dragId === targetId) return;
    setAssets((prev) => {
      const fromIndex = prev.findIndex((a) => a.id === dragId);
      if (fromIndex < 0 || !prev.some((a) => a.id === targetId)) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      const targetIndex = next.findIndex((a) => a.id === targetId);
      if (targetIndex < 0) return prev;
      next.splice(targetIndex + (after ? 1 : 0), 0, moved);
      setCoverId(next[0]?.id || null);
      return next;
    });
  };

  const startPointerDrag = (
    e: React.PointerEvent<HTMLElement>,
    dragId: string,
    axis: 'x' | 'y'
  ) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest('.remove-asset')) return;
    const containerEl = e.currentTarget.parentElement;
    if (!containerEl) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let overId: string | null = null;
    let after = false;

    const pickTarget = (cx: number, cy: number) => {
      const nodes = Array.from(containerEl.querySelectorAll<HTMLElement>('[data-reorder-id]'));
      if (!nodes.length) return null;
      const coord = axis === 'x' ? cx : cy;
      let bestId: string | null = null;
      let bestAfter = false;
      let bestDist = Infinity;
      for (const node of nodes) {
        const id = node.dataset.reorderId;
        if (!id) continue;
        const r = node.getBoundingClientRect();
        const start = axis === 'x' ? r.left : r.top;
        const end = axis === 'x' ? r.right : r.bottom;
        const mid = (start + end) / 2;
        const dist = coord < start ? start - coord : coord > end ? coord - end : 0;
        if (dist < bestDist) {
          bestDist = dist;
          bestId = id;
          bestAfter = coord > mid;
          if (dist === 0) break;
        }
      }
      return bestId ? { id: bestId, after: bestAfter } : null;
    };

    const onMove = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        active = true;
        suppressAssetClickRef.current = true;
        document.body.classList.add('reordering-assets');
      }
      const target = pickTarget(ev.clientX, ev.clientY);
      overId = target?.id ?? null;
      after = target?.after ?? false;
      setReorderUi((prev) =>
        prev?.dragId === dragId && prev?.overId === overId && prev?.after === after
          ? prev
          : { dragId, overId, after }
      );
    };

    const cleanup = (commit: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.classList.remove('reordering-assets');
      setReorderUi(null);
      if (active) {
        window.setTimeout(() => {
          suppressAssetClickRef.current = false;
        }, 0);
        if (commit && overId && overId !== dragId) {
          reorderStagedAssets(dragId, overId, after);
        }
      }
    };

    const onUp = () => cleanup(true);
    const onCancel = () => cleanup(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) {
        e.preventDefault();
        stageFileObjects(files);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        const activeTarget =
          (e.target instanceof HTMLElement ? e.target : null) ||
          (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        if (
          activeTarget &&
          isTextEntryElement(activeTarget) &&
          !activeTarget.closest('.annotation-note-editor')
        ) {
          e.preventDefault();
          activeTarget.blur();
          return;
        }
        if (!saving) {
          e.preventDefault();
          onClose();
        }
      }
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, saving, onClose]);

  if (!open) return null;

  const activeIndex = assets.findIndex((a) => a.id === activeId);
  const activeAsset = activeIndex >= 0 ? assets[activeIndex] : assets[0] || null;

  const updateActiveAsset = (changes: Partial<StagedInspirationAsset>) => {
    if (!activeAsset) return;
    setAssets((prev) => prev.map((a) => (a.id === activeAsset.id ? { ...a, ...changes } : a)));
  };

  const removeStagedAsset = (id: string) => {
    setAssets((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.isObjectUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      const next = prev.filter((a) => a.id !== id);
      if (activeId === id) {
        setActiveId(next[0]?.id || null);
      }
      if (coverId === id) {
        setCoverId(next[0]?.id || null);
      }
      return next;
    });
  };

  const canSave =
    assets.length > 0 || title.trim().length > 0 || url.trim().length > 0 || notes.trim().length > 0;

  const handleSubmit = async () => {
    if (saving || !canSave) return;
    const rawUrl = url.trim();
    const validUrl = rawUrl ? safeHttpUrl(rawUrl) : '';
    if (rawUrl && !validUrl) {
      setFormError('Enter a valid http:// or https:// website link.');
      return;
    }
    setFormError('');
    const derivedTitle =
      title.trim() ||
      (validUrl ? displayUrl(validUrl) : '') ||
      assets[0]?.name.replace(/\.[^.]+$/, '') ||
      'Untitled inspiration';

    await onSave({
      title: derivedTitle,
      url: validUrl || '',
      category,
      tags,
      notes,
      coverId,
      assets,
    });
  };

  const virtualAsset: Asset | null = activeAsset
    ? {
        id: activeAsset.id,
        name: activeAsset.name,
        file: activeAsset.previewUrl,
        kind: activeAsset.kind,
        tags: activeAsset.tags,
        notes: activeAsset.notes,
        annotations: activeAsset.annotations,
      }
    : null;

  const totalAnnotations = assets.reduce((sum, a) => sum + a.annotations.length, 0);

  return (
    <div
      className="overlay"
      onMouseDown={() => {
        if (!saving) onClose();
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) stageFileObjects(files);
          e.currentTarget.value = '';
        }}
      />
      <div
        className="preview-dialog media-viewer"
        role="dialog"
        aria-modal="true"
        aria-label="Add inspiration"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => {
          const active = document.activeElement;
          if (!isTextEntryElement(active)) return;
          const target = e.target as HTMLElement | null;
          if (
            !target ||
            target === active ||
            target.closest(
              'input:not([type="range"]),textarea,select,.viewer-tag-field,.viewer-tag-suggestions,.annotation-note-editor,[contenteditable="true"]'
            )
          ) {
            return;
          }
          active.blur();
        }}
      >
        <div className="preview-header">
          <div className="preview-header-left">
            <span className="site-icon">
              {url.trim() ? <Globe size={14} /> : <Sparkles size={14} />}
            </span>
            <div className="preview-header-title">
              <strong>{title.trim() || 'New inspiration'}</strong>
              <span>
                {category} &middot; {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
              </span>
            </div>
          </div>
          <div className="preview-actions create-header-actions">
            {assets.length > 1 && activeIndex >= 0 && (
              <span className="viewer-counter">
                {activeIndex + 1} / {assets.length}
              </span>
            )}
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canSave || saving}
              onClick={() => void handleSubmit()}
            >
              {saving ? 'Saving...' : 'Save inspiration'}
            </Button>
          </div>
        </div>

        <div className="viewer-body">
          <div className="viewer-main">
            <div
              className={'viewer-stage' + (stageDragging ? ' stage-dragging' : '')}
              onDragOver={(e) => {
                e.preventDefault();
                setStageDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node)) {
                  setStageDragging(false);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setStageDragging(false);
                stageFileObjects(Array.from(e.dataTransfer.files));
              }}
            >
              {activeAsset && virtualAsset ? (
                <>
                  {renderAnnotations({
                    asset: virtualAsset,
                    onSave: async (nextAnnotations) => {
                      updateActiveAsset({ annotations: nextAnnotations });
                      return true;
                    },
                  })}
                  {activeAsset.kind === 'image' ? (
                    <img src={activeAsset.previewUrl} alt={activeAsset.name} />
                  ) : (
                    renderVideoPlayer(activeAsset.previewUrl, activeAsset.id)
                  )}
                  {assets.length > 1 && activeIndex >= 0 && (
                    <>
                      <Button
                        variant="ghost"
                        type="button"
                        className="stage-nav prev"
                        aria-label="Previous item"
                        onClick={() =>
                          setActiveId(assets[(activeIndex + assets.length - 1) % assets.length].id)
                        }
                      >
                        <ChevronLeft size={18} />
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        className="stage-nav next"
                        aria-label="Next item"
                        onClick={() => setActiveId(assets[(activeIndex + 1) % assets.length].id)}
                      >
                        <ChevronRight size={18} />
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <div className="create-dropzone">
                  <div className="create-dropzone-icon">
                    <Upload size={22} />
                  </div>
                  <h3>Drop images or videos here</h3>
                  <p>
                    Add several images or videos by dragging them in, pasting, or browsing your computer.
                  </p>
                  <div className="create-dropzone-actions">
                    <Button type="button" size="sm" onClick={() => void browseFiles()}>
                      <Plus size={15} /> Choose files
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div className="viewer-timing-slot" id="viewer-timing-slot" />
          </div>

          <aside className="viewer-details">
            <Tabs defaultValue="details" className="viewer-tabs-root">
              <div className="viewer-details-head">
                <TabsList className="viewer-tabs">
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="assets">
                    Assets
                    {assets.length > 0 && <span className="viewer-tab-count">{assets.length}</span>}
                  </TabsTrigger>
                  <TabsTrigger value="notes">
                    Notes
                    {totalAnnotations > 0 && (
                      <span className="viewer-tab-count">{totalAnnotations}</span>
                    )}
                  </TabsTrigger>
                </TabsList>
              </div>

              <div className="viewer-details-scroll">
                <TabsContent value="details" forceMount>
                  <div className="viewer-form">
                    {formError && (
                      <p className="form-error" role="alert" style={{ marginTop: 0, marginBottom: 12 }}>
                        {formError}
                      </p>
                    )}
                    <div className="viewer-section-head">
                      <span>Inspiration</span>
                      <span className="viewer-kind-pill">Draft</span>
                    </div>
                    <div className="viewer-field-group">
                      <label>
                        <span>Name</span>
                        <Input
                          autoFocus
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="Studio, visual study, or idea title"
                        />
                      </label>
                      <label>
                        <span>Website link (optional)</span>
                        <Input
                          value={url}
                          onChange={(e) => {
                            setUrl(e.target.value);
                            if (formError) setFormError('');
                          }}
                          placeholder="https://"
                        />
                      </label>
                      <label>
                        <span>Category</span>
                        <ChoiceMenu label="Category" value={category} onChange={setCategory} options={CATEGORIES.map(value=>({value,label:value}))}/>
                      </label>
                      <div className="viewer-tags-wrap">
                        <label htmlFor="create-source-tags">
                          <span>Tags</span>
                        </label>
                        <TagInputField
                          id="create-source-tags"
                          tags={tags}
                          knownTags={knownTags}
                          placeholder="Add tags..."
                          onChange={setTags}
                        />
                      </div>
                      <label>
                        <span>Notes</span>
                        <Textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="What caught your eye?"
                        />
                      </label>
                    </div>

                    {activeAsset && (
                      <>
                        <div className="viewer-section-head asset-section">
                          <span>Selected item</span>
                          <span className="viewer-kind-pill">
                            {activeAsset.kind === 'video' ? 'Video' : 'Image'}
                          </span>
                        </div>
                        <div className="viewer-field-group">
                          <label>
                            <span>Item name</span>
                            <Input
                              value={activeAsset.name}
                              onChange={(e) => updateActiveAsset({ name: e.target.value })}
                            />
                          </label>
                          <div className="viewer-tags-wrap">
                            <label htmlFor="create-asset-tags">
                              <span>Item tags</span>
                            </label>
                            <TagInputField
                              id="create-asset-tags"
                              tags={activeAsset.tags}
                              knownTags={knownTags}
                              placeholder="Optional item tags..."
                              onChange={(next) => updateActiveAsset({ tags: next })}
                            />
                          </div>
                          <label>
                            <span>Item notes</span>
                            <Textarea
                              value={activeAsset.notes}
                              onChange={(e) => updateActiveAsset({ notes: e.target.value })}
                              placeholder="Specific details about this asset..."
                            />
                          </label>
                          {assets.length > 1 && (
                            <Button
                              type="button"
                              variant={coverId === activeAsset.id ? 'secondary' : 'outline'}
                              size="sm"
                              onClick={() => setCoverId(activeAsset.id)}
                            >
                              <ImageIcon size={14} />{' '}
                              {coverId === activeAsset.id ? 'Selected as cover' : 'Set as cover'}
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="assets" forceMount>
                  <div className="viewer-assets">
                    <div className="detail-head">
                      <span>Staged assets</span>
                      <span className="viewer-kind-pill">
                        {assets.length} {assets.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                    <div className="viewer-assets-actions">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="upload"
                        onClick={() => void browseFiles()}
                      >
                        <Plus size={14} /> Add images or videos
                      </Button>
                    </div>
                    <div className="asset-list">
                      {assets.map((a) => {
                        const rowCls = [
                          'asset-row',
                          activeAsset?.id === a.id ? 'active' : '',
                          reorderUi?.dragId === a.id ? 'is-reordering' : '',
                          reorderUi?.overId === a.id && reorderUi.dragId !== a.id
                            ? reorderUi.after
                              ? 'drop-after'
                              : 'drop-before'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ');
                        return (
                          <div
                            className={rowCls}
                            key={a.id}
                            data-reorder-id={a.id}
                            onPointerDown={(e) => startPointerDrag(e, a.id, 'y')}
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              className="asset"
                              onClick={() => {
                                if (suppressAssetClickRef.current) return;
                                setActiveId(a.id);
                              }}
                            >
                              <span className="asset-thumb">
                                {a.kind === 'image' ? (
                                  <img src={a.previewUrl} alt="" draggable={false} />
                                ) : (
                                  <Video size={16} />
                                )}
                                {a.kind === 'video' && (
                                  <span className="play-badge row-play-badge" aria-hidden="true">
                                    <Play fill="currentColor" />
                                  </span>
                                )}
                              </span>
                              <div>
                                <strong>{a.name}</strong>
                                <span>
                                  {a.kind}
                                  {coverId === a.id ? ' · cover' : ''}
                                </span>
                              </div>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="remove-asset"
                              aria-label={`Remove ${a.name}`}
                              title="Remove"
                              onClick={() => removeStagedAsset(a.id)}
                            >
                              <X size={15} />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="notes" forceMount>
                  <div className="viewer-notes-intro">
                    <div className="viewer-notes-icon">
                      <MessageSquarePlus size={18} />
                    </div>
                    <h2>Annotate as you add</h2>
                    <p>
                      {activeAsset
                        ? 'Pin notes directly onto the frame or video timeline before saving.'
                        : 'Drop an image or video onto the stage to pin spatial or timed annotations.'}
                    </p>
                    {activeAsset && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="viewer-notes-start"
                        onClick={() => {
                          const btn = document.querySelector<HTMLButtonElement>(
                            '.annotation-toolbar button[data-action="add-annotation"]'
                          );
                          if (btn && btn.getAttribute('aria-pressed') !== 'true') btn.click();
                        }}
                      >
                        <MessageSquarePlus size={14} />{' '}
                        {activeAsset.annotations.length ? 'Add annotation' : 'Start annotating'}
                      </Button>
                    )}
                  </div>
                  <div id="viewer-annotation-list" />
                </TabsContent>
              </div>
            </Tabs>
          </aside>
        </div>

        <div
          className="viewer-strip"
          aria-label="Staged media strip"
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add('dragging');
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node)) {
              e.currentTarget.classList.remove('dragging');
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('dragging');
            stageFileObjects(Array.from(e.dataTransfer.files));
          }}
        >
          {assets.map((a) => {
            const btnCls = [
              activeAsset?.id === a.id ? 'active' : '',
              reorderUi?.dragId === a.id ? 'is-reordering' : '',
              reorderUi?.overId === a.id && reorderUi.dragId !== a.id
                ? reorderUi.after
                  ? 'drop-after'
                  : 'drop-before'
                : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <Button
                type="button"
                variant="ghost"
                key={a.id}
                data-reorder-id={a.id}
                aria-label={`View ${a.name}`}
                aria-pressed={activeAsset?.id === a.id}
                className={btnCls}
                onPointerDown={(e) => startPointerDrag(e, a.id, 'x')}
                onClick={() => {
                  if (suppressAssetClickRef.current) return;
                  setActiveId(a.id);
                }}
              >
                {a.kind === 'video' ? (
                  <video src={a.previewUrl} muted preload="metadata" />
                ) : (
                  <img src={a.previewUrl} alt="" draggable={false} />
                )}
                {a.kind === 'video' && (
                  <span className="play-badge strip-play-badge" aria-hidden="true">
                    <Play fill="currentColor" />
                  </span>
                )}
              </Button>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            className="viewer-add"
            aria-label="Add files"
            title="Add files"
            onClick={() => void browseFiles()}
          >
            <Plus size={18} />
          </Button>
          <span className="viewer-drop-hint">Drop multiple images or videos here</span>
        </div>
      </div>
    </div>
  );
}
