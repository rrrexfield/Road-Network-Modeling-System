import { describe, expect, it } from 'vitest';
import { resolvePathMode } from './path-mode.js';

describe('resolvePathMode', () => {
  it('全量模式不下发 mode（服务端走基础图、不施加禁转）', () => {
    expect(resolvePathMode('all')).toBeUndefined();
  });

  it('具体交通模态原样下发', () => {
    expect(resolvePathMode('car')).toBe('car');
    expect(resolvePathMode('walk')).toBe('walk');
    expect(resolvePathMode('bike')).toBe('bike');
    expect(resolvePathMode('bus')).toBe('bus');
  });

  it('模态未就绪时按全量处理，不下发 mode', () => {
    expect(resolvePathMode(null)).toBeUndefined();
    expect(resolvePathMode(undefined)).toBeUndefined();
  });
});
