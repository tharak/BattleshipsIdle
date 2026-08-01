# Voidline Command

An original, touch-first browser game about commanding a geometric deep-space fleet. Your ships hold the lower edge of a fixed battlefield, automatically engaging incoming formations while you aim the flagship's heavy weapon at the most dangerous targets.

This project uses its own setting, silhouettes, color language, and procedural effects. It does not use names, characters, ship designs, story elements, audio, or visual assets from existing franchises.

## Play

The latest deployed build will be available at:

<https://tharak.github.io/BattleshipsIdle/>

- Use the opening deployment overlay to send the fleet into battle.
- Tap or click the battlefield when all charge lights around the flagship are lit to fire at that position.
- Choose formations from the five persistent fleet-diagram buttons and visible bonus labels along the bottom edge.
- Friendly ships fire automatically; the manual flagship strike deals concentrated damage and rewards timing.
- Destroy attackers to earn salvage and advance to harder waves.
- Boss barriers blunt automatic fire. Land a flagship strike to expose the hull, then capitalize before it restores.
- Protect the command ship. If it is destroyed, use **Restart** to begin a new run.
- Use the pause control when you need to suspend combat.

The interface is designed for touchscreens and also supports mouse input on desktop browsers.

## Playable systems

The current prototype includes:

- a responsive Three.js battlefield with original procedural ships and effects;
- five animated formations and escalating enemy waves;
- raiders, skirmishers, bulwarks, artillery ships, elites, and recurring Rift bastion bosses;
- automatic friendly fire and enemy pressure;
- a cooldown-limited touch/click flagship heavy strike;
- boss barriers that reward an accurately timed flagship strike;
- damage, destruction, salvage rewards, defeat, and restart behavior;
- flagship-mounted charge lights, ready audio, and persistent in-world hull and shield bars;
- an always-visible icon formation bar with concise bonus text;
- a readable HUD for wave, combined salvage/upgrades, and boss status;
- distinct formation mechanics: broad range, forward damage, damage mitigation, flank focus, and concentrated strikes;
- ten progressive upgrade branches with visible current/next effects and costs;
- persistent salvage, upgrade levels, highest-wave progress, and selected formation in `localStorage`;
- capped offline patrol earnings with a clear return report;
- fleet-size, durability, and visible shield upgrades that update the active formation immediately;
- unlockable lancer and guardian ship classes with distinct silhouettes and combat stats;
- original procedural Web Audio cues, optional camera feedback, and touch-first onboarding.

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
- `src/combat/GameSimulation.js` owns deterministic combat and wave rules.
- `src/progression/RunProgression.js` tracks the current run's lightweight rewards.
- `src/progression/UpgradeSystem.js` owns progressive costs and mechanical upgrade effects.
- `src/persistence/PersistenceStore.js` validates local saves and calculates capped offline earnings.
- `src/formations/FormationSystem.js` owns layouts, transitions, and formation combat modifiers.
- `src/rendering/GameRenderer.js` turns combat state into procedural Three.js visuals and effects.
- `src/rendering/ObjectPool.js` reuses short-lived projectile and effect objects.
- `src/audio/AudioManager.js` synthesizes original combat cues without downloaded assets.
- `src/input/TargetingInput.js` maps touch and mouse pointer input into battlefield targeting orders.
- `src/ui/HudController.js` owns HUD and deploy, pause, defeat, and restart interactions.
- `src/main.js` connects the simulation, renderer, input, progression, and UI modules.
- `tests/` covers deterministic game rules.
- `.github/workflows/deploy.yml` builds and publishes the static site to GitHub Pages.

Rendering, input, UI, and game rules remain separated so the prototype can be tuned without growing a single oversized game file.

## Deployment

Pushing to `main` runs tests, creates a Vite production build with the repository base path, and deploys `dist/` using GitHub's official Pages actions. The workflow can also be started manually from the Actions tab.

For a new repository, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** once. No backend or runtime secrets are required.
