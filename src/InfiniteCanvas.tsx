import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Aperture, ArrowUpRight, Check, Globe, Infinity as InfinityIcon, Maximize2, Minimize2, Minus, Plus, RotateCcw, Shuffle, Video, X } from 'lucide-react';
import { Button } from './components/ui/button';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
import {
  CANVAS_DETAIL_ZOOM,
  clampCanvasZoom,
  clampFiniteCanvasView,
  computeCanvasGrid,
  finiteGridIndex,
  getVisibleCellRange,
  pickPlayableCells,
  wrapGridIndex,
  type PlayableCell,
} from './logic';
import { LoopingPreview, VideoPlaybackToggle } from './video/playback';
import { ScrollCoverImage } from './components/ScrollCoverImage';

export const CANVAS_CARD_W = 320;
export const CANVAS_CARD_H = 180;
/** Most in-view videos that autoplay at once (nearest the centre first). Hovering a tile always plays it. */
export const CANVAS_MAX_PLAYING = 9;
export const CANVAS_GAP = 20;
export const CANVAS_CELL_W = CANVAS_CARD_W + CANVAS_GAP;
export const CANVAS_CELL_H = CANVAS_CARD_H + CANVAS_GAP;

export type CanvasLibraryItem = {
  kind: 'library';
  id: string;
  sourceId: string;
  assetId?: string;
  title: string;
  subtitle?: string;
  mediaType: 'image' | 'video' | 'font' | 'empty';
  imageSrc?: string;
  videoSrc?: string;
};

export type CanvasDiscoverItem = {
  kind: 'discover';
  id: string;
  title: string;
  url: string;
  domain: string;
  imageSrc: string;
  tags: string[];
  saved?: boolean;
};

export type CanvasItem = CanvasLibraryItem | CanvasDiscoverItem;

type CanvasCellProps = {
  col: number;
  row: number;
  item: CanvasItem;
  selected: boolean;
  detail: boolean;
  playing: boolean;
  onActivate: (item: CanvasItem) => void;
  onContextMenu: (e: React.MouseEvent, item: CanvasItem) => void;
};

const CanvasCell = memo(function CanvasCell({ col, row, item, selected, detail, playing, onActivate, onContextMenu }: CanvasCellProps) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [item.id, item.imageSrc]);

  const style = { left: col * CANVAS_CELL_W, top: row * CANVAS_CELL_H, width: CANVAS_CARD_W, height: CANVAS_CARD_H };
  const image = (src: string) => (
    <img
      src={src}
      alt={item.title}
      decoding="async"
      draggable={false}
      onError={() => setImgFailed(true)}
    />
  );

  if (item.kind === 'discover') {
    return (
      <div
        className="canvas-tile is-discover"
        style={style}
        onClick={() => onActivate(item)}
        onContextMenu={(e) => onContextMenu(e, item)}
        title={item.title}
      >
        {!imgFailed && item.imageSrc ? (
          <ScrollCoverImage src={item.imageSrc} alt={item.title} decoding="async" draggable={false} onError={() => setImgFailed(true)} />
        ) : (
          <div className="canvas-tile-placeholder">
            <Globe size={22} />
            <span>{item.title}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`canvas-tile${selected ? ' selected' : ''}`}
      style={style}
      data-preview-host
      onClick={() => onActivate(item)}
      onContextMenu={(e) => onContextMenu(e, item)}
      title={item.subtitle ? `${item.title} — ${item.subtitle}` : item.title}
    >
      {item.mediaType === 'image' && item.imageSrc && !imgFailed ? (
        image(item.imageSrc)
      ) : item.mediaType === 'video' ? (
        item.videoSrc && detail ? (
          <>
            <LoopingPreview videoSrc={item.videoSrc} posterSrc={item.imageSrc} allowed={playing} observeVisibility={false} />
            <span className="canvas-tile-badge" aria-hidden="true">
              <Video size={12} />
            </span>
          </>
        ) : item.imageSrc && !imgFailed ? (
          <>
            {image(item.imageSrc)}
            {detail && (
              <span className="canvas-tile-badge" aria-hidden="true">
                <Video size={12} />
              </span>
            )}
          </>
        ) : (
          <div className="canvas-tile-placeholder">
            <Video size={22} />
            <span>{item.title}</span>
          </div>
        )
      ) : item.mediaType === 'font' ? (
        <div className="canvas-tile-font">
          <strong>Aa</strong>
          <span>{item.title}</span>
        </div>
      ) : (
        <div className="canvas-tile-placeholder">
          <Aperture size={22} />
          <span>{item.title}</span>
        </div>
      )}
    </div>
  );
});

