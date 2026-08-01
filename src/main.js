import './styles.css';
import { GameSimulation } from './combat/GameSimulation.js';
import { TargetingInput } from './input/TargetingInput.js';
import { GameRenderer } from './rendering/GameRenderer.js';
import { HudController } from './ui/HudController.js';

const FIXED_STEP = 1 / 60;
const MAX_FRAME_CATCHUP = 0.2;

const battlefield = document.querySelector('#battlefield');
const simulation = new GameSimulation();
const gameRenderer = new GameRenderer(battlefield);

function consumeAndDispatchEvents() {
  const events = simulation.consumeEvents();
  if (events.length === 0) return;
  gameRenderer.handleEvents(events);
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
  onPause: () => {
    simulation.togglePause();
    consumeAndDispatchEvents();
  },
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
    hud.update(snapshot);
    hud.tick(rawDelta);
    targetingInput.setEnabled(snapshot.status === 'running');
  }

  gameRenderer.render();
  requestAnimationFrame(frame);
}

function handleVisibilityChange() {
  const hidden = document.hidden;
  simulation.setSuspended(hidden);
  if (!hidden) {
    previousTime = performance.now();
    accumulator = 0;
  }
}

window.addEventListener('resize', () => gameRenderer.resize(), { passive: true });
document.addEventListener('visibilitychange', handleVisibilityChange);

// A deliberately small read-only seam for browser smoke tests and future diagnostics.
globalThis.__VOIDLINE__ = Object.freeze({
  getSnapshot: () => simulation.getSnapshot(),
});

gameRenderer.sync(simulation.getSnapshot(), 0);
hud.update(simulation.getSnapshot());
gameRenderer.render();
requestAnimationFrame(frame);
