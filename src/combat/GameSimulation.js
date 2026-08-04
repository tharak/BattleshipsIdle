import {
  ARENA,
  DEPLOYMENT_CAPACITY,
  ENEMIES,
  FLEET,
  FLAGSHIP_GUN,
  FORMATION_EDITOR,
  FORMATIONS,
  FORMATION_ORDER,
  SIMULATION,
  TACTICAL_EDGE,
  TELEGRAPH_ATTACKS,
  WAVE_FLOW,
  WAVES,
  SHIP_PURCHASE_COSTS,
  getEnemyStats,
  getWaveEnemyCount,
} from '../config/balance.js';
import { RunProgression } from '../progression/RunProgression.js';
import { FormationSystem, getStarterTemplatePositions } from '../formations/FormationSystem.js';
import {
  BOSS,
  ELITE,
  ENEMY_TYPES,
  getAvailableEnemyTypes,
  isBossWave,
} from '../config/enemies.js';

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy || 1;
  const progress = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(
    point.x - (start.x + dx * progress),
    point.y - (start.y + dy * progress),
  );
}

function normalizedVelocity(from, to, speed) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { vx: (dx / length) * speed, vy: (dy / length) * speed };
}

function moveTowards(entity, target, speed, deltaSeconds) {
  const dx = target.x - entity.x;
  const dy = target.y - entity.y;
  const remaining = Math.hypot(dx, dy);
  if (remaining <= WAVE_FLOW.arrivalTolerance) {
    entity.x = target.x;
    entity.y = target.y;
    entity.moving = false;
    return true;
  }
  const step = Math.min(remaining, speed * deltaSeconds);
  entity.x += (dx / remaining) * step;
  entity.y += (dy / remaining) * step;
  entity.moving = step < remaining;
  return step >= remaining;
}

function rayExitDistance(origin, direction, arena) {
  const distances = [];
  if (direction.x > 0) distances.push((arena.maxX - origin.x) / direction.x);
  if (direction.x < 0) distances.push((arena.minX - origin.x) / direction.x);
  if (direction.y > 0) distances.push((arena.maxY - origin.y) / direction.y);
  if (direction.y < 0) distances.push((arena.minY - origin.y) / direction.y);
  return Math.min(...distances.filter((distance) => distance > 0));
}

function enemyHullRadius(enemy) {
  const baseRadius = enemy.boss
    ? 4.6
    : enemy.type === 'bulwark' ? 3.1
      : enemy.type === 'artillery' ? 2.7
        : enemy.type === 'skirmisher' ? 1.8 : 2.5;
  return baseRadius * (enemy.scale ?? 1);
}

export class GameSimulation {
  constructor({
    random = Math.random,
    progressionState = {},
    selectedFormation = 'line',
    formationLoadouts,
    activeLoadoutIndex = 0,
    onStateChange = () => {},
  } = {}) {
    this.random = random;
    this.onStateChange = onStateChange;
    this.progression = new RunProgression({ state: progressionState, onChange: onStateChange });
    this.formationSystem = new FormationSystem({
      initialTemplateId: selectedFormation,
      loadouts: formationLoadouts,
      activeLoadoutIndex,
      commandNetworkLevel: this.progression.upgrades.commandNetworkLevel,
    });
    this.nextId = 1;
    this.events = [];
    this.arena = { ...ARENA };
    this.resetToReady();
  }

  resetToReady() {
    this.status = 'ready';
    this.suspended = false;
    this.elapsed = 0;
    this.wave = 0;
    this.wavePhase = 'idle';
    this.waveIntermission = 0;
    this.waveResolved = false;
    this.deploymentsRemaining = 0;
    this.enemyFormationId = null;
    this.advanceAvailable = false;
    this.flagshipPathBlockerIds = [];
    this.flagshipGunEnergy = FLAGSHIP_GUN.firingDuration;
    this.flagshipGunFiring = false;
    this.flagshipGunManualControl = false;
    this.flagshipGunAim = { x: 0, y: ARENA.maxY };
    this.flagshipGunPulseAccumulator = 0;
    this.flagshipGunPulseIndex = 0;
    this.flagshipGunBurstIndex = 0;
    this.flagshipBurstTacticalStacks = 0;
    this.tacticalEdgeStacks = 0;
    this.formationSystem.cooldownRemaining = 0;
    this.formationSystem.movingSlots.clear();
    this.formationSystem.dragState = null;
    this.formationSystem.setWorldOffset(0, 0);
    this.friendlies = this.createFleet();
    this.enemies = [];
    this.projectiles = [];
    this.telegraphs = [];
    this.events = [];
    this.progression.resetRun();
  }

  startRun() {
    this.resetToReady();
    this.status = 'running';
    this.beginNextWave();
    this.emit('runStarted', { wave: this.wave });
  }

  restartRun() {
    this.startRun();
  }

  createFleet() {
    const count = this.progression.upgrades.fleetSize;
    const commandIndex = Math.floor(count / 2);
    const fleet = Array.from({ length: count }, (_, index) => {
      const role = index === commandIndex ? 'command' : this.getFleetRole(index);
      return this.createFriendly(role, index);
    });
    let nextSlot = count;
    for (const [role, purchased] of Object.entries(this.progression.purchasedShips)) {
      for (let index = 0; index < purchased; index += 1) {
        fleet.push(this.createFriendly(role, nextSlot));
        nextSlot += 1;
      }
    }
    this.formationSystem.applyInitialPositions(fleet);
    return fleet;
  }

  createFriendly(role, slot) {
    const roleStats = this.getFriendlyBaseStats(role);
    const baseHealth = roleStats.health;
    const maxHealth = Math.round(baseHealth * this.progression.upgrades.durabilityMultiplier);
    const maxShield = this.progression.upgrades.getShieldFor(role);
    return {
      id: `friendly-${this.nextId++}`,
      faction: 'friendly',
      role,
      slot,
      inReserve: role !== 'command',
      x: 0,
      y: ARENA.commandY,
      health: maxHealth,
      maxHealth,
      shield: maxShield,
      maxShield,
      damage: roleStats.damage * this.progression.upgrades.shipDamageMultiplier,
      fireInterval: roleStats.fireInterval,
      fireCooldown: this.random() * 0.5,
      targetX: 0,
      targetY: ARENA.commandY,
      moving: false,
      dashing: false,
      alive: true,
    };
  }

  getEnemyFormationPositions(templateId, count) {
    const positionCount = Math.max(WAVE_FLOW.formationRevealMinimumSlots, count);
    const template = getStarterTemplatePositions(templateId, positionCount);
    const slotPriority = [3, 2, 4, 1, 5, 0, 6];
    const selected = count < WAVE_FLOW.formationRevealMinimumSlots
      ? slotPriority.slice(0, count).map((slot) => template.find((position) => position.slot === slot))
      : template.slice(0, count);
    const maximumTemplateX = Math.max(1, ...selected.map(({ x }) => Math.abs(x)));
    const horizontalScale = Math.min(
      1,
      (this.arena.maxX - WAVE_FLOW.formationHorizontalMargin) / maximumTemplateX,
    );
    return selected.map(({ x, y }) => ({
      x: x * horizontalScale,
      y: -y,
    }));
  }

