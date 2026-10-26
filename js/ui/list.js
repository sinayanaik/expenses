// List screen: one month at a time, grouped by day, with search and filters.
// Tap a row to edit it, long-press (or right-click) to delete it.
import { db, live, liveRows, softDelete } from '../db.js';
import { openEditor } from './add.js';
import { h, $, mount, money, monthKey, shiftMonth, monthLabel, dayLabel, toast } from './dom.js';

const state = { month: monthKey(), q: '', category: '', method: '', direction: '' };

export async function monthRows(month) {
  return live(await db.transactions.where('occurred_on').between(`${month}-01`, `${month}-31`, true, true).toArray());
}

export async function showList() {
  const root = $('#view-list');
  const [rows, categories, methods] = await Promise.all([
    monthRows(state.month), liveRows('categories'), liveRows('payment_methods')]);
  const cat = new Map(categories.map(c => [c.id, c]));
  const pm = new Map(methods.map(m => [m.id, m]));

  const q = state.q.toLowerCase();
  const shown = rows
    .filter(t => !state.category || t.category_id === state.category)
    .filter(t => !state.method || t.payment_method_id === state.method)
    .filter(t => !state.direction || t.direction === state.direction)
    .filter(t => !q || [t.merchant, t.notes, cat.get(t.category_id)?.name, pm.get(t.payment_method_id)?.name, ...(t.tags || [])]
      .some(s => s && s.toLowerCase().includes(q)))
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || (b.created_at || '').localeCompare(a.created_at || ''));

  const spent = sum(shown.filter(t => t.direction === 'debit'));
  const received = sum(shown.filter(t => t.direction === 'credit'));
  const days = Object.groupBy(shown, t => t.occurred_on);

  const set = (k, v) => { state[k] = v; showList(); };
  const select = (key, items, blank) => h('select', { class: 'chip-select', onchange: e => set(key, e.target.value) },
    h('option', { value: '' }, blank),
    items.map(i => h('option', { value: i.id, selected: state[key] === i.id }, i.name)));

  const search = h('input', { type: 'search', placeholder: 'Search merchant, notes, tags', value: state.q,
                              oninput: e => { state.q = e.target.value; clearTimeout(search.t); search.t = setTimeout(showList, 250); } });

  mount(root,
    h('div', { class: 'month-bar' },
      h('button', { 'aria-label': 'Previous month', onclick: () => set('month', shiftMonth(state.month, -1)) }, '‹'),
      h('strong', {}, monthLabel(state.month)),
      h('button', { 'aria-label': 'Next month', onclick: () => set('month', shiftMonth(state.month, 1)) }, '›')),
    search,
    h('div', { class: 'chips' },
      select('category', categories.sort((a, b) => a.name.localeCompare(b.name)), 'All categories'),
      select('method', methods.filter(m => !m.archived), 'All methods'),
      ['', 'debit', 'credit'].map(v => h('button', { class: `chip ${state.direction === v ? 'on' : ''}`, onclick: () => set('direction', v) },
        { '': 'All', debit: 'Debit', credit: 'Credit' }[v]))),
    h('p', { class: 'summary' }, `Spent ${money(spent)} · Received ${money(received)} · ${shown.length} entries`),
    shown.length ? null : h('p', { class: 'empty' }, rows.length ? 'Nothing matches these filters.' : 'No entries this month yet.'),
    Object.entries(days).map(([day, txs]) => h('section', { class: 'day' },
      h('div', { class: 'day-head' }, h('span', {}, dayLabel(day)),
        h('span', {}, money(sum(txs.filter(t => t.direction === 'debit'))))),
      txs.map(t => row(t, cat.get(t.category_id), pm.get(t.payment_method_id))))));

  if (state.q) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
}

function row(t, c, m) {
  let timer = null, longPressed = false;
  const del = async () => {
    if (!confirm(`Delete ${money(t.amount)}${t.merchant ? ' at ' + t.merchant : ''}?`)) return;
    await softDelete('transactions', t.id);
    toast('Deleted');
  };
  return h('button', {
    class: `tx ${t.direction}`,
    onpointerdown: () => { longPressed = false; timer = setTimeout(() => { longPressed = true; del(); }, 550); },
    onpointerup: () => clearTimeout(timer),
    onpointerleave: () => clearTimeout(timer),
    onpointercancel: () => clearTimeout(timer),
    oncontextmenu: e => { e.preventDefault(); clearTimeout(timer); if (!longPressed) del(); },
    onclick: () => { if (!longPressed) openEditor(t); },
  },
    h('span', { class: 'tx-main' },
      h('span', { class: 'tx-title' }, t.merchant || c?.name || 'Entry'),
      h('span', { class: 'tx-sub' }, [c?.name || 'Uncategorised', m?.name].filter(Boolean).join(' · '))),
    h('span', { class: 'tx-amt' }, (t.direction === 'credit' ? '+' : '') + money(t.amount)));
}

const sum = rows => rows.reduce((s, t) => s + Number(t.amount || 0), 0);
