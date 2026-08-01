const CHARGE_CIRCUMFERENCE = 2 * Math.PI * 20;
const EDGE_PADDING = 30;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class TargetingIndicator {
  constructor({ element, container }) {
    this.element = element;
    this.container = container;
    this.chargeRing = element.querySelector('[data-targeting-charge]');
    this.hasPosition = false;
    this.pointerVisible = false;
    this.active = false;
    this.rejectionTimer = 0;
  }

  setPointer({ clientX, clientY, visible }) {
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      this.lastClientPosition = { clientX, clientY };
      this.positionAt(clientX, clientY);
      this.hasPosition = true;
    }
    this.pointerVisible = Boolean(visible);
    this.refreshVisibility();
  }

  positionAt(clientX, clientY) {
    const rect = this.container.getBoundingClientRect();
    const maximumX = Math.max(EDGE_PADDING, rect.width - EDGE_PADDING);
    const maximumY = Math.max(EDGE_PADDING, rect.height - EDGE_PADDING);
    this.element.style.left = `${clamp(clientX - rect.left, EDGE_PADDING, maximumX)}px`;
    this.element.style.top = `${clamp(clientY - rect.top, EDGE_PADDING, maximumY)}px`;
  }

  resize() {
    if (!this.lastClientPosition) return;
    this.positionAt(this.lastClientPosition.clientX, this.lastClientPosition.clientY);
  }

  setState({ charge, active }) {
    const normalizedCharge = clamp(charge, 0, 1);
    this.active = Boolean(active);
    this.chargeRing.style.strokeDashoffset = String(CHARGE_CIRCUMFERENCE * (1 - normalizedCharge));
    this.element.classList.toggle('is-ready', this.active && normalizedCharge >= 0.999);
    this.refreshVisibility();
  }

  reflectTargetResult(result) {
    if (result?.fired) {
      this.chargeRing.style.strokeDashoffset = String(CHARGE_CIRCUMFERENCE);
      this.element.classList.remove('is-ready');
      return;
    }
    if (result?.reason !== 'cooldown') return;
    this.element.classList.remove('is-rejected');
    // Restart the feedback animation when several rejected orders arrive close together.
    void this.element.offsetWidth;
    this.element.classList.add('is-rejected');
    globalThis.clearTimeout(this.rejectionTimer);
    this.rejectionTimer = globalThis.setTimeout(() => {
      this.element.classList.remove('is-rejected');
    }, 320);
  }

  refreshVisibility() {
    this.element.hidden = !(this.active && this.hasPosition && this.pointerVisible);
  }

  destroy() {
    globalThis.clearTimeout(this.rejectionTimer);
  }
}