  beginNextWave() {
    this.wave += 1;
    this.wavePhase = 'deployment';
    this.waveResolved = false;
    this.waveIntermission = 0;
    this.deploymentsRemaining = DEPLOYMENT_CAPACITY;
    this.advanceAvailable = false;
    this.flagshipPathBlockerIds = [];
    this.cancelFlagshipFire('wave-deployment');
    this.projectiles = [];
    this.telegraphs = [];
    this.formationSystem.setWorldOffset(0, 0);
    this.formationSystem.applyInitialPositions(this.friendlies);
    for (const ship of this.friendlies) ship.dashing = false;
    const stats = getEnemyStats(this.wave);
    const bossWave = isBossWave(this.wave);
    const count = bossWave ? 3 : getWaveEnemyCount(this.wave);
    this.enemyFormationId = FORMATION_ORDER[Math.min(
      FORMATION_ORDER.length - 1,
      Math.floor(this.random() * FORMATION_ORDER.length),
    )];
    const enemyPositions = this.getEnemyFormationPositions(this.enemyFormationId, count);

    const availableTypes = getAvailableEnemyTypes(this.wave);
    this.enemies = Array.from({ length: count }, (_, index) => {
      const position = enemyPositions[index];

      if (bossWave && index === 0) {
        const tier = Math.max(0, Math.floor(this.wave / BOSS.everyWaves) - 1);
        const health = Math.round(BOSS.baseHealth * BOSS.healthGrowth ** tier);
        return {
          id: `enemy-${this.nextId++}`,
          faction: 'enemy', role: 'boss', type: 'boss', boss: true, elite: false,
          x: position.x, y: position.y, originX: position.x,
          targetX: position.x, targetY: position.y - WAVE_FLOW.enemyAdvanceDistance,
          moving: false, phase: this.random() * TAU, drift: 2.2,
          health, maxHealth: health, speed: BOSS.speed + tier * 0.06,
          damage: Math.round(BOSS.damage * BOSS.damageGrowth ** tier),
          fireInterval: BOSS.fireInterval, fireCooldown: 1.15,
          reward: Math.round(BOSS.reward * (1 + tier * 0.35)),
          attackType: 'area', areaRadius: BOSS.areaRadius, scale: 2.35,
          majorAttack: 'boss', majorCooldown: TELEGRAPH_ATTACKS.initialDelay,
          majorPatternIndex: 0, exposedRemaining: 0, alive: true,
        };
      }

      const typeId = bossWave
        ? (index === 1 ? 'skirmisher' : 'artillery')
        : availableTypes[(index + this.wave) % availableTypes.length];
      const type = ENEMY_TYPES[typeId];
      const elite = !bossWave
        && this.wave >= ELITE.firstWave
        && this.wave % ELITE.everyWaves === 0
        && index === 0;
      const eliteHealth = elite ? ELITE.health : 1;
      const eliteDamage = elite ? ELITE.damage : 1;
      const eliteSpeed = elite ? ELITE.speed : 1;
      const eliteReward = elite ? ELITE.reward : 1;
      return {
        id: `enemy-${this.nextId++}`,
        faction: 'enemy',
        role: typeId,
        type: typeId,
        boss: false,
        elite,
        x: position.x,
        y: position.y,
        originX: position.x,
        targetX: position.x,
        targetY: position.y - WAVE_FLOW.enemyAdvanceDistance,
        moving: false,
        phase: this.random() * TAU,
        drift: type.drift * (1.2 + this.random() * 1.6),
        health: Math.round(stats.maxHealth * type.health * eliteHealth),
        maxHealth: Math.round(stats.maxHealth * type.health * eliteHealth),
        speed: stats.speed * type.speed * eliteSpeed * (0.9 + this.random() * 0.18),
        damage: stats.damage * type.damage * eliteDamage,
        fireInterval: stats.fireInterval * type.fireInterval * (0.88 + this.random() * 0.24),
        fireCooldown: 0.8 + this.random() * stats.fireInterval,
        reward: stats.reward * type.reward * eliteReward,
        attackType: type.attackType,
        majorAttack: type.majorAttack ?? null,
        majorCooldown: type.majorAttack
          ? TELEGRAPH_ATTACKS.initialDelay + this.random() * TELEGRAPH_ATTACKS.repeatJitter
          : Infinity,
        areaRadius: type.areaRadius ?? 0,
        scale: type.scale * (elite ? 1.22 : 1),
        exposedRemaining: 0,
        alive: true,
      };
    });

    this.emit('waveStarted', {
      wave: this.wave,
      enemyCount: count,
      formationId: this.enemyFormationId,
      formationName: FORMATIONS[this.enemyFormationId].name,
      enemyTypes: bossWave ? ['boss', 'skirmisher', 'artillery'] : availableTypes,
      isBoss: bossWave,
    });
    this.emit('enemyFormationRevealed', {
      wave: this.wave,
      formationId: this.enemyFormationId,
      formationName: FORMATIONS[this.enemyFormationId].name,
      enemyCount: count,
    });
    if (bossWave) this.emit('bossWaveStarted', { wave: this.wave, name: BOSS.name });
  }

  readyForBattle() {
    if (this.status !== 'running' || this.wavePhase !== 'deployment') {
      return { started: false, reason: 'inactive' };
    }
    if (this.formationSystem.dragState) this.commitShipDrag({ cancelled: true });
    this.wavePhase = 'approach';
    this.formationSystem.setWorldOffset(0, WAVE_FLOW.friendlyAdvanceDistance);
    const friendlyPaths = this.formationSystem.reflow(this.friendlies);
    for (const enemy of this.enemies) enemy.moving = true;
    this.emit('fleetsAdvancing', {
      wave: this.wave,
      formationId: this.enemyFormationId,
      friendlyPaths,
      enemyPaths: this.enemies.map((enemy) => ({
        shipId: enemy.id,
        from: { x: enemy.x, y: enemy.y },
        to: { x: enemy.targetX, y: enemy.targetY },
      })),
    });
    return { started: true };
  }

