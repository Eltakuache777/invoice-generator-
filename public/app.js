const $ = (sel) => document.querySelector(sel);

/* ---------- Account (email + magic link) ----------
   Optional identity layer: logging in lets purchases follow you across devices instead
   of being stuck to one browser's localStorage. Not logging in still works exactly like
   before - licenses just stay local to the browser that bought them. */
function getAccountToken() { return localStorage.getItem('fk_account_token') || ''; }
function setAccountToken(t) { localStorage.setItem('fk_account_token', t); }
function clearAccountToken() { localStorage.removeItem('fk_account_token'); }
function getAccountEmail() { return localStorage.getItem('fk_account_email') || ''; }
function setAccountEmail(e) { localStorage.setItem('fk_account_email', e); }
function clearAccountEmail() { localStorage.removeItem('fk_account_email'); }

function renderAccountBar() {
  const email = getAccountEmail();
  if (email) {
    $('#loginForm').style.display = 'none';
    $('#accountInfo').style.display = 'flex';
    $('#accountEmailLabel').textContent = 'Logged in as ' + email;
  } else {
    $('#loginForm').style.display = 'flex';
    $('#accountInfo').style.display = 'none';
  }
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#loginEmail').value.trim();
  const btn = $('#loginForm button');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const r = await fetch('/api/auth/request-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await r.json();
    if (data.sent) {
      btn.textContent = 'Check your email →';
    } else {
      alert(data.error || 'Could not send login email.');
      btn.disabled = false;
      btn.textContent = 'Email me a login link';
    }
  } catch (err) {
    alert('Network error sending login email.');
    btn.disabled = false;
    btn.textContent = 'Email me a login link';
  }
});

$('#logoutBtn').addEventListener('click', () => {
  clearAccountToken();
  clearAccountEmail();
  renderAccountBar();
});

async function handleLoginRedirect() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('login_token');
  if (!token) return;
  try {
    const r = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await r.json();
    if (data.accountToken) {
      setAccountToken(data.accountToken);
      setAccountEmail(data.email);
      if (data.creditLicense) setLicenseKey(data.creditLicense);
      if (data.subLicense) setSubLicenseKey(data.subLicense);
      renderAccountBar();
      checkSubscription();
      renderBanner();
    } else {
      alert(data.error || 'This login link is invalid or has expired.');
    }
  } catch (e) { console.error(e); }
  window.history.replaceState({}, '', window.location.pathname);
}

/* ---------- Pro subscription gate (Invoice Builder + Receipt Generator) ---------- */
function getSubLicenseKey() { return localStorage.getItem('fk_sub_license') || ''; }
function setSubLicenseKey(k) { localStorage.setItem('fk_sub_license', k); }
function clearSubLicenseKey() { localStorage.removeItem('fk_sub_license'); }

function renderSubGate(active) {
  $('#invoiceForm').style.display = active ? 'block' : 'none';
  $('#invoiceLocked').style.display = active ? 'none' : 'block';
  $('#receiptForm').style.display = active ? 'block' : 'none';
  $('#receiptLocked').style.display = active ? 'none' : 'block';
}

async function checkSubscription() {
  const key = getSubLicenseKey();
  if (!key) {
    renderSubGate(false);
    return;
  }
  try {
    const r = await fetch('/api/subscription-status?licenseKey=' + encodeURIComponent(key));
    const data = await r.json();
    if (!data.active) clearSubLicenseKey();
    renderSubGate(!!data.active);
  } catch (e) {
    // Network hiccup: don't lock out someone who's already paid based on a failed check.
    renderSubGate(true);
  }
}

document.querySelectorAll('.manage-sub-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const key = getSubLicenseKey();
    if (!key) return;
    btn.disabled = true;
    btn.textContent = 'Loading...';
    try {
      const r = await fetch('/api/portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: key })
      });
      const data = await r.json();
      if (data.url) window.location.href = data.url;
      else {
        alert(data.error || 'Could not open subscription management.');
        btn.disabled = false;
        btn.textContent = 'Manage subscription →';
      }
    } catch (e) {
      alert('Network error opening subscription management.');
      btn.disabled = false;
      btn.textContent = 'Manage subscription →';
    }
  });
});

