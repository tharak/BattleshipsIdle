# Voidline Command

An original, touch-first browser game about commanding a geometric deep-space fleet. Your ships hold the lower edge of a fixed battlefield, automatically engaging incoming formations while you call deliberate coordinated volleys at the most dangerous targets.

This project uses its own setting, silhouettes, color language, and procedural effects. It does not use names, characters, ship designs, story elements, audio, or visual assets from existing franchises.

## Play

The latest deployed build will be available at:

<https://tharak.github.io/BattleshipsIdle/>

- Use the opening deployment overlay to send the fleet into battle.
- Tap or click the battlefield when the volley meter is ready to focus the fleet's fire at that position.
- Friendly ships fire automatically; manual volleys deal concentrated damage and reward timing.
- Destroy attackers to earn salvage and advance to harder waves.
- Protect the command ship. If it is destroyed, use **Restart** to begin a new run.
- Use the pause control when you need to suspend combat.

The interface is designed for touchscreens and also supports mouse input on desktop browsers.

## Playable systems

The current prototype includes:

- a responsive Three.js battlefield with original procedural ships and effects;
- five animated formations and escalating enemy waves;
- automatic friendly fire and enemy pressure;
- cooldown-limited touch/click coordinated volleys;
- damage, destruction, salvage rewards, defeat, and restart behavior;
- a minimal HUD for wave, command health, salvage, volley readiness, and formation control;
- distinct formation mechanics: broad range, forward damage, damage mitigation, flank focus, and concentrated volleys.

Upgrades, local saving, offline earnings, additional enemy types, bosses, sound, and onboarding arrive in the remaining roadmap iterations.

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
- `src/combat/GameSimulation.js` owns deterministic combat and wave rules.
- `src/progression/RunProgression.js` tracks the current run's lightweight rewards.
- `src/formations/FormationSystem.js` owns layouts, transitions, and formation combat modifiers.
- `src/rendering/GameRenderer.js` turns combat state into procedural Three.js visuals and effects.
- `src/rendering/ObjectPool.js` reuses short-lived projectile and effect objects.
- `src/input/TargetingInput.js` maps touch and mouse pointer input into battlefield targeting orders.
- `src/ui/HudController.js` owns HUD and deploy, pause, defeat, and restart interactions.
- `src/main.js` connects the simulation, renderer, input, progression, and UI modules.
- `tests/` covers deterministic game rules.
- `.github/workflows/deploy.yml` builds and publishes the static site to GitHub Pages.

Rendering, input, UI, and game rules remain separated so the prototype can be tuned without growing a single oversized game file.

## Deployment

Pushing to `main` runs tests, creates a Vite production build with the repository base path, and deploys `dist/` using GitHub's official Pages actions. The workflow can also be started manually from the Actions tab.

For a new repository, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** once. No backend or runtime secrets are required.
