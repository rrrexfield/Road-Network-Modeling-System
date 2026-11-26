import type { RoadColorLegendItem, RoadColorMode } from './road-color-model.js';
import { legendForRoadColorMode } from './road-color-model.js';
import './road-color-control.css';

export interface RoadColorControlOptions {
  initialMode?: RoadColorMode;
  onChange?: (mode: RoadColorMode) => void;
}

export interface RoadColorControlHandle {
  element: HTMLElement;
  getMode(): RoadColorMode;
  setMode(mode: RoadColorMode): void;
}

const MODE_OPTIONS: readonly { mode: RoadColorMode; label: string }[] = [
  { mode: 'highway', label: '按等级' },
  { mode: 'speed', label: '按车速' },
  { mode: 'congestion', label: '按拥堵' },
];

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

function renderLegend(host: HTMLElement, items: readonly RoadColorLegendItem[]): void {
  host.replaceChildren(
    ...items.map((item) => {
      const row = element('span', 'road-color-control__legend-item');
      const swatch = element('i', 'road-color-control__swatch');
      const [red, green, blue] = item.color;
      swatch.style.backgroundColor = `rgb(${red} ${green} ${blue})`;
      row.append(swatch, element('span', 'road-color-control__legend-label', item.label));
      return row;
    }),
  );
  host.hidden = items.length === 0;
}

export function createRoadColorControl(
  options: RoadColorControlOptions = {},
): RoadColorControlHandle {
  let mode = options.initialMode ?? 'highway';
  const root = element('section', 'road-color-control');
  const title = element('h2', 'road-color-control__title', '路网着色');
  const buttons = element('div', 'road-color-control__buttons');
  const legendSection = element('div', 'road-color-control__legend-section');
  const legendTitle = element('span', 'road-color-control__legend-title', '图例');
  const legend = element('div', 'road-color-control__legend');
  const note = element('p', 'road-color-control__note');
  const buttonMap = new Map<RoadColorMode, HTMLButtonElement>();

  for (const option of MODE_OPTIONS) {
    const button = element('button', 'road-color-control__button', option.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (mode === option.mode) return;
      mode = option.mode;
      sync();
      options.onChange?.(mode);
    });
    buttonMap.set(option.mode, button);
    buttons.append(button);
  }

  function sync(): void {
    for (const [value, button] of buttonMap) {
      const active = value === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    renderLegend(legend, legendForRoadColorMode(mode));
    note.textContent =
      mode === 'highway'
        ? '按 highway 等级着色'
        : mode === 'speed'
          ? '秒/公里，随当前权重配置变化'
          : '确定性模拟拥堵，待接入 D 的时段数据';
    root.dataset.mode = mode;
  }

  legendSection.append(legendTitle, legend);
  root.append(title, buttons, legendSection, note);
  sync();

  return {
    element: root,
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
      sync();
    },
  };
}
