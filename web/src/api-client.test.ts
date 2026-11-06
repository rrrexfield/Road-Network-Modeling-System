import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNearestIntersection, fetchPath } from './api-client.js';

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
