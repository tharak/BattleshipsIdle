import {
  FORMATIONS,
  FORMATION_CHANGE,
  FORMATION_ORDER,
} from '../config/balance.js';

const SEVEN_SHIP_LAYOUTS = Object.freeze({
  line: [
    [-33, -45], [-22, -48], [-11, -50], [0, -56], [11, -50], [22, -48], [33, -45],
  ],
  wedge: [
    [-31, -39], [-21, -44], [-11, -49], [0, -57], [11, -49], [21, -44], [31, -39],
  ],
  defensiveArc: [
    [-32, -41], [-27, -49], [-15, -55], [0, -58], [15, -55], [27, -49], [32, -41],
  ],
  splitWings: [
    [-39, -43], [-31, -50], [-23, -43], [0, -57], [23, -43], [31, -50], [39, -43],
  ],
  denseColumn: [
    [-4, -33], [4, -39], [-4, -45], [0, -60], [4, -51], [-4, -55], [4, -59],
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
      return template.map(([x, y]) => ({ x, y }));
    }

    // Dynamic fallbacks support later fleet-size upgrades without changing the formation contract.
    const commandIndex = Math.floor(count / 2);
    return Array.from({ length: count }, (_, index) => {
      if (index === commandIndex) return { x: 0, y: -58 };
      const sideIndex = index < commandIndex ? index - commandIndex : index - commandIndex;
      const side = Math.sign(sideIndex);
      const rank = Math.abs(sideIndex);
      if (formationId === 'denseColumn') {
        return { x: side * (3 + (rank % 2) * 2), y: -58 + rank * 5 };
      }
      if (formationId === 'splitWings') {
        return { x: side * (20 + rank * 5), y: -50 + (rank % 2) * 7 };
      }
      if (formationId === 'defensiveArc') {
        const angle = (rank / Math.max(1, commandIndex)) * Math.PI * 0.48;
        return { x: side * Math.sin(angle) * 35, y: -58 + (1 - Math.cos(angle)) * 20 };
      }
      if (formationId === 'wedge') {
        return { x: side * rank * 9, y: -56 + rank * 5 };
      }
      return { x: side * rank * 9, y: -51 + rank * 1.4 };
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
    this.transitionRemaining = FORMATION_CHANGE.duration;
    this.cooldownRemaining = FORMATION_CHANGE.cooldown;
    return { changed: true, formation: this.current, paths };
  }

  reflow(friendlies) {
    const positions = this.getPositionsForFleet(friendlies);
    const paths = friendlies.map((ship, index) => {
      const target = positions[index];
      ship.formationFromX = ship.x;
      ship.formationFromY = ship.y;
      ship.targetX = target.x;
      ship.targetY = target.y;
      return { from: { x: ship.x, y: ship.y }, to: { ...target } };
    });
    this.transitionRemaining = FORMATION_CHANGE.duration;
    return paths;
  }

  update(friendlies, deltaSeconds) {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - deltaSeconds);
    if (!this.isTransitioning) return;

    this.transitionRemaining = Math.max(0, this.transitionRemaining - deltaSeconds);
    const rawProgress = 1 - this.transitionRemaining / FORMATION_CHANGE.duration;
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
