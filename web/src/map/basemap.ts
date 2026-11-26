/**
 * 底图管理：样式地址、可用性检测、无底图时的降级样式。
 *
 * 底图加载失败必须降级为纯色背景而不是白屏 —— 评委机可能无外网
 * （立项文档风险登记册 R1）。
 */
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { MAP_THEME_STYLE_URLS, type MapTheme } from './theme-model.js';

/**
 * 底图样式地址。
 * Carto 瓦片自 2025 起需要 API key（且带水印），故改用免 key 的 OpenFreeMap 深色样式。
 */
export const BASEMAP_STYLE_URL = MAP_THEME_STYLE_URLS.dark;

/** 地图初始视野：武汉市中心 */
export const WUHAN_CENTER: [number, number] = [114.305, 30.593];
export const WUHAN_ZOOM = 11;

/**
 * 返回底图自带的交通线/道路标注图层 ID。
 *
 * 本项目路网由 deck.gl 独立绘制。白色和标准底图若保留自带道路，会与权重
 * 着色重叠；因此只隐藏 source-layer 以 transportation 开头的图层，保留水系、
 * 建筑、行政边界等其他背景地物。
 */
export function transportationLayerIds(layers: readonly LayerSpecification[]): string[] {
  return layers
    .filter((layer) => {
      const sourceLayer =
        'source-layer' in layer && typeof layer['source-layer'] === 'string'
          ? layer['source-layer']
          : '';
      return sourceLayer.startsWith('transportation');
    })
    .map((layer) => layer.id);
}

/** 在交给 MapLibre 之前直接移除底图交通层，避免白色/正常底图覆盖业务路网。 */
export function withoutTransportationLayers(style: StyleSpecification): StyleSpecification {
  const hidden = new Set(transportationLayerIds(style.layers));
  return {
    ...style,
    layers: style.layers.filter((layer) => !hidden.has(layer.id)),
  };
}

const themedStyleCache = new Map<MapTheme, StyleSpecification>();

/**
 * 加载主题底图 style；在线时先抓取 JSON 并移除交通层，离线时返回纯色降级。
 *
 * 若 JSON 抓取失败则退回 URL，让 MapLibre 自己加载；运行时还会再隐藏一次
 * transportation 图层作为兜底。
 */
export async function loadBasemapStyle(
  theme: MapTheme,
  online: boolean,
): Promise<StyleSpecification | string> {
  if (!online) return buildFallbackStyle(theme);
  const cached = themedStyleCache.get(theme);
  if (cached !== undefined) return cached;
  try {
    const response = await fetch(MAP_THEME_STYLE_URLS[theme], { cache: 'no-store' });
    if (!response.ok) return MAP_THEME_STYLE_URLS[theme];
    const style = (await response.json()) as StyleSpecification;
    const processed = withoutTransportationLayers(style);
    themedStyleCache.set(theme, processed);
    return processed;
  } catch {
    return MAP_THEME_STYLE_URLS[theme];
  }
}

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
export function buildFallbackStyle(theme: MapTheme = 'dark'): StyleSpecification {
  const color = theme === 'white' ? '#f4f5f5' : theme === 'normal' ? '#dfe4e7' : '#101418';
  const layers: StyleSpecification['layers'] = [
    { id: 'bg', type: 'background', paint: { 'background-color': color } },
  ];
  return { version: 8, sources: {}, layers };
}
