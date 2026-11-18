import React from 'react';

/**
 * Height-to-width ratio from which a cover counts as a full-page capture. Thumbnails designed as
 * 3:4, 4:5 or 9:16 stay well below it and are centred instead of scrolled.
 */
export const SCROLL_COVER_MIN_RATIO = 2;

/** Mark tall full-page captures so CSS pans them on hover. Everything else is centred. */
export function markScrollable(img: HTMLImageElement) {
  const box = img.parentElement;
  if (!box || !img.naturalWidth) return;
  const ratio = img.naturalHeight / img.naturalWidth;
  const overflow = ratio * box.clientWidth - box.clientHeight;
  if (ratio >= SCROLL_COVER_MIN_RATIO && overflow > 0) {
    img.dataset.scrollable = 'true';
    img.style.setProperty('--scroll-ms', `${Math.round(Math.max(400, overflow / 0.12))}ms`);
    // Enable the transition only after the top position has applied, so it doesn't animate on load.
    requestAnimationFrame(() => requestAnimationFrame(() => (img.dataset.scrollReady = 'true')));
  } else {
    delete img.dataset.scrollable;
    delete img.dataset.scrollReady;
  }
}

export function ScrollCoverImage(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      {...props}
      onLoad={(e) => {
        markScrollable(e.currentTarget);
        props.onLoad?.(e);
      }}
    />
  );
}
