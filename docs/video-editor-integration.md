# Desktop Video Editor Integration Guide

This document describes the Rust/Tauri backend ([`video_editor.rs`](../src-tauri/src/video_editor.rs)) and reusable frontend service ([`videoEditorService.ts`](../src/lib/videoEditorService.ts)) built for full parity with the Sightline browser extension editor ([`review.js`](../extension/review.js), [`crop-editor.js`](../extension/crop-editor.js), [`annotations.js`](../extension/annotations.js), [`sightline-bridge.rs`](../src-tauri/src/bin/sightline-bridge.rs)).

---

## 1. Coordinate & Timeline Formats (Extension Parity)

### Crop Rectangle (`VideoCropRect`)
```ts
export type VideoCropRect = {
  x: number; // [0, 1], left edge relative to displayed video width
  y: number; // [0, 1], top edge relative to displayed video height
  w: number; // (0, 1], width fraction; x + w <= 1
  h: number; // (0, 1], height fraction; y + h <= 1
};
```
- Origin is **top-left `(0, 0)`**, relative to the displayed video frame (after rotation metadata is applied).
- Full-frame sentinel `{ x: 0, y: 0, w: 1, h: 1 }` (within `1e-6`) is treated as no crop and normalized to `null` before FFmpeg export.
- Interactive drag/keyboard resize uses `adjustCropRect(original, handle, dx, dy)` with `MIN_CROP_SIZE = 0.01`.
- Backend applies the exact same FFmpeg crop expression as `sightline-bridge.rs` (rounding to even pixel dimensions, minimum `2×2`, then `pad=ceil(iw/2)*2:ceil(ih/2)*2` for `yuv420p` compatibility).

### Clip Segments (`VideoClipSegment`)
```ts
export type VideoClipSegment = {
  start: number; // Source timestamp in seconds (0 <= start < end <= sourceDuration)
  end: number;   // Source timestamp in seconds
  at: number;    // Timeline position in seconds (>= 0)
  speed: number; // Speed multiplier (default 1; backend range [0.1, 16]; UI presets VIDEO_SPEED_PRESETS)
};
```
- Output width on timeline for a clip is `(clip.end - clip.start) / clip.speed`.
- On export, segments are sorted ascending by `at` and concatenated contiguously (removing any timeline gaps).
- Speed presets matching the extension UI: `VIDEO_SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]`.
- Audio pitch/tempo is preserved using chained FFmpeg `atempo` filters (each stage within `[0.5, 2.0]`). Video streams without an audio track (`hasAudio === false`) automatically use `-an`.

### Annotations (`Annotation`)
- Spatial `x, y, w, h` are normalized `[0, 1]` (`w = 0, h = 0` for pins; `w > 0, h > 0` for area boxes).
- Video annotation `start` and `end` are **timeline seconds** (not raw source seconds).
- Use `shiftAnnotationTiming` (already called automatically by `setClipSpeed`, `trimClipStartToTime`, and `deleteClipAtIndex` / `normalizeTimelineStart`) when editing clips.
- Before exporting, call `hasOmittedAnnotations(state.annotations, state.crop, state.clips, state.duration)` to prompt confirmation if any annotations fall outside the crop or trimmed clips (matching `extension/review.js`).
- On export, `remapAnnotationsForExport` clips & renormalizes spatial coordinates into the cropped viewport and remaps timestamps into the concatenated output timeline (splitting annotations that span multiple kept clips into `id`, `id-1`, etc., and dropping legacy `time`).

---

## 2. Tauri Backend Commands

Registered in `src-tauri/src/main.rs`:

### `probe_video_asset`
Inspects an active or trashed video file in the library via FFprobe (with rotation-aware display dimensions).

- **Invoke args**: `{ file: string, trashed?: boolean }`
- **Returns (`VideoProbeInfo`)**:
  ```ts
  { width: number; height: number; duration: number; hasAudio: boolean }
  ```
- **Errors**: missing library path, unsafe/traversal `file` path, file not found, missing FFprobe binary, no valid video stream, unreadable duration.

### `export_edited_video`
Renders trimmed/split/retimed/cropped segments to a **new** MP4 (`H.264 / AAC, yuv420p, +faststart`) under `<library>/assets/<folder>/<uuid>.mp4`, generates `<library>/thumbnails/<uuid>.jpg`, and leaves the original file untouched.

- **Invoke args**:
  ```ts
  {
    request: {
      sourceFile: string;
      segments: Array<{ start: number; end: number; speed: number }>;
      crop: VideoCropRect | null;
      folder?: string;          // defaults to sourceFile's folder prefix
      includeAudio?: boolean;   // defaults to true when source has audio
      generatePreview?: boolean;// defaults to false (main.tsx lazy-backfills .v2.mp4 previews)
    }
  }
  ```
