import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPath } from './api-client.js';

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
