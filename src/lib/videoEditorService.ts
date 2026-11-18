import { invoke } from '@tauri-apps/api/core';
import { assetFolderPrefix } from '../logic';
import type { Annotation, Asset, Source } from '../types';

export const VIDEO_FRAME_STEP = 1 / 60;
export const VIDEO_SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
export const MIN_VIDEO_SPEED = 0.1;
export const MAX_VIDEO_SPEED = 16;
export const MAX_VIDEO_SEGMENTS = 100;
export const MIN_SEGMENT_SPAN_SECS = 0.001;
export const MIN_CROP_SIZE = 0.01;
export const MAX_EDITOR_HISTORY = 50;

export type TauriInvokeFn = <R>(cmd: string, args?: Record<string, unknown>) => Promise<R>;

/**
 * Normalized crop rectangle in `[0, 1]` relative to the displayed video frame
 * (top-left origin), matching `extension/crop-editor.js` and `sightline-bridge.rs`.
 */
export type VideoCropRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export const FULL_CROP_RECT: Readonly<VideoCropRect> = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

export type VideoClipSegment = {
  /** Start timestamp in the source video (seconds). */
  start: number;
  /** End timestamp in the source video (seconds). */
  end: number;
  /** Position on the editor timeline (seconds). */
  at: number;
  /** Playback speed multiplier (`1` = normal speed). */
  speed: number;
};

export type VideoEditorSnapshot = {
  clips: VideoClipSegment[];
  crop: VideoCropRect;
  annotations: Annotation[];
};

export type VideoEditorState = {
  sourceDuration: number;
  duration: number;
  clips: VideoClipSegment[];
  selectedIndex: number;
  crop: VideoCropRect;
  annotations: Annotation[];
  playhead: number;
  history: VideoEditorSnapshot[];
  future: VideoEditorSnapshot[];
  dirty: boolean;
};

export type VideoProbeInfo = {
  width: number;
  height: number;
  duration: number;
  hasAudio: boolean;
};

export type VideoExportSegmentInput = {
  start: number;
  end: number;
  speed: number;
};

export type VideoEditExportRequest = {
  sourceFile: string;
  segments: VideoExportSegmentInput[];
  crop: VideoCropRect | null;
  folder?: string;
  includeAudio?: boolean;
  generatePreview?: boolean;
};

