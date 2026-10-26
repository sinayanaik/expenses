// Settings: sync connection, sign-in, sync status, install & share, payment methods, categories, learned rules,
// export / import, preferences and a parser tester.
import { db, TABLES, LOCAL_ONLY, saveRow, softDelete, liveRows, getMeta, setMeta, dirtyCount } from '../db.js';
import { configured, sendCode, verifyCode, signOut, currentUser,
         getConnection, checkConnection, testConnection, saveConnection, forgetConnection } from '../supabase.js';
import { syncNow } from '../sync.js';
import { parseSms } from '../parser/parse.js';
import { matchPaymentMethod, suggestCategory, fingerprint } from '../parser/resolve.js';
import { h, $, mount, toast, download, formDialog } from './dom.js';
import { installCard } from './install.js';

let lastStatus = null;
addEventListener('sync-status', e => { lastStatus = e.detail; paintSync(); });
addEventListener('data-changed', () => paintSync());

const TYPES = [['credit_card', 'Credit card'], ['debit_card', 'Debit card'], ['bank_account', 'Bank account'],
               ['upi', 'UPI'], ['wallet', 'Wallet'], ['cash', 'Cash']];
const KINDS = [['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer']];

export async function showSettings() {
  const root = $('#view-settings');
  const [user, methods, categories, rules, keepRaw] = await Promise.all([
    currentUser(), liveRows('payment_methods'), liveRows('categories'), liveRows('merchant_rules'), getMeta('keepRawSms', true)]);
  categories.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  mount(root,
    connection(user),
    account(user),
    h('section', { class: 'card', id: 'sync-box' }),
    installCard(),
    methodsSection(methods),
    categoriesSection(categories),
    rulesSection(rules, categories),
    dataSection(),
    h('section', { class: 'card' },
      h('h3', {}, 'Preferences'),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: keepRaw, onchange: e => setMeta('keepRawSms', e.target.checked) }),
        ' Keep the original SMS with each entry (lets you re-check or re-parse it later)')),
    tester());
  paintSync();
}

// ---- Sync connection ---------------------------------------------------------
// The Supabase URL and key are entered here on each device and stay in this browser only.

const PRIVATE_NOTE = 'Stored only in this browser on this device. It is never synced, never included in exports, ' +
                     'and is not part of the app’s files. Enter it once on each device.';

function connection(user) {
  const c = getConnection();
  if (!c) return connectionForm();
  const mask = k => k.length > 14 ? `${k.slice(0, 8)}…${k.slice(-4)}` : '••••••••';
  const card = h('section', { class: 'card' },
    h('h3', {}, 'Sync connection'),
    h('p', { class: 'muted' }, PRIVATE_NOTE),
    h('dl', { class: 'kv' }, h('dt', {}, 'Project URL'), h('dd', {}, c.url), h('dt', {}, 'Public key'), h('dd', {}, mask(c.key))),
    h('div', { class: 'row gap wrap' },
      user ? h('p', { class: 'muted' }, 'Sign out to change the connection.')
           : h('button', { onclick: () => card.replaceWith(connectionForm(c)) }, 'Change'),
      h('button', { class: 'danger', onclick: () => disconnect(user) }, 'Remove from this device')));
  return card;
}

