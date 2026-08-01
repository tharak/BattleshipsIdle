export class TargetingInput {
  constructor({ element, toWorld, onStart, onMove, onEnd }) {
    this.element = element;
    this.toWorld = toWorld;
    this.onStart = onStart;
    this.onMove = onMove;
    this.onEnd = onEnd;
    this.enabled = true;
    this.activePointerId = null;
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerEnd = this.handlePointerEnd.bind(this);
    this.element.addEventListener('pointerdown', this.handlePointerDown, { passive: false });
    this.element.addEventListener('pointermove', this.handlePointerMove, { passive: false });
    this.element.addEventListener('pointerup', this.handlePointerEnd, { passive: false });
    this.element.addEventListener('pointercancel', this.handlePointerEnd, { passive: false });
  }

  handlePointerDown(event) {
    if (!this.enabled || this.activePointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const worldPoint = this.toWorld(event.clientX, event.clientY);
    if (!worldPoint) return;
    event.preventDefault();
    const result = this.onStart(worldPoint);
    if (!result?.firing) return;
    this.activePointerId = event.pointerId;
    this.element.setPointerCapture?.(event.pointerId);
    if (globalThis.navigator?.vibrate) globalThis.navigator.vibrate(12);
  }

  handlePointerMove(event) {
    if (!this.enabled || event.pointerId !== this.activePointerId) return;
    const worldPoint = this.toWorld(event.clientX, event.clientY);
    if (!worldPoint) return;
    event.preventDefault();
    this.onMove(worldPoint);
  }

  handlePointerEnd(event) {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    this.element.releasePointerCapture?.(event.pointerId);
    this.activePointerId = null;
    this.onEnd();
  }

  setEnabled(enabled) {
    const nextEnabled = Boolean(enabled);
    if (!nextEnabled && this.activePointerId !== null) {
      this.element.releasePointerCapture?.(this.activePointerId);
      this.activePointerId = null;
      this.onEnd();
    }
    this.enabled = nextEnabled;
  }

  destroy() {
    this.setEnabled(false);
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerEnd);
    this.element.removeEventListener('pointercancel', this.handlePointerEnd);
  }
}
