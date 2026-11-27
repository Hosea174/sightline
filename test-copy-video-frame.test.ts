import { expect, test, mock } from 'bun:test';
import { copyVideoFrame } from './src/lib/copyVideoFrame';

test('copies the displayed frame and falls back with the captured timestamp', async () => {
  const video = { videoWidth: 2, videoHeight: 1, currentTime: 3.5 } as HTMLVideoElement;
  const draw = mock(() => {});
  const blob = new Blob(['frame'], {type: 'image/png'});
  const canvas = { width: 0, height: 0, getContext: () => ({drawImage: draw}), toBlob: (callback: (b: Blob) => void) => callback(blob) };
  Object.defineProperty(globalThis, 'document', { value: {createElement: () => canvas}, configurable: true });
  const write = mock(async (items: any[]) => { expect(await items[0].data['image/png']).toBe(blob); });
  Object.defineProperty(globalThis, 'navigator', { value: {clipboard: {write}}, configurable: true });
  Object.defineProperty(globalThis, 'ClipboardItem', { value: class { constructor(public data: unknown) {} }, configurable: true });
  const fallback = mock(async (_time: number) => {});
  await copyVideoFrame(video, fallback);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(canvas.width).toBe(2);
  expect(canvas.height).toBe(1);
  expect(fallback).not.toHaveBeenCalled();
  write.mockImplementation(async () => { video.currentTime = 9; throw new Error('clipboard unavailable'); });
  await copyVideoFrame(video, fallback);
  expect(fallback).toHaveBeenCalledWith(3.5);
});