function connectionForm(current = null) {
  const url = h('input', { type: 'url', name: 'supabase-url', required: true, value: current?.url ?? '',
                           placeholder: 'https://abcd1234.supabase.co', autocomplete: 'off', spellcheck: 'false' });
  const key = h('input', { type: 'password', name: 'supabase-key', required: !current, autocomplete: 'off', spellcheck: 'false',
                           placeholder: current ? 'Leave empty to keep the saved key' : 'anon / publishable key' });
  const show = h('input', { type: 'checkbox', onchange: e => { key.type = e.target.checked ? 'text' : 'password'; } });
  const status = h('p', { class: 'error', hidden: true });
  const fail = msg => { status.textContent = msg; status.hidden = false; };
  const form = h('form', { class: 'form flat', onsubmit: async e => {
    e.preventDefault();
    status.hidden = true;
    let c;
    try { c = checkConnection(url.value, key.value || current?.key || ''); } catch (err) { return fail(err.message); }
    try {
      await testConnection(c);
    } catch (err) {
      if (!(err instanceof TypeError)) return fail(err.message);               // the project answered: wrong URL or key
      if (!confirm('Could not reach the project (offline?). Save the connection anyway?')) return;
    }
    saveConnection(c);
    toast('Connection saved on this device');
    location.reload();                       // start the sync client with the new connection
  } },
    h('h3', {}, current ? 'Change sync connection' : 'Connect sync'),
    h('p', { class: 'muted' }, 'To share one ledger between your phone and laptop, create a Supabase project and paste its ',
      h('strong', {}, 'Project URL'), ' and ', h('strong', {}, 'anon / publishable key'),
      ' (Supabase → Project Settings → API). Never use the secret / service_role key.'),
    h('label', {}, h('span', {}, 'Project URL'), url),
    h('label', {}, h('span', {}, 'Public key'), key),
    h('label', { class: 'check' }, show, ' Show key'),
    h('p', { class: 'muted' }, PRIVATE_NOTE),
    status,
    h('div', { class: 'actions' },
      current && h('button', { type: 'button', onclick: () => showSettings() }, 'Cancel'),
      h('button', { class: 'primary' }, current ? 'Save' : 'Save & connect')));
  return h('section', { class: 'card' }, form);
}

async function disconnect(user) {
  if (user) {                                // signed in: also sign out and clear this device's copy
    const waiting = await dirtyCount();
    if (!confirm((waiting ? `${waiting} change(s) have not synced yet and will be lost. ` : '') +
                 'Remove the connection, sign out and clear the data stored on this device? It stays in your Supabase project.')) return;
    await signOut();
    await db.delete();
  } else if (!confirm('Remove the sync connection from this device? Your entries on this device stay.')) return;
  forgetConnection();
  location.reload();
}

// ---- Account ---------------------------------------------------------------

function account(user) {
  if (!configured) return null;              // the connection card above explains what to do
  if (user) {
    return h('section', { class: 'card' }, h('h3', {}, 'Account'),
      h('p', {}, 'Signed in as ', h('strong', {}, user.email)),
      h('button', { onclick: doSignOut }, 'Sign out'));
  }
  const email = h('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email', required: true });
  const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '6-digit code',
                            maxlength: 10, required: true });
  const step2 = h('form', { class: 'row gap', hidden: true, onsubmit: async e => {
    e.preventDefault();
    try {
      await verifyCode(email.value.trim(), code.value.trim());
      toast('Signed in — syncing');
      showSettings();
    } catch (err) { toast(err.message); }
  } }, code, h('button', { class: 'primary' }, 'Verify'));
  const step1 = h('form', { class: 'row gap', onsubmit: async e => {
    e.preventDefault();
    try {
      await sendCode(email.value.trim());
      step2.hidden = false;
      code.focus();
      toast('Code sent — check your email');
    } catch (err) { toast(err.message); }
  } }, email, h('button', { class: 'primary' }, 'Send code'));
  return h('section', { class: 'card' }, h('h3', {}, 'Sign in to sync'),
    h('p', { class: 'muted' }, 'Use the same email on every device. You get a one-time code, no password.'),
    step1, step2);
}

async function doSignOut() {
  const waiting = await dirtyCount();
  const msg = waiting
    ? `${waiting} change(s) have not synced yet and will be lost. Sign out and clear this device anyway?`
    : 'Sign out and clear the data stored on this device? It stays in your account.';
  if (!confirm(msg)) return;
  await signOut();
  await db.delete();                         // shared laptops: nothing stays behind
  location.reload();
}

