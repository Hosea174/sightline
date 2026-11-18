/** Route titles from dynamically rendered controls through the shared tooltip theme. */
export function mountTitleTooltips() {
  const selector = '[data-sightline-title]';
  const tooltip = document.createElement('div');
  tooltip.className = 'sightline-title-tooltip';
  tooltip.id = 'sightline-title-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);

  const titles = new WeakMap<Element, string>();
  let anchor: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let description: string | null = null;

  function hide() {
    clearTimeout(timer);
    tooltip.hidden = true;
    if (anchor?.getAttribute('aria-describedby')?.split(' ').includes(tooltip.id)) {
      if (description) anchor.setAttribute('aria-describedby', description);
      else anchor.removeAttribute('aria-describedby');
    }
    anchor = null;
    description = null;
  }

  function show(target: Element | null) {
    if (target === anchor) return;
    hide();
    if (!target || target.closest('[data-sightline-tooltip-trigger]')) return;
    anchor = target;
    timer = setTimeout(() => {
      const label = titles.get(target);
      if (!label || !target.isConnected) return;
      tooltip.textContent = label;
      tooltip.hidden = false;
      const rect = target.getBoundingClientRect();
      const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
      const x = Math.max(6, Math.min(window.innerWidth - width - 6, rect.left + (rect.width - width) / 2));
      const y = rect.top >= height + 10 ? rect.top - height - 6 : Math.min(rect.bottom + 6, window.innerHeight - height - 6);
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${Math.max(6, y)}px`;
      description = target.getAttribute('aria-describedby');
      target.setAttribute('aria-describedby', [description, tooltip.id].filter(Boolean).join(' '));
    }, 250);
  }

  function adopt(element: Element) {
    const title = element.getAttribute('title');
    if (title === null) return;
    element.removeAttribute('title');
    if (title.trim()) {
      titles.set(element, title);
      element.setAttribute('data-sightline-title', '');
    } else {
      titles.delete(element);
      element.removeAttribute('data-sightline-title');
      if (anchor === element) hide();
    }
  }

  document.querySelectorAll('[title]').forEach(adopt);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') adopt(record.target as Element);
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        adopt(node);
        node.querySelectorAll('[title]').forEach(adopt);
      }
    }
    if (anchor && !anchor.isConnected) hide();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });

  const find = (target: EventTarget | null) => target instanceof Element ? target.closest(selector) : null;
  document.addEventListener('pointerover', event => {
    if (event.pointerType !== 'touch') show(find(event.target));
  });
  document.addEventListener('pointerout', event => {
    if (find(event.target) === anchor && find(event.relatedTarget) !== anchor) hide();
  });
  document.addEventListener('focusin', event => show(find(event.target)));
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
}
