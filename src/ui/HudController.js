function percent(value) {
  return Math.round(Math.max(0, Number(value) || 0) * 100);
}

function previewSuffix(preview, keys) {
  if (!preview) return '';
  const values = keys.map((key) => Math.round((preview.changes?.[key] ?? 0) * 100));
  if (values.every((value) => value === 0)) return '';
  return ` (${values.map((value) => `${value >= 0 ? '+' : ''}${value}`).join('/')})`;
}

export class HudController {
  constructor({
    onStart,
    onRestart,
    onReady,
    onAdvance,
    onLoadout,
    onTemplate,
    onShopOpen,
    onShopClose,
    onUpgrade,
    onOnboardingComplete,
    offlineSummary,
    onboardingComplete,
  }) {
    this.elements = {
      currency: document.querySelector('#currency-value'),
      flagshipVitals: document.querySelector('#flagship-vitals'),
      flagshipHullFill: document.querySelector('#flagship-hull-fill'),
      flagshipShieldFill: document.querySelector('#flagship-shield-fill'),
      message: document.querySelector('#message-banner'),
      startOverlay: document.querySelector('#start-overlay'),
      startButton: document.querySelector('#start-button'),
      gameoverOverlay: document.querySelector('#gameover-overlay'),
      restartButton: document.querySelector('#restart-button'),
      runSummary: document.querySelector('#run-summary'),
      waveIntel: document.querySelector('#wave-intel'),
      enemyFormationName: document.querySelector('#enemy-formation-name'),
      wavePhaseLabel: document.querySelector('#wave-phase-label'),
      waveAction: document.querySelector('#wave-action'),
      waveActionButton: document.querySelector('#wave-action-button'),
      waveActionKicker: document.querySelector('#wave-action-kicker'),
      waveActionLabel: document.querySelector('#wave-action-label'),
      waveActionHint: document.querySelector('#wave-action-hint'),
      loadoutOptions: [...document.querySelectorAll('[data-loadout]')],
      templatePicker: document.querySelector('#formation-template'),
      spreadStrength: document.querySelector('#spread-strength'),
      cohesionStrength: document.querySelector('#cohesion-strength'),
      screeningStrength: document.querySelector('#screening-strength'),
      formationState: document.querySelector('#formation-state'),
      tacticalEdge: document.querySelector('#tactical-edge'),
      tacticalEdgeNodes: [...document.querySelectorAll('#tactical-edge i')],
      shopButton: document.querySelector('#shop-button'),
      startShopButton: document.querySelector('#start-shop-button'),
      gameoverShopButton: document.querySelector('#gameover-shop-button'),
      shopOverlay: document.querySelector('#shop-overlay'),
      shopCloseButton: document.querySelector('#shop-close-button'),
      shopCurrency: document.querySelector('#shop-currency'),
      upgradeList: document.querySelector('#upgrade-list'),
      offlineOverlay: document.querySelector('#offline-overlay'),
      offlineEarned: document.querySelector('#offline-earned'),
      offlineDetail: document.querySelector('#offline-detail'),
      offlineCloseButton: document.querySelector('#offline-close-button'),
      bossStatus: document.querySelector('#boss-status'),
      bossName: document.querySelector('#boss-name'),
      bossHealthValue: document.querySelector('#boss-health-value'),
      bossHealthFill: document.querySelector('#boss-health-fill'),
      bossBarrierState: document.querySelector('#boss-barrier-state'),
      coachmark: document.querySelector('#coachmark'),
      coachmarkTitle: document.querySelector('#coachmark-title'),
      coachmarkDetail: document.querySelector('#coachmark-detail'),
    };

    this.messageTimer = 0;
    this.elements.startButton.addEventListener('click', onStart);
    this.elements.restartButton.addEventListener('click', onRestart);
    this.elements.waveActionButton.addEventListener('click', () => {
      if (this.waveActionMode === 'ready') onReady();
      else if (this.waveActionMode === 'advance') onAdvance();
    });
    this.elements.shopButton.addEventListener('click', onShopOpen);
    this.elements.startShopButton.addEventListener('click', onShopOpen);
    this.elements.gameoverShopButton.addEventListener('click', onShopOpen);
    this.elements.shopCloseButton.addEventListener('click', onShopClose);
    for (const option of this.elements.loadoutOptions) {
      option.addEventListener('click', () => onLoadout(Number(option.dataset.loadout)));
    }
    this.elements.templatePicker.addEventListener('change', () => {
      if (this.elements.templatePicker.value) onTemplate(this.elements.templatePicker.value);
      this.elements.templatePicker.value = '';
    });
    this.onUpgrade = onUpgrade;
    this.lastUpgradeSignature = '';
    this.onboardingComplete = onboardingComplete;
    this.onboardingStage = 0;
    this.onOnboardingComplete = onOnboardingComplete;
    this.coachTimer = 0;
    this.waveActionMode = null;
    this.showOfflineSummary(offlineSummary);
    this.setReadyState();
  }

