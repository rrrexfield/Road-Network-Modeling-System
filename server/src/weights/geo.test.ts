import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_M, haversineMeters } from './geo.js';

describe('haversineMeters', () => {
  it('同名点距离为 0', () => {
    expect(haversineMeters([30.5, 114.3], [30.5, 114.3])).toBe(0);
  });

  it('千分之一纬度差约 111.2 米', () => {
    const meters = haversineMeters([30, 114], [30.001, 114]);
    expect(meters).toBeGreaterThan(111);
    expect(meters).toBeLessThan(111.3);
  });

  it('赤道上 1 度经度 ≈ 111.19 公里', () => {
    expect(haversineMeters([0, 114], [0, 115]) / 1000).toBeCloseTo(111.19, 1);
  });

  it('北纬 30 度经度弧长按 cos(30°) 收缩到约 96.3 公里', () => {
    expect(haversineMeters([30, 114], [30, 115]) / 1000).toBeCloseTo(96.3, 0);
  });

  it('交换起终点距离不变', () => {
    const a: [number, number] = [30.5, 114.3];
    const b: [number, number] = [30.6, 114.1];
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it('武汉到北京为千公里量级', () => {
    const kilometers = haversineMeters([30.593, 114.305], [39.904, 116.407]) / 1000;
    expect(kilometers).toBeGreaterThan(1000);
    expect(kilometers).toBeLessThan(1120);
  });

  it('地球半径常量与 B 的 dijkstra 默认边权一致', () => {
    expect(EARTH_RADIUS_M).toBe(6371000);
  });
});