document.querySelectorAll('.sub-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Redirecting...';
    try {
      const r = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountToken: getAccountToken() })
      });
      const data = await r.json();
      if (data.url) window.location.href = data.url;
      else {
        alert(data.error || 'Could not start checkout.');
        btn.disabled = false;
        btn.textContent = 'Subscribe →';
      }
    } catch (e) {
      alert('Network error starting checkout.');
      btn.disabled = false;
      btn.textContent = 'Subscribe →';
    }
  });
});

/* ---------- Tabs ---------- */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.tab;
    $('#invoicePane').style.display = which === 'invoice' ? 'block' : 'none';
    $('#receiptPane').style.display = which === 'receipt' ? 'block' : 'none';
    $('#contractPane').style.display = which === 'contract' ? 'block' : 'none';
  });
});

/* ---------- Invoice builder (free, all client-side) ---------- */
let itemCount = 0;
function addItemRow(desc = '', qty = 1, rate = 0) {
  itemCount++;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="i-desc" value="${desc}" placeholder="Design work"></td>
    <td><input class="i-qty" type="number" min="0" step="1" value="${qty}" style="width:70px;"></td>
    <td><input class="i-rate" type="number" min="0" step="0.01" value="${rate}" style="width:90px;"></td>
    <td class="amt i-amt">$0.00</td>
    <td><button class="rm" title="remove">✕</button></td>
  `;
  tr.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', recalcTotals));
  tr.querySelector('.rm').addEventListener('click', () => {
    tr.remove();
    recalcTotals();
  });
  $('#itemsBody').appendChild(tr);
  recalcTotals();
}

function recalcTotals() {
  let subtotal = 0;
  document.querySelectorAll('#itemsBody tr').forEach((tr) => {
    const qty = parseFloat(tr.querySelector('.i-qty').value) || 0;
    const rate = parseFloat(tr.querySelector('.i-rate').value) || 0;
    const amt = qty * rate;
    tr.querySelector('.i-amt').textContent = '$' + amt.toFixed(2);
    subtotal += amt;
  });
  const taxRate = parseFloat($('#taxRate').value) || 0;
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;
  $('#totalsBox').innerHTML = `
    <div><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
    <div><span>Tax (${taxRate}%)</span><span>$${tax.toFixed(2)}</span></div>
    <div class="grand"><span>Total due</span><span>$${total.toFixed(2)}</span></div>
  `;
  return { subtotal, tax, total };
}

$('#addItemBtn').addEventListener('click', () => addItemRow());
$('#taxRate').addEventListener('input', recalcTotals);
addItemRow('Design services', 1, 500);

$('#printBtn').addEventListener('click', () => {
  const { subtotal, tax, total } = recalcTotals();
  const rows = Array.from(document.querySelectorAll('#itemsBody tr')).map((tr) => {
    const desc = tr.querySelector('.i-desc').value || '';
    const qty = tr.querySelector('.i-qty').value || '0';
    const rate = parseFloat(tr.querySelector('.i-rate').value) || 0;
    const amt = (parseFloat(qty) || 0) * rate;
    return `<tr><td>${escapeHtml(desc)}</td><td>${qty}</td><td>$${rate.toFixed(2)}</td><td>$${amt.toFixed(2)}</td></tr>`;
  }).join('');

  const html = `
    <div class="print-invoice">
      <h1>Invoice ${escapeHtml($('#invNum').value)}</h1>
      <p><strong>From:</strong> ${escapeHtml($('#bizName').value)}${$('#bizContact').value ? ' — ' + escapeHtml($('#bizContact').value) : ''}</p>
      <p><strong>Bill to:</strong> ${escapeHtml($('#clientName').value)}${$('#clientContact').value ? ' — ' + escapeHtml($('#clientContact').value) : ''}</p>
      <p><strong>Invoice date:</strong> ${escapeHtml($('#invDate').value || '')} &nbsp;&nbsp; <strong>Due:</strong> ${escapeHtml($('#dueDate').value || '')}</p>
      <table>
        <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals-print">
        <div><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
        <div><span>Tax</span><span>$${tax.toFixed(2)}</span></div>
        <div class="grand-print"><span>Total due</span><span>$${total.toFixed(2)}</span></div>
      </div>
      ${$('#invNotes').value ? `<p style="margin-top:24px;white-space:pre-wrap;">${escapeHtml($('#invNotes').value)}</p>` : ''}
    </div>
  `;
  $('#printArea').innerHTML = html;
  setTimeout(() => window.print(), 50);
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------- Receipt generator (free, all client-side) ---------- */
function addItemRowR(desc = '', qty = 1, rate = 0) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="i-desc" value="${desc}" placeholder="Consulting session"></td>
    <td><input class="i-qty" type="number" min="0" step="1" value="${qty}" style="width:70px;"></td>
    <td><input class="i-rate" type="number" min="0" step="0.01" value="${rate}" style="width:90px;"></td>
    <td class="amt i-amt">$0.00</td>
    <td><button class="rm" title="remove">✕</button></td>
  `;
  tr.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', recalcTotalsR));
  tr.querySelector('.rm').addEventListener('click', () => {
    tr.remove();
    recalcTotalsR();
  });
  $('#itemsBodyR').appendChild(tr);
  recalcTotalsR();
}

