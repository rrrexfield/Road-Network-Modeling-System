import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { Map as MaplibreMap, NavigationControl } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { PathLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { RoadFeature, WSMessage } from '@gisalgo/shared';
import { connectWebSocket, fetchHealth, fetchNetwork, type WsStatus } from './api-client';
import {
  BASEMAP_STYLE_URL,
  WUHAN_CENTER,
  WUHAN_ZOOM,
  buildFallbackStyle,
  createPathSelection,
  createRoadsLayer,
  isBasemapReachable,
  type PathSelectionHandle,
} from './map/index.js';
import { createStatsPanel, fetchStats } from './panels/stats/index.js';
import { createPropertyPanel } from './panels/property/index.js';

/** 选路模块句柄；在 main() 中创建后供面板回调使用。 */
let pathSelection: PathSelectionHandle | null = null;

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`缺少元素 #${id}`);
  return el;
}

function setChip(el: HTMLElement, label: string, ok: boolean | null): void {
  el.textContent = label;
  el.classList.toggle('chip-ok', ok === true);
  el.classList.toggle('chip-bad', ok === false);
  el.classList.toggle('chip-wait', ok === null);
}

interface CollapsibleSection {
  element: HTMLElement;
}

/** 把面板包成可收起的独立分区：固定的标题条 + 可独立滚动的内容区。 */
function createCollapsibleSection(
  title: string,
  content: HTMLElement,
  defaultCollapsed = false,
): CollapsibleSection {
  const section = document.createElement('section');
  section.className = 'side-section';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'side-section__toggle';

  const label = document.createElement('span');
  label.textContent = title;
  label.className = 'side-section__label';

  const chevron = document.createElement('span');
  chevron.className = 'side-section__chevron';
  chevron.setAttribute('aria-hidden', 'true');

  toggle.append(label, chevron);

  const body = document.createElement('div');
  body.className = 'side-section__body';
  body.append(content);

  function setCollapsed(collapsed: boolean): void {
    section.classList.toggle('is-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    chevron.textContent = collapsed ? '▸' : '▾';
  }

  toggle.addEventListener('click', () => {
    setCollapsed(!section.classList.contains('is-collapsed'));
  });

  section.append(toggle, body);
  setCollapsed(defaultCollapsed);

  return { element: section };
}

/**
 * 把统计与拓扑面板挂载到右侧栏,并接上实时接口。
 * 面板只在路网加载成功后初始化(此时服务端已完成拓扑组装)。
 */
async function initStatsPanel(): Promise<void> {
  const host = document.getElementById('side-panels');
  if (host === null) return;

  const statsPanel = createStatsPanel();
  host.append(createCollapsibleSection('路网与拓扑', statsPanel.element, true).element);

  const stats = await fetchStats();
  if (stats === null) {
    statsPanel.setSource('接口不可用', false);
    return;
  }
  statsPanel.render(stats);
  statsPanel.setSource('实时接口', true);
}

async function main(): Promise<void> {
  const basemapOnline = await isBasemapReachable(BASEMAP_STYLE_URL);
  setChip(
    $('chip-basemap'),
    basemapOnline ? '底图 · 在线(OpenFreeMap Dark)' : '底图 · 离线(纯色降级)',
    basemapOnline,
  );

  const map = new MaplibreMap({
    container: 'map',
    style: basemapOnline ? BASEMAP_STYLE_URL : buildFallbackStyle(),
    center: WUHAN_CENTER,
    zoom: WUHAN_ZOOM,
    attributionControl: { compact: true },
  });
  map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');

  const propertyPanel = createPropertyPanel();
  propertyPanel.element.classList.add('gis-property--floating');
  (document.getElementById('app') ?? document.body).append(propertyPanel.element);

  function showProperty(feature: RoadFeature, x: number, y: number): void {
    propertyPanel.show(feature);
    const panel = propertyPanel.element;
    const margin = 12;
    const offset = 14;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    let left = x + offset;
    let top = y + offset;
    if (left + width > window.innerWidth - margin) left = x - width - offset;
    if (top + height > window.innerHeight - margin) top = y - height - offset;
    panel.style.left = `${Math.max(margin, left)}px`;
    panel.style.top = `${Math.max(margin, top)}px`;
  }

  const hideProperty = (): void => propertyPanel.hide();

  let roadsLayer: PathLayer<RoadFeature> | null = null;

  /** 把路网图层与选路图层合成一次，统一交给 deck.gl。 */
  const refreshLayers = (): void => {
    const layers: Layer[] = [];
    if (roadsLayer !== null) layers.push(roadsLayer);
    if (pathSelection !== null) layers.push(...pathSelection.getLayers());
    overlay.setProps({ layers });
  };

  // 一次原生点击会经 MapboxOverlay 转发出两个 deck click(拾取命中 + 空拾取),
  // 显示后 150ms 内到达的空拾取视为同一次点击的伴生事件,不关闭
  let lastShowAt = 0;
  const overlay = new MapboxOverlay({
    layers: [],
    // 悬停可点选道路时光标变 pointer,其余保持默认抓取手;按住左键拖动(平移)时不切换
    onHover: (info, event) => {
      if (pathSelection?.isActive() === true) return; // 选点模式由模块自己管光标
      const dragging = (((event as { srcEvent?: MouseEvent }).srcEvent?.buttons ?? 0) & 1) === 1;
      map.getCanvas().style.cursor = info.object && !dragging ? 'pointer' : '';
    },
    onClick: (info) => {
      if (pathSelection?.isActive() === true) return true; // 选点模式下不弹道路属性
      if (info.object && info.coordinate) {
        showProperty(info.object as RoadFeature, info.x, info.y);
        lastShowAt = performance.now();
      } else if (performance.now() - lastShowAt > 150) {
        hideProperty();
      }
      return true;
    },
  });
  map.addControl(overlay);

  pathSelection = createPathSelection({
    map,
    onLayersChange: refreshLayers,
    onActiveChange: (active) => {
      if (active) hideProperty();
    },
  });

  map.on('movestart', hideProperty);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideProperty();
  });

  fetchHealth()
    .then((h) => {
      setChip(
        $('chip-api'),
        `API · ${h.nodeCount.toLocaleString()} 节点 / ${h.edgeCount.toLocaleString()} 边`,
        true,
      );
    })
    .catch(() => {
      setChip($('chip-api'), 'API · 不可用', false);
    });

  connectWebSocket(
    (msg: WSMessage) => {
      if (msg.type === 'hello') {
        setChip($('chip-ws'), `WS · 已连接(${msg.payload.edgeCount.toLocaleString()} 边)`, true);
      }
    },
    (status: WsStatus) => {
      if (status !== 'connected')
        setChip($('chip-ws'), `WS · ${status === 'connecting' ? '连接中…' : '断开,重连中…'}`, null);
    },
  );

  try {
    const gj = await fetchNetwork();
    roadsLayer = createRoadsLayer(gj.features);
    refreshLayers();
  } catch (err) {
    console.error('路网数据加载失败', err);
    $('loading').textContent = '路网数据加载失败,请确认服务端已启动(/api/network)';
    return;
  }

  $('loading').remove();
  void initStatsPanel();
}

main().catch((err) => {
  console.error(err);
  $('loading').textContent = '初始化失败,详见控制台';
});
