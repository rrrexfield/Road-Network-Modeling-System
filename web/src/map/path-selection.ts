/**
 * 起终点选路：点击地图选起点/终点 → 调 /api/path → 高亮路径。
 *
 * 与道路属性弹窗互斥：宿主应在 isActive() 为 true 时跳过属性点选。
 * 坐标吸附在服务端完成，前端只负责传点击位置与画结果。
 *
 * 模态口径：路径按**当前显示的交通模态**请求。`'all'`（全量基础路网）时不下发 mode，
 * 服务端走基础图、不施加转向限制——与作业一行为一致；选定具体模态时下发该 mode，
 * 服务端走该模态子图并按该模态的禁转表判定转向，故编辑器保存的禁转会立即反映到路径上。
 *
 * 跨模态（作业二）：用户开启「跨模态」并给出**有序**模态序列（至少 2 个）后，
 * 请求改带 `modes=car,walk`；服务端返回带 `segments` 的响应时按段着色并标注换乘点。
 * 未开启跨模态（或序列不足 2 个）时，请求参数、绘制与状态栏文案与单模态完全一致。
 */
import type { Layer } from '@deck.gl/core';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Map as MaplibreMap, MapMouseEvent } from 'maplibre-gl';
import type { PathSegment, TravelMode } from '@gisalgo/shared';
import { fetchPath } from '../api-client.js';
import { travelModeLabel, type DisplayMode } from './mode-control-model.js';
import { resolvePathMode } from './path-mode.js';
import {
  addModeToSequence,
  buildCrossModalDrawData,
  formatCrossModalSummary,
  isCrossModalSequence,
  normalizeModeSequence,
  removeModeFromSequence,
  type CrossModalSegmentPath,
  type TransferMarker,
} from './cross-modal-path.js';
import './path-selection.css';

type LngLat = [number, number];
type Metric = 'distance' | 'time';

export interface PathSelectionHandle {
  element: HTMLElement;
  setActive(active: boolean): void;
  isActive(): boolean;
  clear(): void;
  /** 权重目标变化后重算当前路径。 */
  recompute(): void;
  /** 供宿主合并进 deck.gl overlay 的图层。 */
  getLayers(): Layer[];
  dispose(): void;
}

export interface PathSelectionOptions {
  map: MaplibreMap;
  /** 图层变化时通知宿主刷新 overlay。 */
  onLayersChange: () => void;
  /** 激活状态变化时通知宿主收起与选点互斥的面板。 */
  onActiveChange?: (active: boolean) => void;
  /** 读取当前交通模态；缺省视为 'all'（基础图，不施加禁转）。 */
  getMode?: () => DisplayMode;
  /**
   * 读取全局权重参数(issue #45):速度系数与等级限速覆盖。
   *
   * 权重面板是**全局**配置入口，优化目标仍由本卡片的「最快时间 / 最短距离」决定；
   * 两者不重复提供同一入口，故这里只取权重参数、不取 metric。
   */
  getWeightParams?: () => { speedFactor?: number; speedOverridesKmh?: Record<string, number> };
}

const START_COLOR: [number, number, number, number] = [127, 214, 160, 255];
const END_COLOR: [number, number, number, number] = [232, 136, 136, 255];
const PATH_HALO: [number, number, number, number] = [255, 255, 255, 215];
const PATH_COLOR: [number, number, number, number] = [242, 198, 109, 255];
const MARKER_COLOR: [number, number, number, number] = [16, 20, 24, 255] as [number, number, number, number];
/** 换乘点标记：深色填充 + 金色描边，与既有金色点缀基调一致。 */
const TRANSFER_FILL: [number, number, number, number] = [16, 20, 24, 255];
const TRANSFER_STROKE: [number, number, number, number] = [242, 198, 109, 255];

/** 可参与跨模态序列的交通模态（固定顺序，与模式控件一致）。 */
const CROSS_MODAL_MODES: readonly TravelMode[] = ['car', 'walk', 'bike', 'bus'];

