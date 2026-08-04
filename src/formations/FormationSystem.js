import {
  ARENA,
  FORMATIONS,
  FORMATION_CHANGE,
  FORMATION_EDITOR,
  FORMATION_ORDER,
  GEOMETRY_BONUSES,
} from '../config/balance.js';

const STARTER_LAYOUTS = Object.freeze({
  line: [[-35, -40], [-25, -40], [-15, -40], [0, -55], [15, -40], [25, -40], [35, -40]],
  wedge: [[-30, -40], [-20, -45], [-10, -50], [0, -55], [10, -50], [20, -45], [30, -40]],
  defensiveArc: [[-30, -40], [-25, -50], [-15, -55], [0, -55], [15, -55], [25, -50], [30, -40]],
  splitWings: [[-30, -40], [-25, -50], [-20, -40], [0, -55], [20, -40], [25, -50], [30, -40]],
  denseColumn: [[-5, -40], [5, -40], [-5, -50], [0, -55], [5, -50], [-10, -55], [10, -55]],
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, places = 4) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function slotMap(slots) {
  return new Map(slots.map((slot) => [slot.slot, slot]));
}

export function getStarterTemplatePositions(templateId = 'line', count = 7) {
  const layout = STARTER_LAYOUTS[templateId] ?? STARTER_LAYOUTS.line;
  const positions = layout.map(([x, y], slot) => ({ slot, x, y }));
  const candidates = [];
  const extraRows = [-45, -50, -55, -40];
  const mirroredColumns = [-30, 30, -20, 20, -10, 10, 0];
  for (const y of extraRows) {
    for (const x of mirroredColumns) candidates.push({ x, y });
  }
  while (positions.length < count) {
    const point = candidates.find((candidate) => positions.every((position) => distance(position, candidate) >= FORMATION_EDITOR.minimumSeparation));
    if (!point) break;
    positions.push({ slot: positions.length, ...point });
  }
  return positions.slice(0, count);
}

export function createStarterLoadouts(primaryTemplateId = 'line') {
  const primary = FORMATIONS[primaryTemplateId] ? primaryTemplateId : 'line';
  const templateIds = [primary, ...FORMATION_ORDER.filter((id) => id !== primary)]
    .slice(0, FORMATION_EDITOR.loadoutCount);
  return templateIds.map((templateId, index) => ({
    id: `loadout-${index + 1}`,
    name: `Loadout ${index + 1}`,
    templateId,
    slots: getStarterTemplatePositions(templateId),
  }));
}

export function normalizeFormationLoadouts(loadouts, primaryTemplateId = 'line') {
  const fallbacks = createStarterLoadouts(primaryTemplateId);
  return fallbacks.map((fallback, index) => {
    const source = Array.isArray(loadouts) ? loadouts[index] : null;
    if (!source || !Array.isArray(source.slots)) return fallback;
    const seen = new Set();
    const slots = source.slots
      .map((position, fallbackSlot) => ({
        slot: Number.isFinite(position?.slot) ? Math.max(0, Math.floor(position.slot)) : fallbackSlot,
        x: Number(position?.x),
        y: Number(position?.y),
      }))
      .filter((position) => Number.isFinite(position.x) && Number.isFinite(position.y))
      .filter((position) => !seen.has(position.slot) && seen.add(position.slot));
    const fallbackBySlot = slotMap(fallback.slots);
    for (let slot = 0; slot < 7; slot += 1) {
      if (!slots.some((position) => position.slot === slot)) slots.push({ ...fallbackBySlot.get(slot) });
    }
    slots.sort((left, right) => left.slot - right.slot);
    return {
      id: `loadout-${index + 1}`,
      name: typeof source.name === 'string' && source.name.trim() ? source.name.trim().slice(0, 24) : fallback.name,
      templateId: FORMATIONS[source.templateId] ? source.templateId : null,
      slots,
    };
  });
}

export class FormationSystem {
  constructor(options = 'line') {
    const normalizedOptions = typeof options === 'string'
      ? { initialTemplateId: options }
      : (options ?? {});
    const initialTemplateId = FORMATIONS[normalizedOptions.initialTemplateId]
      ? normalizedOptions.initialTemplateId
      : 'line';
    this.loadouts = normalizeFormationLoadouts(normalizedOptions.loadouts, initialTemplateId);
    this.activeLoadoutIndex = clamp(
      Math.floor(Number(normalizedOptions.activeLoadoutIndex) || 0),
      0,
      FORMATION_EDITOR.loadoutCount - 1,
    );
    this.commandNetworkLevel = clamp(Math.floor(Number(normalizedOptions.commandNetworkLevel) || 0), 0, 12);
    if (this.activeLoadoutIndex >= this.unlockedLoadoutCount) this.activeLoadoutIndex = 0;
    this.cooldownRemaining = 0;
    this.movingSlots = new Set();
    this.dragState = null;
    this.arena = { ...ARENA };
    this.worldOffset = { x: 0, y: 0 };
  }

  get unlockedLoadoutCount() {
    return 1 + (this.commandNetworkLevel >= 1 ? 1 : 0) + (this.commandNetworkLevel >= 3 ? 1 : 0);
  }

  get activeLoadout() {
    return this.loadouts[this.activeLoadoutIndex];
  }

  get currentId() {
    return this.activeLoadout.templateId ?? `custom-${this.activeLoadoutIndex + 1}`;
  }

  get current() {
    const template = FORMATIONS[this.activeLoadout.templateId];
    return template ?? {
      id: this.currentId,
      name: this.activeLoadout.name,
      shortName: `L${this.activeLoadoutIndex + 1}`,
      description: 'Custom geometry',
      mechanic: 'Live geometry bonuses',
    };
  }

  get isTransitioning() {
    return this.movingSlots.size > 0;
  }

  setCommandNetworkLevel(level) {
    this.commandNetworkLevel = clamp(Math.floor(Number(level) || 0), 0, 12);
    if (this.activeLoadoutIndex >= this.unlockedLoadoutCount) this.activeLoadoutIndex = 0;
  }

  setArena(arena) {
    this.arena = { ...this.arena, ...arena };
    this.fitLoadoutsToArena();
  }

  setWorldOffset(x = 0, y = 0) {
    this.worldOffset = {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
    };
  }

  toWorldPoint(point) {
    return {
      x: point.x + this.worldOffset.x,
      y: point.y + this.worldOffset.y,
    };
  }

  toLocalPoint(point) {
    return {
      x: point.x - this.worldOffset.x,
      y: point.y - this.worldOffset.y,
    };
  }

  fitLoadoutsToArena() {
    const bounds = this.getPlacementBounds();
    for (const loadout of this.loadouts) {
      const placed = [];
      for (const position of loadout.slots) {
        const desired = this.snapPoint(
          clamp(position.x, bounds.minX, bounds.maxX),
          clamp(position.y, bounds.minY, bounds.maxY),
        );
        const candidates = [];
        for (let y = bounds.minY; y <= bounds.maxY; y += FORMATION_EDITOR.gridSize) {
          for (let x = bounds.minX; x <= bounds.maxX; x += FORMATION_EDITOR.gridSize) {
            candidates.push({ x, y, distance: Math.hypot(x - desired.x, y - desired.y) });
          }
        }
        const candidate = candidates
          .sort((left, right) => left.distance - right.distance)
          .find((point) => placed.every((other) => distance(other, point) >= FORMATION_EDITOR.minimumSeparation))
          ?? desired;
        position.x = candidate.x;
        position.y = candidate.y;
        placed.push(position);
      }
    }
  }

  getPlacementBounds() {
    const halfWidth = Math.min(
      this.arena.maxX - FORMATION_EDITOR.horizontalPadding,
      FORMATION_EDITOR.basePlacementHalfWidth
        + this.commandNetworkLevel * FORMATION_EDITOR.placementHalfWidthPerLevel,
    );
    const grid = FORMATION_EDITOR.gridSize;
    return {
      minX: Math.ceil(-halfWidth / grid) * grid,
      maxX: Math.floor(halfWidth / grid) * grid,
      minY: Math.ceil((this.arena.minY + FORMATION_EDITOR.fleetZoneBottomPadding) / grid) * grid,
      maxY: Math.floor((this.arena.minY + this.arena.height * FORMATION_EDITOR.fleetZoneTopRatio) / grid) * grid,
    };
  }

  isFleetZonePoint(y) {
    const bounds = this.getPlacementBounds();
    return y >= bounds.minY + this.worldOffset.y
      && y <= bounds.maxY + this.worldOffset.y;
  }

  snapPoint(x, y) {
    const grid = FORMATION_EDITOR.gridSize;
    return { x: Math.round(x / grid) * grid, y: Math.round(y / grid) * grid };
  }

  ensureFleetSlots(friendlies) {
    const highestSlot = Math.max(6, ...friendlies.map((ship) => ship.slot));
    for (let index = 0; index < this.loadouts.length; index += 1) {
      const loadout = this.loadouts[index];
      const existing = slotMap(loadout.slots);
      const templatePositions = getStarterTemplatePositions(loadout.templateId ?? 'line', highestSlot + 1);
      for (let slot = 0; slot <= highestSlot; slot += 1) {
        if (existing.has(slot)) continue;
        let candidate = templatePositions.find((position) => position.slot === slot);
        if (!candidate) candidate = this.findOpenGridPosition(loadout.slots);
        loadout.slots.push({ slot, x: candidate.x, y: candidate.y });
      }
      loadout.slots.sort((left, right) => left.slot - right.slot);
    }
    this.fitLoadoutsToArena();
  }

  findOpenGridPosition(existingSlots) {
    const bounds = this.getPlacementBounds();
    for (let y = bounds.minY; y <= bounds.maxY; y += FORMATION_EDITOR.gridSize) {
      for (let x = bounds.minX; x <= bounds.maxX; x += FORMATION_EDITOR.gridSize) {
        const candidate = { x, y };
        if (existingSlots.every((position) => distance(position, candidate) >= FORMATION_EDITOR.minimumSeparation)) {
          return candidate;
        }
      }
    }
    return { x: 0, y: bounds.minY };
  }

  getPositions(count, templateId = this.activeLoadout.templateId ?? 'line') {
    return getStarterTemplatePositions(templateId, count).map(({ x, y }) => ({ x, y }));
  }

  getPositionsForFleet(friendlies, loadout = this.activeLoadout) {
    this.ensureFleetSlots(friendlies);
    const positions = slotMap(loadout.slots);
    return friendlies.map((ship) => this.toWorldPoint(positions.get(ship.slot)));
  }

  applyInitialPositions(friendlies) {
    const positions = this.getPositionsForFleet(friendlies);
    friendlies.forEach((ship, index) => {
      // The deployment begins with only the flagship on the tactical grid.
      // Escorts retain their tactical coordinates for simulation, but are visually
      // held in the reserve tray until the player deploys them.
      const reserve = ship.role !== 'command';
      ship.x = positions[index].x;
      ship.y = positions[index].y;
      ship.targetX = ship.x;
      ship.targetY = ship.y;
      ship.moving = false;
      ship.deployed = true;
      ship.inReserve = reserve;
    });
    this.movingSlots.clear();
  }

  moveFleetToActiveLoadout(friendlies, { startCooldown = false } = {}) {
    const positions = this.getPositionsForFleet(friendlies);
    const paths = friendlies.map((ship, index) => this.moveShip(ship, positions[index], { reveal: false }));
    if (startCooldown) this.cooldownRemaining = FORMATION_CHANGE.cooldown;
    return paths;
  }

  moveShip(ship, target, { reveal = true } = {}) {
    ship.deployed = true;
    if (reveal) ship.inReserve = false;
    const from = { x: ship.x, y: ship.y };
    ship.targetX = target.x;
    ship.targetY = target.y;
    ship.moving = distance(ship, target) > 0.001;
    if (ship.moving) this.movingSlots.add(ship.slot);
    else this.movingSlots.delete(ship.slot);
    return { slot: ship.slot, shipId: ship.id, from, to: { ...target } };
  }

  activateLoadout(index, friendlies, { ignoreCooldown = false } = {}) {
    const loadoutIndex = Math.floor(Number(index));
    if (loadoutIndex < 0 || loadoutIndex >= this.unlockedLoadoutCount) {
      return { changed: false, reason: 'locked' };
    }
    if (loadoutIndex === this.activeLoadoutIndex) return { changed: false, reason: 'same' };
    if (!ignoreCooldown && this.cooldownRemaining > 0) return { changed: false, reason: 'cooldown' };
    this.activeLoadoutIndex = loadoutIndex;
    const paths = this.moveFleetToActiveLoadout(friendlies, { startCooldown: !ignoreCooldown });
    return { changed: true, loadoutIndex, loadout: this.activeLoadout, paths };
  }

  applyTemplate(templateId, friendlies, { ignoreCooldown = false } = {}) {
    if (!FORMATIONS[templateId]) return { changed: false, reason: 'unknown-template' };
    if (!ignoreCooldown && this.cooldownRemaining > 0) return { changed: false, reason: 'cooldown' };
    const count = Math.max(7, ...friendlies.map((ship) => ship.slot + 1));
    this.activeLoadout.templateId = templateId;
    this.activeLoadout.slots = getStarterTemplatePositions(templateId, count);
    this.ensureFleetSlots(friendlies);
    const paths = this.moveFleetToActiveLoadout(friendlies, { startCooldown: !ignoreCooldown });
    return { changed: true, templateId, formation: FORMATIONS[templateId], paths };
  }

  changeTo(templateId, friendlies, options = {}) {
    return this.applyTemplate(templateId, friendlies, options);
  }

  reflow(friendlies) {
    return this.moveFleetToActiveLoadout(friendlies);
  }

  previewPlacement(slot, x, y, friendlies) {
    const loadoutCandidate = this.snapPoint(
      x - this.worldOffset.x,
      y - this.worldOffset.y,
    );
    const candidate = this.toWorldPoint(loadoutCandidate);
    const bounds = this.getPlacementBounds();
    const loadoutSlots = this.activeLoadout.slots;
    const insideBounds = loadoutCandidate.x >= bounds.minX && loadoutCandidate.x <= bounds.maxX
      && loadoutCandidate.y >= bounds.minY && loadoutCandidate.y <= bounds.maxY;
    const occupied = loadoutSlots.find((position) => position.slot !== slot
      && distance(position, loadoutCandidate) < FORMATION_EDITOR.minimumSeparation);
    // Dropping on another ship is intentional: the two ships exchange positions.
    // Only reject a drop when it lands between slots or outside the editor.
    const separated = loadoutSlots.every((position) => position.slot === slot
      || position === occupied
      || distance(position, loadoutCandidate) >= FORMATION_EDITOR.minimumSeparation);
    const valid = insideBounds && separated;
    const positions = friendlies
      .filter((ship) => ship.alive !== false)
      .map((ship) => ship.slot === slot
        ? { slot: ship.slot, role: ship.role, ...candidate }
        : occupied && ship.slot === occupied.slot
          ? { slot: ship.slot, role: ship.role, ...this.toWorldPoint({ x: loadoutSlots.find((position) => position.slot === slot).x, y: loadoutSlots.find((position) => position.slot === slot).y }) }
        : { slot: ship.slot, role: ship.role, x: ship.x, y: ship.y });
    const currentModifiers = this.getModifiers(friendlies);
    const previewModifiers = this.getModifiersFromPositions(positions, friendlies);
    this.dragState = {
      slot,
      original: { ...loadoutSlots.find((position) => position.slot === slot) },
      candidate,
      loadoutCandidate,
      valid,
      reason: !insideBounds ? 'outside-fleet-zone' : !separated ? 'overlap' : null,
      swapSlot: occupied?.slot ?? null,
      modifiers: previewModifiers,
      changes: Object.fromEntries(Object.keys(previewModifiers).map((key) => [key, round(previewModifiers[key] - currentModifiers[key])])),
    };
    return { ...this.dragState };
  }

  commitPlacement(friendlies) {
    const preview = this.dragState;
    this.dragState = null;
    if (!preview?.valid) return { changed: false, reason: preview?.reason ?? 'no-drag', preview };
    const position = this.activeLoadout.slots.find((slot) => slot.slot === preview.slot);
    if (!position) return { changed: false, reason: 'unknown-slot', preview };
    const swappedPosition = preview.swapSlot === null
      ? null
      : this.activeLoadout.slots.find((candidate) => candidate.slot === preview.swapSlot);
    const original = { x: position.x, y: position.y };
    position.x = preview.loadoutCandidate.x;
    position.y = preview.loadoutCandidate.y;
    this.activeLoadout.templateId = null;
    const ship = friendlies.find((candidate) => candidate.slot === preview.slot);
    const path = ship ? this.moveShip(ship, preview.candidate) : null;
    const swappedShip = friendlies.find((candidate) => candidate.slot === preview.swapSlot);
    const swappedPath = swappedPosition && swappedShip
      ? this.moveShip(swappedShip, this.toWorldPoint(original))
      : null;
    if (swappedPosition) {
      swappedPosition.x = original.x;
      swappedPosition.y = original.y;
    }
    return {
      changed: true,
      slot: preview.slot,
      position: { ...preview.loadoutCandidate },
      worldPosition: { ...preview.candidate },
      path,
      swappedPath,
      preview,
    };
  }

  cancelPlacement() {
    const preview = this.dragState;
    this.dragState = null;
    return { changed: false, reason: 'cancelled', preview };
  }

  update(friendlies, deltaSeconds) {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - deltaSeconds);
    const speed = FORMATION_CHANGE.baseManeuverSpeed
      * (1 + this.commandNetworkLevel * FORMATION_CHANGE.maneuverSpeedPerLevel);
    for (const ship of friendlies) {
      if (!Number.isFinite(ship.targetX) || !Number.isFinite(ship.targetY)) {
        ship.targetX = ship.x;
        ship.targetY = ship.y;
      }
      const remaining = Math.hypot(ship.targetX - ship.x, ship.targetY - ship.y);
      if (remaining <= 0.001) {
        ship.x = ship.targetX;
        ship.y = ship.targetY;
        ship.moving = false;
        this.movingSlots.delete(ship.slot);
        continue;
      }
      const step = Math.min(remaining, speed * deltaSeconds);
      ship.x += ((ship.targetX - ship.x) / remaining) * step;
      ship.y += ((ship.targetY - ship.y) / remaining) * step;
      ship.moving = step < remaining;
      if (ship.moving) this.movingSlots.add(ship.slot);
      else this.movingSlots.delete(ship.slot);
    }
  }

  getGeometryMetrics(positions) {
    if (!positions.length) return { horizontalSpread: 0, cohesion: 0, screening: 0 };
    const minX = Math.min(...positions.map(({ x }) => x));
    const maxX = Math.max(...positions.map(({ x }) => x));
    const bounds = this.getPlacementBounds();
    const horizontalSpread = clamp((maxX - minX) / Math.max(1, bounds.maxX - bounds.minX), 0, 1);
    const center = positions.reduce((total, position) => ({
      x: total.x + position.x / positions.length,
      y: total.y + position.y / positions.length,
    }), { x: 0, y: 0 });
    const averageRadius = positions.reduce((sum, position) => sum + distance(position, center), 0) / positions.length;
    const cohesion = 1 - clamp(
      (averageRadius - GEOMETRY_BONUSES.cohesionIdealRadius) / GEOMETRY_BONUSES.cohesionFalloffRadius,
      0,
      1,
    );
    const command = positions.find((position) => position.role === 'command')
      ?? positions.find((position) => position.slot === 3);
    let screening = 0;
    if (command) {
      const weight = positions.reduce((sum, position) => {
        if (position.slot === command.slot || position.y <= command.y) return sum;
        const separation = distance(position, command);
        return sum + clamp(1 - separation / GEOMETRY_BONUSES.screeningRadius, 0, 1);
      }, 0);
      screening = clamp(weight / GEOMETRY_BONUSES.screeningFullWeight, 0, 1);
    }
    return {
      horizontalSpread: round(horizontalSpread),
      cohesion: round(cohesion),
      screening: round(screening),
    };
  }

  getModifiersFromPositions(positions, friendlies = []) {
    const validPositions = positions.filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y));
    const roles = new Map(friendlies.map((ship) => [ship.slot, ship.role]));
    const withRoles = validPositions.map((position) => ({ ...position, role: roles.get(position.slot) }));
    const metrics = this.getGeometryMetrics(withRoles);
    const capRatio = GEOMETRY_BONUSES.baseCapRatio
      + (1 - GEOMETRY_BONUSES.baseCapRatio) * this.commandNetworkLevel / 12;
    return {
      rangeBonus: round(metrics.horizontalSpread * GEOMETRY_BONUSES.rangeMaximum * capRatio),
      sideDamageBonus: round(metrics.horizontalSpread * GEOMETRY_BONUSES.sideDamageMaximum * capRatio),
      fireRateBonus: round(metrics.cohesion * GEOMETRY_BONUSES.fireRateMaximum * capRatio),
      flagshipDamageBonus: round(metrics.cohesion * GEOMETRY_BONUSES.flagshipDamageMaximum * capRatio),
      flagshipDamageReduction: round(metrics.screening * GEOMETRY_BONUSES.screeningMaximum * capRatio),
    };
  }

  getModifiers(friendlies = this.activeLoadout.slots) {
    return this.getModifiersFromPositions(
      friendlies.filter((ship) => ship.alive !== false).map(({ slot, role, x, y }) => ({ slot, role, x, y })),
      friendlies,
    );
  }

  getAutoDamageMultiplier(target, friendlies = this.activeLoadout.slots) {
    const modifiers = this.getModifiers(friendlies);
    const sideTarget = Math.abs(target.x) >= this.arena.maxX * GEOMETRY_BONUSES.sideTargetRatio;
    return (sideTarget ? 1 + modifiers.sideDamageBonus : 1)
      * (this.isTransitioning ? FORMATION_CHANGE.movingAutoDamage : 1);
  }

  getIncomingDamageMultiplier(entity, friendlies) {
    const screening = entity?.role === 'command'
      ? 1 - this.getModifiers(friendlies).flagshipDamageReduction
      : 1;
    return screening * (this.isTransitioning ? FORMATION_CHANGE.movingIncomingDamage : 1);
  }

  getRangeMultiplier(friendlies) {
    return 1 + this.getModifiers(friendlies).rangeBonus;
  }

  getFireRateMultiplier(friendlies) {
    return 1 + this.getModifiers(friendlies).fireRateBonus;
  }

  getFlagshipDamageMultiplier(friendlies) {
    return 1 + this.getModifiers(friendlies).flagshipDamageBonus;
  }

  exportLoadouts() {
    return this.loadouts.map((loadout) => ({
      ...loadout,
      slots: loadout.slots.map((position) => ({ ...position })),
    }));
  }

  snapshot(friendlies = []) {
    const modifiers = this.getModifiers(friendlies);
    const positions = friendlies.filter((ship) => ship.alive !== false)
      .map(({ slot, role, x, y }) => ({ slot, role, x, y }));
    return {
      currentId: this.currentId,
      current: { ...this.current, ...modifiers },
      order: FORMATION_ORDER,
      loadouts: this.exportLoadouts(),
      activeLoadoutIndex: this.activeLoadoutIndex,
      unlockedLoadoutCount: this.unlockedLoadoutCount,
      templates: FORMATION_ORDER.map((id) => ({ ...FORMATIONS[id] })),
      geometry: this.getGeometryMetrics(positions),
      modifiers,
      preview: this.dragState ? { ...this.dragState } : null,
      placement: {
        bounds: (() => {
          const bounds = this.getPlacementBounds();
          return {
            minX: bounds.minX + this.worldOffset.x,
            maxX: bounds.maxX + this.worldOffset.x,
            minY: bounds.minY + this.worldOffset.y,
            maxY: bounds.maxY + this.worldOffset.y,
          };
        })(),
        offset: { ...this.worldOffset },
        gridSize: FORMATION_EDITOR.gridSize,
        minimumSeparation: FORMATION_EDITOR.minimumSeparation,
      },
      movingShips: friendlies.filter((ship) => ship.moving).map((ship) => ({
        id: ship.id,
        slot: ship.slot,
        target: { x: ship.targetX, y: ship.targetY },
      })),
      transitionProgress: this.isTransitioning ? 0 : 1,
      cooldownRemaining: this.cooldownRemaining,
      isTransitioning: this.isTransitioning,
      maneuverSpeed: FORMATION_CHANGE.baseManeuverSpeed
        * (1 + this.commandNetworkLevel * FORMATION_CHANGE.maneuverSpeedPerLevel),
    };
  }
}