export type VideoExportResult = {
  id: string;
  file: string;
  thumbnail: string | null;
  previewVideo: string | null;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

export type VideoEditorServiceOptions = {
  invokeFn?: TauriInvokeFn;
};

export type ExportEditedVideoAssetParams<T extends Source = Source> = {
  state: Pick<VideoEditorState, 'clips' | 'crop' | 'annotations' | 'duration' | 'sourceDuration'>;
  source: T;
  originalAsset: Asset;
  sources: readonly T[];
  name?: string;
  tags?: string[];
  notes?: string;
  includeAudio?: boolean;
  generatePreview?: boolean;
  saveSources?: (nextSources: T[]) => Promise<boolean | void> | boolean | void;
  invokeFn?: TauriInvokeFn;
};

export type ExportEditedVideoAssetOutcome<T extends Source = Source> = {
  asset: Asset;
  sources: T[];
  exportResult: VideoExportResult;
  remappedAnnotations: Annotation[];
  saved: boolean;
};

const isNative = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function getInvoke(options?: VideoEditorServiceOptions): TauriInvokeFn | null {
  if (options?.invokeFn) return options.invokeFn;
  return isNative() ? (invoke as TauriInvokeFn) : null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function cloneClip(c: VideoClipSegment): VideoClipSegment {
  return {
    start: c.start,
    end: c.end,
    at: c.at,
    speed: clipSpeed(c),
  };
}

function cloneAnnotation(a: Annotation): Annotation {
  return { ...a };
}

function cloneCrop(c: VideoCropRect): VideoCropRect {
  return { x: c.x, y: c.y, w: c.w, h: c.h };
}

export function clipSpeed(clip: Pick<VideoClipSegment, 'speed'> | undefined): number {
  const spd = clip?.speed;
  return typeof spd === 'number' && Number.isFinite(spd) && spd > 0 ? spd : 1;
}

export function clipTimelineDuration(clip: Pick<VideoClipSegment, 'start' | 'end' | 'speed'>): number {
  return Math.max(0, (clip.end - clip.start) / clipSpeed(clip));
}

export function clipTimelineEnd(clip: VideoClipSegment): number {
  return clip.at + clipTimelineDuration(clip);
}

export function sortClipsByTimeline(clips: readonly VideoClipSegment[]): VideoClipSegment[] {
  return clips.map(cloneClip).sort((a, b) => a.at - b.at);
}

export function getTimelineBounds(
  clips: readonly VideoClipSegment[],
  fallbackDuration = 0
): { start: number; end: number } {
  if (!clips.length) {
    return { start: 0, end: Math.max(0, fallbackDuration) };
  }
  return {
    start: Math.min(...clips.map((c) => c.at)),
    end: Math.max(...clips.map(clipTimelineEnd)),
  };
}

/**
 * Matches `extension/review.js` `syncDuration()`:
 * when any clip uses custom speed, timeline duration shrinks/grows to fit `timelineEnd`;
 * otherwise it stays at `Math.max(sourceDuration, timelineEnd)`.
 */
export function computeTimelineDuration(
  clips: readonly VideoClipSegment[],
  sourceDuration: number
): number {
  const maxEnd = clips.length ? Math.max(...clips.map(clipTimelineEnd)) : sourceDuration;
  const hasCustomSpeed = clips.some((c) => Math.abs(clipSpeed(c) - 1) > 1e-4);
  return hasCustomSpeed ? Math.max(0.1, maxEnd) : Math.max(sourceDuration, maxEnd);
}

export function locateClipAtTime(clips: readonly VideoClipSegment[], time: number): number {
  if (!clips.length) return -1;
  let idx = clips.findIndex((c) => time >= c.at && time < clipTimelineEnd(c));
  if (idx >= 0) return idx;
  idx = clips.findIndex((c) => c.at > time);
  return idx < 0 ? clips.length - 1 : idx;
}

export function timelineToSourceTime(
  clips: readonly VideoClipSegment[],
  timelineTime: number
): { clipIndex: number; sourceTime: number; playbackRate: number } | null {
  if (!clips.length) return null;
  const clipIndex = locateClipAtTime(clips, timelineTime);
  const clip = clips[clipIndex];
  if (!clip) return null;
  const playbackRate = clipSpeed(clip);
  const sourceTime = clamp(clip.start + (timelineTime - clip.at) * playbackRate, clip.start, clip.end);
  return { clipIndex, sourceTime, playbackRate };
}

export function sourceToTimelineTime(
  clips: readonly VideoClipSegment[],
  sourceTime: number
): number | null {
  const clip = clips.find((c) => sourceTime >= c.start && sourceTime <= c.end);
  if (!clip) return null;
  return clip.at + (sourceTime - clip.start) / clipSpeed(clip);
}

export function isFullCrop(crop: VideoCropRect | null | undefined): boolean {
  if (!crop) return true;
  return (
    Math.abs(crop.x) < 1e-6 &&
    Math.abs(crop.y) < 1e-6 &&
    Math.abs(crop.w - 1) < 1e-6 &&
    Math.abs(crop.h - 1) < 1e-6
  );
}

export function validateCropRect(crop: VideoCropRect | null | undefined): VideoCropRect | null {
  if (!crop) return null;
  const values = [crop.x, crop.y, crop.w, crop.h];
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new Error('Invalid crop: coordinates must be finite numbers.');
  }
  if (crop.x < 0 || crop.y < 0 || crop.w <= 0 || crop.h <= 0) {
    throw new Error('Invalid crop: coordinates must be within [0, 1] with positive size.');
  }
  if (crop.x + crop.w > 1.000001 || crop.y + crop.h > 1.000001) {
    throw new Error('Invalid crop: selection exceeds video bounds.');
  }
  const x = clamp(crop.x, 0, 1);
  const y = clamp(crop.y, 0, 1);
  const w = Math.min(crop.w, Math.max(1e-6, 1 - x));
  const h = Math.min(crop.h, Math.max(1e-6, 1 - y));
  const normalized = { x, y, w, h };
  return isFullCrop(normalized) ? null : normalized;
}

/**
 * Adjusts a crop rectangle during drag/keyboard resize using the exact bounds
 * and `MIN_CROP_SIZE = 0.01` clamping from `extension/crop-editor.js`.
 */
export function adjustCropRect(
  original: VideoCropRect,
  side: CropHandle,
  dx: number,
  dy: number,
  minSize = MIN_CROP_SIZE
): VideoCropRect {
  let { x, y, w, h } = original;
  if (side === 'move') {
    x = clamp(x + dx, 0, 1 - w);
    y = clamp(y + dy, 0, 1 - h);
  } else {
    if (side.includes('w')) {
      const next = clamp(x + dx, 0, x + w - minSize);
      w += x - next;
      x = next;
    }
    if (side.includes('e')) {
      w = clamp(w + dx, minSize, 1 - x);
    }
    if (side.includes('n')) {
      const next = clamp(y + dy, 0, y + h - minSize);
      h += y - next;
      y = next;
    }
    if (side.includes('s')) {
      h = clamp(h + dy, minSize, 1 - y);
    }
  }
  return { x, y, w, h };
}

export function snapshotEditorState(
  state: Pick<VideoEditorState, 'clips' | 'crop' | 'annotations'>
): VideoEditorSnapshot {
  return {
    clips: state.clips.map(cloneClip),
    crop: cloneCrop(state.crop),
    annotations: state.annotations.map(cloneAnnotation),
  };
}

export function pushEditorHistory(
  state: VideoEditorState,
  before: VideoEditorSnapshot = snapshotEditorState(state)
): VideoEditorState {
  const nextHistory = [...state.history, before];
  if (nextHistory.length > MAX_EDITOR_HISTORY) {
    nextHistory.shift();
  }
  return {
    ...state,
    history: nextHistory,
    future: [],
    dirty: true,
  };
}

export function createVideoEditorState(
  sourceDuration: number,
  annotations: readonly Annotation[] = [],
  initialCrop?: VideoCropRect | null
): VideoEditorState {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    throw new Error('Could not read video duration.');
  }
  const validatedCrop = validateCropRect(initialCrop) ?? cloneCrop(FULL_CROP_RECT);
  return {
    sourceDuration,
    duration: sourceDuration,
    clips: [{ start: 0, end: sourceDuration, at: 0, speed: 1 }],
    selectedIndex: 0,
    crop: validatedCrop,
    annotations: annotations.map(cloneAnnotation),
    playhead: 0,
    history: [],
    future: [],
    dirty: false,
  };
}

