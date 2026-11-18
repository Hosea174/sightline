import { describe, expect, test } from 'bun:test';
import {
  MAX_EDITOR_HISTORY,
  MAX_VIDEO_SEGMENTS,
  adjustCropRect,
  buildEditedVideoName,
  canDeleteClip,
  canSplitClipAtTime,
  computeTimelineDuration,
  createVideoEditorState,
  deleteClipAtIndex,
  exportEditedVideoAsset,
  hasOmittedAnnotations,
  insertExportedAssetIntoSources,
  isFullCrop,
  locateClipAtTime,
  moveOrTrimClipHandle,
  prepareVideoExportPayload,
  probeVideoAsset,
  redoVideoEdit,
  remapAnnotationsForExport,
  resetCropRect,
  resetVideoEditorState,
  setClipSpeed,
  setCropRect,
  sourceToTimelineTime,
  splitClipAtTime,
  timelineToSourceTime,
  trimClipEndToTime,
  trimClipStartToTime,
  undoVideoEdit,
  validateCropRect,
  type VideoExportResult,
} from './src/lib/videoEditorService';
import type { Annotation, Asset, Source } from './src/types';

function makeFixture(): { source: Source; originalAsset: Asset; sources: Source[] } {
  const originalAsset: Asset = {
    id: 'asset-orig',
    name: 'Hero Scroll',
    file: 'Studio/hero-scroll.mp4',
    kind: 'video',
    thumbnail: 'asset-orig.jpg',
    previewVideo: 'asset-orig.v2.mp4',
    sourceUrl: 'https://example.com/demo',
    tags: ['motion', 'hero'],
    notes: 'Original recording',
    annotations: [
      { id: 'ann-1', x: 0.5, y: 0.5, w: 0, h: 0, text: 'Center pin', start: 2, end: 8 },
    ],
  };
  const source: Source = {
    id: 'src-1',
    title: 'Studio Demo',
    url: 'https://example.com',
    category: 'Motion graphics',
    tags: ['motion'],
    notes: '',
    folder: 'Studio',
    assets: [
      originalAsset,
      {
        id: 'asset-other',
        name: 'Still Frame',
        file: 'Studio/still.png',
        kind: 'image',
      },
    ],
    x: 0,
    y: 0,
    created: '2026-01-01T00:00:00.000Z',
  };
  return { source, originalAsset, sources: [source] };
}

