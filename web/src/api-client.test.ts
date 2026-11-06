import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiHttpError,
  buildPathQuery,
  fetchNearestIntersection,
  fetchNetworkByMode,
  fetchPath,
  fetchTransferPoints,
  retryWhenServerNotReady,
} from './api-client.js';

/**
 * 记录 fetch 收到的请求 URL，返回一个最小可用的 Response 替身。
 */
function stubFetch(): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    urls.push(url);
    return Promise.resolve(
      new Response(
        JSON.stringify({ distance: 100, nodeIds: [1, 2], edgeIds: [0], coordinates: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  });
  return { urls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPath 的模态参数', () => {
  it('缺省不下发 mode（服务端走基础图、与作业一一致）', async () => {
    const { urls } = stubFetch();
    await fetchPath([114.3, 30.5], [114.31, 30.51]);
    expect(urls[0]).not.toContain('mode=');
  });

  it('指定模态时下发 mode，供服务端按该模态的禁转表判定转向', async () => {
    const { urls } = stubFetch();
    await fetchPath([114.3, 30.5], [114.31, 30.51], 'time', 'car');
    expect(urls[0]).toContain('mode=car');
    expect(urls[0]).toContain('metric=time');
  });

  it('缺省不下发 modes（单模态行为不变）', async () => {
    const { urls } = stubFetch();
    await fetchPath([114.3, 30.5], [114.31, 30.51], 'time', 'car');
    expect(urls[0]).not.toContain('modes=');
  });

  it('给出模态序列时下发 modes，并保持给定顺序', async () => {
    const { urls } = stubFetch();
    await fetchPath([114.3, 30.5], [114.31, 30.51], 'time', undefined, ['car', 'walk']);
    expect(urls[0]).toContain('modes=car,walk');
  });
});

describe('buildPathQuery', () => {
  it('缺省只带起终点与度量', () => {
    const query = buildPathQuery([114.3, 30.5], [114.31, 30.51]);
    expect(query).toContain('from=114.3%2C30.5');
    expect(query).toContain('to=114.31%2C30.51');
    expect(query).toContain('metric=distance');
    expect(query).not.toContain('mode=');
    expect(query).not.toContain('modes=');
  });

  it('指定模态时下发 mode', () => {
    const query = buildPathQuery([114.3, 30.5], [114.31, 30.51], 'time', 'walk');
    expect(query).toContain('mode=walk');
    expect(query).toContain('metric=time');
  });

  it('模态序列不足 2 个时不下发 modes（视为未启用跨模态）', () => {
    expect(buildPathQuery([114.3, 30.5], [114.31, 30.51], 'time', undefined, [])).not.toContain(
      'modes=',
    );
    expect(
      buildPathQuery([114.3, 30.5], [114.31, 30.51], 'time', undefined, ['car']),
    ).not.toContain('modes=');
  });

  it('模态序列以逗号分隔下发，顺序与给定一致', () => {
    const query = buildPathQuery([114.3, 30.5], [114.31, 30.51], 'time', undefined, [
      'bus',
      'walk',
      'car',
    ]);
    expect(query).toContain('modes=bus,walk,car');
  });

  it('全局权重参数与 /api/stats 同口径下发（issue #45）', () => {
    const query = buildPathQuery(
      [114.3, 30.5],
      [114.31, 30.51],
      'time',
      'car',
      undefined,
      { speedFactor: 1.5, speedOverridesKmh: { primary: 45, residential: 25 } },
    );
    expect(query).toContain('speedFactor=1.5');
    expect(query).toContain('speedKmh=primary%3A45%2Cresidential%3A25');
  });

  it('缺省权重参数时不下发相关参数（服务端用默认值）', () => {
    const query = buildPathQuery([114.3, 30.5], [114.31, 30.51], 'time', 'car');
    expect(query).not.toContain('speedFactor');
    expect(query).not.toContain('speedKmh');
  });
});

describe('服务端未就绪时的重试', () => {
  it('网络层失败时重试,直到服务端起来', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', () => {
      attempts += 1;
      if (attempts < 3) return Promise.reject(new Error('ECONNREFUSED'));
      return Promise.resolve(
        new Response(JSON.stringify({ features: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    const network = await fetchNetworkByMode('car');
    expect(network.features).toEqual([]);
    expect(attempts).toBe(3);
  });

  it('服务端已应答的错误不重试(重试没有意义)', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', () => {
      attempts += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: '派生数据不可用' } }), { status: 503 }),
      );
    });
    await expect(fetchTransferPoints('car')).rejects.toThrow('派生数据不可用');
    expect(attempts).toBe(1);
  });

  it('ApiHttpError 表示服务端已应答,不是网络故障', () => {
    const error = new ApiHttpError(400, 'mode 非法');
    expect(error.status).toBe(400);
    expect(error).toBeInstanceOf(Error);
  });

  it('retryWhenServerNotReady 透传非网络错误', async () => {
    let attempts = 0;
    await expect(
      retryWhenServerNotReady(
        () => {
          attempts += 1;
          return Promise.reject(new ApiHttpError(500, '内部错误'));
        },
        3,
        1,
      ),
    ).rejects.toThrow('内部错误');
    expect(attempts).toBe(1);
  });
});

describe('fetchNearestIntersection', () => {
  it('下发坐标与模态', async () => {
    const { urls } = stubFetch();
    await fetchNearestIntersection(114.2977, 30.5953, 'walk', 20);
    expect(urls[0]).toContain('lon=114.2977');
    expect(urls[0]).toContain('lat=30.5953');
    expect(urls[0]).toContain('mode=walk');
    expect(urls[0]).toContain('maxDistanceM=20');
  });

  it('缺省模态为 car,不传半径时不下发该参数', async () => {
    const { urls } = stubFetch();
    await fetchNearestIntersection(114.2977, 30.5953);
    expect(urls[0]).toContain('mode=car');
    expect(urls[0]).not.toContain('maxDistanceM');
  });

  it('阈值内没有路口时返回 null,而非抛错', async () => {
    vi.stubGlobal(
      'fetch',
      () => Promise.resolve(new Response('{}', { status: 404 })),
    );
    await expect(fetchNearestIntersection(114.2977, 30.5953)).resolves.toBeNull();
  });

  it('接口故障时抛出服务端给出的消息', async () => {
    vi.stubGlobal(
      'fetch',
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: '派生数据不可用' } }), { status: 503 }),
        ),
    );
    await expect(fetchNearestIntersection(114.2977, 30.5953)).rejects.toThrow('派生数据不可用');
  });
});
