import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Infinity as InfinityIcon,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Shuffle,
  X,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
import {
  CANVAS_DETAIL_ZOOM,
  CANVAS_MIN_ZOOM,
  clampCanvasZoom,
  clampFiniteCanvasView,
  centerCanvasView,
  computeCanvasGrid,
  computeTileUvTransform,
  finiteGridIndex,
  getVisibleCellRange,
  pickPlayableCells,
  screenToCanvasWorld,
  unwarpCanvasPoint,
  wrapGridIndex,
  type PlayableCell,
} from './logic';
import { useVideoPlayback, VideoPlaybackToggle } from './video/playback';

export const CANVAS_CARD_W = 320;
export const CANVAS_CARD_H = 180;
/** Most in-view videos that autoplay at once (nearest the centre first). Hovering a tile always plays it. */
export const CANVAS_MAX_PLAYING = 3;
export const CANVAS_GAP = 20;
export const CANVAS_CELL_W = CANVAS_CARD_W + CANVAS_GAP;
export const CANVAS_CELL_H = CANVAS_CARD_H + CANVAS_GAP;
/** Extra rows and columns rendered around the viewport so textures are queued before they scroll in. */
const OVERSCAN_CELLS = 1;
const PREFETCH_RING_CELLS = 4;
const MAX_TEXTURE_CACHE = 1000;
const MAX_TEXTURE_BYTES = 800 * 1024 * 1024;
const MAX_VIDEO_POOL = 8;
const MAX_UPLOADS_IDLE = 6;
const MAX_UPLOADS_MOVING = 2;
const MAX_VIDEO_UPLOADS_PER_FRAME = 1;
const VIDEO_STAGGER_MS = 110;
const MAX_CONCURRENT_DECODES = 10;
const MAX_PREWARM_BATCH = 8;
const IMAGE_FETCH_TIMEOUT_MS = 8000;
const MAX_TEX_WIDTH = 640;
const MAX_TEX_HEIGHT = 1920;
const SUBDIV_X = 6;
const SUBDIV_Y = 4;
const BG_SUBDIV_X = 28;
const BG_SUBDIV_Y = 20;
const DEFAULT_WARP = 15;
const HOVER_SCROLL_PX_PER_SEC = 120;

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

const WARP_GLSL = `
vec2 warpPoint(vec2 p, float s, float aspect, vec2 vel, out float r2Out) {
  float safeAspect = max(0.25, aspect);
  vec2 a = vec2(p.x * safeAspect, p.y);
  float diagSq = safeAspect * safeAspect + 1.0;
  float u = dot(a, a) / diagSq;
  r2Out = u;
  float lens = (1.0 + s * 0.22) * pow(1.0 + s * 1.45 * u, -0.44);
  float vFactor = min(1.5, u) * 0.2;
  return p * lens - vel * vFactor;
}
`;

const BG_VS = `#version 300 es
precision highp float;
in vec2 aUv;
uniform vec2 uViewport;
uniform vec2 uViewOffset;
uniform float uZoom;
uniform float uWarpStrength;
uniform vec2 uVelocity;
out vec2 vWorldPos;
out float vR2;
${WARP_GLSL}
void main() {
  vec2 flatNdc = aUv * 5.0 - 2.5;
  vec2 flatPx = (flatNdc * 0.5 + 0.5) * uViewport;
  vWorldPos = (flatPx - uViewOffset) / uZoom;
  float aspect = max(0.25, uViewport.x / max(1.0, uViewport.y));
  float r2 = 0.0;
  vec2 warped = warpPoint(flatNdc, uWarpStrength, aspect, uVelocity, r2);
  vR2 = r2;
  gl_Position = vec4(warped.x, -warped.y, 0.0, 1.0);
}
`;

const BG_FS = `#version 300 es
precision highp float;
in vec2 vWorldPos;
in float vR2;
uniform float uZoom;
uniform float uWarpStrength;
uniform vec3 uBgColor;
uniform vec4 uDotColor;
out vec4 fragColor;

void main() {
  float stepSize = 28.0;
  vec2 cell = mod(vWorldPos + stepSize * 0.5, stepSize) - stepSize * 0.5;
  float distPx = length(cell) * uZoom;
  float dotRadius = clamp(1.05 * pow(uZoom, 0.25), 0.75, 1.65);
  float alpha = (1.0 - smoothstep(dotRadius - 0.65, dotRadius + 0.65, distPx)) * uDotColor.a;
  float vig = 1.0 - uWarpStrength * 0.08 * smoothstep(0.15, 1.0, vR2);
  vec3 col = mix(uBgColor * vig, uDotColor.rgb, alpha);
  fragColor = vec4(col, 1.0);
}
`;

const TILE_VS = `#version 300 es
precision highp float;
in vec2 aUv;
uniform vec2 uViewport;
uniform vec2 uViewOffset;
uniform float uZoom;
uniform float uWarpStrength;
uniform vec2 uVelocity;
uniform vec4 uTileRect; // x, y, w, h in world units
out vec2 vUv;
out float vEdgeShade;
${WARP_GLSL}
void main() {
  vUv = aUv;
  vec2 worldPos = uTileRect.xy + aUv * uTileRect.zw;
  vec2 screenPx = worldPos * uZoom + uViewOffset;
  vec2 ndc = (screenPx / uViewport) * 2.0 - 1.0;
  float aspect = max(0.25, uViewport.x / max(1.0, uViewport.y));
  float r2 = 0.0;
  vec2 warped = warpPoint(ndc, uWarpStrength, aspect, uVelocity, r2);
  vEdgeShade = 1.0 - uWarpStrength * 0.14 * clamp(r2, 0.0, 1.0);
  gl_Position = vec4(warped.x, -warped.y, 0.0, 1.0);
}
`;

const TILE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in float vEdgeShade;
uniform sampler2D uTex;
uniform vec2 uCardSize;
uniform float uZoom;
uniform vec4 uUvTransform; // scaleX, scaleY, offsetX, offsetY
uniform vec3 uCardBg;
uniform vec3 uBorderColor;
uniform vec3 uPrimaryColor;
uniform float uSelected;
uniform float uHovered;
uniform float uHasVideoBadge;
out vec4 fragColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  vec2 halfSize = uCardSize * 0.5;
  vec2 localPx = (vUv - 0.5) * uCardSize;
  float radius = 4.0;
  float d = sdRoundBox(localPx, halfSize, radius);
  float aa = max(0.65, 1.1 / max(0.35, uZoom));

  float outerAlpha = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, d);
  if (outerAlpha <= 0.001) discard;

  vec2 sampleUv = vUv * uUvTransform.xy + uUvTransform.zw;
  bool inBounds = sampleUv.x >= 0.0 && sampleUv.x <= 1.0 && sampleUv.y >= 0.0 && sampleUv.y <= 1.0;
  vec4 texCol = inBounds ? texture(uTex, clamp(sampleUv, 0.0, 1.0)) : vec4(0.0);
  vec3 color = mix(uCardBg, texCol.rgb, texCol.a);

  if (uHasVideoBadge > 0.5) {
    vec2 badgeCenter = uCardSize - vec2(20.0, 20.0);
    vec2 bp = vUv * uCardSize - badgeCenter;
    float bd = sdRoundBox(bp, vec2(12.0, 12.0), 6.0);
    float bAlpha = 1.0 - smoothstep(-0.75, 0.75, bd);
    if (bAlpha > 0.01) {
      vec3 badgeCol = vec3(0.05, 0.05, 0.05);
      vec2 tp = bp - vec2(-0.5, 0.0);
      bool inTri = tp.x > -3.2 && tp.x < 3.8 && abs(tp.y) < (3.8 - tp.x) * 0.62;
      vec3 iconCol = inTri ? vec3(0.98) : badgeCol;
      color = mix(color, iconCol, bAlpha * (inTri ? 0.95 : 0.76));
    }
  }

  float borderWidth = (uSelected > 0.5 ? 2.0 : 1.0) / max(0.35, uZoom);
  float borderMask = smoothstep(-borderWidth - aa, -borderWidth, d);
  vec3 borderCol = uSelected > 0.5
    ? uPrimaryColor
    : (uHovered > 0.5 ? mix(uBorderColor, uPrimaryColor, 0.45) : uBorderColor);
  color = mix(color, borderCol, borderMask * (uSelected > 0.5 ? 0.95 : 0.72));
  color *= vEdgeShade;

  fragColor = vec4(color, outerAlpha);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vsSource: string, fsSource: string): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

