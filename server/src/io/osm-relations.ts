/** 原始OSM关系，仅供IO/拓扑内部使用，不是新增API契约。 */
export interface OsmRelation {
  id: number;
  members: { type: string; ref: number; role: string }[];
  tags: { k: string; v: string }[];
}
