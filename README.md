# Voidline Command

An original, touch-first browser game about commanding a geometric deep-space fleet. Your escorts hold the lower edge of a full-screen battlefield while you sweep the flagship's sustained cannon across incoming formations.

This project uses its own setting, silhouettes, color language, and procedural effects. It does not use names, characters, ship designs, story elements, audio, or visual assets from existing franchises.

## Play

The latest deployed build will be available at:

<https://tharak.github.io/BattleshipsIdle/>

- Use the opening deployment overlay to send the fleet into battle.
- Hold the battlefield and drag to aim the flagship's pulsed cannon. Partial charge is always usable, while an uninterrupted burst builds pulse damage and critical-hit chance. Each shot stops at the first enemy hull or continues to the battlefield boundary.
- Choose formations from the five persistent fleet-diagram buttons and visible bonus labels along the bottom edge.
- Open upgrades from the sixth bottom-dock button, which also displays current salvage.
- Escort ships fire automatically; the flagship only fires while you hold and aim its cannon.
- Destroy attackers to earn salvage and advance to harder waves.
- Boss barriers blunt automatic fire. Sweep the flagship gun across the boss to expose its hull, then capitalize before the barrier restores.
- Protect the command ship. If it is destroyed, use **Restart** to begin a new run.

The interface is designed for touchscreens and also supports mouse input on desktop browsers.

## Playable systems

The current prototype includes:

- an edge-to-edge Three.js battlefield with full-height framing, adaptive horizontal combat bounds, and original procedural ships;
- five animated formations and escalating enemy waves;
- raiders, skirmishers, bulwarks, artillery ships, elites, and recurring Rift bastion bosses;
- automatic friendly fire and enemy pressure;
- a hold-and-aim pulsed flagship cannon with partial-charge firing, escalating burst damage and critical chance, proportional cooling, turret recoil, tracers, and first-contact impacts;
- boss barriers that reward actively tracking the target with flagship fire;
- damage, destruction, salvage rewards, defeat, and restart behavior;
- flagship-mounted energy lights, firing/cooling audio, and persistent in-world hull and shield bars;
- an always-visible tactical dock with five formation icons, concise bonus text, and the salvage/upgrade control;
- transient wave announcements plus readable flagship and boss status;
- distinct formation mechanics: broad range, forward damage, damage mitigation, flank focus, and concentrated strikes;
- eleven progressive upgrade branches, including a 250,000-salvage autonomous-gunnery end-game unlock;
- persistent salvage, upgrade levels, highest-wave progress, and selected formation in `localStorage`;
- capped offline patrol earnings with a clear return report;
- fleet-size, durability, and visible shield upgrades that update the active formation immediately;
- unlockable lancer and guardian ship classes with distinct silhouettes and combat stats;
- original procedural Web Audio cues for weapons, impacts, shields, destruction, waves, formations, upgrades, alerts, and every interface button;

## Local development

Requirements: a current Node.js LTS release and npm.

```bash
npm install
npm run dev
```

Vite prints the local development URL. To run the automated checks and preview a production build:

```bash
npm test
npm run build
npm run preview
```

The production output is written to `dist/`.

## Project layout

- `src/config/balance.js` contains centralized gameplay and balance values.
- `src/config/enemies.js` contains enemy roles, elite modifiers, and boss balance.
- `src/config/rendering.js` owns the color palette and tunable scene, ship, effect, animation, and viewport presentation values.
- `src/combat/GameSimulation.js` owns deterministic combat and wave rules.
- `src/progression/RunProgression.js` tracks the current run's lightweight rewards.
- `src/progression/UpgradeSystem.js` owns progressive costs and mechanical upgrade effects.
- `src/persistence/PersistenceStore.js` validates local saves and calculates capped offline earnings.
- `src/formations/FormationSystem.js` owns layouts, transitions, and formation combat modifiers.
- `src/rendering/GameRenderer.js` turns combat state into procedural Three.js visuals and effects.
- `src/rendering/ObjectPool.js` reuses short-lived projectile and effect objects.
- `src/audio/AudioManager.js` synthesizes original combat cues without downloaded assets.
- `src/input/TargetingInput.js` maps touch and mouse pointer input into battlefield targeting orders.
- `src/ui/HudController.js` owns HUD, upgrades, deploy, defeat, and restart interactions.
- `src/main.js` connects the simulation, renderer, input, progression, and UI modules.
- `tests/` covers deterministic game rules.
- `.github/workflows/deploy.yml` builds and publishes the static site to GitHub Pages.

Rendering, input, UI, and game rules remain separated so the prototype can be tuned without growing a single oversized game file.

## Deployment

Pushing to `main` runs tests, creates a Vite production build with the repository base path, and deploys `dist/` using GitHub's official Pages actions. The workflow can also be started manually from the Actions tab.

For a new repository, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** once. No backend or runtime secrets are required.
