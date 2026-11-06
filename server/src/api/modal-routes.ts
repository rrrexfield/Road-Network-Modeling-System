/**
 * 作业二的模态路由:转换点查询、路口就近查询与路口转向限制读写。
 *
 * 契约(issue #24 已冻结,定义在 @gisalgo/shared):
 * - GET  /api/transfer-points?mode=car|walk|bike|bus → TransferPoint[]
 * - GET  /api/intersections/nearest?lon=&lat=&mode=&maxDistanceM= → NearestIntersectionResponse
 * - GET  /api/intersections/:nodeId/turns?mode=         → IntersectionTurns
 * - PUT  /api/intersections/:nodeId/turns?mode=         → SetIntersectionTurnsResponse
 *
 * mode 缺省为 car。转向限制按**边对**存储,而边 ID 只在所属模态内有效,
 * 因此读写必须使用同一模态:GET 与 PUT 的 mode 不一致会得到 400(边不属于该路口)。
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  IntersectionTurns,
  SetIntersectionTurnsRequest,
  SetIntersectionTurnsResponse,
  TravelMode,
} from '@gisalgo/shared';
import { isTravelMode, type ModalRuntimeRegistry } from './modal-runtime.js';
import { DEFAULT_MAX_DISTANCE_M, MAX_MAX_DISTANCE_M } from './intersection-index.js';

/** 转向限制路由缺省的交通模态。 */
const DEFAULT_MODE: TravelMode = 'car';

interface ApiFailure {
  status: number;
  message: string;
  /** 附加诊断字段,直接并入 error 对象。 */
  extra?: Record<string, unknown>;
}

/**
 * 把 C 模块抛出的异常映射为明确的 HTTP 状态码,不留裸 500。
 *
 * C 的模块目前抛普通 Error(带中文消息),A 不能改动 C 的目录,因此这里按消息前缀
 * 归类;映射表集中在本函数,后续 C 若改为抛带 code 的错误,只需替换本函数。
 */
export function mapTurnError(error: unknown): ApiFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('路口不存在')) {
    return { status: 404, message: '路口不存在或坐标非法' };
  }
  if (message.includes('转向几何无法判定')) {
    return { status: 422, message: '转向几何无法判定,无法列出该路口的转向动作' };
  }
  if (message.includes('非法转向边对') || message.includes('非法禁转请求')) {
    return { status: 400, message: '非法转向边对:边不属于该路口,或请求体结构不合法' };
  }
  if (message.includes('恢复存在失配')) {
    return { status: 409, message: '禁转快照恢复存在失配,须先处理诊断,禁止覆盖旧快照' };
  }
  return { status: 500, message: `禁转服务内部错误:${message}` };
}

function fail(reply: FastifyReply, failure: ApiFailure): FastifyReply {
  return reply.code(failure.status).send({
    error: { message: failure.message, ...(failure.extra ?? {}) },
  });
}

/** 解析查询参数中的模态;缺省为 car,非法返回 null。 */
export function parseMode(raw: unknown): TravelMode | null {
  if (raw === undefined) return DEFAULT_MODE;
  return isTravelMode(raw) ? raw : null;
}

/** 解析路径参数中的路口节点 ID;非安全整数返回 null。 */
export function parseNodeId(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * 解析经纬度参数;非有限数或超出合法范围返回 null。
 * 纬度上限 ±90、经度上限 ±180，越界值一律拒绝而非静默裁剪。
 */
export function parseCoordinate(raw: unknown, limit: number): number | null {
  if (typeof raw !== 'string') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return null;
  return value;
}

/**
 * 解析命中半径（米）；缺省为 DEFAULT_MAX_DISTANCE_M。
 * 超出上限返回 null——防止过大的阈值退化成全图扫描。
 */
export function parseMaxDistance(raw: unknown): number | null {
  if (raw === undefined) return DEFAULT_MAX_DISTANCE_M;
  if (typeof raw !== 'string') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_MAX_DISTANCE_M) return null;
  return value;
}

/** 校验 PUT 请求体是否为冻结契约的 SetIntersectionTurnsRequest。 */
export function parseSetTurnsRequest(body: unknown): SetIntersectionTurnsRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const forbidden = (body as { forbidden?: unknown }).forbidden;
  if (!Array.isArray(forbidden)) return null;
  for (const pair of forbidden) {
    if (typeof pair !== 'object' || pair === null) return null;
    const { fromEdge, toEdge } = pair as { fromEdge?: unknown; toEdge?: unknown };
    if (!Number.isSafeInteger(fromEdge) || !Number.isSafeInteger(toEdge)) return null;
  }
  return { forbidden: forbidden.map((p) => ({ fromEdge: p.fromEdge, toEdge: p.toEdge })) };
}

