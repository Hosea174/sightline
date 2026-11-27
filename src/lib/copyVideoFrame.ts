export async function copyVideoFrame(video: HTMLVideoElement, fallback?: (time: number) => Promise<void>) {
  if (!video.videoWidth || !video.videoHeight) throw new Error('Video frame is not ready.');
  const time = video.currentTime;
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image clipboard is unavailable.');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not capture video frame.');
    context.drawImage(video, 0, 0);
    const blob = new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not capture video frame.')), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
  } catch (error) {
    if (!fallback) throw error;
    await fallback(time);
  }
}
