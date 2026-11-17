const el = id => document.getElementById(id);
const themeStyle = document.createElement('style');
themeStyle.textContent = F4FTheme.css(':root');
document.head.appendChild(themeStyle);
F4FTheme.attach(document.documentElement);
F4FTheme.subscribe(preference => { el('appearance').value = preference; });
el('appearance').addEventListener('change', async event => {
  el('appearance-error').hidden = true;
  try { await F4FTheme.setPreference(event.target.value); }
  catch {
    el('appearance-error').textContent = "Couldn't save your appearance setting. Try again.";
    el('appearance-error').hidden = false;
  }
});
const titles = { idle: 'Ready to check?', navigating: 'Opening Instagram', waiting: 'Getting ready',
  running: 'Checking your lists', completed: 'Check complete', error: 'Checking stopped' };
let operation = { status: 'idle' };
let busy = false;
let cooldownTimer;
function render(next) {
  clearTimeout(cooldownTimer);
  operation = next;
  const status = next.status || 'idle';
  const active = ['navigating', 'waiting', 'running'].includes(status);
  const remaining = next.retryAt - Date.now();
  let { reason, message } = next;
  if (remaining > 0) {
    cooldownTimer = setTimeout(() => {
      render(operation);
      if (Date.now() >= next.retryAt) {
        void chrome.runtime.sendMessage({ type: 'F4F_STATUS' }).then(state => {
          if (operation === next && state?.status) render(state);
        }).catch(() => {});
      }
    }, Math.min(remaining, 2 ** 31 - 1));
  } else if (remaining <= 0 && reason === 'rate_limited') {
    reason = status === 'running' ? 'waiting_for_instagram' : undefined;
    message = reason ? 'The wait is over. Instagram is loading the list.' : 'You can retry now.';
  }
  const needsLogin = status === 'waiting' && reason === 'login_required';
  const onHold = reason === 'rate_limited' && remaining > 0;
  const result = status === 'completed' && next.results ? F4FResultCopy(next.results) : null;
  el('indicator').className = `indicator ${needsLogin || onHold ? 'waiting' : active ? 'running' : status}`;
  el('symbol').textContent = needsLogin ? '🔑' : onHold ? '⏳' : status === 'completed' ? '✓' :
    status === 'error' ? '⚠️' : active ? '•••' : '↗';
  el('title').textContent = needsLogin ?
    'Login required' : reason === 'rate_limited' ? 'Instagram rate limit' :
    reason === 'waiting_for_instagram' ? 'Waiting for Instagram' :
    status === 'error' && ['incomplete_scan', 'unverified_count'].includes(reason) ?
    'Incomplete scan' : titles[status] || titles.idle;
  el('message').hidden = Boolean(result) || status === 'navigating';
  el('message').textContent = status === 'idle' ? "See who doesn't follow you back on Instagram." : message || '';
  el('reminder').hidden = !(status === 'idle' || (active && !needsLogin));
  el('start').hidden = status !== 'idle' && status !== 'error';
  el('start').textContent = status === 'error' ? 'Retry Checking' : 'Start Checking';
  el('view').hidden = status !== 'completed';
  el('again').hidden = status !== 'completed';
  el('continue').hidden = !active;
  el('continue').textContent = needsLogin ? 'Continue After Login' : 'Return to Instagram';
  el('result-summary').hidden = !result;
  el('result-heading').textContent = result?.heading || '';
  el('result-totals').textContent = result?.summary || '';
  document.querySelectorAll('button').forEach(button => {
    button.disabled = busy || (remaining > 0 && ['start', 'again'].includes(button.id));
  });
}
async function action(type, extra = {}) {
  if (busy) return;
  busy = true;
  el('action-error').hidden = true;
  render(operation);
  try {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (response.error) throw new Error(response.error);
    render(response);
    if (response.status !== 'error' && ['F4F_START', 'F4F_CONTINUE', 'F4F_VIEW_RESULTS'].includes(type)) window.close();
  } catch (error) {
    el('action-error').textContent = error.message;
    el('action-error').hidden = false;
  } finally { busy = false; render(operation); }
}
el('start').addEventListener('click', () => action('F4F_START'));
el('again').addEventListener('click', () => action('F4F_START'));
el('view').addEventListener('click', () => action('F4F_VIEW_RESULTS'));
el('continue').addEventListener('click', () => action(operation.status === 'waiting' ? 'F4F_CONTINUE' : 'F4F_START'));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.operation) render(changes.operation.newValue || { status: 'idle' });
});
void action('F4F_STATUS');
