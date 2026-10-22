/**
 * 底图管理：样式地址、可用性检测、无底图时的降级样式。
 *
 * 底图加载失败必须降级为纯色背景而不是白屏 —— 评委机可能无外网
 * （立项文档风险登记册 R1）。
 */
import type { StyleSpecification } from 'maplibre-gl';

/**
 * 底图样式地址。
 * Carto 瓦片自 2025 起需要 API key（且带水印），故改用免 key 的 OpenFreeMap 深色样式。
 */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

/** 地图初始视野：武汉市中心 */
export const WUHAN_CENTER: [number, number] = [114.305, 30.593];
export const WUHAN_ZOOM = 11;

/** 探测底图服务是否可达；超时（默认 4s）或网络异常均返回 false。 */
export async function isBasemapReachable(url: string, timeoutMs = 4000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

/**
 * 底图不可用时的降级样式：只有一层纯色背景，路网图层照常渲染、照常点选。
 *
 * 说明：原 main.ts 的 buildStyle(withBasemap) 里有一个 Carto 底图分支，
 * 但全仓只以 buildStyle(false) 调用过，该分支为死代码，此处不再保留。
 */
export function buildFallbackStyle(): StyleSpecification {
  const layers: StyleSpecification['layers'] = [
    { id: 'bg', type: 'background', paint: { 'background-color': '#101418' } },
  ];
  return { version: 8, sources: {}, layers };
}