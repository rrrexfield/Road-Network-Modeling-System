/**
 * api 模块的跨目录公开入口。
 *
 * 只导出多模态运行时: B 的图引擎(issue #28)需要与 REST 层共用同一份禁转服务,
 * 否则编辑器保存的禁转不会立即影响路径结果(磁盘一致、内存分叉)。
 *
 * routes.ts 不在此处 re-export: routes.ts 依赖 graph 模块,若本入口再导出 routes.ts,
 * graph → api/index → routes → graph 会形成循环依赖。routes.ts 由 server/src/index.ts
 * 直接引用,属于 api 模块内部引用。
 */
export {
  createModalRuntimeRegistry,
  getActiveModalRuntimeRegistry,
  isTravelMode,
  setActiveModalRuntimeRegistry,
  TRAVEL_MODES,
  type ModalRuntime,
  type ModalRuntimeOptions,
  type ModalRuntimeRegistry,
} from './modal-runtime.js';
