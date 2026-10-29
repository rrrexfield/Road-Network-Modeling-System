/**
 * 道路属性面板。
 *
 * 与统计/权重面板保持同一套视觉原语（web/src/charts/ui.css 的 .gis-panel / .gis-badge），
 * 由宿主（main.ts）挂载到侧栏，点击地图上的道路时调用 show()。
 *
 * 注意：全部通过 textContent 写入，不使用 innerHTML —— OSM 标签内容是外部数据，
 * 用 textContent 可以从根上避免注入问题。
 */
import type { RoadFeature } from '@gisalgo/shared';
import { toPropertyViewModel } from './property-view-model.js';
import './property-panel.css';

/** 面板句柄。element 由宿主挂载；dispose 后不可复用。 */
export interface PropertyPanelHandle {
  element: HTMLElement;
  /** 展示某条道路的属性。 */
  show(feature: RoadFeature): void;
  /** 收起面板并清空内容。 */
  hide(): void;
  /** 从 DOM 摘除并释放引用。 */
  dispose(): void;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** 创建属性面板；初始为收起态。 */
export function createPropertyPanel(): PropertyPanelHandle {
  const root = node('section', 'gis-panel gis-property');
  root.hidden = true;
  root.setAttribute('aria-live', 'polite');

  const head = node('header', 'gis-panel__head');
  const badge = node('span', 'gis-badge gis-badge--wait', '未选择');
  head.append(node('h2', 'gis-panel__title', '道路属性'), badge);

  const empty = node('p', 'gis-property__empty', '点击地图上的道路查看属性');
  const name = node('div', 'gis-property__name');
  const meta = node('dl', 'gis-property__meta');
  const tagsTitle = node('h3', 'gis-property__subtitle', '标签');
  const tags = node('div', 'gis-property__tags');

  root.append(head, empty, name, meta, tagsTitle, tags);

  function clear(): void {
    name.textContent = '';
    meta.replaceChildren();
    tags.replaceChildren();
    badge.textContent = '未选择';
    badge.className = 'gis-badge gis-badge--wait';
    empty.hidden = false;
    name.hidden = true;
    meta.hidden = true;
    tagsTitle.hidden = true;
    tags.hidden = true;
  }

  function hide(): void {
    clear();
    root.hidden = true;
  }

  function show(feature: RoadFeature): void {
    const vm = toPropertyViewModel(feature);

    empty.hidden = true;
    name.hidden = false;
    meta.hidden = false;
    name.textContent = vm.name;

    badge.textContent = vm.highway;
    badge.className = 'gis-badge gis-badge--ok';

    const fieldNodes = vm.fields.flatMap((f) => [
      node('dt', 'gis-property__label', f.label),
      node('dd', 'gis-property__value', f.value),
    ]);
    meta.replaceChildren(...fieldNodes);

    tagsTitle.hidden = !vm.hasTags;
    tags.hidden = !vm.hasTags;
    tags.replaceChildren(
      ...vm.tags.map((t) => {
        const chip = node('span', 'gis-property__tag');
        chip.append(
          node('span', 'gis-property__tag-key', t.label),
          node('span', 'gis-property__tag-value', t.value),
        );
        return chip;
      }),
    );

    root.hidden = false;
  }

  function dispose(): void {
    root.remove();
  }

  clear();
  return { element: root, show, hide, dispose };
}