/**
 * Matches `extension/annotations.js` `shiftTiming(fromTime, delta, rangeEnd, scale)`:
 * scales overlapping annotations when a clip speed changes, and shifts/adjusts annotations
 * when a clip's timeline position shifts or normalizes back to `0`.
 */
export function shiftAnnotationTiming(
  items: readonly Annotation[],
  fromTime: number,
  delta: number,
  rangeEnd?: number,
  scale = 1
): Annotation[] {
  return items.map((item) => {
    if (item.start == null) return cloneAnnotation(item);
    const currentEnd = item.end ?? item.start;
    if (scale !== 1 && rangeEnd != null && item.start < rangeEnd && currentEnd > fromTime) {
      const nextStart =
        item.start <= fromTime ? item.start : fromTime + (item.start - fromTime) * scale;
      const nextEnd =
        currentEnd >= rangeEnd
          ? rangeEnd + (rangeEnd - fromTime) * (scale - 1) + (currentEnd - rangeEnd)
          : fromTime + (currentEnd - fromTime) * scale;
      return {
        ...item,
        start: nextStart,
        end: Math.max(nextStart + 0.05, nextEnd),
      };
    }
    if (delta !== 0 && item.start >= fromTime - 0.001) {
      return {
        ...item,
        start: Math.max(0, item.start + delta),
        end: Math.max(0.05, currentEnd + delta),
      };
    }
    if (delta !== 0 && currentEnd > fromTime) {
      return {
        ...item,
        end: Math.max(item.start + 0.05, currentEnd + delta),
      };
    }
    return cloneAnnotation(item);
  });
}

/**
 * Remaps annotation coordinates (into the cropped viewport) and timestamps
 * (into the concatenated exported timeline), matching `extension/annotations.js`.
 */
