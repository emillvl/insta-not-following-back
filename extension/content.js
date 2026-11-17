(() => {
  if (globalThis.F4FBridge) return;
  let runId = null;
  let running = false;
  let assisting = false;
  let claimed = false;
  let deadline;
  let rateStatus;
  let cooldownTimer;
  let interruptWait;
  let username = null;
  let waitStarted = Date.now();
  let lastReason = '';
  let clickedProfileFrom = null;
  let resultBox = null;
  let bannerTimer;
  const send = message => chrome.runtime.sendMessage({ ...message, runId });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ready = (name, owner) => name && name === owner && F4FSelectors.usernameFromHref(location.href) === name &&
    ['following', 'followers'].every(type => F4FListControls.find(document, name, type));
  function warning(kind, message, reason) {
    clearTimeout(bannerTimer);
    let host = document.getElementById('f4f-warning');
    if (!host) {
      host = document.createElement('f4f-warning');
      host.id = 'f4f-warning';
      host.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;width:min(540px,calc(100vw - 24px));';
      warning.root = host.attachShadow({ mode: 'closed' });
      document.body.appendChild(host);
    }
    const root = warning.root;
    F4FTheme.attach(host);
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = F4FTheme.css(':host') + `
      :host{font:13px/1.5 system-ui,sans-serif;color:var(--f4f-text)}
      .banner{padding:12px 16px;background:var(--f4f-bg);border:1px solid var(--f4f-border);border-top:3px solid #C13584;border-radius:14px;box-shadow:0 6px 28px var(--f4f-banner-shadow);display:flex;gap:12px}
      .signal{display:grid;place-items:center;flex:none;width:24px;height:24px;border-radius:8px;background:var(--f4f-tint);color:var(--f4f-accent);font-weight:700}
      .ring{box-sizing:border-box;border:2px solid var(--f4f-ring);border-top-color:var(--f4f-accent);border-radius:50%;animation:spin 1s linear infinite}
      strong{display:block;font-size:13px;color:var(--f4f-accent);margin-bottom:3px}
      p{margin:0;white-space:pre-line;overflow-wrap:anywhere}
      .error strong{color:var(--f4f-error)}
      .error .signal{background:var(--f4f-error-bg)}
      @keyframes spin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){.ring{animation:none}}`;
    const panel = document.createElement('div');
    panel.className = `banner ${kind}`;
    panel.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const indicator = document.createElement('span');
    const onHold = reason === 'rate_limited' && kind === 'running';
    indicator.className = kind === 'running' && !onHold ? 'signal ring' : 'signal';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.textContent = kind === 'success' ? '✓' : onHold ? '⏳' : kind === 'error' ? '⚠️' : '';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    const incomplete = reason === 'incomplete_scan' || reason === 'unverified_count';
    title.textContent = reason === 'rate_limited' ? 'Instagram rate limit' :
      reason === 'waiting_for_instagram' ? 'Waiting for Instagram' : incomplete ? 'Incomplete scan' :
      kind === 'success' ? 'Check complete' : kind === 'running' ? 'Checking your lists' : 'Checking stopped';
    const text = document.createElement('p');
    text.textContent = message || 'Keep this Instagram tab active until the check finishes.';
    copy.append(title, text);
    panel.append(indicator, copy);
    root.append(style, panel);
    if (kind === 'success') bannerTimer = setTimeout(() => host.remove(), 5000);
  }
  function decorate(box) {
    resultBox = box;
    box.setAttribute('data-f4f-results', '');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'F4F Checker results');
    box.tabIndex = -1;
    box.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999999;background:var(--f4f-bg);color:var(--f4f-text);padding:28px;max-height:75vh;overflow-y:auto;font:15px/1.6 system-ui,sans-serif;box-shadow:0 18px 70px var(--f4f-shadow);user-select:text;border-radius:20px;width:min(440px,calc(100vw - 32px));box-sizing:border-box;border:1px solid var(--f4f-border);border-top:4px solid #C13584;';
    F4FTheme.attach(box);
    const title = box.querySelector('h3');
    title.style.cssText = 'margin:0 32px 8px 0;font-size:20px;line-height:1.3;color:var(--f4f-text);';
    const summary = box.querySelector('div');
    const result = F4FResultCopy({ heading: title.textContent, summary: summary.textContent.trim() });
    title.textContent = result.heading;
    summary.textContent = result.summary;
    summary.style.cssText = 'margin:12px 0 14px;padding:9px 12px;background:var(--f4f-surface);border:1px solid var(--f4f-border);border-radius:10px;color:var(--f4f-muted);font-size:13px;font-variant-numeric:tabular-nums;';
    const list = box.querySelector('ul');
    list.style.cssText = 'list-style:none;padding:0;margin:0;color:var(--f4f-text);';
    if (!list.children.length && !box.querySelector('[data-f4f-empty]')) {
      const empty = document.createElement('p');
      empty.setAttribute('data-f4f-empty', '');
      empty.textContent = 'No missing follow-backs.';
      empty.style.cssText = 'margin:14px 0 0;color:var(--f4f-muted);';
      list.before(empty);
    }
    for (const item of list.children) {
      item.style.cssText = 'margin:0;border-top:1px solid var(--f4f-border);';
      item.firstElementChild.style.cssText = 'display:block;padding:10px 4px;color:var(--f4f-accent);text-decoration:none;overflow-wrap:anywhere;';
    }
    const close = box.querySelector('#closeF4FBox');
    close.setAttribute('aria-label', 'Close results');
    close.style.cssText = 'position:absolute;top:16px;right:16px;border:0;background:var(--f4f-surface);color:var(--f4f-text);width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:16px;';
    if (!document.getElementById('f4f-result-style')) {
      const style = document.createElement('style');
      style.id = 'f4f-result-style';
      style.textContent = F4FTheme.css('[data-f4f-results]') + '[data-f4f-results] a:hover{background:var(--f4f-hover)}[data-f4f-results]:focus-visible,[data-f4f-results] :focus-visible{outline:3px solid var(--f4f-accent);outline-offset:2px}';
      document.head.appendChild(style);
    }
  }
  function output(box) {
    return { heading: box.querySelector('h3').textContent,
      summary: box.querySelector('div').textContent.trim(),
      accounts: Array.from(box.querySelectorAll('li a'), link => ({
        name: link.textContent, href: link.getAttribute('href')
      })) };
  }
  function showResults(results) {
    if (resultBox?.isConnected) { resultBox.focus(); return; }
    const box = document.createElement('div');
    const close = document.createElement('button');
    close.id = 'closeF4FBox';
    close.textContent = '✕';
    close.onclick = () => box.remove();
    const title = document.createElement('h3');
    title.textContent = results.heading;
    const summary = document.createElement('div');
    summary.textContent = results.summary;
    const list = document.createElement('ul');
    for (const account of results.accounts) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.textContent = account.name;
      link.setAttribute('href', account.href);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      item.appendChild(link);
      list.appendChild(item);
    }
    box.append(close, title, summary, list);
    document.body.appendChild(box);
    decorate(box);
    box.focus();
  }
  async function waitStatus(reason, message) {
    if (reason === lastReason) return;
    lastReason = reason;
    await send({ type: 'F4F_WAIT_STATUS', reason, message,
      username: reason === 'profile_navigation' ? username : undefined });
  }
  async function assist() {
    if (assisting || claimed || running) return;
    assisting = true;
    const thisRun = runId;
    try {
      while (runId === thisRun && !claimed) {
        const login = location.pathname.startsWith('/accounts/login') ||
          Boolean(document.querySelector('input[type="password"]'));
        if (login) {
          waitStarted = Date.now();
          await waitStatus('login_required', 'Sign in on Instagram. The check will resume there automatically.');
        } else {
          const ownPage = F4FSelectors.currentOwnProfile(document);
          const profile = F4FSelectors.profileControl(document);
          const name = ownPage || profile?.username || username;
          if (name) username = name;
          if (ready(name, ownPage || profile?.username)) {
            await send({ type: 'F4F_READY' });
            return;
          }
          const onOwnProfile = name && F4FSelectors.usernameFromHref(location.href) === name;
          if (!onOwnProfile && profile && clickedProfileFrom !== location.pathname) {
            clickedProfileFrom = location.pathname;
            await waitStatus('profile_navigation', 'Opening your profile on Instagram…');
            if (runId === thisRun && !claimed) profile.control.click();
          } else {
            await waitStatus(onOwnProfile ? 'page_readiness' : 'waiting_profile', onOwnProfile ?
              'Waiting for your Following and Followers lists to appear…' : 'Open your profile on Instagram to continue.');
          }
          if (Date.now() - waitStarted > 60000) {
            await send({ type: 'F4F_FAILED', reason: 'readiness_error',
              message: onOwnProfile ? "Couldn't find your Following and Followers lists. Refresh Instagram, then choose Retry Checking." :
                'Open your profile on Instagram, then choose Retry Checking in F4F Checker.' });
            return;
          }
        }
        await sleep(500);
      }
    } catch (error) {
      await send({ type: 'F4F_FAILED', message: error.message }).catch(() => {});
    } finally {
      assisting = false;
      if (thisRun !== runId) void assist();
    }
  }
  function showRateStatus(state) {
    if (state?.runId !== runId || !state.rateLimit) return;
    if (rateStatus && (state.rateLimit.attempt < rateStatus.rateLimit.attempt ||
      (rateStatus.retryUsed && !state.retryUsed) ||
      (rateStatus.status === 'error' && state.status !== 'error') ||
      (state.rateLimit.attempt === rateStatus.rateLimit.attempt && state.retryAt < rateStatus.retryAt))) return;
    const notice = (state.reason || state.status === 'error') ? state.message : '';
    const changed = notice !== rateStatus?.notice || state.status !== rateStatus?.status || state.reason !== rateStatus?.reason;
    rateStatus = { status: state.status, retryAt: state.retryAt, retryUsed: state.retryUsed,
      rateLimit: state.rateLimit, reason: state.reason, message: state.message, notice };
    if (state.status === 'error') interruptWait?.();
    clearTimeout(cooldownTimer);
    if (state.reason === 'rate_limited' && state.retryAt) scheduleCooldownEnd();
    if (changed) warning(state.status === 'error' ? 'error' : 'running', notice, state.reason);
  }
  function scheduleCooldownEnd() {
    const remaining = rateStatus.retryAt - Date.now();
    if (remaining > 0) cooldownTimer = setTimeout(scheduleCooldownEnd, Math.min(remaining, 2 ** 31 - 1));
    else void send({ type: 'F4F_COOLDOWN_STATUS' }).then(showRateStatus).catch(() => {});
  }
  globalThis.F4FBridge = {
    get runId() { return runId; },
    get running() { return running; },
    get claimed() { return claimed; },
    get deadline() { return deadline; },
    get rateStatus() { return rateStatus; },
    warning, decorate, output,
    wait(ms) {
      return new Promise(resolve => {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          interruptWait = null;
          resolve();
        }
        interruptWait = done;
      });
    },
    async claimRetry() {
      const state = await send({ type: 'F4F_RETRY' });
      if (!state?.rateLimit) throw new Error('The Instagram check stopped. Use Retry Checking to try again.');
      showRateStatus(state);
    },
    async resetSearchField() {
      return (await send({ type: 'F4F_RESET_SEARCH_FIELD' }))?.ok === true;
    },
    async progress(list, collected, expected) {
      const state = await send({ type: 'F4F_PROGRESS', list, collected, expected }).catch(() => null);
      if (rateStatus && state?.reason !== 'rate_limited') showRateStatus(state);
    },
    async finish(box, validation) {
      decorate(box);
      const response = await send({ type: 'F4F_FINISHED', results: output(box), validation });
      running = false;
      clearTimeout(cooldownTimer);
      if (response.status !== 'completed') {
        if (validation && response.reason !== 'storage_error') { box.remove(); resultBox = null; }
        if (response.rateLimit && response.status === 'error') showRateStatus(response);
        else warning('error', response.message || response.error || 'Results could not be saved. Please retry checking.', response.reason);
        return;
      }
      rateStatus = null;
      warning('success', 'Your results are ready here on Instagram. You can reopen them from F4F Checker.');
    },
    async fail(error) {
      running = false;
      if (rateStatus?.status === 'error') return;
      warning('error', error.message, error.reason);
      await send({ type: 'F4F_FAILED', message: error.message, reason: error.reason }).then(state => {
        if (state?.reason === 'rate_limited') showRateStatus(state);
      }).catch(() => {});
    }
  };
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'F4F_PING') reply({ runId, running });
    else if (message.type === 'F4F_RESET_WAIT') {
      waitStarted = Date.now(); lastReason = ''; clickedProfileFrom = null; reply({ ok: true });
    } else if (message.type === 'F4F_ASSIST') {
      if (runId !== message.runId) {
        if (running) { reply({ ok: false }); return; }
        runId = message.runId; waitStarted = Date.now(); lastReason = ''; claimed = false;
        rateStatus = null;
        clearTimeout(cooldownTimer);
        clearTimeout(bannerTimer);
        document.getElementById('f4f-warning')?.remove();
        username = null; clickedProfileFrom = null;
        resultBox?.remove(); resultBox = null;
      }
      username = message.username || username;
      reply({ ok: true });
      void assist();
    } else if (message.type === 'F4F_CLAIM') {
      const ok = message.runId === runId && !claimed && !running &&
        ready(username, F4FSelectors.currentOwnProfile(document) || F4FSelectors.ownProfile(document));
      if (ok) { claimed = true; running = true; deadline = message.deadline; warning('running'); }
      reply({ ok });
    } else if (message.type === 'F4F_RATE_LIMIT' && message.runId === runId) {
      showRateStatus(message);
      reply({ ok: true });
    } else if (message.type === 'F4F_ERROR' && message.runId === runId) {
      running = false; claimed = true;
      interruptWait?.();
      clearTimeout(cooldownTimer);
      warning('error', message.message, message.reason);
      reply({ ok: true });
    } else if (message.type === 'F4F_SHOW_RESULTS') {
      showResults(message.results); reply({ ok: true });
    }
  });
  chrome.runtime.sendMessage({ type: 'F4F_PAGE_LOADED' }).then(state => {
    if (!runId && state?.status === 'error' && state.rateLimit) {
      runId = state.runId;
      showRateStatus(state);
    }
  }).catch(() => {});
})();