function recalcTotalsR() {
  let subtotal = 0;
  document.querySelectorAll('#itemsBodyR tr').forEach((tr) => {
    const qty = parseFloat(tr.querySelector('.i-qty').value) || 0;
    const rate = parseFloat(tr.querySelector('.i-rate').value) || 0;
    const amt = qty * rate;
    tr.querySelector('.i-amt').textContent = '$' + amt.toFixed(2);
    subtotal += amt;
  });
  const taxRate = parseFloat($('#recTaxRate').value) || 0;
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;
  $('#totalsBoxR').innerHTML = `
    <div><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
    <div><span>Tax (${taxRate}%)</span><span>$${tax.toFixed(2)}</span></div>
    <div class="grand"><span>Amount paid</span><span>$${total.toFixed(2)}</span></div>
  `;
  return { subtotal, tax, total };
}

$('#addItemBtnR').addEventListener('click', () => addItemRowR());
$('#recTaxRate').addEventListener('input', recalcTotalsR);
addItemRowR('Consulting session', 1, 150);

$('#printBtnR').addEventListener('click', () => {
  const { subtotal, tax, total } = recalcTotalsR();
  const rows = Array.from(document.querySelectorAll('#itemsBodyR tr')).map((tr) => {
    const desc = tr.querySelector('.i-desc').value || '';
    const qty = tr.querySelector('.i-qty').value || '0';
    const rate = parseFloat(tr.querySelector('.i-rate').value) || 0;
    const amt = (parseFloat(qty) || 0) * rate;
    return `<tr><td>${escapeHtml(desc)}</td><td>${qty}</td><td>$${rate.toFixed(2)}</td><td>$${amt.toFixed(2)}</td></tr>`;
  }).join('');

  const html = `
    <div class="print-invoice">
      <h1>Receipt ${escapeHtml($('#recNum').value)}</h1>
      <p><strong>Received by:</strong> ${escapeHtml($('#recBizName').value)}${$('#recBizContact').value ? ' — ' + escapeHtml($('#recBizContact').value) : ''}</p>
      <p><strong>Received from:</strong> ${escapeHtml($('#recFromName').value)}${$('#recFromContact').value ? ' — ' + escapeHtml($('#recFromContact').value) : ''}</p>
      <p><strong>Date:</strong> ${escapeHtml($('#recDate').value || '')} &nbsp;&nbsp; <strong>Payment method:</strong> ${escapeHtml($('#recMethod').value)}</p>
      <table>
        <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals-print">
        <div><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
        <div><span>Tax</span><span>$${tax.toFixed(2)}</span></div>
        <div class="grand-print"><span>Amount paid</span><span>$${total.toFixed(2)}</span></div>
      </div>
      ${$('#recNotes').value ? `<p style="margin-top:24px;white-space:pre-wrap;">${escapeHtml($('#recNotes').value)}</p>` : ''}
    </div>
  `;
  $('#printArea').innerHTML = html;
  setTimeout(() => window.print(), 50);
});

/* ---------- Contract generator (free daily limit, then paid credits) ---------- */
let config = { freeDaily: 1, packPrice: 12, packCredits: 15 };

function getLicenseKey() { return localStorage.getItem('fk_license') || ''; }
function setLicenseKey(k) { localStorage.setItem('fk_license', k); }
function todayCountKey() { return 'fk_used_' + new Date().toISOString().slice(0, 10); }
function getLocalFreeUsedToday() { return parseInt(localStorage.getItem(todayCountKey()) || '0', 10); }
function bumpLocalFreeUsedToday() { localStorage.setItem(todayCountKey(), String(getLocalFreeUsedToday() + 1)); }