  updateFleetApproach(dt) {
    let enemiesArrived = true;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const arrived = moveTowards(
        enemy,
        { x: enemy.targetX, y: enemy.targetY },
        WAVE_FLOW.enemyApproachSpeed,
        dt,
      );
      enemiesArrived = enemiesArrived && arrived;
    }
    if (!enemiesArrived || this.formationSystem.isTransitioning) return;
    this.wavePhase = 'combat';
    for (const enemy of this.enemies) {
      enemy.originX = enemy.x;
      enemy.moving = false;
    }
    this.emit('fleetsEngaged', { wave: this.wave });
    this.updateAdvanceAvailability();
  }

  update(deltaSeconds) {
    if (this.suspended) return;

    const dt = clamp(deltaSeconds, 0, SIMULATION.maxDelta);
    if (dt === 0) return;
    if (this.status === 'ready') {
      this.formationSystem.update(this.friendlies, dt);
      return;
    }
    if (this.status !== 'running') return;
    this.elapsed += dt;

    if (this.wavePhase === 'intermission') {
      this.waveIntermission -= dt;
      if (this.waveIntermission <= 0) this.beginNextWave();
      return;
    }

    if (this.wavePhase === 'extraction') {
      this.updateFlagshipDash(dt);
      return;
    }

    this.updateFlagshipGun(dt);
    this.formationSystem.update(this.friendlies, dt);

    if (this.wavePhase === 'deployment') return;
    if (this.wavePhase === 'approach') {
      this.updateFleetApproach(dt);
      return;
    }
    if (this.wavePhase !== 'combat') return;

    this.updateFriendlies(dt);
    this.updateEnemies(dt);
    this.updateTelegraphs(dt);
    this.updateProjectiles(dt);
    this.removeDestroyedEntities();
    this.resolveWaveIfNeeded();
  }

  updateFriendlies(dt) {
    for (const ship of this.friendlies) {
      if (!ship.alive || ship.inReserve || ship.role === 'command') continue;
      ship.fireCooldown -= dt;
      if (ship.fireCooldown > 0) continue;

      const target = this.findAutoTarget(ship);
      if (!target) continue;

      ship.fireCooldown += ship.fireInterval
        / this.formationSystem.getFireRateMultiplier(this.friendlies)
        / this.progression.upgrades.autoFireRateMultiplier;
      this.spawnProjectile(ship, target, {
        faction: 'friendly',
        speed: FLEET.projectileSpeed,
        lifetime: FLEET.projectileLifetime,
        damage: ship.damage
          * this.formationSystem.getAutoDamageMultiplier(target, this.friendlies),
      });
    }
  }

  updateEnemies(dt) {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;

      if (enemy.boss && enemy.exposedRemaining > 0) {
        const before = enemy.exposedRemaining;
        enemy.exposedRemaining = Math.max(0, enemy.exposedRemaining - dt);
        if (before > 0 && enemy.exposedRemaining === 0) this.emit('bossBarrierRestored', { id: enemy.id });
      }

      enemy.x = clamp(
        enemy.originX + Math.sin(this.elapsed * 0.72 + enemy.phase) * enemy.drift,
        this.arena.minX + 3,
        this.arena.maxX - 3,
      );

      enemy.fireCooldown -= dt;
      if (enemy.majorAttack) {
        enemy.majorCooldown -= dt;
        if (enemy.majorCooldown <= 0) {
          this.beginEnemyMajorAttack(enemy);
          enemy.majorCooldown += TELEGRAPH_ATTACKS.repeatDelay
            + this.random() * TELEGRAPH_ATTACKS.repeatJitter;
        }
      }
      if (enemy.fireCooldown > 0) continue;

      const target = this.pickEnemyTarget(enemy);
      if (!target) continue;

      enemy.fireCooldown += enemy.fireInterval;
      this.spawnProjectile(enemy, target, {
        faction: 'enemy',
        speed: ENEMIES.projectileSpeed,
        lifetime: ENEMIES.projectileLifetime,
        damage: enemy.damage,
        areaRadius: 0,
      });
    }
  }

  beginEnemyMajorAttack(enemy) {
    const majorAttack = enemy.majorAttack ?? (enemy.boss ? 'boss' : null);
    if (!majorAttack) return;
    const patterns = majorAttack === 'boss'
      ? [
          ['artillery'],
          ['skirmisher'],
          ['bulwark'],
          ['artillery', 'skirmisher'],
        ][enemy.majorPatternIndex++ % 4]
      : [majorAttack];
    for (const pattern of patterns) this.createTelegraph(enemy, pattern);
  }

  createTelegraph(enemy, pattern) {
    const target = this.pickEnemyTarget(enemy);
    if (!target) return null;
    const definition = TELEGRAPH_ATTACKS[pattern];
    const warning = enemy.boss ? TELEGRAPH_ATTACKS.boss.warning : definition.warning;
    const damageMultiplier = enemy.boss
      ? TELEGRAPH_ATTACKS.boss.damageMultiplier
      : definition.damageMultiplier;
    const telegraph = {
      id: `telegraph-${this.nextId++}`,
      sourceEnemyId: enemy.id,
      sourceRole: enemy.role,
      kind: definition.kind,
      remaining: warning,
      duration: warning,
      damage: enemy.damage * damageMultiplier,
    };
    if (definition.kind === 'blast') {
      Object.assign(telegraph, { x: target.x, y: target.y, radius: definition.radius });
    } else {
      const direction = normalizedVelocity(enemy, target, 1);
      const end = {
        x: enemy.x + direction.vx * 220,
        y: enemy.y + direction.vy * 220,
      };
      Object.assign(telegraph, {
        source: { x: enemy.x, y: enemy.y },
        target: end,
        width: definition.width,
        lockedTargetId: target.id,
      });
    }
    this.telegraphs.push(telegraph);
    this.emit('telegraphStarted', { ...telegraph });
    return telegraph;
  }

  updateTelegraphs(dt) {
    const active = [];
    for (const telegraph of this.telegraphs) {
      telegraph.remaining -= dt;
      if (telegraph.remaining > 0) {
        active.push(telegraph);
        continue;
      }
      this.resolveTelegraph(telegraph);
      if (this.status !== 'running') break;
    }
    this.telegraphs = this.status === 'running' ? active : [];
  }

  resolveTelegraph(telegraph) {
    const targets = this.friendlies.filter((ship) => ship.alive && !ship.inReserve);
    const hitTargets = targets.filter((ship) => {
      if (telegraph.kind === 'blast') {
        return distanceSquared(ship, telegraph) <= telegraph.radius ** 2;
      }
      return distanceToSegment(ship, telegraph.source, telegraph.target) <= telegraph.width / 2;
    });
    for (const target of hitTargets) this.damageEntity(target, telegraph.damage, `telegraph-${telegraph.kind}`);
    this.emit('telegraphResolved', {
      ...telegraph,
      hitIds: hitTargets.map((target) => target.id),
      evaded: hitTargets.length === 0,
    });
    if (telegraph.kind === 'blast') {
      this.emit('areaImpact', {
        x: telegraph.x,
        y: telegraph.y,
        radius: telegraph.radius,
        faction: 'enemy',
      });
    }
    if (hitTargets.length === 0 && this.status === 'running' && this.wavePhase === 'combat') {
      this.grantTacticalEdge(telegraph);
    }
  }

  grantTacticalEdge(telegraph) {
    const previous = this.tacticalEdgeStacks;
    this.tacticalEdgeStacks = Math.min(TACTICAL_EDGE.maximumStacks, previous + 1);
    this.emit('telegraphEvaded', { id: telegraph.id, kind: telegraph.kind });
    if (this.tacticalEdgeStacks !== previous) {
      this.emit('tacticalEdgeChanged', { stacks: this.tacticalEdgeStacks, gained: 1 });
    }
  }

  updateProjectiles(dt) {
    for (const projectile of this.projectiles) {
      if (!projectile.alive) continue;
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.lifetime -= dt;

      if (projectile.lifetime <= 0
        || projectile.x < this.arena.minX - 22
        || projectile.x > this.arena.maxX + 22
        || projectile.y < this.arena.minY - 17
        || projectile.y > this.arena.maxY + 17) {
        projectile.alive = false;
        continue;
      }

      const targets = projectile.faction === 'friendly' ? this.enemies : this.friendlies;
      const hitTarget = targets.find(
        (target) => target.alive && distanceSquared(projectile, target) <= SIMULATION.projectileHitRadius ** 2,
      );

      if (hitTarget) {
        projectile.alive = false;
        if (projectile.areaRadius > 0) {
          for (const target of targets) {
            if (!target.alive || distanceSquared(target, hitTarget) > projectile.areaRadius ** 2) continue;
            const distance = Math.sqrt(distanceSquared(target, hitTarget));
            const falloff = 1 - 0.42 * (distance / projectile.areaRadius);
            this.damageEntity(target, projectile.damage * falloff, 'area');
          }
          this.emit('areaImpact', {
            x: hitTarget.x,
            y: hitTarget.y,
            radius: projectile.areaRadius,
            faction: projectile.faction,
          });
        } else {
          this.damageEntity(hitTarget, projectile.damage, 'projectile');
        }
        this.emit('impact', {
          x: projectile.x,
          y: projectile.y,
          faction: projectile.faction,
          targetId: hitTarget.id,
        });
      }
    }

    this.projectiles = this.projectiles.filter((projectile) => projectile.alive);
  }

  beginFlagshipFire(x, y, { automatic = false } = {}) {
    const aim = {
      x: clamp(x, this.arena.minX, this.arena.maxX),
      y: clamp(y, this.arena.minY, this.arena.maxY),
    };

    if (this.status !== 'running' || this.suspended || this.wavePhase !== 'combat') {
      return { firing: false, reason: 'inactive', target: aim };
    }

    if (this.flagshipGunFiring) {
      if (!automatic && this.progression.upgrades.automatedGunnery) {
        this.flagshipGunManualControl = true;
        this.flagshipGunAim = aim;
        this.emit('flagshipGunAimChanged', { ...aim, manual: true });
        return { firing: true, override: true, target: aim };
      }
      return { firing: false, reason: 'already-firing', target: aim };
    }

    const requiresFullCharge = automatic
      && this.flagshipGunEnergy < FLAGSHIP_GUN.firingDuration - 0.0001;
    if (this.flagshipGunEnergy <= 0 || requiresFullCharge) {
      this.emit('flagshipGunRejected', { ...aim, remaining: this.getFlagshipGunRechargeRemaining() });
      return { firing: false, reason: 'cooldown', target: aim };
    }

    this.flagshipGunFiring = true;
    this.flagshipGunManualControl = !automatic;
    this.flagshipGunAim = aim;
    this.flagshipGunPulseAccumulator = 0;
    this.flagshipGunBurstIndex = 0;
    this.flagshipBurstTacticalStacks = this.tacticalEdgeStacks;
    if (this.flagshipBurstTacticalStacks > 0) {
      this.tacticalEdgeStacks = 0;
      this.emit('tacticalEdgeConsumed', {
        stacks: this.flagshipBurstTacticalStacks,
        damageBonus: this.flagshipBurstTacticalStacks * TACTICAL_EDGE.damagePerStack,
        criticalChanceBonus: this.flagshipBurstTacticalStacks * TACTICAL_EDGE.criticalChancePerStack,
      });
    }
    this.emit('flagshipGunStarted', {
      ...aim,
      automatic,
      tacticalEdgeStacks: this.flagshipBurstTacticalStacks,
    });
    this.fireAndConsumeFlagshipGunPulse();
    return { firing: true, automatic, target: aim };
  }

  aimFlagshipFire(x, y) {
    if (!this.flagshipGunFiring || !this.flagshipGunManualControl) return false;
    this.flagshipGunAim = {
      x: clamp(x, this.arena.minX, this.arena.maxX),
      y: clamp(y, this.arena.minY, this.arena.maxY),
    };
    this.emit('flagshipGunAimChanged', { ...this.flagshipGunAim, manual: true });
    return true;
  }

  endFlagshipFire() {
    if (!this.flagshipGunFiring || !this.flagshipGunManualControl) return false;
    this.flagshipGunManualControl = false;
    if (this.progression.upgrades.automatedGunnery && this.enemies.some((enemy) => enemy.alive)) {
      this.emit('flagshipGunAimChanged', { manual: false });
      return true;
    }
    return this.cancelFlagshipFire('released');
  }

  cancelFlagshipFire(reason = 'cancelled') {
    if (!this.flagshipGunFiring) return false;
    this.flagshipGunFiring = false;
    this.flagshipGunManualControl = false;
    this.emit('flagshipGunStopped', {
      reason,
      energyRatio: this.getFlagshipGunEnergyRatio(),
      rechargeRemaining: this.getFlagshipGunRechargeRemaining(),
    });
    this.flagshipGunBurstIndex = 0;
    this.flagshipBurstTacticalStacks = 0;
    return true;
  }

  updateFlagshipGun(dt) {
    if (this.flagshipGunFiring) {
      if (!this.flagshipGunManualControl && this.progression.upgrades.automatedGunnery) {
        const target = this.findAutomaticGunTarget();
        if (target) this.flagshipGunAim = { x: target.x, y: target.y };
      }

      this.flagshipGunPulseAccumulator += dt;
      while (this.flagshipGunPulseAccumulator >= FLAGSHIP_GUN.pulseInterval) {
        this.flagshipGunPulseAccumulator -= FLAGSHIP_GUN.pulseInterval;
        this.fireAndConsumeFlagshipGunPulse();
        if (!this.flagshipGunFiring || this.wavePhase !== 'combat' || this.status !== 'running') break;
      }
      if (this.flagshipGunFiring && (this.wavePhase !== 'combat' || this.status !== 'running')) {
        this.cancelFlagshipFire(this.flagshipGunEnergy <= 0 ? 'depleted' : 'inactive');
      }
      return;
    }

    if (this.flagshipGunEnergy < FLAGSHIP_GUN.firingDuration) {
      const previousEnergy = this.flagshipGunEnergy;
      this.flagshipGunEnergy = Math.min(
        FLAGSHIP_GUN.firingDuration,
        this.flagshipGunEnergy + dt * FLAGSHIP_GUN.firingDuration / this.getFlagshipGunCooldown(),
      );
      if (previousEnergy < FLAGSHIP_GUN.firingDuration && this.flagshipGunEnergy >= FLAGSHIP_GUN.firingDuration) {
        const flagship = this.getCommandShip();
        this.emit('flagshipGunReady', { x: flagship?.x ?? 0, y: flagship?.y ?? ARENA.commandY });
      }
      return;
    }

    if (this.progression.upgrades.automatedGunnery
      && this.status === 'running'
      && this.wavePhase === 'combat') {
      const target = this.findAutomaticGunTarget();
      if (target) this.beginFlagshipFire(target.x, target.y, { automatic: true });
    }
  }

  fireAndConsumeFlagshipGunPulse() {
    if (!this.flagshipGunFiring || this.flagshipGunEnergy <= 0) return false;
    const energyCost = Math.min(FLAGSHIP_GUN.pulseInterval, this.flagshipGunEnergy);
    const energyFraction = energyCost / FLAGSHIP_GUN.pulseInterval;
    this.flagshipGunEnergy = Math.max(0, this.flagshipGunEnergy - energyCost);
    this.fireFlagshipGunPulse(energyFraction);
    if (this.flagshipGunEnergy <= 0 && this.flagshipGunFiring) this.cancelFlagshipFire('depleted');
    return true;
  }

  fireFlagshipGunPulse(energyFraction = 1) {
    const formation = this.formationSystem.current;
    const formationModifiers = this.formationSystem.getModifiers(this.friendlies);
    const shotHalfWidth = FLAGSHIP_GUN.shotHalfWidth;
    const maximumBurstPulses = Math.round(FLAGSHIP_GUN.firingDuration / FLAGSHIP_GUN.pulseInterval);
    this.flagshipGunBurstIndex += 1;
    const burstProgress = maximumBurstPulses <= 1
      ? 1
      : clamp((this.flagshipGunBurstIndex - 1) / (maximumBurstPulses - 1), 0, 1);
    const damageMultiplier = FLAGSHIP_GUN.burstStartDamageMultiplier
      + (FLAGSHIP_GUN.burstEndDamageMultiplier - FLAGSHIP_GUN.burstStartDamageMultiplier) * burstProgress;
    const baseCriticalChance = FLAGSHIP_GUN.criticalStartChance
      + (FLAGSHIP_GUN.criticalEndChance - FLAGSHIP_GUN.criticalStartChance) * burstProgress;
    const tacticalDamageMultiplier = 1
      + this.flagshipBurstTacticalStacks * TACTICAL_EDGE.damagePerStack;
    const criticalChance = clamp(
      baseCriticalChance
        + this.flagshipBurstTacticalStacks * TACTICAL_EDGE.criticalChancePerStack,
      0,
      1,
    );
    const pulseDamage = FLAGSHIP_GUN.damagePerSecond * FLAGSHIP_GUN.pulseInterval
      * (1 + formationModifiers.flagshipDamageBonus)
      * this.progression.upgrades.volleyDamageMultiplier
      * damageMultiplier
      * tacticalDamageMultiplier
      * energyFraction;
    const flagship = this.getCommandShip();
    const source = { x: flagship?.x ?? 0, y: flagship?.y ?? ARENA.commandY };
    const aimDx = this.flagshipGunAim.x - source.x;
    const aimDy = this.flagshipGunAim.y - source.y;
    const aimLength = Math.hypot(aimDx, aimDy);
    const direction = aimLength > 0.001
      ? { x: aimDx / aimLength, y: aimDy / aimLength }
      : { x: 0, y: 1 };
    const boundaryDistance = rayExitDistance(source, direction, this.arena);
    const maximumGunRange = FLEET.effectiveRange
      * this.formationSystem.getRangeMultiplier(this.friendlies);
    const maximumShotDistance = Math.min(boundaryDistance, maximumGunRange);
    let shotDistance = maximumShotDistance;
    let firstHit = null;

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const relativeX = enemy.x - source.x;
      const relativeY = enemy.y - source.y;
      const distanceAlongRay = relativeX * direction.x + relativeY * direction.y;
      if (distanceAlongRay <= 0 || distanceAlongRay > maximumShotDistance) continue;

      const perpendicularDistance = Math.abs(relativeX * direction.y - relativeY * direction.x);
      const contactRadius = enemyHullRadius(enemy) + shotHalfWidth;
      if (perpendicularDistance > contactRadius) continue;

      const entryDistance = distanceAlongRay
        - Math.sqrt(Math.max(0, contactRadius ** 2 - perpendicularDistance ** 2));
      if (entryDistance >= shotDistance) continue;
      shotDistance = Math.max(0, entryDistance);
      firstHit = enemy;
    }

    const endpoint = {
      x: source.x + direction.x * shotDistance,
      y: source.y + direction.y * shotDistance,
    };
    const critical = Boolean(firstHit && this.random() < criticalChance);
    const damage = firstHit
      ? pulseDamage * (critical ? FLAGSHIP_GUN.criticalDamageMultiplier : 1)
      : 0;
    this.flagshipGunPulseIndex += 1;
    this.emit('flagshipGunPulse', {
      ...endpoint,
      aim: { ...this.flagshipGunAim },
      direction,
      shotHalfWidth,
      formationId: formation.id,
      source,
      hitId: firstHit?.id ?? null,
      pulseIndex: this.flagshipGunPulseIndex,
      burstIndex: this.flagshipGunBurstIndex,
      damageMultiplier,
      tacticalDamageMultiplier,
      tacticalEdgeStacks: this.flagshipBurstTacticalStacks,
      criticalChance,
      critical,
      energyFraction,
      damage,
      manual: this.flagshipGunManualControl,
    });

    if (firstHit) {
      if (firstHit.boss) {
        const wasProtected = firstHit.exposedRemaining <= 0;
        firstHit.exposedRemaining = BOSS.exposureDuration;
        if (wasProtected) this.emit('bossExposed', { id: firstHit.id, x: firstHit.x, y: firstHit.y });
      }
      this.damageEntity(firstHit, damage, 'flagshipGun', { critical });
    }

    this.removeDestroyedEntities();
    this.resolveWaveIfNeeded();
    return { endpoint, hitId: firstHit?.id ?? null };
  }

  changeFormation(formationId) {
    if (!this.canEditFormation()) {
      return { changed: false, reason: 'inactive' };
    }
    const ignoreCooldown = this.status === 'ready'
      || ['deployment', 'intermission'].includes(this.wavePhase);
    const result = this.formationSystem.applyTemplate(formationId, this.friendlies, {
      ignoreCooldown,
    });
    if (result.changed) {
      this.emit('formationChanged', {
        formationId,
        formation: result.formation ?? this.formationSystem.current,
        paths: result.paths,
      });
      this.onStateChange();
    }
    return result;
  }

  activateFormationLoadout(index) {
    if (!this.canEditFormation()) {
      return { changed: false, reason: 'inactive' };
    }
    const ignoreCooldown = this.status === 'ready'
      || ['deployment', 'intermission'].includes(this.wavePhase);
    const result = this.formationSystem.activateLoadout(index, this.friendlies, { ignoreCooldown });
    if (result.changed) {
      this.emit('loadoutActivated', {
        loadoutIndex: result.loadoutIndex,
        loadout: result.loadout,
        paths: result.paths,
      });
      this.onStateChange();
    }
    return result;
  }

  applyFormationTemplate(templateId) {
    return this.changeFormation(templateId);
  }

  canEditFormation() {
    if (this.status === 'ready') return true;
    return ['running', 'paused'].includes(this.status)
      && ['deployment', 'combat'].includes(this.wavePhase);
  }

  isFormationEditingPoint(y) {
    return this.canEditFormation() && this.formationSystem.isFleetZonePoint(y);
  }

  beginShipDrag(x, y) {
    if (!this.canEditFormation() || this.status === 'paused' || this.suspended) {
      return { dragging: false, reason: 'inactive' };
    }
    const candidates = this.friendlies
      .filter((ship) => ship.alive && !ship.inReserve && ship.role !== 'command')
      .map((ship) => ({ ship, distance: Math.hypot(ship.x - x, ship.y - y) }))
      .filter(({ distance: separation }) => separation <= FORMATION_EDITOR.shipPickRadius)
      .sort((left, right) => left.distance - right.distance);
    const ship = candidates[0]?.ship;
    if (!ship) return { dragging: false, reason: 'no-ship' };
    const preview = this.formationSystem.previewPlacement(ship.slot, ship.x, ship.y, this.friendlies);
    this.emit('formationDragStarted', { shipId: ship.id, slot: ship.slot });
    return { dragging: true, shipId: ship.id, slot: ship.slot, preview };
  }

  deployShipType(role) {
    if (this.status !== 'running' || this.wavePhase !== 'deployment' || this.suspended) {
      return { changed: false, reason: 'inactive' };
    }
    if (this.deploymentsRemaining <= 0) return { changed: false, reason: 'capacity' };
    const ship = this.friendlies.find((candidate) => candidate.role === role
      && candidate.alive && candidate.inReserve);
    if (!ship) return { changed: false, reason: 'none-available' };
    const positions = this.formationSystem.getPositionsForFleet(this.friendlies);
    const target = positions[this.friendlies.indexOf(ship)];
    ship.inReserve = false;
    this.deploymentsRemaining -= 1;
    const path = this.formationSystem.moveShip(ship, target);
      this.emit('formationShipDeployed', { shipId: ship.id, role, slot: ship.slot, path });
    this.onStateChange();
    return { changed: true, role, slot: ship.slot, path };
  }

  buyShipType(role) {
    if (!SHIP_PURCHASE_COSTS[role]) return { purchased: false, reason: 'unknown-ship' };
    const result = this.progression.buyShip(role);
    if (!result.purchased) return result;
    const slot = Math.max(-1, ...this.friendlies.map((ship) => ship.slot)) + 1;
    const ship = this.createFriendly(role, slot);
    this.friendlies.push(ship);
    this.formationSystem.ensureFleetSlots(this.friendlies);
    this.emit('friendlyJoined', { id: ship.id, role, x: ship.x, y: ship.y });
    this.onStateChange();
    return { ...result, ship };
  }

  beginShipDragBySlot(slot) {
    const ship = this.friendlies.find((candidate) => candidate.slot === slot && candidate.alive);
    if (!ship || !this.canEditFormation() || this.status === 'paused' || this.suspended) {
      return { dragging: false, reason: 'inactive' };
    }
    this.formationSystem.previewPlacement(slot, ship.x, ship.y, this.friendlies);
    this.emit('formationDragStarted', { shipId: ship.id, slot });
    return { dragging: true, shipId: ship.id, slot };
  }

  previewShipDrag(x, y) {
    if (!this.formationSystem.dragState) return { dragging: false, reason: 'no-drag' };
    const preview = this.formationSystem.previewPlacement(
      this.formationSystem.dragState.slot,
      x,
      y,
      this.friendlies,
    );
    this.emit('formationDragPreviewed', { ...preview });
    return { dragging: true, preview };
  }

  commitShipDrag({ cancelled = false } = {}) {
    const result = cancelled
      ? this.formationSystem.cancelPlacement()
      : this.formationSystem.commitPlacement(this.friendlies);
    if (result.changed) {
      this.emit('formationShipMoved', {
        slot: result.slot,
        position: result.position,
        paths: [result.path, result.swappedPath].filter(Boolean),
      });
      this.onStateChange();
    } else if (result.reason !== 'cancelled') {
      this.emit('formationPlacementRejected', {
        reason: result.reason,
        candidate: result.preview?.candidate,
      });
    }
    return result;
  }

  purchaseUpgrade(upgradeId) {
    const result = this.progression.purchaseUpgrade(upgradeId);
    if (!result.purchased) return result;
    this.applyFleetUpgrades(upgradeId);
    this.emit('upgradePurchased', {
      ...result,
      upgrade: this.progression.upgrades.snapshot().find(({ id }) => id === upgradeId),
    });
    return result;
  }

  resetUpgrades() {
    const result = this.progression.resetUpgrades();
    if (!result.reset) return result;
    this.applyFleetUpgrades();
    this.emit('upgradesReset', { refund: result.refund });
    return result;
  }

  applyFleetUpgrades(purchasedId) {
    this.formationSystem.setCommandNetworkLevel(this.progression.upgrades.commandNetworkLevel);
    const desiredCount = this.progression.upgrades.fleetSize;
    if (this.friendlies.length > desiredCount) {
      this.friendlies = this.friendlies.filter((ship) => ship.role === 'command' || ship.slot < desiredCount);
    }
    if (purchasedId === 'fleetSize') {
      const slot = desiredCount - 1;
      if (!this.friendlies.some((ship) => ship.slot === slot)) {
        const ship = this.createFriendly(this.getFleetRole(slot), slot);
        this.friendlies.push(ship);
        this.emit('friendlyJoined', { id: ship.id, x: ship.x, y: ship.y });
      }
    }

    for (const ship of this.friendlies) {
      const roleStats = this.getFriendlyBaseStats(ship.role);
      const baseHealth = roleStats.health;
      const nextMaxHealth = Math.round(baseHealth * this.progression.upgrades.durabilityMultiplier);
      if (nextMaxHealth > ship.maxHealth) ship.health += nextMaxHealth - ship.maxHealth;
      ship.maxHealth = nextMaxHealth;
      ship.damage = roleStats.damage * this.progression.upgrades.shipDamageMultiplier;

      const nextMaxShield = this.progression.upgrades.getShieldFor(ship.role);
      if (nextMaxShield > ship.maxShield) ship.shield += nextMaxShield - ship.maxShield;
      ship.maxShield = nextMaxShield;
    }

    if (purchasedId === 'fleetSize') {
      const paths = this.formationSystem.reflow(this.friendlies);
      this.emit('formationChanged', {
        formationId: this.formationSystem.currentId,
        formation: this.formationSystem.current,
        paths,
      });
    }
  }

  openShop() {
    if (!['ready', 'running', 'paused', 'gameOver'].includes(this.status)) return false;
    this.cancelFlagshipFire('shop-opened');
    if (this.formationSystem.dragState) this.commitShipDrag({ cancelled: true });
    this.preShopStatus = this.status;
    this.status = 'shopping';
    this.emit('shopOpened', {});
    return true;
  }

  closeShop() {
    if (this.status !== 'shopping') return false;
    this.status = this.preShopStatus === 'paused' ? 'paused' : this.preShopStatus;
    this.emit('shopClosed', { status: this.status });
    return true;
  }

  spawnProjectile(source, target, options) {
    const velocity = normalizedVelocity(source, target, options.speed);
    const projectile = {
      id: `projectile-${this.nextId++}`,
      sourceId: source.id,
      sourceRole: source.role,
      faction: options.faction,
      x: source.x,
      y: source.y + (options.faction === 'friendly' ? 2.2 : -2.2),
      vx: velocity.vx,
      vy: velocity.vy,
      damage: options.damage,
      areaRadius: options.areaRadius ?? 0,
      lifetime: options.lifetime,
      alive: true,
    };
    this.projectiles.push(projectile);
    this.emit('projectileFired', { ...projectile });
  }

  damageEntity(entity, amount, source, { critical = false } = {}) {
    if (!entity?.alive || amount <= 0) return;
    let adjustedAmount = entity.faction === 'friendly'
      ? amount * this.formationSystem.getIncomingDamageMultiplier(entity, this.friendlies)
      : amount;
    if (entity.boss && source === 'projectile' && entity.exposedRemaining <= 0) {
      adjustedAmount *= 1 - BOSS.barrierReduction;
      this.emit('bossBarrierImpact', { id: entity.id, x: entity.x, y: entity.y });
    }
    if (entity.faction === 'friendly' && entity.shield > 0) {
      const absorbed = Math.min(entity.shield, adjustedAmount);
      entity.shield -= absorbed;
      adjustedAmount -= absorbed;
      this.emit('shieldImpact', {
        id: entity.id,
        x: entity.x,
        y: entity.y,
        absorbed,
        shield: entity.shield,
      });
      if (adjustedAmount <= 0) return;
    }
    entity.health = Math.max(0, entity.health - adjustedAmount);
    this.emit('damaged', {
      id: entity.id,
      faction: entity.faction,
      x: entity.x,
      y: entity.y,
      amount: adjustedAmount,
      source,
      critical: Boolean(critical),
      health: entity.health,
    });

    if (entity.health > 0) return;
    entity.alive = false;
    this.emit('destroyed', {
      id: entity.id,
      faction: entity.faction,
      role: entity.role,
      x: entity.x,
      y: entity.y,
    });

    if (entity.faction === 'enemy') {
      this.progression.recordEnemyDestroyed(entity.reward);
    } else if (entity.role === 'command') {
      this.endRun();
    }
  }

  removeDestroyedEntities() {
    this.enemies = this.enemies.filter((enemy) => enemy.alive);
    this.friendlies = this.friendlies.filter((ship) => ship.alive);
  }

  resolveWaveIfNeeded() {
    if (this.status !== 'running' || this.wavePhase !== 'combat') return;
    if (!this.enemies.some((enemy) => enemy.alive)) {
      this.advanceToNextWave({ automatic: true });
      return;
    }
    this.updateAdvanceAvailability();
  }

  getFlagshipPathBlockers() {
    const command = this.getCommandShip();
    if (!command?.alive || this.wavePhase !== 'combat') return [];
    return this.enemies.filter((enemy) => enemy.alive
      && enemy.y > command.y
      && Math.abs(enemy.x - command.x)
        <= enemyHullRadius(enemy) + WAVE_FLOW.flagshipPathHalfWidth);
  }

  updateAdvanceAvailability() {
    if (this.wavePhase !== 'combat') {
      this.advanceAvailable = false;
      this.flagshipPathBlockerIds = [];
      return false;
    }
    const blockers = this.getFlagshipPathBlockers();
    const available = blockers.length === 0;
    const changed = available !== this.advanceAvailable;
    this.advanceAvailable = available;
    this.flagshipPathBlockerIds = blockers.map(({ id }) => id);
    if (changed) {
      this.emit(available ? 'flagshipPathCleared' : 'flagshipPathBlocked', {
        wave: this.wave,
        blockerIds: [...this.flagshipPathBlockerIds],
        remainingEnemies: this.enemies.filter((enemy) => enemy.alive).length,
      });
    }
    return available;
  }

  advanceToNextWave({ automatic = false } = {}) {
    if (this.status !== 'running' || this.wavePhase !== 'combat') {
      return { advancing: false, reason: 'inactive' };
    }
    if (!this.updateAdvanceAvailability()) {
      return {
        advancing: false,
        reason: 'blocked',
        blockerIds: [...this.flagshipPathBlockerIds],
      };
    }
    const command = this.getCommandShip();
    if (!command) return { advancing: false, reason: 'no-flagship' };
    this.cancelFlagshipFire('advancing');
    for (const telegraph of this.telegraphs) this.emit('telegraphCancelled', { id: telegraph.id });
    this.telegraphs = [];
    this.projectiles = [];
    this.wavePhase = 'extraction';
    this.advanceAvailable = false;
    command.dashing = true;
    command.moving = true;
    this.flagshipDashTarget = {
      x: command.x,
      y: this.arena.maxY + WAVE_FLOW.flagshipExitPadding,
    };
    this.emit('flagshipAdvanceStarted', {
      wave: this.wave,
      remainingEnemies: this.enemies.filter((enemy) => enemy.alive).length,
      automatic,
      path: {
        shipId: command.id,
        from: { x: command.x, y: command.y },
        to: { ...this.flagshipDashTarget },
      },
    });
    return { advancing: true, remainingEnemies: this.enemies.length };
  }

  updateFlagshipDash(dt) {
    const command = this.getCommandShip();
    if (!command || !this.flagshipDashTarget) return;
    const arrived = moveTowards(
      command,
      this.flagshipDashTarget,
      WAVE_FLOW.flagshipDashSpeed,
      dt,
    );
    if (!arrived) return;
    command.dashing = false;
    this.completeWave();
  }

  completeWave() {
    if (this.waveResolved) return;
    const remainingEnemies = this.enemies.filter((enemy) => enemy.alive).length;
    this.waveResolved = true;
    this.wavePhase = 'intermission';
    this.waveIntermission = WAVES.intermission;
    this.flagshipDashTarget = null;
    this.advanceAvailable = false;
    this.flagshipPathBlockerIds = [];
    this.enemies = [];
    this.projectiles = [];
    this.telegraphs = [];
    const reward = WAVES.clearRewardBase + this.wave * 3;
    const creditedReward = this.progression.recordWaveCleared(this.wave, reward);
    this.emit('flagshipAdvanceCompleted', { wave: this.wave });
    this.emit('waveCleared', {
      wave: this.wave,
      reward: creditedReward,
      remainingEnemies,
    });
  }

  endRun() {
    if (this.status === 'gameOver') return;
    this.cancelFlagshipFire('game-over');
    this.status = 'gameOver';
    this.wavePhase = 'gameOver';
    this.projectiles = [];
    this.telegraphs = [];
    this.tacticalEdgeStacks = 0;
    this.flagshipBurstTacticalStacks = 0;
    this.emit('gameOver', {
      wave: this.wave,
      progression: this.progression.snapshot(),
    });
  }

  togglePause() {
    if (this.status === 'running') {
      this.cancelFlagshipFire('paused');
      if (this.formationSystem.dragState) this.commitShipDrag({ cancelled: true });
      this.status = 'paused';
      this.emit('paused', {});
      return true;
    }
    if (this.status === 'paused') {
      this.status = 'running';
      this.emit('resumed', {});
      return false;
    }
    return this.status === 'paused';
  }

  setSuspended(suspended) {
    this.suspended = suspended;
  }

  findNearest(source, candidates, range) {
    const maximum = range * range;
    let best = null;
    let bestDistance = maximum;
    for (const candidate of candidates) {
      if (!candidate.alive) continue;
      const candidateDistance = distanceSquared(source, candidate);
      if (candidateDistance < bestDistance) {
        best = candidate;
        bestDistance = candidateDistance;
      }
    }
    return best;
  }

  findAutoTarget(source) {
    const range = FLEET.effectiveRange
      * this.formationSystem.getRangeMultiplier(this.friendlies);

    const candidates = this.enemies
      .filter((enemy) => enemy.alive && distanceSquared(source, enemy) <= range * range)
      .sort((left, right) => {
        const leftSide = Math.abs(left.x) >= this.arena.maxX * 0.42 ? 0 : 1;
        const rightSide = Math.abs(right.x) >= this.arena.maxX * 0.42 ? 0 : 1;
        return leftSide - rightSide || distanceSquared(source, left) - distanceSquared(source, right);
      });
    return candidates[0] ?? null;
  }

  findAutomaticGunTarget() {
    const command = this.getCommandShip();
    if (!command?.alive) return null;
    const range = FLEET.effectiveRange
      * this.formationSystem.getRangeMultiplier(this.friendlies);
    return this.enemies
      .filter((enemy) => enemy.alive && distanceSquared(command, enemy) <= range * range)
      .sort((left, right) => {
        const priority = (enemy) => enemy.boss ? 0 : enemy.elite ? 1 : enemy.type === 'artillery' ? 2 : 3;
        return priority(left) - priority(right) || left.y - right.y;
      })[0] ?? null;
  }

  pickEnemyTarget(enemy) {
    const maximumDistance = ENEMIES.effectiveRange ** 2;
    const alive = this.friendlies.filter((ship) => ship.alive && !ship.inReserve
      && distanceSquared(enemy, ship) <= maximumDistance);
    if (alive.length === 0) return null;
    const command = alive.find((ship) => ship.role === 'command');
    if (command && this.random() < 0.38) return command;
    return this.findNearest(enemy, alive, ENEMIES.effectiveRange) ?? command;
  }

  getCommandShip() {
    return this.friendlies.find((ship) => ship.role === 'command') ?? null;
  }

  getFleetRole(slot) {
    if (slot === 7) return 'lancer';
    if (slot === 8) return 'guardian';
    if (slot > 8) return slot % 2 === 1 ? 'lancer' : 'guardian';
    return 'escort';
  }

  getFriendlyBaseStats(role) {
    if (role === 'command') {
      return { health: FLEET.commandHealth, damage: FLEET.commandDamage, fireInterval: FLEET.commandFireInterval };
    }
    if (role === 'lancer') {
      return {
        health: FLEET.lancerHealth,
        damage: FLEET.lancerDamage,
        fireInterval: FLEET.lancerFireInterval,
      };
    }
    if (role === 'guardian') {
      return {
        health: FLEET.guardianHealth,
        damage: FLEET.guardianDamage,
        fireInterval: FLEET.guardianFireInterval,
      };
    }
    return { health: FLEET.escortHealth, damage: FLEET.escortDamage, fireInterval: FLEET.escortFireInterval };
  }

  getSnapshot() {
    const command = this.getCommandShip();
    return {
      status: this.status,
      elapsed: this.elapsed,
      wave: this.wave,
      waveIntermission: this.waveIntermission,
      deployment: {
        remaining: this.deploymentsRemaining,
        capacity: DEPLOYMENT_CAPACITY,
      },
      waveState: {
        phase: this.wavePhase,
        enemyFormationId: this.enemyFormationId,
        enemyFormationName: this.enemyFormationId
          ? FORMATIONS[this.enemyFormationId]?.name ?? this.enemyFormationId
          : null,
        canReady: this.status === 'running' && this.wavePhase === 'deployment',
        canAdvance: this.status === 'running'
          && this.wavePhase === 'combat'
          && this.advanceAvailable,
        pathBlockerIds: [...this.flagshipPathBlockerIds],
        remainingEnemies: this.enemies.filter((enemy) => enemy.alive).length,
        weaponRange: FLEET.effectiveRange,
      },
      flagshipGun: {
        energy: this.flagshipGunEnergy,
        energyRatio: this.getFlagshipGunEnergyRatio(),
        firing: this.flagshipGunFiring,
        manualControl: this.flagshipGunManualControl,
        recharging: !this.flagshipGunFiring && this.flagshipGunEnergy < FLAGSHIP_GUN.firingDuration,
        rechargeRemaining: this.getFlagshipGunRechargeRemaining(),
        maximumDuration: FLAGSHIP_GUN.firingDuration,
        fullRecharge: this.getFlagshipGunCooldown(),
        automated: this.progression.upgrades.automatedGunnery,
        aim: { ...this.flagshipGunAim },
        pulseIndex: this.flagshipGunPulseIndex,
        burstIndex: this.flagshipGunBurstIndex,
      },
      commandHealth: command?.health ?? 0,
      commandMaxHealth: command?.maxHealth ?? FLEET.commandHealth,
      commandShield: command?.shield ?? 0,
      commandMaxShield: command?.maxShield ?? 0,
      friendlies: this.friendlies,
      enemies: this.enemies,
      projectiles: this.projectiles,
      telegraphs: this.telegraphs.map((telegraph) => ({
        ...telegraph,
        progress: 1 - telegraph.remaining / telegraph.duration,
      })),
      tacticalEdge: {
        stacks: this.tacticalEdgeStacks,
        maximumStacks: TACTICAL_EDGE.maximumStacks,
        activeBurstStacks: this.flagshipBurstTacticalStacks,
        damagePerStack: TACTICAL_EDGE.damagePerStack,
        criticalChancePerStack: TACTICAL_EDGE.criticalChancePerStack,
      },
      progression: this.progression.snapshot(),
      formation: this.formationSystem.snapshot(this.friendlies),
      arena: { ...this.arena },
    };
  }

  getFlagshipGunCooldown() {
    return FLAGSHIP_GUN.fullRecharge * this.progression.upgrades.volleyCooldownMultiplier;
  }

  getFlagshipGunEnergyRatio() {
    return this.flagshipGunEnergy / FLAGSHIP_GUN.firingDuration;
  }

  getFlagshipGunRechargeRemaining() {
    return this.getFlagshipGunCooldown() * (1 - this.getFlagshipGunEnergyRatio());
  }

  setArenaBounds(bounds) {
    if (!bounds) return;
    const halfWidth = Math.max(28, Math.min(104, Number(bounds.halfWidth) || ARENA.maxX));
    this.arena = { ...ARENA, minX: -halfWidth, maxX: halfWidth, width: halfWidth * 2 };
    this.formationSystem.setArena(this.arena);
    this.formationSystem.reflow(this.friendlies);
    for (const enemy of this.enemies) {
      enemy.originX = clamp(enemy.originX, this.arena.minX + 3, this.arena.maxX - 3);
      enemy.x = clamp(enemy.x, this.arena.minX + 3, this.arena.maxX - 3);
      enemy.targetX = clamp(enemy.targetX ?? enemy.x, this.arena.minX + 3, this.arena.maxX - 3);
    }
    this.flagshipGunAim.x = clamp(this.flagshipGunAim.x, this.arena.minX, this.arena.maxX);
  }

  getPersistentState() {
    return {
      ...this.progression.exportState(),
      formationLoadouts: this.formationSystem.exportLoadouts(),
      activeLoadoutIndex: this.formationSystem.activeLoadoutIndex,
    };
  }

  consumeEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  emit(type, payload) {
    this.events.push({ type, ...payload });
  }
}
