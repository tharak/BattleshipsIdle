export class TargetingInput {
  constructor({ element, toWorld, onTarget }) {
    this.element = element;
    this.toWorld = toWorld;
    this.onTarget = onTarget;
    this.enabled = true;
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.element.addEventListener('pointerdown', this.handlePointerDown, { passive: false });
  }

  handlePointerDown(event) {
    if (!this.enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    const worldPoint = this.toWorld(event.clientX, event.clientY);
    if (!worldPoint) return;

    const result = this.onTarget(worldPoint);
    if (result?.fired && navigator.vibrate) navigator.vibrate(18);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  destroy() {
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
  }
}