  setReadyState() {
    this.elements.gameoverOverlay.hidden = true;
    this.elements.gameoverOverlay.classList.remove('overlay--visible');
  }

  setRunningState() {
    this.elements.startOverlay.classList.remove('overlay--visible');
    this.elements.startOverlay.hidden = true;
    this.elements.gameoverOverlay.hidden = true;
    this.elements.gameoverOverlay.classList.remove('overlay--visible');
  }

  update(snapshot, flagshipScreenPosition = null) {
    this.elements.currency.textContent = snapshot.progression.salvage.toLocaleString();
    this.elements.shopButton.setAttribute('aria-label', `Open fleet upgrades. ${snapshot.progression.salvage.toLocaleString()} salvage available`);
    this.elements.shopCurrency.textContent = snapshot.progression.currency.toLocaleString();
    const hullPercent = Math.round((snapshot.commandHealth / Math.max(1, snapshot.commandMaxHealth)) * 100);
    const shieldPercent = snapshot.commandMaxShield > 0
      ? Math.round((snapshot.commandShield / snapshot.commandMaxShield) * 100)
      : 0;
    this.elements.flagshipVitals.hidden = !['running', 'paused'].includes(snapshot.status) || !flagshipScreenPosition;
    if (flagshipScreenPosition) {
      this.elements.flagshipVitals.style.left = `${flagshipScreenPosition.x}px`;
      this.elements.flagshipVitals.style.top = `${flagshipScreenPosition.y}px`;
    }
    this.elements.flagshipHullFill.style.transform = `scaleX(${Math.max(0, hullPercent) / 100})`;
    this.elements.flagshipShieldFill.style.transform = `scaleX(${Math.max(0, shieldPercent) / 100})`;
    this.elements.flagshipVitals.setAttribute('aria-label', `Flagship hull ${hullPercent} percent, shield ${shieldPercent} percent`);

    const { formation } = snapshot;
    const waveState = snapshot.waveState ?? { phase: 'idle' };
    const formationEditable = snapshot.status === 'ready'
      || (['running', 'paused'].includes(snapshot.status)
        && ['deployment', 'combat'].includes(waveState.phase));
    const modifiers = formation.preview?.modifiers ?? formation.modifiers;
    this.elements.spreadStrength.textContent = `RNG +${percent(modifiers.rangeBonus)}% · SIDE +${percent(modifiers.sideDamageBonus)}%${previewSuffix(formation.preview, ['rangeBonus', 'sideDamageBonus'])}`;
    this.elements.cohesionStrength.textContent = `RATE +${percent(modifiers.fireRateBonus)}% · GUN +${percent(modifiers.flagshipDamageBonus)}%${previewSuffix(formation.preview, ['fireRateBonus', 'flagshipDamageBonus'])}`;
    this.elements.screeningStrength.textContent = `SCREEN −${percent(modifiers.flagshipDamageReduction)}%${previewSuffix(formation.preview, ['flagshipDamageReduction'])}`;

    for (const option of this.elements.loadoutOptions) {
      const index = Number(option.dataset.loadout);
      const locked = index >= formation.unlockedLoadoutCount;
      const active = index === formation.activeLoadoutIndex;
      option.setAttribute('aria-pressed', String(active));
      option.classList.toggle('is-locked', locked);
      option.disabled = locked || !formationEditable
        || (!active && formation.cooldownRemaining > 0 && waveState.phase === 'combat');
      option.setAttribute('aria-label', locked
        ? `Formation loadout ${index + 1}, locked by Command Network`
        : `Activate formation loadout ${index + 1}${active ? ', currently active' : ''}`);
    }
    this.elements.templatePicker.disabled = !formationEditable
      || (formation.cooldownRemaining > 0 && waveState.phase === 'combat');
    if (snapshot.status === 'gameOver') {
      this.elements.formationState.textContent = 'Run ended · formation saved';
    } else if (formation.preview) {
      this.elements.formationState.textContent = formation.preview.valid
        ? `Release to move ship ${formation.preview.slot + 1}`
        : `Invalid: ${formation.preview.reason === 'overlap' ? 'ships need 6 units' : 'outside fleet zone'}`;
    } else if (formation.isTransitioning) {
      this.elements.formationState.textContent = `${formation.movingShips.length} ship${formation.movingShips.length === 1 ? '' : 's'} maneuvering`;
    } else if (waveState.phase === 'deployment') {
      this.elements.formationState.textContent = `${waveState.enemyFormationName} sighted · position fleet`;
    } else if (waveState.phase === 'approach') {
      this.elements.formationState.textContent = 'Fleets closing · weapons held';
    } else if (waveState.phase === 'extraction') {
      this.elements.formationState.textContent = 'Flagship advancing · breakthrough';
    } else if (waveState.phase === 'intermission') {
      this.elements.formationState.textContent = 'Sector crossed · next contact incoming';
    } else if (formation.cooldownRemaining > 0 && waveState.phase === 'combat') {
      this.elements.formationState.textContent = `Loadout link ${formation.cooldownRemaining.toFixed(1)}s`;
    } else if (waveState.canAdvance) {
      this.elements.formationState.textContent = 'Flagship path clear · advance or keep fighting';
    } else {
      this.elements.formationState.textContent = `Drag a ship to edit L${formation.activeLoadoutIndex + 1}`;
    }

    const showIntel = snapshot.status === 'running'
      && ['deployment', 'approach'].includes(waveState.phase);
    this.elements.waveIntel.hidden = !showIntel;
    if (showIntel) {
      this.elements.enemyFormationName.textContent = waveState.enemyFormationName ?? 'Unknown';
      this.elements.wavePhaseLabel.textContent = waveState.phase === 'deployment'
        ? 'Position your fleet'
        : 'Fleets advancing';
    }

    if (waveState.canReady) {
      this.waveActionMode = 'ready';
      this.elements.waveAction.dataset.mode = 'ready';
      this.elements.waveAction.hidden = false;
      this.elements.waveActionKicker.textContent = `${waveState.enemyFormationName} detected`;
      this.elements.waveActionLabel.textContent = 'Ready';
      this.elements.waveActionHint.textContent = 'Press when your fleet is positioned.';
      this.elements.waveActionButton.setAttribute('aria-label', 'Ready formation and advance both fleets');
    } else if (waveState.canAdvance) {
      this.waveActionMode = 'advance';
      this.elements.waveAction.dataset.mode = 'advance';
      this.elements.waveAction.hidden = false;
      this.elements.waveActionKicker.textContent = 'Flagship path clear';
      this.elements.waveActionLabel.textContent = `Advance to wave ${snapshot.wave + 1}`;
      this.elements.waveActionHint.textContent = waveState.remainingEnemies > 0
        ? `${waveState.remainingEnemies} contact${waveState.remainingEnemies === 1 ? '' : 's'} remain · keep fighting for salvage`
        : 'All contacts destroyed · secure the breakthrough';
      this.elements.waveActionButton.setAttribute('aria-label', `Advance flagship and complete wave ${snapshot.wave}`);
    } else {
      this.waveActionMode = null;
      this.elements.waveAction.hidden = true;
    }

    const edgeStacks = snapshot.tacticalEdge.stacks;
    this.elements.tacticalEdgeNodes.forEach((node, index) => node.classList.toggle('is-active', index < edgeStacks));
    this.elements.tacticalEdge.setAttribute('aria-label', `Tactical Edge ${edgeStacks} of ${snapshot.tacticalEdge.maximumStacks}`);

    this.lastSnapshot = snapshot;
    if (!this.elements.shopOverlay.hidden) this.renderUpgrades(snapshot);
    const boss = snapshot.enemies.find((enemy) => enemy.boss);
    this.elements.bossStatus.hidden = !boss || ['deployment', 'approach'].includes(waveState.phase);
    if (boss) {
      const healthRatio = Math.max(0, Math.min(1, boss.health / boss.maxHealth));
      const healthPercent = Math.round(healthRatio * 100);
      const exposed = boss.exposedRemaining > 0;
      this.elements.bossName.textContent = 'Rift bastion';
      this.elements.bossHealthValue.textContent = `${healthPercent}%`;
      this.elements.bossHealthValue.setAttribute('aria-label', `Boss hull ${healthPercent} percent`);
      this.elements.bossHealthFill.style.transform = `scaleX(${healthRatio})`;
      this.elements.bossStatus.classList.toggle('is-exposed', exposed);
      this.elements.bossBarrierState.textContent = exposed
        ? `Hull exposed · ${boss.exposedRemaining.toFixed(1)}s remaining`
        : 'Barrier active · Hold flagship gun on target';
    }
  }

