import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Crop, Eye, EyeOff, Pause, Play, Redo2, RotateCcw, Scissors, Trash2, Undo2 } from 'lucide-react';
import { Button } from './ui/button';
import type { Annotation } from '../types';
import {
  VIDEO_FRAME_STEP, VIDEO_SPEED_PRESETS,
  clipSpeed, clipTimelineDuration, clipTimelineEnd, computeTimelineDuration, createVideoEditorState, deleteClipAtIndex,
  getTimelineBounds, hasOmittedAnnotations, moveOrTrimClipHandle, normalizeTimelineStart,
  pushEditorHistory, redoVideoEdit, resetVideoEditorState, setClipSpeed, setCropRect,
  splitClipAtTime, sourceToTimelineTime, timelineToSourceTime, trimClipEndToTime, trimClipStartToTime, undoVideoEdit,
  type VideoClipSegment, type VideoEditorState, type VideoCropRect,
} from '../lib/videoEditorService';

type ClipSide = 'move' | 'left' | 'right' | 'speed-left' | 'speed-right';
type AnnotationRange = { id: string; start: number; end: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const formatTime = (seconds: number) => {
  const value = Math.max(0, seconds);
  const minutes = Math.floor(value / 60);
  return `${minutes}:${(value - minutes * 60).toFixed(2).padStart(5, '0')}`;
};
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** Timeline range of an annotation (mirrors `extension/annotations.js`; legacy `time` pins get a 2s bar). */
function annotationRange(item: Annotation, limitEnd: number): { start: number; end: number } | null {
  if (item.start === undefined && item.time === undefined) return null;
  const start = item.start ?? Math.max(0, (item.time ?? 0) - 1);
  const end = item.end ?? (item.start !== undefined ? limitEnd : start + 2);
  return { start, end: Math.max(start, end) };
}

/** Maps a timeline time back to source time. Only unambiguous with one clip. */
function toSourceTime(clips: readonly VideoClipSegment[], time: number): number | null {
  if (clips.length !== 1) return null;
  const clip = clips[0];
  return clip.start + (time - clip.at) * clipSpeed(clip);
}

const SNAP_PX = 8;
/** Nearest snap point within `threshold` of any candidate time; returns the shift to apply and the point. */
function nearestSnap(points: readonly number[], candidates: readonly number[], threshold: number): { shift: number; point: number } | null {
  let best: { shift: number; point: number } | null = null;
  for (const candidate of candidates) for (const point of points) {
    const distance = Math.abs(point - candidate);
    if (distance <= threshold && (!best || distance < Math.abs(best.shift))) best = { shift: point - candidate, point };
  }
  return best;
}

/** Runs `move` for every pointer move until the pointer is released or cancelled. */
function trackPointer(move: (event: PointerEvent) => void, finish: (cancelled: boolean) => void) {
  const stop = (cancelled: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    finish(cancelled);
  };
  const up = () => stop(false);
  const cancel = () => stop(true);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

export function DesktopVideoTimeline({ enabled, getVideo, annotations, annotationsVisible = false, onAnnotationsVisibleChange, onAnnotationRange, onAnnotationOpen, onExport }: {
  enabled: boolean;
  getVideo: () => HTMLVideoElement | null;
  annotations: Annotation[];
  annotationsVisible?: boolean;
  onAnnotationsVisibleChange?: (visible: boolean) => void;
  /** Called with source-time bounds after an annotation bar is moved or resized (single-clip timelines only). */
  onAnnotationRange?: (id: string, start: number, end: number) => void;
  /** Called when an annotation bar is double-clicked, to open its note editor. */
  onAnnotationOpen?: (id: string) => void;
  onExport: (state: VideoEditorState) => Promise<void>;
}) {
  const [state, setState] = useState<VideoEditorState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cropMode, setCropMode] = useState(false);
  const [cropDraft, setCropDraft] = useState<VideoCropRect>();
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [playing, setPlaying] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [capHover, setCapHover] = useState(false);
  const [retiming, setRetiming] = useState<{ index: number; speed: number } | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationRange | null>(null);
  const [frozenExtent, setFrozenExtent] = useState<number | null>(null);
  const [bodyWidth, setBodyWidth] = useState(0);
  const [snapGuide, setSnapGuide] = useState<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const current = useRef(state);
  const previousAnnotations = useRef(annotations);
  const cropStart = useRef<{ x: number; y: number } | undefined>(undefined);
  const playingClip = useRef(0);
  current.current = state;

  function seek(base: VideoEditorState, time: number) {
    const playhead = clamp(time, 0, getTimelineBounds(base.clips).end);
    const mapped = timelineToSourceTime(base.clips, playhead);
    const video = getVideo();
    if (video && mapped) {
      playingClip.current = mapped.clipIndex;
      if (Math.abs(video.currentTime - mapped.sourceTime) > 0.001) video.currentTime = mapped.sourceTime;
      video.playbackRate = mapped.playbackRate;
    }
    setState({ ...base, playhead });
  }

  useEffect(() => {
    if (!enabled) return;
    const video = getVideo();
    if (!video) return;
    function init() {
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        video.pause();
        setState(previous => previous || { ...createVideoEditorState(video.duration, annotations), playhead: video.currentTime });
      }
    }
    function updateBounds() {
      const stage = video?.closest('.viewer-stage');
      if (!video || !stage || !video.videoWidth || !video.videoHeight) return;
      const box = video.getBoundingClientRect();
      const parent = stage.getBoundingClientRect();
      const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
      const width = video.videoWidth * scale, height = video.videoHeight * scale;
      setBounds({ left: box.left - parent.left + (box.width - width) / 2, top: box.top - parent.top + (box.height - height) / 2, width, height });
    }
    const play = () => setPlaying(true);
    const pause = () => setPlaying(false);
    const ready = () => { init(); updateBounds(); };
    const resize = new ResizeObserver(updateBounds);
    resize.observe(video);
    ready();
    if (current.current) seek(current.current, current.current.playhead);
    setPlaying(!video.paused);
    video.addEventListener('loadedmetadata', ready);
    video.addEventListener('play', play);
    video.addEventListener('pause', pause);
    video.addEventListener('ended', pause);
    return () => {
      resize.disconnect();
      video.removeEventListener('loadedmetadata', ready);
      video.removeEventListener('play', play);
      video.removeEventListener('pause', pause);
      video.removeEventListener('ended', pause);
      video.pause();
      video.playbackRate = 1;
    };
  }, [enabled]);

  // Drive the playhead from animation frames while playing so it moves smoothly.
  useEffect(() => {
    if (!enabled || !playing) return;
    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const base = current.current;
      const video = getVideo();
      if (!base || !video || video.paused || video.seeking) return;
      const clip = base.clips[playingClip.current];
      if (!clip) return;
      if (video.currentTime >= clip.end - 0.015) {
        const next = base.clips[playingClip.current + 1];
        if (next) seek(base, next.at);
        else {
          video.pause();
          seek(base, clipTimelineEnd(clip));
        }
      } else {
        const playhead = clip.at + Math.max(0, video.currentTime - clip.start) / clipSpeed(clip);
        setState(previous => previous && { ...previous, playhead });
      }
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [enabled, playing]);

  useLayoutEffect(() => {
    const node = body.current;
    if (!node) return;
    const update = () => setBodyWidth(node.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, !state]);

  useEffect(() => {
    const before = previousAnnotations.current;
    previousAnnotations.current = annotations;
    if (before === annotations) return;
    const previous = new Map(before.map(item => [item.id, JSON.stringify(item)]));
    const next = new Map(annotations.map(item => [item.id, item]));
    setState(base => {
      if (!base) return base;
      const changed = annotations.filter(item => previous.get(item.id) !== JSON.stringify(item));
      const removed = before.some(item => !next.has(item.id));
      if (!changed.length && !removed) return base;
      const draft = base.annotations.filter(item => next.has(item.id) && !changed.some(change => change.id === item.id));
      const limits = getTimelineBounds(base.clips);
      for (const item of changed) {
        const start = sourceToTimelineTime(base.clips, item.start ?? item.time ?? 0);
        if (start === null) continue;
        const end = item.end === undefined ? limits.end : sourceToTimelineTime(base.clips, item.end) ?? limits.end;
        if (end > start) draft.push({ ...item, time: undefined, start, end });
      }
      return { ...base, annotations: draft };
    });
  }, [annotations]);

  function playPause(base: VideoEditorState) {
    const video = getVideo();
    if (!video) return;
    if (!video.paused) video.pause();
    else {
      const limits = getTimelineBounds(base.clips);
      seek(base, base.playhead >= limits.end - 0.016 ? limits.start : base.playhead);
      void video.play().catch(() => setError('Could not play the video.'));
    }
  }

  useEffect(() => {
    if (!enabled) return;
    function shortcut(event: KeyboardEvent) {
      const base = current.current;
      if (!base || busy || event.repeat || event.defaultPrevented ||
        (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable], [role=menu], .annotation-note-editor, [role=dialog]:not(.media-viewer)'))) return;
      const { ctrlKey, metaKey, altKey, shiftKey, code } = event;
      const mod = ctrlKey || metaKey;
      if (!mod && !altKey && code === 'Space' && !(event.target instanceof HTMLElement && event.target.closest('button'))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        playPause(base);
        return;
      }
      let next: VideoEditorState | undefined;
      if (mod && altKey && code === 'KeyB') next = splitClipAtTime(base);
      else if (mod && !altKey && code === 'KeyZ' && (shiftKey ? base.future.length : base.history.length)) next = shiftKey ? redoVideoEdit(base) : undoVideoEdit(base);
      else if (!mod && !altKey && code === 'KeyQ') next = trimClipStartToTime(base);
      else if (!mod && !altKey && code === 'KeyW') next = trimClipEndToTime(base);
      else if (!mod && !altKey && code === 'Delete') next = deleteClipAtIndex(base);
      else if (!mod && !altKey && (code === 'Comma' || code === 'Period')) {
        next = { ...base, playhead: base.playhead + (code === 'Comma' ? -1 : 1) * (shiftKey ? 10 : 1) * VIDEO_FRAME_STEP };
      } else if (!mod && !altKey && (code === 'Home' || code === 'End')) {
        const limits = getTimelineBounds(base.clips);
        next = { ...base, playhead: code === 'Home' ? limits.start : limits.end };
      } else if (mod && altKey && (code === 'ArrowLeft' || code === 'ArrowRight')) {
        const limits = getTimelineBounds(base.clips);
        next = { ...base, playhead: code === 'ArrowLeft' ? limits.start : limits.end };
      }
      if (!next) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      getVideo()?.pause();
      seek(next, next.playhead);
    }
    window.addEventListener('keydown', shortcut, true);
    return () => window.removeEventListener('keydown', shortcut, true);
  }, [busy, enabled]);

  if (!enabled) return null;
  if (!state) return <div className="desktop-timeline" role="status">Reading video duration…</div>;

  const limits = getTimelineBounds(state.clips);
  const liveExtent = Math.max(0.01, state.duration, limits.end);
  const extent = frozenExtent ?? liveExtent;
  const percent = (time: number) => `${clamp(time / extent, 0, 1) * 100}%`;
  const stage = getVideo()?.closest('.viewer-stage');
  const crop = cropDraft || state.crop;
  const selected = state.clips[state.selectedIndex];
  const selectedSpeed = selected ? clipSpeed(selected) : 1;
  const speedOptions = [...VIDEO_SPEED_PRESETS as readonly number[]];
  if (!speedOptions.some(value => Math.abs(value - selectedSpeed) < 1e-4)) speedOptions.push(selectedSpeed);
  speedOptions.sort((a, b) => a - b);

  const lanes = annotationsVisible
    ? state.annotations.flatMap(item => {
      const range = annotationRange(item, limits.end);
      const index = annotations.findIndex(source => source.id === item.id);
      return range ? [{ item, range, number: index >= 0 ? index + 1 : 0 }] : [];
    })
    : [];

  function cropPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
  }

  /** Snap targets: clip seams/edges, annotation edges, 0 and the end; optionally the playhead. Excludes the item being dragged. */
  function snapPoints(opts: { clip?: number; annotation?: string; playhead?: boolean } = {}) {
    const base = current.current || state!;
    const bounds = getTimelineBounds(base.clips);
    const points = [0, bounds.end, base.duration];
    base.clips.forEach((clip, index) => { if (index !== opts.clip) points.push(clip.at, clipTimelineEnd(clip)); });
    for (const item of base.annotations) {
      if (item.id === opts.annotation) continue;
      const range = annotationRange(item, bounds.end);
      if (range) points.push(range.start, range.end);
    }
    if (opts.playhead) points.push(base.playhead);
    return points;
  }

  function beginScrub(event: ReactPointerEvent) {
    if (event.button !== 0 || busy || !body.current) return;
    event.preventDefault();
    event.stopPropagation();
    getVideo()?.pause();
    const node = body.current;
    const range = getTimelineBounds(current.current?.clips || state!.clips);
    const width = extent;
    const at = (clientX: number) => {
      const rect = node.getBoundingClientRect();
      return clamp((clientX - rect.left) / Math.max(1, rect.width) * width, range.start, range.end);
    };
    const points = snapPoints();
    const place = (clientX: number, alt: boolean) => {
      let time = at(clientX);
      const snap = alt ? null : nearestSnap(points, [time], SNAP_PX / Math.max(1, node.getBoundingClientRect().width) * width);
      if (snap) time = clamp(snap.point, range.start, range.end);
      setSnapGuide(snap ? snap.point : null);
      if (current.current) seek(current.current, time);
    };
    setScrubbing(true);
    place(event.clientX, event.altKey);
    trackPointer(move => place(move.clientX, move.altKey), () => { setScrubbing(false); setSnapGuide(null); });
  }

  function beginClipDrag(event: ReactPointerEvent<HTMLDivElement>, index: number) {
    if (event.button !== 0 || busy || !body.current) return;
    event.preventDefault();
    event.stopPropagation();
    getVideo()?.pause();
    const side = ((event.target as HTMLElement).closest<HTMLElement>('[data-side]')?.dataset.side || 'move') as ClipSide;
    const before: VideoEditorState = { ...current.current!, selectedIndex: index };
    setState(before);
    const original = before.clips[index];
    const width = Math.max(1, body.current.getBoundingClientRect().width);
    const startExtent = extent;
    const originX = event.clientX;
    let latest: VideoEditorState | undefined;
    let changed = false;
    setFrozenExtent(startExtent);
    trackPointer(move => {
      const dx = move.clientX - originX;
      if (!changed && Math.abs(dx) < 3) return;
      changed = true;
      let next: VideoEditorState;
      if (side === 'speed-left' || side === 'speed-right') {
        const originalSpeed = clipSpeed(original);
        const sourceLength = Math.max(VIDEO_FRAME_STEP, original.end - original.start);
        const originalWidth = sourceLength / originalSpeed;
        const delta = (side === 'speed-left' ? -1 : 1) * dx / width * startExtent;
        const targetWidth = clamp(originalWidth + delta, Math.max(VIDEO_FRAME_STEP, sourceLength / 4), sourceLength / 0.25);
        const step = move.shiftKey ? 0.25 : 0.05;
        let speed = Math.round(sourceLength / targetWidth / step) * step;
        if (!move.shiftKey && Math.abs(speed - 1) < 0.035) speed = 1;
        speed = Number(clamp(speed, 0.25, 4).toFixed(2));
        try { next = setClipSpeed(before, index, speed); } catch { return; }
        const video = getVideo();
        if (video) video.playbackRate = speed;
        setRetiming({ index, speed });
      } else {
        let delta = dx / width * startExtent;
        if (!move.altKey) {
          const edges = side === 'left' ? [original.at] : side === 'right' ? [clipTimelineEnd(original)] : [original.at, clipTimelineEnd(original)];
          const snap = nearestSnap(snapPoints({ clip: index, playhead: true }), edges.map(edge => edge + delta), SNAP_PX / width * startExtent);
          if (snap) delta += snap.shift;
          setSnapGuide(snap ? snap.point : null);
        } else setSnapGuide(null);
        // The service caps the right edge/moves at `duration`; the extension caps them at the source length instead.
        const room = side === 'right' ? before.duration + before.sourceDuration * 4 : Math.max(before.sourceDuration, before.duration);
        next = moveOrTrimClipHandle({ ...pushEditorHistory(before), duration: room }, index, side, delta, original);
        next = { ...next, duration: computeTimelineDuration(next.clips, next.sourceDuration) };
      }
      latest = next;
      setState(next);
    }, cancelled => {
      setFrozenExtent(null);
      setSnapGuide(null);
      setRetiming(null);
      if (cancelled || !changed || !latest) {
        seek(before, before.playhead);
        return;
      }
      if (side === 'left') {
        const normalized = normalizeTimelineStart(latest);
        seek(normalized, normalized.clips[index].at);
      } else seek(latest, latest.playhead);
    });
  }

  function commitAnnotation(range: AnnotationRange) {
    setState(base => base && {
      ...pushEditorHistory(base),
      annotations: base.annotations.map(item => item.id === range.id ? { ...item, start: range.start, end: range.end, time: undefined } : item),
    });
    const clips = current.current?.clips || [];
    const start = toSourceTime(clips, range.start), end = toSourceTime(clips, range.end);
    if (start !== null && end !== null) onAnnotationRange?.(range.id, start, end);
  }

  function beginAnnotationDrag(event: ReactPointerEvent<HTMLDivElement>, id: string, start: number, end: number) {
    if (event.button !== 0 || busy || !body.current) return;
    event.preventDefault();
    event.stopPropagation();
    getVideo()?.pause();
    const side = (event.target as HTMLElement).closest<HTMLElement>('[data-side]')?.dataset.side || 'move';
    const range = getTimelineBounds(current.current?.clips || state!.clips);
    const width = Math.max(1, body.current.getBoundingClientRect().width);
    const startExtent = extent;
    const originX = event.clientX;
    const minimum = Math.min(0.1, range.end);
    let draft: AnnotationRange | undefined;
    setFrozenExtent(startExtent);
    trackPointer(move => {
      if (!draft && Math.abs(move.clientX - originX) < 2) return;
      let delta = (move.clientX - originX) / width * startExtent;
      if (!move.altKey) {
        const edges = side === 'left' ? [start] : side === 'right' ? [end] : [start, end];
        const snap = nearestSnap(snapPoints({ annotation: id, playhead: true }), edges.map(edge => edge + delta), SNAP_PX / width * startExtent);
        if (snap) delta += snap.shift;
        setSnapGuide(snap ? snap.point : null);
      } else setSnapGuide(null);
      let nextStart = start, nextEnd = end;
      if (side === 'left') nextStart = Math.max(range.start, Math.min(end - minimum, start + delta));
      else if (side === 'right') nextEnd = Math.min(range.end, Math.max(start + minimum, end + delta));
      else {
        nextStart = Math.max(range.start, Math.min(range.end - (end - start), start + delta));
        nextEnd = nextStart + end - start;
      }
      draft = { id, start: nextStart, end: nextEnd };
      setAnnotationDraft(draft);
    }, cancelled => {
      setFrozenExtent(null);
      setSnapGuide(null);
      setAnnotationDraft(null);
      if (!cancelled && draft) commitAnnotation(draft);
    });
  }

  function annotationKey(event: ReactKeyboardEvent<HTMLDivElement>, id: string, start: number, end: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const delta = (event.key === 'ArrowRight' ? 1 : -1) * 0.1;
    const length = end - start;
    if (event.shiftKey) commitAnnotation({ id, start, end: Math.max(start + Math.min(0.1, limits.end), Math.min(limits.end, end + delta)) });
    else {
      const nextStart = Math.max(limits.start, Math.min(limits.end - length, start + delta));
      commitAnnotation({ id, start: nextStart, end: nextStart + length });
    }
  }

  function ticks() {
    const target = Math.max(1, Math.floor(bodyWidth / 90));
    const step = TICK_STEPS.find(candidate => extent / candidate <= target) ?? TICK_STEPS[TICK_STEPS.length - 1];
    const marks: number[] = [];
    for (let time = 0; time < extent - step * 0.25; time += step) marks.push(Number(time.toFixed(3)));
    return marks;
  }

  const offset = clamp(state.playhead / extent, 0, 1) * bodyWidth;
  const expanded = capHover || scrubbing;
  const capShift = Math.max(0, 34 - offset) - Math.max(0, 34 - (bodyWidth - offset));
  const edit = (next: VideoEditorState) => { getVideo()?.pause(); seek(next, next.playhead); };

  return <section className="desktop-timeline" aria-label="Video timeline">
    <div className="desktop-timeline-actions">
      <Button size="icon" variant="ghost" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'} onClick={() => playPause(state)}>{playing ? <Pause size={15}/> : <Play size={15}/>}</Button>
      <span className="desktop-time">{formatTime(state.playhead)} / {formatTime(limits.end)}</span>
      <span className="desktop-actions-divider" aria-hidden="true"/>
      <Button size="icon" variant="ghost" aria-label="Split clip at playhead" title="Split clip at playhead" onClick={() => edit(splitClipAtTime(state))}><Scissors size={15}/></Button>
      <Button size="icon" variant="ghost" aria-label="Remove selected clip" title="Remove selected clip" disabled={state.clips.length < 2} onClick={() => edit(deleteClipAtIndex(state))}><Trash2 size={15}/></Button>
      <Button size="icon" variant="ghost" aria-label="Crop video" title="Crop video" aria-pressed={cropMode} onClick={() => {getVideo()?.pause(); setCropMode(!cropMode);}}><Crop size={15}/></Button>
      <label className="desktop-speed" title="Speed of the selected clip">
        <span>Speed</span>
        <select aria-label="Selected clip speed" value={selectedSpeed} disabled={busy || !selected} onChange={event => {
          try { edit(setClipSpeed(state, state.selectedIndex, Number(event.currentTarget.value))); }
          catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        }}>{speedOptions.map(value => <option key={value} value={value}>{value}×</option>)}</select>
      </label>
      <span className="desktop-actions-divider" aria-hidden="true"/>
      <Button size="icon" variant="ghost" aria-label="Undo" title="Undo" disabled={!state.history.length} onClick={() => edit(undoVideoEdit(state))}><Undo2 size={15}/></Button>
      <Button size="icon" variant="ghost" aria-label="Redo" title="Redo" disabled={!state.future.length} onClick={() => edit(redoVideoEdit(state))}><Redo2 size={15}/></Button>
      <Button size="icon" variant="ghost" aria-label="Restore the full video" title="Restore the full video" onClick={() => {getVideo()?.pause(); setCropMode(false); seek(resetVideoEditorState(state), 0);}}><RotateCcw size={15}/></Button>
      {onAnnotationsVisibleChange && <Button size="sm" variant="ghost" className="desktop-annotation-toggle" aria-pressed={annotationsVisible}
        aria-label={annotationsVisible ? 'Hide annotations' : 'Show annotations'} title={annotationsVisible ? 'Hide annotations' : 'Show annotations'}
        onClick={() => onAnnotationsVisibleChange(!annotationsVisible)}>{annotationsVisible ? <Eye size={15}/> : <EyeOff size={15}/>}<span>Notes {state.annotations.length}</span></Button>}
      <Button size="sm" className="desktop-save" disabled={busy} onClick={async () => {
        if (hasOmittedAnnotations(state.annotations, state.crop, state.clips, state.duration) &&
            !window.confirm('Some annotations fall outside the edited clip. Save the clip anyway?')) return;
        getVideo()?.pause();
        setBusy(true); setError('');
        try { await onExport(state); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
      }}>{busy ? 'Saving…' : 'Save clip'}</Button>
    </div>
    {error && <p className="desktop-error" role="alert">{error}</p>}
    <div className="desktop-timeline-scroll">
      <div className="desktop-timeline-body" ref={body}>
        <div className="desktop-ruler" onPointerDown={beginScrub}>
          {ticks().map(time => <span key={time} className="desktop-tick" style={{ left: percent(time) }}>{formatTime(time)}</span>)}
        </div>
        {lanes.length > 0 && <div className="desktop-annotation-lanes">
          {lanes.map(({ item, range, number }) => {
            const live = annotationDraft?.id === item.id ? annotationDraft : range;
            return <div className="desktop-annotation-lane" key={item.id}>
              <div className="desktop-annotation-bar" role="slider" tabIndex={0}
                aria-label={`Annotation ${number || ''}: ${item.text}. Drag to move or drag an edge to resize`}
                aria-valuemin={0} aria-valuemax={extent} aria-valuenow={Number(live.start.toFixed(2))}
                title={`${item.text} · ${live.start.toFixed(2)} – ${live.end.toFixed(2)}s`}
                style={{ left: percent(live.start), width: `${clamp((live.end - live.start) / extent, 0, 1) * 100}%` }}
                onPointerDown={event => beginAnnotationDrag(event, item.id, range.start, range.end)}
                onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); onAnnotationOpen?.(item.id); }}
                onKeyDown={event => annotationKey(event, item.id, range.start, range.end)}>
                <span className="desktop-annotation-edge left" data-side="left"/>
                <span className="desktop-annotation-label">{number ? `${number}. ` : ''}{item.text}</span>
                <span className="desktop-annotation-edge right" data-side="right"/>
              </div>
            </div>;
          })}
        </div>}
        <div className="desktop-clip-track" onPointerDown={beginScrub}>
          {state.clips.map((clip, index) => {
            const speed = clipSpeed(clip);
            const isRetiming = retiming?.index === index;
            return <div key={index} role="button" tabIndex={0} className={'desktop-clip' + (state.selectedIndex === index ? ' selected' : '') + (isRetiming ? ' retiming' : '')}
              aria-pressed={state.selectedIndex === index}
              aria-label={`Clip ${index + 1}, ${clip.start.toFixed(2)} to ${clip.end.toFixed(2)} seconds, ${speed.toFixed(2)} times speed`}
              style={{ left: percent(clip.at), width: `${clamp(clipTimelineDuration(clip) / extent, 0, 1) * 100}%` }}
              onPointerDown={event => beginClipDrag(event, index)}
              onKeyDown={event => { if (event.key === 'Enter') seek({ ...state, selectedIndex: index }, clip.at); }}>
              <span className="desktop-speed-handle left" data-side="speed-left" title="Drag inward to speed up or outward to slow down"/>
              <span className="desktop-speed-handle right" data-side="speed-right" title="Drag inward to speed up or outward to slow down"/>
              <span className="desktop-clip-edge left" data-side="left" title="Trim start"/>
              <span className="desktop-clip-label">Video {index + 1}{Math.abs(speed - 1) > 1e-4 ? ` · ${speed}×` : ''}</span>
              <span className="desktop-clip-edge right" data-side="right" title="Trim end"/>
              {isRetiming && <span className="desktop-speed-readout">{retiming.speed}× · {clipTimelineDuration(clip).toFixed(2)}s</span>}
            </div>;
          })}
        </div>
        {snapGuide !== null && <div className="desktop-snap-guide" aria-hidden="true" style={{ left: percent(snapGuide) }}/>}
        <div className="desktop-playhead" style={{ left: percent(state.playhead) }}>
          <button type="button" className={'desktop-playhead-cap' + (expanded ? ' expanded' : '')} aria-label={`Playhead ${formatTime(state.playhead)}`}
            style={{ transform: `translateX(calc(-50% + ${expanded ? capShift : 0}px))` }}
            onPointerEnter={() => setCapHover(true)} onPointerLeave={() => setCapHover(false)}
            onFocus={() => setCapHover(true)} onBlur={() => setCapHover(false)}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              event.stopPropagation();
              edit({ ...state, playhead: state.playhead + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1) * VIDEO_FRAME_STEP });
            }}
            onPointerDown={beginScrub}><span>{formatTime(state.playhead)}</span></button>
        </div>
      </div>
    </div>
    {cropMode && stage && createPortal(<div className="desktop-crop-overlay" style={bounds}
      onPointerDown={event => { if (event.button !== 0) return; cropStart.current = cropPoint(event); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => {
        const start = cropStart.current;
        if (!start) return;
        const point = cropPoint(event);
        setCropDraft({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), w: Math.abs(point.x - start.x), h: Math.abs(point.y - start.y) });
      }}
      onPointerUp={() => {
        cropStart.current = undefined;
        if (cropDraft && cropDraft.w >= .01 && cropDraft.h >= .01) setState(setCropRect(state, cropDraft));
        setCropDraft(undefined);
      }} onPointerCancel={() => {cropStart.current = undefined; setCropDraft(undefined);}}>
      <div style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}/>
    </div>, stage)}
  </section>;
}
