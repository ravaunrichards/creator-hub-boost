const $ = selector => document.querySelector(selector);
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function message(text, bad = false) {
  const node = $('#trackingMessage');
  node.textContent = text;
  node.classList.toggle('notice-error', bad);
}
async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.headers || {}), ...(options.body ? {'Content-Type':'application/json'} : {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function statusLabel(status) {
  return String(status || '').replaceAll('_',' ').replace(/\b\w/g, c => c.toUpperCase());
}
function renderOrder(order) {
  $('#trackingResult').hidden = false;
  $('#trackingService').textContent = order.service;
  $('#trackingStatus').textContent = statusLabel(order.status);
  $('#trackingStatus').className = 'status-pill status-' + order.status;
  $('#trackingOrderRef').textContent = order.reference;
  $('#trackingPackage').textContent = order.package;
  $('#trackingAmount').textContent = new Intl.NumberFormat('en-US',{style:'currency',currency:order.currency}).format(order.amount);
  $('#trackingCreated').textContent = new Date(order.createdAt).toLocaleString();
  const stages = [
    {id:'under_review',title:'Payment confirmed',description:'Your paid order is in the review queue.'},
    {id:'in_progress',title:'Review in progress',description:'The service work is being completed.'},
    {id:'completed',title:'Completed',description:'The service deliverable is ready below.'}
  ];
  const orderIndex = order.status === 'completed' ? 2 : order.status === 'in_progress' ? 1 : order.status === 'under_review' ? 0 : -1;
  $('#trackingTimeline').innerHTML = stages.map((stage,i) => {
    const done = orderIndex >= i;
    const current = orderIndex === i;
    return `<div class="tracking-stage ${done?'done':''} ${current?'current':''}"><span>${done?'✓':String(i+1).padStart(2,'0')}</span><div><b>${stage.title}</b><small>${stage.description}</small></div></div>`;
  }).join('');
  if (order.status === 'cancelled') $('#trackingTimeline').innerHTML = '<div class="tracking-stage current"><span>!</span><div><b>Order cancelled</b><small>Contact support if you need help with the payment outcome.</small></div></div>';
  $('#trackingNotes').hidden = !order.fulfilmentNotes;
  $('#trackingNotesText').textContent = order.fulfilmentNotes || '';
}
async function loadPrivateOrder(reference, token) {
  try {
    const data = await request('/api/service-orders/track?reference=' + encodeURIComponent(reference) + '&token=' + encodeURIComponent(token));
    renderOrder(data.order);
    $('#trackingReference').value = data.order.reference;
    $('#trackingResult').scrollIntoView({behavior:'smooth',block:'start'});
  } catch (error) {
    message(error.message, true);
  }
}
$('#trackingRequestForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#trackingSubmit');
  button.disabled = true;
  button.textContent = 'Sending secure link…';
  message('');
  try {
    const data = await request('/api/service-orders/request-tracking-link', {
      method:'POST',
      body:JSON.stringify({reference:$('#trackingReference').value.trim(),email:$('#trackingEmail').value.trim()})
    });
    message(data.message || 'Check your email for a private tracking link.');
  } catch (error) {
    message(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Email my tracking link →';
  }
});
$('#year').textContent = new Date().getFullYear();
const params = new URLSearchParams(location.search);
if (params.get('ref') && params.get('token')) loadPrivateOrder(params.get('ref'), params.get('token'));
