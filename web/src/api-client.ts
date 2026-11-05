import type {
  HealthResponse,
  IntersectionTurns,
  PathResponse,
  RoadFeatureCollection,
  SetIntersectionTurnsResponse,
  TransferPoint,
  TravelMode,
  WSMessage,
} from '@gisalgo/shared';

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
 *
 * @param from 起点 [经度, 纬度]；服务端会吸附到最近的图节点
 * @param to 终点 [经度, 纬度]
 * @param metric distance = 里程最短；time = 用时最短
 * @param mode 交通模态。**缺省（undefined）走基础图、不施加转向限制**，与作业一行为一致；
 *   显式给 mode 则走该模态子图，并由服务端按该模态的禁转表判定转向——禁转边对与边 ID
 *   只在所属模态内有效，故 mode 必须与编辑禁转时使用的模态相同。
 */
export async function fetchPath(
  from: [number, number],
  to: [number, number],
  metric: 'distance' | 'time' = 'distance',
  mode?: TravelMode,
): Promise<PathFetchResult> {
  const query = new URLSearchParams({
    from: `${from[0]},${from[1]}`,
    to: `${to[0]},${to[1]}`,
    metric,
  });
  if (mode !== undefined) query.set('mode', mode);
  try {
    const res = await fetch(`/api/path?${query.toString()}`);
    if (res.status === 404) return { ok: false, reason: 'unreachable' };
    if (!res.ok) return { ok: false, reason: 'error' };
    return { ok: true, path: (await res.json()) as PathResponse };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/* ==================== 作业二：多模态与转向限制 ==================== */

/** 服务端错误体：{ error: { message } }。 */
interface ApiErrorBody {
  error?: { message?: string; restoreIssues?: unknown };
}

/** 取出服务端给出的错误消息；网络异常时给出兜底文案。 */
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * 取指定交通模态的路网。
 *
 * 服务端按模态过滤道路，**转向边的 ID 只在该模态内有效**：
 * 编辑器提交禁转时必须带上同一个 mode，否则服务端无法匹配边对。
 */
export async function fetchNetworkByMode(mode: TravelMode): Promise<RoadFeatureCollection> {
  const res = await fetch(`/api/network?mode=${mode}`);
  if (!res.ok) throw new Error(await readErrorMessage(res, `获取 ${mode} 路网失败`));
  return (await res.json()) as RoadFeatureCollection;
}

/** 取指定交通模态的转换点（地铁站 / 公交站 / 停车场）。 */
export async function fetchTransferPoints(mode: TravelMode): Promise<TransferPoint[]> {
  const res = await fetch(`/api/transfer-points?mode=${mode}`);
  if (!res.ok) throw new Error(await readErrorMessage(res, `获取 ${mode} 转换点失败`));
  return (await res.json()) as TransferPoint[];
}

/** 取某路口的全部转向动作；mode 缺省为 car，与服务端一致。 */
export async function fetchIntersectionTurns(
  nodeId: number,
  mode: TravelMode = 'car',
): Promise<IntersectionTurns> {
  const res = await fetch(`/api/intersections/${nodeId}/turns?mode=${mode}`);
  if (!res.ok) throw new Error(await readErrorMessage(res, `获取路口 ${nodeId} 转向失败`));
  return (await res.json()) as IntersectionTurns;
}

/** 禁转快照恢复失配的明细。 */
export interface RestoreIssue {
  ordinal: number;
  reason: 'missing-segment' | 'ambiguous-segment' | 'geometry-changed';
}

/** 覆盖式保存禁转的结果。 */
export type SetTurnsResult =
  | { ok: true; restrictionCount: number }
  | {
      ok: false;
      reason: 'restore-mismatch' | 'error';
      message: string;
      restoreIssues?: RestoreIssue[];
    };

/**
 * 覆盖式保存某路口的禁转集合（不是逐条增删）。
 *
 * 服务端先写盘再改内存，写盘失败时旧规则不变；返回 409 表示磁盘快照恢复失配，
 * 此时禁止覆盖旧快照，前端应提示用户先处理数据变化。
 */
export async function setIntersectionTurns(
  nodeId: number,
  forbidden: { fromEdge: number; toEdge: number }[],
  mode: TravelMode = 'car',
): Promise<SetTurnsResult> {
  try {
    const res = await fetch(`/api/intersections/${nodeId}/turns?mode=${mode}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forbidden }),
    });
    if (res.status === 409) {
      const body = (await res.json()) as ApiErrorBody;
      return {
        ok: false,
        reason: 'restore-mismatch',
        message: body.error?.message ?? '禁转快照恢复存在失配,禁止覆盖旧快照',
        restoreIssues: body.error?.restoreIssues as RestoreIssue[] | undefined,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: 'error',
        message: await readErrorMessage(res, `保存路口 ${nodeId} 禁转失败`),
      };
    }
    const body = (await res.json()) as SetIntersectionTurnsResponse;
    return { ok: true, restrictionCount: body.restrictionCount };
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      message: error instanceof Error ? error.message : '保存路口禁转失败',
    };
  }
}