/** 注册作业二的模态路由。 */
export async function registerModalRoutes(
  app: FastifyInstance,
  registry: ModalRuntimeRegistry,
): Promise<void> {
  app.get('/api/transfer-points', (request, reply) => {
    const mode = parseMode((request.query as { mode?: unknown }).mode);
    if (mode === null) {
      return fail(reply, { status: 400, message: 'mode 必须是 car / walk / bike / bus 之一' });
    }
    if (!registry.ready) {
      return fail(reply, { status: 503, message: registry.unavailableReason ?? '派生数据不可用' });
    }
    return registry.transferPoints(mode);
  });

  app.get('/api/intersections/nearest', (request, reply) => {
    const query = request.query as {
      lon?: unknown;
      lat?: unknown;
      mode?: unknown;
      maxDistanceM?: unknown;
    };
    const mode = parseMode(query.mode);
    if (mode === null) {
      return fail(reply, { status: 400, message: 'mode 必须是 car / walk / bike / bus 之一' });
    }
    const lon = parseCoordinate(query.lon, 180);
    const lat = parseCoordinate(query.lat, 90);
    if (lon === null || lat === null) {
      return fail(reply, { status: 400, message: 'lon / lat 必须是合法经纬度(经度 ±180、纬度 ±90)' });
    }
    const maxDistance = parseMaxDistance(query.maxDistanceM);
    if (maxDistance === null) {
      return fail(reply, {
        status: 400,
        message: `maxDistanceM 必须是 0 到 ${MAX_MAX_DISTANCE_M} 之间的正数`,
      });
    }
    if (!registry.ready) {
      return fail(reply, { status: 503, message: registry.unavailableReason ?? '派生数据不可用' });
    }

    let runtime;
    try {
      runtime = registry.runtime(mode);
    } catch (error) {
      return fail(reply, mapTurnError(error));
    }

    // 阈值内没有可编辑路口时返回 404,不返回"最近但很远"的节点——
    // 否则前端会误选画面外的路口。
    const found = runtime.intersectionIndex.findNearest(
      lat,
      lon,
      maxDistance,
      runtime.wayNames,
    );
    if (found === null) {
      return fail(reply, {
        status: 404,
        message: `附近 ${maxDistance} 米内没有可编辑路口,请放大后重试`,
      });
    }
    return found;
  });

  app.get('/api/intersections/:nodeId/turns', (request, reply) => {
    const mode = parseMode((request.query as { mode?: unknown }).mode);
    if (mode === null) {
      return fail(reply, { status: 400, message: 'mode 必须是 car / walk / bike / bus 之一' });
    }
    const nodeId = parseNodeId((request.params as { nodeId?: unknown }).nodeId);
    if (nodeId === null) {
      return fail(reply, { status: 400, message: 'nodeId 必须是整数节点 ID' });
    }
    if (!registry.ready) {
      return fail(reply, { status: 503, message: registry.unavailableReason ?? '派生数据不可用' });
    }

    let runtime;
    try {
      runtime = registry.runtime(mode);
    } catch (error) {
      return fail(reply, mapTurnError(error));
    }
    if (!runtime.topology.nodes.has(nodeId)) {
      return fail(reply, { status: 404, message: `路口不存在或坐标非法:${nodeId}` });
    }
    try {
      const turns: IntersectionTurns = runtime.service.getTurns(nodeId);
      return turns;
    } catch (error) {
      return fail(reply, mapTurnError(error));
    }
  });

  app.put('/api/intersections/:nodeId/turns', (request, reply) => {
    const mode = parseMode((request.query as { mode?: unknown }).mode);
    if (mode === null) {
      return fail(reply, { status: 400, message: 'mode 必须是 car / walk / bike / bus 之一' });
    }
    const nodeId = parseNodeId((request.params as { nodeId?: unknown }).nodeId);
    if (nodeId === null) {
      return fail(reply, { status: 400, message: 'nodeId 必须是整数节点 ID' });
    }
    const payload = parseSetTurnsRequest(request.body);
    if (payload === null) {
      return fail(reply, {
        status: 400,
        message: '请求体必须是 { forbidden: [{ fromEdge, toEdge }] },边 ID 为整数',
      });
    }
    if (!registry.ready) {
      return fail(reply, { status: 503, message: registry.unavailableReason ?? '派生数据不可用' });
    }

    let runtime;
    try {
      runtime = registry.runtime(mode);
    } catch (error) {
      return fail(reply, mapTurnError(error));
    }

    // 恢复失配时禁止覆盖旧快照:先诊断再写入,把失配明细一并带给前端
    if (runtime.service.restoreIssues.length > 0) {
      return fail(reply, {
        status: 409,
        message: '禁转快照恢复存在失配,须先处理诊断,禁止覆盖旧快照',
        extra: { restoreIssues: runtime.service.restoreIssues },
      });
    }
    if (!runtime.topology.nodes.has(nodeId)) {
      return fail(reply, { status: 404, message: `路口不存在或坐标非法:${nodeId}` });
    }

    try {
      const response: SetIntersectionTurnsResponse = runtime.service.setTurns(nodeId, payload);
      return response;
    } catch (error) {
      return fail(reply, mapTurnError(error));
    }
  });
}
