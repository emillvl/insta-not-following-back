(() => {
  if (globalThis.F4FBridge) return;
  let runId = null;
  let running = false;
  let assisting = false;
  let claimed = false;
  let retryAt = 0;
  let cooldownNotice = '';
  let username = null;
  let waitStarted = Date.now();
  let lastReason = '';
  let clickedProfileFrom = null;
  let resultBox = null;
  let bannerTimer;
  let routeReply;
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
    style.textContent = F4FTheme.css(':host') + ':host{font:13px/1.5 system-ui,sans-serif;color:var(--f4f-text)}.banner{padding:12px 16px;background:var(--f4f-bg);border:1px solid var(--f4f-border);border-top:3px solid #C13584;border-radius:14px;box-shadow:0 6px 28px var(--f4f-banner-shadow);display:flex;gap:12px}.ring{flex:none;width:18px;height:18px;margin-top:3px;border:2px solid var(--f4f-ring);border-top-color:var(--f4f-accent);border-radius:50%;animation:spin 1s linear infinite}strong{display:block;font-size:13px;color:var(--f4f-accent);margin-bottom:3px}p{margin:0}.error strong{color:var(--f4f-error)}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.ring{animation:none}}';
    const panel = document.createElement('div');
    panel.className = `banner ${kind}`;
    panel.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const indicator = document.createElement('span');
    indicator.className = kind === 'running' ? 'ring' : '';
    indicator.textContent = kind === 'success' ? '✓' : kind === 'error' ? '!' : '';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    const incomplete = reason === 'incomplete_scan' || reason === 'unverified_count';
    const waiting = reason === 'rate_limited' || reason === 'waiting_for_instagram';
    title.textContent = kind === 'running' ? (waiting ? 'Waiting for Instagram' : 'Checking your Instagram lists') :
      kind === 'success' ? '✓ Checking Complete' : incomplete ? 'Incomplete scan' : 'Checking stopped';
    const text = document.createElement('p');
    text.textContent = message || 'F4F Checker is currently running. Please keep this Instagram tab open and active until the checking process is complete. Switching tabs may interrupt or delay the operation.';
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
    summary.style.cssText = 'margin-bottom:18px;color:var(--f4f-muted);font-size:13px;';
    const list = box.querySelector('ul');
    list.style.cssText = 'list-style:none;padding:0;margin:0;color:var(--f4f-text);';
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
          await waitStatus('login_required', 'Log in to Instagram in this tab. Checking will continue after login.');
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
            await waitStatus('profile_navigation', 'Opening Instagram’s Profile section…');
            profile.control.click();
          } else {
            await waitStatus(onOwnProfile ? 'page_readiness' : 'waiting_profile', onOwnProfile ?
              'Waiting for your follower and following links…' : 'Waiting for Instagram’s Profile control…');
          }
          if (Date.now() - waitStarted > 60000) {
            await send({ type: 'F4F_FAILED', reason: 'readiness_error',
              message: onOwnProfile ? 'The follower and following controls could not be identified on this profile. Reload Instagram and retry.' :
                'Instagram’s Profile control is unavailable. Open your Profile section in Instagram, then retry checking.' });
            return;
          }
        }
        await sleep(500);
      }
    } catch (error) {
      await send({ type: 'F4F_FAILED', message: error.message }).catch(() => {});
    } finally { assisting = false; }
  }
  globalThis.F4FBridge = {
    get runId() { return runId; },
    get running() { return running; },
    get claimed() { return claimed; },
    get retryAt() { return retryAt; },
    warning, decorate, output,
    async recoverList(list, expected, collected, deadline) {
      let timeout;
      const result = new Promise(resolve => {
        routeReply = resolve;
        timeout = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
      });
      try {
        const response = await send({ type: 'F4F_OPEN_LIST_PAGE', list, expected, collected, deadline });
        return response?.ok ? await result : response;
      } finally {
        clearTimeout(timeout);
        routeReply = null;
      }
    },
    async readListPage(request) {
      if (running) return;
      runId = request.runId;
      running = true;
      retryAt = request.retryAt || 0;
      cooldownNotice = retryAt > Date.now() ? request.message : '';
      warning('running', cooldownNotice || `Reading Instagram’s /${request.list}/ page.`,
        cooldownNotice ? 'rate_limited' : undefined);
      let result;
      try { result = { accounts: await F4FCollector.readListPage(request, () => running) }; }
      catch (error) { result = { message: error.message, reason: error.reason }; }
      finally { running = false; }
      await send({ type: 'F4F_LIST_PAGE_DONE', ...result }).catch(() => {});
    },
    async progress(list, collected, expected) {
      const state = await send({ type: 'F4F_PROGRESS', list, collected, expected }).catch(() => null);
      if (!running || !cooldownNotice || state?.status !== 'running' || state.runId !== runId || state.retryAt !== retryAt) return;
      if (state.reason && state.reason !== 'waiting_for_instagram') return;
      const notice = state.reason ? state.message : '';
      if (notice !== cooldownNotice) {
        cooldownNotice = notice;
        warning('running', notice, state.reason);
      }
    },
    async finish(box, validation) {
      decorate(box);
      const response = await send({ type: 'F4F_FINISHED', results: output(box), validation });
      running = false;
      if (response.status !== 'completed') {
        if (validation && response.reason !== 'storage_error') { box.remove(); resultBox = null; }
        warning('error', response.message || response.error || 'Results could not be saved. Please retry checking.', response.reason);
        return;
      }
      warning('success', 'Your results are ready. Open F4F Checker to view them again.');
    },
    async fail(error) {
      running = false;
      warning('error', error.message, error.reason);
      await send({ type: 'F4F_FAILED', message: error.message, reason: error.reason }).catch(() => {});
    }
  };
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'F4F_PING') reply({ runId, running });
    else if (message.type === 'F4F_RESET_WAIT') {
      waitStarted = Date.now(); lastReason = ''; clickedProfileFrom = null; reply({ ok: true });
    } else if (message.type === 'F4F_ASSIST') {
      if (runId !== message.runId) {
        runId = message.runId; waitStarted = Date.now(); lastReason = ''; claimed = false;
        retryAt = 0; cooldownNotice = '';
        username = null; clickedProfileFrom = null;
        resultBox?.remove(); resultBox = null;
      }
      username = message.username || username;
      reply({ ok: true });
      void assist();
    } else if (message.type === 'F4F_CLAIM') {
      const ok = message.runId === runId && !claimed && !running &&
        ready(username, F4FSelectors.currentOwnProfile(document) || F4FSelectors.ownProfile(document));
      if (ok) { claimed = true; running = true; warning('running'); }
      reply({ ok });
    } else if (message.type === 'F4F_RATE_LIMIT' && message.runId === runId && running) {
      if (message.retryAt > retryAt) {
        retryAt = message.retryAt;
        cooldownNotice = message.message;
        warning('running', cooldownNotice, 'rate_limited');
      }
      reply({ ok: true });
    } else if (message.type === 'F4F_LIST_PAGE_RESULT' && message.runId === runId) {
      routeReply?.(message); reply({ ok: true });
    } else if (message.type === 'F4F_ERROR' && message.runId === runId) {
      running = false; claimed = true;
      routeReply?.(message);
      warning('error', message.message, message.reason); reply({ ok: true });
    } else if (message.type === 'F4F_SHOW_RESULTS') {
      showResults(message.results); reply({ ok: true });
    }
  });
  chrome.runtime.sendMessage({ type: 'F4F_PAGE_LOADED' }).catch(() => {});
})();