function createSubdividedQuad(gl: WebGL2RenderingContext, cols: number, rows: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      positions.push(u, v);
    }
  }
  const stride = cols + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * stride + c;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

  gl.bindVertexArray(null);
  return { vao, vbo, ibo, count: indices.length };
}

type TextureEntry = {
  tex: WebGLTexture;
  width: number;
  height: number;
  bytes: number;
  lastUsed: number;
};

type DecodedUpload = {
  key: string;
  source: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  width: number;
  height: number;
  close?: () => void;
};

async function decodeImageForGpu(url: string): Promise<{
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  close?: () => void;
}> {
  let rawBitmap: ImageBitmap | null = null;
  let httpErrorStatus = 0;
  if (typeof createImageBitmap === 'function') {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS) : null;
    try {
      const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
      if (response.ok) {
        const blob = await response.blob();
        rawBitmap = await createImageBitmap(blob);
      } else if (response.type !== 'opaque' && response.status >= 400) {
        httpErrorStatus = response.status;
      }
    } catch {
      rawBitmap = null;
    } finally {
      if (timer !== null) window.clearTimeout(timer);
    }
  }

  if (!rawBitmap && httpErrorStatus >= 400) {
    throw new Error(`HTTP ${httpErrorStatus}`);
  }

  if (!rawBitmap) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        img.src = '';
        reject(new Error('Image decode timeout'));
      }, IMAGE_FETCH_TIMEOUT_MS);
      img.decode().then(
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        (err) => {
          window.clearTimeout(timer);
          reject(err);
        }
      );
    });
    if (typeof createImageBitmap !== 'function') {
      return {
        source: img,
        width: img.naturalWidth || CANVAS_CARD_W,
        height: img.naturalHeight || CANVAS_CARD_H,
      };
    }
    rawBitmap = await createImageBitmap(img);
  }

  const w = rawBitmap.width;
  const h = rawBitmap.height;
  if (w <= MAX_TEX_WIDTH && h <= MAX_TEX_HEIGHT) {
    return {
      source: rawBitmap,
      width: w,
      height: h,
      close: () => rawBitmap?.close(),
    };
  }

  const scale = Math.min(MAX_TEX_WIDTH / w, MAX_TEX_HEIGHT / h);
  const targetW = Math.max(1, Math.round(w * scale));
  const targetH = Math.max(1, Math.round(h * scale));
  const resized = await createImageBitmap(rawBitmap, {
    resizeWidth: targetW,
    resizeHeight: targetH,
    resizeQuality: 'medium',
  });
  rawBitmap.close();
  return {
    source: resized,
    width: targetW,
    height: targetH,
    close: () => resized.close(),
  };
}

