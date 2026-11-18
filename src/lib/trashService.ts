import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import {
  TRASH_RETENTION_DAYS,
  clearAllTrash,
  isFileInTrashStorage,
  isPreviewInTrashStorage,
  isThumbnailInTrashStorage,
  normalizeAssetRelPath,
  parseTrashTimestamp,
  purgeExpiredTrash,
  removeTrashedItem,
  setTrash,
  trashDaysRemaining,
} from '../logic';
import type { Asset, Source } from '../types';

export type TrashTarget = {
  sourceId: string;
  assetId?: string;
};

export type TrashCommandResult = {
  library: string;
  trashedCount: number;
  restoredCount: number;
  deletedSources: number;
  deletedAssets: number;
  deletedFiles: number;
  movedToTrash: number;
  restoredFromTrash: number;
  warnings: string[];
};

export type TrashOperationOutcome<T extends Source = Source> = {
  sources: T[];
  result: TrashCommandResult;
};

export type TauriInvokeFn = <R>(cmd: string, args?: Record<string, unknown>) => Promise<R>;

export type TrashServiceOptions = {
  /** Wait for any queued `save_library` writes before mutating `library.json` on disk. */
  flushPendingWrites?: () => Promise<boolean | void>;
  now?: Date | string;
  invokeFn?: TauriInvokeFn;
};

const isNative = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let trashOperationQueue: Promise<void> = Promise.resolve();

