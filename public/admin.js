const $ = (selector) => document.querySelector(selector);
let adminToken = sessionStorage.getItem('chb-admin-token') || '';
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
async function adminApi(path, options = {}) {
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${adminToken}` };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) adminSignOut();
    throw new Error(data.error || 'The request could not be completed.');
  }
  return data;
}
function adminSignOut() {
  adminToken = '';
  sessionStorage.removeItem('chb-admin-token');
  $('#adminLoginPanel').hidden = false;
  $('#adminDashboard').hidden = true;
}
async function loadAdminQueues() {
  $('#submissionQueue').innerHTML = '<p class="muted">Loading task submissions…</p>';
  $('#campaignQueue').innerHTML = '<p class="muted">Loading campaign orders…</p>';
  try {
    const [taskData, responseData, campaignData] = await Promise.all([
      adminApi('/api/admin/task-submissions?status=pending'),
      adminApi('/api/admin/campaign-responses?status=pending'),
      adminApi('/api/admin/campaign-orders?status=all')
    ]);
    renderSubmissions(taskData.submissions || []);
    renderCampaignResponses(responseData.responses || []);
    renderCampaignOrders(campaignData.orders || []);
  } catch (error) {
    $('#adminMessage').textContent = error.message;
  }
}
function renderSubmissions(items) {
  if (!items.length) { $('#submissionQueue').innerHTML = '<div class="admin-empty">No task submissions are waiting for review.</div>'; return; }
  $('#submissionQueue').innerHTML = items.map(item => `<article class="admin-record">
    <div class="admin-record-top"><div><span class="admin-record-type">${escapeHtml(item.title)}</span><h3>Reward: ${Number(item.reward_coins).toLocaleString()} coins</h3><p>From ${escapeHtml(item.email)} · ${escapeHtml(new Date(item.submitted_at).toLocaleString())}</p></div><a class="admin-link" href="${escapeHtml(item.target_url)}" target="_blank" rel="noopener noreferrer">Open submitted TikTok ↗</a></div>
    <blockquote>${escapeHtml(item.response_text)}</blockquote>
    <label>Review note (optional)<textarea data-review-note="${escapeHtml(item.id)}" rows="2" maxlength="500" placeholder="Explain the decision or requested improvements…"></textarea></label>
    <div class="admin-record-actions"><button class="button primary" data-review-task="${escapeHtml(item.id)}" data-review-status="approved">Approve & credit coins</button><button class="button danger-button" data-review-task="${escapeHtml(item.id)}" data-review-status="rejected">Reject submission</button></div>
  </article>`).join('');
}
function renderCampaignResponses(items) {
  if (!items.length) { $('#campaignResponseQueue').innerHTML = '<div class="admin-empty">No genuine campaign feedback is waiting for review.</div>'; return; }
  $('#campaignResponseQueue').innerHTML = items.map(item => `<article class="admin-record">
    <div class="admin-record-top"><div><span class="admin-record-type">${escapeHtml(item.campaign_name)} · ${escapeHtml(item.package_label)}</span><h3>Reward: ${Number(item.reward_coins).toLocaleString()} coins</h3><p>${escapeHtml(item.participant_name)} submitted feedback for ${escapeHtml(item.creator_name)} · ${escapeHtml(new Date(item.submitted_at).toLocaleString())}</p></div><a class="admin-link" href="${escapeHtml(item.target_url)}" target="_blank" rel="noopener noreferrer">Open public TikTok ↗</a></div>
    <blockquote>${escapeHtml(item.response_text)}</blockquote>
    <label>Review note (optional)<textarea data-campaign-response-note="${escapeHtml(item.id)}" rows="2" maxlength="500" placeholder="Explain the decision or ask for a more specific review…"></textarea></label>
    <div class="admin-record-actions"><button class="button primary" data-review-campaign-response="${escapeHtml(item.id)}" data-review-status="approved">Approve & credit coins</button><button class="button danger-button" data-review-campaign-response="${escapeHtml(item.id)}" data-review-status="rejected">Reject response</button></div>
  </article>`).join('');
}

function renderCampaignOrders(items) {
  if (!items.length) { $('#campaignQueue').innerHTML = '<div class="admin-empty">No campaign orders have been submitted.</div>'; return; }
  $('#campaignQueue').innerHTML = items.map(order => {
    const terminal = ['completed','cancelled','refunded'].includes(order.status);
    return `<article class="admin-record campaign-record">
      <div class="admin-record-top"><div><span class="admin-record-type">${escapeHtml(order.campaign_name)}</span><h3>${escapeHtml(order.package_label)} · ${Number(order.coins_cost).toLocaleString()} coins</h3><p>${Number(order.approved_responses || 0).toLocaleString()} of ${Number(order.response_count || 0).toLocaleString()} feedback responses approved · ${Number(order.reward_coins_per_response || 0).toLocaleString()} coins per approved response</p><p>${escapeHtml(order.email)} · ${escapeHtml(new Date(order.created_at).toLocaleString())}</p><p class="admin-url">${escapeHtml(order.target_url)}</p></div><span class="status-pill status-${escapeHtml(order.status)}">${escapeHtml(order.status.replaceAll('_',' '))}</span></div>
      ${terminal ? '' : `<div class="admin-record-actions">${order.status === 'queued_for_review' ? `<button class="button primary" data-campaign-status="${escapeHtml(order.id)}" data-status="in_progress">Start review</button>` : ''}<button class="button danger-button" data-campaign-status="${escapeHtml(order.id)}" data-status="cancelled">Cancel & refund coins</button></div>`}
    </article>`;
  }).join('');
}
$('#adminLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#adminLoginButton');
  button.disabled = true;
  $('#adminLoginMessage').textContent = '';
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#adminEmail').value.trim(), password: $('#adminPassword').value })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Administrator sign-in failed.');
    adminToken = data.token;
    sessionStorage.setItem('chb-admin-token', adminToken);
    $('#adminPassword').value = '';
    $('#adminLoginPanel').hidden = true;
    $('#adminDashboard').hidden = false;
    await loadAdminQueues();
  } catch (error) {
    $('#adminLoginMessage').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$('#submissionQueue').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-review-task]');
  if (!button) return;
  const id = button.dataset.reviewTask;
  const status = button.dataset.reviewStatus;
  const note = document.querySelector(`[data-review-note="${CSS.escape(id)}"]`)?.value || '';
  if (status === 'approved' && !window.confirm('Approve this task and credit its coins? This action can only happen once.')) return;
  button.disabled = true;
  try {
    const data = await adminApi(`/api/admin/task-submissions/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ status, reviewNote: note })
    });
    $('#adminMessage').textContent = status === 'approved' ? `Approved. ${Number(data.creditedCoins).toLocaleString()} coins credited.` : 'Submission rejected.';
    await loadAdminQueues();
  } catch (error) {
    $('#adminMessage').textContent = error.message;
    button.disabled = false;
  }
});
$('#campaignResponseQueue').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-review-campaign-response]');
  if (!button) return;
  const id = button.dataset.reviewCampaignResponse;
  const status = button.dataset.reviewStatus;
  const note = document.querySelector(`[data-campaign-response-note="${CSS.escape(id)}"]`)?.value || '';
  if (status === 'approved' && !window.confirm('Approve this genuine feedback and credit the participant coins?')) return;
  button.disabled = true;
  try {
    const data = await adminApi(`/api/admin/campaign-responses/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ status, reviewNote: note })
    });
    $('#adminMessage').textContent = status === 'approved'
      ? `Feedback approved. ${Number(data.creditedCoins).toLocaleString()} coins credited to the participant.${data.campaignCompleted ? ' Campaign response target completed.' : ''}`
      : 'Feedback response rejected; the slot is available for another participant.';
    await loadAdminQueues();
  } catch (error) {
    $('#adminMessage').textContent = error.message;
    button.disabled = false;
  }
});
$('#campaignQueue').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-campaign-status]');
  if (!button) return;
  const nextStatus = button.dataset.status;
  if (nextStatus === 'cancelled' && !window.confirm('Cancel this campaign and refund its coins to the user?')) return;
  button.disabled = true;
  try {
    const data = await adminApi(`/api/admin/campaign-orders/${encodeURIComponent(button.dataset.campaignStatus)}`, {
      method: 'PATCH', body: JSON.stringify({ status: nextStatus })
    });
    $('#adminMessage').textContent = data.refundedCoins ? `Order updated. ${Number(data.refundedCoins).toLocaleString()} coins refunded.` : `Order status updated to ${nextStatus.replaceAll('_',' ')}.`;
    await loadAdminQueues();
  } catch (error) {
    $('#adminMessage').textContent = error.message;
    button.disabled = false;
  }
});
$('#adminSignOut').addEventListener('click', adminSignOut);
$('#reloadAdmin').addEventListener('click', loadAdminQueues);
if (adminToken) {
  $('#adminLoginPanel').hidden = true;
  $('#adminDashboard').hidden = false;
  loadAdminQueues();
}
