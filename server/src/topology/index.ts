export { resolveRoadDirection, type RoadDirection } from './direction.js';
export {
  CompressionWayIndex,
  collectCompressionProtectedNodes,
  type CompressionWayAttributes,
  type CompressionProtectedNodesInput,
} from './compression-input.js';
export { TurnRestrictionTable } from './turn-restriction-table.js';
export { computeTurnGeometry } from './turn-geometry.js';
export { IntersectionTurnIndex } from './intersection-turns.js';
export { classifyTurnRestrictions } from './restriction-types.js';
export { importOsmRestrictions } from './osm-restrictions.js';
export { diagnoseStructureConflicts, type StructureConflict } from './structure-diagnostics.js';
export { buildModalTopology, type ModalTopologyResult } from './modal-topology.js';
export type { NodeTags, NodeAccessReport } from './node-access.js';
export { matchTransferConnections, type TransferConnectionReport } from './transfer-connections.js';
export { inspectTransferEntrances, type TransferEntranceReport } from './transfer-entrances.js';
export {
  buildTransferAttachments,
  computeTransferPenalty,
  type TransferAttachmentReview,
  type TransferAttachment,
  type TransferAttachmentIndex,
} from './transfer-attachments.js';
export { createTopologyReport, type TopologyReport } from './topology-report.js';
export {
  buildTopology,
  type TopologyWay,
  type TopologyIssue,
  type TopologyResult,
} from './build-topology.js';
