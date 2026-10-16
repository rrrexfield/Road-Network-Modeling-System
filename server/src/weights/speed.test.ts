import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEED_KMH, FALLBACK_SPEED_KMH, speedKmh, travelSeconds } from './speed.js';

describe('speedKmh', () => {
  it('已收录等级返回默认限速', () => {
    expect(speedKmh('motorway')).toBe(100);
    expect(speedKmh('residential')).toBe(30);
  });

  it('未收录等级回退兜底限速', () => {
    expect(speedKmh('bus_guideway')).toBe(FALLBACK_SPEED_KMH);
  });

  it('速度表内每一项都是正数', () => {
    for (const [highway, speed] of Object.entries(DEFAULT_SPEED_KMH)) {
      expect(speed, highway).toBeGreaterThan(0);
    }
  });

  it('机动车等级限速高于慢行等级', () => {
    expect(speedKmh('primary')).toBeGreaterThan(speedKmh('residential'));
    expect(speedKmh('residential')).toBeGreaterThan(speedKmh('steps'));
  });
});

describe('travelSeconds', () => {
  it('36 km/h 走 1 公里用 100 秒', () => {
    expect(travelSeconds(1000, 36)).toBeCloseTo(100, 9);
  });

  it('速度非正视为不可通行', () => {
    expect(travelSeconds(1000, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(travelSeconds(1000, -5)).toBe(Number.POSITIVE_INFINITY);
  });

  it('零里程耗时为 0', () => {
    expect(travelSeconds(0, 120)).toBe(0);
  });

  it('速度翻倍耗时减半', () => {
    expect(travelSeconds(3000, 60)).toBeCloseTo(travelSeconds(3000, 120) * 2, 9);
  });
});
