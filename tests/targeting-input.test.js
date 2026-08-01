import { describe, expect, it, vi } from 'vitest';
import { TargetingInput } from '../src/input/TargetingInput.js';

function createElement() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
    removeEventListener: vi.fn((type) => listeners.delete(type)),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  };
}

function pointer(pointerId, x, y) {
  return {
    pointerId,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
    preventDefault: vi.fn(),
  };
}

describe('TargetingInput', () => {
  it('captures one pointer and streams drag directions until release', () => {
    const element = createElement();
    const onStart = vi.fn(() => ({ firing: true }));
    const onMove = vi.fn();
    const onEnd = vi.fn();
    new TargetingInput({
      element,
      toWorld: (x, y) => ({ x, y }),
      onStart,
      onMove,
      onEnd,
    });

    element.listeners.get('pointerdown')(pointer(7, 12, 20));
    element.listeners.get('pointermove')(pointer(7, 18, 24));
    element.listeners.get('pointermove')(pointer(8, 99, 99));
    element.listeners.get('pointerup')(pointer(7, 18, 24));

    expect(onStart).toHaveBeenCalledWith({ x: 12, y: 20 });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ x: 18, y: 24 });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(element.setPointerCapture).toHaveBeenCalledWith(7);
    expect(element.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('ends active firing when targeting becomes disabled', () => {
    const element = createElement();
    const onEnd = vi.fn();
    const input = new TargetingInput({
      element,
      toWorld: () => ({ x: 0, y: 0 }),
      onStart: () => ({ firing: true }),
      onMove: vi.fn(),
      onEnd,
    });

    element.listeners.get('pointerdown')(pointer(3, 0, 0));
    input.setEnabled(false);

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(element.releasePointerCapture).toHaveBeenCalledWith(3);
  });
});
