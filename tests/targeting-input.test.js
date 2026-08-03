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

function pointer(pointerId, x, y, { pointerType = 'touch', type = 'pointermove', button = 0 } = {}) {
  return {
    pointerId,
    pointerType,
    type,
    button,
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

  it('routes the lower-quarter boundary to formation dragging on touch and mouse', () => {
    for (const pointerType of ['touch', 'mouse']) {
      const element = createElement();
      const onFormationStart = vi.fn(() => ({ dragging: true }));
      const onTargetStart = vi.fn(() => ({ firing: true }));
      const onFormationEnd = vi.fn();
      new TargetingInput({
        element,
        toWorld: (x, y) => ({ x, y }),
        isFormationPoint: ({ y }) => y <= -35.5,
        onFormationStart,
        onFormationMove: vi.fn(),
        onFormationEnd,
        onTargetStart,
        onTargetMove: vi.fn(),
        onTargetEnd: vi.fn(),
      });

      element.listeners.get('pointerdown')(pointer(11, 4, -35.5, { pointerType, type: 'pointerdown' }));
      element.listeners.get('pointercancel')(pointer(11, 4, -35.5, { pointerType, type: 'pointercancel' }));

      expect(onFormationStart).toHaveBeenCalledTimes(1);
      expect(onTargetStart).not.toHaveBeenCalled();
      expect(onFormationEnd).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cancelled: true }));
    }
  });

  it('routes a start just above the boundary to flagship targeting', () => {
    const element = createElement();
    const onTargetStart = vi.fn(() => ({ firing: true }));
    new TargetingInput({
      element,
      toWorld: (x, y) => ({ x, y }),
      isFormationPoint: ({ y }) => y <= -35.5,
      onFormationStart: vi.fn(() => ({ dragging: true })),
      onFormationMove: vi.fn(),
      onFormationEnd: vi.fn(),
      onTargetStart,
      onTargetMove: vi.fn(),
      onTargetEnd: vi.fn(),
    });

    element.listeners.get('pointerdown')(pointer(12, 0, -35.49, { type: 'pointerdown' }));
    expect(onTargetStart).toHaveBeenCalledWith({ x: 0, y: -35.49 });
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