type InfiniteCanvasProps = {
  mode: 'library' | 'discover';
  onModeChange: (mode: 'library' | 'discover') => void;
  headerMinimized: boolean;
  onToggleHeader: () => void;
  infiniteLoop: boolean;
  onToggleInfiniteLoop: () => void;
  onShuffle: () => void;
  shuffledActive?: boolean;
  items: CanvasItem[];
  selectedSourceId?: string | null;
  onOpenItem: (item: CanvasItem) => void;
  onItemContextMenu: (e: React.MouseEvent, item: CanvasItem) => void;
  onSaveDiscover: (item: CanvasDiscoverItem) => void;
  onOpenUrl: (url: string) => void;
  emptyState: React.ReactNode;
  canSaveToLibrary: boolean;
  loading?: boolean;
};

export function InfiniteCanvas({
  mode,
  onModeChange,
  headerMinimized,
  onToggleHeader,
  infiniteLoop,
  onToggleInfiniteLoop,
  onShuffle,
  shuffledActive = false,
  items,
  selectedSourceId = null,
  onOpenItem,
  onItemContextMenu,
  onSaveDiscover,
  onOpenUrl,
  emptyState,
  canSaveToLibrary,
  loading = false,
}: InfiniteCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const zoomTextRef = useRef<HTMLSpanElement>(null);

  const viewRef = useRef({ x: 32, y: 32, zoom: 1 });
  const didDragRef = useRef(false);
  const inertiaRafRef = useRef<number | null>(null);
  const frameRafRef = useRef<number | null>(null);

  const [lightbox, setLightbox] = useState<CanvasDiscoverItem | null>(null);
  const lightboxRef = useRef<CanvasDiscoverItem | null>(null);
  lightboxRef.current = lightbox;

  const [viewport, setViewport] = useState({ width: 1280, height: 760 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const [cellRange, setCellRange] = useState(() =>
    getVisibleCellRange(viewRef.current, { width: 1280, height: 760 }, CANVAS_CELL_W, CANVAS_CELL_H, 1)
  );
  const cellRangeRef = useRef(cellRange);
  cellRangeRef.current = cellRange;

  const grid = useMemo(
    () => computeCanvasGrid(items.length, CANVAS_CELL_W, CANVAS_CELL_H),
    [items.length]
  );
  const gridRef = useRef(grid);
  gridRef.current = grid;

  const infiniteLoopRef = useRef(infiniteLoop);
  infiniteLoopRef.current = infiniteLoop;

  // Mount the tiles one frame after the shell so the canvas appears immediately.
  const [cellsReady, setCellsReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setCellsReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const [detail, setDetail] = useState(true);
  const detailRef = useRef(true);

  const [playable, setPlayable] = useState<Set<string>>(() => new Set());
  const playableCellsRef = useRef<PlayableCell[]>([]);
  const playableTimerRef = useRef<number | null>(null);

  const recomputePlayable = useCallback(() => {
    playableTimerRef.current = null;
    const ids =
      viewRef.current.zoom < CANVAS_DETAIL_ZOOM
        ? []
        : pickPlayableCells(
            playableCellsRef.current,
            viewRef.current,
            viewportRef.current,
            CANVAS_CELL_W,
            CANVAS_CELL_H,
            CANVAS_CARD_W,
            CANVAS_CARD_H,
            CANVAS_MAX_PLAYING
          );
    setPlayable((prev) => (prev.size === ids.length && ids.every((id) => prev.has(id)) ? prev : new Set(ids)));
  }, []);

  // Pick which videos play only after panning and zooming settle.
  const schedulePlayable = useCallback(() => {
    if (playableTimerRef.current !== null) window.clearTimeout(playableTimerRef.current);
    playableTimerRef.current = window.setTimeout(recomputePlayable, 150);
  }, [recomputePlayable]);

  useEffect(
    () => () => {
      if (playableTimerRef.current !== null) window.clearTimeout(playableTimerRef.current);
    },
    []
  );

  const syncDomToView = useCallback(() => {
    const vp = viewportRef.current;
    if (!infiniteLoopRef.current && gridRef.current.cols > 0) {
      viewRef.current = clampFiniteCanvasView(
        viewRef.current,
        vp,
        gridRef.current,
        CANVAS_CELL_W,
        CANVAS_CELL_H,
        CANVAS_GAP
      );
    }

    const { x, y, zoom } = viewRef.current;
    if (surfaceRef.current) {
      surfaceRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`;
    }
    if (containerRef.current) {
      const gridStep = 28 * zoom;
      containerRef.current.style.backgroundSize = `${gridStep}px ${gridStep}px`;
      containerRef.current.style.backgroundPosition = `${x}px ${y}px`;
    }
    if (zoomTextRef.current) {
      zoomTextRef.current.textContent = `${Math.round(zoom * 100)}%`;
    }

    const nextDetail = zoom >= CANVAS_DETAIL_ZOOM;
    if (nextDetail !== detailRef.current) {
      detailRef.current = nextDetail;
      setDetail(nextDetail);
    }
    schedulePlayable();

    const nextRange = getVisibleCellRange(viewRef.current, vp, CANVAS_CELL_W, CANVAS_CELL_H, nextDetail ? 1 : 0);
    const prev = cellRangeRef.current;
    if (
      nextRange.minCol !== prev.minCol ||
      nextRange.maxCol !== prev.maxCol ||
      nextRange.minRow !== prev.minRow ||
      nextRange.maxRow !== prev.maxRow
    ) {
      cellRangeRef.current = nextRange;
      setCellRange(nextRange);
    }
  }, [schedulePlayable]);

  const scheduleSync = useCallback(() => {
    if (frameRafRef.current !== null) return;
    frameRafRef.current = requestAnimationFrame(() => {
      frameRafRef.current = null;
      syncDomToView();
    });
  }, [syncDomToView]);

  const stopInertia = useCallback(() => {
    if (inertiaRafRef.current !== null) {
      cancelAnimationFrame(inertiaRafRef.current);
      inertiaRafRef.current = null;
    }
  }, []);

  const resetView = useCallback(() => {
    stopInertia();
    viewRef.current = { x: 32, y: 32, zoom: 1 };
    syncDomToView();
  }, [stopInertia, syncDomToView]);

  const zoomAtPoint = useCallback(
    (nextZoomRaw: number, pointX: number, pointY: number) => {
      const prev = viewRef.current;
      const nextZoom = clampCanvasZoom(nextZoomRaw);
      if (nextZoom === prev.zoom) return;
      const ratio = nextZoom / prev.zoom;
      viewRef.current = {
        x: pointX - (pointX - prev.x) * ratio,
        y: pointY - (pointY - prev.y) * ratio,
        zoom: nextZoom,
      };
      scheduleSync();
    },
    [scheduleSync]
  );

  const zoomByFactor = useCallback(
    (factor: number) => {
      stopInertia();
      const vp = viewportRef.current;
      zoomAtPoint(viewRef.current.zoom * factor, vp.width / 2, vp.height / 2);
    },
    [stopInertia, zoomAtPoint]
  );

  // Measure container size reliably across window resizes and header minimize/restore.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const next = { width: rect.width, height: rect.height };
        viewportRef.current = next;
        setViewport(next);
        syncDomToView();
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncDomToView, headerMinimized, items.length]);

  // Reset scroll offset cleanly when switching between Library and Discover canvas modes.
  useEffect(() => {
    setLightbox(null);
    resetView();
  }, [mode, resetView]);

  // Attach native non-passive wheel, pointer, and gesture listeners for Figma-smooth two-finger pan & pinch zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const activePointers = new Map<number, { x: number; y: number }>();
    let dragLast: { x: number; y: number } | null = null;
    let totalDist = 0;
    let velocity = { x: 0, y: 0 };
    let lastPinchDist = 0;
    let lastPinchMid = { x: 0, y: 0 };
    let gestureBaseZoom = 1;

    const onWheel = (e: WheelEvent) => {
      if (lightboxRef.current) return;
      if ((e.target as HTMLElement | null)?.closest('.infinite-canvas-hud')) return;
      if (document.querySelector('[role="dialog"], .overlay')) return;

      e.preventDefault();
      stopInertia();

      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === 1) {
        dx *= 16;
        dy *= 16;
      } else if (e.deltaMode === 2) {
        dx *= el.clientWidth || 800;
        dy *= el.clientHeight || 600;
      }

      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const factor = Math.exp(-dy * 0.01);
        zoomAtPoint(viewRef.current.zoom * factor, px, py);
        return;
      }

      if (e.shiftKey && dx === 0) {
        dx = dy;
        dy = 0;
      }

      viewRef.current.x -= dx;
      viewRef.current.y -= dy;
      scheduleSync();
    };

    const getPinchMetrics = () => {
      const pts = Array.from(activePointers.values());
      const p1 = pts[0];
      const p2 = pts[1];
      const rect = el.getBoundingClientRect();
      return {
        dist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        mid: {
          x: (p1.x + p2.x) / 2 - rect.left,
          y: (p1.y + p2.y) / 2 - rect.top,
        },
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (lightboxRef.current) return;
      if ((e.target as HTMLElement | null)?.closest('.infinite-canvas-hud')) return;
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;

      stopInertia();
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 1) {
        didDragRef.current = false;
        totalDist = 0;
        velocity = { x: 0, y: 0 };
        dragLast = { x: e.clientX, y: e.clientY };
        el.classList.add('dragging');
      } else if (activePointers.size === 2) {
        dragLast = null;
        didDragRef.current = true;
        const { dist, mid } = getPinchMetrics();
        lastPinchDist = dist;
        lastPinchMid = mid;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2) {
        const { dist, mid } = getPinchMetrics();
        const midDx = mid.x - lastPinchMid.x;
        const midDy = mid.y - lastPinchMid.y;
        viewRef.current.x += midDx;
        viewRef.current.y += midDy;

        if (lastPinchDist > 0 && dist > 0) {
          const prev = viewRef.current;
          const nextZoom = clampCanvasZoom(prev.zoom * (dist / lastPinchDist));
          const ratio = nextZoom / prev.zoom;
          viewRef.current = {
            x: mid.x - (mid.x - prev.x) * ratio,
            y: mid.y - (mid.y - prev.y) * ratio,
            zoom: nextZoom,
          };
        }

        lastPinchDist = dist;
        lastPinchMid = mid;
        didDragRef.current = true;
        scheduleSync();
        return;
      }

      if (activePointers.size === 1 && dragLast) {
        const dx = e.clientX - dragLast.x;
        const dy = e.clientY - dragLast.y;
        totalDist += Math.abs(dx) + Math.abs(dy);
        if (totalDist > 6) {
          didDragRef.current = true;
        }
        velocity = { x: dx, y: dy };
        dragLast = { x: e.clientX, y: e.clientY };
        viewRef.current.x += dx;
        viewRef.current.y += dy;
        scheduleSync();
      }
    };

    const endPointer = (e: PointerEvent) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.delete(e.pointerId);

      if (activePointers.size === 1) {
        const remaining = Array.from(activePointers.values())[0];
        dragLast = { x: remaining.x, y: remaining.y };
        velocity = { x: 0, y: 0 };
        return;
      }

      if (activePointers.size === 0) {
        dragLast = null;
        el.classList.remove('dragging');

        if (Math.abs(velocity.x) > 1.2 || Math.abs(velocity.y) > 1.2) {
          const step = () => {
            velocity.x *= 0.92;
            velocity.y *= 0.92;
            if (Math.abs(velocity.x) < 0.4 && Math.abs(velocity.y) < 0.4) {
              inertiaRafRef.current = null;
              return;
            }
            viewRef.current.x += velocity.x;
            viewRef.current.y += velocity.y;
            syncDomToView();
            inertiaRafRef.current = requestAnimationFrame(step);
          };
          inertiaRafRef.current = requestAnimationFrame(step);
        }

        window.setTimeout(() => {
          didDragRef.current = false;
        }, 0);
      }
    };

    // Safari / WebKit trackpad gesture fallback
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      stopInertia();
      gestureBaseZoom = viewRef.current.zoom;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as unknown as { scale?: number; clientX?: number; clientY?: number };
      if (!ge.scale) return;
      const rect = el.getBoundingClientRect();
      const px = typeof ge.clientX === 'number' ? ge.clientX - rect.left : rect.width / 2;
      const py = typeof ge.clientY === 'number' ? ge.clientY - rect.top : rect.height / 2;
      zoomAtPoint(gestureBaseZoom * ge.scale, px, py);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endPointer);
      window.removeEventListener('pointercancel', endPointer);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      stopInertia();
      if (frameRafRef.current !== null) {
        cancelAnimationFrame(frameRafRef.current);
        frameRafRef.current = null;
      }
    };
  }, [scheduleSync, stopInertia, syncDomToView, zoomAtPoint]);

  // Keyboard shortcuts for zoom & closing lightbox / restoring header.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

      if (e.key === 'Escape') {
        if (lightboxRef.current) {
          e.preventDefault();
          setLightbox(null);
          return;
        }
        if (headerMinimized && !document.querySelector('[role="dialog"], .overlay, [role="menu"]')) {
          e.preventDefault();
          onToggleHeader();
          return;
        }
      }

      if (inInput || lightboxRef.current || document.querySelector('[role="dialog"], .overlay')) return;

      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomByFactor(1.2);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        zoomByFactor(1 / 1.2);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        resetView();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [headerMinimized, onToggleHeader, resetView, zoomByFactor]);

  useEffect(() => {
    syncDomToView();
  }, [infiniteLoop, syncDomToView]);

  const handleActivate = useCallback((item: CanvasItem) => {
    if (didDragRef.current) return;
    if (item.kind === 'discover') {
      onOpenUrl(item.url);
    } else {
      onOpenItem(item);
    }
  }, [onOpenItem, onOpenUrl]);

  const visibleCells = useMemo(() => {
    if (items.length === 0 || grid.cols === 0 || grid.rows === 0) return [];
    const cells: { key: string; col: number; row: number; item: CanvasItem }[] = [];
    const minRow = infiniteLoop ? cellRange.minRow : Math.max(0, cellRange.minRow);
    const maxRow = infiniteLoop ? cellRange.maxRow : Math.min(grid.rows - 1, cellRange.maxRow);
    const minCol = infiniteLoop ? cellRange.minCol : Math.max(0, cellRange.minCol);
    const maxCol = infiniteLoop ? cellRange.maxCol : Math.min(grid.cols - 1, cellRange.maxCol);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const index = infiniteLoop
          ? wrapGridIndex(col, row, grid.cols, grid.rows, items.length)
          : finiteGridIndex(col, row, grid.cols, items.length);
        if (index === null) continue;
        cells.push({
          key: `${col},${row}`,
          col,
          row,
          item: items[index],
        });
      }
    }
    return cells;
  }, [items, grid.cols, grid.rows, cellRange, infiniteLoop]);

  playableCellsRef.current = useMemo(
    () =>
      visibleCells.map((cell) => ({
        id: cell.key,
        col: cell.col,
        row: cell.row,
        video: cell.item.kind === 'library' && cell.item.mediaType === 'video' && !!cell.item.videoSrc,
      })),
    [visibleCells]
  );

  useEffect(() => {
    schedulePlayable();
  }, [visibleCells, schedulePlayable]);

  const liveLightbox = useMemo(
    () => (lightbox ? items.find((i): i is CanvasDiscoverItem => i.kind === 'discover' && i.id === lightbox.id) || lightbox : null),
    [lightbox, items]
  );

  return (
    <div
      ref={containerRef}
      className={`infinite-canvas${headerMinimized ? ' is-fullscreen' : ''}`}
      onDragStart={(e) => e.preventDefault()}
    >
      <div className="infinite-canvas-hud" onPointerDown={(e) => e.stopPropagation()}>
        <div className="canvas-hud-group">
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(next) => {
              if (next === 'library' || next === 'discover') onModeChange(next);
            }}
            className="canvas-mode-switch"
            aria-label="Canvas source"
          >
            <ToggleGroupItem value="library">Library</ToggleGroupItem>
            <ToggleGroupItem value="discover">Discover</ToggleGroupItem>
          </ToggleGroup>
          <span className="canvas-hud-count">
            {mode === 'discover'
              ? `${items.length.toLocaleString()} ${items.length === 1 ? 'cover' : 'covers'}`
              : `${items.length.toLocaleString()} ${items.length === 1 ? 'item' : 'items'}`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className={`canvas-hud-action${shuffledActive ? ' active' : ''}`}
            disabled={items.length < 2}
            title="Shuffle canvas items"
            aria-label="Shuffle canvas items"
            onClick={onShuffle}
          >
            <Shuffle size={13} />
            <span>Shuffle</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`canvas-hud-action${infiniteLoop ? ' active' : ''}`}
            aria-pressed={infiniteLoop}
            title={infiniteLoop ? 'Infinite loop is on (click to switch to finite grid)' : 'Infinite loop is off (click to loop infinitely)'}
            aria-label={infiniteLoop ? 'Turn infinite loop off' : 'Turn infinite loop on'}
            onClick={onToggleInfiniteLoop}
          >
            <InfinityIcon size={14} />
            <span>Loop</span>
          </Button>
          <VideoPlaybackToggle className="canvas-hud-action" />
        </div>

        <div className="canvas-hud-group">
          <div className="canvas-zoom-controls" aria-label="Canvas zoom controls">
            <Button
              variant="ghost"
              size="icon"
              className="canvas-hud-btn"
              aria-label="Zoom out"
              title="Zoom out (Ctrl -)"
              onClick={() => zoomByFactor(1 / 1.2)}
            >
              <Minus size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="canvas-zoom-reset"
              title="Reset view (Ctrl 0)"
              onClick={resetView}
            >
              <span ref={zoomTextRef}>100%</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="canvas-hud-btn"
              aria-label="Zoom in"
              title="Zoom in (Ctrl +)"
              onClick={() => zoomByFactor(1.2)}
            >
              <Plus size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="canvas-hud-btn"
              aria-label="Reset position and zoom"
              title="Reset position and zoom"
              onClick={resetView}
            >
              <RotateCcw size={13} />
            </Button>
          </div>

        </div>
      </div>

      {items.length > 0 ? (
        <div
          ref={surfaceRef}
          className="infinite-canvas-surface"
          style={{
            transform: `translate3d(${viewRef.current.x}px, ${viewRef.current.y}px, 0) scale(${viewRef.current.zoom})`,
          }}
        >
          {cellsReady &&
            visibleCells.map((cell) => (
              <CanvasCell
                key={cell.key}
                col={cell.col}
                row={cell.row}
                item={cell.item}
                selected={cell.item.kind === 'library' && cell.item.sourceId === selectedSourceId}
                detail={detail}
                playing={playable.has(cell.key)}
                onActivate={handleActivate}
                onContextMenu={onItemContextMenu}
              />
            ))}
        </div>
      ) : loading ? (
        <div className="infinite-canvas-empty">
          <div className="canvas-loading-pill">Loading website covers...</div>
        </div>
      ) : (
        <div className="infinite-canvas-empty" onPointerDown={(e) => e.stopPropagation()}>
          {emptyState}
        </div>
      )}

      {liveLightbox && (
        <div
          className="canvas-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={liveLightbox.title}
          onClick={() => setLightbox(null)}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="canvas-lightbox-panel" onClick={(e) => e.stopPropagation()}>
            <div className="canvas-lightbox-head">
              <div className="canvas-lightbox-meta">
                <strong>{liveLightbox.title}</strong>
                <span>{liveLightbox.domain}</span>
              </div>
              <div className="canvas-lightbox-actions">
                {canSaveToLibrary && (
                  <Button
                    variant={liveLightbox.saved ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => onSaveDiscover(liveLightbox)}
                  >
                    {liveLightbox.saved ? <Check size={14} /> : <Plus size={14} />}
                    {liveLightbox.saved ? 'In library' : 'Save to library'}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => onOpenUrl(liveLightbox.url)}
                >
                  Open website <ArrowUpRight size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close preview"
                  title="Close (Esc)"
                  onClick={() => setLightbox(null)}
                >
                  <X size={18} />
                </Button>
              </div>
            </div>
            <div className="canvas-lightbox-media">
              <img src={liveLightbox.imageSrc} alt={liveLightbox.title} draggable={false} />
            </div>
            {liveLightbox.tags.length > 0 && (
              <div className="canvas-lightbox-tags">
                {liveLightbox.tags.slice(0, 8).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