describe('videoEditorService timeline editing parity', () => {
  test('creates valid initial editor state and rejects invalid durations', () => {
    expect(() => createVideoEditorState(0)).toThrow();
    expect(() => createVideoEditorState(-5)).toThrow();
    expect(() => createVideoEditorState(Number.NaN)).toThrow();

    const state = createVideoEditorState(10);
    expect(state.sourceDuration).toBe(10);
    expect(state.duration).toBe(10);
    expect(state.clips).toEqual([{ start: 0, end: 10, at: 0, speed: 1 }]);
    expect(isFullCrop(state.crop)).toBe(true);
    expect(canDeleteClip(state)).toBe(false);
  });

  test('splits clips, trims with Q/W at non-1x speed, deletes clips, and normalizes timeline start', () => {
    const anns: Annotation[] = [
      { id: 'a1', x: 0.5, y: 0.5, w: 0, h: 0, text: 'Later callout', start: 6, end: 8 },
    ];
    let state = createVideoEditorState(10, anns);
    state = setClipSpeed(state, 0, 2); // timeline duration now 5s (source 0..10 at 2x)
    expect(state.duration).toBeCloseTo(5, 5);

    expect(canSplitClipAtTime(state, 0)).toBe(false);
    expect(canSplitClipAtTime(state, 2)).toBe(true);

    // Split at timeline 2s -> source 4s
    state = splitClipAtTime(state, 2);
    expect(state.clips).toEqual([
      { start: 0, end: 4, at: 0, speed: 2 },
      { start: 4, end: 10, at: 2, speed: 2 },
    ]);
    expect(state.selectedIndex).toBe(1);
    expect(canDeleteClip(state)).toBe(true);

    // Delete first clip -> remaining clip starts at timeline 0 (normalized from 2s)
    state = deleteClipAtIndex(state, 0);
    expect(state.clips).toEqual([{ start: 4, end: 10, at: 0, speed: 2 }]);
    expect(canDeleteClip(state)).toBe(false);
    // Deleting last clip is a safe no-op
    expect(deleteClipAtIndex(state, 0)).toEqual(state);

    // Split remaining 3s clip at timeline 1.5s -> source 7s
    state = splitClipAtTime(state, 1.5);
    // Trim start of clip 1 from timeline 1.5 to timeline 2.0 (Q shortcut)
    state = trimClipStartToTime(state, 2.0, 1);
    expect(state.clips[1]).toEqual({ start: 8, end: 10, at: 2, speed: 2 });
    expect(state.playhead).toBeCloseTo(2.0, 5);

    // Trim end of clip 1 to timeline 2.5 (W shortcut) -> source end 9s
    state = trimClipEndToTime(state, 2.5, 1);
    expect(state.clips[1]).toEqual({ start: 8, end: 9, at: 2, speed: 2 });
    expect(state.playhead).toBeCloseTo(2.5, 5);

    // Timeline/source conversions
    expect(locateClipAtTime(state.clips, 2.25)).toBe(1);
    expect(timelineToSourceTime(state.clips, 2.25)).toEqual({
      clipIndex: 1,
      sourceTime: 8.5,
      playbackRate: 2,
    });
    expect(sourceToTimelineTime(state.clips, 8.5)).toBeCloseTo(2.25, 5);
  });

  test('trims start of first clip normalizes timeline back to 0 and shifts annotations', () => {
    const anns: Annotation[] = [
      { id: 'a1', x: 0.4, y: 0.4, w: 0, h: 0, text: 'Pin', start: 4, end: 7 },
    ];
    let state = createVideoEditorState(10, anns);
    state = trimClipStartToTime(state, 2, 0);
    expect(state.clips[0]).toEqual({ start: 2, end: 10, at: 0, speed: 1 });
    expect(state.annotations[0].start).toBeCloseTo(2, 5);
    expect(state.annotations[0].end).toBeCloseTo(5, 5);
  });

  test('speed change shifts subsequent clips, scales overlapping annotations, and rejects bad speeds', () => {
    const anns: Annotation[] = [
      { id: 'inside', x: 0.5, y: 0.5, w: 0, h: 0, text: 'Inside clip 1', start: 1, end: 3 },
      { id: 'after', x: 0.5, y: 0.5, w: 0, h: 0, text: 'In clip 2', start: 6, end: 8 },
    ];
    let state = createVideoEditorState(10, anns);
    state = splitClipAtTime(state, 4);
    state = { ...state, playhead: 2 };

    // Slow clip 0 to 0.5x -> width grows from 4s to 8s (+4s delta)
    state = setClipSpeed(state, 0, 0.5);
    expect(state.clips[0]).toEqual({ start: 0, end: 4, at: 0, speed: 0.5 });
    expect(state.clips[1]).toEqual({ start: 4, end: 10, at: 8, speed: 1 });
    expect(state.duration).toBeCloseTo(14, 5);
    // Playhead tracked same source position (source 2s -> timeline 4s at 0.5x)
    expect(state.playhead).toBeCloseTo(4, 5);
    expect(state.annotations[0].start).toBeCloseTo(2, 5);
    expect(state.annotations[0].end).toBeCloseTo(6, 5);
    expect(state.annotations[1].start).toBeCloseTo(10, 5);
    expect(state.annotations[1].end).toBeCloseTo(12, 5);

    expect(() => setClipSpeed(state, 0, 0)).toThrow();
    expect(() => setClipSpeed(state, 0, 0.05)).toThrow();
    expect(() => setClipSpeed(state, 0, 20)).toThrow();
    expect(() => setClipSpeed(state, 99, 1)).toThrow();
  });

  test('moveOrTrimClipHandle clamps against neighboring clips and source bounds', () => {
    let state = createVideoEditorState(10);
    state = splitClipAtTime(state, 5);
    // Attempt to move clip 1 left past clip 0 end (5s)
    const moved = moveOrTrimClipHandle(state, 1, 'move', -3);
    expect(moved.clips[1].at).toBe(5);
    // Attempt to trim clip 0 right edge past clip 1 start
    const trimmedRight = moveOrTrimClipHandle(state, 0, 'right', 3);
    expect(trimmedRight.clips[0].end).toBe(5);
    // Attempt to trim clip 0 left edge before 0
    const trimmedLeft = moveOrTrimClipHandle(state, 0, 'left', -2);
    expect(trimmedLeft.clips[0].at).toBe(0);
    expect(trimmedLeft.clips[0].start).toBe(0);
    expect(computeTimelineDuration(state.clips, 10)).toBe(10);
  });

  test('undo, redo, reset, and 50-step history cap', () => {
    let state = createVideoEditorState(120);
    for (let i = 1; i <= 60; i++) {
      state = setCropRect(state, { x: 0.001 * i, y: 0, w: 0.5, h: 0.5 });
    }
    expect(state.history.length).toBe(MAX_EDITOR_HISTORY);
    const afterUndo = undoVideoEdit(state);
    expect(afterUndo.future.length).toBe(1);
    const afterRedo = redoVideoEdit(afterUndo);
    expect(afterRedo.crop).toEqual(state.crop);

    // New edit clears redo future
    const branched = resetCropRect(afterUndo);
    expect(branched.future.length).toBe(0);
    expect(isFullCrop(branched.crop)).toBe(true);

    const reset = resetVideoEditorState(branched);
    expect(reset.clips).toEqual([{ start: 0, end: 120, at: 0, speed: 1 }]);
    expect(reset.annotations).toEqual([]);
    expect(isFullCrop(reset.crop)).toBe(true);
  });
});