function enqueueTrashOperation<R>(task: () => Promise<R>): Promise<R> {
  const run = trashOperationQueue.then(task, task);
  trashOperationQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

const RESERVED_SEGMENT_STEMS = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

function hasUnsafeSegment(seg: string): boolean {
  if (!seg || seg === '.' || seg === '..') return true;
  if (/[\x00-\x1f\x7f<>:"/\\|?*]/.test(seg)) return true;
  const stem = seg.split('.')[0].toUpperCase();
  return RESERVED_SEGMENT_STEMS.has(stem);
}

export function assertSafeAssetRelPath(rel: string): string {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) {
    throw new Error('Invalid asset path.');
  }
  if (/^[A-Za-z]:/.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new Error('Invalid asset path.');
  }
  const normalized = rel.replace(/\\/g, '/');
  if (normalized.endsWith('/')) {
    throw new Error('Invalid asset path.');
  }
  const parts = normalized.split('/');
  if (parts.length < 1 || parts.length > 2 || parts.some(hasUnsafeSegment)) {
    throw new Error('Invalid asset path.');
  }
  return parts.join('/');
}

export function assertSafeSingleFileName(name: string): string {
  if (
    typeof name !== 'string' ||
    !name ||
    name.includes('\0') ||
    name.includes('/') ||
    name.includes('\\') ||
    hasUnsafeSegment(name)
  ) {
    throw new Error('Invalid file name.');
  }
  return name;
}

function isWindowsPath(root: string): boolean {
  return root.includes('\\') || /^[A-Za-z]:/.test(root);
}

function getInvoke(options?: TrashServiceOptions): TauriInvokeFn | null {
  if (options?.invokeFn) return options.invokeFn;
  return isNative() ? (invoke as TauriInvokeFn) : null;
}

async function flushWritesIfNeeded(options?: TrashServiceOptions): Promise<void> {
  if (!options?.flushPendingWrites) return;
  const ok = await options.flushPendingWrites();
  if (ok === false) {
    throw new Error('Could not flush pending library changes before updating Trash.');
  }
}

function emptyResult(library: string): TrashCommandResult {
  return {
    library,
    trashedCount: 0,
    restoredCount: 0,
    deletedSources: 0,
    deletedAssets: 0,
    deletedFiles: 0,
    movedToTrash: 0,
    restoredFromTrash: 0,
    warnings: [],
  };
}

function assertSourcesArray<T extends Source>(sources: readonly T[]): void {
  if (!Array.isArray(sources)) {
    throw new Error('Library sources must be an array.');
  }
}

function assertTargetsArray(targets: readonly TrashTarget[]): void {
  if (!Array.isArray(targets)) {
    throw new Error('Trash targets must be an array.');
  }
  for (const target of targets) {
    if (!target || typeof target.sourceId !== 'string' || !target.sourceId.trim()) {
      throw new Error('Invalid trash target.');
    }
    if (
      target.assetId !== undefined &&
      (typeof target.assetId !== 'string' || !target.assetId.trim())
    ) {
      throw new Error('Invalid trash asset target.');
    }
  }
}

function parseSourcesFromResult<T extends Source = Source>(result: TrashCommandResult): T[] {
  const parsed = JSON.parse(result.library) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
  ) {
    throw new Error('Trash command returned an invalid library payload.');
  }
  return parsed as T[];
}

function resolveNowIso(now?: Date | string): string {
  if (now === undefined) return new Date().toISOString();
  if (now instanceof Date) {
    if (Number.isNaN(now.getTime())) {
      throw new Error('Invalid trash timestamp.');
    }
    return now.toISOString();
  }
  if (typeof now === 'string') {
    const trimmed = now.trim();
    if (!trimmed || parseTrashTimestamp(trimmed) === null) {
      throw new Error('Invalid trash timestamp.');
    }
    return trimmed;
  }
  throw new Error('Invalid trash timestamp.');
}

function resolveNowMs(now?: Date | string): number {
  if (now === undefined) return Date.now();
  if (now instanceof Date) {
    const ms = now.getTime();
    if (!Number.isFinite(ms)) {
      throw new Error('Invalid trash timestamp.');
    }
    return ms;
  }
  if (typeof now === 'string') {
    const ms = parseTrashTimestamp(now);
    if (ms === null) {
      throw new Error('Invalid trash timestamp.');
    }
    return ms;
  }
  throw new Error('Invalid trash timestamp.');
}

function clearCoverIfNeeded<T extends Source>(source: T, trashedAssetId?: string): T {
  if (!source.coverId) return source;
  if (trashedAssetId && source.coverId === trashedAssetId) {
    return { ...source, coverId: undefined };
  }
  const coverActive = source.assets.some((a) => a.id === source.coverId && !a.trashedAt);
  return coverActive ? source : { ...source, coverId: undefined };
}

/**
 * Moves targeted sources or assets into Trash and relocates unshared files to `<library>/trash/`.
 */
export async function trashItems<T extends Source = Source>(
  targets: readonly TrashTarget[],
  currentSources: readonly T[] = [],
  options?: TrashServiceOptions
): Promise<TrashOperationOutcome<T>> {
  return enqueueTrashOperation(async () => {
    assertTargetsArray(targets);
    assertSourcesArray(currentSources);
    const nowIso = resolveNowIso(options?.now);
    const invokeFn = getInvoke(options);
    if (invokeFn) {
      await flushWritesIfNeeded(options);
      const result = await invokeFn<TrashCommandResult>('trash_items', {
        targets: targets.map((t) => ({
          sourceId: t.sourceId,
          ...(t.assetId ? { assetId: t.assetId } : {}),
        })),
        nowIso,
      });
      return { sources: parseSourcesFromResult<T>(result), result };
    }

    let next = [...currentSources] as T[];
    let trashedCount = 0;
    for (const target of targets) {
      const existingSource = next.find((s) => s.id === target.sourceId);
      if (!existingSource) continue;
      if (target.assetId) {
        const existingAsset = existingSource.assets.find((a) => a.id === target.assetId);
        if (existingAsset && !existingAsset.trashedAt) {
          next = setTrash(next, target.sourceId, target.assetId, nowIso).map((s) =>
            s.id === target.sourceId ? clearCoverIfNeeded(s, target.assetId) : s
          );
          trashedCount += 1;
        }
      } else if (!existingSource.trashedAt) {
        next = setTrash(next, target.sourceId, undefined, nowIso);
        trashedCount += 1;
      }
    }

    return {
      sources: next,
      result: {
        ...emptyResult(JSON.stringify(next)),
        trashedCount,
      },
    };
  });
}

/**
 * Restores targeted sources or assets from Trash back into active storage.
 */
export async function restoreFromTrash<T extends Source = Source>(
  targets: readonly TrashTarget[],
  currentSources: readonly T[] = [],
  options?: TrashServiceOptions
): Promise<TrashOperationOutcome<T>> {
  return enqueueTrashOperation(async () => {
    assertTargetsArray(targets);
    assertSourcesArray(currentSources);
    const invokeFn = getInvoke(options);
    if (invokeFn) {
      await flushWritesIfNeeded(options);
      const result = await invokeFn<TrashCommandResult>('restore_from_trash', {
        targets: targets.map((t) => ({
          sourceId: t.sourceId,
          ...(t.assetId ? { assetId: t.assetId } : {}),
        })),
      });
      return { sources: parseSourcesFromResult<T>(result), result };
    }

    let next = [...currentSources] as T[];
    let restoredCount = 0;
    for (const target of targets) {
      const existingSource = next.find((s) => s.id === target.sourceId);
      if (!existingSource) continue;
      if (target.assetId) {
        const existingAsset = existingSource.assets.find((a) => a.id === target.assetId);
        if (existingAsset?.trashedAt) {
          next = setTrash(next, target.sourceId, target.assetId, undefined);
          restoredCount += 1;
        }
      } else if (existingSource.trashedAt) {
        next = setTrash(next, target.sourceId, undefined, undefined);
        restoredCount += 1;
      }
    }

    return {
      sources: next,
      result: {
        ...emptyResult(JSON.stringify(next)),
        restoredCount,
      },
    };
  });
}

/**
 * Permanently deletes only trashed sources or trashed assets. Active items are safely ignored.
 */
export async function permanentlyDeleteTrashed<T extends Source = Source>(
  targets: readonly TrashTarget[],
  currentSources: readonly T[] = [],
  options?: TrashServiceOptions
): Promise<TrashOperationOutcome<T>> {
  return enqueueTrashOperation(async () => {
    assertTargetsArray(targets);
    assertSourcesArray(currentSources);
    const invokeFn = getInvoke(options);
    if (invokeFn) {
      await flushWritesIfNeeded(options);
      const result = await invokeFn<TrashCommandResult>('permanently_delete_trashed', {
        targets: targets.map((t) => ({
          sourceId: t.sourceId,
          ...(t.assetId ? { assetId: t.assetId } : {}),
        })),
      });
      return { sources: parseSourcesFromResult<T>(result), result };
    }

    let next = [...currentSources] as T[];
    let deletedSources = 0;
    let deletedAssets = 0;
    for (const target of targets) {
      const before = next.find((s) => s.id === target.sourceId);
      if (!before) continue;
      const updated = removeTrashedItem(next, target.sourceId, target.assetId);
      if (updated.length < next.length) {
        deletedSources += 1;
        deletedAssets += before.assets.length;
      } else {
        const after = updated.find((s) => s.id === target.sourceId);
        if (after && after.assets.length < before.assets.length) {
          deletedAssets += before.assets.length - after.assets.length;
        }
      }
      next = updated;
    }

    return {
      sources: next,
      result: {
        ...emptyResult(JSON.stringify(next)),
        deletedSources,
        deletedAssets,
      },
    };
  });
}

/**
 * Permanently deletes all trashed sources and trashed assets and empties `<library>/trash/`.
 */
export async function clearTrash<T extends Source = Source>(
  currentSources: readonly T[] = [],
  options?: TrashServiceOptions
): Promise<TrashOperationOutcome<T>> {
  return enqueueTrashOperation(async () => {
    assertSourcesArray(currentSources);
    const invokeFn = getInvoke(options);
    if (invokeFn) {
      await flushWritesIfNeeded(options);
      const result = await invokeFn<TrashCommandResult>('clear_trash');
      return { sources: parseSourcesFromResult<T>(result), result };
    }

    let deletedSources = 0;
    let deletedAssets = 0;
    for (const s of currentSources) {
      if (s.trashedAt) {
        deletedSources += 1;
        deletedAssets += s.assets.length;
      } else {
        deletedAssets += s.assets.filter((a) => Boolean(a.trashedAt)).length;
      }
    }
    const next = clearAllTrash(currentSources);
    return {
      sources: next,
      result: {
        ...emptyResult(JSON.stringify(next)),
        deletedSources,
        deletedAssets,
      },
    };
  });
}

/**
 * Purges trashed items that have reached the 30-day retention limit.
 */
export async function purgeExpiredLibraryTrash<T extends Source = Source>(
  currentSources: readonly T[] = [],
  options?: TrashServiceOptions & { retentionDays?: number }
): Promise<TrashOperationOutcome<T>> {
  return enqueueTrashOperation(async () => {
    assertSourcesArray(currentSources);
    if (
      options?.retentionDays !== undefined &&
      (!Number.isFinite(options.retentionDays) || options.retentionDays < 0)
    ) {
      throw new Error('Invalid trash retention days.');
    }
    const invokeFn = getInvoke(options);
    if (invokeFn) {
      await flushWritesIfNeeded(options);
      const result = await invokeFn<TrashCommandResult>('purge_expired_trash');
      return { sources: parseSourcesFromResult<T>(result), result };
    }

    const nowMs = resolveNowMs(options?.now);
    const retentionDays = options?.retentionDays ?? TRASH_RETENTION_DAYS;
    const purged = purgeExpiredTrash(currentSources, nowMs, retentionDays);
    return {
      sources: purged.sources,
      result: {
        ...emptyResult(JSON.stringify(purged.sources)),
        deletedSources: purged.removedSources,
        deletedAssets: purged.removedAssets,
      },
    };
  });
}

function joinLibraryDiskPath(root: string, segments: string[]): string {
  if (typeof root !== 'string' || root.includes('\0')) {
    throw new Error('Invalid library root path.');
  }
  const useBackslash = isWindowsPath(root);
  const sep = useBackslash ? '\\' : '/';
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const cleanSegs = segments.flatMap((s) => {
    const norm = normalizeAssetRelPath(s);
    const parts = norm.split('/').filter(Boolean);
    if (parts.some(hasUnsafeSegment)) {
      throw new Error('Invalid library path segment.');
    }
    return parts;
  });
  return [cleanRoot, ...cleanSegs].join(sep);
}

export function resolveAssetDiskUrl(
  root: string,
  file: string,
  allSources: readonly Source[] = [],
  convertFn: (path: string) => string = convertFileSrc
): string {
  assertSourcesArray(allSources);
  const cleanFile = assertSafeAssetRelPath(file);
  const inTrash = isFileInTrashStorage(allSources, cleanFile, isWindowsPath(root));
  const path = inTrash
    ? joinLibraryDiskPath(root, ['trash', 'assets', cleanFile])
    : joinLibraryDiskPath(root, ['assets', cleanFile]);
  return convertFn(path);
}

export function resolveThumbDiskUrl(
  root: string,
  thumbnail: string,
  allSources: readonly Source[] = [],
  assetFile?: string,
  convertFn: (path: string) => string = convertFileSrc
): string {
  assertSourcesArray(allSources);
  const cleanThumb = assertSafeSingleFileName(thumbnail);
  const cleanAssetFile = assetFile ? assertSafeAssetRelPath(assetFile) : undefined;
  const inTrash = isThumbnailInTrashStorage(
    allSources,
    cleanThumb,
    cleanAssetFile,
    isWindowsPath(root)
  );
  const path = inTrash
    ? joinLibraryDiskPath(root, ['trash', 'thumbnails', cleanThumb])
    : joinLibraryDiskPath(root, ['thumbnails', cleanThumb]);
  return convertFn(path);
}

export function resolvePreviewVideoDiskUrl(
  root: string,
  asset: Pick<Asset, 'file' | 'previewVideo'>,
  allSources: readonly Source[] = [],
  convertFn: (path: string) => string = convertFileSrc
): string {
  assertSourcesArray(allSources);
  const cleanFile = assertSafeAssetRelPath(asset.file);
  if (asset.previewVideo) {
    const cleanPreview = assertSafeSingleFileName(asset.previewVideo);
    const inTrash = isPreviewInTrashStorage(
      allSources,
      cleanPreview,
      cleanFile,
      isWindowsPath(root)
    );
    const path = inTrash
      ? joinLibraryDiskPath(root, ['trash', 'previews', cleanPreview])
      : joinLibraryDiskPath(root, ['previews', cleanPreview]);
    return convertFn(path);
  }
  return resolveAssetDiskUrl(root, cleanFile, allSources, convertFn);
}

export async function revealAssetFile(
  file: string,
  trashed?: boolean,
  options?: Pick<TrashServiceOptions, 'invokeFn'>
): Promise<void> {
  const cleanFile = assertSafeAssetRelPath(file);
  const invokeFn = getInvoke(options);
  if (!invokeFn) {
    throw new Error('Open Sightline on your desktop to reveal files in File Explorer.');
  }
  await invokeFn<void>('reveal_asset_file', { file: cleanFile, trashed });
}

export async function getAssetDiskPath(
  file: string,
  trashed?: boolean,
  options?: Pick<TrashServiceOptions, 'invokeFn'>
): Promise<string> {
  const cleanFile = assertSafeAssetRelPath(file);
  const invokeFn = getInvoke(options);
  if (!invokeFn) return cleanFile;
  return invokeFn<string>('get_asset_path', { file: cleanFile, trashed });
}

export async function copyAssetImageToClipboard(
  payload: { file?: string | null; pngBytes?: number[] | null; trashed?: boolean },
  options?: Pick<TrashServiceOptions, 'invokeFn'>
): Promise<void> {
  const cleanFile = payload.file ? assertSafeAssetRelPath(payload.file) : null;
  const invokeFn = getInvoke(options);
  if (!invokeFn) {
    throw new Error('Native image clipboard is only available in the desktop app.');
  }
  await invokeFn<void>('copy_image_to_clipboard', {
    file: cleanFile,
    pngBytes: payload.pngBytes ?? null,
    trashed: payload.trashed,
  });
}

export function formatTrashExpiryLabel(
  trashedAt?: string,
  nowMs = Date.now(),
  retentionDays = TRASH_RETENTION_DAYS
): string | null {
  const days = trashDaysRemaining(trashedAt, nowMs, retentionDays);
  if (days === null) return null;
  if (days <= 0) return 'Expires today';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}
