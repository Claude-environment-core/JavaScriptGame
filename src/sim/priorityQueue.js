/**
 * Binary min-heap with decrease-key ("update") support.
 *
 * Items are addressed by a string key so A* can lower a node's priority when a
 * cheaper route to it is discovered instead of pushing duplicates.
 *
 * Ties keep insertion order: entries carry a monotonically increasing sequence
 * number that breaks equal priorities, which makes expansion order — and
 * therefore the produced path — deterministic.
 */
export class PriorityQueue {
  constructor() {
    this.heap = [];
    this.indexByKey = new Map();
    this.sequence = 0;
  }

  get size() {
    return this.heap.length;
  }

  isEmpty() {
    return this.heap.length === 0;
  }

  has(key) {
    return this.indexByKey.has(key);
  }

  /** Inserts a new item, or lowers an existing item's priority. */
  enqueue(key, value, priority) {
    const existingIndex = this.indexByKey.get(key);

    if (existingIndex === undefined) {
      const entry = { key, value, priority, sequence: this.sequence };
      this.sequence += 1;
      this.heap.push(entry);
      this.indexByKey.set(key, this.heap.length - 1);
      this.siftUp(this.heap.length - 1);
      return;
    }

    this.update(key, priority);
  }

  /** Lowers the priority of a queued item. Higher priorities are ignored. */
  update(key, priority) {
    const index = this.indexByKey.get(key);
    if (index === undefined || priority >= this.heap[index].priority) {
      return;
    }

    this.heap[index].priority = priority;
    this.siftUp(index);
  }

  dequeue() {
    if (this.heap.length === 0) {
      return null;
    }

    const top = this.heap[0];
    const last = this.heap.pop();
    this.indexByKey.delete(top.key);

    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.indexByKey.set(last.key, 0);
      this.siftDown(0);
    }

    return top.value;
  }

  isHigherPriority(a, b) {
    if (a.priority !== b.priority) {
      return a.priority < b.priority;
    }

    return a.sequence < b.sequence;
  }

  siftUp(startIndex) {
    let index = startIndex;

    while (index > 0) {
      const parent = (index - 1) >> 1;

      if (!this.isHigherPriority(this.heap[index], this.heap[parent])) {
        break;
      }

      this.swap(index, parent);
      index = parent;
    }
  }

  siftDown(startIndex) {
    let index = startIndex;
    const length = this.heap.length;

    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;

      if (left < length && this.isHigherPriority(this.heap[left], this.heap[best])) {
        best = left;
      }

      if (right < length && this.isHigherPriority(this.heap[right], this.heap[best])) {
        best = right;
      }

      if (best === index) {
        break;
      }

      this.swap(index, best);
      index = best;
    }
  }

  swap(a, b) {
    const temp = this.heap[a];
    this.heap[a] = this.heap[b];
    this.heap[b] = temp;
    this.indexByKey.set(this.heap[a].key, a);
    this.indexByKey.set(this.heap[b].key, b);
  }
}
