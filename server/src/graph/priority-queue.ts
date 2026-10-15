/**
 * 二叉最小堆优先队列，供 Dijkstra 使用。
 * 采用惰性删除：调用方以 settled 集合跳过过期条目，因此无需 decrease-key。
 */
export interface QueueEntry<T> {
  key: number;
  value: T;
}

export class PriorityQueue<T> {
  private heap: QueueEntry<T>[] = [];

  get size(): number {
    return this.heap.length;
  }

  /** 入队；key 必须为有限数（NaN/Infinity 会破坏堆序），否则抛错。 */
  push(key: number, value: T): void {
    if (!Number.isFinite(key)) throw new Error(`push key 非法: ${key}`);
    this.heap.push({ key, value });
    this.siftUp(this.heap.length - 1);
  }

  /** 弹出并返回 key 最小的条目；空堆返回 undefined。 */
  pop(): QueueEntry<T> | undefined {
    const last = this.heap.pop();
    if (this.heap.length === 0) return last;
    const top = this.heap[0]!;
    this.heap[0] = last!;
    this.siftDown(0);
    return top;
  }

  private siftUp(i: number): void {
    const heap = this.heap;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent]!.key <= heap[i]!.key) break;
      const t = heap[parent]!;
      heap[parent] = heap[i]!;
      heap[i] = t;
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const heap = this.heap;
    const n = heap.length;
    for (;;) {
      let smallest = i;
      const left = i * 2 + 1;
      const right = left + 1;
      if (left < n && heap[left]!.key < heap[smallest]!.key) smallest = left;
      if (right < n && heap[right]!.key < heap[smallest]!.key) smallest = right;
      if (smallest === i) break;
      const t = heap[smallest]!;
      heap[smallest] = heap[i]!;
      heap[i] = t;
      i = smallest;
    }
  }
}
