export class HudController {
  constructor({
    onStart,
    onRestart,
    onFormation,
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
      flagshipHullValue: document.querySelector('#flagship-hull-value'),
      flagshipShieldFill: document.querySelector('#flagship-shield-fill'),
      flagshipShieldValue: document.querySelector('#flagship-shield-value'),
      message: document.querySelector('#message-banner'),
      startOverlay: document.querySelector('#start-overlay'),
      startButton: document.querySelector('#start-button'),
      gameoverOverlay: document.querySelector('#gameover-overlay'),
      restartButton: document.querySelector('#restart-button'),
      runSummary: document.querySelector('#run-summary'),
      formationOptions: [...document.querySelectorAll('[data-formation]')],
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
    this.elements.shopButton.addEventListener('click', onShopOpen);
    this.elements.startShopButton.addEventListener('click', onShopOpen);
    this.elements.gameoverShopButton.addEventListener('click', onShopOpen);
    this.elements.shopCloseButton.addEventListener('click', onShopClose);
    for (const option of this.elements.formationOptions) {
      option.addEventListener('click', () => onFormation(option.dataset.formation));
    }
    this.onUpgrade = onUpgrade;
    this.lastUpgradeSignature = '';
    this.onboardingComplete = onboardingComplete;
    this.onOnboardingComplete = onOnboardingComplete;
    this.coachTimer = 0;
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
    this.elements.shopButton.setAttribute(
      'aria-label',
      `Open fleet upgrades. ${snapshot.progression.salvage.toLocaleString()} salvage available`,
    );
    this.elements.shopCurrency.textContent = snapshot.progression.currency.toLocaleString();
    const hullPercent = Math.round((snapshot.commandHealth / Math.max(1, snapshot.commandMaxHealth)) * 100);
    const shieldPercent = snapshot.commandMaxShield > 0
      ? Math.round((snapshot.commandShield / snapshot.commandMaxShield) * 100)
      : 0;
    this.elements.flagshipVitals.hidden = !['running', 'paused'].includes(snapshot.status)
      || !flagshipScreenPosition;
    if (flagshipScreenPosition) {
      this.elements.flagshipVitals.style.left = `${flagshipScreenPosition.x}px`;
      this.elements.flagshipVitals.style.top = `${flagshipScreenPosition.y}px`;
    }
    this.elements.flagshipHullFill.style.transform = `scaleX(${Math.max(0, hullPercent) / 100})`;
    this.elements.flagshipShieldFill.style.transform = `scaleX(${Math.max(0, shieldPercent) / 100})`;
    this.elements.flagshipHullValue.textContent = `${hullPercent}%`;
    this.elements.flagshipShieldValue.textContent = `${shieldPercent}%`;
    this.elements.flagshipVitals.setAttribute(
      'aria-label',
      `Flagship hull ${hullPercent} percent, shield ${shieldPercent} percent`,
    );
    for (const option of this.elements.formationOptions) {
      option.setAttribute('aria-pressed', String(option.dataset.formation === snapshot.formation.currentId));
      option.disabled = snapshot.status === 'gameOver'
        || (snapshot.formation.cooldownRemaining > 0 && snapshot.status !== 'ready');
    }
    this.lastSnapshot = snapshot;
    if (!this.elements.shopOverlay.hidden) this.renderUpgrades(snapshot);

    const boss = snapshot.enemies.find((enemy) => enemy.boss);
    this.elements.bossStatus.hidden = !boss;
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
        this.showMessage(`Wave ${event.wave} // ${event.enemyCount} contacts`, 1.3);
      } else if (event.type === 'waveCleared') {
        this.showMessage(`Sector clear // +${event.reward} salvage`, 1.6);
      } else if (event.type === 'flagshipGunStarted') {
        this.finishOnboarding();
      } else if (event.type === 'formationChanged') {
        this.showMessage(`${event.formation.name} // ${event.formation.mechanic}`, 1.25);
      } else if (event.type === 'upgradePurchased') {
        this.showMessage(`${event.upgrade.name} // level ${event.level}`, 1.1);
      } else if (event.type === 'shopOpened') {
        this.elements.shopOverlay.hidden = false;
        if (this.lastSnapshot) this.renderUpgrades(this.lastSnapshot, true);
      } else if (event.type === 'shopClosed') {
        this.elements.shopOverlay.hidden = true;
      } else if (event.type === 'bossWaveStarted') {
        this.showMessage(`${event.name} // flagship gun required`, 2.2);
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
    this.elements.runSummary.textContent =
      `Your fleet reached wave ${wave}, destroyed ${progression.destroyedEnemies} contacts, and recovered ${progression.runSalvage} salvage.`;
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
      card.innerHTML = `
        <span class="upgrade-card__icon" aria-hidden="true">${upgrade.icon}</span>
        <div>
          <h3>${upgrade.name}<span class="upgrade-card__level">LV ${upgrade.level}/${upgrade.maxLevel}</span></h3>
          <p><span class="upgrade-card__current-effect">${upgrade.currentEffect}</span><span class="upgrade-card__next-effect">${upgrade.nextEffect}</span></p>
        </div>
      `;
      const button = document.createElement('button');
      button.className = 'upgrade-buy';
      button.type = 'button';
      button.disabled = !affordable;
      button.textContent = upgrade.cost === null ? 'MAX' : `${upgrade.cost.toLocaleString()} ◇`;
      button.setAttribute('aria-label', upgrade.cost === null
        ? `${upgrade.name} is at maximum level`
        : `Upgrade ${upgrade.name} for ${upgrade.cost} salvage`);
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
    this.elements.offlineDetail.textContent =
      `${hours < 1 ? Math.max(1, Math.round(hours * 60)) + ' minutes' : hours.toFixed(1) + ' hours'} credited${summary.capped ? ' (offline cap reached)' : ''}. Active command remains the fastest path to progression.`;
    this.elements.offlineOverlay.hidden = false;
    this.elements.offlineCloseButton.addEventListener('click', () => {
      this.elements.offlineOverlay.hidden = true;
    }, { once: true });
  }

  beginOnboarding() {
    if (this.onboardingComplete) return;
    window.clearTimeout(this.coachTimer);
    this.elements.coachmarkTitle.textContent = 'Auto-fire online';
    this.elements.coachmarkDetail.textContent = 'Escorts engage automatically. The flagship gun remains under your command.';
    this.elements.coachmark.hidden = false;
    this.coachTimer = window.setTimeout(() => {
      if (this.onboardingComplete) return;
      this.elements.coachmarkTitle.textContent = 'Your command matters';
      this.elements.coachmarkDetail.textContent = 'Hold and drag to build stronger pulses and a rising critical chance.';
    }, 2800);
  }

  finishOnboarding() {
    if (this.onboardingComplete) return;
    this.onboardingComplete = true;
    window.clearTimeout(this.coachTimer);
    this.elements.coachmark.hidden = true;
    this.onOnboardingComplete();
  }
}