  handleEvents(events) {
    for (const event of events) {
      if (event.type === 'runStarted') {
        this.setRunningState();
        this.beginOnboarding();
      } else if (event.type === 'waveStarted') {
        this.showMessage(`Wave ${event.wave} // ${event.formationName} formation revealed`, 1.8);
      } else if (event.type === 'fleetsAdvancing') {
        this.showMessage('Formation committed // fleets advancing', 1.4);
        this.advanceOnboarding('ready');
      } else if (event.type === 'fleetsEngaged') {
        this.showMessage('Contact range // weapons free', 1.4);
      } else if (event.type === 'flagshipPathCleared') {
        this.showMessage('Flagship path clear // advance or keep fighting', 1.8);
        this.advanceOnboarding('path');
      } else if (event.type === 'flagshipAdvanceStarted') {
        this.showMessage('Flagship advancing // breakthrough', 1.5);
        this.finishOnboarding();
      } else if (event.type === 'waveCleared') {
        this.showMessage(`Breakthrough secured // +${event.reward} salvage`, 1.6);
      } else if (event.type === 'formationShipMoved') {
        this.showMessage('Formation saved // maneuvering', 1.1);
        this.advanceOnboarding('formation');
      } else if (event.type === 'loadoutActivated') {
        this.showMessage(`Loadout ${event.loadoutIndex + 1} // fleet maneuvering`, 1.2);
      } else if (event.type === 'formationChanged') {
        this.showMessage(`${event.formation.name} template // saved`, 1.15);
      } else if (event.type === 'formationPlacementRejected') {
        this.showMessage('Invalid slot // maintain spacing and boundary', 1.1);
      } else if (event.type === 'telegraphStarted') {
        this.showMessage(`${event.kind === 'blast' ? 'Blast circle' : event.kind === 'lane' ? 'Strafing lane' : 'Focused line'} // maneuver`, 1.05);
      } else if (event.type === 'telegraphEvaded') {
        this.showMessage('Attack evaded // Tactical Edge +1', 1.2);
      } else if (event.type === 'tacticalEdgeConsumed') {
        this.showMessage(`Tactical Edge ×${event.stacks} // burst amplified`, 1.25);
        this.finishOnboarding();
      } else if (event.type === 'flagshipGunStarted') {
        this.advanceOnboarding('flagship');
      } else if (event.type === 'upgradePurchased') {
        this.showMessage(`${event.upgrade.name} // level ${event.level}`, 1.1);
      } else if (event.type === 'shopOpened') {
        this.elements.shopOverlay.hidden = false;
        if (this.lastSnapshot) this.renderUpgrades(this.lastSnapshot, true);
      } else if (event.type === 'shopClosed') {
        this.elements.shopOverlay.hidden = true;
      } else if (event.type === 'bossWaveStarted') {
        this.showMessage(`${event.name} // combined warnings incoming`, 2.2);
      } else if (event.type === 'bossExposed') {
        this.showMessage('Barrier collapsed // focus fire', 1.4);
      } else if (event.type === 'bossBarrierRestored') {
        this.showMessage('Barrier restored // flagship recharging', 1.2);
      } else if (event.type === 'flagshipGunReady') {
        this.showMessage('Flagship gun // ready', 1.1);
      } else if (event.type === 'gameOver') {
        this.showGameOver(event);
      }
    }
  }

