/**
 * 【离线示例数据】服务端 /api/stats 未就绪时的前端预览夹具。
 *
 * 生成方式:用真实算法 server/src/weights 的 computeNetworkStats 在一张 18×18 合成路网上试算
 * (不是真实城市数据,也不代表任何实际路网规模)。拓扑指标为按 B 的口径离线试算的示例值,
 * 仅用于展示面板在"已接入"状态下的渲染;实时接口在 B 的图引擎合入前返回 topology=null。
 * 若服务端已注册 weights 插件,fetchStats() 会优先使用实时数据,本文件不参与渲染。
 */
import type { NetworkStats } from '../../charts/index.js';

export const SAMPLE_STATS: NetworkStats = {
  nodeCount: 324,
  edgeCount: 1258,
  wayCount: 37,
  totalLengthMeters: 368604.11253426026,
  totalTravelSeconds: 43736.10858249728,
  minEdgeMeters: 268.05587974921775,
  maxEdgeMeters: 410.92407003070764,
  meanEdgeMeters: 293.00803858049306,
  medianEdgeMeters: 311.3457946044339,
  byHighway: [
    {
      highway: 'tertiary',
      edgeCount: 306,
      lengthMeters: 86453.29573722533,
      lengthShare: 0.2345424068734172,
      averageSpeedKmh: 40.00000000000011,
      travelSeconds: 7780.796616350259,
    },
    {
      highway: 'living_street',
      edgeCount: 272,
      lengthMeters: 84686.05613249465,
      lengthShare: 0.2297479958925402,
      averageSpeedKmh: 15.000000000000053,
      travelSeconds: 20324.653471798643,
    },
    {
      highway: 'secondary',
      edgeCount: 238,
      lengthMeters: 69691.04044267342,
      lengthShare: 0.18906745224172158,
      averageSpeedKmh: 50.000000000000085,
      travelSeconds: 5017.754911872477,
    },
    {
      highway: 'primary',
      edgeCount: 204,
      lengthMeters: 59107.64988307289,
      lengthShare: 0.16035537280550302,
      averageSpeedKmh: 60.00000000000023,
      travelSeconds: 3546.4589929843596,
    },
    {
      highway: 'residential',
      edgeCount: 204,
      lengthMeters: 54696.02449160203,
      lengthShare: 0.14838690788214756,
      averageSpeedKmh: 30.000000000000018,
      travelSeconds: 6563.52293899224,
    },
    {
      highway: 'motorway',
      edgeCount: 34,
      lengthMeters: 13970.045847199606,
      lengthShare: 0.03789986430469125,
      averageSpeedKmh: 99.99999999999999,
      travelSeconds: 502.9216504991859,
    },
  ],
  lengthHistogram: [
    {
      label: '0–20 m',
      minMeters: 0,
      maxMeters: 20,
      edgeCount: 0,
    },
    {
      label: '20–50 m',
      minMeters: 20,
      maxMeters: 50,
      edgeCount: 0,
    },
    {
      label: '50–100 m',
      minMeters: 50,
      maxMeters: 100,
      edgeCount: 0,
    },
    {
      label: '100–200 m',
      minMeters: 100,
      maxMeters: 200,
      edgeCount: 0,
    },
    {
      label: '200–500 m',
      minMeters: 200,
      maxMeters: 500,
      edgeCount: 1258,
    },
    {
      label: '500–1000 m',
      minMeters: 500,
      maxMeters: 1000,
      edgeCount: 0,
    },
    {
      label: '≥1000 m',
      minMeters: 1000,
      maxMeters: null,
      edgeCount: 0,
    },
  ],
  topology: {
    nodeCount: 324,
    edgeCount: 1258,
    connectedComponentCount: 1,
    largestComponentSize: 324,
    danglingNodeCount: 0,
    isolatedNodeCount: 0,
    averageDegree: 7.765432098765432,
    degreeDistribution: [
      {
        degree: 2,
        count: 2,
      },
      {
        degree: 3,
        count: 66,
      },
      {
        degree: 4,
        count: 240,
      },
      {
        degree: 6,
        count: 16,
      },
    ],
  },
  topologySource: 'server/src/graph(graph-engine)',
  profile: {
    metric: 'time',
    speedFactor: 1,
    speedOverridesKmh: {},
  },
};