interface Marker {
  position: LngLat;
  color: [number, number, number, number];
}

/**
 * 当前绘制的路径内容。
 *
 * 用互斥的两种形态承载单模态与跨模态结果，保证「上一条路径的 segments」不会被残留：
 * 任一状态变化都整体替换或置空，不会出现新旧数据混画。
 */
type PathDrawing =
  | { kind: 'single'; coordinates: LngLat[] }
  | { kind: 'cross'; segments: PathSegment[] };

function formatCost(value: number, metric: Metric): string {
  if (metric === 'time') {
    const totalMinutes = Math.max(1, Math.round(value / 60));
    const hours = Math.floor(totalMinutes / 60);
    return hours > 0 ? `${hours} 小时 ${totalMinutes % 60} 分` : `${totalMinutes} 分钟`;
  }
  return value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${Math.round(value)} m`;
}

export function createPathSelection(options: PathSelectionOptions): PathSelectionHandle {
  const { map, onLayersChange, onActiveChange, getMode, getWeightParams } = options;

  let active = false;
  let metric: Metric = 'time';
  let start: LngLat | null = null;
  let end: LngLat | null = null;
  let pathDrawing: PathDrawing | null = null;
  let requestToken = 0;

  /** 跨模态开关：关闭时行为与单模态完全一致。 */
  let crossEnabled = false;
  /** 用户选定的**有序**模态序列。 */
  let modeSequence: TravelMode[] = [];

  /**
   * 当前应下发的交通模态。
   * 'all' 表示全量基础路网——此时不下发 mode，服务端走基础图、不施加禁转（作业一口径）。
   */
  function currentTravelMode(): TravelMode | undefined {
    return resolvePathMode(getMode?.());
  }

  /**
   * 当前应下发的跨模态序列。
   *
   * 关闭开关、或序列规范化后不足 2 个时返回 undefined——此时请求退化为单模态。
   */
  function currentModeSequence(): TravelMode[] | undefined {
    if (!crossEnabled) return undefined;
    const normalized = normalizeModeSequence(modeSequence);
    return isCrossModalSequence(normalized) ? normalized : undefined;
  }

  // ---------------- 控制条 ----------------
  const root = document.createElement('section');
  root.className = 'path-select';

  const title = document.createElement('h2');
  title.className = 'path-select__title';
  title.textContent = 'Dijkstra最短路径';

  const head = document.createElement('div');
  head.className = 'path-select__head';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'path-select__toggle';
  toggle.textContent = '起终点选路';
  toggle.setAttribute('aria-pressed', 'false');

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'path-select__clear';
  clearBtn.textContent = '清除';
  clearBtn.disabled = true;

  const metricGroup = document.createElement('div');
  metricGroup.className = 'path-select__metric';
  const metricLabel = document.createElement('span');
  metricLabel.className = 'path-select__metric-label';
  metricLabel.textContent = '优化目标';
  const metricButtons = document.createElement('div');
  metricButtons.className = 'path-select__metric-buttons';
  const metricButtonMap = new Map<Metric, HTMLButtonElement>();
  for (const [value, label] of [
    ['time', '最快时间'],
    ['distance', '最短距离'],
  ] as [Metric, string][]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'path-select__metric-button';
    button.textContent = label;
    button.addEventListener('click', () => {
      if (!active || metric === value) return;
      metric = value;
      syncMetricControls();
      resetPath();
      if (start !== null && end !== null) void requestRoute();
    });
    metricButtonMap.set(value, button);
    metricButtons.append(button);
  }
  metricGroup.append(metricLabel, metricButtons);

  // ---------------- 跨模态控制 ----------------
  const crossGroup = document.createElement('div');
  crossGroup.className = 'path-select__cross';
  const crossLabel = document.createElement('span');
  crossLabel.className = 'path-select__metric-label';
  crossLabel.textContent = '跨模态';
  const crossToggle = document.createElement('button');
  crossToggle.type = 'button';
  crossToggle.className = 'path-select__metric-button path-select__cross-toggle';
  crossToggle.textContent = '关闭';
  crossToggle.setAttribute('aria-pressed', 'false');
  crossGroup.append(crossLabel, crossToggle);

  const sequenceGroup = document.createElement('div');
  sequenceGroup.className = 'path-select__sequence';
  sequenceGroup.hidden = true;
  const sequenceLabel = document.createElement('span');
  sequenceLabel.className = 'path-select__metric-label';
  sequenceLabel.textContent = '模态顺序';
  const sequenceChips = document.createElement('div');
  sequenceChips.className = 'path-select__sequence-chips';
  const sequenceButtons = document.createElement('div');
  sequenceButtons.className = 'path-select__metric-buttons';
  const sequenceButtonMap = new Map<TravelMode, HTMLButtonElement>();
  for (const mode of CROSS_MODAL_MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'path-select__metric-button';
    button.textContent = travelModeLabel(mode);
    button.addEventListener('click', () => {
      if (!active) return;
      modeSequence = modeSequence.includes(mode)
        ? removeModeFromSequence(modeSequence, mode)
        : addModeToSequence(modeSequence, mode);
      syncCrossControls();
      resetPath();
      if (start !== null && end !== null) void requestRoute();
    });
    sequenceButtonMap.set(mode, button);
    sequenceButtons.append(button);
  }
  const sequenceClear = document.createElement('button');
  sequenceClear.type = 'button';
  sequenceClear.className = 'path-select__metric-button path-select__sequence-clear';
  sequenceClear.textContent = '清空序列';
  sequenceClear.addEventListener('click', () => {
    if (!active) return;
    modeSequence = [];
    syncCrossControls();
    resetPath();
    if (start !== null && end !== null) void requestRoute();
  });
  const sequenceHint = document.createElement('span');
  sequenceHint.className = 'path-select__sequence-hint';
  sequenceHint.textContent = '至少选择 2 个模态';
  sequenceGroup.append(sequenceLabel, sequenceChips, sequenceButtons, sequenceClear, sequenceHint);

  const status = document.createElement('p');
  status.className = 'path-select__status';
  status.textContent = '点击「起终点选路」开始';

  head.append(toggle, clearBtn);
  root.append(title, head, metricGroup, crossGroup, sequenceGroup, status);
  (document.getElementById('app') ?? document.body).append(root);

  function updateStatus(text: string, state?: 'ok' | 'error' | 'pending'): void {
    status.textContent = text;
    if (state === undefined) delete status.dataset.state;
    else status.dataset.state = state;
  }

  function emit(): void {
    onLayersChange();
  }

  function syncMetricControls(): void {
    for (const [value, button] of metricButtonMap) {
      button.disabled = !active;
      button.classList.toggle('is-active', value === metric);
      button.setAttribute('aria-pressed', String(value === metric));
    }
    metricGroup.classList.toggle('is-disabled', !active);
  }

  /** 同步跨模态控件：开关状态、序列按钮选中态、当前序列（按顺序展示）。 */
  function syncCrossControls(): void {
    crossToggle.textContent = crossEnabled ? '开启' : '关闭';
    crossToggle.classList.toggle('is-active', crossEnabled);
    crossToggle.setAttribute('aria-pressed', String(crossEnabled));
    crossToggle.disabled = !active;
    crossGroup.classList.toggle('is-disabled', !active);

    sequenceGroup.hidden = !crossEnabled;
    sequenceClear.disabled = !active;

    const normalized = normalizeModeSequence(modeSequence);
    for (const [mode, button] of sequenceButtonMap) {
      const selected = normalized.includes(mode);
      button.disabled = !active;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }

    // 当前序列：按选定顺序排列，序号即换乘次序，点击可删除。
    sequenceChips.replaceChildren();
    if (normalized.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'path-select__sequence-empty';
      empty.textContent = '未选择';
      sequenceChips.append(empty);
    } else {
      normalized.forEach((mode, index) => {
        if (index > 0) {
          const arrow = document.createElement('span');
          arrow.className = 'path-select__sequence-arrow';
          arrow.textContent = '→';
          sequenceChips.append(arrow);
        }
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'path-select__sequence-chip';
        chip.textContent = `${index + 1} ${travelModeLabel(mode)}`;
        chip.title = `移除 ${travelModeLabel(mode)}`;
        chip.disabled = !active;
        chip.addEventListener('click', () => {
          if (!active) return;
          modeSequence = removeModeFromSequence(modeSequence, mode);
          syncCrossControls();
          resetPath();
          if (start !== null && end !== null) void requestRoute();
        });
        sequenceChips.append(chip);
      });
    }

    const enabled = isCrossModalSequence(normalized);
    sequenceHint.textContent = enabled
      ? `共 ${normalized.length} 段 · 换乘 ${normalized.length - 1} 处`
      : '至少选择 2 个模态';
    sequenceHint.classList.toggle('is-ok', enabled);
  }

  /** 清空已绘制的路径，并作废在途请求——避免残留上一条路径的 segments。 */
  function resetPath(): void {
    pathDrawing = null;
    requestToken += 1;
    emit();
  }

  function clear(): void {
    start = null;
    end = null;
    pathDrawing = null;
    requestToken += 1; // 作废在途请求
    clearBtn.disabled = true;
    updateStatus(active ? '点击地图设置起点' : '点击「起终点选路」开始');
    emit();
  }

  function setActive(next: boolean): void {
    active = next;
    toggle.setAttribute('aria-pressed', String(next));
    toggle.classList.toggle('is-active', next);
    map.getCanvas().style.cursor = next ? 'crosshair' : '';
    onActiveChange?.(next);
    syncMetricControls();
    syncCrossControls();
    if (!next) {
      updateStatus('选点已暂停');
    } else if (start === null) {
      updateStatus('点击地图设置起点');
    } else if (end === null) {
      updateStatus('已设起点，再点一次设置终点');
    }
    emit();
  }

  async function requestRoute(): Promise<void> {
    if (start === null || end === null) return;
    const token = ++requestToken;
    const requestedMetric = metric;
    const requestedModes = currentModeSequence();
    // 跨模态时模态序列已完全决定各段所属路网，故不再下发单模态的 mode。
    const requestedMode = requestedModes === undefined ? currentTravelMode() : undefined;
    updateStatus('正在计算路径…', 'pending');

    const result = await fetchPath(
      start,
      end,
      requestedMetric,
      requestedMode,
      requestedModes,
      getWeightParams?.(),
    );
    if (token !== requestToken) return; // 期间被清除或重算覆盖

    if (!result.ok) {
      pathDrawing = null;
      updateStatus(
        result.reason === 'unreachable' ? '起点与终点之间不可达' : '路径接口不可用',
        'error',
      );
      emit();
      return;
    }

    const segments = result.path.segments;
    if (segments !== undefined && segments.length > 0) {
      // 跨模态：按段着色并标注换乘点，状态栏给出分段摘要。
      pathDrawing = { kind: 'cross', segments };
      updateStatus(
        formatCrossModalSummary(segments, requestedMetric, result.path.transferPenaltySeconds),
        'ok',
      );
      emit();
      return;
    }

    pathDrawing = { kind: 'single', coordinates: result.path.coordinates };
    // 状态栏标注模态，便于确认当前路径是在哪套路网与禁转规则下算出的。
    const modeText = requestedMode === undefined ? '' : `·${travelModeLabel(requestedMode)}`;
    updateStatus(
      `路径 ${formatCost(result.path.distance, requestedMetric)}（${requestedMetric === 'time' ? '最快' : '最短'}${modeText}）`,
      'ok',
    );
    emit();
  }

  function onMapClick(event: MapMouseEvent): void {
    if (!active) return;
    const point: LngLat = [event.lngLat.lng, event.lngLat.lat];

    // 已有完整的一对，或还没起点 → 作为新起点
    if (start === null || end !== null) {
      start = point;
      end = null;
      pathDrawing = null;
      requestToken += 1;
      clearBtn.disabled = false;
      updateStatus('已设起点，再点一次设置终点');
      emit();
      return;
    }

    end = point;
    emit();
    void requestRoute();
  }

  function getLayers(): Layer[] {
    const layers: Layer[] = [];
    const markers: Marker[] = [];
    if (start !== null) markers.push({ position: start, color: START_COLOR });
    if (end !== null) markers.push({ position: end, color: END_COLOR });

    if (markers.length > 0) {
      layers.push(
        new ScatterplotLayer<Marker>({
          id: 'path-endpoints',
          data: markers,
          getPosition: (d) => d.position,
          getFillColor: (d) => d.color,
          getLineColor: MARKER_COLOR,
          getRadius: 7,
          radiusUnits: 'pixels',
          lineWidthMinPixels: 2,
          stroked: true,
          pickable: false,
        }),
      );
    }

    if (pathDrawing?.kind === 'cross') {
      const { segmentPaths, transferMarkers } = buildCrossModalDrawData(pathDrawing.segments);
      if (segmentPaths.length > 0) {
        // 先画白色描边层作底衬，再画按模态着色的主线
        layers.push(
          new PathLayer<CrossModalSegmentPath>({
            id: 'path-cross-halo',
            data: segmentPaths,
            getPath: (d) => d.coordinates,
            getColor: PATH_HALO,
            getWidth: 9,
            widthUnits: 'pixels',
            capRounded: true,
            jointRounded: true,
            pickable: false,
          }),
          new PathLayer<CrossModalSegmentPath>({
            id: 'path-cross-line',
            data: segmentPaths,
            getPath: (d) => d.coordinates,
            getColor: (d) => d.color,
            getWidth: 5,
            widthUnits: 'pixels',
            capRounded: true,
            jointRounded: true,
            pickable: false,
          }),
        );
      }
      if (transferMarkers.length > 0) {
        layers.push(
          new ScatterplotLayer<TransferMarker>({
            id: 'path-cross-transfers',
            data: transferMarkers,
            getPosition: (d) => d.position,
            getFillColor: TRANSFER_FILL,
            getLineColor: TRANSFER_STROKE,
            getRadius: 8,
            radiusUnits: 'pixels',
            lineWidthMinPixels: 2,
            stroked: true,
            pickable: false,
          }),
        );
      }
    } else if (pathDrawing?.kind === 'single' && pathDrawing.coordinates.length > 1) {
      const pathCoordinates = pathDrawing.coordinates;
      // 两层：先白描边压住路网，再画金色主线，保证在深色底图上醒目
      layers.push(
        new PathLayer<LngLat[]>({
          id: 'path-halo',
          data: [pathCoordinates],
          getPath: (d) => d,
          getColor: PATH_HALO,
          getWidth: 9,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          pickable: false,
        }),
        new PathLayer<LngLat[]>({
          id: 'path-line',
          data: [pathCoordinates],
          getPath: (d) => d,
          getColor: PATH_COLOR,
          getWidth: 5,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          pickable: false,
        }),
      );
    }

    return layers;
  }

  function recompute(): void {
    if (start !== null && end !== null) void requestRoute();
  }

  function dispose(): void {
    map.off('click', onMapClick);
    root.remove();
  }

  toggle.addEventListener('click', () => setActive(!active));
  clearBtn.addEventListener('click', () => clear());
  crossToggle.addEventListener('click', () => {
    if (!active) return;
    crossEnabled = !crossEnabled;
    // 关闭跨模态时清空序列，回到单模态；开启时给出常见组合作为起点。
    if (!crossEnabled) modeSequence = [];
    else if (modeSequence.length === 0) modeSequence = ['car', 'walk'];
    syncCrossControls();
    resetPath();
    if (start !== null && end !== null) void requestRoute();
  });
  map.on('click', onMapClick);
  syncMetricControls();
  syncCrossControls();

  return {
    element: root,
    setActive,
    isActive: () => active,
    clear,
    recompute,
    getLayers,
    dispose,
  };
}
