import type { HealthResponse, PathResponse, RoadFeatureCollection, WSMessage } from '@gisalgo/shared';

/** 服务端冷启动(载入 67 万边)慢于前端时自动重试,容忍 `npm run dev` 的启动竞态 */
async function fetchWithRetry(url: string, retries = 10, delayMs = 800): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastErr = new Error(`${url} ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw lastErr;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetchWithRetry('/api/health');
  return (await res.json()) as HealthResponse;
}

export async function fetchNetwork(): Promise<RoadFeatureCollection> {
  const res = await fetchWithRetry('/api/network');
  return (await res.json()) as RoadFeatureCollection;
}

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

/** 连接 /ws,自动重连;返回清理函数 */
export function connectWebSocket(
  onMessage: (msg: WSMessage) => void,
  onStatus: (status: WsStatus) => void,
): () => void {
  let closedByUser = false;
  let retry = 0;
  let timer: number | undefined;
  let ws: WebSocket | undefined;

  const connect = (): void => {
    onStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 0;
      onStatus('connected');
    };
    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data as string) as WSMessage);
      } catch {
        // 忽略非 JSON 消息
      }
    };
    ws.onclose = () => {
      if (closedByUser) return;
      onStatus('disconnected');
      const delay = Math.min(1000 * 2 ** retry, 5000);
      retry += 1;
      timer = window.setTimeout(connect, delay);
    };
  };

  connect();
  return () => {
    closedByUser = true;
    if (timer !== undefined) clearTimeout(timer);
    ws?.close();
  };
}

/** /api/path 的返回；把「不可达」与「接口故障」分开表达，便于界面给出不同提示。 */
export type PathFetchResult =
  | { ok: true; path: PathResponse }
  | { ok: false; reason: 'unreachable' | 'error' };

/**
 * 请求最短 / 最快路径。
 * @param from 起点 [经度, 纬度]；服务端会吸附到最近的图节点
 * @param to 终点 [经度, 纬度]
 * @param metric distance = 里程最短；time = 用时最短
 */
export async function fetchPath(
  from: [number, number],
  to: [number, number],
  metric: 'distance' | 'time' = 'distance',
): Promise<PathFetchResult> {
  const query = new URLSearchParams({
    from: `${from[0]},${from[1]}`,
    to: `${to[0]},${to[1]}`,
    metric,
  });
  try {
    const res = await fetch(`/api/path?${query.toString()}`);
    if (res.status === 404) return { ok: false, reason: 'unreachable' };
    if (!res.ok) return { ok: false, reason: 'error' };
    return { ok: true, path: (await res.json()) as PathResponse };
  } catch {
    return { ok: false, reason: 'error' };
  }
}