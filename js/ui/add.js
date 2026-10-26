// Add screen: paste one or many SMS -> one draft card each -> check -> save.
// The same card, filled from a saved row, is the editor the List screen opens.
import { db, saveRow, saveStable, softDelete, liveRows, live, getMeta } from '../db.js';
import { owner } from '../supabase.js';
import { parseSms, splitMessages, merchantKey } from '../parser/parse.js';
import { matchPaymentMethod, suggestCategory, fingerprint } from '../parser/resolve.js';
import { h, $, money, today, toast } from './dom.js';

let drafts = [];                             // cards waiting on the Add screen
let ctx = { methods: [], categories: [], rules: [] };

async function loadContext() {
  const [methods, categories, rules] = await Promise.all(
    ['payment_methods', 'categories', 'merchant_rules'].map(liveRows));
  ctx = {
    methods: methods.filter(m => !m.archived),
    categories: categories.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    rules,
  };
  return ctx;
}

export async function showAdd() {
  const root = $('#view-add');
  if (!root.dataset.ready) { build(root); root.dataset.ready = '1'; }
  await loadContext();
  drafts.forEach(d => d.refresh());          // methods or categories may have changed elsewhere
}

function build(root) {
  const box = h('textarea', { id: 'sms-box', rows: 4, placeholder: 'Paste SMS here — one or many',
                              'aria-label': 'Paste SMS here' });
  const readBox = () => { const t = box.value; box.value = ''; parseIntoDrafts(t); };
  box.addEventListener('paste', () => setTimeout(readBox, 0));   // pasting is enough, no extra tap
  root.append(
    h('section', { class: 'paste' },
      box,
      h('div', { class: 'row gap' },
        navigator.clipboard?.readText && h('button', { class: 'primary', onclick: fromClipboard }, 'Paste from clipboard'),
        h('button', { onclick: readBox }, 'Read text'),
        h('button', { onclick: addManual }, '+ Add manually'))),
    h('div', { id: 'drafts' }),
    h('div', { id: 'save-all', class: 'save-all', hidden: true },
      h('button', { class: 'primary wide', onclick: saveAll }, 'Save all')));
}

async function fromClipboard() {
  try { await parseIntoDrafts(await navigator.clipboard.readText()); }
  catch { toast('Clipboard access was blocked: long-press the box and paste instead'); }
}

