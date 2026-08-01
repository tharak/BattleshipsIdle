export class ObjectPool {
  constructor({ create, reset = () => {}, initialSize = 0 }) {
    this.create = create;
    this.reset = reset;
    this.available = [];
    this.active = new Set();

    for (let index = 0; index < initialSize; index += 1) {
      this.available.push(this.create());
    }
  }

  acquire() {
    const item = this.available.pop() ?? this.create();
    this.active.add(item);
    return item;
  }

  release(item) {
    if (!this.active.delete(item)) return;
    this.reset(item);
    this.available.push(item);
  }

  releaseAll() {
    for (const item of [...this.active]) this.release(item);
  }
}
