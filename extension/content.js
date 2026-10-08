(() => {
  if (globalThis.F4FBridge) return;
  let runId = null;
  let running = false;
  let assisting = false;
  let claimed = false;
  let username = null;
  let waitStarted = Date.now();
  let lastReason = '';
  let clickedProfileFrom = null;
  let resultBox = null;
  let bannerTimer;
  const send = message => chrome.runtime.sendMessage({ ...message, runId });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ready = name => name && F4FSelectors.usernameFromHref(location.href) === name &&
    ['following', 'followers'].every(type =>
      Array.from(document.querySelectorAll('a')).some(link => link.getAttribute('href') === `/${name}/${type}/`));
  function warning(kind, message) {
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
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = ':host{font:13px/1.5 system-ui,sans-serif;color:#121212}.banner{padding:12px 16px;background:#fff;border:1px solid #eaddeb;border-top:3px solid #C13584;border-radius:14px;box-shadow:0 6px 28px #12121224;display:flex;gap:12px}.ring{flex:none;width:18px;height:18px;margin-top:3px;border:2px solid #eaddeb;border-top-color:#833AB4;border-radius:50%;animation:spin 1s linear infinite}strong{display:block;font-size:13px;color:#833AB4;margin-bottom:3px}p{margin:0} .error strong{color:#b42318}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.ring{animation:none}}';
    const panel = document.createElement('div');
    panel.className = `banner ${kind}`;
    panel.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const indicator = document.createElement('span');
    indicator.className = kind === 'running' ? 'ring' : '';
    indicator.textContent = kind === 'success' ? '✓' : kind === 'error' ? '!' : '';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = kind === 'running' ? '⚠️ PLEASE DO NOT SWITCH TABS' :
      kind === 'success' ? '✓ Checking Complete' : 'Checking stopped';
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
    box.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999999;background:#fff;color:#121212;padding:28px;max-height:75vh;overflow-y:auto;font:15px/1.6 system-ui,sans-serif;box-shadow:0 18px 70px #12121240;user-select:text;border-radius:20px;width:min(440px,calc(100vw - 32px));box-sizing:border-box;border:1px solid #eaddeb;border-top:4px solid #C13584;';
    const title = box.querySelector('h3');
    title.style.cssText = 'margin:0 32px 8px 0;font-size:20px;line-height:1.3;color:#121212;';
    const summary = box.querySelector('div');
    summary.style.cssText = 'margin-bottom:18px;color:#5b5360;font-size:13px;';
    const list = box.querySelector('ul');
    list.style.cssText = 'list-style:none;padding:0;margin:0;color:#121212;';
    for (const item of list.children) {
      item.style.cssText = 'margin:0;border-top:1px solid #eee8ef;';
      item.firstElementChild.style.cssText = 'display:block;padding:10px 4px;color:#833AB4;text-decoration:none;overflow-wrap:anywhere;';
    }
    const close = box.querySelector('#closeF4FBox');
    close.setAttribute('aria-label', 'Close results');
    close.style.cssText = 'position:absolute;top:16px;right:16px;border:0;background:#F5F5F5;color:#121212;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:16px;';
    if (!document.getElementById('f4f-result-style')) {
      const style = document.createElement('style');
      style.id = 'f4f-result-style';
      style.textContent = '[data-f4f-results] a:hover{background:#faf5fc}[data-f4f-results]:focus-visible,[data-f4f-results] :focus-visible{outline:3px solid #833AB4;outline-offset:2px}';
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
          if (ready(name)) {
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
              message: onOwnProfile ? 'Instagram did not expose the follower and following links. Return to your profile and retry.' :
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
    warning, decorate, output,
    async finish(box) {
      decorate(box);
      const response = await send({ type: 'F4F_FINISHED', results: output(box) });
      running = false;
      if (response.status !== 'completed') {
        warning('error', response.message || response.error || 'Results could not be saved. The original list remains available.');
        return;
      }
      warning('success', 'Your results are ready. Open F4F Checker to view them again.');
    },
    async fail(error) {
      running = false;
      warning('error', error.message);
      await send({ type: 'F4F_FAILED', message: error.message }).catch(() => {});
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
        username = null; clickedProfileFrom = null;
        resultBox?.remove(); resultBox = null;
      }
      username = message.username || username;
      reply({ ok: true });
      void assist();
    } else if (message.type === 'F4F_CLAIM') {
      const ok = message.runId === runId && !claimed && !running && ready(username);
      if (ok) { claimed = true; running = true; warning('running'); }
      reply({ ok });
    } else if (message.type === 'F4F_ERROR' && message.runId === runId) {
      running = false; claimed = true;
      warning('error', message.message); reply({ ok: true });
    } else if (message.type === 'F4F_SHOW_RESULTS') {
      showResults(message.results); reply({ ok: true });
    }
  });
  chrome.runtime.sendMessage({ type: 'F4F_PAGE_LOADED' }).catch(() => {});
})();
