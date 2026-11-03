import { describe, expect, it } from 'vitest';
import { extractTransferPoints } from '../io/index';
import { inspectTransferEntrances } from './index';

const tags = (t: Record<string, string>) => Object.entries(t).map(([k, v]) => ({ k, v }));
function fixture() {
  return {
    nodes: [
      { id: 1, lat: 30, lon: 114, tags: tags({ entrance: 'yes' }) },
      { id: 2, lat: 30.001, lon: 114.001, tags: [] },
      { id: 3, lat: 30.002, lon: 114, tags: [] },
    ],
    ways: [{ id: 10, nds: [1, 2, 3, 1], tags: tags({ amenity: 'parking' }) }],
  };
}
const graph = new Map<number, [number, number]>([
  [1, [30, 114]],
  [2, [30.001, 114.001]],
]);
describe('inspectTransferEntrances', () => {
  it('返回原边界上的显式入口与共享节点，不返回区域中心', () => {
    const raw = fixture();
    const report = inspectTransferEntrances(extractTransferPoints(raw), raw, {
      car: graph,
      walk: graph,
    });
    expect(report.entrances.map((e) => [e.nodeId, e.evidence, e.modes])).toEqual([
      [1, 'tagged-entrance', ['car', 'walk']],
      [2, 'shared-boundary-node', ['car', 'walk']],
    ]);
    expect(report.entrances.every((e) => e.requiresReview)).toBe(true);
    expect(report.issues).toEqual([]);
  });
  it('入口可只接步行图，不伪造与汽车的连接', () => {
    const raw = fixture();
    const report = inspectTransferEntrances(extractTransferPoints(raw), raw, {
      car: new Map(),
      walk: graph,
    });
    expect(report.entrances[0]?.modes).toEqual(['walk']);
    expect(
      report.issues.some((i) => i.mode === 'car' && i.reason === 'entrance-not-on-mode-graph'),
    ).toBe(true);
  });
  it('围墙或禁入的边界节点不因几何共享而被认作入口', () => {
    const raw = fixture();
    raw.nodes[0]!.tags = tags({ entrance: 'yes', barrier: 'wall' });
    raw.nodes[1]!.tags = tags({ access: 'no' });
    const report = inspectTransferEntrances(extractTransferPoints(raw), raw, {
      car: graph,
      walk: graph,
    });
    expect(report.entrances).toEqual([]);
    expect(report.issues.at(-1)?.reason).toBe('no-supported-entrance-evidence');
  });
  it('没有道路共享证据时只保留显式入口并报告空模式', () => {
    const raw = fixture();
    const report = inspectTransferEntrances(extractTransferPoints(raw), raw, {
      car: new Map(),
      walk: new Map(),
    });
    expect(report.entrances).toHaveLength(1);
    expect(report.entrances[0]?.modes).toEqual([]);
    expect(report.issues).toHaveLength(2);
  });
  it('节点坐标变化不按ID默默恢复连接，特定模式禁止也会报告', () => {
    const raw = fixture();
    raw.nodes[0]!.tags = tags({ entrance: 'yes', foot: 'no' });
    const report = inspectTransferEntrances(extractTransferPoints(raw), raw, {
      car: new Map([[1, [31, 114]]]),
      walk: graph,
    });
    expect(report.entrances[0]?.modes).toEqual([]);
    expect(report.issues.some((i) => i.reason === 'source-geometry-changed')).toBe(true);
    expect(report.issues.some((i) => i.reason === 'mode-access-unresolved')).toBe(true);
  });
});
