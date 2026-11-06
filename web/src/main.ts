import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { Map as MaplibreMap, NavigationControl } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { PathLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { RoadFeature, RoadFeatureCollection, TransferPoint, WeightProfile, WSMessage } from '@gisalgo/shared';
import {
  connectWebSocket,
  fetchHealth,
  fetchNetwork,
  fetchNetworkByMode,
  fetchTransferPoints,
  type WsStatus,
} from './api-client';
import {
  BASEMAP_STYLE_URL,
  WUHAN_CENTER,
  WUHAN_ZOOM,
  buildFallbackStyle,
  createModeControl,
  createPathSelection,
  createRoadsLayer,
  createTransferPointsLayers,
  isBasemapReachable,
  travelModeLabel,
  type DisplayMode,
  type PathSelectionHandle,
} from './map/index.js';
import { createStatsPanel, fetchStats, type StatsPanelHandle } from './panels/stats/index.js';
import { createPropertyPanel } from './panels/property/index.js';
import { createWeightPanel, type WeightPanelHandle } from './panels/weight/index.js';
import {
  createTurnEditor,
  createTurnRestrictionLayers,
  type TurnEditorHandle,
} from './panels/editor/index.js';

/** 选路模块句柄；在 main() 中创建后供面板回调使用。 */
let pathSelection: PathSelectionHandle | null = null;
/** 当前成功显示的交通模式；全量基础图降级时为 null。 */
let currentMode: DisplayMode | null = null;
/**
 * 全局权重配置(速度系数与等级限速覆盖),由权重面板维护。
 *
 * 职责划分(issue #45):优化目标(time / distance)归起终点选路卡,
 * 权重面板只管全局权重参数,两者不重复提供同一入口。
 */
let weightProfile: WeightProfile = {
  metric: 'time',
  speedFactor: 1,
  speedOverridesKmh: {},
};

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
 * 把统计与权重面板挂载到右侧栏,并接上实时接口。
 * 面板只在路网加载成功后初始化(此时服务端已完成拓扑组装)。
 */
async function initStatsPanel(): Promise<void> {
  const host = document.getElementById('side-panels');
  if (host === null) return;

  const statsPanel = createStatsPanel();
  host.append(createCollapsibleSection('路网与拓扑', statsPanel.element, true).element);

  // 权重配置面板(issue #45):与统计面板并列,可独立收起。
  const weightPanel = createWeightPanel({
    onChange: (profile) => {
      weightProfile = { ...weightProfile, ...profile };
      void refreshStats(statsPanel, weightPanel);
      // 权重参数影响"用时最短"口径的路径,配置变化后重算当前路径。
      pathSelection?.recompute();
    },
  });
  host.append(createCollapsibleSection('权重配置', weightPanel.element, true).element);

  await refreshStats(statsPanel, weightPanel);
}

/**
 * 按当前权重配置重新拉取统计,并回填统计面板与权重面板。
 *
 * @param statsPanel 统计面板句柄。
 * @param weightPanel 权重面板句柄。
 */
async function refreshStats(
  statsPanel: StatsPanelHandle,
  weightPanel: WeightPanelHandle,
): Promise<void> {
  const stats = await fetchStats({
    metric: weightProfile.metric,
    speedFactor: weightProfile.speedFactor,
    speedOverridesKmh: weightProfile.speedOverridesKmh,
  });
  if (stats === null) {
    statsPanel.setSource('接口不可用', false);
    return;
  }
  statsPanel.render(stats);
  statsPanel.setSource('实时接口', true);
  weightPanel.update(stats);
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

  const modeControl = createModeControl({
    initialMode: 'car',
    onChange: (mode) => void activateMode(mode),
  });
  (document.getElementById('app') ?? document.body).append(modeControl.element);

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
  let transferPoints: TransferPoint[] = [];
  let transferPointLayers: Layer[] = [];
  let restrictionLayers: Layer[] = [];
  const currentRoadNames = new Map<number, string>();
  let turnEditor: TurnEditorHandle | null = null;
  let modeRequestToken = 0;

  /** 把路网图层与选路图层合成一次，统一交给 deck.gl。 */
  const refreshLayers = (): void => {
    const layers: Layer[] = [];
    if (roadsLayer !== null) layers.push(roadsLayer);
    layers.push(...transferPointLayers);
    layers.push(...restrictionLayers);
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
    // 路径按当前显示的交通模态计算：具体模态走该模态子图并应用该模态的禁转表，
    // 'all'（全量基础路网）不下发 mode，服务端走基础图、不施加禁转。
    getMode: () => currentMode ?? 'all',
    // 全局权重参数(issue #45):权重面板调整速度系数/限速覆盖后,路径按新配置重算。
    getWeightParams: () => ({
      speedFactor: weightProfile.speedFactor,
      speedOverridesKmh: weightProfile.speedOverridesKmh,
    }),
  });

  turnEditor = createTurnEditor({
    getMode: () => currentMode,
    getRoadName: (wayId) => currentRoadNames.get(wayId) ?? `Way ${wayId}`,
    // 转向限制栏展开时，点击地图可拾取最近的路口(issue #43)；
    // 收起时不注册任何地图监听，点击地图仍是道路属性卡的原有行为。
    map,
    onIntersectionSelected: (intersection) => {
      // 拾取路口与道路属性卡互斥:命中路口后收起属性卡,避免两套信息同时占屏。
      hideProperty();
      map.easeTo({
        center: intersection.position,
        zoom: Math.max(map.getZoom(), 16),
        duration: 450,
      });
    },
    onIntersectionFocus: (intersection) => {
      map.easeTo({
        center: intersection.position,
        zoom: Math.max(map.getZoom(), 16),
        duration: 450,
      });
    },
    onRestrictionChange: (intersection) => {
      restrictionLayers = createTurnRestrictionLayers(intersection);
      refreshLayers();
    },
    // 禁转已落盘：重算当前路径，使新禁转立即体现在路径结果上（绕行或变为不可达）。
    onRestrictionsSaved: () => {
      pathSelection?.recompute();
    },
  });
  (document.getElementById('app') ?? document.body).append(turnEditor.element);

  const refreshTransferPoints = (): void => {
    if (transferPoints.length === 0) {
      transferPointLayers = [];
    } else {
      transferPointLayers = createTransferPointsLayers(transferPoints, map.getZoom());
    }
    refreshLayers();
  };

  async function activateMode(mode: DisplayMode, initial = false): Promise<void> {
    if (!initial && currentMode === mode) return;

    const token = ++modeRequestToken;
    const label = travelModeLabel(mode);
    hideProperty();
    turnEditor?.setMode(null);
    pathSelection?.setActive(false);
    pathSelection?.clear();
    modeControl.setBusy(true);
    modeControl.setStatus(`${label}路网加载中…`, 'pending');

    try {
      let network: RoadFeatureCollection;
      let points: TransferPoint[];
      if (mode === 'all') {
        network = await fetchNetwork();
        points = [];
      } else {
        [network, points] = await Promise.all([
          fetchNetworkByMode(mode),
          fetchTransferPoints(mode),
        ]);
      }
      if (token !== modeRequestToken) return;

      roadsLayer = createRoadsLayer(network.features);
      transferPoints = points;
      transferPointLayers = createTransferPointsLayers(points, map.getZoom());
      currentRoadNames.clear();
      for (const feature of network.features) {
        currentRoadNames.set(
          feature.properties.id,
          feature.properties.name ?? `Way ${feature.properties.id}`,
        );
      }
      refreshLayers();
      currentMode = mode;
      modeControl.setMode(mode);
      turnEditor?.setMode(mode === 'all' ? null : mode);
      modeControl.setStatus(
        mode === 'all'
          ? `${label}基础路网 · ${network.features.length.toLocaleString()} 条道路`
          : `${label} · ${network.features.length.toLocaleString()} 条道路 · ${points.length.toLocaleString()} 个转换点`,
        'ok',
      );
    } catch (error) {
      if (token !== modeRequestToken) return;

      if (initial) {
        try {
          const baseNetwork = await fetchNetwork();
          if (token !== modeRequestToken) return;
          roadsLayer = createRoadsLayer(baseNetwork.features);
          transferPoints = [];
          transferPointLayers = [];
          refreshLayers();
          currentMode = 'all';
          modeControl.setMode('all');
          turnEditor?.setMode(null);
          modeControl.setStatus('多模态数据不可用，已切换到全量基础路网', 'error');
          return;
        } catch (fallbackError) {
          throw fallbackError instanceof Error ? fallbackError : error;
        }
      }

      modeControl.setMode(currentMode);
      turnEditor?.setMode(currentMode === 'all' ? null : currentMode);
      modeControl.setStatus(
        `${label}切换失败：${error instanceof Error ? error.message : '接口不可用'}`,
        'error',
      );
    } finally {
      if (token === modeRequestToken) modeControl.setBusy(false);
    }
  }

  map.on('zoomend', refreshTransferPoints);
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
    await activateMode('car', true);
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