async function paintSync() {
  const box = $('#sync-box');
  if (!box) return;
  const [last, waiting] = await Promise.all([getMeta('lastSyncAt'), dirtyCount()]);
  const s = lastStatus?.status;
  const text = { ok: 'Up to date', offline: 'Offline — will sync when back online', 'signed-out': 'Not signed in',
                 'not-configured': 'Sync is off', error: `Error: ${lastStatus?.message}` }[s] || 'Not synced yet';
  box.replaceChildren(
    h('h3', {}, 'Sync'),
    h('p', { class: s === 'error' ? 'error' : 'muted' }, text),
    h('p', { class: 'muted' }, `Last synced: ${last ? new Date(last).toLocaleString('en-IN') : 'never'} · ${waiting} waiting`),
    h('button', { disabled: !configured, onclick: async () => { const r = await syncNow(); toast(r.status === 'ok' ? 'Synced' : r.message || r.status); } },
      'Sync now'));
}

// ---- Payment methods, categories, rules -------------------------------------

function methodsSection(methods) {
  const edit = async (m = {}) => {
    const v = await formDialog(m.id ? 'Edit payment method' : 'New payment method', [
      { name: 'name', label: 'Name', required: true, placeholder: 'SBI Credit Card' },
      { name: 'type', label: 'Type', type: 'select', options: TYPES },
      { name: 'bank', label: 'Bank (as the parser names it)', placeholder: 'SBI, HDFC, ICICI, Axis…' },
      { name: 'last4', label: 'Last 4 digits', inputmode: 'numeric', maxlength: 4, pattern: '\\d{4}' },
      { name: 'keywords', label: 'Extra keywords in its SMS (comma separated)', placeholder: 'sbicard' },
      { name: 'is_default', label: 'Default for manual entries', type: 'checkbox' },
      { name: 'archived', label: 'Archived (hidden from pickers)', type: 'checkbox' },
    ], { type: 'credit_card', ...m, keywords: (m.keywords || []).join(', ') });
    if (!v) return;
    const row = await saveRow('payment_methods', { ...m, ...v, bank: v.bank || null, last4: v.last4 || null,
      keywords: v.keywords.split(',').map(k => k.trim()).filter(Boolean) });
    if (row.is_default) {                     // only one default
      for (const o of methods) if (o.id !== row.id && o.is_default) await saveRow('payment_methods', { id: o.id, is_default: false });
    }
    showSettings();
  };
  return listSection('Payment methods', methods, m => [
    m.name + (m.is_default ? ' · default' : '') + (m.archived ? ' · archived' : ''),
    [TYPES.find(([t]) => t === m.type)?.[1], m.bank, m.last4 && '••' + m.last4].filter(Boolean).join(' · '),
  ], edit, m => del('payment_methods', m, m.name), 'Add payment method');
}

function categoriesSection(categories) {
  const edit = async (c = {}) => {
    const v = await formDialog(c.id ? 'Edit category' : 'New category', [
      { name: 'name', label: 'Name', required: true },
      { name: 'kind', label: 'Kind', type: 'select', options: KINDS },
    ], { kind: 'expense', ...c });
    if (!v) return;
    await saveRow('categories', { sort_order: categories.length, ...c, ...v });
    showSettings();
  };
  return listSection('Categories', categories, c => [c.name, KINDS.find(([k]) => k === c.kind)?.[1]],
    edit, c => del('categories', c, c.name), 'Add category');
}

function rulesSection(rules, categories) {
  const cat = new Map(categories.map(c => [c.id, c.name]));
  rules.sort((a, b) => a.merchant_key.localeCompare(b.merchant_key));
  return listSection('Learned rules', rules,
    r => [r.merchant_key, `→ ${cat.get(r.category_id) || 'deleted category'} · used ${r.hits}×`],
    null, r => del('merchant_rules', r, `the rule for “${r.merchant_key}”`), null,
    'Rules are learned when you save an entry. Delete one to go back to the built-in guess.');
}

