import {
  FORMATIONS,
  FORMATION_CHANGE,
  FORMATION_ORDER,
} from '../config/balance.js';

const SEVEN_SHIP_LAYOUTS = Object.freeze({
  line: [
    [-33, -37], [-22, -40], [-11, -42], [0, -48], [11, -42], [22, -40], [33, -37],
  ],
  wedge: [
    [-31, -31], [-21, -36], [-11, -41], [0, -49], [11, -41], [21, -36], [31, -31],
  ],
  defensiveArc: [
    [-32, -33], [-27, -41], [-15, -47], [0, -50], [15, -47], [27, -41], [32, -33],
  ],
  splitWings: [
    [-39, -35], [-31, -42], [-23, -35], [0, -49], [23, -35], [31, -42], [39, -35],
  ],
  denseColumn: [
    [-4, -25], [4, -31], [-4, -37], [0, -52], [4, -43], [-4, -47], [4, -51],
  ],
});

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

export class FormationSystem {
  constructor(initialId = 'line') {
    this.currentId = FORMATIONS[initialId] ? initialId : 'line';
    this.transitionRemaining = 0;
    this.cooldownRemaining = 0;
    this.horizontalScale = 1;
    this.verticalOffset = 0;
    this.transitionDuration = FORMATION_CHANGE.duration;
  }

  get current() {
    return FORMATIONS[this.currentId];
  }

  get isTransitioning() {
    return this.transitionRemaining > 0;
  }

  getPositions(count, formationId = this.currentId) {
    const template = SEVEN_SHIP_LAYOUTS[formationId] ?? SEVEN_SHIP_LAYOUTS.line;
    if (count === template.length) {
      return template.map(([x, y]) => ({ x: x * this.horizontalScale, y: y + this.verticalOffset }));
    }

    // Dynamic fallbacks support later fleet-size upgrades without changing the formation contract.
    const commandIndex = Math.floor(count / 2);
    return Array.from({ length: count }, (_, index) => {
      if (index === commandIndex) return { x: 0, y: -50 + this.verticalOffset };
      const sideIndex = index < commandIndex ? index - commandIndex : index - commandIndex;
      const side = Math.sign(sideIndex);
      const rank = Math.abs(sideIndex);
      if (formationId === 'denseColumn') {
        return { x: side * (3 + (rank % 2) * 2) * this.horizontalScale, y: -50 + rank * 5 + this.verticalOffset };
      }
      if (formationId === 'splitWings') {
        return { x: side * (20 + rank * 5) * this.horizontalScale, y: -42 + (rank % 2) * 7 + this.verticalOffset };
      }
      if (formationId === 'defensiveArc') {
        const angle = (rank / Math.max(1, commandIndex)) * Math.PI * 0.48;
        return { x: side * Math.sin(angle) * 35 * this.horizontalScale, y: -50 + (1 - Math.cos(angle)) * 20 + this.verticalOffset };
      }
      if (formationId === 'wedge') {
        return { x: side * rank * 9 * this.horizontalScale, y: -48 + rank * 5 + this.verticalOffset };
      }
      return { x: side * rank * 9 * this.horizontalScale, y: -43 + rank * 1.4 + this.verticalOffset };
    });
  }

  getPositionsForFleet(friendlies, formationId = this.currentId) {
    const positions = this.getPositions(friendlies.length, formationId);
    const commandIndex = friendlies.findIndex((ship) => ship.role === 'command');
    const commandSlot = Math.floor(friendlies.length / 2);
    if (commandIndex >= 0 && commandIndex !== commandSlot) {
      [positions[commandIndex], positions[commandSlot]] = [positions[commandSlot], positions[commandIndex]];
    }
    return positions;
  }

  applyInitialPositions(friendlies) {
    const positions = this.getPositionsForFleet(friendlies);
    friendlies.forEach((ship, index) => {
      ship.x = positions[index].x;
      ship.y = positions[index].y;
      ship.targetX = ship.x;
      ship.targetY = ship.y;
    });
  }

  changeTo(formationId, friendlies, { ignoreCooldown = false } = {}) {
    if (!FORMATIONS[formationId] || formationId === this.currentId) {
      return { changed: false, reason: 'same-or-unknown' };
    }
    if (!ignoreCooldown && this.cooldownRemaining > 0) {
      return { changed: false, reason: 'cooldown' };
    }

    const positions = this.getPositionsForFleet(friendlies, formationId);
    const paths = friendlies.map((ship, index) => {
      const target = positions[index];
      ship.formationFromX = ship.x;
      ship.formationFromY = ship.y;
      ship.targetX = target.x;
      ship.targetY = target.y;
      return { from: { x: ship.x, y: ship.y }, to: { ...target } };
    });

    this.currentId = formationId;
    this.transitionDuration = FORMATION_CHANGE.duration;
    this.transitionRemaining = FORMATION_CHANGE.duration;
    this.cooldownRemaining = FORMATION_CHANGE.cooldown;
    return { changed: true, formation: this.current, paths };
  }

  reflow(friendlies, { duration = FORMATION_CHANGE.duration } = {}) {
    const positions = this.getPositionsForFleet(friendlies);
    const paths = friendlies.map((ship, index) => {
      const target = positions[index];
      ship.formationFromX = ship.x;
      ship.formationFromY = ship.y;
      ship.targetX = target.x;
      ship.targetY = target.y;
      return { from: { x: ship.x, y: ship.y }, to: { ...target } };
    });
    this.transitionDuration = duration;
    this.transitionRemaining = duration;
    return paths;
  }

  setViewportLayout(scale, verticalOffset, friendlies) {
    const nextScale = Math.max(0.72, Math.min(1.35, scale));
    const nextOffset = Number.isFinite(verticalOffset) ? verticalOffset : 0;
    if (Math.abs(nextScale - this.horizontalScale) < 0.001
      && Math.abs(nextOffset - this.verticalOffset) < 0.001) return [];
    this.horizontalScale = nextScale;
    this.verticalOffset = nextOffset;
    return this.reflow(friendlies, { duration: 0.35 });
  }

  update(friendlies, deltaSeconds) {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - deltaSeconds);
    if (!this.isTransitioning) return;

    this.transitionRemaining = Math.max(0, this.transitionRemaining - deltaSeconds);
    const rawProgress = 1 - this.transitionRemaining / this.transitionDuration;
    const progress = smoothstep(Math.max(0, Math.min(1, rawProgress)));
    for (const ship of friendlies) {
      ship.x = ship.formationFromX + (ship.targetX - ship.formationFromX) * progress;
      ship.y = ship.formationFromY + (ship.targetY - ship.formationFromY) * progress;
    }
  }

  getAutoDamageMultiplier(target) {
    let multiplier = this.current.autoDamage;
    if (this.currentId === 'splitWings') {
      multiplier *= Math.abs(target.x) >= 19 ? this.current.sideDamage : this.current.centerDamage;
    }
    if (this.isTransitioning) multiplier *= FORMATION_CHANGE.movingAutoDamage;
    return multiplier;
  }

  getIncomingDamageMultiplier() {
    return this.current.incomingDamage
      * (this.isTransitioning ? FORMATION_CHANGE.movingIncomingDamage : 1);
  }

  snapshot() {
    return {
      currentId: this.currentId,
      current: this.current,
      order: FORMATION_ORDER,
      transitionProgress: this.isTransitioning
        ? 1 - this.transitionRemaining / FORMATION_CHANGE.duration
        : 1,
      cooldownRemaining: this.cooldownRemaining,
      isTransitioning: this.isTransitioning,
    };
  }
}