export function remapAnnotationsForExport(
  items: readonly Annotation[],
  crop: VideoCropRect | null | undefined,
  clips: readonly VideoClipSegment[] | undefined,
  fallbackTimelineEnd?: number
): Annotation[] {
  const effectiveCrop = crop ?? FULL_CROP_RECT;
  const sortedSegments = clips ? sortClipsByTimeline(clips) : null;
  const resolvedFallbackEnd =
    fallbackTimelineEnd ?? (sortedSegments ? getTimelineBounds(sortedSegments).end : undefined);

  return items.flatMap((a) => {
    const x = Math.max(a.x, effectiveCrop.x);
    const y = Math.max(a.y, effectiveCrop.y);
    const right = Math.min(a.x + (a.w || 0), effectiveCrop.x + effectiveCrop.w);
    const bottom = Math.min(a.y + (a.h || 0), effectiveCrop.y + effectiveCrop.h);

    const hasArea = Boolean(a.w && a.h);
    const outside = hasArea
      ? right <= x || bottom <= y
      : a.x < effectiveCrop.x ||
        a.x > effectiveCrop.x + effectiveCrop.w ||
        a.y < effectiveCrop.y ||
        a.y > effectiveCrop.y + effectiveCrop.h;
    if (outside) return [];

    const base: Annotation = {
      ...a,
      x: (x - effectiveCrop.x) / effectiveCrop.w,
      y: (y - effectiveCrop.y) / effectiveCrop.h,
      w: a.w ? (right - x) / effectiveCrop.w : 0,
      h: a.h ? (bottom - y) / effectiveCrop.h : 0,
    };

    if (!sortedSegments) return [base];

    // Untimed annotations without start/end/time survive temporal clipping.
    if (a.start == null && a.end == null && a.time == null) {
      return [base];
    }

    let offset = 0;
    const result: Annotation[] = [];
    for (const segment of sortedSegments) {
      const spd = clipSpeed(segment);
      const timelineStart = segment.at ?? offset;
      const length = (segment.end - segment.start) / spd;
      let start = a.start;
      let end = a.end;

      if (start == null && a.time != null) {
        start = timelineStart + (a.time - segment.start) / spd;
        end = start + 2;
      } else if (start != null && end == null) {
        end = resolvedFallbackEnd ?? timelineStart + length;
      }

      if (start != null && end != null) {
        const from = Math.max(start, timelineStart);
        const to = Math.min(end, timelineStart + length);
        if (to > from) {
          const id = result.length ? `${a.id}-${result.length}` : a.id;
          const { time: _droppedTime, ...rest } = base;
          result.push({
            ...rest,
            id,
            start: offset + from - timelineStart,
            end: offset + to - timelineStart,
          });
        }
      }
      offset += length;
    }
    return result;
  });
}

export function hasOmittedAnnotations(
  items: readonly Annotation[],
  crop: VideoCropRect | null | undefined,
  clips: readonly VideoClipSegment[],
  fallbackTimelineEnd?: number
): boolean {
  return items.some(
    (item) => remapAnnotationsForExport([item], crop, clips, fallbackTimelineEnd).length === 0
  );
}

/**
 * Normalizes timeline so the earliest clip starts at `0`, shifting `playhead` and annotations
 * identically to `extension/review.js` `normalizeStart()`.
 */
export function normalizeTimelineStart(state: VideoEditorState): VideoEditorState {
  if (!state.clips.length) return state;
  const first = Math.min(...state.clips.map((c) => c.at));
  if (first <= 0) return state;
  const nextClips = state.clips.map((c) => ({ ...c, at: Math.max(0, c.at - first) }));
  const nextAnnotations = shiftAnnotationTiming(state.annotations, 0, -first);
  const nextDuration = computeTimelineDuration(nextClips, state.sourceDuration);
  return {
    ...state,
    clips: nextClips,
    annotations: nextAnnotations,
    playhead: Math.max(0, state.playhead - first),
    duration: nextDuration,
  };
}

export function canSplitClipAtTime(
  state: Pick<VideoEditorState, 'clips' | 'selectedIndex' | 'playhead'>,
  time = state.playhead,
  index = state.selectedIndex
): boolean {
  const c = state.clips[index];
  if (!c) return false;
  const offset = time - c.at;
  const minLen = VIDEO_FRAME_STEP / clipSpeed(c);
  return offset > minLen && offset < clipTimelineDuration(c) - minLen;
}

export function splitClipAtTime(
  state: VideoEditorState,
  time = state.playhead,
  index = state.selectedIndex
): VideoEditorState {
  if (!canSplitClipAtTime(state, time, index)) return state;
  const c = state.clips[index];
  const spd = clipSpeed(c);
  const offset = time - c.at;
  const splitSource = c.start + offset * spd;
  const withHistory = pushEditorHistory(state);
  const nextClips = withHistory.clips.map(cloneClip);
  nextClips.splice(
    index,
    1,
    { start: c.start, end: splitSource, at: c.at, speed: spd },
    { start: splitSource, end: c.end, at: time, speed: spd }
  );
  return {
    ...withHistory,
    clips: nextClips,
    selectedIndex: index + 1,
    playhead: time,
  };
}

export function canDeleteClip(state: Pick<VideoEditorState, 'clips'>): boolean {
  return state.clips.length > 1;
}

