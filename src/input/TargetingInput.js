export class TargetingInput {
  constructor({ element, toWorld, onTarget, onPointerChange = () => {} }) {
    this.element = element;
    this.toWorld = toWorld;
    this.onTarget = onTarget;
    this.onPointerChange = onPointerChange;
    this.enabled = true;
    this.pointerInside = false;
    this.lastPointer = null;
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.element.addEventListener('pointerdown', this.handlePointerDown, { passive: false });
    this.element.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    this.element.addEventListener('pointerleave', this.handlePointerLeave, { passive: true });
  }

  handlePointerDown(event) {
    if (!this.enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    this.rememberPointer(event, true);
    const worldPoint = this.toWorld(event.clientX, event.clientY);
    if (!worldPoint) return;

    const result = this.onTarget(worldPoint);
    if (result?.fired && globalThis.navigator?.vibrate) globalThis.navigator.vibrate(18);
  }

  handlePointerMove(event) {
    if (!this.enabled || event.pointerType === 'touch') return;
    this.pointerInside = true;
    this.rememberPointer(event, true);
  }

  handlePointerLeave(event) {
    if (event.pointerType === 'touch') return;
    this.pointerInside = false;
    if (this.lastPointer) this.onPointerChange({ ...this.lastPointer, visible: false });
  }

  rememberPointer(event, visible) {
    this.lastPointer = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: event.pointerType || 'mouse',
    };
    if (this.lastPointer.pointerType !== 'touch') this.pointerInside = true;
    this.onPointerChange({ ...this.lastPointer, visible });
  }

  setEnabled(enabled) {
    const nextEnabled = Boolean(enabled);
    if (nextEnabled === this.enabled) return;
    this.enabled = nextEnabled;
    if (!this.lastPointer) return;
    const persistentTouch = this.lastPointer.pointerType === 'touch';
    this.onPointerChange({
      ...this.lastPointer,
      visible: nextEnabled && (persistentTouch || this.pointerInside),
    });
  }

  destroy() {
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerleave', this.handlePointerLeave);
  }
}
