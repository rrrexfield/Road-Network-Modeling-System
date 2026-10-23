/**
 * 起终点选路：点击地图选起点/终点 → 调 /api/path → 高亮路径。
 *
 * 与道路属性弹窗互斥：宿主应在 isActive() 为 true 时跳过属性点选。
 * 坐标吸附在服务端完成，前端只负责传点击位置与画结果。
 */
import type { Layer } from '@deck.gl/core';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Map as MaplibreMap, MapMouseEvent } from 'maplibre-gl';
import { fetchPath } from '../api-client.js';
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
  /** 读取当前权重目标（来自权重面板）。 */
  getMetric: () => Metric;
  /** 图层变化时通知宿主刷新 overlay。 */
  onLayersChange: () => void;
}

const START_COLOR: [number, number, number, number] = [127, 214, 160, 255];
const END_COLOR: [number, number, number, number] = [232, 136, 136, 255];
const PATH_HALO: [number, number, number, number] = [255, 255, 255, 215];
const PATH_COLOR: [number, number, number, number] = [242, 198, 109, 255];
const MARKER_COLOR = [16, 20, 24, 255] as [number, number, number, number];

interface Marker {
  position: LngLat;
  color: [number, number, number, number];
}

function formatCost(value: number, metric: Metric): string {
  if (metric === 'time') {
    const totalMinutes = Math.max(1, Math.round(value / 60));
    const hours = Math.floor(totalMinutes / 60);
    return hours > 0 ? `${hours} 小时 ${totalMinutes % 60} 分` : `${totalMinutes} 分钟`;
  }
  return value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${Math.round(value)} m`;
}

export function createPathSelection(options: PathSelectionOptions): PathSelectionHandle {
  const { map, getMetric, onLayersChange } = options;

  let active = false;
  let start: LngLat | null = null;
  let end: LngLat | null = null;
  let pathCoordinates: LngLat[] | null = null;
  let requestToken = 0;

  // ---------------- 控制条 ----------------
  const root = document.createElement('section');
  root.className = 'path-select';

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

  const status = document.createElement('p');
  status.className = 'path-select__status';
  status.textContent = '点击「起终点选路」开始';

  head.append(toggle, clearBtn);
  root.append(head, status);
  (document.getElementById('app') ?? document.body).append(root);

  function updateStatus(text: string, state?: 'ok' | 'error' | 'pending'): void {
    status.textContent = text;
    if (state === undefined) delete status.dataset.state;
    else status.dataset.state = state;
  }

  function emit(): void {
    onLayersChange();
  }

  function clear(): void {
    start = null;
    end = null;
    pathCoordinates = null;
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
    const metric = getMetric();
    updateStatus('正在计算路径…', 'pending');

    const result = await fetchPath(start, end, metric);
    if (token !== requestToken) return; // 期间被清除或重算覆盖

    if (!result.ok) {
      pathCoordinates = null;
      updateStatus(
        result.reason === 'unreachable' ? '起点与终点之间不可达' : '路径接口不可用',
        'error',
      );
      emit();
      return;
    }

    pathCoordinates = result.path.coordinates;
    updateStatus(
      `路径 ${formatCost(result.path.distance, metric)}（${metric === 'time' ? '最快' : '最短'}）`,
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
      pathCoordinates = null;
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

    if (pathCoordinates !== null && pathCoordinates.length > 1) {
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
  map.on('click', onMapClick);

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