describe('crop & annotation parity', () => {
  test('validates crop rectangles and adjusts handles with MIN_CROP_SIZE clamping', () => {
    expect(validateCropRect(null)).toBeNull();
    expect(validateCropRect({ x: 0, y: 0, w: 1, h: 1 })).toBeNull();
    expect(validateCropRect({ x: 0.25, y: 0.2, w: 0.5, h: 0.6 })).toEqual({
      x: 0.25,
      y: 0.2,
      w: 0.5,
      h: 0.6,
    });

    expect(() => validateCropRect({ x: -0.1, y: 0, w: 0.5, h: 0.5 })).toThrow();
    expect(() => validateCropRect({ x: 0.6, y: 0, w: 0.5, h: 0.5 })).toThrow();
    expect(() => validateCropRect({ x: 0.1, y: 0.1, w: 0, h: 0.5 })).toThrow();
    expect(() => validateCropRect({ x: Number.NaN, y: 0, w: 0.5, h: 0.5 })).toThrow();

    const moved = adjustCropRect({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 'move', 0.9, -0.5);
    expect(moved.x).toBeCloseTo(0.6, 5);
    expect(moved.y).toBeCloseTo(0, 5);

    const shrunk = adjustCropRect({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, 'nw', 0.9, 0.9);
    expect(shrunk.w).toBeCloseTo(0.01, 5);
    expect(shrunk.h).toBeCloseTo(0.01, 5);
  });

  test('remaps spatial crop and multi-segment timeline annotations and detects omitted ones', () => {
    const crop = { x: 0.25, y: 0.2, w: 0.5, h: 0.5 };
    const clips = [
      { start: 0, end: 2, at: 0, speed: 2 }, // output 0..1s (length 1s)
      { start: 5, end: 9, at: 3, speed: 1 }, // output 1..5s (length 4s)
    ];
    const items: Annotation[] = [
      // Inside crop & spanning both kept clips (0.5..4s on editor timeline -> 0.5..1 in seg0 + 0..1 shifted to 1..2 in seg1)
      { id: 'span', x: 0.5, y: 0.45, w: 0, h: 0, text: 'Span', start: 0.5, end: 4.0 },
      // Box partially overlapping crop
      { id: 'box', x: 0.1, y: 0.1, w: 0.4, h: 0.4, text: 'Box', start: 3, end: 6 },
      // Pin outside crop -> omitted
      { id: 'outside-crop', x: 0.1, y: 0.1, w: 0, h: 0, text: 'Out crop', start: 3, end: 5 },
      // Pin inside crop but only inside deleted gap (1..3s) -> omitted
      { id: 'in-gap', x: 0.5, y: 0.5, w: 0, h: 0, text: 'Gap', start: 1.2, end: 2.5 },
      // Legacy `time` annotation in segment 1 + annotation with undefined `end`
      { id: 'legacy', x: 0.5, y: 0.5, w: 0, h: 0, text: 'Legacy', time: 6 },
      { id: 'open-end', x: 0.5, y: 0.5, w: 0, h: 0, text: 'Open', start: 4 },
    ];

    expect(hasOmittedAnnotations(items, crop, clips, 7)).toBe(true);
    expect(hasOmittedAnnotations([items[0]], crop, clips, 7)).toBe(false);

    const remapped = remapAnnotationsForExport(items, crop, clips, 7);
    expect(remapped.map((a) => a.id)).toEqual([
      'span',
      'span-1',
      'box',
      'legacy',
      'open-end',
    ]);

    expect(remapped[0]).toMatchObject({ id: 'span', x: 0.5, y: 0.5, start: 0.5, end: 1.0 });
    expect(remapped[1]).toMatchObject({ id: 'span-1', start: 1.0, end: 2.0 });
    expect(remapped[2].x).toBeCloseTo(0, 5);
    expect(remapped[2].y).toBeCloseTo(0, 5);
    expect(remapped[2].w).toBeCloseTo(0.5, 5);
    expect(remapped[2].h).toBeCloseTo(0.6, 5);
    expect(remapped[2].start).toBeCloseTo(1, 5);
    expect(remapped[2].end).toBeCloseTo(4, 5);
    expect(remapped[3].time).toBeUndefined();
    expect(remapped[3].start).toBeCloseTo(2, 5);
    expect(remapped[3].end).toBeCloseTo(4, 5);
    expect(remapped[4].start).toBeCloseTo(2, 5);
    expect(remapped[4].end).toBeCloseTo(5, 5);
  });
});

describe('payload validation, Tauri bridge, and saved new asset export', () => {
  test('validates command inputs for prepareVideoExportPayload and probeVideoAsset', async () => {
    expect(() =>
      prepareVideoExportPayload({
        sourceFile: '  ',
        clips: [{ start: 0, end: 2, at: 0, speed: 1 }],
      })
    ).toThrow();

    expect(() =>
      prepareVideoExportPayload({
        sourceFile: 'Studio/a.mp4',
        clips: [],
      })
    ).toThrow();

    expect(() =>
      prepareVideoExportPayload({
        sourceFile: 'Studio/a.mp4',
        clips: Array.from({ length: MAX_VIDEO_SEGMENTS + 1 }, () => ({
          start: 0,
          end: 1,
          at: 0,
          speed: 1,
        })),
      })
    ).toThrow();

    expect(() =>
      prepareVideoExportPayload({
        sourceFile: 'Studio/a.mp4',
        clips: [{ start: 2, end: 1, at: 0, speed: 1 }],
        sourceDuration: 5,
      })
    ).toThrow();

    expect(() =>
      prepareVideoExportPayload({
        sourceFile: 'Studio/a.mp4',
        clips: [{ start: 0, end: 7, at: 0, speed: 1 }],
        sourceDuration: 5,
      })
    ).toThrow();

    // Sorts by timeline `at`, clamps rounding tolerance, collapses full crop, infers folder
    const payload = prepareVideoExportPayload({
      sourceFile: 'Studio/a.mp4',
      clips: [
        { start: 3, end: 5.05, at: 4, speed: 2 },
        { start: 0, end: 1.5, at: 0, speed: 0.5 },
      ],
      crop: { x: 0, y: 0, w: 1, h: 1 },
      sourceDuration: 5,
    });
    expect(payload).toEqual({
      sourceFile: 'Studio/a.mp4',
      segments: [
        { start: 0, end: 1.5, speed: 0.5 },
        { start: 3, end: 5, speed: 2 },
      ],
      crop: null,
      folder: 'Studio',
    });

    await expect(probeVideoAsset('')).rejects.toThrow(/required/i);
    await expect(probeVideoAsset('Studio/a.mp4')).rejects.toThrow(/desktop app/i);

    let probedArgs: unknown;
    const probe = await probeVideoAsset('Studio/a.mp4', {
      invokeFn: async <R>(cmd: string, args?: Record<string, unknown>) => {
        expect(cmd).toBe('probe_video_asset');
        probedArgs = args;
        return { width: 1280, height: 720, duration: 10, hasAudio: true } as R;
      },
    });
    expect(probedArgs).toEqual({ file: 'Studio/a.mp4' });
    expect(probe.width).toBe(1280);
  });

  test('exports a brand-new video asset, inserts it next to the original, and leaves original intact', async () => {
    const { source, originalAsset, sources } = makeFixture();
    let state = createVideoEditorState(10, originalAsset.annotations ?? []);
    // Trimming 2s off start shifts annotation (2..8s) -> (0..6s)
    state = trimClipStartToTime(state, 2);
    // Speeding 8s clip to 2x produces a 4s clip and scales annotation (0..6s) -> (0..3s)
    state = setClipSpeed(state, 0, 2);
    state = setCropRect(state, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });

    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    let savedLibrary: Source[] | null = null;

    const outcome = await exportEditedVideoAsset({
      state,
      source,
      originalAsset,
      sources,
      saveSources: async (next) => {
        savedLibrary = next;
        return true;
      },
      invokeFn: async <R>(cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        const res: VideoExportResult = {
          id: 'new-edit-uuid',
          file: 'Studio/new-edit-uuid.mp4',
          thumbnail: 'new-edit-uuid.jpg',
          previewVideo: null,
          duration: 4,
          width: 640,
          height: 360,
          hasAudio: true,
        };
        return res as R;
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('export_edited_video');
    expect(calls[0].args).toEqual({
      request: {
        sourceFile: 'Studio/hero-scroll.mp4',
        segments: [{ start: 2, end: 10, speed: 2 }],
        crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
        folder: 'Studio',
      },
    });

    expect(outcome.saved).toBe(true);
    expect(outcome.asset).toEqual({
      id: 'new-edit-uuid',
      name: buildEditedVideoName('Hero Scroll'),
      file: 'Studio/new-edit-uuid.mp4',
      kind: 'video',
      thumbnail: 'new-edit-uuid.jpg',
      sourceUrl: 'https://example.com/demo',
      tags: ['motion', 'hero'],
      notes: 'Original recording',
      annotations: [{ id: 'ann-1', x: 0.5, y: 0.5, w: 0, h: 0, text: 'Center pin', start: 0, end: 3 }],
    });

    // Original asset remains completely intact and at index 0; new asset placed at index 1
    expect(savedLibrary).not.toBeNull();
    const updatedAssets = outcome.sources[0].assets;
    expect(updatedAssets.map((a) => a.id)).toEqual(['asset-orig', 'new-edit-uuid', 'asset-other']);
    expect(updatedAssets[0]).toEqual(originalAsset);
    expect(buildEditedVideoName('Hero Scroll (edited)')).toBe('Hero Scroll (edited)');
  });

  test('propagates export errors without mutating sources and surfaces saveSources failure', async () => {
    const { source, originalAsset, sources } = makeFixture();
    const state = createVideoEditorState(10);

    // Rejects non-video asset
    await expect(
      exportEditedVideoAsset({
        state,
        source,
        originalAsset: source.assets[1],
        sources,
        invokeFn: async () => {
          throw new Error('should not be called');
        },
      })
    ).rejects.toThrow(/Only video assets/i);

    // Rejects trashed asset
    await expect(
      exportEditedVideoAsset({
        state,
        source,
        originalAsset: { ...originalAsset, trashedAt: '2026-01-01T00:00:00Z' },
        sources,
        invokeFn: async () => {
          throw new Error('should not be called');
        },
      })
    ).rejects.toThrow(/Trash/i);

    // Rejects outside desktop when no invokeFn
    await expect(
      exportEditedVideoAsset({ state, source, originalAsset, sources })
    ).rejects.toThrow(/desktop app/i);

    // FFmpeg failure skips saveSources
    let saveCalled = false;
    await expect(
      exportEditedVideoAsset({
        state,
        source,
        originalAsset,
        sources,
        saveSources: async () => {
          saveCalled = true;
        },
        invokeFn: async () => {
          throw new Error('Could not render edited video: Invalid argument');
        },
      })
    ).rejects.toThrow(/Could not render edited video/i);
    expect(saveCalled).toBe(false);

    // saveSources returning false reports rendered file path clearly
    await expect(
      exportEditedVideoAsset({
        state,
        source,
        originalAsset,
        sources,
        saveSources: async () => false,
        invokeFn: async <R>() =>
          ({
            id: 'rendered-1',
            file: 'Studio/rendered-1.mp4',
            thumbnail: null,
            previewVideo: null,
            duration: 10,
            width: 1280,
            height: 720,
            hasAudio: false,
          }) as R,
      })
    ).rejects.toThrow(/Studio\/rendered-1\.mp4/);

    // Target source missing throws clear error
    expect(() =>
      insertExportedAssetIntoSources(sources, 'missing-src', originalAsset)
    ).toThrow(/not found/i);
  });
});
