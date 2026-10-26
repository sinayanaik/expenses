// Add screen: paste one or many SMS -> one draft card each -> check -> save.
// The same card, filled from a saved row, is the editor the List screen opens.
import { db, saveRow, saveStable, softDelete, liveRows, live, getMeta } from '../db.js';
import { owner } from '../supabase.js';
import { parseSms, splitMessages, merchantKey } from '../parser/parse.js';
import { matchPaymentMethod, suggestCategory, fingerprint } from '../parser/resolve.js';
import { h, $, mount, money, today, toast } from './dom.js';
import { installCard } from './install.js';
import { buildHistory, lastTimeSuggestion } from '../history.js';
import { categoryField, tagInput, editMethod } from './pickers.js';

let drafts = [];                             // cards waiting on the Add screen
let ctx = { methods: [], categories: [], rules: [], history: buildHistory([]) };
const OTHER = '__other__';                 // the "Other… (type a name)" payment method option

async function loadContext() {
  const [methods, categories, rules, txs] = await Promise.all(
    ['payment_methods', 'categories', 'merchant_rules', 'transactions'].map(liveRows));
  ctx = {
    history: buildHistory(txs),
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
    installCard({ compact: true }),
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
  let suggestion = null;                     // what the "Last time" strip would apply
  let stripKey = '';                         // what the strip currently shows, so it is only redrawn when that changes

  const badge = field => d.auto[field] ? h('em', { class: `badge ${d.auto[field] === 'learned' ? 'learned' : ''}` },
                                           d.auto[field] === 'learned' ? 'learned' : 'auto') : null;
  // The "auto" badge goes as soon as you change the field yourself
  const dropBadge = e => (e.target || e).closest('label, .field, .amount-row')?.querySelector('.badge')?.remove();
  const stamp = fieldEl => {                 // marks a field filled by "Last time"
    const title = fieldEl.querySelector(':scope > span');
    title.querySelector('.badge')?.remove();
    title.append(' ', h('em', { class: 'badge learned' }, 'last time'));
  };

  const amount = h('input', { type: 'text', inputmode: 'decimal', class: 'amount', placeholder: '0.00', 'aria-label': 'Amount',
                              value: tx.amount != null ? tx.amount.toFixed(2) : '', oninput: e => { dropBadge(e); mark(); } });
  const segs = ['debit', 'credit'].map(v => h('button', { type: 'button', class: 'seg', dataset: { v },
    onclick: e => { dir = v; dropBadge(e); paintDir(); } }, v === 'debit' ? 'Debit' : 'Credit'));
  const date = h('input', { type: 'date', value: tx.occurred_on || today(), onchange: dropBadge });
  const merchant = h('input', { type: 'text', value: tx.merchant || '', placeholder: 'Merchant or person',
                                oninput: e => { dropBadge(e); mark(); updateSuggestion(); },
                                onchange: () => { resuggest(); updateSuggestion(); } });

  // Payment method: pick, add, edit, or type a name that is not in the list
  const method = h('select', { 'aria-label': 'Payment method', onchange: onMethod });
  const methodName = h('input', { type: 'text', hidden: true, placeholder: 'Type a name, e.g. Cash or Wife’s card',
                                  'aria-label': 'New payment method name', oninput: mark });
  const newBtn = h('button', { type: 'button', class: 'mini', onclick: newMethod }, '+ New');
  const editBtn = h('button', { type: 'button', class: 'mini', onclick: editSelected }, 'Edit');
  let chip = d.newMethod && !tx.payment_method_id
    ? h('button', { type: 'button', class: 'chip new', onclick: saveNewMethod }, `New: ${d.newMethod.name} · Save`)
    : null;

  const category = categoryField({
    ctx: () => ({ categories: ctx.categories, catUse: ctx.history.catUse, kind: dir === 'credit' ? 'income' : 'expense' }),
    onPick: async () => { await loadContext(); drafts.forEach(c => c !== self && c.refresh()); },   // a new category is known everywhere
    onChange: () => { categoryTouched = true; dropBadge(category.el); mark(); updateSuggestion(); },
  });
  category.value = tx.category_id || '';

  const notes = h('input', { type: 'text', value: tx.notes || '', placeholder: 'Optional' });
  const tags = tagInput({ initial: tx.tags || [], tagUse: () => ctx.history.tagUse, onChange: updateSuggestion });

  const methodField = h('div', { class: 'field wide' },
    h('span', {}, 'Payment method ', badge('payment_method_id')),
    h('div', { class: 'row gap' }, method, newBtn, editBtn), methodName, chip);
  const categoryFieldEl = h('div', { class: 'field' }, h('span', {}, 'Category ', badge('category_id')), category.el);
  const tagsFieldEl = h('div', { class: 'field wide' }, h('span', {}, 'Tags'), tags.el);
  const suggest = h('div', { class: 'last-time wide', hidden: true });

  const saveBtn = h('button', { class: 'primary', onclick: () => save() }, d.dup ? 'Save anyway' : 'Save');
  const el = h('div', { class: 'card draft' },
    d.dup && h('div', { class: 'banner warn' },
      h('strong', {}, 'Possible duplicate'), ` — ${money(d.dup.tx.amount)} · ${d.dup.tx.merchant || 'no merchant'} · ${d.dup.tx.occurred_on}, ${d.dup.where}.`),
    h('div', { class: 'amount-row' }, amount, h('div', { class: 'segs' }, segs), badge('amount')),
    h('div', { class: 'grid' },
      h('label', {}, h('span', {}, 'Date ', badge('occurred_on')), date),
      h('label', {}, h('span', {}, 'Merchant ', badge('merchant')), merchant),
      suggest,
      methodField,
      categoryFieldEl,
      h('label', {}, h('span', {}, 'Notes'), notes),
      tagsFieldEl),
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

  function fill(select, items, current, blank) {
    select.replaceChildren(h('option', { value: '' }, blank),
      ...items.map(r => h('option', { value: r.id, selected: r.id === current }, r.name)));
    select.value = current && items.some(r => r.id === current) ? current : '';
  }

  const selectedMethodId = () => method.value && method.value !== OTHER ? method.value : null;
  const syncMethodButtons = () => { editBtn.disabled = !selectedMethodId(); };

  function refresh() {
    let m = method.value || tx.payment_method_id;
    // A method saved from another card (or device) may be the one this SMS was asking for
    if (!m && d.newMethod) {
      const hit = ctx.methods.find(x => x.last4 && x.last4 === d.newMethod.last4 && x.bank === d.newMethod.bank);
      if (hit) { m = hit.id; chip?.remove(); chip = null; }
    }
    const other = method.value === OTHER;
    fill(method, ctx.methods, other ? '' : m, '— Payment method —');
    method.append(h('option', { value: OTHER }, 'Other… (type a name)'));
    if (other) method.value = OTHER;
    category.paint();
    syncMethodButtons();
    mark();
    updateSuggestion();
  }

  // Missing fields are highlighted, never blocking except the amount
  function mark() {
    amount.classList.toggle('missing', !(Number(amount.value.replace(/[,₹\s]/g, '')) > 0));
    merchant.classList.toggle('missing', !merchant.value.trim());
    method.classList.toggle('missing', !method.value || (method.value === OTHER && !methodName.value.trim()));
    category.el.classList.toggle('missing', !category.value);
  }

  function onMethod(e) {
    dropBadge(e);
    chip?.remove(); chip = null;
    methodName.hidden = method.value !== OTHER;
    if (method.value === OTHER) methodName.focus();
    syncMethodButtons();
    mark();
    updateSuggestion();
  }

  // Typed or corrected merchant: suggest its category, unless you already picked one
  function resuggest() {
    if (categoryTouched) return;
    const name = merchant.value.trim();
    const sug = suggestCategory({ merchant: name, merchantKey: merchantKey(name), direction: dir, raw: tx.raw_sms || '' },
                                ctx.rules, ctx.categories);
    if (!sug.category) return;
    category.set(sug.category.id);
    d.suggestedCategoryId = sug.category.id;
    mark();
  }

  // "Last time: Groceries · SBI Credit Card · #veg  [Apply]" when this merchant was saved before
  function updateSuggestion() {
    const key = merchantKey(merchant.value.trim());
    let last = key ? ctx.history.lastByMerchant.get(key) : null;
    if (last && last.id === tx.id) last = null;
    if (last) last = {                       // leave out a category or method that has since been deleted or archived
      ...last,
      category_id: ctx.categories.some(c => c.id === last.category_id) ? last.category_id : null,
      payment_method_id: ctx.methods.some(m => m.id === last.payment_method_id) ? last.payment_method_id : null,
    };
    suggestion = lastTimeSuggestion(last, { category_id: category.value, payment_method_id: selectedMethodId(), tags: tags.get() });
    const parts = suggestion && [ctx.categories.find(c => c.id === suggestion.category_id)?.name,
                                 ctx.methods.find(m => m.id === suggestion.payment_method_id)?.name,
                                 ...suggestion.tags.map(t => '#' + t)].filter(Boolean);
    suggest.hidden = !parts?.length;
    if (suggest.hidden) { stripKey = ''; return; }
    // Redrawing while a tap is in flight (the merchant box losing focus does that) would swallow the tap
    if (parts.join(' · ') === stripKey) return;
    stripKey = parts.join(' · ');
    mount(suggest,
      h('span', {}, h('strong', {}, 'Last time: '), stripKey),
      h('button', { type: 'button', class: 'mini', onmousedown: e => e.preventDefault(), onclick: apply }, 'Apply'));
  }

  function apply() {
    const s = suggestion;
    if (!s) return;
    if (s.category_id && s.category_id !== category.value) { category.set(s.category_id); categoryTouched = true; stamp(categoryFieldEl); }
    if (s.payment_method_id && s.payment_method_id !== selectedMethodId()) {
      method.value = s.payment_method_id;
      methodName.hidden = true;
      chip?.remove(); chip = null;
      stamp(methodField);
    }
    const key = list => list.map(t => t.toLowerCase()).sort().join('|');
    if (s.tags.length && key(s.tags) !== key(tags.get())) { tags.set(s.tags); stamp(tagsFieldEl); }
    syncMethodButtons();
    mark();
    updateSuggestion();
  }

  async function afterMethodChange(id) {
    await loadContext();
    chip?.remove(); chip = null;
    methodName.hidden = true;
    method.value = '';
    tx.payment_method_id = id;
    drafts.forEach(c => c !== self && c.refresh());
    refresh();
  }

  async function newMethod() {
    const seed = chip && d.newMethod ? { ...d.newMethod, keywords: [] } : {};   // start from the card the SMS named
    const row = await editMethod(seed);
    if (row) await afterMethodChange(row.id);
  }

  async function editSelected() {
    const m = ctx.methods.find(x => x.id === method.value);
    if (!m) return;
    const row = await editMethod(m);
    if (row) await afterMethodChange(row.id);
  }

  async function saveNewMethod() {
    const m = await saveRow('payment_methods', { ...d.newMethod, keywords: [] });
    toast(`Saved ${m.name}`);
    await afterMethodChange(m.id);
  }

  async function save(fromSaveAll = false) {
    const amt = Number(amount.value.replace(/[,₹\s]/g, ''));
    if (!(amt > 0)) { if (!fromSaveAll) { amount.focus(); toast('Enter the amount'); } return false; }
    const own = await owner();
    const name = merchant.value.trim() || null;
    const methodId = method.value === OTHER ? await methodByName(methodName.value) : selectedMethodId();
    const row = {
      ...tx,
      amount: Math.round(amt * 100) / 100, direction: dir, occurred_on: date.value || today(),
      merchant: name, merchant_key: merchantKey(name),
      payment_method_id: methodId, category_id: category.value || null,
      notes: notes.value.trim() || null,
      tags: tags.get(),
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

// A payment method typed by name: reuse the one with that name, or create it (Cash -> cash, anything else -> wallet)
async function methodByName(name) {
  name = name.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  const hit = (await liveRows('payment_methods')).find(m => m.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const m = await saveRow('payment_methods', { name, type: /cash/i.test(name) ? 'cash' : 'wallet' });
  await loadContext();
  drafts.forEach(c => c.refresh());
  return m.id;
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
