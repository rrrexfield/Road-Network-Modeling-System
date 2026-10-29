import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { Map as MaplibreMap, NavigationControl, Popup } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { PathLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { RoadFeature, WeightProfile, WSMessage } from '@gisalgo/shared';
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
import { createStatsPanel, fetchStats, fetchWeightProfile } from './panels/stats/index.js';
import { createWeightPanel } from './panels/weight/index.js';

/** 当前权重目标；权重面板变化时更新，选路模块通过它读取。 */
let currentMetric: 'distance' | 'time' = 'distance';
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

const tooltip = new Popup({ closeButton: false, closeOnClick: false, offset: 14 });

function roadFeatureHtml(feature: RoadFeature): string {
  const p = feature.properties;
  const rows: string[] = [];
  if (p.name !== undefined) rows.push(`<div class="tt-name">${escapeHtml(p.name)}</div>`);
  rows.push(`<div>类型:${escapeHtml(p.highway)}</div>`);
  rows.push(`<div>Way ID:${p.id}</div>`);
  const extra = Object.entries(p.tags)
    .filter(([k]) => k !== 'highway' && k !== 'name')
    .slice(0, 6);
  if (extra.length > 0) {
    rows.push(
      `<div class="tt-tags">${extra
        .map(([k, v]) => `<span>${escapeHtml(k)}=${escapeHtml(v)}</span>`)
        .join(' ')}</div>`,
    );
  }
  return rows.join('');
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** 把面板包成可收起的独立分区：固定的标题条 + 可独立滚动的内容区。 */
function createCollapsibleSection(title: string, content: HTMLElement): HTMLElement {
  const section = document.createElement('section');
  section.className = 'side-section';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'side-section__toggle';
  toggle.setAttribute('aria-expanded', 'true');

  const label = document.createElement('span');
  label.textContent = title;

  const chevron = document.createElement('span');
  chevron.className = 'side-section__chevron';
  chevron.textContent = '▾';

  toggle.append(label, chevron);

  const body = document.createElement('div');
  body.className = 'side-section__body';
  body.append(content);

  toggle.addEventListener('click', () => {
    const collapsed = section.classList.toggle('is-collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    chevron.textContent = collapsed ? '▸' : '▾';
  });

  section.append(toggle, body);
  return section;
}

/**
 * 把统计/权重面板挂载到右侧栏,并接上实时接口。
 * 面板只在路网加载成功后初始化(此时服务端已完成拓扑组装)。
 */
async function initPanels(): Promise<void> {
  const host = document.getElementById('side-panels');
  if (host === null) return;

  const statsPanel = createStatsPanel();
  let hasStats = false;
  const weightPanel = createWeightPanel({
    onChange: (profile) => {
      currentMetric = profile.metric;
      void reloadStats(profile);
      // 权重目标变了，已显示的路径要按新目标重算
      pathSelection?.recompute();
    },
  });

  host.append(
    createCollapsibleSection('网络统计', statsPanel.element),
    createCollapsibleSection('权重配置', weightPanel.element),
  );

  const panelState: { speedTable?: Readonly<Record<string, number>> } = {};
  let requestToken = 0;

  /** 按(可选的)权重配置重取统计;旧响应由 token 丢弃。 */
  async function reloadStats(profile?: WeightProfile): Promise<void> {
    const token = ++requestToken;
    const stats = await fetchStats(
      profile === undefined
        ? undefined
        : {
            metric: profile.metric,
            speedFactor: profile.speedFactor,
            speedOverridesKmh: profile.speedOverridesKmh,
          },
    );
    if (token !== requestToken) return;
    if (stats === null) {
      statsPanel.setSource('接口不可用', false);
      return;
    }
    statsPanel.render(stats);
    statsPanel.setSource('实时接口', true);
    // 首次拿到数据后填充权重面板的等级行;之后不再 update,避免输入框失焦
    if (!hasStats) {
      weightPanel.update(stats, panelState.speedTable);
      hasStats = true;
    }
  }

  const [profileResponse, initialStats] = await Promise.all([fetchWeightProfile(), fetchStats()]);
  panelState.speedTable = profileResponse?.speedTable;

  if (initialStats !== null) {
    statsPanel.render(initialStats);
    statsPanel.setSource('实时接口', true);
    weightPanel.update(initialStats, panelState.speedTable);
    hasStats = true;
  } else {
    statsPanel.setSource('接口不可用', false);
  }

  currentMetric = weightPanel.getProfile().metric;
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
        tooltip
          .setLngLat(info.coordinate as [number, number])
          .setHTML(roadFeatureHtml(info.object as RoadFeature))
          .addTo(map);
        lastShowAt = performance.now();
      } else if (performance.now() - lastShowAt > 150) {
        tooltip.remove();
      }
      return true;
    },
  });
  map.addControl(overlay);

  pathSelection = createPathSelection({
    map,
    getMetric: () => currentMetric,
    onLayersChange: refreshLayers,
  });

  map.on('movestart', () => tooltip.remove());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') tooltip.remove();
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
  void initPanels();
}

main().catch((err) => {
  console.error(err);
  $('loading').textContent = '初始化失败,详见控制台';
});