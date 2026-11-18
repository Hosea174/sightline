import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui/button';
import type { Annotation } from '../types';
import {
  clipTimelineDuration, clipTimelineEnd, createVideoEditorState, deleteClipAtIndex,
  getTimelineBounds, hasOmittedAnnotations, moveOrTrimClipHandle, normalizeTimelineStart,
  pushEditorHistory, redoVideoEdit, resetVideoEditorState, setClipSpeed, setCropRect,
  splitClipAtTime, sourceToTimelineTime, timelineToSourceTime, trimClipEndToTime, trimClipStartToTime, undoVideoEdit,
  type VideoEditorState, type VideoCropRect,
} from '../lib/videoEditorService';

type DragSide = 'left' | 'right' | 'move' | 'speed';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function DesktopVideoTimeline({ enabled, getVideo, annotations, onExport }: {
  enabled: boolean;
  getVideo: () => HTMLVideoElement | null;
  annotations: Annotation[];
  onExport: (state: VideoEditorState) => Promise<void>;
}) {
  const [state, setState] = useState<VideoEditorState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cropMode, setCropMode] = useState(false);
  const [cropDraft, setCropDraft] = useState<VideoCropRect>();
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const track = useRef<HTMLDivElement>(null);
  const current = useRef(state);
  const previousAnnotations = useRef(annotations);
  current.current = state;
  const drag = useRef<{ state: VideoEditorState; index: number; side: DragSide; x: number; next?: VideoEditorState } | undefined>(undefined);
  const cropStart = useRef<{ x: number; y: number } | undefined>(undefined);
  const playingClip = useRef(0);
  const [playing, setPlaying] = useState(false);

  function seek(base: VideoEditorState, time: number) {
    const playhead = clamp(time, 0, getTimelineBounds(base.clips).end);
    const mapped = timelineToSourceTime(base.clips, playhead);
    const video = getVideo();
    if (video && mapped) {
      playingClip.current = mapped.clipIndex;
      video.currentTime = mapped.sourceTime;
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
      setBounds({left: box.left - parent.left + (box.width - width) / 2, top: box.top - parent.top + (box.height - height) / 2, width, height});
    }
    function updateTime() {
      const base = current.current;
      if (!base || !video || video.paused || video.seeking) return;
      const clip = base.clips[playingClip.current];
      if (!clip) return;
      if (video.currentTime >= clip.end - .015) {
        const next = base.clips[playingClip.current + 1];
        if (next) seek(base, next.at);
        else {
          video.pause();
          seek(base, clipTimelineEnd(clip));
        }
      } else {
        const playhead = clip.at + Math.max(0, video.currentTime - clip.start) / clip.speed;
        setState(previous => previous && { ...previous, playhead });
      }
    }
    const play = () => setPlaying(true);
    const pause = () => setPlaying(false);
    const ready = () => { init(); updateBounds(); };
    const resize = new ResizeObserver(updateBounds);
    resize.observe(video);
    ready();
    if (current.current) seek(current.current, current.current.playhead);
    video.addEventListener('loadedmetadata', ready);
    video.addEventListener('timeupdate', updateTime);
    video.addEventListener('play', play);
    video.addEventListener('pause', pause);
    video.addEventListener('ended', pause);
    return () => {
      resize.disconnect();
      video.removeEventListener('loadedmetadata', ready);
      video.removeEventListener('timeupdate', updateTime);
      video.removeEventListener('play', play);
      video.removeEventListener('pause', pause);
      video.removeEventListener('ended', pause);
      video.pause();
      video.playbackRate = 1;
    };
  }, [enabled]);

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
      const bounds = getTimelineBounds(base.clips);
      for (const item of changed) {
        const start = sourceToTimelineTime(base.clips, item.start ?? item.time ?? 0);
        if (start === null) continue;
        const end = item.end === undefined ? bounds.end : sourceToTimelineTime(base.clips, item.end) ?? bounds.end;
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
      seek(base, base.playhead >= limits.end - .016 ? limits.start : base.playhead);
      void video.play().catch(() => setError('Could not play the video.'));
    }
  }

  useEffect(() => {
    if (!enabled) return;
    function shortcut(event: KeyboardEvent) {
      const base = current.current;
      if (!base || busy || event.repeat || event.defaultPrevented ||
        (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable], [role=menu], .annotation-note-editor, [role=dialog]:not(.media-viewer)'))) return;
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
        next = { ...base, playhead: base.playhead + (code === 'Comma' ? -1 : 1) * (shiftKey ? 10 : 1) / 60 };
      } else if (!mod && !altKey && (code === 'Home' || code === 'End')) {
        const bounds = getTimelineBounds(base.clips);
        next = { ...base, playhead: code === 'Home' ? bounds.start : bounds.end };
      } else if (mod && altKey && (code === 'ArrowLeft' || code === 'ArrowRight')) {
        const bounds = getTimelineBounds(base.clips);
        next = { ...base, playhead: code === 'ArrowLeft' ? bounds.start : bounds.end };
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
  const extent = Math.max(.01, getTimelineBounds(state.clips).end);
  const stage = getVideo()?.closest('.viewer-stage');
  const crop = cropDraft || state.crop;
  function cropPoint(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
  }

  return <section className="desktop-timeline" aria-label="Video timeline">
    <div className="desktop-timeline-actions">
      <Button size="sm" variant="outline" onClick={() => playPause(state)}>{playing ? 'Pause' : 'Play'}</Button>
      <Button size="sm" variant="ghost" onClick={() => {getVideo()?.pause(); const next = splitClipAtTime(state); seek(next, next.playhead);}}>Split</Button>
      <Button size="sm" variant="ghost" disabled={state.clips.length < 2} onClick={() => {getVideo()?.pause(); const next = deleteClipAtIndex(state); seek(next, next.playhead);}}>Remove clip</Button>
      <Button size="sm" variant="ghost" aria-pressed={cropMode} onClick={() => {getVideo()?.pause(); setCropMode(!cropMode);}}>Crop</Button>
      <Button size="sm" variant="ghost" onClick={() => {getVideo()?.pause(); setCropMode(false); seek(resetVideoEditorState(state), 0);}}>Restore timeline</Button>
      <span className="desktop-time">{state.playhead.toFixed(2)} / {extent.toFixed(2)} s</span>
      <Button size="sm" disabled={busy} onClick={async () => {
        if (hasOmittedAnnotations(state.annotations, state.crop, state.clips, state.duration) &&
            !window.confirm('Some annotations fall outside the edited clip. Save the clip anyway?')) return;
        getVideo()?.pause();
        setBusy(true); setError('');
        try { await onExport(state); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
      }}>{busy ? 'Saving…' : 'Save clip'}</Button>
    </div>
    {error && <p role="alert">{error}</p>}
    <input type="range" aria-label="Video playhead" min={0} max={extent} step={.001} value={Math.min(state.playhead, extent)}
      onChange={event => {getVideo()?.pause(); seek(state, Number(event.currentTarget.value));}}/>
    <div ref={track} className="desktop-clip-track" onPointerMove={event => {
      const active = drag.current;
      if (!active || !track.current) return;
      const delta = event.clientX - active.x;
      if (!active.next && Math.abs(delta) < 3) return;
      const original = active.state.clips[active.index];
      const seconds = delta * getTimelineBounds(active.state.clips).end / track.current.clientWidth;
      active.next = active.side === 'speed'
        ? setClipSpeed(active.state, active.index, clamp(original.speed * Math.exp(-delta / 180), .25, 4))
        : normalizeTimelineStart(moveOrTrimClipHandle(pushEditorHistory(active.state), active.index, active.side, seconds));
      setState(active.next);
    }} onPointerUp={() => {
      const active = drag.current;
      drag.current = undefined;
      if (active?.next) seek(active.next, active.next.playhead);
    }} onPointerCancel={() => {
      if (drag.current) setState(drag.current.state);
      drag.current = undefined;
    }}>
      {state.clips.map((clip, index) => <button key={index} type="button" aria-pressed={state.selectedIndex === index}
        aria-label={`Clip ${index + 1}, ${clip.speed.toFixed(2)} times speed`}
        style={{ left: `${clip.at / extent * 100}%`, width: `${clipTimelineDuration(clip) / extent * 100}%` }}
        onClick={event => {if (!event.detail) seek({...state, selectedIndex: index}, clip.at);}}
        onPointerDown={event => {
          if (event.button !== 0 || busy) return;
          getVideo()?.pause();
          const side = (event.target as HTMLElement).dataset.side as DragSide | undefined;
          const selected = { ...state, selectedIndex: index };
          setState(selected);
          drag.current = { state: selected, index, side: side || 'move', x: event.clientX };
          track.current?.setPointerCapture(event.pointerId);
        }}>
        <span className="desktop-clip-speed" data-side="speed" title="Drag to change speed"/>
        <span className="desktop-clip-edge left" data-side="left"/><span className="desktop-clip-edge right" data-side="right"/>
        <span>Video {index + 1} · {clip.speed.toFixed(2)}×</span>
      </button>)}
    </div>
    {state.annotations.map(item => {
      const start = clamp(item.start ?? item.time ?? 0, 0, extent);
      const end = clamp(item.end ?? extent, start, extent);
      return end > start && <div className="desktop-annotation-lane" key={item.id}>
        <span title={item.text} style={{ left: `${start / extent * 100}%`, width: `${(end - start) / extent * 100}%` }}>{item.text}</span>
      </div>;
    })}
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