  tick(deltaSeconds) {
    if (this.messageTimer <= 0) return;
    this.messageTimer -= deltaSeconds;
    if (this.messageTimer <= 0) this.elements.message.classList.remove('is-visible');
  }

  showMessage(text, duration = 1.4) {
    this.elements.message.textContent = text;
    this.elements.message.classList.add('is-visible');
    this.messageTimer = duration;
  }

  showGameOver(event) {
    const { progression, wave } = event;
    this.elements.runSummary.textContent = `Your fleet reached wave ${wave}, destroyed ${progression.destroyedEnemies} contacts, and recovered ${progression.runSalvage} salvage.`;
    window.clearTimeout(this.coachTimer);
    this.elements.coachmark.hidden = true;
    this.elements.gameoverOverlay.hidden = false;
    requestAnimationFrame(() => this.elements.gameoverOverlay.classList.add('overlay--visible'));
  }

  renderUpgrades(snapshot, force = false) {
    const signature = `${snapshot.progression.currency}:${snapshot.progression.upgrades.map(({ level }) => level).join(',')}`;
    if (!force && signature === this.lastUpgradeSignature) return;
    this.lastUpgradeSignature = signature;
    this.elements.shopCurrency.textContent = snapshot.progression.currency.toLocaleString();
    this.elements.upgradeList.replaceChildren();
    for (const upgrade of snapshot.progression.upgrades) {
      const card = document.createElement('article');
      card.className = 'upgrade-card';
      const affordable = upgrade.cost !== null && snapshot.progression.currency >= upgrade.cost;
      card.innerHTML = `<span class="upgrade-card__icon" aria-hidden="true">${upgrade.icon}</span><div><h3>${upgrade.name}<span class="upgrade-card__level">LV ${upgrade.level}/${upgrade.maxLevel}</span></h3><p><span class="upgrade-card__current-effect">${upgrade.currentEffect}</span><span class="upgrade-card__next-effect">${upgrade.nextEffect}</span></p></div>`;
      const button = document.createElement('button');
      button.className = 'upgrade-buy';
      button.type = 'button';
      button.disabled = !affordable;
      button.textContent = upgrade.cost === null ? 'MAX' : `${upgrade.cost.toLocaleString()} ◇`;
      button.setAttribute('aria-label', upgrade.cost === null ? `${upgrade.name} is at maximum level` : `Upgrade ${upgrade.name} for ${upgrade.cost} salvage`);
      button.addEventListener('click', () => {
        const result = this.onUpgrade(upgrade.id);
        if (result?.snapshot) this.renderUpgrades(result.snapshot, true);
      });
      card.appendChild(button);
      this.elements.upgradeList.appendChild(card);
    }
  }

