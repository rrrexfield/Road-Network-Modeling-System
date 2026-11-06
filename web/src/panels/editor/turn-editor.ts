import type { IntersectionTurns, TravelMode } from '@gisalgo/shared';
import { fetchIntersectionTurns, setIntersectionTurns } from '../../api-client.js';
import { travelModeLabel, type DisplayMode } from '../../map/mode-control-model.js';
import {
  forbiddenPairs,
  turnDescription,
  turnKindLabel,
  turnPairKey,
} from './turn-editor-model.js';
import './turn-editor.css';

const SAMPLE_NODE_ID = 1881981626;

export interface TurnEditorHandle {
  element: HTMLElement;
  setMode(mode: DisplayMode | null): void;
  dispose(): void;
}

export interface TurnEditorOptions {
  getMode: () => DisplayMode | null;
  getRoadName: (wayId: number) => string;
  onIntersectionFocus: (intersection: IntersectionTurns) => void;
  onRestrictionChange: (intersection: IntersectionTurns | null) => void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createTurnEditor(options: TurnEditorOptions): TurnEditorHandle {
  const root = element('section', 'turn-editor is-collapsed');
  const head = element('button', 'turn-editor__head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');
  const title = element('span', 'turn-editor__title', '路口转向限制');
  const modeBadge = element('span', 'turn-editor__mode', '未选择模式');
  const chevron = element('span', 'turn-editor__chevron', '▸');
  head.append(title, modeBadge, chevron);

  const body = element('div', 'turn-editor__body');
  const controls = element('div', 'turn-editor__controls');
  const nodeInput = element('input', 'turn-editor__node');
  nodeInput.type = 'number';
  nodeInput.inputMode = 'numeric';
  nodeInput.value = String(SAMPLE_NODE_ID);
  nodeInput.placeholder = '路口 Node ID';
  const sampleButton = element('button', 'turn-editor__button', '五路口示例');
  sampleButton.type = 'button';
  const loadButton = element('button', 'turn-editor__button is-primary', '加载路口');
  loadButton.type = 'button';
  controls.append(nodeInput, sampleButton, loadButton);

  const status = element('p', 'turn-editor__status', '请选择交通模式后加载路口');
  const list = element('div', 'turn-editor__list');
  const footer = element('div', 'turn-editor__footer');
  const summary = element('span', 'turn-editor__summary', '尚未加载');
  const actions = element('div', 'turn-editor__actions');
  const clearButton = element('button', 'turn-editor__button', '清空选择');
  clearButton.type = 'button';
  clearButton.title = '取消当前路口的全部勾选，保存后生效';
  clearButton.disabled = true;
  const saveButton = element('button', 'turn-editor__button is-save', '保存禁转');
  saveButton.type = 'button';
  saveButton.disabled = true;
  actions.append(clearButton, saveButton);
  footer.append(summary, actions);
  body.append(controls, status, list, footer);
  root.append(head, body);

  let mode: DisplayMode | null | undefined;
  let current: IntersectionTurns | null = null;
  let baseline = new Set<string>();
  let pending = new Set<string>();
  let checkboxes = new Map<string, HTMLInputElement>();
  let busy = false;

  function activeMode(): TravelMode | null {
    return mode !== null && mode !== undefined && mode !== 'all' ? mode : null;
  }

  function setCollapsed(collapsed: boolean): void {
    root.classList.toggle('is-collapsed', collapsed);
    head.setAttribute('aria-expanded', String(!collapsed));
    chevron.textContent = collapsed ? '▸' : '▾';
  }

  function setStatus(text: string, state?: 'ok' | 'pending' | 'error'): void {
    status.textContent = text;
    if (state === undefined) delete status.dataset.state;
    else status.dataset.state = state;
  }

  function clearData(message = '请选择交通模式后加载路口'): void {
    current = null;
    baseline = new Set();
    pending = new Set();
    checkboxes = new Map();
    list.replaceChildren();
    summary.textContent = '尚未加载';
    clearButton.disabled = true;
    saveButton.disabled = true;
    setStatus(message);
    options.onRestrictionChange(null);
  }

  function syncDirty(): void {
    const dirty =
      current !== null &&
      !(pending.size === baseline.size && [...pending].every((key) => baseline.has(key)));
    saveButton.disabled = activeMode() === null || busy || current === null || !dirty;
    clearButton.disabled = activeMode() === null || busy || current === null || pending.size === 0;
    summary.textContent =
      current === null ? '尚未加载' : `${pending.size} 条禁转${dirty ? '（未保存）' : ''}`;
  }

  function restrictionPreview(): IntersectionTurns | null {
    if (current === null) return null;
    return {
      ...current,
      turns: current.turns.map((turn) => ({
        ...turn,
        forbidden: pending.has(turnPairKey(turn)),
      })),
    };
  }

  function renderTurns(data: IntersectionTurns): void {
    list.replaceChildren();
    checkboxes = new Map();
    for (const turn of data.turns) {
      const key = turnPairKey(turn);
      const row = element('label', 'turn-editor__row');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'turn-editor__check';
      checkbox.checked = turn.forbidden;
      checkboxes.set(key, checkbox);

      const text = element('span', 'turn-editor__copy');
      text.append(
        element('strong', 'turn-editor__kind', turnKindLabel(turn.turnKind)),
        element('span', 'turn-editor__route', turnDescription(turn, options.getRoadName)),
      );
      const source = element(
        'span',
        `turn-editor__source${turn.fromOsm ? ' is-osm' : ''}`,
        turn.fromOsm ? 'OSM' : '手动',
      );
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) pending.add(key);
        else pending.delete(key);
        row.classList.toggle('is-forbidden', checkbox.checked);
        options.onRestrictionChange(restrictionPreview());
        syncDirty();
      });
      row.classList.toggle('is-forbidden', checkbox.checked);
      row.append(checkbox, text, source);
      list.append(row);
    }
  }

  async function load(nodeId: number): Promise<void> {
    const requestMode = activeMode();
    if (requestMode === null) {
      setStatus('“全量”模式没有统一的转向表，请先选择具体交通模式', 'error');
      return;
    }
    if (!Number.isSafeInteger(nodeId) || nodeId <= 0) {
      setStatus('请输入有效的路口 Node ID', 'error');
      return;
    }

    busy = true;
    loadButton.disabled = true;
    sampleButton.disabled = true;
    setStatus(`正在加载路口 ${nodeId}…`, 'pending');
    try {
      const data = await fetchIntersectionTurns(nodeId, requestMode);
      current = data;
      baseline = new Set(forbiddenPairs(data.turns).map(turnPairKey));
      pending = new Set(baseline);
      renderTurns(data);
      summary.textContent = `${data.turns.length} 个转向 · ${pending.size} 条禁转`;
      setStatus(`已加载路口 ${data.nodeId}`, 'ok');
      options.onIntersectionFocus(data);
      options.onRestrictionChange(data);
    } catch (error) {
      clearData(error instanceof Error ? error.message : '路口加载失败');
      status.dataset.state = 'error';
    } finally {
      busy = false;
      loadButton.disabled = activeMode() === null;
      sampleButton.disabled = activeMode() === null;
      syncDirty();
    }
  }

  async function save(): Promise<void> {
    const requestMode = activeMode();
    if (requestMode === null || current === null || busy) return;
    busy = true;
    saveButton.disabled = true;
    loadButton.disabled = true;
    setStatus('正在保存整个路口的禁转集合…', 'pending');
    const result = await setIntersectionTurns(
      current.nodeId,
      forbiddenPairs(
        current.turns.map((turn) => ({
          ...turn,
          forbidden: pending.has(turnPairKey(turn)),
        })),
      ),
      requestMode,
    );
    busy = false;
    loadButton.disabled = activeMode() === null;
    if (!result.ok) {
      options.onRestrictionChange(current);
      setStatus(
        result.reason === 'restore-mismatch'
          ? `禁转快照失配，禁止覆盖：${result.message}`
          : result.message,
        'error',
      );
      syncDirty();
      return;
    }

    const updated = restrictionPreview();
    if (updated === null) return;
    current = updated;
    baseline = new Set(pending);
    options.onRestrictionChange(updated);
    summary.textContent = `${updated.turns.length} 个转向 · ${pending.size} 条禁转`;
    setStatus(`已保存 ${result.restrictionCount} 条禁转`, 'ok');
    syncDirty();
  }

  function setMode(nextMode: DisplayMode | null): void {
    if (mode === nextMode) return;
    mode = nextMode;
    const available = activeMode() !== null;
    modeBadge.textContent = mode === null || mode === 'all' ? '全量模式' : travelModeLabel(mode);
    nodeInput.disabled = !available;
    loadButton.disabled = !available;
    sampleButton.disabled = !available;
    clearData(available ? '输入路口 Node ID 后加载' : '请选择汽车、步行、骑行或公交模式');
  }

  head.addEventListener('click', () => {
    setCollapsed(!root.classList.contains('is-collapsed'));
  });
  sampleButton.addEventListener('click', () => {
    nodeInput.value = String(SAMPLE_NODE_ID);
    void load(SAMPLE_NODE_ID);
  });
  loadButton.addEventListener('click', () => void load(Number(nodeInput.value)));
  nodeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void load(Number(nodeInput.value));
  });
  clearButton.addEventListener('click', () => {
    if (current === null || busy) return;
    pending.clear();
    for (const [key, checkbox] of checkboxes) {
      checkbox.checked = false;
      checkbox.closest('.turn-editor__row')?.classList.remove('is-forbidden');
      pending.delete(key);
    }
    options.onRestrictionChange(restrictionPreview());
    syncDirty();
  });
  saveButton.addEventListener('click', () => void save());

  setMode(options.getMode());
  return {
    element: root,
    setMode,
    dispose: () => {
      root.remove();
      options.onRestrictionChange(null);
    },
  };
}
