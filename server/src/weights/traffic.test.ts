import { describe, expect, it } from 'vitest';
import {
  clampHourOfDay,
  congestionFactorAt,
  curveFactorAtHour,
  buildEventLookup,
  normalizeCongestionProfile,
  slotCount,
  slotIndexForHour,
  DEFAULT_CONGESTION_CURVE,
  DEFAULT_CONGESTION_PROFILE,
  type TrafficEvent,
} from './traffic.js';

describe('时间槽', () => {
  it('30 分钟槽一天 48 个;非法槽长回退 30', () => {
    expect(slotCount(30)).toBe(48);
    expect(slotCount(60)).toBe(24);
    expect(slotCount(0)).toBe(48);
    expect(slotCount(Number.NaN)).toBe(48);
  });

  it('钟点 → 槽下标:边界与 24 点归末槽', () => {
    expect(slotIndexForHour(0, 30)).toBe(0);
    expect(slotIndexForHour(8.5, 30)).toBe(17); // 08:30 落在第 18 槽(下标 17)
    expect(slotIndexForHour(24, 30)).toBe(47);
    expect(slotIndexForHour(26, 30)).toBe(47); // 越界钳制
    expect(slotIndexForHour(-1, 30)).toBe(0);
  });

  it('clampHourOfDay 钳制非法钟点', () => {
    expect(clampHourOfDay(25)).toBe(24);
    expect(clampHourOfDay(-3)).toBe(0);
    expect(clampHourOfDay(Number.NaN)).toBe(0);
  });
});

describe('拥堵曲线', () => {
  it('锚点处取锚点值,两点间线性插值', () => {
    const curve: Array<readonly [number, number]> = [
      [0, 1],
      [8, 2],
    ];
    expect(curveFactorAtHour(curve, 0)).toBe(1);
    expect(curveFactorAtHour(curve, 8)).toBe(2);
    expect(curveFactorAtHour(curve, 4)).toBeCloseTo(1.5, 10);
    expect(curveFactorAtHour(curve, 10)).toBe(2); // 越界钳到末锚点
  });

  it('默认曲线:早高峰(8:30)高于平峰(14:00),夜间低于 1', () => {
    const peak = congestionFactorAt(DEFAULT_CONGESTION_PROFILE, 8.5);
    const off = congestionFactorAt(DEFAULT_CONGESTION_PROFILE, 14);
    const night = congestionFactorAt(DEFAULT_CONGESTION_PROFILE, 3);
    expect(peak).toBeGreaterThan(off);
    expect(off).toBeGreaterThan(night);
    expect(night).toBeLessThan(1);
    expect(peak).toBeGreaterThan(1);
  });

  it('槽内恒定(确定性口径):同一槽内任意钟点结果逐位相同', () => {
    const a = congestionFactorAt(DEFAULT_CONGESTION_PROFILE, 8.02);
    const b = congestionFactorAt(DEFAULT_CONGESTION_PROFILE, 8.48);
    expect(a).toBe(b);
  });

  it('等级敏感度:支路拥堵放大倍数低于主干路', () => {
    const profile = normalizeCongestionProfile({
      curve: [[0, 2]],
      highwaySensitivity: { primary: 1.5, residential: 0.5 },
    });
    expect(congestionFactorAt(profile, 12, 'primary')).toBeCloseTo(3, 10);
    expect(congestionFactorAt(profile, 12, 'residential')).toBeCloseTo(1, 10);
    expect(congestionFactorAt(profile, 12, 'unlisted')).toBeCloseTo(2, 10); // 未收录敏感度=1
  });
});

describe('normalizeCongestionProfile', () => {
  it('非法字段回退默认:槽长越界、空曲线、非法敏感度', () => {
    const profile = normalizeCongestionProfile({
      slotMinutes: 0,
      curve: [],
      highwaySensitivity: { primary: -1 },
    });
    expect(profile.slotMinutes).toBe(DEFAULT_CONGESTION_PROFILE.slotMinutes);
    expect(profile.curve).toEqual(DEFAULT_CONGESTION_CURVE);
    expect(profile.highwaySensitivity['primary']).toBeUndefined();
  });

  it('过滤非法锚点(钟点越界/系数非正),保留合法项', () => {
    const profile = normalizeCongestionProfile({
      curve: [
        [7, 1.5],
        [25, 2],
        [9, 0],
        [10, Number.NaN],
        [11, 1.2],
      ],
    });
    expect(profile.curve).toEqual([
      [7, 1.5],
      [11, 1.2],
    ]);
  });
});

describe('buildEventLookup', () => {
  const events: TrafficEvent[] = [
    { wayIds: [1], kind: 'closure' },
    { wayIds: [2, 3], kind: 'incident', speedFactor: 0.4 },
    { wayIds: [3], kind: 'incident', speedFactor: 0.5 },
    { wayIds: [4], kind: 'closure', activeHours: [7, 9] },
    { wayIds: [5], kind: 'incident', speedFactor: 0.5, activeHours: [7, 9] },
    { wayIds: [6], kind: 'incident', speedFactor: Number.NaN }, // 非法乘子按 1(无效)
  ];

  it('closure 命中即不可通行;incident 连乘;不在事件中的 way 无查表项', () => {
    const lookup = buildEventLookup(events, 12);
    expect(lookup.get(1)?.closure).toBe(true);
    expect(lookup.get(2)).toEqual({ closure: false, factor: 0.4 });
    expect(lookup.get(3)).toEqual({ closure: false, factor: 0.2 }); // 0.4 × 0.5
    expect(lookup.has(4)).toBe(false); // 12 点不在 [7,9) 生效区间
    expect(lookup.get(6)).toEqual({ closure: false, factor: 1 });
    expect(lookup.has(99)).toBe(false);
  });

  it('activeHours 生效窗口:窗口内 closure 生效、incident 生效', () => {
    const lookup = buildEventLookup(events, 8);
    expect(lookup.get(4)?.closure).toBe(true);
    expect(lookup.get(5)?.factor).toBe(0.5);
  });

  it('closure 优先于 incident:同 way 同时命中时按不可通行', () => {
    const lookup = buildEventLookup(
      [
        { wayIds: [9], kind: 'incident', speedFactor: 0.3 },
        { wayIds: [9], kind: 'closure' },
      ],
      12,
    );
    expect(lookup.get(9)?.closure).toBe(true);
  });

  it('空事件表返回空查表', () => {
    expect(buildEventLookup(undefined, 12).size).toBe(0);
    expect(buildEventLookup([], 12).size).toBe(0);
  });
});
