const $ = (selector) => document.querySelector(selector);
const state = { token: sessionStorage.getItem('chb-access-token') || '', user: null, balance: 0, tasks: [], coinPackages: [], campaigns: [], activeCampaign: null };
const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
const number = (value) => new Intl.NumberFormat('en-US').format(Number(value || 0));
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
function setNotice(message, bad = false) {
  const node = $('#accountNotice');
  if (node) { node.textContent = message; node.classList.toggle('notice-error', bad); }
}
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token && !path.startsWith('/api/auth/')) signOut(false);
    throw new Error(data.error || 'The request could not be completed.');
  }
  return data;
}
function requireSignIn() {
  if (state.user) return true;
  setNotice('Sign in first to use your wallet.', true);
  $('#authMessage').textContent = 'Sign in or create an account to continue.';
  $('#account').scrollIntoView({ behavior: 'smooth', block: 'start' });
  return false;
}
function setAuthMode(mode) {
  const signup = mode === 'register';
  $('#authForm').dataset.mode = signup ? 'register' : 'login';
  $('#displayNameWrap').hidden = !signup;
  $('#displayName').required = signup;
  $('#authPassword').autocomplete = signup ? 'new-password' : 'current-password';
  $('#authModeLabel').textContent = signup ? 'CREATE YOUR ACCOUNT' : 'WELCOME BACK';
  $('#authTitle').textContent = signup ? 'Join Creator Hub Boost' : 'Sign in to Creator Hub Boost';
  $('#authSubmit').textContent = signup ? 'Create account →' : 'Sign in →';
  $('#toggleAuthMode').textContent = signup ? 'Already registered? Sign in' : 'New here? Create an account';
  $('#authMessage').textContent = '';
}
function updateSignedInUI() {
  const signedIn = Boolean(state.user);
  $('#account').classList.toggle('signed-in', signedIn);
  $('#authPanel').hidden = signedIn;
  $('#walletPanel').hidden = !signedIn;
  $('#authNav').textContent = signedIn ? 'My wallet ↓' : 'Sign in ↗';
  if (signedIn) {
    $('#walletName').textContent = state.user.displayName;
    $('#walletEmail').textContent = state.user.email;
    $('#walletBalance').textContent = number(state.balance);
    setNotice('Signed in · Wallet ready');
  } else {
    setNotice('Sign in to access your wallet');
    $('#taskGrid').innerHTML = '<div class="empty-state"><span>🪙</span><h3>Your next coins start here</h3><p>Sign in or create an account to view available tasks and submit work for review.</p><a class="button primary" href="#account">Sign in to earn →</a></div>';
    $('#transactionList').innerHTML = '<p class="muted">Sign in to view wallet activity.</p>';
    $('#orderList').innerHTML = '<p class="muted">Sign in to view campaign orders.</p>';
  }
  renderCampaigns();
}
function signOut(scroll = true) {
  state.token = '';
  state.user = null;
  state.balance = 0;
  state.tasks = [];
  sessionStorage.removeItem('chb-access-token');
  updateSignedInUI();
  if (scroll) $('#account').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadAccount() {
  if (!state.token) { updateSignedInUI(); return; }
  try {
    const data = await api('/api/me');
    state.user = data.user;
    state.balance = Number(data.wallet?.balance || 0);
    updateSignedInUI();
    await Promise.all([loadTasks(), loadTransactions(), loadCampaignOrders()]);
  } catch (error) {
    signOut(false);
    $('#authMessage').textContent = error.message;
  }
}
async function loadCatalogue() {
  try {
    const data = await api('/api/catalogue');
    state.coinPackages = data.coinPackages || [];
    state.campaigns = data.campaigns || [];
    renderCoinPackages();
    renderCampaigns();
  } catch (error) {
    $('#coinGrid').innerHTML = `<div class="loading-card">${escapeHtml(error.message)}</div>`;
    $('#campaignGrid').innerHTML = `<div class="loading-card">${escapeHtml(error.message)}</div>`;
  }
}
async function loadTasks() {
  if (!state.user) return;
  try {
    const data = await api('/api/tasks');
    state.tasks = data.tasks || [];
    renderTasks();
  } catch (error) {
    $('#taskGrid').innerHTML = `<div class="loading-card">${escapeHtml(error.message)}</div>`;
  }
}
async function loadTransactions() {
  if (!state.user) return;
  try {
    const data = await api('/api/wallet/transactions');
    const items = data.transactions || [];
    $('#transactionList').innerHTML = items.length ? items.slice(0, 8).map(item => {
      const credit = item.direction === 'credit';
      return `<div class="transaction-row"><span class="transaction-mark ${credit ? 'credit' : 'debit'}">${credit ? '+' : '−'}</span><div><b>${escapeHtml(item.description)}</b><small>${escapeHtml(new Date(item.createdAt).toLocaleString())}</small></div><strong class="${credit ? 'positive' : 'negative'}">${credit ? '+' : '−'}${number(item.amount)} 🪙</strong></div>`;
    }).join('') : '<p class="muted">No wallet activity yet. Complete tasks or buy a coin package to get started.</p>';
  } catch (error) { $('#transactionList').innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`; }
}
async function loadCampaignOrders() {
  if (!state.user) return;
  try {
    const data = await api('/api/campaign-orders');
    const orders = data.orders || [];
    $('#orderList').innerHTML = orders.length ? orders.map(order => `<article class="order-row"><div><b>${escapeHtml(order.campaignName)}</b><span>${escapeHtml(order.packageLabel)} · ${number(order.coinsCost)} coins</span><small>${escapeHtml(new Date(order.createdAt).toLocaleDateString())}</small></div><span class="status-pill status-${escapeHtml(order.status)}">${escapeHtml(order.status.replaceAll('_', ' '))}</span></article>`).join('') : '<p class="muted">Your campaign orders will appear here.</p>';
  } catch (error) { $('#orderList').innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`; }
}
function renderTasks() {
  const grid = $('#taskGrid');
  if (!state.user) return;
  if (!state.tasks.length) { grid.innerHTML = '<div class="empty-state"><h3>No tasks available</h3><p>Please check back later.</p></div>'; return; }
  grid.innerHTML = state.tasks.map(task => {
    const submission = task.submission;
    const status = submission?.status;
    const submitted = status === 'pending' || status === 'approved';
    return `<article class="task-card">
      <div class="task-top"><span class="task-icon">✦</span><span class="coin-reward">+ ${number(task.rewardCoins)} 🪙</span></div>
      <h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.description)}</p>
      <details><summary>Read task instructions</summary><p>${escapeHtml(task.instructions)}</p></details>
      ${status ? `<div class="task-status status-${escapeHtml(status)}"><b>${escapeHtml(status === 'approved' ? 'Reward approved' : status === 'pending' ? 'Waiting for review' : 'Needs revision')}</b>${submission.reviewNote ? `<p>${escapeHtml(submission.reviewNote)}</p>` : ''}${status === 'pending' ? '<small>Coins are added after approval.</small>' : ''}</div>` : ''}
      ${submitted ? '' : `<form class="task-submit-form" data-task-form="${escapeHtml(task.id)}">
        <label>Public TikTok URL<input name="targetUrl" type="url" required maxlength="500" placeholder="https://www.tiktok.com/@creator/video/..."></label>
        <label>Your feedback<textarea name="responseText" required minlength="20" maxlength="3000" rows="3" placeholder="Write at least 20 characters of useful, specific feedback…"></textarea></label>
        <button class="button primary full-button" type="submit">${status === 'rejected' ? 'Resubmit task →' : 'Submit for review →'}</button><div class="form-message" aria-live="polite"></div>
      </form>`}
    </article>`;
  }).join('');
}
function renderCoinPackages() {
  if (!state.coinPackages.length) return;
  $('#coinGrid').innerHTML = state.coinPackages.map(pack => `<article class="coin-card ${pack.popular ? 'coin-popular' : ''}">
    ${pack.popular ? '<span class="popular-tag">MOST POPULAR</span>' : ''}
    <div class="coin-emblem">🪙</div><p class="coin-plan">${escapeHtml(pack.name)} package</p><div class="coin-amount">${number(pack.coins)} <small>coins</small></div>
    <p class="coin-price">${money(pack.price)} <span>USD</span></p><p class="coin-note">Secure PayPal checkout</p>
    <button class="button ${pack.popular ? 'primary' : 'outline-button'} full-button" data-buy-coins="${escapeHtml(pack.id)}">Get ${number(pack.coins)} coins →</button>
  </article>`).join('');
}
function renderCampaigns() {
  if (!state.campaigns.length) return;
  $('#campaignGrid').innerHTML = state.campaigns.map(campaign => `<article class="campaign-card">
    <div class="campaign-type">${escapeHtml(campaign.category)} CAMPAIGN</div><div class="campaign-symbol">${campaign.category === 'Discovery' ? '◎' : campaign.category === 'Feedback' ? '✦' : 'Aa'}</div>
    <h3>${escapeHtml(campaign.name)}</h3><p>${escapeHtml(campaign.description)}</p>
    <div class="campaign-packages">${campaign.packages.map(pack => `<div class="campaign-package"><div><b>${escapeHtml(pack.label)}</b><small>${escapeHtml(pack.detail)}</small></div><strong>${number(pack.coins)} 🪙</strong><button class="button outline-button" data-campaign="${escapeHtml(campaign.id)}" data-package="${escapeHtml(pack.id)}">Select</button></div>`).join('')}</div>
  </article>`).join('');
}
function openCampaign(campaignId, packageId) {
  if (!requireSignIn()) return;
  const campaign = state.campaigns.find(item => item.id === campaignId);
  const pack = campaign?.packages.find(item => item.id === packageId);
  if (!campaign || !pack) return;
  state.activeCampaign = { campaign, pack };
  $('#campaignModalTitle').textContent = campaign.name;
  $('#campaignModalSubtitle').textContent = `${pack.label} — ${pack.detail}`;
  $('#campaignCost').textContent = `${number(pack.coins)} coins`;
  $('#campaignMessage').textContent = '';
  $('#campaignTargetUrl').value = '';
  $('#campaignPolicyAccepted').checked = false;
  $('#campaignModal').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeCampaign() { $('#campaignModal').hidden = true; document.body.style.overflow = ''; }
async function buyCoins(packageId, button) {
  if (!requireSignIn()) return;
  button.disabled = true;
  const oldText = button.textContent;
  button.textContent = 'Connecting to PayPal…';
  try {
    const data = await api('/api/coins/create-order', { method: 'POST', body: JSON.stringify({ packageId }) });
    sessionStorage.setItem('chb-pending-purchase', data.purchaseId);
    window.location.assign(data.approveUrl);
  } catch (error) {
    setNotice(error.message, true);
    button.disabled = false;
    button.textContent = oldText;
  }
}

$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const signup = form.dataset.mode === 'register';
  const button = $('#authSubmit');
  button.disabled = true;
  button.textContent = signup ? 'Creating account…' : 'Signing in…';
  $('#authMessage').textContent = '';
  const payload = { email: $('#authEmail').value.trim(), password: $('#authPassword').value };
  if (signup) payload.displayName = $('#displayName').value.trim();
  try {
    const data = await api(signup ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
    state.token = data.token;
    state.user = data.user;
    state.balance = Number(data.wallet?.balance || 0);
    sessionStorage.setItem('chb-access-token', state.token);
    $('#authPassword').value = '';
    updateSignedInUI();
    await Promise.all([loadTasks(), loadTransactions(), loadCampaignOrders()]);
    setNotice(signup ? 'Account created. Welcome!' : 'Signed in successfully.');
    await processPaymentReturn();
  } catch (error) {
    $('#authMessage').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = signup ? 'Create account →' : 'Sign in →';
  }
});
$('#toggleAuthMode').addEventListener('click', () => setAuthMode($('#authForm').dataset.mode === 'register' ? 'login' : 'register'));
$('#signOutBtn').addEventListener('click', () => signOut(true));
$('#menuBtn').addEventListener('click', () => $('.topbar').classList.toggle('menu-open'));
document.querySelectorAll('.topbar nav a').forEach(link => link.addEventListener('click', () => $('.topbar').classList.remove('menu-open')));
$('#authNav').addEventListener('click', (event) => {
  event.preventDefault();
  $('#account').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (state.user) $('#walletPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('#taskGrid').addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-task-form]');
  if (!form) return;
  event.preventDefault();
  if (!requireSignIn()) return;
  const button = form.querySelector('button[type="submit"]');
  const message = form.querySelector('.form-message');
  button.disabled = true;
  button.textContent = 'Submitting…';
  message.textContent = '';
  try {
    const data = await api(`/api/tasks/${encodeURIComponent(form.dataset.taskForm)}/submissions`, {
      method: 'POST',
      body: JSON.stringify({ targetUrl: form.elements.targetUrl.value.trim(), responseText: form.elements.responseText.value.trim() })
    });
    message.textContent = data.message;
    await loadTasks();
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
    button.textContent = 'Submit for review →';
  }
});
$('#coinGrid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-buy-coins]');
  if (button) buyCoins(button.dataset.buyCoins, button);
});
$('#campaignGrid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-campaign][data-package]');
  if (button) openCampaign(button.dataset.campaign, button.dataset.package);
});
$('#closeCampaignModal').addEventListener('click', closeCampaign);
$('#campaignModal').addEventListener('click', (event) => { if (event.target === $('#campaignModal')) closeCampaign(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeCampaign(); });
$('#campaignForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.activeCampaign || !requireSignIn()) return;
  const button = $('#submitCampaign');
  button.disabled = true;
  button.textContent = 'Submitting request…';
  $('#campaignMessage').textContent = '';
  try {
    const data = await api('/api/campaign-orders', {
      method: 'POST',
      body: JSON.stringify({
        campaignId: state.activeCampaign.campaign.id,
        packageId: state.activeCampaign.pack.id,
        targetUrl: $('#campaignTargetUrl').value.trim(),
        policyAccepted: $('#campaignPolicyAccepted').checked
      })
    });
    state.balance = Number(data.wallet.balance);
    $('#walletBalance').textContent = number(state.balance);
    $('#campaignMessage').textContent = data.message;
    setNotice(`Campaign submitted · ${number(state.balance)} coins left`);
    await Promise.all([loadTransactions(), loadCampaignOrders()]);
    window.setTimeout(closeCampaign, 1100);
  } catch (error) {
    $('#campaignMessage').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Submit campaign →';
  }
});
async function processPaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('payment');
  if (mode === 'cancel') {
    sessionStorage.removeItem('chb-pending-purchase');
    sessionStorage.removeItem('chb-pending-paypal-order');
    history.replaceState({}, '', '/');
    setNotice('PayPal checkout was cancelled. No coins were added.');
    return;
  }
  if (mode === 'return') {
    const returnedPurchase = params.get('purchase');
    const returnedPayPalOrder = params.get('token');
    if (returnedPurchase) sessionStorage.setItem('chb-pending-purchase', returnedPurchase);
    if (returnedPayPalOrder) sessionStorage.setItem('chb-pending-paypal-order', returnedPayPalOrder);
    history.replaceState({}, '', '/');
  }
  const purchaseId = sessionStorage.getItem('chb-pending-purchase');
  const paypalOrderId = sessionStorage.getItem('chb-pending-paypal-order');
  if (!purchaseId || !paypalOrderId) return;
  if (!state.token || !state.user) {
    setNotice('PayPal returned. Sign in to the same account to verify and credit this purchase.', true);
    return;
  }
  try {
    setNotice('Verifying PayPal payment…');
    const data = await api('/api/coins/capture-order', { method: 'POST', body: JSON.stringify({ purchaseId, paypalOrderId }) });
    sessionStorage.removeItem('chb-pending-purchase');
    sessionStorage.removeItem('chb-pending-paypal-order');
    if (data.balance !== undefined) state.balance = Number(data.balance);
    $('#walletBalance').textContent = number(state.balance);
    setNotice(data.message || 'Payment status updated.');
    await Promise.all([loadTransactions(), loadAccount()]);
  } catch (error) {
    setNotice(error.message, true);
  }
}

$('#year').textContent = new Date().getFullYear();
setAuthMode('login');
async function start() {
  await loadCatalogue();
  if (state.token) await loadAccount();
  else updateSignedInUI();
  await processPaymentReturn();
}
start();