// Text from the box, the clipboard, Ctrl+V or the Android share sheet
export async function parseIntoDrafts(text) {
  text = (text || '').trim();
  if (!text) return;
  const msgs = splitMessages(text);
  if (!msgs.length) msgs.push(text);
  await loadContext();
  const first = drafts.length;
  for (const raw of msgs) addCard(await fromSms(raw));
  drafts[first]?.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function fromSms(raw, force = false) {
  const p = parseSms(raw);
  if (p.warnings.length && !force) return { kind: 'notice', p };
  const pm = matchPaymentMethod(p, ctx.methods);
  const sug = suggestCategory(p, ctx.rules, ctx.categories);
  const rule = p.merchantKey && ctx.rules.find(r => r.merchant_key === p.merchantKey);
  // No card or account in the SMS (e.g. a bare UPI alert): use the method you picked for this merchant last time
  const methodId = pm.isNew ? (!pm.method && rule?.payment_method_id) || null : pm.method.id;
  const fp = fingerprint(p);
  return {
    kind: 'draft',
    tx: { amount: p.amount, direction: p.direction, occurred_on: p.date, merchant: p.merchant,
          payment_method_id: methodId, category_id: sug.category?.id ?? null, notes: null, tags: [],
          source: 'sms', raw_sms: p.raw, ref_no: p.ref, fingerprint: fp },
    auto: { amount: p.amount != null, direction: true, occurred_on: true, merchant: !!p.merchant,
            payment_method_id: !!methodId, category_id: sug.source === 'learned' ? 'learned' : !!sug.category },
    suggestedCategoryId: sug.category?.id ?? null,
    newMethod: pm.isNew ? pm.method : null,
    dup: await findDuplicate(fp),
  };
}

async function findDuplicate(fp) {
  const saved = live(await db.transactions.where('fingerprint').equals(fp).toArray())[0];
  if (saved) return { tx: saved, where: 'already saved' };
  const queued = drafts.find(d => d.d.tx?.fingerprint === fp);
  return queued ? { tx: queued.d.tx, where: 'also in this paste' } : null;
}

function addManual() {
  loadContext().then(() => {
    const def = ctx.methods.find(m => m.is_default);
    addCard({
      kind: 'draft', auto: {}, suggestedCategoryId: null,
      tx: { amount: null, direction: 'debit', occurred_on: today(), merchant: null, payment_method_id: def?.id ?? null,
            category_id: null, notes: null, tags: [], source: 'manual', fingerprint: null },
    }, true);
  });
}

function addCard(d, top = false) {
  const card = d.kind === 'notice' ? noticeCard(d) : draftCard(d, { onDone: () => removeCard(card) });
  drafts.push(card);
  const list = $('#drafts');
  top ? list.prepend(card.el) : list.append(card.el);
  updateSaveAll();
  if (top) card.el.querySelector('input')?.focus();
  return card;
}

function removeCard(card) {
  card.el.remove();
  drafts = drafts.filter(c => c !== card);
  updateSaveAll();
}

function updateSaveAll() {
  const n = drafts.filter(c => c.d.kind === 'draft' && !c.d.dup).length;
  const bar = $('#save-all');
  bar.hidden = n < 2;
  bar.querySelector('button').textContent = `Save all (${n})`;
}

async function saveAll() {
  let n = 0;
  for (const c of [...drafts]) if (c.d.kind === 'draft' && !c.d.dup && await c.save(true)) n++;
  if (n) toast(`Saved ${n} ${n === 1 ? 'entry' : 'entries'}`);
}

// SMS that is not a transaction (OTP, bill reminder, statement)
function noticeCard(d) {
  const self = { d, refresh() {}, save: async () => false };
  self.el = h('div', { class: 'card notice' },
    h('strong', {}, 'Not a transaction'),
    h('p', { class: 'muted' }, d.p.warnings.join(' · ')),
    h('p', { class: 'sms' }, d.p.raw),
    h('div', { class: 'actions' },
      h('button', { onclick: () => removeCard(self) }, 'Ignore'),
      h('button', { onclick: async () => {
        const next = draftCard(await fromSms(d.p.raw, true), { onDone: () => removeCard(next) });
        drafts[drafts.indexOf(self)] = next;
        self.el.replaceWith(next.el);
        updateSaveAll();
      } }, 'Add anyway')));
  return self;
}

// The draft card. d = { tx, auto, suggestedCategoryId, newMethod?, dup? }
function draftCard(d, { editing = false, onDone }) {
  const tx = d.tx;
  let dir = tx.direction || 'debit';
  let categoryTouched = false;

  const badge = field => d.auto[field] ? h('em', { class: `badge ${d.auto[field] === 'learned' ? 'learned' : ''}` },
                                           d.auto[field] === 'learned' ? 'learned' : 'auto') : null;
  const dropBadge = e => e.target.closest('label, .amount-row')?.querySelector('.badge')?.remove();

  const amount = h('input', { type: 'text', inputmode: 'decimal', class: 'amount', placeholder: '0.00', 'aria-label': 'Amount',
                              value: tx.amount != null ? tx.amount.toFixed(2) : '', oninput: e => { dropBadge(e); mark(); } });
  const segs = ['debit', 'credit'].map(v => h('button', { type: 'button', class: 'seg', dataset: { v },
    onclick: e => { dir = v; dropBadge(e); paintDir(); } }, v === 'debit' ? 'Debit' : 'Credit'));
  const date = h('input', { type: 'date', value: tx.occurred_on || today(), onchange: dropBadge });
  const merchant = h('input', { type: 'text', value: tx.merchant || '', placeholder: 'Merchant or person',
                                oninput: e => { dropBadge(e); mark(); }, onchange: resuggest });
  const method = h('select', { onchange: e => { dropBadge(e); chip?.remove(); mark(); } });
  const category = h('select', { onchange: e => { categoryTouched = true; dropBadge(e); mark(); } });
  const notes = h('input', { type: 'text', value: tx.notes || '', placeholder: 'Optional' });
  const tags = h('input', { type: 'text', value: (tx.tags || []).join(', '), placeholder: 'comma, separated' });

  let chip = d.newMethod && !tx.payment_method_id
    ? h('button', { type: 'button', class: 'chip new', onclick: saveNewMethod }, `New: ${d.newMethod.name} · Save`)
    : null;

  const saveBtn = h('button', { class: 'primary', onclick: () => save() }, d.dup ? 'Save anyway' : 'Save');
  const el = h('div', { class: 'card draft' },
    d.dup && h('div', { class: 'banner warn' },
      h('strong', {}, 'Possible duplicate'), ` — ${money(d.dup.tx.amount)} · ${d.dup.tx.merchant || 'no merchant'} · ${d.dup.tx.occurred_on}, ${d.dup.where}.`),
    h('div', { class: 'amount-row' }, amount, h('div', { class: 'segs' }, segs), badge('amount')),
    h('div', { class: 'grid' },
      h('label', {}, h('span', {}, 'Date ', badge('occurred_on')), date),
      h('label', {}, h('span', {}, 'Merchant ', badge('merchant')), merchant),
      h('label', {}, h('span', {}, 'Payment method ', badge('payment_method_id')), method, chip),
      h('label', {}, h('span', {}, 'Category ', badge('category_id')), category),
      h('label', {}, h('span', {}, 'Notes'), notes),
      h('label', {}, h('span', {}, 'Tags'), tags)),
    tx.raw_sms && h('details', { class: 'sms' }, h('summary', {}, 'Original SMS'), h('p', {}, tx.raw_sms)),
    h('div', { class: 'actions' },
      editing && h('button', { class: 'danger', onclick: remove }, 'Delete'),
      h('button', { onclick: () => onDone(false) }, editing ? 'Cancel' : 'Skip'),
      saveBtn));

  const self = { el, d, refresh, save };

  function paintDir() {
    segs.forEach(b => b.classList.toggle('on', b.dataset.v === dir));
    el.classList.toggle('credit', dir === 'credit');
  }

  function fill(select, items, current, blank, group) {
    select.replaceChildren(h('option', { value: '' }, blank));
    const groups = group ? Object.groupBy(items, group) : { '': items };
    for (const [g, rows] of Object.entries(groups)) {
      const opts = rows.map(r => h('option', { value: r.id, selected: r.id === current }, r.name));
      select.append(...(g ? [h('optgroup', { label: g }, opts)] : opts));
    }
    select.value = current && items.some(r => r.id === current) ? current : '';
  }

  function refresh() {
    let m = method.value || tx.payment_method_id;
    // A method saved from another card (or device) may be the one this SMS was asking for
    if (!m && d.newMethod) {
      const hit = ctx.methods.find(x => x.last4 && x.last4 === d.newMethod.last4 && x.bank === d.newMethod.bank);
      if (hit) { m = hit.id; chip?.remove(); chip = null; }
    }
    fill(method, ctx.methods, m, '— Payment method —');
    const KIND = { expense: 'Expense', income: 'Income', transfer: 'Transfer' };
    fill(category, ctx.categories, category.value || tx.category_id, '— Category —', c => KIND[c.kind] || 'Other');
    mark();
  }

  // Missing fields are highlighted, never blocking except the amount
  function mark() {
    amount.classList.toggle('missing', !(Number(amount.value.replace(/[,₹\s]/g, '')) > 0));
    merchant.classList.toggle('missing', !merchant.value.trim());
    method.classList.toggle('missing', !method.value);
    category.classList.toggle('missing', !category.value);
  }

  // Typed or corrected merchant: suggest its category, unless you already picked one
  function resuggest() {
    if (categoryTouched) return;
    const name = merchant.value.trim();
    const sug = suggestCategory({ merchant: name, merchantKey: merchantKey(name), direction: dir, raw: tx.raw_sms || '' },
                                ctx.rules, ctx.categories);
    if (!sug.category) return;
    category.value = sug.category.id;
    d.suggestedCategoryId = sug.category.id;
    mark();
  }

  async function saveNewMethod() {
    const m = await saveRow('payment_methods', { ...d.newMethod, keywords: [] });
    chip.remove(); chip = null;
    await loadContext();
    method.value = '';
    tx.payment_method_id = m.id;
    drafts.forEach(c => c !== self && c.refresh());
    refresh();
    toast(`Saved ${m.name}`);
  }

  async function save(fromSaveAll = false) {
    const amt = Number(amount.value.replace(/[,₹\s]/g, ''));
    if (!(amt > 0)) { if (!fromSaveAll) { amount.focus(); toast('Enter the amount'); } return false; }
    const own = await owner();
    const name = merchant.value.trim() || null;
    const row = {
      ...tx,
      amount: Math.round(amt * 100) / 100, direction: dir, occurred_on: date.value || today(),
      merchant: name, merchant_key: merchantKey(name),
      payment_method_id: method.value || null, category_id: category.value || null,
      notes: notes.value.trim() || null,
      tags: tags.value.split(',').map(t => t.trim()).filter(Boolean),
      deleted_at: null,
    };
    let saved;
    if (row.id) {
      saved = await saveRow('transactions', row);                       // editing a saved entry
    } else {
      if (!(await getMeta('keepRawSms', true))) row.raw_sms = null;
      if (row.fingerprint) {
        if (d.dup) row.fingerprint += '#' + crypto.randomUUID().slice(0, 8);   // "Save anyway": its own fingerprint
        // Same SMS saved on two devices before they sync -> same id -> one row
        saved = await saveStable('transactions', own, `:tx:${row.fingerprint}`, row);
      } else {
        saved = await saveRow('transactions', row);
      }
    }
    await learn(saved, d.suggestedCategoryId, own);
    if (!fromSaveAll) toast(`Saved ${money(saved.amount)}${saved.merchant ? ' · ' + saved.merchant : ''}`);
    onDone(true);
    return true;
  }

  async function remove() {
    if (!confirm('Delete this entry?')) return;
    await softDelete('transactions', tx.id);
    toast('Deleted');
    onDone(true);
  }

  paintDir();
  refresh();
  return self;
}

// Learning step: a merchant's category (and method) is remembered, so its next SMS is filled in
async function learn(tx, suggestedId, own) {
  if (!tx.merchant_key || !tx.category_id) return;
  const rule = live(await db.merchant_rules.where('merchant_key').equals(tx.merchant_key).toArray())[0];
  if (rule && rule.category_id === tx.category_id && tx.category_id === suggestedId
      && (!tx.payment_method_id || rule.payment_method_id === tx.payment_method_id)) return;   // nothing new
  await saveStable('merchant_rules', own, `:rule:${tx.merchant_key}`, {
    merchant_key: tx.merchant_key, category_id: tx.category_id,
    payment_method_id: tx.payment_method_id ?? rule?.payment_method_id ?? null,
    hits: (rule?.hits ?? 0) + 1, deleted_at: null,
  });
}

// List screen: tap a row to edit it in the same card
export async function openEditor(tx) {
  await loadContext();
  const dlg = h('dialog', { class: 'editor' });
  const card = draftCard({ tx: { ...tx }, auto: {}, suggestedCategoryId: tx.category_id }, { editing: true, onDone: () => dlg.close() });
  dlg.append(card.el);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
