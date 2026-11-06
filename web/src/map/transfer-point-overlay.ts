/**
 * 模态转换点的 DOM 覆盖层:把 Font Awesome 图标画在地图之上。
 *
 * 为什么不用 deck.gl 的 IconLayer:
 * deck.gl 的图片加载走 @loaders.gl —— 它把字节装进**无 MIME 类型**的 Blob,
 * 再交给 `createImageBitmap`;部分 Chromium 会直接抛
 * "The source image could not be decoded",图标层只��底板圆圈(本机实测)。
 * MapLibre 的图片层又会被 deck.gl 的路网图层盖住(overlay 默认 interleaved=false)。
 *
 * 因此这里用最朴素也最稳的做法:**内联 SVG + 绝对定位的 DOM 覆盖层**,
 * 位置由 `map.project()` 给出,随地图重绘同步。不走图片解码、不依赖 WebGL、
 * 任意缩放下都清晰(矢量),离线可用。
 */
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { TransferPoint } from '@gisalgo/shared';
import { transferPointIconMarkup } from './transfer-point-icons.js';

/** 覆盖层句柄。 */
export interface TransferPointOverlay {
  /**
   * 设置当前要显示的转换点(通常只传视口内的)。
   * @param points 转换点;位置为 [lon, lat]。
   */
  setPoints(points: readonly TransferPoint[]): void;
  /** 清空并移除覆盖层。 */
  dispose(): void;
}

/**
 * 创建转换点图标覆盖层。
 *
 * @param map MapLibre 地图实例。
 * @returns 覆盖层句柄。
 */
export function createTransferPointOverlay(map: MaplibreMap): TransferPointOverlay {
  const host = document.createElement('div');
  host.className = 'transfer-point-overlay';
  map.getContainer().append(host);

  /** 点 id → 图标元素与坐标。 */
  const items = new Map<number, { element: HTMLElement; position: [number, number] }>();

  function syncPositions(): void {
    const { width, height } = map.getCanvas().getBoundingClientRect();
    for (const item of items.values()) {
      const point = map.project(item.position);
      const visible =
        point.x >= -32 && point.y >= -32 && point.x <= width + 32 && point.y <= height + 32;
      item.element.style.display = visible ? '' : 'none';
      if (!visible) continue;
      item.element.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
    }
  }

  function setPoints(points: readonly TransferPoint[]): void {
    const keep = new Set<number>();
    for (const point of points) {
      keep.add(point.id);
      const existing = items.get(point.id);
      if (existing !== undefined) {
        existing.position = [point.position[0], point.position[1]];
        continue;
      }
      const element = document.createElement('div');
      element.className = 'transfer-point-marker';
      element.innerHTML = transferPointIconMarkup(point.kind);
      host.append(element);
      items.set(point.id, { element, position: [point.position[0], point.position[1]] });
    }
    for (const [id, item] of [...items]) {
      if (keep.has(id)) continue;
      item.element.remove();
      items.delete(id);
    }
    syncPositions();
  }

  map.on('render', syncPositions);

  return {
    setPoints,
    dispose(): void {
      map.off('render', syncPositions);
      for (const item of items.values()) item.element.remove();
      items.clear();
      host.remove();
    },
  };
}