  showOfflineSummary(summary) {
    if (!summary || summary.earned <= 0) return;
    const hours = summary.creditedSeconds / 3600;
    this.elements.offlineEarned.textContent = `+${summary.earned.toLocaleString()} salvage`;
    this.elements.offlineDetail.textContent = `${hours < 1 ? Math.max(1, Math.round(hours * 60)) + ' minutes' : hours.toFixed(1) + ' hours'} credited${summary.capped ? ' (offline cap reached)' : ''}. Active command remains the fastest path to progression.`;
    this.elements.offlineOverlay.hidden = false;
    this.elements.offlineCloseButton.addEventListener('click', () => { this.elements.offlineOverlay.hidden = true; }, { once: true });
  }

  beginOnboarding() {
    if (this.onboardingComplete) return;
    this.onboardingStage = 1;
    this.elements.coachmarkTitle.textContent = 'Read, then deploy';
    this.elements.coachmarkDetail.textContent = 'Study the revealed enemy formation, position your ships, then press Ready at center screen.';
    this.elements.coachmark.hidden = false;
  }

  advanceOnboarding(action) {
    if (this.onboardingComplete) return;
    if (action === 'ready' && this.onboardingStage <= 1) {
      this.onboardingStage = 2;
      this.elements.coachmarkTitle.textContent = 'Fight the contact';
      this.elements.coachmarkDetail.textContent = 'Weapons activate when both fleets stop. Drag ships clear of warnings and aim the flagship gun.';
    } else if (action === 'path' && this.onboardingStage >= 2) {
      this.onboardingStage = 3;
      this.elements.coachmarkTitle.textContent = 'Choose the payout';
      this.elements.coachmarkDetail.textContent = 'Advance now to win the wave, or leave the lane open and destroy more contacts for salvage.';
    }
  }

  finishOnboarding() {
    if (this.onboardingComplete) return;
    this.onboardingComplete = true;
    window.clearTimeout(this.coachTimer);
    this.elements.coachmark.hidden = true;
    this.onOnboardingComplete();
  }
}
