/** One-time, app-wide DOM behaviours that don't belong to a single component. */

const GLOW_CARDS = '.source-card,.study-card';

/** Feed the pointer position to hovered cards as --glow-x / --glow-y for the hover glow. */
function trackCardGlow() {
  let frame = 0;
  let pending: { card: HTMLElement; x: number; y: number } | null = null;
  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      const card = (e.target as Element | null)?.closest?.(GLOW_CARDS) as HTMLElement | null;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      pending = { card, x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!pending) return;
        pending.card.style.setProperty('--glow-x', `${pending.x}px`);
        pending.card.style.setProperty('--glow-y', `${pending.y}px`);
        pending = null;
      });
    },
    { passive: true }
  );
}

/**
 * WebView2 only delivers touchpad pinches to the page while browser zoom is enabled
 * (`zoomHotkeysEnabled`). Keep the UI at 100% by cancelling browser zoom everywhere; the canvas
 * handles pinch and Ctrl+wheel itself before these listeners run.
 */
function blockBrowserZoom() {
  window.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false }
  );
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0') e.preventDefault();
  });
}

export function installAppEffects() {
  trackCardGlow();
  blockBrowserZoom();
}
