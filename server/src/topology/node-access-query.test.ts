import { describe, expect, it } from 'vitest';
import type { TravelMode } from '@gisalgo/shared';
import { evaluateNodeAccess, buildModalTopology } from './index.js';
import cases from './fixtures/node-access-scenarios.json';
const entries = (tags: Record<string, string | undefined>) =>
  Object.entries(tags).flatMap(([k, v]) => (v === undefined ? [] : [{ k, v }]));
describe('图外设施可复用的节点权限查询', () => {
  it.each(cases.cases)('$id与构图准入保持一致', (c) => {
    const tags = entries(c.tags),
      mode = c.mode as TravelMode;
    const decision = evaluateNodeAccess(tags, mode);
    expect(decision.checked).toBe(true);
    expect(decision.allowed).toBe(c.proposed === 'allow');
    const topology = buildModalTopology(
      new Map<number, [number, number]>([
        [1, [30, 114]],
        [2, [30, 114.001]],
      ]),
      [{ id: 10, highway: 'residential', nds: [1, 2], tags: {} }],
      mode,
      new Map([[2, tags]]),
    );
    if (decision.allowed) expect(topology.nodeAccess.excludedNodes).toEqual([]);
    else
      expect(topology.nodeAccess.excludedNodes).toEqual([{ nodeId: 2, reason: decision.reason }]);
  });
  it('没有完整标签证据与已确认无标签不同，未知模式拒绝', () => {
    expect(evaluateNodeAccess(undefined, 'walk')).toEqual({
      checked: false,
      allowed: false,
      reason: 'node-tags-unavailable',
    });
    expect(evaluateNodeAccess([], 'walk')).toEqual({ checked: true, allowed: true });
    expect(() => evaluateNodeAccess([], 'all' as TravelMode)).toThrow('未知交通模式');
  });
  it('图外permit设施不依赖excludedNodes即可拒绝，模式覆盖与输入不变', () => {
    const tags = entries({
      amenity: 'parking',
      foot: 'permit',
      motor_vehicle: 'permit',
      bicycle: 'yes',
    });
    const before = JSON.stringify(tags);
    expect(evaluateNodeAccess(tags, 'walk')).toEqual({
      checked: true,
      allowed: false,
      reason: 'node-permit-required',
    });
    expect(evaluateNodeAccess(tags, 'car').allowed).toBe(false);
    expect(evaluateNodeAccess(tags, 'bike')).toEqual({ checked: true, allowed: true });
    expect(JSON.stringify(tags)).toBe(before);
  });
});
