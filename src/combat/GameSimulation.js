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

function normalizedVelocity(from, to, speed) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { vx: (dx / length) * speed, vy: (dy / length) * speed };
}

function rayExitDistance(origin, direction) {
  const distances = [];
  if (direction.x > 0) distances.push((ARENA.maxX - origin.x) / direction.x);
  if (direction.x < 0) distances.push((ARENA.minX - origin.x) / direction.x);
  if (direction.y > 0) distances.push((ARENA.maxY - origin.y) / direction.y);
  if (direction.y < 0) distances.push((ARENA.minY - origin.y) / direction.y);
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
    onStateChange = () => {},
  } = {}) {
    this.random = random;
    this.onStateChange = onStateChange;
    this.progression = new RunProgression({ state: progressionState, onChange: onStateChange });
    this.formationSystem = new FormationSystem(selectedFormation);
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
    this.formationSystem.applyInitialPositions(fleet);
    return fleet;
  }

  createFriendly(role, slot) {
    const isCommand = role === 'command';
    const roleStats = this.getFriendlyBaseStats(role);
    const baseHealth = roleStats.health;
    const maxHealth = Math.round(baseHealth * this.progression.upgrades.durabilityMultiplier);
    const maxShield = this.progression.upgrades.getShieldFor(role);
    return {
      id: `friendly-${this.nextId++}`,
      faction: 'friendly',
      role,
      slot,
      x: 0,
      y: ARENA.commandY,
      health: maxHealth,
      maxHealth,
      shield: maxShield,
      maxShield,
      damage: roleStats.damage * this.progression.upgrades.shipDamageMultiplier,
      fireInterval: roleStats.fireInterval,
      fireCooldown: this.random() * 0.5,
      alive: true,
    };
  }

  beginNextWave() {
    this.wave += 1;
    this.waveResolved = false;
    this.waveIntermission = 0;
    const stats = getEnemyStats(this.wave);
    const bossWave = isBossWave(this.wave);
    const count = bossWave ? 3 : getWaveEnemyCount(this.wave);
    const columns = Math.min(6, count);
    const spacing = Math.min(15, 82 / Math.max(1, columns - 1));

    const availableTypes = getAvailableEnemyTypes(this.wave);
    this.enemies = Array.from({ length: count }, (_, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const rowCount = Math.min(columns, count - row * columns);
      const rowWidth = (rowCount - 1) * spacing;
      const x = column < rowCount ? -rowWidth / 2 + column * spacing : 0;
      const yBand = WAVES.spawnTopMax - row * 12;

      if (bossWave && index === 0) {
        const tier = Math.max(0, Math.floor(this.wave / BOSS.everyWaves) - 1);
        const health = Math.round(BOSS.baseHealth * BOSS.healthGrowth ** tier);
        return {
          id: `enemy-${this.nextId++}`,
          faction: 'enemy', role: 'boss', type: 'boss', boss: true, elite: false,
          x: 0, y: WAVES.spawnTopMax - 4, originX: 0, phase: this.random() * TAU, drift: 2.2,
          health, maxHealth: health, speed: BOSS.speed + tier * 0.06,
          damage: Math.round(BOSS.damage * BOSS.damageGrowth ** tier),
          fireInterval: BOSS.fireInterval, fireCooldown: 1.15,
          reward: Math.round(BOSS.reward * (1 + tier * 0.35)),
          attackType: 'area', areaRadius: BOSS.areaRadius, scale: 2.35,
          exposedRemaining: 0, alive: true,
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
        x,
        y: clamp(yBand + (this.random() - 0.5) * 3, WAVES.spawnTopMin, WAVES.spawnTopMax),
        originX: x,
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
        areaRadius: type.areaRadius ?? 0,
        scale: type.scale * (elite ? 1.22 : 1),
        exposedRemaining: 0,
        alive: true,
      };
    });

    this.emit('waveStarted', {
      wave: this.wave,
      enemyCount: count,
      enemyTypes: bossWave ? ['boss', 'skirmisher', 'artillery'] : availableTypes,
      isBoss: bossWave,
    });
    if (bossWave) this.emit('bossWaveStarted', { wave: this.wave, name: BOSS.name });
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
    const previousVolleyRemaining = this.volleyRemaining;
    this.volleyRemaining = Math.max(0, this.volleyRemaining - dt);
    if (previousVolleyRemaining > 0 && this.volleyRemaining === 0) {
      const flagship = this.getCommandShip();
      this.emit('volleyReady', { x: flagship?.x ?? 0, y: flagship?.y ?? ARENA.commandY });
    }
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

      ship.fireCooldown += ship.fireInterval
        / this.formationSystem.current.fireRate
        / this.progression.upgrades.autoFireRateMultiplier;
      this.spawnProjectile(ship, target, {
        faction: 'friendly',
        speed: FLEET.projectileSpeed,
        lifetime: FLEET.projectileLifetime,
        damage: ship.damage
          * this.formationSystem.getAutoDamageMultiplier(target)
          * this.progression.upgrades.formationMasteryMultiplier,
      });
    }
  }

  updateEnemies(dt) {
    const command = this.getCommandShip();
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;

      if (enemy.boss && enemy.exposedRemaining > 0) {
        const before = enemy.exposedRemaining;
        enemy.exposedRemaining = Math.max(0, enemy.exposedRemaining - dt);
        if (before > 0 && enemy.exposedRemaining === 0) this.emit('bossBarrierRestored', { id: enemy.id });
      }

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
        areaRadius: enemy.areaRadius,
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

  fireVolley(x, y) {
    const aim = {
      x: clamp(x, ARENA.minX, ARENA.maxX),
      y: clamp(y, ARENA.minY + 10, ARENA.maxY),
    };

    if (this.status !== 'running' || this.suspended || this.waveResolved) {
      return { fired: false, reason: 'inactive', target: aim };
    }

    if (this.volleyRemaining > 0) {
      this.emit('volleyRejected', { ...aim, remaining: this.volleyRemaining });
      return { fired: false, reason: 'cooldown', target: aim };
    }

    this.volleyRemaining = this.getVolleyCooldown();
    const formation = this.formationSystem.current;
    const beamHalfWidth = VOLLEY.beamHalfWidth * formation.strikeWidth;
    const volleyDamage = VOLLEY.damage
      * formation.volleyDamage
      * this.progression.upgrades.volleyDamageMultiplier
      * this.progression.upgrades.formationMasteryMultiplier;
    const flagship = this.getCommandShip();
    const source = { x: flagship?.x ?? 0, y: flagship?.y ?? ARENA.commandY };
    const aimDx = aim.x - source.x;
    const aimDy = aim.y - source.y;
    const aimLength = Math.hypot(aimDx, aimDy);
    const direction = aimLength > 0.001
      ? { x: aimDx / aimLength, y: aimDy / aimLength }
      : { x: 0, y: 1 };
    const boundaryDistance = rayExitDistance(source, direction);
    let strikeDistance = boundaryDistance;
    let firstHit = null;

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const relativeX = enemy.x - source.x;
      const relativeY = enemy.y - source.y;
      const distanceAlongRay = relativeX * direction.x + relativeY * direction.y;
      if (distanceAlongRay <= 0 || distanceAlongRay > boundaryDistance) continue;

      const perpendicularDistance = Math.abs(relativeX * direction.y - relativeY * direction.x);
      const contactRadius = enemyHullRadius(enemy) + beamHalfWidth;
      if (perpendicularDistance > contactRadius) continue;

      const entryDistance = distanceAlongRay
        - Math.sqrt(Math.max(0, contactRadius ** 2 - perpendicularDistance ** 2));
      if (entryDistance >= strikeDistance) continue;
      strikeDistance = Math.max(0, entryDistance);
      firstHit = { enemy, perpendicularDistance };
    }

    const endpoint = {
      x: source.x + direction.x * strikeDistance,
      y: source.y + direction.y * strikeDistance,
    };
    this.emit('volleyFired', {
      ...endpoint,
      aim,
      beamHalfWidth,
      formationId: formation.id,
      source,
      hitId: firstHit?.enemy.id ?? null,
    });

    const hits = firstHit ? 1 : 0;
    const precise = firstHit
      ? firstHit.perpendicularDistance <= VOLLEY.precisionRadius * formation.strikeWidth
      : false;
    const preciseHits = precise ? 1 : 0;
    if (firstHit) {
      const { enemy } = firstHit;
      const damage = volleyDamage * (precise ? VOLLEY.precisionMultiplier : 1);
      if (enemy.boss) {
        const wasProtected = enemy.exposedRemaining <= 0;
        enemy.exposedRemaining = BOSS.exposureDuration;
        if (wasProtected) this.emit('bossExposed', { id: enemy.id, x: enemy.x, y: enemy.y });
      }
      this.damageEntity(enemy, damage, 'volley');
      this.emit('impact', { x: enemy.x, y: enemy.y, faction: 'friendly', targetId: enemy.id, heavy: true });
    }

    this.removeDestroyedEntities();
    this.resolveWaveIfNeeded();
    this.emit('volleyResolved', {
      ...aim,
      endpoint,
      hitId: firstHit?.enemy.id ?? null,
      hits,
      preciseHits,
      formationId: formation.id,
    });
    return { fired: true, target: aim, endpoint, hitId: firstHit?.enemy.id ?? null, hits, preciseHits };
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
      this.onStateChange();
    }
    return result;
  }

  purchaseUpgrade(upgradeId) {
    const result = this.progression.purchaseUpgrade(upgradeId);
    if (!result.purchased) return result;
    this.applyFleetUpgrades(upgradeId);
    this.volleyRemaining = Math.min(this.volleyRemaining, this.getVolleyCooldown());
    this.emit('upgradePurchased', {
      ...result,
      upgrade: this.progression.upgrades.snapshot().find(({ id }) => id === upgradeId),
    });
    return result;
  }

  applyFleetUpgrades(purchasedId) {
    const desiredCount = this.progression.upgrades.fleetSize;
    while (this.friendlies.length < desiredCount) {
      const slot = this.friendlies.length;
      const ship = this.createFriendly(this.getFleetRole(slot), slot);
      this.friendlies.push(ship);
      this.emit('friendlyJoined', { id: ship.id, x: ship.x, y: ship.y });
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

  damageEntity(entity, amount, source) {
    if (!entity?.alive || amount <= 0) return;
    let adjustedAmount = entity.faction === 'friendly'
      ? amount * this.formationSystem.getIncomingDamageMultiplier()
        / this.progression.upgrades.formationMasteryMultiplier
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
    const creditedReward = this.progression.recordWaveCleared(this.wave, reward);
    this.emit('waveCleared', { wave: this.wave, reward: creditedReward });
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
    const range = FLEET.effectiveRange
      * this.formationSystem.current.range
      * this.progression.upgrades.formationMasteryMultiplier;
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
    if (role === 'lancer') return { health: 78, damage: 17, fireInterval: 0.9 };
    if (role === 'guardian') return { health: 158, damage: 7.5, fireInterval: 1.02 };
    return { health: FLEET.escortHealth, damage: FLEET.escortDamage, fireInterval: FLEET.escortFireInterval };
  }

  getSnapshot() {
    const command = this.getCommandShip();
    const volleyCooldown = this.getVolleyCooldown();
    return {
      status: this.status,
      elapsed: this.elapsed,
      wave: this.wave,
      waveIntermission: this.waveIntermission,
      volleyCharge: 1 - this.volleyRemaining / volleyCooldown,
      volleyRemaining: this.volleyRemaining,
      volleyCooldown,
      commandHealth: command?.health ?? 0,
      commandMaxHealth: command?.maxHealth ?? FLEET.commandHealth,
      commandShield: command?.shield ?? 0,
      commandMaxShield: command?.maxShield ?? 0,
      friendlies: this.friendlies,
      enemies: this.enemies,
      projectiles: this.projectiles,
      progression: this.progression.snapshot(),
      formation: this.formationSystem.snapshot(),
    };
  }

  getVolleyCooldown() {
    return VOLLEY.cooldown * this.progression.upgrades.volleyCooldownMultiplier;
  }

  getPersistentState() {
    return {
      ...this.progression.exportState(),
      selectedFormation: this.formationSystem.currentId,
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
