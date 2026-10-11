`wuhan.json` 与原 `hubei.json` 结构完全一致，顶层是 3 个数组：

```json
{
  "source_file": "hubei-260926.osm.pbf (clipped to Wuhan by wuhan_shp/Wuhan.shp)",
  "nodes":      [ ... 1,924,603 条 ... ],
  "ways":       [ ...   183,056 条 ... ],
  "relations":  [ ...    1,471 条 ... ]
}
```

**node**（坐标点）

```json
{"id": 8209311376, "lat": 30.7319452, "lon": 114.4047791, "tags": []}
```

- `id`：OSM 节点 ID，全文件唯一
- `lat` / `lon`：WGS84 经纬度
- `tags`：属性键值对数组，普通几何节点为空 `[]`

**way**（道路/线要素，由节点引用组成）

```json
{
  "id": 947969492,
  "nds": [8774459296, 8774459295, 8774459293, ...],
  "tags": [{"k": "highway", "v": "unclassified"}, {"k": "source", "v": "Maxar Premium Imagery"}]
}
```

- `id`：OSM way ID
- `nds`：有序节点 ID 列表，按顺序连接构成折线；相邻两点构成一条路段（边）
- `tags`：属性数组，每项 `{"k": 键, "v": 值}`，道路类型看 `k="highway"` 的项（如 `motorway`/`primary`/`residential`）

**relation**（关系，要素的分组）

```json
{
  "id": ...,
  "members": [{"type": "way", "ref": 1426162961, "role": "outer"}, {"type": "node", "ref": 9933834006, "role": "admin_centre"}],
  "tags": [{"k": "boundary", "v": "administrative"}, ...]
}
```

- `members`：成员引用，`type` 为 `node`/`way`/`relation`，`ref` 指向对应要素 ID，`role` 是成员在关系中的角色
- 裁剪时成员表已过滤，只保留指向武汉范围内要素的引用

做路网拓扑构建时，主要用 `nodes`（id → 坐标）和 `ways`（nds 连成边），`relations` 一般用不到。