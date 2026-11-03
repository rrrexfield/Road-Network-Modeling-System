import type { RoadEdge, TravelMode, TurnRestriction, TurnRestrictionType } from '@gisalgo/shared';
import type { OsmRelation } from '../io/index.js';

const types = new Set<string>([
  'no_left_turn',
  'no_right_turn',
  'no_u_turn',
  'no_straight_on',
  'only_left_turn',
  'only_right_turn',
  'only_u_turn',
  'only_straight_on',
]);
const modeNames: Record<TravelMode, string[]> = {
  car: ['motorcar', 'motor_vehicle', 'vehicle'],
  bus: ['bus', 'psv', 'motor_vehicle', 'vehicle'],
  bike: ['bicycle', 'vehicle'],
  walk: ['foot'],
};

/** 将via-node关系解析成当前图禁转边对；only_*展开为禁止其他出口，不猜测via-way或歧义。 */
export function importOsmRestrictions(
  relations: readonly OsmRelation[],
  edges: readonly RoadEdge[],
  mode: TravelMode = 'car',
): {
  restrictions: TurnRestriction[];
  provenance: { restrictionId: number; relationId: number }[];
  issues: { relationId: number; reason: string }[];
  ignored: { relationId: number; reason: string }[];
} {
  const incoming = new Map<string, RoadEdge[]>();
  const outgoing = new Map<number, RoadEdge[]>();
  for (const edge of edges) {
    const k = `${edge.to}:${edge.wayId}`;
    const ins = incoming.get(k) ?? [];
    ins.push(edge);
    incoming.set(k, ins);
    const outs = outgoing.get(edge.from) ?? [];
    outs.push(edge);
    outgoing.set(edge.from, outs);
  }
  const result: ReturnType<typeof importOsmRestrictions> = {
    restrictions: [],
    provenance: [],
    issues: [],
    ignored: [],
  };
  for (const relation of relations) {
    const tags = Object.fromEntries(relation.tags.map((t) => [t.k, t.v]));
    if (tags.type !== 'restriction') continue;
    const ignored = (reason: string) => result.ignored.push({ relationId: relation.id, reason });
    const issue = (reason: string) => result.issues.push({ relationId: relation.id, reason });
    const keys = modeNames[mode].map((n) => `restriction:${n}`);
    const kind =
      keys.map((k) => tags[k]).find((v) => v !== undefined) ??
      (mode === 'walk' ? undefined : tags.restriction);
    if (
      [...(mode === 'walk' ? [] : ['restriction']), ...keys].some(
        (k) => tags[`${k}:conditional`] !== undefined,
      )
    ) {
      issue('conditional-restriction');
      continue;
    }
    if (kind === undefined) {
      ignored('not-applicable-to-mode');
      continue;
    }
    if (
      (tags.except ?? '')
        .split(';')
        .map((s) => s.trim())
        .some((s) => modeNames[mode].includes(s))
    ) {
      ignored('mode-exception');
      continue;
    }
    if (['restriction', ...keys].some((k) => tags[`${k}:conditional`] !== undefined)) {
      issue('conditional-restriction');
      continue;
    }
    if (!types.has(kind)) {
      issue('unsupported-restriction-type');
      continue;
    }
    const members = (role: string) => relation.members.filter((m) => m.role === role);
    const fromMembers = members('from'),
      toMembers = members('to'),
      via = members('via');
    if (
      fromMembers.length !== 1 ||
      toMembers.length !== 1 ||
      via.length !== 1 ||
      fromMembers[0]!.type !== 'way' ||
      toMembers[0]!.type !== 'way' ||
      via[0]!.type !== 'node'
    ) {
      issue('unsupported-or-invalid-members');
      continue;
    }
    const node = via[0]!.ref;
    const ins = incoming.get(`${node}:${fromMembers[0]!.ref}`) ?? [];
    const outs = outgoing.get(node) ?? [];
    let candidates = ins.flatMap((from) =>
      outs.filter((to) => to.wayId === toMembers[0]!.ref).map((to) => ({ from, to })),
    );
    if (fromMembers[0]!.ref === toMembers[0]!.ref) {
      if (kind.endsWith('u_turn')) candidates = candidates.filter((p) => p.to.to === p.from.from);
      else if (kind.endsWith('straight_on'))
        candidates = candidates.filter((p) => p.to.to !== p.from.from);
    }
    if (candidates.length !== 1) {
      issue(candidates.length ? 'ambiguous-edge-pair' : 'missing-edge-pair');
      continue;
    }
    const target = candidates[0]!;
    const prohibited = kind.startsWith('only_')
      ? outs.filter((e) => e.id !== target.to.id)
      : [target.to];
    for (const to of prohibited) {
      const id = result.restrictions.length;
      result.restrictions.push({
        id,
        viaNode: node,
        fromEdge: target.from.id,
        toEdge: to.id,
        type: kind as TurnRestrictionType,
        source: 'osm',
      });
      result.provenance.push({ restrictionId: id, relationId: relation.id });
    }
  }
  return result;
}