export function deleteClipAtIndex(
  state: VideoEditorState,
  index = state.selectedIndex
): VideoEditorState {
  if (state.clips.length <= 1 || index < 0 || index >= state.clips.length) {
    return state;
  }
  const withHistory = pushEditorHistory(state);
  const nextClips = withHistory.clips.map(cloneClip);
  nextClips.splice(index, 1);
  const nextSelected = clamp(index, 0, nextClips.length - 1);
  const normalized = normalizeTimelineStart({
    ...withHistory,
    clips: nextClips,
    selectedIndex: nextSelected,
  });
  const endLimit = getTimelineBounds(normalized.clips, normalized.sourceDuration).end;
  return {
    ...normalized,
    playhead: clamp(normalized.playhead, 0, endLimit),
  };
}

/**
 * Trims the selected clip's start to `time` (extension `Q` shortcut), then normalizes timeline start.
 */
export function trimClipStartToTime(
  state: VideoEditorState,
  time = state.playhead,
  index = state.selectedIndex
): VideoEditorState {
  const c = state.clips[index];
  if (!c) return state;
  const spd = clipSpeed(c);
  const offset = time - c.at;
  const minLen = VIDEO_FRAME_STEP / spd;
  if (offset <= minLen || offset >= clipTimelineDuration(c) - minLen) {
    return state;
  }
  const withHistory = pushEditorHistory(state);
  const nextClips = withHistory.clips.map((clip, i) =>
    i === index ? { ...clip, start: clip.start + offset * spd, at: clip.at + offset } : cloneClip(clip)
  );
  const normalized = normalizeTimelineStart({
    ...withHistory,
    clips: nextClips,
  });
  const trimmedClip = normalized.clips[index];
  return {
    ...normalized,
    playhead: trimmedClip ? trimmedClip.at : normalized.playhead,
  };
}

/**
 * Trims the selected clip's end to `time` (extension `W` shortcut).
 */
export function trimClipEndToTime(
  state: VideoEditorState,
  time = state.playhead,
  index = state.selectedIndex
): VideoEditorState {
  const c = state.clips[index];
  if (!c) return state;
  const spd = clipSpeed(c);
  const offset = time - c.at;
  const minLen = VIDEO_FRAME_STEP / spd;
  if (offset <= minLen || offset >= clipTimelineDuration(c) - minLen) {
    return state;
  }
  const withHistory = pushEditorHistory(state);
  const nextClips = withHistory.clips.map((clip, i) =>
    i === index ? { ...clip, end: clip.start + offset * spd } : cloneClip(clip)
  );
  const nextDuration = computeTimelineDuration(nextClips, withHistory.sourceDuration);
  const updated = nextClips[index];
  return {
    ...withHistory,
    clips: nextClips,
    duration: nextDuration,
    playhead: updated ? clamp(clipTimelineEnd(updated), 0, nextDuration) : withHistory.playhead,
  };
}

/**
 * Applies a left-edge trim, right-edge trim, or clip move along the timeline
 * matching `extension/review.js` pointer drag rules without letting clips overlap.
 */
export function moveOrTrimClipHandle(
  state: VideoEditorState,
  index: number,
  side: 'left' | 'right' | 'move',
  deltaTimelineSecs: number,
  originalClip?: VideoClipSegment
): VideoEditorState {
  const base = originalClip ?? state.clips[index];
  if (!base || !Number.isFinite(deltaTimelineSecs)) return state;
  const spd = clipSpeed(base);
  const baseWidth = clipTimelineDuration(base);
  const baseEnd = base.at + baseWidth;
  const others = state.clips.filter((_, i) => i !== index);
  const leftBound = Math.max(0, ...others.filter((x) => clipTimelineEnd(x) <= base.at + 0.0001).map(clipTimelineEnd));
  const rightBound = Math.min(
    state.duration,
    ...others.filter((x) => x.at >= baseEnd - 0.0001).map((x) => x.at)
  );

  let nextClip: VideoClipSegment;
  if (side === 'left') {
    const shift = clamp(deltaTimelineSecs, Math.max(leftBound - base.at, -base.start / spd), baseWidth - VIDEO_FRAME_STEP);
    nextClip = {
      ...cloneClip(base),
      start: base.start + shift * spd,
      at: base.at + shift,
    };
  } else if (side === 'right') {
    const shift = clamp(
      deltaTimelineSecs,
      -baseWidth + VIDEO_FRAME_STEP,
      Math.min(state.duration - baseEnd, rightBound - baseEnd, (state.sourceDuration - base.end) / spd)
    );
    nextClip = {
      ...cloneClip(base),
      end: base.end + shift * spd,
    };
  } else {
    nextClip = {
      ...cloneClip(base),
      at: clamp(base.at + deltaTimelineSecs, leftBound, Math.max(leftBound, rightBound - baseWidth)),
    };
  }

  const nextClips = state.clips.map((c, i) => (i === index ? nextClip : cloneClip(c)));
  return {
    ...state,
    clips: nextClips,
    selectedIndex: index,
  };
}

