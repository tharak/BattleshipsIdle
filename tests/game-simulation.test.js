import { describe, expect, it } from 'vitest';
import { FLEET, VOLLEY, WAVES } from '../src/config/balance.js';
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

  it('automatically fires at approaching enemies', () => {
    const simulation = createSimulation();
    simulation.startRun();
    simulation.consumeEvents();
    advance(simulation, 0.9);

    const events = simulation.consumeEvents();
    expect(events.some((event) => event.type === 'projectileFired' && event.faction === 'friendly')).toBe(true);
    expect(simulation.getSnapshot().projectiles.length).toBeGreaterThan(0);
  });

  it('rewards a precise volley and enforces its cooldown', () => {
    const simulation = createSimulation();
    simulation.startRun();
    simulation.consumeEvents();
    const target = simulation.getSnapshot().enemies[0];

    const first = simulation.fireVolley(target.x, target.y);
    const salvageAfterHit = simulation.getSnapshot().progression.salvage;
    const second = simulation.fireVolley(target.x, target.y);

    expect(first.fired).toBe(true);
    expect(first.preciseHits).toBeGreaterThanOrEqual(1);
    expect(salvageAfterHit).toBeGreaterThan(0);
    expect(second).toMatchObject({ fired: false, reason: 'cooldown' });
    expect(simulation.getSnapshot().volleyRemaining).toBeCloseTo(VOLLEY.cooldown);
  });

  it('clears a defeated wave, grants a wave reward, and starts the next wave', () => {
    const simulation = createSimulation();
    simulation.startRun();
    simulation.consumeEvents();

    for (const enemy of [...simulation.enemies]) simulation.damageEntity(enemy, enemy.health, 'test');
    simulation.removeDestroyedEntities();
    simulation.resolveWaveIfNeeded();

    expect(simulation.getSnapshot().waveIntermission).toBe(WAVES.intermission);
    expect(simulation.fireVolley(0, 0)).toMatchObject({ fired: false, reason: 'inactive' });
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

  it('recovers volley charge and allows a later order', () => {
    const simulation = createSimulation();
    simulation.startRun();
    const target = simulation.enemies[0];

    expect(simulation.fireVolley(target.x, target.y).fired).toBe(true);
    advance(simulation, VOLLEY.cooldown + 0.1);

    expect(simulation.getSnapshot().volleyRemaining).toBe(0);
    expect(simulation.fireVolley(0, 0).fired).toBe(true);
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
    simulation.fireVolley(target.x, target.y);
    advance(simulation, 0.8);
    simulation.progression.recordEnemyDestroyed(50);
    const persistentCurrency = simulation.getSnapshot().progression.currency;

    simulation.restartRun();
    const snapshot = simulation.getSnapshot();

    expect(snapshot.status).toBe('running');
    expect(snapshot.wave).toBe(1);
    expect(snapshot.commandHealth).toBe(FLEET.commandHealth);
    expect(snapshot.volleyRemaining).toBe(0);
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

  it('applies defensive arc mitigation to incoming damage', () => {
    const simulation = createSimulation();
    simulation.changeFormation('defensiveArc');
    simulation.startRun();
    const command = simulation.getCommandShip();

    simulation.damageEntity(command, 100, 'test');

    expect(command.maxHealth - command.health).toBeCloseTo(68);
  });

  it('makes dense-column volleys stronger and tighter', () => {
    const line = createSimulation();
    const column = createSimulation();
    line.startRun();
    column.changeFormation('denseColumn');
    column.startRun();
    line.enemies[0].health = 1000;
    line.enemies[0].maxHealth = 1000;
    column.enemies[0].health = 1000;
    column.enemies[0].maxHealth = 1000;

    const lineResult = line.fireVolley(line.enemies[0].x, line.enemies[0].y);
    const columnResult = column.fireVolley(column.enemies[0].x, column.enemies[0].y);
    const lineDamage = 1000 - line.enemies[0].health;
    const columnDamage = 1000 - column.enemies[0].health;

    expect(columnDamage).toBeGreaterThan(lineDamage);
    expect(columnResult.hits).toBeLessThanOrEqual(lineResult.hits);
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

  it('makes automatic fire weak against a boss until a volley exposes its hull', () => {
    const simulation = createSimulation();
    simulation.startRun();
    simulation.enemies = [];
    simulation.wave = 4;
    simulation.beginNextWave();
    const boss = simulation.enemies.find((enemy) => enemy.boss);
    const before = boss.health;

    simulation.damageEntity(boss, 100, 'projectile');
    expect(before - boss.health).toBeCloseTo(16);

    const result = simulation.fireVolley(boss.x, boss.y);
    expect(result.fired).toBe(true);
    expect(boss.exposedRemaining).toBeGreaterThan(0);
    expect(before - boss.health).toBeGreaterThan(100);
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

  it('pauses combat while settings are open', () => {
    const simulation = createSimulation();
    simulation.startRun();
    advance(simulation, 0.5);
    const elapsed = simulation.elapsed;

    expect(simulation.openSettings()).toBe(true);
    advance(simulation, 1);
    expect(simulation.elapsed).toBe(elapsed);
    expect(simulation.closeSettings()).toBe(true);
    expect(simulation.status).toBe('running');
  });
});