async function loadConfig() {
  try {
    const r = await fetch('/api/config');
    config = await r.json();
    $('#packCredits').textContent = config.packCredits;
    $('#packPrice').textContent = '$' + config.packPrice;
    document.querySelectorAll('.subPrice').forEach((el) => (el.textContent = '$' + config.subPrice));
    renderBanner();
  } catch (e) {}
}

function renderBanner() {
  const used = getLocalFreeUsedToday();
  const left = Math.max(0, config.freeDaily - used);
  const banner = $('#freeBanner');
  if (getLicenseKey()) {
    banner.textContent = 'You have paid credits available on this browser.';
  } else {
    banner.textContent = `${left} of ${config.freeDaily} free contract generation(s) left today.`;
  }
}

async function handleSuccessRedirect() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  if (!sessionId) return;
  const purchase = params.get('purchase');

  try {
    if (purchase === 'sub') {
      const r = await fetch('/api/verify-subscription?session_id=' + encodeURIComponent(sessionId));
      const data = await r.json();
      if (data.active && data.licenseKey) {
        setSubLicenseKey(data.licenseKey);
        renderSubGate(true);
        alert('Subscription active! Invoice Builder and Receipt Generator are now unlocked on this browser.');
      }
    } else {
      const r = await fetch('/api/verify-session?session_id=' + encodeURIComponent(sessionId));
      const data = await r.json();
      if (data.paid && data.licenseKey) {
        setLicenseKey(data.licenseKey);
        alert(`Payment received! ${data.credits} credits added to this browser. Save code ${data.licenseKey} in case you switch devices.`);
        document.querySelector('.tab[data-tab="contract"]').click();
      }
    }
  } catch (e) { console.error(e); }
  window.history.replaceState({}, '', window.location.pathname);
  renderBanner();
}

$('#genContractBtn').addEventListener('click', async () => {
  const yourName = $('#yourName').value.trim();
  const clientName = $('#clientNameC').value.trim();
  const workDescription = $('#workDescription').value.trim();
  const paymentTerms = $('#paymentTerms').value.trim();
  const contractType = $('#contractType').value;
  const errorBox = $('#errorBox');
  errorBox.style.display = 'none';
  $('#payCard').style.display = 'none';

  if (!yourName || !clientName || !workDescription) {
    errorBox.textContent = 'Please fill in your name, the client name, and a description of the work.';
    errorBox.style.display = 'block';
    return;
  }

  const btn = $('#genContractBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  try {
    const res = await fetch('/api/generate-contract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yourName, clientName, workDescription, paymentTerms, contractType, licenseKey: getLicenseKey() })
    });
    const data = await res.json();

    if (res.status === 402) {
      $('#payCard').style.display = 'block';
      renderBanner();
      return;
    }
    if (!res.ok) {
      errorBox.textContent = data.error || 'Something went wrong.';
      errorBox.style.display = 'block';
      return;
    }

    if (!data.usedCredit) bumpLocalFreeUsedToday();
    $('#contractOut').textContent = data.contract;
    $('#contractResult').style.display = 'block';
    $('#contractResult').scrollIntoView({ behavior: 'smooth' });
    renderBanner();
  } catch (e) {
    errorBox.textContent = 'Network error. Please try again.';
    errorBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate contract →';
  }
});

$('#copyBtn').addEventListener('click', () => {
  navigator.clipboard.writeText($('#contractOut').textContent);
  $('#copyBtn').textContent = 'Copied!';
  setTimeout(() => ($('#copyBtn').textContent = 'Copy text'), 1500);
});

$('#downloadBtn').addEventListener('click', () => {
  const blob = new Blob([$('#contractOut').textContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'contract.txt';
  a.click();
  URL.revokeObjectURL(url);
});

$('#buyBtn').addEventListener('click', async () => {
  const btn = $('#buyBtn');
  btn.disabled = true;
  btn.textContent = 'Redirecting...';
  try {
    const r = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountToken: getAccountToken() })
    });
    const data = await r.json();
    if (data.url) window.location.href = data.url;
    else {
      alert(data.error || 'Could not start checkout.');
      btn.disabled = false;
      btn.textContent = 'Buy credits →';
    }
  } catch (e) {
    alert('Network error starting checkout.');
    btn.disabled = false;
    btn.textContent = 'Buy credits →';
  }
});

renderAccountBar();
loadConfig();
checkSubscription();
handleSuccessRedirect();
handleLoginRedirect();
