import './styles.css';
import { GameSimulation } from './combat/GameSimulation.js';
import { TargetingInput } from './input/TargetingInput.js';
import { GameRenderer } from './rendering/GameRenderer.js';
import { HudController } from './ui/HudController.js';
import { PersistenceStore } from './persistence/PersistenceStore.js';
import { AudioManager } from './audio/AudioManager.js';

const FIXED_STEP = 1 / 60;
const MAX_FRAME_CATCHUP = 0.2;

const battlefield = document.querySelector('#battlefield');
const persistence = new PersistenceStore(window.localStorage);
const loadedSave = persistence.load();
let persistentState = loadedSave.state;
let simulation;
let saveTimer = 0;

function persistNow() {
  if (!simulation) return;
  persistentState = persistence.save({
    ...persistentState,
    ...simulation.getPersistentState(),
  });
}

function schedulePersist() {
  if (saveTimer) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    persistNow();
  }, 900);
}

simulation = new GameSimulation({
  progressionState: persistentState,
  selectedFormation: persistentState.selectedFormation,
  onStateChange: schedulePersist,
});
const gameRenderer = new GameRenderer(battlefield);
const audio = new AudioManager({ enabled: true });
gameRenderer.setScreenShakeEnabled(true);

function consumeAndDispatchEvents() {
  const events = simulation.consumeEvents();
  if (events.length === 0) return;
  gameRenderer.handleEvents(events);
  audio.handleEvents(events);
  hud.handleEvents(events);
}

const hud = new HudController({
  onStart: () => {
    gameRenderer.resetScene();
    simulation.startRun();
    consumeAndDispatchEvents();
  },
  onRestart: () => {
    gameRenderer.resetScene();
    simulation.restartRun();
    consumeAndDispatchEvents();
  },
  onFormation: (formationId) => {
    const result = simulation.changeFormation(formationId);
    consumeAndDispatchEvents();
    return result;
  },
  onShopOpen: () => {
    const opened = simulation.openShop();
    consumeAndDispatchEvents();
    return opened;
  },
  onShopClose: () => {
    const closed = simulation.closeShop();
    consumeAndDispatchEvents();
    return closed;
  },
  onUpgrade: (upgradeId) => {
    const result = simulation.purchaseUpgrade(upgradeId);
    consumeAndDispatchEvents();
    persistNow();
    return { ...result, snapshot: simulation.getSnapshot() };
  },
  onOnboardingComplete: () => {
    persistentState.onboardingComplete = true;
    persistNow();
  },
  offlineSummary: loadedSave.offline,
  onboardingComplete: persistentState.onboardingComplete,
});

const targetingInput = new TargetingInput({
  element: gameRenderer.renderer.domElement,
  toWorld: (clientX, clientY) => gameRenderer.screenToWorld(clientX, clientY),
  onTarget: ({ x, y }) => {
    const result = simulation.fireVolley(x, y);
    consumeAndDispatchEvents();
    return result;
  },
});

let previousTime = performance.now();
let accumulator = 0;

function frame(now) {
  const rawDelta = Math.min(MAX_FRAME_CATCHUP, Math.max(0, (now - previousTime) / 1000));
  previousTime = now;

  if (!simulation.suspended) {
    accumulator += rawDelta;
    while (accumulator >= FIXED_STEP) {
      simulation.update(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }

    consumeAndDispatchEvents();
    const snapshot = simulation.getSnapshot();
    gameRenderer.sync(snapshot, rawDelta);
    const flagship = snapshot.friendlies.find((ship) => ship.role === 'command');
    const flagshipVitalsPosition = flagship
      ? gameRenderer.worldToScreen(flagship.x, flagship.y - 5.3, 1.5)
      : null;
    hud.update(snapshot, flagshipVitalsPosition);
    hud.tick(rawDelta);
    targetingInput.setEnabled(snapshot.status === 'running' && snapshot.waveIntermission <= 0);
  }

  gameRenderer.render();
  requestAnimationFrame(frame);
}

function handleVisibilityChange() {
  const hidden = document.hidden;
  if (hidden) persistNow();
  simulation.setSuspended(hidden);
  if (!hidden) {
    previousTime = performance.now();
    accumulator = 0;
  }
}

window.addEventListener('resize', () => gameRenderer.resize(), { passive: true });
window.addEventListener('pagehide', persistNow);
document.addEventListener('visibilitychange', handleVisibilityChange);

// A deliberately small read-only seam for browser smoke tests and future diagnostics.
globalThis.__VOIDLINE__ = Object.freeze({
  getSnapshot: () => simulation.getSnapshot(),
});

const initialSnapshot = simulation.getSnapshot();
gameRenderer.sync(initialSnapshot, 0);
const initialFlagship = initialSnapshot.friendlies.find((ship) => ship.role === 'command');
hud.update(
  initialSnapshot,
  initialFlagship ? gameRenderer.worldToScreen(initialFlagship.x, initialFlagship.y - 5.3, 1.5) : null,
);
gameRenderer.render();
requestAnimationFrame(frame);
