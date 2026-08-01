import { describe, expect, it, vi } from 'vitest';
import { TargetingInput } from '../src/input/TargetingInput.js';

function setup() {
  const listeners = new Map();
  const element = {
    addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
    removeEventListener: vi.fn((type) => listeners.delete(type)),
  };
  const onPointerChange = vi.fn();
  const onTarget = vi.fn(() => ({ fired: false }));
  const input = new TargetingInput({
    element,
    toWorld: (clientX, clientY) => ({ x: clientX / 2, y: clientY / 2 }),
    onTarget,
    onPointerChange,
  });
  return { input, listeners, onPointerChange, onTarget };
}

describe('TargetingInput pointer indicator', () => {
  it('follows mouse movement and hides when the pointer leaves', () => {
    const { listeners, onPointerChange } = setup();
    listeners.get('pointermove')({ clientX: 120, clientY: 80, pointerType: 'mouse' });
    listeners.get('pointerleave')({ pointerType: 'mouse' });

    expect(onPointerChange).toHaveBeenNthCalledWith(1, {
      clientX: 120, clientY: 80, pointerType: 'mouse', visible: true,
    });
    expect(onPointerChange).toHaveBeenNthCalledWith(2, {
      clientX: 120, clientY: 80, pointerType: 'mouse', visible: false,
    });
  });

  it('keeps the last touch target visible until targeting is disabled', () => {
    const { input, listeners, onPointerChange, onTarget } = setup();
    listeners.get('pointerdown')({
      clientX: 200, clientY: 320, pointerType: 'touch', button: 0, preventDefault: vi.fn(),
    });
    listeners.get('pointerleave')({ pointerType: 'touch' });

    expect(onTarget).toHaveBeenCalledWith({ x: 100, y: 160 });
    expect(onPointerChange).toHaveBeenLastCalledWith({
      clientX: 200, clientY: 320, pointerType: 'touch', visible: true,
    });

    input.setEnabled(false);
    expect(onPointerChange).toHaveBeenLastCalledWith({
      clientX: 200, clientY: 320, pointerType: 'touch', visible: false,
    });
  });

  it('removes every registered pointer listener when destroyed', () => {
    const { input, listeners } = setup();
    input.destroy();
    expect(listeners.size).toBe(0);
  });
});
