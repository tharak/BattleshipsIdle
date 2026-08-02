import { describe, expect, it } from 'vitest';
import { ARENA, FLAGSHIP_GUN, FLEET, WAVES } from '../src/config/balance.js';
import { GameSimulation } from '../src/combat/GameSimulation.js';

function createSimulation() {
  return new GameSimulation({ random: () => 0.5 });
}

function advance(simulation, seconds) {
  const step = 1 / 60;
  const frames = Math.ceil(seconds / step);
  for (let frame = 0; frame < frames; frame += 1) simulation.update(step);
}

describe('GameSimulation', () => {
  it('starts with a seven-ship fleet and a first enemy wave', () => {
    const simulation = createSimulation();
    simulation.startRun();
    const snapshot = simulation.getSnapshot();

    expect(snapshot.status).toBe('running');
    expect(snapshot.wave).toBe(1);
    expect(snapshot.friendlies).toHaveLength(FLEET.positions.length);
    expect(snapshot.enemies).toHaveLength(WAVES.startingEnemies);
    expect(simulation.consumeEvents().map((event) => event.type)).toContain('waveStarted');
  });

  it('keeps escort auto-fire while removing the flagship automatic attack', () => {
    const simulation = createSimulation();
    simulation.startRun();
    simulation.consumeEvents();
    advance(simulation, 0.9);

    const events = simulation.consumeEvents();
    const friendlyShots = events.filter((event) => event.type === 'projectileFired' && event.faction === 'friendly');
    expect(friendlyShots.length).toBeGreaterThan(0);
    expect(friendlyShots.every((event) => event.sourceRole !== 'command')).toBe(true);
    expect(simulation.getSnapshot().projectiles.length).toBeGreaterThan(0);
  });

  it('starts the flagship gun manually and can resume before a full recharge', () => {
    const simulation = createSimulation();
    simulation.startRun();
    simulation.consumeEvents();
    const target = simulation.getSnapshot().enemies[0];

    const first = simulation.beginFlagshipFire(target.x, target.y);
    const firedEvent = simulation.consumeEvents().find((event) => event.type === 'flagshipGunPulse');
    simulation.endFlagshipFire();
    const second = simulation.beginFlagshipFire(target.x, target.y);
    const resumedEvent = simulation.consumeEvents().find((event) => event.type === 'flagshipGunPulse');
    simulation.endFlagshipFire();

    expect(first.firing).toBe(true);
    expect(firedEvent.hitId).toBe(target.id);
    expect(firedEvent.source).toMatchObject({ x: simulation.getCommandShip().x, y: simulation.getCommandShip().y });
    expect(second).toMatchObject({ firing: true });
    expect(resumedEvent).toMatchObject({ burstIndex: 1, energyFraction: 1 });
    expect(simulation.getSnapshot().flagshipGun.rechargeRemaining).toBeGreaterThan(0);
    expect(simulation.getSnapshot().flagshipGun.rechargeRemaining).toBeLessThan(FLAGSHIP_GUN.fullRecharge);
  });

  it('stops each flagship pulse at the first enemy hull in its path', () => {
    const simulation = createSimulation();
    simulation.startRun();
    const [near, far, ...others] = simulation.enemies;
    Object.assign(near, { x: 0, y: -8, health: 1000, maxHealth: 1000, scale: 1 });
    Object.assign(far, { x: 0, y: 28, health: 1000, maxHealth: 1000, scale: 1 });
    others.forEach((enemy) => { enemy.x = 40; });

    simulation.consumeEvents();
    simulation.beginFlagshipFire(0, ARENA.maxY);
    const result = simulation.consumeEvents().find((event) => event.type === 'flagshipGunPulse');

    expect(result.hitId).toBe(near.id);
    expect(near.health).toBeLessThan(1000);
    expect(far.health).toBe(1000);
    expect(result.y).toBeLessThan(near.y);
  });

  it('extends a missed flagship pulse to the battlefield boundary', () => {
    const simulation = createSimulation();
    simulation.startRun();
    simulation.enemies.forEach((enemy) => { enemy.x = 40; });

    simulation.consumeEvents();
    simulation.beginFlagshipFire(0, ARENA.maxY);
    const result = simulation.consumeEvents().find((event) => event.type === 'flagshipGunPulse');

    expect(result.hitId).toBeNull();
    expect(result).toMatchObject({ x: 0, y: ARENA.maxY });
  });

  it('clears a defeated wave, grants a wave reward, and starts the next wave', () => {
    const simulation = createSimulation();
    simulation.startRun();
    simulation.consumeEvents();

    for (const enemy of [...simulation.enemies]) simulation.damageEntity(enemy, enemy.health, 'test');
    simulation.removeDestroyedEntities();
    simulation.resolveWaveIfNeeded();

    expect(simulation.getSnapshot().waveIntermission).toBe(WAVES.intermission);
    expect(simulation.beginFlagshipFire(0, 0)).toMatchObject({ firing: false, reason: 'inactive' });
    expect(simulation.getSnapshot().progression.salvage).toBeGreaterThan(0);

    advance(simulation, WAVES.intermission + 0.1);
    expect(simulation.getSnapshot().wave).toBe(2);
    expect(simulation.getSnapshot().enemies.length).toBeGreaterThan(0);
  });

  it('ends the run when the command ship is destroyed', () => {
    const simulation = createSimulation();
    simulation.startRun();
    simulation.consumeEvents();
    const command = simulation.getCommandShip();

    simulation.damageEntity(command, command.maxHealth, 'test');

    expect(simulation.getSnapshot().status).toBe('gameOver');
    expect(simulation.consumeEvents().some((event) => event.type === 'gameOver')).toBe(true);
  });

  it('does no combat work while suspended or manually paused', () => {
    const simulation = createSimulation();
    simulation.startRun();
    const before = simulation.getSnapshot().elapsed;

    simulation.setSuspended(true);
    advance(simulation, 1);
    expect(simulation.getSnapshot().elapsed).toBe(before);

    simulation.setSuspended(false);
    simulation.togglePause();
    advance(simulation, 1);
    expect(simulation.getSnapshot().elapsed).toBe(before);
  });

  it('recovers flagship energy and allows a later firing cycle', () => {
    const simulation = createSimulation();
    simulation.startRun();
    const target = simulation.enemies[0];

    expect(simulation.beginFlagshipFire(target.x, target.y).firing).toBe(true);
    simulation.endFlagshipFire();
    advance(simulation, FLAGSHIP_GUN.fullRecharge + 0.1);

    expect(simulation.getSnapshot().flagshipGun.energyRatio).toBe(1);
    expect(simulation.consumeEvents().some((event) => event.type === 'flagshipGunReady')).toBe(true);
    expect(simulation.beginFlagshipFire(0, 0).firing).toBe(true);
  });

  it('tracks a dragged aim direction throughout sustained fire', () => {
    const simulation = createSimulation();
    simulation.startRun();
    const [left, right, ...others] = simulation.enemies;
    Object.assign(left, { x: -18, originX: -18, y: 0, speed: 0, drift: 0, health: 1000, maxHealth: 1000, scale: 1 });
    Object.assign(right, { x: 18, originX: 18, y: 0, speed: 0, drift: 0, health: 1000, maxHealth: 1000, scale: 1 });
    others.forEach((enemy) => { Object.assign(enemy, { x: 40, originX: 40, speed: 0, drift: 0 }); });

    simulation.beginFlagshipFire(left.x, left.y);
    const leftAfterFirstPulse = left.health;
    simulation.aimFlagshipFire(right.x, right.y);
    advance(simulation, FLAGSHIP_GUN.pulseInterval + 0.02);

    expect(leftAfterFirstPulse).toBeLessThan(1000);
    expect(right.health).toBeLessThan(1000);
    expect(simulation.getSnapshot().flagshipGun.firing).toBe(true);
  });

  it('automatically ends a depleted firing cycle and permits a partial-power follow-up', () => {
    const simulation = createSimulation();
    simulation.startRun();
    simulation.beginFlagshipFire(0, ARENA.maxY);

    advance(simulation, FLAGSHIP_GUN.firingDuration + 0.1);
    const depleted = simulation.getSnapshot().flagshipGun;

    expect(depleted.firing).toBe(false);
    expect(depleted.energyRatio).toBeLessThan(0.05);
    expect(depleted.recharging).toBe(true);
    simulation.consumeEvents();
    expect(simulation.beginFlagshipFire(0, ARENA.maxY)).toMatchObject({ firing: true });
    const partialPulse = simulation.consumeEvents().find((event) => event.type === 'flagshipGunPulse');
    expect(partialPulse.energyFraction).toBeGreaterThan(0);
    expect(partialPulse.energyFraction).toBeLessThan(1);
    expect(simulation.getSnapshot().flagshipGun).toMatchObject({ firing: false, energy: 0 });
  });

  it('scales a sub-pulse manual shot to the available energy and rejects an empty gun', () => {
    const simulation = createSimulation();
    simulation.startRun();
    const [target, ...others] = simulation.enemies;
    Object.assign(target, { x: 0, y: 0, health: 1000, maxHealth: 1000, speed: 0, drift: 0 });
    others.forEach((enemy) => { enemy.x = 40; });
    simulation.flagshipGunEnergy = FLAGSHIP_GUN.pulseInterval / 2;
    simulation.consumeEvents();

    expect(simulation.beginFlagshipFire(target.x, target.y)).toMatchObject({ firing: true });
    const pulse = simulation.consumeEvents().find((event) => event.type === 'flagshipGunPulse');

    expect(pulse).toMatchObject({
      burstIndex: 1,
      damageMultiplier: FLAGSHIP_GUN.burstStartDamageMultiplier,
      criticalChance: FLAGSHIP_GUN.criticalStartChance,
      critical: false,
      energyFraction: 0.5,
    });
    expect(1000 - target.health).toBeCloseTo(pulse.damage);
    expect(simulation.getSnapshot().flagshipGun).toMatchObject({ firing: false, energy: 0, burstIndex: 0 });
    expect(simulation.beginFlagshipFire(target.x, target.y)).toMatchObject({ firing: false, reason: 'cooldown' });
  });

  it('ramps damage and critical chance across an uninterrupted full burst', () => {
    const simulation = createSimulation();
    simulation.startRun();
    const [target, ...others] = simulation.enemies;
    Object.assign(target, {
      x: 0,
      originX: 0,
      y: 0,
      health: 100000,
      maxHealth: 100000,
      speed: 0,
      drift: 0,
    });
    others.forEach((enemy) => { Object.assign(enemy, { x: 40, originX: 40, speed: 0, drift: 0 }); });
    simulation.consumeEvents();

    simulation.beginFlagshipFire(target.x, target.y);
    advance(simulation, FLAGSHIP_GUN.firingDuration);
    const pulses = simulation.consumeEvents().filter((event) => event.type === 'flagshipGunPulse');

    expect(pulses).toHaveLength(20);
    expect(pulses[0]).toMatchObject({
      burstIndex: 1,
      damageMultiplier: FLAGSHIP_GUN.burstStartDamageMultiplier,
      criticalChance: FLAGSHIP_GUN.criticalStartChance,
    });
    expect(pulses.at(-1)).toMatchObject({
      burstIndex: 20,
      damageMultiplier: FLAGSHIP_GUN.burstEndDamageMultiplier,
      criticalChance: FLAGSHIP_GUN.criticalEndChance,
    });
    for (let index = 1; index < pulses.length; index += 1) {
      expect(pulses[index].damageMultiplier).toBeGreaterThan(pulses[index - 1].damageMultiplier);
      expect(pulses[index].criticalChance).toBeGreaterThan(pulses[index - 1].criticalChance);
    }
  });

  it('applies the configured critical multiplier and reports the outcome', () => {
    const regular = createSimulation();
    const critical = new GameSimulation({ random: () => 0 });
    regular.startRun();
    critical.startRun();
    for (const simulation of [regular, critical]) {
      const [target, ...others] = simulation.enemies;
      Object.assign(target, { x: 0, y: 0, health: 1000, maxHealth: 1000, speed: 0, drift: 0 });
      others.forEach((enemy) => { enemy.x = 40; });
      simulation.consumeEvents();
      simulation.beginFlagshipFire(target.x, target.y);
    }

    const regularEvents = regular.consumeEvents();
    const criticalEvents = critical.consumeEvents();
    const regularPulse = regularEvents.find((event) => event.type === 'flagshipGunPulse');
    const criticalPulse = criticalEvents.find((event) => event.type === 'flagshipGunPulse');
    const regularDamage = regularEvents.find((event) => event.type === 'damaged');
    const criticalDamage = criticalEvents.find((event) => event.type === 'damaged');

    expect(regularPulse.critical).toBe(false);
    expect(criticalPulse.critical).toBe(true);
    expect(criticalPulse.damage).toBeCloseTo(regularPulse.damage * FLAGSHIP_GUN.criticalDamageMultiplier);
    expect(regularDamage).toMatchObject({ source: 'flagshipGun', critical: false });
    expect(criticalDamage).toMatchObject({ source: 'flagshipGun', critical: true });
    expect(criticalDamage.amount).toBeCloseTo(criticalPulse.damage);
  });

  it('resets burst progress on release but preserves it while aim changes', () => {
    const simulation = createSimulation();
    simulation.startRun();
    const [target, ...others] = simulation.enemies;
    Object.assign(target, { x: 0, originX: 0, y: 0, health: 10000, maxHealth: 10000, speed: 0, drift: 0 });
    others.forEach((enemy) => { Object.assign(enemy, { x: 40, originX: 40, speed: 0, drift: 0 }); });
    simulation.consumeEvents();

    simulation.beginFlagshipFire(target.x, target.y);
    simulation.aimFlagshipFire(target.x + 0.1, target.y);
    advance(simulation, FLAGSHIP_GUN.pulseInterval + 0.02);
    const activePulses = simulation.consumeEvents().filter((event) => event.type === 'flagshipGunPulse');
    simulation.endFlagshipFire();
    simulation.beginFlagshipFire(target.x, target.y);
    const restartedPulse = simulation.consumeEvents().find((event) => event.type === 'flagshipGunPulse');

    expect(activePulses.map((pulse) => pulse.burstIndex)).toEqual([1, 2]);
    expect(restartedPulse.burstIndex).toBe(1);
  });

  it('keeps autonomous gunnery idle until its charge is full', () => {
    const simulation = new GameSimulation({
      random: () => 0.5,
      progressionState: { upgrades: { automatedGunnery: 1 } },
    });
    simulation.startRun();
    const target = simulation.enemies[0];
    simulation.flagshipGunEnergy = FLAGSHIP_GUN.firingDuration / 2;
    simulation.consumeEvents();

    expect(simulation.beginFlagshipFire(target.x, target.y, { automatic: true }))
      .toMatchObject({ firing: false, reason: 'cooldown' });
    simulation.update(1 / 60);
    expect(simulation.getSnapshot().flagshipGun.firing).toBe(false);
    expect(simulation.consumeEvents().some((event) => event.type === 'flagshipGunPulse')).toBe(false);

    expect(simulation.beginFlagshipFire(target.x, target.y)).toMatchObject({ firing: true });
  });

  it('applies breach pressure to the command ship', () => {
    const simulation = createSimulation();
    simulation.startRun();
    const command = simulation.getCommandShip();
    const enemy = simulation.enemies[0];
    const healthBefore = command.health;
    enemy.y = -67.99;

    simulation.update(1 / 60);

    expect(command.health).toBeLessThan(healthBefore);
    expect(simulation.consumeEvents().some((event) => event.type === 'breach')).toBe(true);
  });

  it('restarts with fresh progression, health, cooldown, and projectiles', () => {
    const simulation = createSimulation();
    simulation.startRun();
    const target = simulation.enemies[0];
    simulation.beginFlagshipFire(target.x, target.y);
    advance(simulation, 0.8);
    simulation.progression.recordEnemyDestroyed(50);
    const persistentCurrency = simulation.getSnapshot().progression.currency;

    simulation.restartRun();
    const snapshot = simulation.getSnapshot();

    expect(snapshot.status).toBe('running');
    expect(snapshot.wave).toBe(1);
    expect(snapshot.commandHealth).toBe(FLEET.commandHealth);
    expect(snapshot.flagshipGun.energyRatio).toBe(1);
    expect(snapshot.projectiles).toHaveLength(0);
    expect(snapshot.progression.salvage).toBe(persistentCurrency);
    expect(snapshot.progression.runSalvage).toBe(0);
  });

  it('resolves projectile hits when updated at the runtime fixed step', () => {
    const simulation = createSimulation();
    simulation.startRun();
    const healthBefore = simulation.enemies.reduce((total, enemy) => total + enemy.health, 0);

    advance(simulation, 2);

    const healthAfter = simulation.enemies.reduce((total, enemy) => total + enemy.health, 0);
    expect(healthAfter).toBeLessThan(healthBefore);
    expect(simulation.consumeEvents().some((event) => event.type === 'impact')).toBe(true);
  });

  it('changes formation during combat and exposes its mechanical state', () => {
    const simulation = createSimulation();
    simulation.startRun();
    const before = simulation.friendlies[0].x;

    const result = simulation.changeFormation('wedge');
    advance(simulation, 0.5);

    expect(result.changed).toBe(true);
    expect(simulation.getSnapshot().formation.currentId).toBe('wedge');
    expect(simulation.friendlies[0].x).not.toBe(before);
    expect(simulation.changeFormation('denseColumn')).toMatchObject({ changed: false, reason: 'cooldown' });
  });

  it('adapts formation width and enemy bounds to the visible battlefield', () => {
    const simulation = createSimulation();
    simulation.startRun();

    simulation.setArenaBounds({ halfWidth: 30 });

    expect(simulation.getSnapshot().arena).toMatchObject({ minX: -30, maxX: 30 });
    expect(simulation.friendlies.every((ship) => Math.abs(ship.targetX) <= 30)).toBe(true);
    expect(simulation.enemies.every((enemy) => Math.abs(enemy.x) <= 27)).toBe(true);
  });

  it('applies defensive arc mitigation to incoming damage', () => {
    const simulation = createSimulation();
    simulation.changeFormation('defensiveArc');
    simulation.startRun();
    const command = simulation.getCommandShip();

    simulation.damageEntity(command, 100, 'test');

    expect(command.maxHealth - command.health).toBeCloseTo(68);
  });

  it('makes dense-column flagship gun pulses stronger', () => {
    const line = createSimulation();
    const column = createSimulation();
    line.startRun();
    column.changeFormation('denseColumn');
    column.startRun();
    line.enemies[0].health = 1000;
    line.enemies[0].maxHealth = 1000;
    column.enemies[0].health = 1000;
    column.enemies[0].maxHealth = 1000;

    const lineResult = line.beginFlagshipFire(line.enemies[0].x, line.enemies[0].y);
    const columnResult = column.beginFlagshipFire(column.enemies[0].x, column.enemies[0].y);
    const lineDamage = 1000 - line.enemies[0].health;
    const columnDamage = 1000 - column.enemies[0].health;

    expect(columnDamage).toBeGreaterThan(lineDamage);
    expect(columnResult.firing).toBe(lineResult.firing);
  });

  it('automates priority targeting while preserving manual override', () => {
    const simulation = new GameSimulation({
      random: () => 0.5,
      progressionState: { upgrades: { automatedGunnery: 1 } },
    });
    simulation.startRun();
    simulation.enemies = [];
    simulation.wave = 4;
    simulation.beginNextWave();
    const boss = simulation.enemies.find((enemy) => enemy.boss);
    const escort = simulation.enemies.find((enemy) => !enemy.boss);

    simulation.consumeEvents();
    simulation.update(1 / 60);
    const automaticPulse = simulation.consumeEvents().find((event) => event.type === 'flagshipGunPulse');
    expect(simulation.getSnapshot().flagshipGun).toMatchObject({ firing: true, manualControl: false, automated: true });
    expect(automaticPulse.hitId).toBe(boss.id);

    expect(simulation.beginFlagshipFire(escort.x, escort.y)).toMatchObject({ firing: true, override: true });
    expect(simulation.getSnapshot().flagshipGun.manualControl).toBe(true);
    simulation.endFlagshipFire();
    expect(simulation.getSnapshot().flagshipGun).toMatchObject({ firing: true, manualControl: false });
  });

  it('applies purchased upgrades immediately and keeps currency persistent', () => {
    const simulation = new GameSimulation({
      random: () => 0.5,
      progressionState: { currency: 1000 },
    });
    simulation.startRun();
    const damageBefore = simulation.friendlies[0].damage;

    const damage = simulation.purchaseUpgrade('shipDamage');
    const shield = simulation.purchaseUpgrade('shieldStrength');
    const size = simulation.purchaseUpgrade('fleetSize');

    expect(damage.purchased).toBe(true);
    expect(shield.purchased).toBe(true);
    expect(size.purchased).toBe(true);
    expect(simulation.friendlies[0].damage).toBeGreaterThan(damageBefore);
    expect(simulation.friendlies[0].maxShield).toBeGreaterThan(0);
    expect(simulation.friendlies).toHaveLength(8);
    expect(simulation.getPersistentState().currency).toBeLessThan(1000);
  });

  it('uses shields before hull integrity', () => {
    const simulation = new GameSimulation({
      random: () => 0.5,
      progressionState: { currency: 500, upgrades: { shieldStrength: 1 } },
    });
    simulation.startRun();
    const command = simulation.getCommandShip();
    const hullBefore = command.health;
    const shieldBefore = command.shield;

    simulation.damageEntity(command, 20, 'test');

    expect(command.shield).toBeLessThan(shieldBefore);
    expect(command.health).toBe(hullBefore);
    expect(simulation.consumeEvents().some((event) => event.type === 'shieldImpact')).toBe(true);
  });

  it('pauses combat while the upgrade shop is open', () => {
    const simulation = createSimulation();
    simulation.startRun();
    advance(simulation, 0.5);
    const elapsed = simulation.getSnapshot().elapsed;

    expect(simulation.openShop()).toBe(true);
    advance(simulation, 1);
    expect(simulation.getSnapshot().elapsed).toBe(elapsed);
    expect(simulation.closeShop()).toBe(true);
    expect(simulation.getSnapshot().status).toBe('running');
  });

  it('spawns an elite on wave three and a barrier boss on wave five', () => {
    const simulation = createSimulation();
    simulation.startRun();
    simulation.enemies = [];
    simulation.wave = 2;
    simulation.beginNextWave();
    expect(simulation.enemies.some((enemy) => enemy.elite)).toBe(true);

    simulation.enemies = [];
    simulation.wave = 4;
    simulation.beginNextWave();
    const boss = simulation.enemies.find((enemy) => enemy.boss);
    expect(boss).toBeDefined();
    expect(boss.role).toBe('boss');
    expect(simulation.consumeEvents().some((event) => event.type === 'bossWaveStarted')).toBe(true);
  });

  it('makes automatic fire weak against a boss until the flagship gun exposes its hull', () => {
    const simulation = createSimulation();
    simulation.startRun();
    simulation.enemies = [];
    simulation.wave = 4;
    simulation.beginNextWave();
    const boss = simulation.enemies.find((enemy) => enemy.boss);
    const before = boss.health;

    simulation.damageEntity(boss, 100, 'projectile');
    expect(before - boss.health).toBeCloseTo(16);

    const result = simulation.beginFlagshipFire(boss.x, boss.y);
    expect(result.firing).toBe(true);
    expect(boss.exposedRemaining).toBeGreaterThan(0);
    expect(before - boss.health).toBeGreaterThan(16);
  });

  it('applies artillery area damage to clustered ships', () => {
    const simulation = createSimulation();
    simulation.changeFormation('denseColumn');
    simulation.startRun();
    const target = simulation.friendlies[0];
    const before = simulation.friendlies.map((ship) => ship.health);
    simulation.projectiles.push({
      id: 'area-test', faction: 'enemy', x: target.x, y: target.y,
      vx: 0, vy: 0, damage: 10, areaRadius: 24, lifetime: 1, alive: true,
    });

    simulation.updateProjectiles(1 / 60);
    const damaged = simulation.friendlies.filter((ship, index) => ship.health < before[index]);
    expect(damaged.length).toBeGreaterThan(1);
    expect(simulation.consumeEvents().some((event) => event.type === 'areaImpact')).toBe(true);
  });

  it('unlocks distinct lancer and guardian classes with fleet-size upgrades', () => {
    const simulation = new GameSimulation({
      random: () => 0.5,
      progressionState: { upgrades: { fleetSize: 2 } },
    });

    expect(simulation.friendlies).toHaveLength(9);
    expect(simulation.friendlies.some((ship) => ship.role === 'lancer')).toBe(true);
    expect(simulation.friendlies.some((ship) => ship.role === 'guardian')).toBe(true);
  });

});
