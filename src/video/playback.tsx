import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from '../components/ui/button';

const STORAGE_KEY = 'sightline-video-autoplay';

type VideoPlayback = { autoplay: boolean; setAutoplay: (value: boolean) => void };

const VideoPlaybackContext = createContext<VideoPlayback>({ autoplay: true, setAutoplay: () => {} });

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function VideoPlaybackProvider({ children }: { children: React.ReactNode }) {
  const [autoplay, setAutoplayState] = useState(readStored);
  const setAutoplay = useCallback((value: boolean) => {
    setAutoplayState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
    } catch {
      /* storage unavailable: the choice lasts for this session only */
    }
  }, []);
  const value = useMemo(() => ({ autoplay, setAutoplay }), [autoplay, setAutoplay]);
  return <VideoPlaybackContext.Provider value={value}>{children}</VideoPlaybackContext.Provider>;
}

export function useVideoPlayback() {
  return useContext(VideoPlaybackContext);
}

export function VideoPlaybackToggle({ className, showLabel = true }: { className?: string; showLabel?: boolean }) {
  const { autoplay, setAutoplay } = useVideoPlayback();
  const label = autoplay ? 'Pause videos' : 'Play videos';
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      aria-pressed={!autoplay}
      aria-label={label}
      title={autoplay ? 'Pause all video previews (hover still plays)' : 'Resume video autoplay'}
      onClick={() => setAutoplay(!autoplay)}
    >
      {autoplay ? <Pause size={14} /> : <Play size={14} />}
      {showLabel && <span>{label}</span>}
    </Button>
  );
}

type LoopingPreviewProps = {
  videoSrc: string;
  posterSrc?: string;
  /** Extra gate for autoplay (for example the canvas video budget). Hover always plays. */
  allowed?: boolean;
  /** Track on-screen visibility and only autoplay while visible. Disable when `allowed` already covers it. */
  observeVisibility?: boolean;
  fit?: 'contain' | 'cover';
};

/**
 * Poster image with a muted looping video on top. The video element exists only while the preview
 * is hovered, or autoplay is on and the preview is allowed and visible. Otherwise the decoder is
 * released and the poster stays.
 */
export function LoopingPreview({ videoSrc, posterSrc, allowed = true, observeVisibility = true, fit = 'contain' }: LoopingPreviewProps) {
  const { autoplay } = useVideoPlayback();
  const rootRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(!observeVisibility);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const host = root.closest<HTMLElement>('[data-preview-host]') || root.parentElement || root;
    const enter = () => {
      setHovered(true);
      const video = root.querySelector('video');
      if (video) {
        video.currentTime = 0;
        void video.play().catch(() => {});
      }
    };
    const leave = () => setHovered(false);
    host.addEventListener('pointerenter', enter);
    host.addEventListener('pointerleave', leave);
    return () => {
      host.removeEventListener('pointerenter', enter);
      host.removeEventListener('pointerleave', leave);
    };
  }, []);

  useEffect(() => {
    if (!observeVisibility) return;
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '80px' });
    observer.observe(root);
    return () => observer.disconnect();
  }, [observeVisibility]);

  const playing = hovered || (autoplay && allowed && visible);

  useEffect(() => {
    if (!playing) setReady(false);
  }, [playing]);

  return (
    <div ref={rootRef} className={`looping-preview fit-${fit}`}>
      {posterSrc && <img src={posterSrc} alt="" loading="lazy" decoding="async" draggable={false} />}
      {playing && (
        <video
          src={videoSrc}
          className={ready ? 'ready' : undefined}
          autoPlay
          loop
          muted
          playsInline
          draggable={false}
          onLoadedData={() => setReady(true)}
        />
      )}
    </div>
  );
}