/**
 * Sets clip playback speed and shifts subsequent clips and overlapping annotations
 * identically to `extension/review.js` `setClipSpeed()`.
 */
export function setClipSpeed(
  state: VideoEditorState,
  index: number,
  nextSpeed: number
): VideoEditorState {
  if (!Number.isFinite(nextSpeed) || nextSpeed < MIN_VIDEO_SPEED || nextSpeed > MAX_VIDEO_SPEED) {
    throw new Error(`Speed must be between ${MIN_VIDEO_SPEED}x and ${MAX_VIDEO_SPEED}x.`);
  }
  const c = state.clips[index];
  if (!c) {
    throw new Error('Selected clip does not exist.');
  }
  const cur = clipSpeed(c);
  if (Math.abs(cur - nextSpeed) < 1e-4) {
    return state;
  }

  const withHistory = pushEditorHistory(state);
  const oldWidth = clipTimelineDuration(c);
  const oldEnd = clipTimelineEnd(c);
  const sourceOffset =
    withHistory.playhead >= c.at && withHistory.playhead <= oldEnd
      ? (withHistory.playhead - c.at) * cur
      : null;

  const updatedClip: VideoClipSegment = { ...cloneClip(c), speed: nextSpeed };
  const newWidth = clipTimelineDuration(updatedClip);
  const delta = newWidth - oldWidth;

  const nextClips = withHistory.clips.map((other, i) => {
    if (i === index) return updatedClip;
    if (other.at >= oldEnd - 0.0001) {
      return { ...cloneClip(other), at: Math.max(0, other.at + delta) };
    }
    return cloneClip(other);
  });

  const nextAnnotations = shiftAnnotationTiming(
    withHistory.annotations,
    c.at,
    delta,
    oldEnd,
    oldWidth > 0 ? newWidth / oldWidth : 1
  );
  const nextDuration = computeTimelineDuration(nextClips, withHistory.sourceDuration);
  const nextPlayhead =
    sourceOffset !== null ? c.at + sourceOffset / nextSpeed : withHistory.playhead;

  return {
    ...withHistory,
    clips: nextClips,
    annotations: nextAnnotations,
    duration: nextDuration,
    playhead: clamp(nextPlayhead, 0, nextDuration),
  };
}

export function setCropRect(
  state: VideoEditorState,
  crop: VideoCropRect | null,
  recordHistory = true
): VideoEditorState {
  const validated = validateCropRect(crop) ?? cloneCrop(FULL_CROP_RECT);
  if (
    Math.abs(validated.x - state.crop.x) < 1e-6 &&
    Math.abs(validated.y - state.crop.y) < 1e-6 &&
    Math.abs(validated.w - state.crop.w) < 1e-6 &&
    Math.abs(validated.h - state.crop.h) < 1e-6
  ) {
    return state;
  }
  const nextState = recordHistory ? pushEditorHistory(state) : state;
  return {
    ...nextState,
    crop: validated,
  };
}

export function resetCropRect(state: VideoEditorState): VideoEditorState {
  if (isFullCrop(state.crop)) return state;
  return setCropRect(state, null, true);
}

export function undoVideoEdit(state: VideoEditorState): VideoEditorState {
  if (!state.history.length) return state;
  const current = snapshotEditorState(state);
  const prev = state.history[state.history.length - 1];
  const nextHistory = state.history.slice(0, -1);
  const nextFuture = [...state.future, current];
  const nextClips = prev.clips.map(cloneClip);
  const nextDuration = computeTimelineDuration(nextClips, state.sourceDuration);
  return {
    ...state,
    clips: nextClips,
    crop: cloneCrop(prev.crop),
    annotations: prev.annotations.map(cloneAnnotation),
    selectedIndex: clamp(state.selectedIndex, 0, Math.max(0, nextClips.length - 1)),
    duration: nextDuration,
    playhead: clamp(state.playhead, 0, nextDuration),
    history: nextHistory,
    future: nextFuture,
    dirty: true,
  };
}

export function redoVideoEdit(state: VideoEditorState): VideoEditorState {
  if (!state.future.length) return state;
  const current = snapshotEditorState(state);
  const nextSnap = state.future[state.future.length - 1];
  const nextFuture = state.future.slice(0, -1);
  const nextHistory = [...state.history, current];
  if (nextHistory.length > MAX_EDITOR_HISTORY) {
    nextHistory.shift();
  }
  const nextClips = nextSnap.clips.map(cloneClip);
  const nextDuration = computeTimelineDuration(nextClips, state.sourceDuration);
  return {
    ...state,
    clips: nextClips,
    crop: cloneCrop(nextSnap.crop),
    annotations: nextSnap.annotations.map(cloneAnnotation),
    selectedIndex: clamp(state.selectedIndex, 0, Math.max(0, nextClips.length - 1)),
    duration: nextDuration,
    playhead: clamp(state.playhead, 0, nextDuration),
    history: nextHistory,
    future: nextFuture,
    dirty: true,
  };
}

