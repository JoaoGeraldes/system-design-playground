export function element(tag: string, className = '', text = ''): HTMLElement {
  const created = document.createElement(tag);
  if (className) created.className = className;
  if (text) created.textContent = text;
  return created;
}

export function section(title: string, content: HTMLElement[]): HTMLElement {
  const wrapper = element('section', 'drawer-section');
  wrapper.append(element('h3', '', title), ...content);
  return wrapper;
}

export function list(items: string[], className = ''): HTMLElement {
  const wrapper = element('ul', className);
  wrapper.append(...items.map((item) => element('li', '', item)));
  return wrapper;
}

/**
 * Folds `panel` when a press lands anywhere outside it, so it never has to
 * be closed by aiming at its own header (fiddly on a phone). Capturing sees
 * the press even when something else stops it from bubbling.
 */
export function foldOnPressOutside(
  panel: Pick<HTMLDetailsElement, 'open' | 'contains'>,
  root: EventTarget = document,
): void {
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (panel.open && !panel.contains(event.target as Node)) {
        panel.open = false;
      }
    },
    { capture: true },
  );
}
