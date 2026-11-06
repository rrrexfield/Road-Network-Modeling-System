import { TRAVEL_MODE_OPTIONS, travelModeLabel, type DisplayMode } from './mode-control-model.js';
import './mode-control.css';

export type ModeStatus = 'ok' | 'pending' | 'error';

export interface ModeControlHandle {
  element: HTMLElement;
  setMode(mode: DisplayMode | null): void;
  setBusy(busy: boolean): void;
  setStatus(text: string, state?: ModeStatus): void;
}

export interface ModeControlOptions {
  initialMode: DisplayMode;
  onChange: (mode: DisplayMode) => void;
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

/** 创建左下角交通模式控制条。 */
export function createModeControl(options: ModeControlOptions): ModeControlHandle {
  const root = element('section', 'mode-control');
  const title = element('h2', 'mode-control__title', '交通模式');
  const buttons = element('div', 'mode-control__buttons');
  const status = element(
    'p',
    'mode-control__status',
    `${travelModeLabel(options.initialMode)}路网准备中…`,
  );
  const note = element('p', 'mode-control__note', '路径与统计暂按全量基础路网口径');

  const buttonMap = new Map<DisplayMode, HTMLButtonElement>();
  for (const option of TRAVEL_MODE_OPTIONS) {
    const button = element('button', 'mode-control__button', option.label);
    button.type = 'button';
    button.dataset.mode = option.mode;
    button.addEventListener('click', () => {
      if (button.disabled) return;
      options.onChange(option.mode);
    });
    buttonMap.set(option.mode, button);
    buttons.append(button);
  }

  root.append(title, buttons, status, note);

  function setMode(mode: DisplayMode | null): void {
    for (const [value, button] of buttonMap) {
      const active = value === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function setBusy(busy: boolean): void {
    root.classList.toggle('is-busy', busy);
    for (const button of buttonMap.values()) button.disabled = busy;
  }

  function setStatus(text: string, state?: ModeStatus): void {
    status.textContent = text;
    if (state === undefined) delete status.dataset.state;
    else status.dataset.state = state;
  }

  setMode(options.initialMode);
  return { element: root, setMode, setBusy, setStatus };
}