- **Returns (`VideoExportResult`)**:
  ```ts
  {
    id: string;
    file: string;
    thumbnail: string | null;
    previewVideo: string | null;
    duration: number;
    width: number;
    height: number;
    hasAudio: boolean;
  }
  ```
- **Note**: Like `import_asset` and `import_capture`, `export_edited_video` does **not** write `library.json` on the Rust side so it never races with `src/main.tsx`'s `writeQueue`. Persist the returned `Asset` through `saveSources` / `save`.

---

## 3. Frontend Integration (`src/lib/videoEditorService.ts`)

### Step 1: Open & Initialize Editor State
```ts
import {
  probeVideoAsset,
  createVideoEditorState,
} from './lib/videoEditorService';

// Fallback to videoElement.duration if browser playback metadata is already loaded
const probe = await probeVideoAsset(asset.file);
let editorState = createVideoEditorState(probe.duration, asset.annotations ?? []);
```

### Step 2: Synchronize `<video>` Playback with Timeline State
- **Seeking / Scrubbing**:
  ```ts
  const mapping = timelineToSourceTime(editorState.clips, targetTimelineTime);
  if (mapping) {
    video.currentTime = mapping.sourceTime;
    video.playbackRate = mapping.playbackRate;
  }
  ```
- **During Playback (`requestAnimationFrame` / `timeupdate`)**:
  For the active `playingClip`, compute:
  `playhead = clip.at + (video.currentTime - clip.start) / clipSpeed(clip)`.
  When `video.currentTime >= clip.end - 0.015 * clipSpeed(clip)`, jump to the next clip sorted by `at` ascending (setting `video.currentTime = next.start` and `video.playbackRate = clipSpeed(next)`), or pause at `clipTimelineEnd(clip)` if none remains.

### Step 3: Edit Actions & Keyboard Shortcuts Parity
All editing actions are pure, immutable state transitions with up to 50-step Undo/Redo:

| Action / Shortcut | Service Call |
|---|---|
| Split (`Ctrl+Alt+B` / button) | `splitClipAtTime(state, playhead, selectedIndex)` |
| Delete clip (`Delete` / `Backspace`) | `deleteClipAtIndex(state, selectedIndex)` (disabled when `!canDeleteClip(state)`) |
| Trim start to playhead (`Q`) | `trimClipStartToTime(state, playhead, selectedIndex)` |
| Trim end to playhead (`W`) | `trimClipEndToTime(state, playhead, selectedIndex)` |
| Timeline drag (`left` / `right` / `move`) | `snapshotEditorState(state)` on `pointerdown`, `moveOrTrimClipHandle(state, index, side, delta, originalClip)` on `pointermove`, `pushEditorHistory(..., before)` + `normalizeTimelineStart` on `pointerup` |
| Speed change | `setClipSpeed(state, selectedIndex, nextSpeed)` |
| Crop change / drag | `adjustCropRect` during drag, `setCropRect(state, rect, true)` on commit |
| Reset crop | `resetCropRect(state)` |
| Undo / Redo (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y`) | `undoVideoEdit(state)` / `redoVideoEdit(state)` |
| Reset all edits | `resetVideoEditorState(state)` |

### Step 4: Export & Save as a New Asset
```ts
import {
  exportEditedVideoAsset,
  hasOmittedAnnotations,
} from './lib/videoEditorService';

if (
  hasOmittedAnnotations(
    editorState.annotations,
    editorState.crop,
    editorState.clips,
    editorState.duration
  )
) {
  const confirmed = await askUserToConfirmOmittedAnnotations();
  if (!confirmed) return;
}

const outcome = await exportEditedVideoAsset({
  state: editorState,
  source,
  originalAsset: asset,
  sources: sourcesRef.current,
  name: customName, // optional; defaults to `${asset.name} (edited)`
  saveSources: async (nextSources) => {
    setSources(nextSources);
    return await save(nextSources); // main.tsx queued save_library wrapper
  },
});

// `outcome.asset` is the newly created video Asset inserted right after `originalAsset`.
// `originalAsset` and its file remain completely untouched.
```

### Error Handling
- `probeVideoAsset` and `exportEditedVideoAsset` throw descriptive `Error` messages when:
  - running outside the Tauri desktop shell (unless `invokeFn` is injected for tests),
  - `originalAsset.kind !== 'video'` or `originalAsset.trashedAt` is set,
  - clip bounds/counts (`1..100`), speeds (`0.1..16`), or crop rects (`[0, 1]`, positive size) are invalid,
  - FFprobe/FFmpeg fails (temp files are cleaned up automatically by the backend, and `saveSources` is not called),
  - FFmpeg succeeds but `saveSources` returns `false` or rejects (error message includes the rendered relative file path `exportResult.file`).
