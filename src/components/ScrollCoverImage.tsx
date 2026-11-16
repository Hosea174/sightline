import React from 'react';

/** Measure a cover image once loaded. Tall full-page captures get data-scrollable so CSS can pan them on hover. */
export function markScrollable(img: HTMLImageElement) {
  const box = img.parentElement;
  if (!box || !img.naturalWidth) return;
  const renderedHeight = (img.naturalHeight / img.naturalWidth) * box.clientWidth;
  const overflow = renderedHeight - box.clientHeight;
  if (overflow > box.clientHeight * 0.25) {
    img.dataset.scrollable = 'true';
    img.style.setProperty('--scroll-ms', `${Math.round(Math.min(9000, Math.max(900, overflow / 0.12)))}ms`);
  } else {
    delete img.dataset.scrollable;
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
