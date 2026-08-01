const VOLLEY_CIRCUMFERENCE = 2 * Math.PI * 18;

export class HudController {
  constructor({ onStart, onRestart, onPause, onFormation }) {
    this.elements = {
      wave: document.querySelector('#wave-value'),
      health: document.querySelector('#health-value'),
      healthFill: document.querySelector('#health-fill'),
      currency: document.querySelector('#currency-value'),
      volleyPanel: document.querySelector('#volley-panel'),
      volleyRing: document.querySelector('#volley-ring'),
      volleyLabel: document.querySelector('#volley-label'),
      volleySymbol: document.querySelector('#volley-symbol'),
      message: document.querySelector('#message-banner'),
      pauseButton: document.querySelector('#pause-button'),
      startOverlay: document.querySelector('#start-overlay'),
      startButton: document.querySelector('#start-button'),
      gameoverOverlay: document.querySelector('#gameover-overlay'),
      restartButton: document.querySelector('#restart-button'),
      runSummary: document.querySelector('#run-summary'),
      pauseOverlay: document.querySelector('#pause-overlay'),
      formationToggle: document.querySelector('#formation-toggle'),
      formationLabel: document.querySelector('#formation-label'),
      formationMenu: document.querySelector('#formation-menu'),
      formationOptions: [...document.querySelectorAll('[data-formation]')],
    };

    this.messageTimer = 0;
    this.elements.startButton.addEventListener('click', onStart);
    this.elements.restartButton.addEventListener('click', onRestart);
    this.elements.pauseButton.addEventListener('click', onPause);
    this.elements.formationToggle.addEventListener('click', () => this.toggleFormationMenu());
    for (const option of this.elements.formationOptions) {
      option.addEventListener('click', () => {
        const result = onFormation(option.dataset.formation);
        if (result?.changed) this.closeFormationMenu();
      });
    }
    this.setReadyState();
  }

  setReadyState() {
    this.elements.pauseButton.disabled = true;
    this.elements.pauseOverlay.hidden = true;
    this.elements.gameoverOverlay.hidden = true;
    this.elements.gameoverOverlay.classList.remove('overlay--visible');
    this.closeFormationMenu();
  }

  setRunningState() {
    this.elements.startOverlay.classList.remove('overlay--visible');
    this.elements.startOverlay.hidden = true;
    this.elements.pauseButton.disabled = false;
    this.elements.pauseButton.querySelector('span').textContent = 'Ⅱ';
    this.elements.pauseButton.setAttribute('aria-label', 'Pause game');
    this.elements.pauseOverlay.hidden = true;
    this.elements.gameoverOverlay.hidden = true;
    this.elements.gameoverOverlay.classList.remove('overlay--visible');
  }

  update(snapshot) {
    const healthRatio = Math.max(0, snapshot.commandHealth / snapshot.commandMaxHealth);
    const healthPercent = Math.round(healthRatio * 100);
    const charge = Math.max(0, Math.min(1, snapshot.volleyCharge));

    this.elements.wave.textContent = String(Math.max(1, snapshot.wave));
    this.elements.health.textContent = String(healthPercent);
    this.elements.healthFill.style.transform = `scaleX(${healthRatio})`;
    this.elements.healthFill.style.backgroundColor = healthRatio < 0.3 ? 'var(--danger)' : 'var(--cyan)';
    this.elements.currency.textContent = snapshot.progression.salvage.toLocaleString();
    this.elements.volleyRing.style.strokeDashoffset = String(VOLLEY_CIRCUMFERENCE * (1 - charge));
    this.elements.formationLabel.textContent = snapshot.formation.current.name;
    this.elements.formationToggle.setAttribute(
      'aria-label',
      `Choose formation. Current: ${snapshot.formation.current.name}`,
    );
    this.elements.formationToggle.disabled = snapshot.status === 'gameOver';
    for (const option of this.elements.formationOptions) {
      option.setAttribute('aria-pressed', String(option.dataset.formation === snapshot.formation.currentId));
      option.disabled = snapshot.formation.cooldownRemaining > 0 && snapshot.status !== 'ready';
    }

    const ready = charge >= 0.999 && snapshot.status === 'running' && snapshot.waveIntermission <= 0;
    this.elements.volleyPanel.classList.toggle('is-ready', ready);
    this.elements.volleySymbol.textContent = ready ? '◎' : '⌁';
    if (snapshot.status === 'ready') {
      this.elements.volleyLabel.textContent = 'Awaiting deployment';
    } else if (snapshot.status === 'paused') {
      this.elements.volleyLabel.textContent = 'Tactical hold';
    } else if (snapshot.status === 'gameOver') {
      this.elements.volleyLabel.textContent = 'Command unavailable';
    } else if (snapshot.waveIntermission > 0) {
      this.elements.volleyLabel.textContent = 'Fleet regrouping';
    } else if (ready) {
      this.elements.volleyLabel.textContent = 'Ready — tap a threat';
    } else {
      this.elements.volleyLabel.textContent = `Charging — ${snapshot.volleyRemaining.toFixed(1)}s`;
    }
  }

  handleEvents(events) {
    for (const event of events) {
      if (event.type === 'runStarted') {
        this.setRunningState();
      } else if (event.type === 'waveStarted') {
        this.showMessage(`Wave ${event.wave} // ${event.enemyCount} contacts`, 1.3);
      } else if (event.type === 'waveCleared') {
        this.showMessage(`Sector clear // +${event.reward} salvage`, 1.6);
      } else if (event.type === 'volleyFired') {
        this.elements.volleyPanel.classList.add('is-fired');
        window.setTimeout(() => this.elements.volleyPanel.classList.remove('is-fired'), 130);
      } else if (event.type === 'volleyResolved') {
        if (event.preciseHits > 0) {
          this.showMessage(`Precision lock // ${event.preciseHits} critical`, 1.1);
        } else if (event.hits === 0) {
          this.showMessage('Volley missed // solution lost', 0.9);
        }
      } else if (event.type === 'formationChanged') {
        this.showMessage(`${event.formation.name} // ${event.formation.mechanic}`, 1.25);
      } else if (event.type === 'paused') {
        this.setPaused(true);
      } else if (event.type === 'resumed') {
        this.setPaused(false);
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

  setPaused(paused) {
    this.elements.pauseOverlay.hidden = !paused;
    this.elements.pauseButton.querySelector('span').textContent = paused ? '▶' : 'Ⅱ';
    this.elements.pauseButton.setAttribute('aria-label', paused ? 'Resume game' : 'Pause game');
  }

  showGameOver(event) {
    const { progression, wave } = event;
    this.elements.pauseButton.disabled = true;
    this.elements.pauseOverlay.hidden = true;
    this.elements.runSummary.textContent =
      `Your fleet reached wave ${wave}, destroyed ${progression.destroyedEnemies} contacts, and recovered ${progression.salvage} salvage.`;
    this.elements.gameoverOverlay.hidden = false;
    requestAnimationFrame(() => this.elements.gameoverOverlay.classList.add('overlay--visible'));
  }

  toggleFormationMenu() {
    const open = this.elements.formationMenu.hidden;
    this.elements.formationMenu.hidden = !open;
    this.elements.formationToggle.setAttribute('aria-expanded', String(open));
  }

  closeFormationMenu() {
    this.elements.formationMenu.hidden = true;
    this.elements.formationToggle.setAttribute('aria-expanded', 'false');
  }
}
