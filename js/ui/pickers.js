// Controls shared by the draft card and Settings: the category search sheet, the tag input
// and the payment-method form.
import { saveRow, liveRows } from '../db.js';
import { rankCategories, normTag, addTag, topTags } from '../history.js';
import { h, mount, formDialog } from './dom.js';

export const TYPES = [['credit_card', 'Credit card'], ['debit_card', 'Debit card'], ['bank_account', 'Bank account'],
                      ['upi', 'UPI'], ['wallet', 'Wallet'], ['cash', 'Cash']];

// ---- Category ----------------------------------------------------------------

// Opens the search sheet. Resolves to the chosen (or newly added) category row,
// null when closed without choosing, or { id: '' } for "No category".
export function pickCategory({ categories, catUse, current, kind = 'expense' }) {
  return new Promise(resolve => {
    let result = null;
    const search = h('input', { type: 'search', placeholder: 'Search or add a category', autocomplete: 'off',
                                enterkeyhint: 'go', 'aria-label': 'Search categories' });
    const list = h('div', { class: 'opts', role: 'listbox' });
    const done = value => { result = value; dlg.close(); };

    const add = async name => {
      name = name.trim().replace(/\s+/g, ' ');
      if (!name) return;
      done(await saveRow('categories', { name, kind, sort_order: categories.length }));
    };

    function paint() {
      const q = search.value;
      const { groups, exact } = rankCategories(categories, catUse, q);
      const opt = c => h('button', { type: 'button', class: `opt ${c.id === current ? 'on' : ''}`, role: 'option',
                                     'aria-selected': c.id === current, onclick: () => done(c) },
        h('span', {}, c.name), catUse.get(c.id) ? h('small', {}, `${catUse.get(c.id)}×`) : null);
      mount(list,
        !q.trim() && current && h('button', { type: 'button', class: 'opt none', onclick: () => done({ id: '' }) }, 'No category'),
        groups.map(g => [g.label && h('div', { class: 'opt-group' }, g.label), g.items.map(opt)]),
        q.trim() && !exact && h('button', { type: 'button', class: 'opt add', onclick: () => add(q) }, `+ Add “${q.trim().replace(/\s+/g, ' ')}”`));
    }

    search.addEventListener('input', paint);
    search.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const { groups, exact } = rankCategories(categories, catUse, search.value);
      const hits = groups.flatMap(g => g.items);
      if (exact) done(exact);
      else if (hits.length === 1 && search.value.trim()) done(hits[0]);
      else if (search.value.trim()) add(search.value);
    });

    const dlg = h('dialog', { class: 'sheet' },
      h('div', { class: 'sheet-head' },
        h('h3', {}, 'Category'),
        h('button', { type: 'button', onclick: () => dlg.close(), 'aria-label': 'Close' }, '✕')),
      search, list);
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    paint();
    dlg.showModal();
    search.focus();
  });
}

// A button that shows the chosen category and opens the sheet. `.value` is the category id.
// ctx() supplies { categories, catUse, kind } when the sheet opens.
export function categoryField({ ctx, onPick, onChange }) {
  const el = h('button', { type: 'button', class: 'picker', 'aria-haspopup': 'dialog' });
  const field = {
    el,
    value: '',
    paint() {
      const c = ctx().categories.find(x => x.id === field.value && !x.deleted_at);
      if (!c) field.value = '';
      el.textContent = c ? c.name : '— Category —';
      el.classList.toggle('empty', !c);
    },
    set(id) { field.value = id || ''; field.paint(); },
  };
  el.addEventListener('click', async () => {
    const c = await pickCategory({ ...ctx(), current: field.value });
    if (!c) return;
    await onPick?.(c);                        // e.g. reload the category list so a new one is known
    field.set(c.id);
    onChange?.(c);
  });
  return field;
}

// ---- Tags ----------------------------------------------------------------------

// Chips for the chosen tags, a text box (Enter or comma adds) with autocomplete from earlier tags,
// and a row of your most-used tags to tap. tagUse() returns the Map from buildHistory().
export function tagInput({ initial = [], tagUse, onChange }) {
  let tags = initial.map(normTag).filter(Boolean);
  const listId = `tags-${crypto.randomUUID().slice(0, 8)}`;
  const chips = h('div', { class: 'tag-chips' });
  const input = h('input', { type: 'text', list: listId, placeholder: 'Add a tag', enterkeyhint: 'done',
                             autocomplete: 'off', autocapitalize: 'none', 'aria-label': 'Add a tag' });
  const options = h('datalist', { id: listId });
  const suggest = h('div', { class: 'tag-suggest' });
  const el = h('div', { class: 'tags' }, chips, input, suggest, options);

  function paint() {
    const use = tagUse();
    mount(chips, tags.map(t => h('span', { class: 'tag' }, '#' + t,
      h('button', { type: 'button', 'aria-label': `Remove ${t}`, onclick: () => { tags = tags.filter(x => x !== t); paint(); onChange?.(); } }, '×'))));
    const top = topTags(use, 12).filter(t => !tags.some(x => x.toLowerCase() === t.toLowerCase())).slice(0, 6);
    mount(suggest, top.map(t => h('button', { type: 'button', class: 'chip', onclick: () => push(t) }, '#' + t)));
    mount(options, topTags(use, 50).map(t => h('option', { value: t })));
  }

  function push(text) {
    const next = addTag(tags, text);
    input.value = '';
    if (next !== tags) { tags = next; paint(); onChange?.(); }
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); push(input.value); }
    else if (e.key === 'Backspace' && !input.value && tags.length) { tags = tags.slice(0, -1); paint(); onChange?.(); }
  });
  input.addEventListener('input', e => {
    if (input.value.includes(',')) push(input.value);
    else if (e.inputType === 'insertReplacementText' || (!e.inputType && input.value)) push(input.value);   // picked from the autocomplete list
  });
  input.addEventListener('blur', () => push(input.value));

  paint();
  return {
    el,
    get() { return addTag(tags, input.value); },          // includes a tag typed but not yet confirmed
    set(list) { tags = list.map(normTag).filter(Boolean); input.value = ''; paint(); },
    paint,
  };
}

// ---- Payment method form ---------------------------------------------------------

// Add (no argument) or edit a payment method. Resolves to the saved row, or null when cancelled.
export async function editMethod(m = {}) {
  const v = await formDialog(m.id ? 'Edit payment method' : 'New payment method', [
    { name: 'name', label: 'Name', required: true, placeholder: 'SBI Credit Card' },
    { name: 'type', label: 'Type', type: 'select', options: TYPES },
    { name: 'bank', label: 'Bank (as the parser names it)', placeholder: 'SBI, HDFC, ICICI, Axis…' },
    { name: 'last4', label: 'Last 4 digits', inputmode: 'numeric', maxlength: 4, pattern: '\\d{4}' },
    { name: 'keywords', label: 'Extra keywords in its SMS (comma separated)', placeholder: 'sbicard' },
    { name: 'is_default', label: 'Default for manual entries', type: 'checkbox' },
    { name: 'archived', label: 'Archived (hidden from pickers)', type: 'checkbox' },
  ], { type: 'credit_card', ...m, keywords: (m.keywords || []).join(', ') });
  if (!v) return null;
  const row = await saveRow('payment_methods', { ...m, ...v, bank: v.bank || null, last4: v.last4 || null,
    keywords: v.keywords.split(',').map(k => k.trim()).filter(Boolean) });
  if (row.is_default) {                       // only one default
    for (const o of await liveRows('payment_methods'))
      if (o.id !== row.id && o.is_default) await saveRow('payment_methods', { id: o.id, is_default: false });
  }
  return row;
}
