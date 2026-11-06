import type { TravelMode } from '@gisalgo/shared';
import { buildModalTopology } from '../topology/index.js';
import { loadNetwork } from './loader.js';
import { PersistentTurnService } from './persistent-turn-service.js';

/** A可直接调用：严格检查派生数据版本、模式构图、OSM导入与SQLite启动恢复。 */
export function createTurnRuntime(
  derivedFile: URL,
  options: {
    databasePath: string;
    dataset: string;
    mode: TravelMode;
  },
) {
  const network = loadNetwork(derivedFile);
  if (network.dataWarnings.length) throw new Error(network.dataWarnings.join('; '));
  const modal = buildModalTopology(network.nodes, network.ways, options.mode, network.nodeTags);
  const service = new PersistentTurnService(modal.topology, {
    ...options,
    dataset: `${options.dataset}:${options.mode}`,
    relations: network.relations,
  });
  return { network, modal, service };
}
