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

function engageCurrentWave(simulation) {
  expect(simulation.readyForBattle()).toMatchObject({ started: true });
  for (let frame = 0; frame < 180 && simulation.getSnapshot().waveState.phase !== 'combat'; frame += 1) {
    simulation.update(1 / 60);
  }
  expect(simulation.getSnapshot().waveState.phase).toBe('combat');
}

function startCombat(simulation) {
  simulation.startRun();
  engageCurrentWave(simulation);
}

describe('GameSimulation', () => {
  it('reveals an enemy formation and waits for the player to commit', () => {
    const simulation = createSimulation();
    simulation.startRun();
    const snapshot = simulation.getSnapshot();
    const enemyPositions = snapshot.enemies.map(({ x, y }) => ({ x, y }));

    expect(snapshot.status).toBe('running');
    expect(snapshot.wave).toBe(1);
    expect(snapshot.waveState.phase).toBe('deployment');
    expect(snapshot.waveState).toMatchObject({
      phase: 'deployment',
      enemyFormationId: 'defensiveArc',
      enemyFormationName: 'Defensive arc',
      canReady: true,
      weaponRange: ARENA.height / 2,
    });
    expect(snapshot.friendlies).toHaveLength(FLEET.positions.length);
    expect(snapshot.enemies).toHaveLength(WAVES.startingEnemies);
    advance(simulation, 1);
    expect(simulation.enemies.map(({ x, y }) => ({ x, y }))).toEqual(enemyPositions);
    expect(simulation.consumeEvents().map((event) => event.type)).toContain('enemyFormationRevealed');

    expect(simulation.readyForBattle()).toMatchObject({ started: true });
    expect(simulation.getSnapshot().waveState.phase).toBe('approach');
    advance(simulation, 2);
    expect(simulation.getSnapshot().waveState.phase).toBe('combat');
  });

  it('keeps escort auto-fire while removing the flagship automatic attack', () => {
    const simulation = createSimulation();
    startCombat(simulation);
    simulation.consumeEvents();
    advance(simulation, 0.9);

    const events = simulation.consumeEvents();
    const friendlyShots = events.filter((event) => event.type === 'projectileFired' && event.faction === 'friendly');
    expect(friendlyShots.length).toBeGreaterThan(0);
    expect(friendlyShots.every((event) => event.sourceRole !== 'command')).toBe(true);
  });

  it('starts the flagship gun manually and can resume before a full recharge', () => {
    const simulation = createSimulation();
    startCombat(simulation);
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
    startCombat(simulation);
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

  it('limits a missed flagship pulse to the fleet weapon range', () => {
    const simulation = createSimulation();
    startCombat(simulation);
    simulation.enemies.forEach((enemy) => { enemy.x = 40; });

    simulation.consumeEvents();
    simulation.beginFlagshipFire(0, ARENA.maxY);
    const result = simulation.consumeEvents().find((event) => event.type === 'flagshipGunPulse');
    const rangeMultiplier = 1 + simulation.getSnapshot().formation.modifiers.rangeBonus;

    expect(result.hitId).toBeNull();
    expect(result.x).toBe(0);
    expect(result.y - result.source.y).toBeCloseTo(FLEET.effectiveRange * rangeMultiplier);
    expect(result.y).toBeLessThan(ARENA.maxY);
  });

  it('reveals all five enemy formations from the shared template set', () => {
    const ids = ['line', 'wedge', 'defensiveArc', 'splitWings', 'denseColumn'];

    ids.forEach((expectedId, index) => {
      const simulation = new GameSimulation({ random: () => (index + 0.1) / ids.length });
      simulation.startRun();
      expect(simulation.getSnapshot().waveState.enemyFormationId).toBe(expectedId);
    });
  });

  it('lets the player farm remaining contacts after the flagship path clears', () => {
    const simulation = createSimulation();
    startCombat(simulation);

    expect(simulation.advanceToNextWave()).toMatchObject({ advancing: false, reason: 'blocked' });
    for (const blocker of simulation.getFlagshipPathBlockers()) {
      simulation.damageEntity(blocker, blocker.health, 'test');
    }
    simulation.removeDestroyedEntities();
    simulation.resolveWaveIfNeeded();
    const pathSnapshot = simulation.getSnapshot();

    expect(pathSnapshot.waveState.canAdvance).toBe(true);
    expect(pathSnapshot.waveState.remainingEnemies).toBeGreaterThan(0);
    const salvageWithClearPath = pathSnapshot.progression.salvage;
    const optionalTarget = simulation.enemies[0];
    simulation.damageEntity(optionalTarget, optionalTarget.health, 'test');
    simulation.removeDestroyedEntities();
    simulation.resolveWaveIfNeeded();
    expect(simulation.getSnapshot().progression.salvage).toBeGreaterThan(salvageWithClearPath);

    const flagshipY = simulation.getCommandShip().y;
    expect(simulation.advanceToNextWave()).toMatchObject({ advancing: true });
    advance(simulation, 0.1);
    expect(simulation.getCommandShip().y).toBeGreaterThan(flagshipY);
    advance(simulation, 1);
    expect(simulation.getSnapshot().waveState.phase).toBe('intermission');
  });

  it('ends the run when the command ship is destroyed', () => {
    const simulation = createSimulation();
    startCombat(simulation);
    simulation.consumeEvents();
    const command = simulation.getCommandShip();

    simulation.damageEntity(command, command.maxHealth * 2, 'test');

    expect(simulation.getSnapshot().status).toBe('gameOver');
    expect(simulation.consumeEvents().some((event) => event.type === 'gameOver')).toBe(true);
  });

  it('does no combat work while suspended or manually paused', () => {
    const simulation = createSimulation();
    startCombat(simulation);
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
    startCombat(simulation);
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
    startCombat(simulation);
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
    startCombat(simulation);
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
    startCombat(simulation);
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
    startCombat(simulation);
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
    startCombat(regular);
    startCombat(critical);
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
    startCombat(simulation);
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
    startCombat(simulation);
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

  it('stops enemy forward movement when the fleets meet', () => {
    const simulation = createSimulation();
    startCombat(simulation);
    const enemy = simulation.enemies[0];
    const battleY = enemy.y;

    advance(simulation, 1);

    expect(enemy.y).toBe(battleY);
    expect(simulation.getSnapshot().waveState.phase).toBe('combat');
    expect(simulation.consumeEvents().some((event) => event.type === 'breach')).toBe(false);
  });

  it('restarts with fresh progression, health, cooldown, and projectiles', () => {
    const simulation = createSimulation();
    startCombat(simulation);
    const target = simulation.enemies[0];
    simulation.beginFlagshipFire(target.x, target.y);
    advance(simulation, 0.8);
    simulation.progression.recordEnemyDestroyed(50);
    const persistentCurrency = simulation.getSnapshot().progression.currency;

    simulation.restartRun();
    const snapshot = simulation.getSnapshot();

    expect(snapshot.status).toBe('running');
    expect(snapshot.wave).toBe(1);
    expect(snapshot.waveState).toMatchObject({ phase: 'deployment', canReady: true });
    expect(snapshot.commandHealth).toBe(FLEET.commandHealth);
    expect(snapshot.flagshipGun.energyRatio).toBe(1);
    expect(snapshot.projectiles).toHaveLength(0);
    expect(snapshot.progression.salvage).toBe(persistentCurrency);
    expect(snapshot.progression.runSalvage).toBe(0);
  });

  it('resolves projectile hits when updated at the runtime fixed step', () => {
    const simulation = createSimulation();
    startCombat(simulation);
    const healthBefore = simulation.enemies.reduce((total, enemy) => total + enemy.health, 0);

    advance(simulation, 2);

    const healthAfter = simulation.enemies.reduce((total, enemy) => total + enemy.health, 0);
    expect(healthAfter).toBeLessThan(healthBefore);
    expect(simulation.consumeEvents().some((event) => event.type === 'impact')).toBe(true);
  });

  it('changes formation during combat and exposes its mechanical state', () => {
    const simulation = createSimulation();
    startCombat(simulation);
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
    startCombat(simulation);

    simulation.setArenaBounds({ halfWidth: 30 });

    expect(simulation.getSnapshot().arena).toMatchObject({ minX: -30, maxX: 30 });
    expect(simulation.friendlies.every((ship) => Math.abs(ship.targetX) <= 30)).toBe(true);
    expect(simulation.enemies.every((enemy) => Math.abs(enemy.x) <= 27)).toBe(true);
  });

  it('applies defensive arc mitigation to incoming damage', () => {
    const simulation = createSimulation();
    simulation.changeFormation('defensiveArc');
    startCombat(simulation);
    const command = simulation.getCommandShip();

    const reduction = simulation.getSnapshot().formation.modifiers.flagshipDamageReduction;
    simulation.damageEntity(command, 100, 'test');

    expect(reduction).toBeGreaterThan(0);
    expect(command.maxHealth - command.health).toBeCloseTo(100 * (1 - reduction));
  });

  it('makes dense-column flagship gun pulses stronger', () => {
    const line = createSimulation();
    const column = createSimulation();
    startCombat(line);
    column.changeFormation('denseColumn');
    startCombat(column);
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
    startCombat(simulation);
    simulation.enemies = [];
    simulation.wave = 4;
    simulation.beginNextWave();
    engageCurrentWave(simulation);
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
    startCombat(simulation);
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

  it('does not respawn destroyed slots when purchasing non-fleet upgrades', () => {
    const simulation = new GameSimulation({
      random: () => 0.5,
      progressionState: { currency: 1000 },
    });
    startCombat(simulation);
    simulation.friendlies[0].alive = false;
    simulation.removeDestroyedEntities();
    const survivingSlots = simulation.friendlies.map(({ slot }) => slot);

    expect(simulation.purchaseUpgrade('commandNetwork').purchased).toBe(true);
    simulation.update(1 / 60);

    expect(simulation.friendlies.map(({ slot }) => slot)).toEqual(survivingSlots);
    expect(simulation.friendlies.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });

  it('uses shields before hull integrity', () => {
    const simulation = new GameSimulation({
      random: () => 0.5,
      progressionState: { currency: 500, upgrades: { shieldStrength: 1 } },
    });
    startCombat(simulation);
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
    startCombat(simulation);
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
    startCombat(simulation);
    simulation.enemies = [];
    simulation.wave = 2;
    simulation.beginNextWave();
    expect(simulation.enemies.some((enemy) => enemy.elite)).toBe(true);

    simulation.enemies = [];
    simulation.wave = 4;
    simulation.beginNextWave();
    engageCurrentWave(simulation);
    const boss = simulation.enemies.find((enemy) => enemy.boss);
    expect(boss).toBeDefined();
    expect(boss.role).toBe('boss');
    expect(simulation.consumeEvents().some((event) => event.type === 'bossWaveStarted')).toBe(true);
  });

  it('makes automatic fire weak against a boss until the flagship gun exposes its hull', () => {
    const simulation = createSimulation();
    startCombat(simulation);
    simulation.enemies = [];
    simulation.wave = 4;
    simulation.beginNextWave();
    engageCurrentWave(simulation);
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
    startCombat(simulation);
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
    const escort = simulation.friendlies.find((ship) => ship.role === 'escort');
    const lancer = simulation.friendlies.find((ship) => ship.role === 'lancer');
    const guardian = simulation.friendlies.find((ship) => ship.role === 'guardian');

    expect(lancer.fireInterval).toBeLessThan(escort.fireInterval);
    expect(lancer.maxHealth).toBeLessThan(escort.maxHealth);
    expect(guardian.maxHealth).toBeGreaterThan(escort.maxHealth);
    expect(guardian.damage).toBeLessThan(escort.damage);
  });

  it('unlocks three loadouts and ignores their cooldown during deployment', () => {
    const simulation = new GameSimulation({
      random: () => 0.5,
      progressionState: { upgrades: { commandNetwork: 3 } },
    });
    startCombat(simulation);

    expect(simulation.activateFormationLoadout(1).changed).toBe(true);
    expect(simulation.activateFormationLoadout(2)).toMatchObject({ changed: false, reason: 'cooldown' });
    simulation.wavePhase = 'deployment';
    expect(simulation.activateFormationLoadout(2).changed).toBe(true);
    expect(simulation.getSnapshot().formation.activeLoadoutIndex).toBe(2);
  });

  it('creates blast circles, strafing lanes, focused lines, and combined boss warnings', () => {
    const simulation = createSimulation();
    startCombat(simulation);
    const source = { id: 'major', role: 'boss', x: 0, y: 45, damage: 20, boss: true, majorPatternIndex: 3 };

    const blast = simulation.createTelegraph(source, 'artillery');
    const lane = simulation.createTelegraph(source, 'skirmisher');
    const focus = simulation.createTelegraph(source, 'bulwark');
    expect(blast).toMatchObject({ kind: 'blast', radius: 11 });
    expect(lane).toMatchObject({ kind: 'lane', width: 8 });
    expect(focus).toMatchObject({ kind: 'focus', width: 4.8 });
    expect(blast.duration).toBeGreaterThan(1);

    simulation.telegraphs = [];
    simulation.beginEnemyMajorAttack(source);
    expect(simulation.telegraphs.map(({ kind }) => kind).sort()).toEqual(['blast', 'lane']);
  });

  it('resolves warnings against impact-time positions and caps Tactical Edge at three', () => {
    const simulation = createSimulation();
    startCombat(simulation);
    const source = { id: 'artillery', role: 'artillery', x: 0, y: 45, damage: 20, boss: false };
    const command = simulation.getCommandShip();
    const hullBefore = command.health;

    const hit = simulation.createTelegraph(source, 'artillery');
    hit.x = command.x;
    hit.y = command.y;
    simulation.resolveTelegraph(hit);
    expect(command.health).toBeLessThan(hullBefore);
    expect(simulation.getSnapshot().tacticalEdge.stacks).toBe(0);

    for (let attack = 0; attack < 5; attack += 1) {
      simulation.friendlies.forEach((ship) => { ship.x = ship.targetX; ship.y = ship.targetY; });
      const evaded = simulation.createTelegraph(source, 'artillery');
      simulation.friendlies.forEach((ship) => { ship.x = 35; ship.y = -65; });
      simulation.resolveTelegraph(evaded);
    }
    expect(simulation.getSnapshot().tacticalEdge.stacks).toBe(3);
    expect(simulation.consumeEvents().filter((event) => event.type === 'telegraphEvaded')).toHaveLength(5);
  });

  it('consumes all Tactical Edge stacks at burst start for damage and critical chance', () => {
    const baseline = createSimulation();
    startCombat(baseline);
    const [baselineTarget, ...baselineOthers] = baseline.enemies;
    Object.assign(baselineTarget, { x: 0, y: 0, health: 10000, maxHealth: 10000, speed: 0, drift: 0 });
    baselineOthers.forEach((enemy) => { enemy.x = 40; });
    baseline.consumeEvents();
    baseline.beginFlagshipFire(baselineTarget.x, baselineTarget.y);
    const baselinePulse = baseline.consumeEvents().find((event) => event.type === 'flagshipGunPulse');

    const simulation = createSimulation();
    startCombat(simulation);
    const [target, ...others] = simulation.enemies;
    Object.assign(target, { x: 0, y: 0, health: 10000, maxHealth: 10000, speed: 0, drift: 0 });
    others.forEach((enemy) => { enemy.x = 40; });
    simulation.tacticalEdgeStacks = 3;
    simulation.consumeEvents();

    simulation.beginFlagshipFire(target.x, target.y);
    const pulse = simulation.consumeEvents().find((event) => event.type === 'flagshipGunPulse');

    expect(pulse.tacticalEdgeStacks).toBe(3);
    expect(pulse.tacticalDamageMultiplier).toBeCloseTo(1.36);
    expect(pulse.damage).toBeCloseTo(baselinePulse.damage * 1.36);
    expect(pulse.criticalChance).toBeCloseTo(FLAGSHIP_GUN.criticalStartChance + 0.24);
    expect(simulation.getSnapshot().tacticalEdge.stacks).toBe(0);
  });

  it('adds Tactical Edge critical chance to the first pulse', () => {
    const simulation = new GameSimulation({ random: () => 0.2 });
    startCombat(simulation);
    const [target, ...others] = simulation.enemies;
    Object.assign(target, { x: 0, y: 0, health: 10000, maxHealth: 10000, speed: 0, drift: 0 });
    others.forEach((enemy) => { enemy.x = 40; });
    simulation.tacticalEdgeStacks = 3;
    simulation.consumeEvents();

    simulation.beginFlagshipFire(target.x, target.y);
    const pulse = simulation.consumeEvents().find((event) => event.type === 'flagshipGunPulse');
    expect(FLAGSHIP_GUN.criticalStartChance).toBeLessThan(0.2);
    expect(pulse.criticalChance).toBeGreaterThan(0.2);
    expect(pulse.critical).toBe(true);
  });

  it('cancels formation editing when combat pauses or ends', () => {
    const simulation = createSimulation();
    startCombat(simulation);
    const ship = simulation.friendlies[0];
    expect(simulation.beginShipDrag(ship.x, ship.y).dragging).toBe(true);

    expect(simulation.togglePause()).toBe(true);
    expect(simulation.getSnapshot().formation.preview).toBeNull();
    expect(simulation.beginShipDrag(ship.x, ship.y)).toMatchObject({ dragging: false, reason: 'inactive' });

    simulation.togglePause();
    simulation.damageEntity(simulation.getCommandShip(), 10000, 'test');
    expect(simulation.beginShipDrag(ship.x, ship.y)).toMatchObject({ dragging: false, reason: 'inactive' });
  });

  it('keeps Tactical Edge between waves but resets it with the run', () => {
    const simulation = createSimulation();
    startCombat(simulation);
    simulation.tacticalEdgeStacks = 2;
    simulation.enemies = [];
    simulation.wave = 1;
    simulation.beginNextWave();
    expect(simulation.getSnapshot().tacticalEdge.stacks).toBe(2);

    simulation.restartRun();
    expect(simulation.getSnapshot().tacticalEdge.stacks).toBe(0);
  });

});
