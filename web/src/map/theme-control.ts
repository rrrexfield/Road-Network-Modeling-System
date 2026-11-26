import { MAP_THEME_OPTIONS, type MapTheme } from './theme-model.js';
import './theme-control.css';

export interface ThemeControlOptions {
  initialTheme?: MapTheme;
  onChange?: (theme: MapTheme) => void;
}

export interface ThemeControlHandle {
  element: HTMLElement;
  getTheme(): MapTheme;
  setTheme(theme: MapTheme): void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 右上角底图主题切换：深色 / 白色 / 标准彩色。 */
export function createThemeControl(options: ThemeControlOptions = {}): ThemeControlHandle {
  let theme = options.initialTheme ?? 'dark';
  const root = element('section', 'theme-control');
  root.setAttribute('aria-label', '底图主题');
  const buttons = element('div', 'theme-control__buttons');
  const buttonMap = new Map<MapTheme, HTMLButtonElement>();

  for (const option of MAP_THEME_OPTIONS) {
    const button = element('button', 'theme-control__button', option.label);
    button.type = 'button';
    button.dataset.theme = option.theme;
    button.addEventListener('click', () => {
      if (theme === option.theme) return;
      theme = option.theme;
      sync();
      options.onChange?.(theme);
    });
    buttonMap.set(option.theme, button);
    buttons.append(button);
  }

  function sync(): void {
    root.dataset.theme = theme;
    for (const [value, button] of buttonMap) {
      const active = value === theme;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  root.append(buttons);
  sync();
  return {
    element: root,
    getTheme: () => theme,
    setTheme: (next) => {
      theme = next;
      sync();
    },
  };
}