export function resetVideoEditorState(state: VideoEditorState): VideoEditorState {
  const withHistory = pushEditorHistory(state);
  return {
    ...withHistory,
    clips: [{ start: 0, end: state.sourceDuration, at: 0, speed: 1 }],
    crop: cloneCrop(FULL_CROP_RECT),
    annotations: [],
    selectedIndex: 0,
    duration: state.sourceDuration,
    playhead: 0,
  };
}

export function prepareVideoExportPayload(params: {
  sourceFile: string;
  clips: readonly VideoClipSegment[];
  crop?: VideoCropRect | null;
  sourceDuration?: number;
  folder?: string;
  includeAudio?: boolean;
  generatePreview?: boolean;
}): VideoEditExportRequest {
  const sourceFile = params.sourceFile.trim();
  if (!sourceFile) {
    throw new Error('Source video file path is required.');
  }
  if (!params.clips.length) {
    throw new Error('At least one clip segment is required.');
  }
  if (params.clips.length > MAX_VIDEO_SEGMENTS) {
    throw new Error(`Too many clip segments (maximum ${MAX_VIDEO_SEGMENTS}).`);
  }

  const sorted = sortClipsByTimeline(params.clips);
  const segments: VideoExportSegmentInput[] = sorted.map((clip, i) => {
    const spd = clipSpeed(clip);
    if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || !Number.isFinite(spd)) {
      throw new Error(`Invalid clip segment ${i + 1}: non-finite value.`);
    }
    if (clip.start < 0) {
      throw new Error(`Invalid clip segment ${i + 1}: start cannot be negative.`);
    }
    if (spd < MIN_VIDEO_SPEED || spd > MAX_VIDEO_SPEED) {
      throw new Error(
        `Invalid clip segment ${i + 1}: speed must be between ${MIN_VIDEO_SPEED}x and ${MAX_VIDEO_SPEED}x.`
      );
    }
    let end = clip.end;
    if (params.sourceDuration != null && Number.isFinite(params.sourceDuration)) {
      if (clip.start >= params.sourceDuration) {
        throw new Error(`Invalid clip segment ${i + 1}: start is past video duration.`);
      }
      if (end > params.sourceDuration + 0.25) {
        throw new Error(`Invalid clip segment ${i + 1}: end exceeds video duration.`);
      }
      if (end > params.sourceDuration) {
        end = params.sourceDuration;
      }
    }
    if (end - clip.start < MIN_SEGMENT_SPAN_SECS) {
      throw new Error(`Invalid clip segment ${i + 1}: end must be greater than start.`);
    }
    return {
      start: clip.start,
      end,
      speed: spd,
    };
  });

  const normalizedCrop = validateCropRect(params.crop);
  const folder = params.folder?.trim() || assetFolderPrefix(sourceFile) || undefined;

  return {
    sourceFile,
    segments,
    crop: normalizedCrop,
    ...(folder ? { folder } : {}),
    ...(params.includeAudio !== undefined ? { includeAudio: params.includeAudio } : {}),
    ...(params.generatePreview !== undefined ? { generatePreview: params.generatePreview } : {}),
  };
}

export function buildEditedVideoName(originalName: string): string {
  const trimmed = originalName.trim();
  if (!trimmed) return 'Edited video';
  const clean = trimmed.replace(/\s+\(edited(?:\s+\d+)?\)$/i, '').trim() || trimmed;
  return `${clean} (edited)`;
}

export function buildExportedVideoAsset(params: {
  exportResult: VideoExportResult;
  originalAsset: Asset;
  remappedAnnotations?: Annotation[];
  name?: string;
  tags?: string[];
  notes?: string;
}): Asset {
  const { exportResult, originalAsset, remappedAnnotations } = params;
  const resolvedName = params.name?.trim() || buildEditedVideoName(originalAsset.name);
  const resolvedTags = params.tags ?? (originalAsset.tags ? [...originalAsset.tags] : undefined);
  const resolvedNotes = params.notes ?? originalAsset.notes;
  const cleanAnnotations =
    remappedAnnotations && remappedAnnotations.length > 0 ? remappedAnnotations : undefined;

  const asset: Asset = {
    id: exportResult.id,
    name: resolvedName,
    file: exportResult.file,
    kind: 'video',
  };

  if (exportResult.thumbnail) asset.thumbnail = exportResult.thumbnail;
  if (exportResult.previewVideo) asset.previewVideo = exportResult.previewVideo;
  if (originalAsset.sourceUrl) asset.sourceUrl = originalAsset.sourceUrl;
  if (resolvedTags && resolvedTags.length > 0) asset.tags = resolvedTags;
  if (resolvedNotes) asset.notes = resolvedNotes;
  if (cleanAnnotations) asset.annotations = cleanAnnotations;
  return asset;
}

