/** 道路相对于原始节点序列的方向；unsupported 表示需另行处理。 */
export type RoadDirection = 'forward' | 'reverse' | 'both' | 'unsupported';

/**
 * 根据 OSM 道路标签判断基础通行方向，不修改标签或节点顺序。
 * @param tags 道路标签（包括 highway、oneway、junction）。
 * @returns 原序列正向、反向、双向，或尚未支持的方向规则。
 * @remarks 显式方向优先于 motorway/roundabout 默认；条件方向和无明确方向的
 * motorway_link 暂不推断。此函数不判断车辆准入或步行、自行车例外。
 */
export function resolveRoadDirection(tags: Readonly<Record<string, string>>): RoadDirection {
  if (tags['oneway:conditional'] !== undefined) return 'unsupported';

  const oneway = tags['oneway'];
  if (oneway !== undefined) {
    switch (oneway) {
      case 'yes':
      case '1':
        return 'forward';
      case '-1':
        return 'reverse';
      case 'no':
      case '0':
        return 'both';
      default:
        return 'unsupported';
    }
  }

  if (tags['highway'] === 'motorway' || tags['junction'] === 'roundabout') return 'forward';
  if (tags['highway'] === 'motorway_link') return 'unsupported';
  return 'both';
}