function listSection(title, rows, describe, edit, remove, addLabel, note) {
  return h('section', { class: 'card' },
    h('h3', {}, title),
    note && h('p', { class: 'muted' }, note),
    rows.length ? h('ul', { class: 'items' }, rows.map(r => {
      const [main, sub] = describe(r);
      return h('li', {},
        h('span', { class: 'item-text' }, h('span', {}, main), sub && h('small', {}, sub)),
        edit && h('button', { onclick: () => edit(r) }, 'Edit'),
        h('button', { class: 'danger', onclick: () => remove(r) }, 'Delete'));
    })) : h('p', { class: 'empty' }, 'None yet.'),
    addLabel && h('button', { onclick: () => edit() }, '+ ' + addLabel));
}

async function del(table, row, label) {
  if (!confirm(`Delete ${label}?`)) return;
  await softDelete(table, row.id);
  showSettings();
}

// ---- Export / import ---------------------------------------------------------

function dataSection() {
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: e => importJson(e.target.files[0]) });
  return h('section', { class: 'card' },
    h('h3', {}, 'Your data'),
    h('div', { class: 'row gap wrap' },
      h('button', { onclick: exportCsv }, 'Export CSV'),
      h('button', { onclick: exportJson }, 'Export JSON (backup)'),
      h('button', { onclick: () => file.click() }, 'Import JSON'), file));
}

const stamp = () => new Date().toLocaleDateString('en-CA');
const strip = r => Object.fromEntries(Object.entries(r).filter(([k]) => !LOCAL_ONLY.includes(k)));

async function exportJson() {
  const tables = {};
  for (const t of TABLES) tables[t] = (await db[t].toArray()).map(strip);
  download(`expenses-${stamp()}.json`, JSON.stringify({ app: 'expense-pwa', version: 1, exported_at: new Date().toISOString(), tables }, null, 2),
    'application/json');
}

async function exportCsv() {
  const [txs, categories, methods] = await Promise.all(['transactions', 'categories', 'payment_methods'].map(liveRows));
  const cat = new Map(categories.map(c => [c.id, c.name]));
  const pm = new Map(methods.map(m => [m.id, m.name]));
  const cell = v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
  const lines = [['date', 'direction', 'amount', 'merchant', 'category', 'payment_method', 'notes', 'tags', 'source', 'ref_no']];
  for (const t of txs.sort((a, b) => a.occurred_on.localeCompare(b.occurred_on)))
    lines.push([t.occurred_on, t.direction, Number(t.amount).toFixed(2), t.merchant, cat.get(t.category_id), pm.get(t.payment_method_id),
                t.notes, (t.tags || []).join('; '), t.source, t.ref_no]);
  download(`expenses-${stamp()}.csv`, lines.map(l => l.map(cell).join(',')).join('\n'), 'text/csv');
}

async function importJson(f) {
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data?.tables) throw new Error('Not an export from this app');
    let n = 0;
    for (const t of TABLES) for (const r of data.tables[t] || []) { if (r.id) { await saveRow(t, strip(r)); n++; } }
    toast(`Imported ${n} rows`);
    showSettings();
  } catch (err) { toast(`Import failed: ${err.message}`); }
}

// ---- Parser tester -----------------------------------------------------------

function tester() {
  const out = h('pre', { class: 'tester-out' });
  const box = h('textarea', { rows: 4, placeholder: 'Paste an SMS to see what the parser reads from it',
    oninput: async () => {
      if (!box.value.trim()) return out.replaceChildren();
      const [methods, categories, rules] = await Promise.all(['payment_methods', 'categories', 'merchant_rules'].map(liveRows));
      const p = parseSms(box.value);
      const pm = matchPaymentMethod(p, methods);
      const c = suggestCategory(p, rules, categories);
      const { raw, ...fields } = p;
      out.textContent = JSON.stringify({ ...fields, fingerprint: fingerprint(p),
        paymentMethod: pm.method ? `${pm.method.name}${pm.isNew ? ' (new)' : ''}` : null,
        category: c.category ? `${c.category.name} (${c.source})` : null }, null, 2);
    } });
  return h('section', { class: 'card' },
    h('h3', {}, 'Parser tester'),
    box, out,
    h('p', {}, h('a', { href: 'tests/parser.html', target: '_blank' }, 'Run all parser tests')));
}
