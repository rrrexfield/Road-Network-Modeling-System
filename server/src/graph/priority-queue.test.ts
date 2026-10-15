import { describe, expect, it } from 'vitest';
import { PriorityQueue } from './priority-queue.js';

describe('PriorityQueue', () => {
  it('按 key 升序弹出', () => {
    const pq = new PriorityQueue<string>();
    pq.push(5, 'e');
    pq.push(1, 'a');
    pq.push(3, 'c');
    pq.push(2, 'b');
    const out: string[] = [];
    while (pq.size > 0) out.push(pq.pop()!.value);
    expect(out).toEqual(['a', 'b', 'c', 'e']);
  });

  it('push 拒绝非有限 key', () => {
    const pq = new PriorityQueue<number>();
    expect(() => pq.push(NaN, 1)).toThrow();
    expect(() => pq.push(Infinity, 1)).toThrow();
    expect(pq.size).toBe(0);
  });

  it('重复 key 均可弹出', () => {
    const pq = new PriorityQueue<number>();
    pq.push(2, 1);
    pq.push(2, 2);
    pq.push(2, 3);
    expect(pq.pop()!.key).toBe(2);
    expect(pq.pop()!.key).toBe(2);
    expect(pq.pop()!.key).toBe(2);
    expect(pq.pop()).toBeUndefined();
  });

  it('空堆 pop 返回 undefined', () => {
    const pq = new PriorityQueue<number>();
    expect(pq.pop()).toBeUndefined();
    expect(pq.size).toBe(0);
  });
});
