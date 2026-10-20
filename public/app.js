const $ = (s) => document.querySelector(s);
const symbols = { Views: '◉', Likes: '✦', Profile: '◎', Shares: '↗' };
let services = [];
let activeService = null;
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

async function loadServices() {
  try {
    const response = await fetch('/api/services');
    if (!response.ok) throw new Error('Could not load services.');
    const data = await response.json(); services = data.services; renderServices();
  } catch {
    $('#serviceGrid').innerHTML = '<div class="loading-card">Services are temporarily unavailable. Start the backend and refresh this page.</div>';
  }
}
function renderServices(filter = 'All') {
  const visible = services.filter(s => filter === 'All' || s.category === filter);
  $('#serviceGrid').innerHTML = visible.map(s => `<article class="service-card"><div class="service-symbol">${symbols[s.category] || '✦'}</div><div class="service-category">${escapeHtml(s.category)} CAMPAIGN</div><h3>${escapeHtml(s.name)}</h3><p>${escapeHtml(s.description)}</p><div class="package-list">${s.packages.map(p => `<div class="package-choice"><span>${escapeHtml(p.label)}</span><b>${money(p.price)}</b></div>`).join('')}</div><button class="button primary" data-service="${escapeHtml(s.id)}">View packages <span>→</span></button></article>`).join('');
  document.querySelectorAll('[data-service]').forEach(btn => btn.addEventListener('click', () => openOrder(btn.dataset.service)));
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function openOrder(id) {
  activeService = services.find(s => s.id === id); if (!activeService) return;
  $('#modalService').textContent = activeService.description;
  $('#packageSelect').innerHTML = activeService.packages.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)} — ${money(p.price)}</option>`).join('');
  $('#orderTotal').textContent = money(activeService.packages[0].price) + ' USD';
  $('#orderMessage').textContent = ''; $('#orderModal').hidden = false; document.body.style.overflow = 'hidden';
}
function closeOrder() { $('#orderModal').hidden = true; document.body.style.overflow = ''; }
$('#closeModal').addEventListener('click', closeOrder);
$('#orderModal').addEventListener('click', e => { if (e.target === $('#orderModal')) closeOrder(); });
$('#packageSelect').addEventListener('change', () => { const p = activeService?.packages.find(p => p.id === $('#packageSelect').value); if (p) $('#orderTotal').textContent = money(p.price) + ' USD'; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOrder(); });
$('#filters').addEventListener('click', e => { const button = e.target.closest('[data-filter]'); if (!button) return; document.querySelectorAll('.filter').forEach(b => b.classList.toggle('active', b === button)); renderServices(button.dataset.filter); });
$('#menuBtn').addEventListener('click', () => $('.topbar').classList.toggle('menu-open'));
document.querySelectorAll('.topbar nav a').forEach(a => a.addEventListener('click', () => $('.topbar').classList.remove('menu-open')));
$('#year').textContent = new Date().getFullYear();

$('#orderForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!activeService) return;
  const button = $('#submitOrder'); button.disabled = true; button.textContent = 'Saving order…'; $('#orderMessage').textContent = '';
  const payload = { serviceId: activeService.id, packageId: $('#packageSelect').value, targetUrl: $('#targetUrl').value.trim(), email: $('#email').value.trim(), policyAccepted: $('#policyAccepted').checked };
  try {
    const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to save order.');
    sessionStorage.setItem('chb-tracking-' + data.order.id, data.trackingToken);
    $('#orderMessage').innerHTML = `<strong>Order reference created.</strong><br>Reference: <code>${escapeHtml(data.order.id)}</code><br>Keep your private tracking token safe. Payment setup requires the server's PayPal credentials and database. <button class="button primary" id="goPay" type="button">Continue to PayPal →</button>`;
    $('#goPay').addEventListener('click', async () => {
      const go = $('#goPay'); go.disabled = true; go.textContent = 'Opening checkout…';
      try {
        const payRes = await fetch('/api/paypal/create-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: data.order.id, trackingToken: data.trackingToken }) });
        const payData = await payRes.json(); if (!payRes.ok || !payData.approveUrl) throw new Error(payData.error || 'PayPal checkout unavailable.');
        window.location.href = payData.approveUrl;
      } catch (err) { $('#orderMessage').insertAdjacentHTML('beforeend', `<p>${escapeHtml(err.message)}</p>`); go.disabled = false; go.textContent = 'Retry PayPal checkout'; }
    });
  } catch (error) { $('#orderMessage').textContent = error.message; }
  finally { button.disabled = false; button.textContent = 'Continue to order review →'; }
});

$('#trackBtn').addEventListener('click', async () => {
  const id = $('#trackId').value.trim(); const token = $('#trackToken').value.trim() || sessionStorage.getItem('chb-tracking-' + id) || '';
  const out = $('#trackResult'); out.textContent = 'Checking…';
  if (!id || !token) { out.textContent = 'Enter your order ID and private tracking token.'; return; }
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(id)}/status?token=${encodeURIComponent(token)}`); const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not find that order.');
    const o = data.order; out.textContent = `${o.service_name} · ${o.package_label} · ${money(Number(o.amount))} · Status: ${o.status.replaceAll('_', ' ')}.`;
  } catch (error) { out.textContent = error.message; }
});

const params = new URLSearchParams(location.search);
if (params.get('payment') === 'return') {
  const orderId = params.get('order'); const token = params.get('tracking') || sessionStorage.getItem('chb-tracking-' + orderId) || '';
  const paypalOrderId = params.get('token');
  if (orderId && token && paypalOrderId) fetch('/api/paypal/capture-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, trackingToken: token, paypalOrderId }) }).then(r => r.json()).then(d => { history.replaceState({}, '', '/'); alert(d.message || d.error || 'Payment response received.'); }).catch(() => alert('Could not verify payment automatically. Use your tracking link and contact support if you were charged.'));
} else if (params.get('payment') === 'cancel') { alert('PayPal checkout was cancelled. Your order remains unpaid.'); history.replaceState({}, '', '/'); }
loadServices();