export function insertExportedAssetIntoSources<T extends Source>(
  sources: readonly T[],
  sourceId: string,
  exportedAsset: Asset,
  afterAssetId?: string
): T[] {
  const targetExists = sources.some((s) => s.id === sourceId);
  if (!targetExists) {
    throw new Error(`Target source "${sourceId}" was not found in the library.`);
  }
  return sources.map((source) => {
    if (source.id !== sourceId) return source;
    const assets = [...source.assets];
    if (afterAssetId) {
      const idx = assets.findIndex((a) => a.id === afterAssetId);
      if (idx >= 0) {
        assets.splice(idx + 1, 0, exportedAsset);
        return { ...source, assets };
      }
    }
    assets.push(exportedAsset);
    return { ...source, assets };
  });
}

/**
 * Inspects a video asset using FFprobe via the `probe_video_asset` Tauri command.
 */
export async function probeVideoAsset(
  file: string,
  options?: VideoEditorServiceOptions & { trashed?: boolean }
): Promise<VideoProbeInfo> {
  const cleanFile = file.trim();
  if (!cleanFile) {
    throw new Error('Video file path is required.');
  }
  const invokeFn = getInvoke(options);
  if (!invokeFn) {
    throw new Error('Video inspection is only available in the Sightline desktop app.');
  }
  return invokeFn<VideoProbeInfo>('probe_video_asset', {
    file: cleanFile,
    ...(options?.trashed !== undefined ? { trashed: options.trashed } : {}),
  });
}

/**
 * Renders an edited video via FFmpeg (`export_edited_video`) as a brand-new asset file,
 * remaps crop/clip annotations, inserts the new asset into `sources` without altering the
 * original asset, and persists the updated library when `saveSources` is provided.
 */
export async function exportEditedVideoAsset<T extends Source = Source>(
  params: ExportEditedVideoAssetParams<T>
): Promise<ExportEditedVideoAssetOutcome<T>> {
  if (params.originalAsset.kind !== 'video') {
    throw new Error('Only video assets can be edited and exported.');
  }
  if (params.originalAsset.trashedAt) {
    throw new Error('Restore the video from Trash before editing and exporting it.');
  }

  const invokeFn = getInvoke({ invokeFn: params.invokeFn });
  if (!invokeFn) {
    throw new Error('Video export is only available in the Sightline desktop app.');
  }

  const folder = params.source.folder?.trim() || assetFolderPrefix(params.originalAsset.file) || undefined;
  const request = prepareVideoExportPayload({
    sourceFile: params.originalAsset.file,
    clips: params.state.clips,
    crop: params.state.crop,
    sourceDuration: params.state.sourceDuration,
    folder,
    includeAudio: params.includeAudio,
    generatePreview: params.generatePreview,
  });

  const exportResult = await invokeFn<VideoExportResult>('export_edited_video', { request });
  const remappedAnnotations = remapAnnotationsForExport(
    params.state.annotations,
    request.crop,
    params.state.clips,
    params.state.duration
  );

  const asset = buildExportedVideoAsset({
    exportResult,
    originalAsset: params.originalAsset,
    remappedAnnotations,
    name: params.name,
    tags: params.tags,
    notes: params.notes,
  });

  const nextSources = insertExportedAssetIntoSources(
    params.sources,
    params.source.id,
    asset,
    params.originalAsset.id
  );

  let saved = false;
  if (params.saveSources) {
    try {
      const ok = await params.saveSources(nextSources);
      if (ok === false) {
        throw new Error(
          `Rendered new video (${exportResult.file}), but saving the library failed.`
        );
      }
      saved = true;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (detail.includes(exportResult.file)) {
        throw err;
      }
      throw new Error(
        `Rendered new video (${exportResult.file}), but saving the library failed: ${detail}`
      );
    }
  }

  return {
    asset,
    sources: nextSources,
    exportResult,
    remappedAnnotations,
    saved,
  };
}