function renderSpecialTileCanvas(item: CanvasItem, dark: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_CARD_W * 2;
  canvas.height = CANVAS_CARD_H * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(2, 2);

  ctx.fillStyle = dark ? '#171717' : '#f4f4f5';
  ctx.fillRect(0, 0, CANVAS_CARD_W, CANVAS_CARD_H);

  const fg = dark ? '#f4f4f5' : '#18181b';
  const muted = dark ? '#a1a1aa' : '#71717a';

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (item.kind === 'library' && item.mediaType === 'font') {
    ctx.fillStyle = fg;
    ctx.font = '400 48px Georgia, serif';
    ctx.fillText('Aa', CANVAS_CARD_W / 2, CANVAS_CARD_H / 2 - 14);
  } else {
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(CANVAS_CARD_W / 2, CANVAS_CARD_H / 2 - 14, 11, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = muted;
  ctx.font = '500 11px Inter, system-ui, sans-serif';
  const title = item.title.length > 36 ? item.title.slice(0, 35) + '…' : item.title;
  ctx.fillText(title, CANVAS_CARD_W / 2, CANVAS_CARD_H / 2 + 24);
  return canvas;
}

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
  const { autoplay } = useVideoPlayback();
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomTextRef = useRef<HTMLSpanElement>(null);
  const lastZoomLabelRef = useRef('100%');

  const [warp, setWarp] = useState(() => {
    try {
      const saved = localStorage.getItem('sightline-canvas-warp');
      if (saved === null || saved.trim() === '') return DEFAULT_WARP;
      const parsed = Number(saved);
      return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : DEFAULT_WARP;
    } catch {
      return DEFAULT_WARP;
    }
  });
  const warpRef = useRef(warp);
  warpRef.current = warp;

  const viewRef = useRef({ x: 32, y: 32, zoom: 1 });
  const viewportRef = useRef({ width: 1280, height: 760 });
  const containerRectRef = useRef({ left: 0, top: 0, width: 1280, height: 760 });
  const velocityRef = useRef({ x: 0, y: 0 });
  const smoothVelRef = useRef({ x: 0, y: 0 });
  const didDragRef = useRef(false);
  const isMovingRef = useRef(false);
  const moveSettleTimerRef = useRef<number | null>(null);
  const hoveredCellRef = useRef<{ key: string; col: number; row: number; index: number } | null>(null);
  const hoverScrollRef = useRef<Map<string, number>>(new Map());

  const [lightbox, setLightbox] = useState<CanvasDiscoverItem | null>(null);
  const lightboxRef = useRef<CanvasDiscoverItem | null>(null);
  lightboxRef.current = lightbox;

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selectedSourceIdRef = useRef(selectedSourceId);
  selectedSourceIdRef.current = selectedSourceId;

  const grid = useMemo(
    () => computeCanvasGrid(items.length, CANVAS_CELL_W, CANVAS_CELL_H),
    [items.length]
  );
  const gridRef = useRef(grid);
  gridRef.current = grid;

  const infiniteLoopRef = useRef(infiniteLoop);
  infiniteLoopRef.current = infiniteLoop;

  const wakeRenderRef = useRef<() => void>(() => {});

  const markMoving = useCallback(() => {
    isMovingRef.current = true;
    if (moveSettleTimerRef.current !== null) {
      window.clearTimeout(moveSettleTimerRef.current);
    }
    moveSettleTimerRef.current = window.setTimeout(() => {
      moveSettleTimerRef.current = null;
      isMovingRef.current = false;
      wakeRenderRef.current();
    }, 150);
  }, []);

  useEffect(
    () => () => {
      if (moveSettleTimerRef.current !== null) window.clearTimeout(moveSettleTimerRef.current);
    },
    []
  );

  const clampViewIfNeeded = useCallback(() => {
    if (!infiniteLoopRef.current && gridRef.current.cols > 0) {
      viewRef.current = clampFiniteCanvasView(
        viewRef.current,
        viewportRef.current,
        gridRef.current,
        CANVAS_CELL_W,
        CANVAS_CELL_H,
        CANVAS_GAP
      );
    }
    const label = `${Math.round(viewRef.current.zoom * 100)}%`;
    if (zoomTextRef.current && lastZoomLabelRef.current !== label) {
      lastZoomLabelRef.current = label;
      zoomTextRef.current.textContent = label;
    }
  }, []);

  const resetView = useCallback(() => {
    velocityRef.current = { x: 0, y: 0 };
    viewRef.current = { x: 32, y: 32, zoom: 1 };
    clampViewIfNeeded();
    wakeRenderRef.current();
  }, [clampViewIfNeeded]);

  const zoomAtPoint = useCallback(
    (nextZoomRaw: number, pointX: number, pointY: number) => {
      const prev = viewRef.current;
      const nextZoom = clampCanvasZoom(nextZoomRaw);
      if (nextZoom === prev.zoom) return;
      markMoving();

      const vp = viewportRef.current;
      const world = screenToCanvasWorld(
        pointX,
        pointY,
        prev,
        vp,
        warpRef.current / 100,
        smoothVelRef.current.x,
        smoothVelRef.current.y
      );
      const flatScreenX = world.worldX * prev.zoom + prev.x;
      const flatScreenY = world.worldY * prev.zoom + prev.y;
      viewRef.current = {
        x: flatScreenX - world.worldX * nextZoom,
        y: flatScreenY - world.worldY * nextZoom,
        zoom: nextZoom,
      };
      clampViewIfNeeded();
      wakeRenderRef.current();
    },
    [clampViewIfNeeded, markMoving]
  );

  const zoomByFactor = useCallback(
    (factor: number) => {
      velocityRef.current = { x: 0, y: 0 };
      const vp = viewportRef.current;
      zoomAtPoint(viewRef.current.zoom * factor, vp.width / 2, vp.height / 2);
    },
    [zoomAtPoint]
  );

  // Reset scroll offset cleanly when switching between Library and Discover canvas modes.
  useEffect(() => {
    setLightbox(null);
    resetView();
  }, [mode, resetView]);

  const previousLoopRef = useRef(infiniteLoop);
  useEffect(() => {
    if (previousLoopRef.current && !infiniteLoop) {
      velocityRef.current = { x: 0, y: 0 };
      viewRef.current = centerCanvasView(
        viewRef.current.zoom,
        viewportRef.current,
        gridRef.current,
        CANVAS_CELL_W,
        CANVAS_CELL_H,
        CANVAS_GAP
      );
    }
    previousLoopRef.current = infiniteLoop;
    clampViewIfNeeded();
    wakeRenderRef.current();
  }, [infiniteLoop, clampViewIfNeeded]);

  useEffect(() => {
    wakeRenderRef.current();
  }, [items, selectedSourceId, autoplay, warp]);

  const resolveCellAtPointer = useCallback((clientX: number, clientY: number) => {
    const curItems = itemsRef.current;
    const curGrid = gridRef.current;
    if (curItems.length === 0 || curGrid.cols === 0 || curGrid.rows === 0) return null;

    const rect = containerRectRef.current;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const { worldX, worldY } = screenToCanvasWorld(
      px,
      py,
      viewRef.current,
      viewportRef.current,
      warpRef.current / 100,
      smoothVelRef.current.x,
      smoothVelRef.current.y
    );

    const col = Math.floor(worldX / CANVAS_CELL_W);
    const row = Math.floor(worldY / CANVAS_CELL_H);
    const localX = worldX - col * CANVAS_CELL_W;
    const localY = worldY - row * CANVAS_CELL_H;
    if (localX < 0 || localX > CANVAS_CARD_W || localY < 0 || localY > CANVAS_CARD_H) {
      return null;
    }

    const index = infiniteLoopRef.current
      ? wrapGridIndex(col, row, curGrid.cols, curGrid.rows, curItems.length)
      : finiteGridIndex(col, row, curGrid.cols, curItems.length);
    if (index === null) return null;

    return {
      key: `${col},${row}`,
      col,
      row,
      index,
      item: curItems[index],
    };
  }, []);

  // Main WebGL2 pipeline and render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

    const bgProg = createProgram(gl, BG_VS, BG_FS);
    const tileProg = createProgram(gl, TILE_VS, TILE_FS);
    if (!bgProg || !tileProg) return;

    // Subdivided background & tile meshes
    const bgMesh = createSubdividedQuad(gl, BG_SUBDIV_X, BG_SUBDIV_Y);
    const quadMesh = createSubdividedQuad(gl, SUBDIV_X, SUBDIV_Y);

    // 1x1 transparent fallback texture
    const emptyTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, emptyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

    const bgUniforms = {
      uViewport: gl.getUniformLocation(bgProg, 'uViewport'),
      uViewOffset: gl.getUniformLocation(bgProg, 'uViewOffset'),
      uZoom: gl.getUniformLocation(bgProg, 'uZoom'),
      uWarpStrength: gl.getUniformLocation(bgProg, 'uWarpStrength'),
      uVelocity: gl.getUniformLocation(bgProg, 'uVelocity'),
      uBgColor: gl.getUniformLocation(bgProg, 'uBgColor'),
      uDotColor: gl.getUniformLocation(bgProg, 'uDotColor'),
    };

    const tileUniforms = {
      uViewport: gl.getUniformLocation(tileProg, 'uViewport'),
      uViewOffset: gl.getUniformLocation(tileProg, 'uViewOffset'),
      uZoom: gl.getUniformLocation(tileProg, 'uZoom'),
      uWarpStrength: gl.getUniformLocation(tileProg, 'uWarpStrength'),
      uVelocity: gl.getUniformLocation(tileProg, 'uVelocity'),
      uTileRect: gl.getUniformLocation(tileProg, 'uTileRect'),
      uTex: gl.getUniformLocation(tileProg, 'uTex'),
      uCardSize: gl.getUniformLocation(tileProg, 'uCardSize'),
      uUvTransform: gl.getUniformLocation(tileProg, 'uUvTransform'),
      uCardBg: gl.getUniformLocation(tileProg, 'uCardBg'),
      uBorderColor: gl.getUniformLocation(tileProg, 'uBorderColor'),
      uPrimaryColor: gl.getUniformLocation(tileProg, 'uPrimaryColor'),
      uSelected: gl.getUniformLocation(tileProg, 'uSelected'),
      uHovered: gl.getUniformLocation(tileProg, 'uHovered'),
      uHasVideoBadge: gl.getUniformLocation(tileProg, 'uHasVideoBadge'),
    };

    const textureCache = new Map<string, TextureEntry>();
    let totalTextureBytes = 0;
    let bgWarmCursor = 0;
    let lastWarmItems: CanvasItem[] | null = null;
    const pendingKeys = new Set<string>();
    const failedKeys = new Set<string>();
    const requestQueue: { key: string; url?: string; item: CanvasItem; dark: boolean; distSq: number }[] = [];
    const requestByKey = new Map<string, (typeof requestQueue)[number]>();
    const uploadQueue: DecodedUpload[] = [];
    let activeDecodes = 0;
    let frameCounter = 0;
    let disposed = false;

    type VideoFrameCallbackVideo = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, metadata: unknown) => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };

    type VideoEntry = {
      src: string;
      video: VideoFrameCallbackVideo;
      tex: WebGLTexture;
      ready: boolean;
      dirty: boolean;
      active: boolean;
      texInitialized: boolean;
      texWidth: number;
      texHeight: number;
      width: number;
      height: number;
      lastVideoTime: number;
      lastUsed: number;
      rvfcHandle: number | null;
      usesRvfc: boolean;
    };

    // Warm video decoder pool keyed by videoSrc so wrapped/re-visited tiles reuse decoders without churn
    const videoPool = new Map<string, VideoEntry>();
    let nextVideoStartAt = 0;
    let staggerTimerId: number | null = null;

    let rafId: number | null = null;
    const scheduleFrame = () => {
      if (disposed || rafId !== null) return;
      rafId = requestAnimationFrame(renderFrame);
    };
    wakeRenderRef.current = scheduleFrame;

    const armRvfc = (entry: VideoEntry) => {
      if (disposed || !entry.usesRvfc || entry.rvfcHandle !== null) return;
      const fn = entry.video.requestVideoFrameCallback;
      if (!fn) return;
      entry.rvfcHandle = fn.call(entry.video, () => {
        entry.rvfcHandle = null;
        if (disposed) return;
        entry.dirty = true;
        if (entry.active && !entry.video.paused) {
          armRvfc(entry);
        }
        scheduleFrame();
      });
    };

    const pumpDecodeQueue = () => {
      while (!disposed && activeDecodes < MAX_CONCURRENT_DECODES && requestQueue.length > 0) {
        const req = requestQueue.pop()!;
        requestByKey.delete(req.key);
        if (textureCache.has(req.key) || failedKeys.has(req.key)) {
          pendingKeys.delete(req.key);
          continue;
        }
        if (!req.url) {
          const canvasEl = renderSpecialTileCanvas(req.item, req.dark);
          uploadQueue.push({
            key: req.key,
            source: canvasEl,
            width: canvasEl.width,
            height: canvasEl.height,
          });
          scheduleFrame();
          continue;
        }

        activeDecodes++;
        const url = req.url;
        (async () => {
          try {
            const decoded = await decodeImageForGpu(url);
            if (disposed) {
              decoded.close?.();
              return;
            }
            uploadQueue.push({
              key: req.key,
              source: decoded.source,
              width: decoded.width,
              height: decoded.height,
              close: decoded.close,
            });
          } catch {
            if (!disposed) {
              failedKeys.add(req.key);
              const fallbackCanvas = renderSpecialTileCanvas(req.item, req.dark);
              uploadQueue.push({
                key: req.key,
                source: fallbackCanvas,
                width: fallbackCanvas.width,
                height: fallbackCanvas.height,
              });
            }
          } finally {
            activeDecodes--;
            if (!disposed) {
              pumpDecodeQueue();
              scheduleFrame();
            }
          }
        })();
      }
    };

    const textureKeyFor = (item: CanvasItem, dark: boolean) =>
      item.kind === 'discover'
        ? `img:${item.imageSrc || item.id}`
        : item.mediaType === 'font' || item.mediaType === 'empty' || !item.imageSrc
        ? `special:${dark ? 'd' : 'l'}:${item.id}:${item.title}`
        : `img:${item.imageSrc}`;

    const ensureTexture = (item: CanvasItem, dark: boolean, distSq: number): TextureEntry | null => {
      const key = textureKeyFor(item, dark);
      const hit = textureCache.get(key);
      if (hit) {
        hit.lastUsed = frameCounter;
        return hit;
      }
      if (!pendingKeys.has(key)) {
        pendingKeys.add(key);
        const url =
          item.kind === 'discover'
            ? item.imageSrc
            : item.mediaType === 'image' || item.mediaType === 'video'
            ? item.imageSrc
            : undefined;
        const req = { key, url, item, dark, distSq };
        requestQueue.push(req);
        requestByKey.set(key, req);
      } else {
        const queued = requestByKey.get(key);
        if (queued && distSq < queued.distSq) {
          queued.distSq = distSq;
        }
      }
      return null;
    };

    const evictOldTextures = () => {
      if (textureCache.size <= MAX_TEXTURE_CACHE && totalTextureBytes <= MAX_TEXTURE_BYTES) return;
      const entries = Array.from(textureCache.entries())
        .filter(([, v]) => v.lastUsed < frameCounter)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (let i = 0; i < entries.length; i++) {
        if (textureCache.size <= MAX_TEXTURE_CACHE && totalTextureBytes <= MAX_TEXTURE_BYTES) break;
        const [k, v] = entries[i];
        gl.deleteTexture(v.tex);
        totalTextureBytes = Math.max(0, totalTextureBytes - v.bytes);
        textureCache.delete(k);
        pendingKeys.delete(k);
      }
    };

    const measureCanvas = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      containerRectRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      viewportRef.current = { width: rect.width, height: rect.height };
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.max(1, Math.round(rect.width * dpr));
      const targetH = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      clampViewIfNeeded();
      scheduleFrame();
    };

    const ro = new ResizeObserver(measureCanvas);
    ro.observe(container);
    measureCanvas();

    const mo = new MutationObserver(() => scheduleFrame());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    let lastFrameNow = performance.now();

    function renderFrame() {
      rafId = null;
      if (disposed || !gl || !canvas) return;
      frameCounter++;
      const frameNow = performance.now();
      const dtSec = Math.min(0.05, Math.max(0.001, (frameNow - lastFrameNow) / 1000));
      lastFrameNow = frameNow;

      let needsNextFrame = false;

      // 1. Physics / inertia step
      const vel = velocityRef.current;
      const hasInertia = Math.abs(vel.x) > 0.35 || Math.abs(vel.y) > 0.35;
      if (hasInertia) {
        viewRef.current.x += vel.x;
        viewRef.current.y += vel.y;
        vel.x *= 0.92;
        vel.y *= 0.92;
        clampViewIfNeeded();
        markMoving();
        needsNextFrame = true;
      } else if (vel.x !== 0 || vel.y !== 0) {
        vel.x = 0;
        vel.y = 0;
      }

      // Smooth velocity uniform for lens inertia warp
      const targetVx = Math.max(-0.06, Math.min(0.06, vel.x / 950));
      const targetVy = Math.max(-0.06, Math.min(0.06, vel.y / 950));
      smoothVelRef.current.x += (targetVx - smoothVelRef.current.x) * 0.22;
      smoothVelRef.current.y += (targetVy - smoothVelRef.current.y) * 0.22;
      if (Math.abs(smoothVelRef.current.x) > 0.0004 || Math.abs(smoothVelRef.current.y) > 0.0004) {
        needsNextFrame = true;
      } else {
        smoothVelRef.current.x = 0;
        smoothVelRef.current.y = 0;
      }

      // 2. Upload decoded textures (1/frame while actively panning/zooming, 3/frame when idle)
      const uploadBudget = isMovingRef.current || hasInertia ? MAX_UPLOADS_MOVING : MAX_UPLOADS_IDLE;
      let uploaded = 0;
      while (uploadQueue.length > 0 && uploaded < uploadBudget) {
        const job = uploadQueue.shift()!;
        pendingKeys.delete(job.key);
        const tex = gl.createTexture();
        if (tex) {
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, job.source);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          const bytes = Math.round(job.width * job.height * 4 * 1.34);
          totalTextureBytes += bytes;
          textureCache.set(job.key, {
            tex,
            width: job.width,
            height: job.height,
            bytes,
            lastUsed: frameCounter,
          });
        }
        job.close?.();
        uploaded++;
      }
      if (uploadQueue.length > 0) needsNextFrame = true;

      // 3. Determine visible cells + wider lookahead prefetch ring
      const vp = viewportRef.current;
      const view = viewRef.current;
      const curItems = itemsRef.current;
      const curGrid = gridRef.current;
      const isDark = document.documentElement.classList.contains('dark');
      if (lastWarmItems !== curItems) {
        lastWarmItems = curItems;
        bgWarmCursor = 0;
      }
      const warpAmount = warpRef.current / 100;
      let overscan = OVERSCAN_CELLS;
      if (warpAmount > 0.05) {
        const aspect = Math.max(0.25, vp.width / Math.max(1, vp.height));
        const corner = unwarpCanvasPoint(1, 1, warpAmount, aspect);
        const effZoom = Math.max(CANVAS_MIN_ZOOM, view.zoom);
        const extraCols = Math.ceil(((Math.max(1, Math.abs(corner.x)) - 1) * vp.width * 0.5) / (effZoom * CANVAS_CELL_W));
        const extraRows = Math.ceil(((Math.max(1, Math.abs(corner.y)) - 1) * vp.height * 0.5) / (effZoom * CANVAS_CELL_H));
        overscan = OVERSCAN_CELLS + Math.min(8, Math.max(extraCols, extraRows));
      }

      const range = getVisibleCellRange(view, vp, CANVAS_CELL_W, CANVAS_CELL_H, overscan);
      const visibleCells: { key: string; col: number; row: number; item: CanvasItem }[] = [];
      const visibleByKey = new Map<string, { key: string; col: number; row: number; item: CanvasItem }>();
      const prefetchCells: { col: number; row: number; item: CanvasItem }[] = [];

      if (curItems.length > 0 && curGrid.cols > 0 && curGrid.rows > 0) {
        const minRow = infiniteLoopRef.current ? range.minRow : Math.max(0, range.minRow);
        const maxRow = infiniteLoopRef.current ? range.maxRow : Math.min(curGrid.rows - 1, range.maxRow);
        const minCol = infiniteLoopRef.current ? range.minCol : Math.max(0, range.minCol);
        const maxCol = infiniteLoopRef.current ? range.maxCol : Math.min(curGrid.cols - 1, range.maxCol);

        for (let row = minRow; row <= maxRow; row++) {
          for (let col = minCol; col <= maxCol; col++) {
            const index = infiniteLoopRef.current
              ? wrapGridIndex(col, row, curGrid.cols, curGrid.rows, curItems.length)
              : finiteGridIndex(col, row, curGrid.cols, curItems.length);
            if (index === null) continue;
            const key = `${col},${row}`;
            const cell = {
              key,
              col,
              row,
              item: curItems[index],
            };
            visibleCells.push(cell);
            visibleByKey.set(key, cell);
          }
        }

        // Lookahead ring around visible area (+ extra bias in pan velocity direction)
        const dirColBias = Math.max(-5, Math.min(5, Math.round(-vel.x / 16)));
        const dirRowBias = Math.max(-5, Math.min(5, Math.round(-vel.y / 16)));
        const preMinRowRaw = range.minRow - PREFETCH_RING_CELLS + Math.min(0, dirRowBias);
        const preMaxRowRaw = range.maxRow + PREFETCH_RING_CELLS + Math.max(0, dirRowBias);
        const preMinColRaw = range.minCol - PREFETCH_RING_CELLS + Math.min(0, dirColBias);
        const preMaxColRaw = range.maxCol + PREFETCH_RING_CELLS + Math.max(0, dirColBias);

        const preMinRow = infiniteLoopRef.current ? preMinRowRaw : Math.max(0, preMinRowRaw);
        const preMaxRow = infiniteLoopRef.current ? preMaxRowRaw : Math.min(curGrid.rows - 1, preMaxRowRaw);
        const preMinCol = infiniteLoopRef.current ? preMinColRaw : Math.max(0, preMinColRaw);
        const preMaxCol = infiniteLoopRef.current ? preMaxColRaw : Math.min(curGrid.cols - 1, preMaxColRaw);

        for (let row = preMinRow; row <= preMaxRow; row++) {
          for (let col = preMinCol; col <= preMaxCol; col++) {
            if (row >= minRow && row <= maxRow && col >= minCol && col <= maxCol) continue;
            const index = infiniteLoopRef.current
              ? wrapGridIndex(col, row, curGrid.cols, curGrid.rows, curItems.length)
              : finiteGridIndex(col, row, curGrid.cols, curItems.length);
            if (index === null) continue;
            prefetchCells.push({ col, row, item: curItems[index] });
          }
        }
      }

      // Drop far off-screen decode requests only when the queue backs up during rapid panning
      if (requestQueue.length > 160) {
        const keepTexKeys = new Set<string>();
        for (const c of visibleCells) keepTexKeys.add(textureKeyFor(c.item, isDark));
        for (const c of prefetchCells) keepTexKeys.add(textureKeyFor(c.item, isDark));
        for (let i = requestQueue.length - 1; i >= 0; i--) {
          if (!keepTexKeys.has(requestQueue[i].key)) {
            pendingKeys.delete(requestQueue[i].key);
            requestByKey.delete(requestQueue[i].key);
            requestQueue.splice(i, 1);
          }
        }
      }

      // 4. Manage active video tiles (staggered warm pool, continues playing during pan/zoom)
      const detail = view.zoom >= CANVAS_DETAIL_ZOOM;
      const playableVideoSrcs = new Set<string>();
      if (detail) {
        if (autoplayRef.current) {
          const candidates: PlayableCell[] = visibleCells.map((c) => ({
            id: c.key,
            col: c.col,
            row: c.row,
            video: c.item.kind === 'library' && c.item.mediaType === 'video' && !!c.item.videoSrc,
          }));
          for (const cellKey of pickPlayableCells(
            candidates,
            view,
            vp,
            CANVAS_CELL_W,
            CANVAS_CELL_H,
            CANVAS_CARD_W,
            CANVAS_CARD_H,
            CANVAS_MAX_PLAYING
          )) {
            const cell = visibleByKey.get(cellKey);
            if (cell?.item.kind === 'library' && cell.item.videoSrc) {
              playableVideoSrcs.add(cell.item.videoSrc);
            }
          }
        }
        const hov = hoveredCellRef.current;
        if (hov) {
          const hovCell = visibleByKey.get(hov.key);
          if (hovCell?.item.kind === 'library' && hovCell.item.mediaType === 'video' && hovCell.item.videoSrc) {
            playableVideoSrcs.add(hovCell.item.videoSrc);
          }
        }
      }

      // Pause entries that are no longer active without tearing down warm decoders
      for (const [vidSrc, entry] of videoPool.entries()) {
        if (!playableVideoSrcs.has(vidSrc)) {
          entry.active = false;
          if (!entry.video.paused) entry.video.pause();
        }
      }

      // Stagger new decoder starts / resumes (max 1 per VIDEO_STAGGER_MS)
      const now = performance.now();
      let startedOneThisFrame = false;
      let waitingForStagger = false;

      for (const vidSrc of playableVideoSrcs) {
        const existing = videoPool.get(vidSrc);
        if (existing) {
          existing.lastUsed = frameCounter;
          existing.active = true;
          if (existing.video.paused) {
            if (!startedOneThisFrame && now >= nextVideoStartAt) {
              startedOneThisFrame = true;
              nextVideoStartAt = now + VIDEO_STAGGER_MS;
              const v = existing.video;
              void v
                .play()
                .then(() => {
                  if (disposed || !existing.active) {
                    v.pause();
                  } else if (existing.usesRvfc) {
                    armRvfc(existing);
                  }
                })
                .catch(() => {});
            } else {
              waitingForStagger = true;
            }
          } else if (existing.usesRvfc && existing.rvfcHandle === null) {
            armRvfc(existing);
          }
        } else {
          if (!startedOneThisFrame && now >= nextVideoStartAt) {
            startedOneThisFrame = true;
            nextVideoStartAt = now + VIDEO_STAGGER_MS;
            const video = document.createElement('video') as VideoFrameCallbackVideo;
            video.src = vidSrc;
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.preload = 'auto';
            video.crossOrigin = 'anonymous';
            const tex = gl.createTexture()!;
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            const created: VideoEntry = {
              src: vidSrc,
              video,
              tex,
              ready: false,
              dirty: false,
              active: true,
              texInitialized: false,
              texWidth: 0,
              texHeight: 0,
              width: CANVAS_CARD_W,
              height: CANVAS_CARD_H,
              lastVideoTime: -1,
              lastUsed: frameCounter,
              rvfcHandle: null,
              usesRvfc: typeof video.requestVideoFrameCallback === 'function',
            };
            video.addEventListener('loadeddata', () => {
              if (disposed) return;
              created.width = video.videoWidth || CANVAS_CARD_W;
              created.height = video.videoHeight || CANVAS_CARD_H;
              created.ready = true;
              created.dirty = true;
              scheduleFrame();
            });
            videoPool.set(vidSrc, created);
            void video
              .play()
              .then(() => {
                if (disposed || !created.active) {
                  video.pause();
                } else if (created.usesRvfc) {
                  armRvfc(created);
                }
              })
              .catch(() => {});
          } else {
            waitingForStagger = true;
          }
        }
      }

      if (waitingForStagger && staggerTimerId === null) {
        const delay = Math.max(16, Math.ceil(nextVideoStartAt - now));
        staggerTimerId = window.setTimeout(() => {
          staggerTimerId = null;
          scheduleFrame();
        }, delay);
      }

      // Keep paused off-screen decoders warm up to MAX_VIDEO_POOL, evicting oldest inactive entries only
      if (videoPool.size > MAX_VIDEO_POOL) {
        const evictable = Array.from(videoPool.values())
          .filter((e) => !e.active)
          .sort((a, b) => a.lastUsed - b.lastUsed);
        for (const old of evictable) {
          if (videoPool.size <= MAX_VIDEO_POOL) break;
          if (old.rvfcHandle !== null && old.video.cancelVideoFrameCallback) {
            old.video.cancelVideoFrameCallback(old.rvfcHandle);
            old.rvfcHandle = null;
          }
          old.video.pause();
          old.video.removeAttribute('src');
          old.video.load();
          gl.deleteTexture(old.tex);
          videoPool.delete(old.src);
        }
      }

      // Upload at most MAX_VIDEO_UPLOADS_PER_FRAME dirty video frame per render tick
      let videoUploaded = 0;
      let moreDirtyVideos = false;
      for (const entry of videoPool.values()) {
        if (!entry.active || !entry.ready || entry.video.readyState < 2) continue;
        if (!entry.usesRvfc && !entry.video.paused) {
          const curTime = entry.video.currentTime;
          if (curTime !== entry.lastVideoTime) {
            entry.lastVideoTime = curTime;
            entry.dirty = true;
          }
          needsNextFrame = true;
        }
        if (entry.dirty) {
          if (videoUploaded < MAX_VIDEO_UPLOADS_PER_FRAME) {
            gl.bindTexture(gl.TEXTURE_2D, entry.tex);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            const vw = entry.video.videoWidth || entry.width;
            const vh = entry.video.videoHeight || entry.height;
            if (!entry.texInitialized || entry.texWidth !== vw || entry.texHeight !== vh) {
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.video);
              entry.texInitialized = true;
              entry.texWidth = vw;
              entry.texHeight = vh;
              entry.width = vw;
              entry.height = vh;
            } else {
              gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, entry.video);
            }
            entry.dirty = false;
            videoUploaded++;
          } else {
            moreDirtyVideos = true;
          }
        }
      }
      if (moreDirtyVideos) {
        needsNextFrame = true;
      }

      // 5. Render background dot grid pass (subdivided mesh — zero loops in fragment shader)
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.BLEND);
      gl.useProgram(bgProg);
      gl.uniform2f(bgUniforms.uViewport, vp.width, vp.height);
      gl.uniform2f(bgUniforms.uViewOffset, view.x, view.y);
      gl.uniform1f(bgUniforms.uZoom, view.zoom);
      gl.uniform1f(bgUniforms.uWarpStrength, warpAmount);
      gl.uniform2f(bgUniforms.uVelocity, smoothVelRef.current.x, smoothVelRef.current.y);
      if (isDark) {
        gl.uniform3f(bgUniforms.uBgColor, 0.035, 0.035, 0.035);
        gl.uniform4f(bgUniforms.uDotColor, 1.0, 1.0, 1.0, 0.12);
      } else {
        gl.uniform3f(bgUniforms.uBgColor, 0.98, 0.98, 0.985);
        gl.uniform4f(bgUniforms.uDotColor, 0.1, 0.1, 0.12, 0.16);
      }
      gl.bindVertexArray(bgMesh.vao);
      gl.drawElements(gl.TRIANGLES, bgMesh.count, gl.UNSIGNED_SHORT, 0);

      // 6. Render subdivided tile meshes
      if (visibleCells.length > 0) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(tileProg);
        gl.uniform2f(tileUniforms.uViewport, vp.width, vp.height);
        gl.uniform2f(tileUniforms.uViewOffset, view.x, view.y);
        gl.uniform1f(tileUniforms.uZoom, view.zoom);
        gl.uniform1f(tileUniforms.uWarpStrength, warpAmount);
        gl.uniform2f(tileUniforms.uVelocity, smoothVelRef.current.x, smoothVelRef.current.y);
        gl.uniform2f(tileUniforms.uCardSize, CANVAS_CARD_W, CANVAS_CARD_H);
        gl.uniform1i(tileUniforms.uTex, 0);

        if (isDark) {
          gl.uniform3f(tileUniforms.uCardBg, 0.09, 0.09, 0.09);
          gl.uniform3f(tileUniforms.uBorderColor, 0.22, 0.22, 0.23);
          gl.uniform3f(tileUniforms.uPrimaryColor, 0.95, 0.95, 0.97);
        } else {
          gl.uniform3f(tileUniforms.uCardBg, 0.955, 0.955, 0.96);
          gl.uniform3f(tileUniforms.uBorderColor, 0.84, 0.84, 0.86);
          gl.uniform3f(tileUniforms.uPrimaryColor, 0.12, 0.12, 0.14);
        }

        gl.bindVertexArray(quadMesh.vao);
        gl.activeTexture(gl.TEXTURE0);

        const safeZoom = Math.max(CANVAS_MIN_ZOOM, view.zoom);
        const centerWorldX = (vp.width * 0.5 - view.x) / safeZoom;
        const centerWorldY = (vp.height * 0.5 - view.y) / safeZoom;

        for (const cell of visibleCells) {
          const worldX = cell.col * CANVAS_CELL_W;
          const worldY = cell.row * CANVAS_CELL_H;
          gl.uniform4f(tileUniforms.uTileRect, worldX, worldY, CANVAS_CARD_W, CANVAS_CARD_H);

          const isSelected =
            cell.item.kind === 'library' &&
            !!selectedSourceIdRef.current &&
            cell.item.sourceId === selectedSourceIdRef.current;
          const isHovered = hoveredCellRef.current?.key === cell.key && !isMovingRef.current;

          gl.uniform1f(tileUniforms.uSelected, isSelected ? 1 : 0);
          gl.uniform1f(tileUniforms.uHovered, isHovered ? 1 : 0);
          gl.uniform1f(
            tileUniforms.uHasVideoBadge,
            detail && cell.item.kind === 'library' && cell.item.mediaType === 'video' ? 1 : 0
          );

          const vidSrc = cell.item.kind === 'library' ? cell.item.videoSrc : undefined;
          const vidEntry = detail && vidSrc ? videoPool.get(vidSrc) : undefined;
          if (vidEntry && vidEntry.ready && vidEntry.texInitialized && vidEntry.active) {
            gl.bindTexture(gl.TEXTURE_2D, vidEntry.tex);
            const uv = computeTileUvTransform(
              vidEntry.width,
              vidEntry.height,
              CANVAS_CARD_W,
              CANVAS_CARD_H,
              'contain'
            );
            gl.uniform4f(tileUniforms.uUvTransform, uv.scaleX, uv.scaleY, uv.offsetX, uv.offsetY);
          } else {
            const dx = worldX + CANVAS_CARD_W * 0.5 - centerWorldX;
            const dy = worldY + CANVAS_CARD_H * 0.5 - centerWorldY;
            const texEntry = ensureTexture(cell.item, isDark, dx * dx + dy * dy);
            if (texEntry) {
              gl.bindTexture(gl.TEXTURE_2D, texEntry.tex);
              let scrollProgress = hoverScrollRef.current.get(cell.key) || 0;
              const fit = cell.item.kind === 'discover' ? 'cover-top' : 'contain';
              const uv = computeTileUvTransform(
                texEntry.width,
                texEntry.height,
                CANVAS_CARD_W,
                CANVAS_CARD_H,
                fit,
                scrollProgress
              );
              if (cell.item.kind === 'discover' && uv.scrollable) {
                const scaledH = (texEntry.height / Math.max(1, texEntry.width)) * CANVAS_CARD_W;
                const overflowPx = Math.max(1, scaledH - CANVAS_CARD_H);
                if (isHovered && scrollProgress < 1) {
                  scrollProgress = Math.min(1, scrollProgress + (HOVER_SCROLL_PX_PER_SEC * dtSec) / overflowPx);
                  hoverScrollRef.current.set(cell.key, scrollProgress);
                  needsNextFrame = true;
                } else if (!isHovered && scrollProgress > 0) {
                  scrollProgress = Math.max(
                    0,
                    scrollProgress - Math.max(dtSec * 2.2, (HOVER_SCROLL_PX_PER_SEC * 4 * dtSec) / overflowPx)
                  );
                  if (scrollProgress === 0) hoverScrollRef.current.delete(cell.key);
                  else hoverScrollRef.current.set(cell.key, scrollProgress);
                  needsNextFrame = true;
                }
                const nextUv = computeTileUvTransform(
                  texEntry.width,
                  texEntry.height,
                  CANVAS_CARD_W,
                  CANVAS_CARD_H,
                  fit,
                  scrollProgress
                );
                gl.uniform4f(tileUniforms.uUvTransform, nextUv.scaleX, nextUv.scaleY, nextUv.offsetX, nextUv.offsetY);
              } else {
                gl.uniform4f(tileUniforms.uUvTransform, uv.scaleX, uv.scaleY, uv.offsetX, uv.offsetY);
              }
            } else {
              gl.bindTexture(gl.TEXTURE_2D, emptyTex);
              gl.uniform4f(tileUniforms.uUvTransform, 1, 1, 0, 0);
            }
          }

          gl.drawElements(gl.TRIANGLES, quadMesh.count, gl.UNSIGNED_SHORT, 0);
        }
      }

      if (prefetchCells.length > 0) {
        const safeZoom = Math.max(CANVAS_MIN_ZOOM, view.zoom);
        const centerWorldX = (vp.width * 0.5 - view.x) / safeZoom;
        const centerWorldY = (vp.height * 0.5 - view.y) / safeZoom;
        for (const cell of prefetchCells) {
          const dx = cell.col * CANVAS_CELL_W + CANVAS_CARD_W * 0.5 - centerWorldX;
          const dy = cell.row * CANVAS_CELL_H + CANVAS_CARD_H * 0.5 - centerWorldY;
          ensureTexture(cell.item, isDark, 1e12 + dx * dx + dy * dy);
        }
      }

      if (
        requestQueue.length === 0 &&
        uploadQueue.length === 0 &&
        !isMovingRef.current &&
        !hasInertia &&
        activeDecodes < 4 &&
        curItems.length > 0 &&
        textureCache.size < MAX_TEXTURE_CACHE - 60 &&
        totalTextureBytes < MAX_TEXTURE_BYTES * 0.85
      ) {
        let queued = 0;
        let checked = 0;
        while (checked < curItems.length && queued < MAX_PREWARM_BATCH) {
          const idx = bgWarmCursor % curItems.length;
          bgWarmCursor = (idx + 1) % curItems.length;
          checked++;
          const item = curItems[idx];
          const key = textureKeyFor(item, isDark);
          if (textureCache.has(key) || pendingKeys.has(key) || failedKeys.has(key)) continue;
          ensureTexture(item, isDark, 1e15 + idx);
          queued++;
        }
      }

      if (requestQueue.length > 0) {
        if (requestQueue.length > 1) {
          requestQueue.sort((a, b) => b.distSq - a.distSq);
        }
        pumpDecodeQueue();
      }
      evictOldTextures();

      gl.bindVertexArray(null);
      if (needsNextFrame) {
        scheduleFrame();
      }
    }

    return () => {
      disposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (staggerTimerId !== null) window.clearTimeout(staggerTimerId);
      ro.disconnect();
      mo.disconnect();
      for (const entry of videoPool.values()) {
        if (entry.rvfcHandle !== null && entry.video.cancelVideoFrameCallback) {
          entry.video.cancelVideoFrameCallback(entry.rvfcHandle);
        }
        entry.video.pause();
        entry.video.removeAttribute('src');
        entry.video.load();
        gl.deleteTexture(entry.tex);
      }
      videoPool.clear();
      for (const entry of textureCache.values()) {
        gl.deleteTexture(entry.tex);
      }
      textureCache.clear();
      gl.deleteTexture(emptyTex);
      gl.deleteBuffer(bgMesh.vbo);
      gl.deleteBuffer(bgMesh.ibo);
      gl.deleteVertexArray(bgMesh.vao);
      gl.deleteBuffer(quadMesh.vbo);
      gl.deleteBuffer(quadMesh.ibo);
      gl.deleteVertexArray(quadMesh.vao);
      gl.deleteProgram(bgProg);
      gl.deleteProgram(tileProg);
    };
  }, [clampViewIfNeeded, markMoving]);

  // Attach native non-passive wheel, pointer, and gesture listeners for locked 120fps pan & pinch zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const activePointers = new Map<number, { x: number; y: number }>();
    let dragLast: { x: number; y: number } | null = null;
    let totalDist = 0;
    let gestureVelocity = { x: 0, y: 0 };
    let lastPinchDist = 0;
    let lastPinchMid = { x: 0, y: 0 };
    let gestureBaseZoom = 1;

    const syncRect = () => {
      const r = el.getBoundingClientRect();
      containerRectRef.current = { left: r.left, top: r.top, width: r.width, height: r.height };
      return r;
    };

    const onWheel = (e: WheelEvent) => {
      if (lightboxRef.current) return;
      if ((e.target as HTMLElement | null)?.closest('.infinite-canvas-hud')) return;
      if (document.querySelector('[role="dialog"], .overlay')) return;

      e.preventDefault();
      velocityRef.current = { x: 0, y: 0 };

      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === 1) {
        dx *= 16;
        dy *= 16;
      } else if (e.deltaMode === 2) {
        dx *= viewportRef.current.width || 800;
        dy *= viewportRef.current.height || 600;
      }

      if (e.ctrlKey || e.metaKey) {
        const rect = syncRect();
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
      smoothVelRef.current.x = Math.max(-0.05, Math.min(0.05, -dx / 900));
      smoothVelRef.current.y = Math.max(-0.05, Math.min(0.05, -dy / 900));
      clampViewIfNeeded();
      markMoving();
      wakeRenderRef.current();
    };

    const getPinchMetrics = () => {
      const pts = Array.from(activePointers.values());
      const p1 = pts[0];
      const p2 = pts[1];
      const rect = containerRectRef.current;
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

      syncRect();
      velocityRef.current = { x: 0, y: 0 };
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 1) {
        didDragRef.current = false;
        totalDist = 0;
        gestureVelocity = { x: 0, y: 0 };
        dragLast = { x: e.clientX, y: e.clientY };
      } else if (activePointers.size === 2) {
        el.classList.add('dragging');
        dragLast = null;
        didDragRef.current = true;
        const { dist, mid } = getPinchMetrics();
        lastPinchDist = dist;
        lastPinchMid = mid;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!activePointers.has(e.pointerId)) {
        if (activePointers.size === 0 && !isMovingRef.current && !lightboxRef.current) {
          const hit = resolveCellAtPointer(e.clientX, e.clientY);
          const prevKey = hoveredCellRef.current?.key ?? null;
          const nextKey = hit?.key ?? null;
          if (prevKey !== nextKey) {
            hoveredCellRef.current = hit ? { key: hit.key, col: hit.col, row: hit.row, index: hit.index } : null;
            el.style.cursor = hit ? 'pointer' : 'grab';
            wakeRenderRef.current();
          }
        }
        return;
      }
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2) {
        markMoving();
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
        clampViewIfNeeded();
        wakeRenderRef.current();
        return;
      }

      if (activePointers.size === 1 && dragLast) {
        const dx = e.clientX - dragLast.x;
        const dy = e.clientY - dragLast.y;
        totalDist += Math.abs(dx) + Math.abs(dy);
        if (totalDist > 6 && !didDragRef.current) {
          didDragRef.current = true;
          el.classList.add('dragging');
          el.style.cursor = '';
        }
        if (!didDragRef.current) return;
        markMoving();
        gestureVelocity = { x: dx, y: dy };
        dragLast = { x: e.clientX, y: e.clientY };
        viewRef.current.x += dx;
        viewRef.current.y += dy;
        smoothVelRef.current.x = Math.max(-0.06, Math.min(0.06, dx / 750));
        smoothVelRef.current.y = Math.max(-0.06, Math.min(0.06, dy / 750));
        clampViewIfNeeded();
        wakeRenderRef.current();
      }
    };

    const endPointer = (e: PointerEvent) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.delete(e.pointerId);

      if (activePointers.size === 1) {
        const remaining = Array.from(activePointers.values())[0];
        dragLast = { x: remaining.x, y: remaining.y };
        gestureVelocity = { x: 0, y: 0 };
        return;
      }

      if (activePointers.size === 0) {
        dragLast = null;
        el.classList.remove('dragging');

        if (Math.abs(gestureVelocity.x) > 1.2 || Math.abs(gestureVelocity.y) > 1.2) {
          velocityRef.current = { x: gestureVelocity.x, y: gestureVelocity.y };
          wakeRenderRef.current();
        }

        window.setTimeout(() => {
          didDragRef.current = false;
        }, 0);
      }
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      velocityRef.current = { x: 0, y: 0 };
      gestureBaseZoom = viewRef.current.zoom;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as unknown as { scale?: number; clientX?: number; clientY?: number };
      if (!ge.scale) return;
      const rect = syncRect();
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
    };
  }, [clampViewIfNeeded, markMoving, resolveCellAtPointer, zoomAtPoint]);

  // Keyboard shortcuts for zoom, fullscreen, & closing lightbox / restoring header.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

      if (e.key === 'Escape' && !e.defaultPrevented) {
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

      if (inInput || lightboxRef.current || document.querySelector('[role="dialog"], .overlay, [role="menu"]')) return;

      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        onToggleHeader();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
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

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (didDragRef.current) return;
      const hit = resolveCellAtPointer(e.clientX, e.clientY);
      if (!hit) return;
      if (hit.item.kind === 'discover') {
        onOpenUrl(hit.item.url);
      } else {
        onOpenItem(hit.item);
      }
    },
    [onOpenItem, onOpenUrl, resolveCellAtPointer]
  );

  const handleCanvasContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const hit = resolveCellAtPointer(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      onItemContextMenu(e, hit.item);
    },
    [onItemContextMenu, resolveCellAtPointer]
  );

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
      <canvas
        ref={canvasRef}
        className="infinite-canvas-webgl"
        data-canvas-tile-surface
        onClick={handleCanvasClick}
        onContextMenu={handleCanvasContextMenu}
      />
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
          <label className="canvas-warp-control" title="WebGL spherical lens curvature">
            <span>Lens</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={warp}
              aria-label="WebGL lens curvature"
              aria-valuetext={`${warp}%`}
              onChange={(e) => {
                const value = Number(e.target.value);
                warpRef.current = value;
                setWarp(value);
                wakeRenderRef.current();
                try {
                  localStorage.setItem('sightline-canvas-warp', String(value));
                } catch {}
              }}
            />
            <output>{warp}%</output>
          </label>
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
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="canvas-hud-btn canvas-fullscreen-btn"
            aria-label={headerMinimized ? 'Exit fullscreen canvas' : 'Fullscreen canvas'}
            title={headerMinimized ? 'Exit fullscreen (F or Esc)' : 'Fullscreen canvas (F)'}
            onClick={onToggleHeader}
          >
            {headerMinimized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </Button>
        </div>
      </div>

      {items.length === 0 &&
        (loading ? (
          <div className="infinite-canvas-empty">
            <div className="canvas-loading-pill">Loading website covers...</div>
          </div>
        ) : (
          <div className="infinite-canvas-empty" onPointerDown={(e) => e.stopPropagation()}>
            {emptyState}
          </div>
        ))}

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
                <Button size="sm" onClick={() => onOpenUrl(liveLightbox.url)}>
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
