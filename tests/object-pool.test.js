import { describe, expect, it } from 'vitest';
import { ObjectPool } from '../src/rendering/ObjectPool.js';

describe('ObjectPool', () => {
  it('resets and reuses released objects', () => {
    let created = 0;
    const pool = new ObjectPool({
      create: () => ({ id: ++created, visible: true }),
      reset: (item) => {
        item.visible = false;
      },
    });

    const first = pool.acquire();
    pool.release(first);
    const second = pool.acquire();

    expect(second).toBe(first);
    expect(second.visible).toBe(false);
    expect(created).toBe(1);
  });
});
