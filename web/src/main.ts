import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import {
  Map as MaplibreMap,
  NavigationControl,
  Popup,
  type StyleSpecification,
} from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer } from '@deck.gl/layers';
import type { RoadFeature, WSMessage } from '@gisalgo/shared';
import { highwayColor, highwayWidth } from '@gisalgo/shared';
import { connectWebSocket, fetchHealth, fetchNetwork, type WsStatus } from './api-client';

// Carto 瓦片 2025 起需 API key(带水印),故选用免 key 的 OpenFreeMap 深色矢量样式
const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const WUHAN_CENTER: [number, number] = [114.305, 30.593];
const WUHAN_ZOOM = 11;

async function reachable(url: string, timeoutMs = 4000): Promise<boolean> {
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

function buildStyle(withBasemap: boolean): StyleSpecification {
  const layers: StyleSpecification['layers'] = [
    { id: 'bg', type: 'background', paint: { 'background-color': '#101418' } },
  ];
  const sources: StyleSpecification['sources'] = {};
  if (withBasemap) {
    sources['carto'] = {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      maxzoom: 20,
      attribution: '© OpenStreetMap contributors © CARTO',
    };
    layers.push({ id: 'carto', type: 'raster', source: 'carto', paint: { 'raster-opacity': 0.95 } });
  }
  return { version: 8, sources, layers };
}

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

async function main(): Promise<void> {
  const basemapOnline = await reachable(BASEMAP_STYLE_URL);
  setChip(
    $('chip-basemap'),
    basemapOnline ? '底图 · 在线(OpenFreeMap Dark)' : '底图 · 离线(纯色降级)',
    basemapOnline,
  );

  const map = new MaplibreMap({
    container: 'map',
    style: basemapOnline ? BASEMAP_STYLE_URL : buildStyle(false),
    center: WUHAN_CENTER,
    zoom: WUHAN_ZOOM,
    attributionControl: { compact: true },
  });
  map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');

  // 一次原生点击会经 MapboxOverlay 转发出两个 deck click(拾取命中 + 空拾取),
  // 显示后 150ms 内到达的空拾取视为同一次点击的伴生事件,不关闭
  let lastShowAt = 0;
  const overlay = new MapboxOverlay({
    layers: [],
    // 悬停可点选道路时光标变 pointer,其余保持默认抓取手;按住左键拖动(平移)时不切换
    onHover: (info, event) => {
      const dragging = (((event as { srcEvent?: MouseEvent }).srcEvent?.buttons ?? 0) & 1) === 1;
      map.getCanvas().style.cursor = info.object && !dragging ? 'pointer' : '';
    },
    onClick: (info) => {
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
        setChip(
          $('chip-ws'),
          `WS · 已连接(${msg.payload.edgeCount.toLocaleString()} 边)`,
          true,
        );
      }
    },
    (status: WsStatus) => {
      if (status !== 'connected') setChip($('chip-ws'), `WS · ${status === 'connecting' ? '连接中…' : '断开,重连中…'}`, null);
    },
  );

  try {
    const gj = await fetchNetwork();
    const roadsLayer = new PathLayer<RoadFeature>({
      id: 'roads',
      data: gj.features,
      getPath: (f) => f.geometry.coordinates,
      getColor: (f) => highwayColor(f.properties.highway),
      getWidth: (f) => highwayWidth(f.properties.highway),
      widthUnits: 'meters',
      widthMinPixels: 1,
      capRounded: true,
      jointRounded: true,
      pickable: true,
    });
    overlay.setProps({ layers: [roadsLayer] });
  } catch (err) {
    console.error('路网数据加载失败', err);
    $('loading').textContent = '路网数据加载失败,请确认服务端已启动(/api/network)';
    return;
  }

  $('loading').remove();
}

main().catch((err) => {
  console.error(err);
  $('loading').textContent = '初始化失败,详见控制台';
});
