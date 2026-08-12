const $ = (sel) => document.querySelector(sel);

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
  try {
    const r = await fetch('/api/verify-session?session_id=' + encodeURIComponent(sessionId));
    const data = await r.json();
    if (data.paid && data.licenseKey) {
      setLicenseKey(data.licenseKey);
      alert(`Payment received! ${data.credits} credits added to this browser. Save code ${data.licenseKey} in case you switch devices.`);
      document.querySelector('.tab[data-tab="contract"]').click();
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
    const r = await fetch('/api/checkout', { method: 'POST' });
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

loadConfig();
handleSuccessRedirect();
