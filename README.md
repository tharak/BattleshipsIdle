# Voidline Command

An original, touch-first browser game about shaping and commanding a geometric deep-space fleet. Arrange ships live in the lower fleet zone, dodge telegraphed attacks, and turn successful maneuvers into stronger flagship bursts.

This project uses its own setting, silhouettes, color language, and procedural effects. It does not use names, characters, ship designs, story elements, audio, or visual assets from existing franchises.

## Play

The latest deployed build will be available at:

<https://tharak.github.io/BattleshipsIdle/>

- Use the opening deployment overlay to reveal the enemy's randomly selected formation.
- Drag any friendly ship in the lower quarter of the battlefield. Destinations snap to the visible five-unit grid, reject overlap, and save into the active loadout immediately.
- Press **Ready** at center screen when the formation is set. Both fleets advance, stop at contact range, and only then begin firing.
- Drag in the upper three quarters to aim the flagship's pulsed cannon. Partial charge is always usable, while an uninterrupted burst builds pulse damage and critical-hit chance.
- Watch blast circles, strafing lanes, and focused firing lines. Completely evading a warning earns Tactical Edge for the next flagship burst.
- Switch among up to three custom loadouts, or apply one of the five editable starter templates from the compact picker.
- Read the live spread, cohesion, and flagship-screening bonuses in the command console. Open upgrades from its salvage button.
- Escort ships fire automatically; the flagship only fires while you hold and aim its cannon.
- All ships are limited to half the battlefield's height in weapon range.
- Clear the flagship's forward lane to unlock **Advance**. Dash into the next wave immediately, or keep destroying off-lane contacts for more salvage first.
- Boss barriers blunt automatic fire. Sweep the flagship gun across the boss to expose its hull, then capitalize before the barrier restores.
- Protect the command ship. If it is destroyed, use **Restart** to begin a new run.

The interface is designed for touchscreens and also supports mouse input on desktop browsers.

## Playable systems

The current prototype includes:

- an edge-to-edge Three.js battlefield with full-height framing, adaptive horizontal combat bounds, and original procedural ships;
- a reveal/deploy/approach/combat encounter loop using the five shared formation templates, a centered Ready command, and half-field weapon range;
- three persistent custom loadouts, five editable starter templates, a snap-grid editor, and physical formation maneuvers;
- raiders, skirmishers, bulwarks, artillery ships, elites, and recurring Rift bastion bosses;
- automatic friendly fire, basic enemy pressure, and position-resolved telegraphed major attacks;
- a hold-and-aim pulsed flagship cannon with partial-charge firing, escalating burst damage and critical chance, proportional cooling, turret recoil, tracers, and first-contact impacts;
- boss barriers that reward actively tracking the target with flagship fire;
- damage, destruction, salvage rewards, defeat, and restart behavior;
- a position-tested flagship escape lane that lets the player secure a wave early or stay in combat to farm remaining contacts;
- flagship-mounted energy lights, firing/cooling audio, and persistent in-world hull and shield bars;
- an always-visible formation console with live/preview geometry bonuses, loadout state, Tactical Edge, templates, and the salvage/upgrade control;
- transient wave announcements plus readable flagship and boss status;
- geometry-derived range, side-target damage, fire-rate, flagship-damage, and flagship-screening strengths based on current ship positions;
- three-stack Tactical Edge, earned by complete evasions and consumed by the next flagship burst for damage and critical chance;
- eleven progressive upgrade branches, including a 250,000-salvage autonomous-gunnery end-game unlock;
- version-two persistence for salvage, upgrade levels, highest-wave progress, all formation loadouts, and the active loadout, with automatic legacy-save migration;
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
- `src/formations/FormationSystem.js` owns custom loadouts, placement validation, physical maneuvers, and geometry-derived combat modifiers.
- `src/rendering/GameRenderer.js` turns combat state into procedural Three.js visuals and effects.
- `src/rendering/ObjectPool.js` reuses short-lived projectile and effect objects.
- `src/audio/AudioManager.js` synthesizes original combat cues without downloaded assets.
- `src/input/TargetingInput.js` routes touch and mouse gestures into lower-zone formation edits or upper-zone flagship targeting.
- `src/ui/HudController.js` owns HUD, upgrades, deploy, defeat, and restart interactions.
- `src/main.js` connects the simulation, renderer, input, progression, and UI modules.
- `tests/` covers deterministic game rules.
- `.github/workflows/deploy.yml` builds and publishes the static site to GitHub Pages.

Rendering, input, UI, and game rules remain separated so the prototype can be tuned without growing a single oversized game file.

## Deployment

Pushing to `main` runs tests, creates a Vite production build with the repository base path, and deploys `dist/` using GitHub's official Pages actions. The workflow can also be started manually from the Actions tab.

For a new repository, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** once. No backend or runtime secrets are required.
