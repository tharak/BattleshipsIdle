import { describe, expect, it } from 'vitest';
import { TargetingIndicator } from '../src/ui/TargetingIndicator.js';

function createIndicator() {
  const classes = new Set();
  const chargeRing = { style: {} };
  const element = {
    hidden: true,
    offsetWidth: 52,
    style: {},
    querySelector: () => chargeRing,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
    },
  };
  const container = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 600 }),
  };
  return {
    controller: new TargetingIndicator({ element, container }),
    element,
    chargeRing,
  };
}

describe('TargetingIndicator', () => {
  it('positions at the pointer and renders radial charge progress', () => {
    const { controller, element, chargeRing } = createIndicator();
    controller.setPointer({ clientX: 210, clientY: 320, visible: true });
    controller.setState({ charge: 0.5, active: true });

    expect(element.style.left).toBe('200px');
    expect(element.style.top).toBe('300px');
    expect(element.hidden).toBe(false);
    expect(Number(chargeRing.style.strokeDashoffset)).toBeCloseTo(Math.PI * 20);
  });

  it('shows a ready state, resets immediately after firing, and hides when inactive', () => {
    const { controller, element, chargeRing } = createIndicator();
    controller.setPointer({ clientX: 100, clientY: 100, visible: true });
    controller.setState({ charge: 1, active: true });
    expect(element.classList.contains('is-ready')).toBe(true);

    controller.reflectTargetResult({ fired: true });
    expect(element.classList.contains('is-ready')).toBe(false);
    expect(Number(chargeRing.style.strokeDashoffset)).toBeCloseTo(Math.PI * 40);

    controller.setState({ charge: 0.4, active: false });
    expect(element.hidden).toBe(true);
  });
});
