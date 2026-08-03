export class TargetingInput {
  constructor({
    element,
    toWorld,
    isFormationPoint = () => false,
    onFormationStart,
    onFormationMove,
    onFormationEnd,
    onTargetStart,
    onTargetMove,
    onTargetEnd,
    // Legacy callback names remain supported for small embedders and existing tests.
    onStart,
    onMove,
    onEnd,
  }) {
    this.element = element;
    this.toWorld = toWorld;
    this.isFormationPoint = isFormationPoint;
    this.onFormationStart = onFormationStart;
    this.onFormationMove = onFormationMove;
    this.onFormationEnd = onFormationEnd;
    this.onTargetStart = onTargetStart ?? onStart;
    this.onTargetMove = onTargetMove ?? onMove;
    this.onTargetEnd = onTargetEnd ?? onEnd;
    this.enabled = true;
    this.activePointerId = null;
    this.activeMode = null;
    this.lastWorldPoint = null;
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
    const formationMode = Boolean(this.onFormationStart && this.isFormationPoint(worldPoint));
    const mode = formationMode ? 'formation' : 'target';
    const result = formationMode
      ? this.onFormationStart(worldPoint)
      : this.onTargetStart?.(worldPoint);
    const accepted = formationMode ? result?.dragging : result?.firing;
    if (!accepted) return;
    event.preventDefault();
    this.activePointerId = event.pointerId;
    this.activeMode = mode;
    this.lastWorldPoint = worldPoint;
    this.element.setPointerCapture?.(event.pointerId);
    if (globalThis.navigator?.vibrate) globalThis.navigator.vibrate(12);
  }

  handlePointerMove(event) {
    if (!this.enabled || event.pointerId !== this.activePointerId) return;
    const worldPoint = this.toWorld(event.clientX, event.clientY);
    if (!worldPoint) return;
    event.preventDefault();
    this.lastWorldPoint = worldPoint;
    if (this.activeMode === 'formation') this.onFormationMove?.(worldPoint);
    else this.onTargetMove?.(worldPoint);
  }

  handlePointerEnd(event) {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    const point = this.toWorld(event.clientX, event.clientY) ?? this.lastWorldPoint;
    const meta = { cancelled: event.type === 'pointercancel', mode: this.activeMode };
    this.element.releasePointerCapture?.(event.pointerId);
    this.activePointerId = null;
    const mode = this.activeMode;
    this.activeMode = null;
    this.lastWorldPoint = null;
    if (mode === 'formation') this.onFormationEnd?.(point, meta);
    else this.onTargetEnd?.(point, meta);
  }

  cancelActivePointer() {
    if (this.activePointerId === null) return;
    this.element.releasePointerCapture?.(this.activePointerId);
    const mode = this.activeMode;
    this.activePointerId = null;
    this.activeMode = null;
    this.lastWorldPoint = null;
    if (mode === 'formation') this.onFormationEnd?.(null, { cancelled: true, mode });
    else this.onTargetEnd?.(null, { cancelled: true, mode });
  }

  setEnabled(enabled) {
    const nextEnabled = Boolean(enabled);
    if (!nextEnabled) this.cancelActivePointer();
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
