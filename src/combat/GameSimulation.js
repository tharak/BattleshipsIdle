import {
  ARENA,
  ENEMIES,
  FLEET,
  SIMULATION,
  VOLLEY,
  WAVES,
  getEnemyStats,
  getWaveEnemyCount,
} from '../config/balance.js';
import { RunProgression } from '../progression/RunProgression.js';
import { FormationSystem } from '../formations/FormationSystem.js';

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function normalizedVelocity(from, to, speed) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { vx: (dx / length) * speed, vy: (dy / length) * speed };
}

export class GameSimulation {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.progression = new RunProgression();
    this.formationSystem = new FormationSystem('line');
    this.nextId = 1;
    this.events = [];
    this.resetToReady();
  }

  resetToReady() {
    this.status = 'ready';
    this.suspended = false;
    this.elapsed = 0;
    this.wave = 0;
    this.waveIntermission = 0;
    this.waveResolved = false;
    this.volleyRemaining = 0;
    this.formationSystem.transitionRemaining = 0;
    this.formationSystem.cooldownRemaining = 0;
    this.friendlies = this.createFleet();
    this.enemies = [];
    this.projectiles = [];
    this.events = [];
    this.progression.reset();
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
    const fleet = FLEET.positions.map((position, index) => {
      const isCommand = position.role === 'command';
      const maxHealth = isCommand ? FLEET.commandHealth : FLEET.escortHealth;
      return {
        id: `friendly-${this.nextId++}`,
        faction: 'friendly',
        role: position.role,
        slot: index,
        x: position.x,
        y: position.y,
        health: maxHealth,
        maxHealth,
        damage: isCommand ? FLEET.commandDamage : FLEET.escortDamage,
        fireInterval: isCommand ? FLEET.commandFireInterval : FLEET.escortFireInterval,
        fireCooldown: this.random() * 0.5,
        alive: true,
      };
    });
    this.formationSystem.applyInitialPositions(fleet);
    return fleet;
  }

  beginNextWave() {
    this.wave += 1;
    this.waveResolved = false;
    this.waveIntermission = 0;
    const stats = getEnemyStats(this.wave);
    const count = getWaveEnemyCount(this.wave);
    const columns = Math.min(6, count);
    const spacing = Math.min(15, 82 / Math.max(1, columns - 1));

    this.enemies = Array.from({ length: count }, (_, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const rowCount = Math.min(columns, count - row * columns);
      const rowWidth = (rowCount - 1) * spacing;
      const x = column < rowCount ? -rowWidth / 2 + column * spacing : 0;
      const yBand = WAVES.spawnTopMax - row * 12;

      return {
        id: `enemy-${this.nextId++}`,
        faction: 'enemy',
        role: 'raider',
        x,
        y: clamp(yBand + (this.random() - 0.5) * 3, WAVES.spawnTopMin, WAVES.spawnTopMax),
        originX: x,
        phase: this.random() * TAU,
        drift: 1.2 + this.random() * 1.6,
        health: stats.maxHealth,
        maxHealth: stats.maxHealth,
        speed: stats.speed * (0.9 + this.random() * 0.18),
        damage: stats.damage,
        fireInterval: stats.fireInterval * (0.88 + this.random() * 0.24),
        fireCooldown: 0.8 + this.random() * stats.fireInterval,
        reward: stats.reward,
        alive: true,
      };
    });

    this.emit('waveStarted', { wave: this.wave, enemyCount: count });
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
    this.volleyRemaining = Math.max(0, this.volleyRemaining - dt);
    this.formationSystem.update(this.friendlies, dt);

    if (this.waveResolved) {
      this.waveIntermission -= dt;
      this.updateProjectiles(dt);
      if (this.waveIntermission <= 0) this.beginNextWave();
      return;
    }

    this.updateFriendlies(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.removeDestroyedEntities();
    this.resolveWaveIfNeeded();
  }

  updateFriendlies(dt) {
    for (const ship of this.friendlies) {
      if (!ship.alive) continue;
      ship.fireCooldown -= dt;
      if (ship.fireCooldown > 0) continue;

      const target = this.findAutoTarget(ship);
      if (!target) continue;

      ship.fireCooldown += ship.fireInterval / this.formationSystem.current.fireRate;
      this.spawnProjectile(ship, target, {
        faction: 'friendly',
        speed: FLEET.projectileSpeed,
        lifetime: FLEET.projectileLifetime,
        damage: ship.damage * this.formationSystem.getAutoDamageMultiplier(target),
      });
    }
  }

  updateEnemies(dt) {
    const command = this.getCommandShip();
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;

      enemy.y -= enemy.speed * dt;
      enemy.x = clamp(
        enemy.originX + Math.sin(this.elapsed * 0.72 + enemy.phase) * enemy.drift,
        ARENA.minX + 3,
        ARENA.maxX - 3,
      );

      if (enemy.y <= ARENA.defenseLineY) {
        enemy.alive = false;
        this.emit('breach', { x: enemy.x, y: enemy.y });
        if (command?.alive) {
          this.damageEntity(command, enemy.damage * ENEMIES.breachDamageMultiplier, 'breach');
        }
        continue;
      }

      enemy.fireCooldown -= dt;
      if (enemy.y > ENEMIES.fireThresholdY || enemy.fireCooldown > 0) continue;

      const target = this.pickEnemyTarget(enemy);
      if (!target) continue;

      enemy.fireCooldown += enemy.fireInterval;
      this.spawnProjectile(enemy, target, {
        faction: 'enemy',
        speed: ENEMIES.projectileSpeed,
        lifetime: ENEMIES.projectileLifetime,
        damage: enemy.damage,
      });
    }
  }

  updateProjectiles(dt) {
    for (const projectile of this.projectiles) {
      if (!projectile.alive) continue;
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.lifetime -= dt;

      if (projectile.lifetime <= 0 || Math.abs(projectile.x) > 70 || Math.abs(projectile.y) > 90) {
        projectile.alive = false;
        continue;
      }

      const targets = projectile.faction === 'friendly' ? this.enemies : this.friendlies;
      const hitTarget = targets.find(
        (target) => target.alive && distanceSquared(projectile, target) <= SIMULATION.projectileHitRadius ** 2,
      );

      if (hitTarget) {
        projectile.alive = false;
        this.damageEntity(hitTarget, projectile.damage, 'projectile');
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

  fireVolley(x, y) {
    const target = {
      x: clamp(x, ARENA.minX, ARENA.maxX),
      y: clamp(y, ARENA.minY + 10, ARENA.maxY),
    };

    if (this.status !== 'running' || this.suspended || this.waveResolved) {
      return { fired: false, reason: 'inactive', target };
    }

    if (this.volleyRemaining > 0) {
      this.emit('volleyRejected', { ...target, remaining: this.volleyRemaining });
      return { fired: false, reason: 'cooldown', target };
    }

    this.volleyRemaining = VOLLEY.cooldown;
    const formation = this.formationSystem.current;
    const volleyRadius = VOLLEY.radius * formation.volleyRadius;
    const volleyDamage = VOLLEY.damage * formation.volleyDamage;
    const sources = this.friendlies.filter((ship) => ship.alive);
    this.emit('volleyFired', {
      ...target,
      radius: volleyRadius,
      formationId: formation.id,
      sources: sources.map(({ x: sx, y: sy }) => ({ x: sx, y: sy })),
    });

    let hits = 0;
    let preciseHits = 0;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const distance = Math.sqrt(distanceSquared(enemy, target));
      if (distance > volleyRadius) continue;

      const precise = distance <= VOLLEY.innerRadius;
      const edgeFalloff = 0.58 + 0.42 * (1 - distance / volleyRadius);
      const damage = volleyDamage * edgeFalloff * (precise ? VOLLEY.precisionMultiplier : 1);
      hits += 1;
      if (precise) preciseHits += 1;
      this.damageEntity(enemy, damage, 'volley');
      this.emit('impact', { x: enemy.x, y: enemy.y, faction: 'friendly', targetId: enemy.id, heavy: true });
    }

    this.removeDestroyedEntities();
    this.resolveWaveIfNeeded();
    this.emit('volleyResolved', { ...target, hits, preciseHits, formationId: formation.id });
    return { fired: true, target, hits, preciseHits };
  }

  changeFormation(formationId) {
    if (!['ready', 'running', 'paused'].includes(this.status)) {
      return { changed: false, reason: 'inactive' };
    }
    const result = this.formationSystem.changeTo(formationId, this.friendlies, {
      ignoreCooldown: this.status === 'ready',
    });
    if (result.changed) {
      this.emit('formationChanged', {
        formationId,
        formation: result.formation,
        paths: result.paths,
      });
    }
    return result;
  }

  spawnProjectile(source, target, options) {
    const velocity = normalizedVelocity(source, target, options.speed);
    const projectile = {
      id: `projectile-${this.nextId++}`,
      faction: options.faction,
      x: source.x,
      y: source.y + (options.faction === 'friendly' ? 2.2 : -2.2),
      vx: velocity.vx,
      vy: velocity.vy,
      damage: options.damage,
      lifetime: options.lifetime,
      alive: true,
    };
    this.projectiles.push(projectile);
    this.emit('projectileFired', { ...projectile });
  }

  damageEntity(entity, amount, source) {
    if (!entity?.alive || amount <= 0) return;
    const adjustedAmount = entity.faction === 'friendly'
      ? amount * this.formationSystem.getIncomingDamageMultiplier()
      : amount;
    entity.health = Math.max(0, entity.health - adjustedAmount);
    this.emit('damaged', {
      id: entity.id,
      faction: entity.faction,
      x: entity.x,
      y: entity.y,
      amount: adjustedAmount,
      source,
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
    if (this.status !== 'running' || this.waveResolved || this.enemies.some((enemy) => enemy.alive)) return;
    this.waveResolved = true;
    this.waveIntermission = WAVES.intermission;
    const reward = WAVES.clearRewardBase + this.wave * 3;
    this.progression.recordWaveCleared(this.wave, reward);
    this.emit('waveCleared', { wave: this.wave, reward });
  }

  endRun() {
    if (this.status === 'gameOver') return;
    this.status = 'gameOver';
    this.projectiles = [];
    this.emit('gameOver', {
      wave: this.wave,
      progression: this.progression.snapshot(),
    });
  }

  togglePause() {
    if (this.status === 'running') {
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
    const range = FLEET.effectiveRange * this.formationSystem.current.range;
    if (this.formationSystem.currentId !== 'splitWings') {
      return this.findNearest(source, this.enemies, range);
    }

    const candidates = this.enemies
      .filter((enemy) => enemy.alive && distanceSquared(source, enemy) <= range * range)
      .sort((left, right) => {
        const leftSide = Math.abs(left.x) >= 19 ? 0 : 1;
        const rightSide = Math.abs(right.x) >= 19 ? 0 : 1;
        return leftSide - rightSide || distanceSquared(source, left) - distanceSquared(source, right);
      });
    return candidates[0] ?? null;
  }

  pickEnemyTarget(enemy) {
    const alive = this.friendlies.filter((ship) => ship.alive);
    if (alive.length === 0) return null;
    const command = alive.find((ship) => ship.role === 'command');
    if (command && this.random() < 0.38) return command;
    return this.findNearest(enemy, alive, 180) ?? command;
  }

  getCommandShip() {
    return this.friendlies.find((ship) => ship.role === 'command') ?? null;
  }

  getSnapshot() {
    const command = this.getCommandShip();
    return {
      status: this.status,
      elapsed: this.elapsed,
      wave: this.wave,
      waveIntermission: this.waveIntermission,
      volleyCharge: 1 - this.volleyRemaining / VOLLEY.cooldown,
      volleyRemaining: this.volleyRemaining,
      commandHealth: command?.health ?? 0,
      commandMaxHealth: command?.maxHealth ?? FLEET.commandHealth,
      friendlies: this.friendlies,
      enemies: this.enemies,
      projectiles: this.projectiles,
      progression: this.progression.snapshot(),
      formation: this.formationSystem.snapshot(),
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
