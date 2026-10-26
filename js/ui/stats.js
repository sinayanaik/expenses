// Stats screen: this month vs last, spend by category, by payment method, top merchants.
// Transfers (category kind = transfer) are not spending, so they are left out.
import { liveRows } from '../db.js';
import { monthRows } from './list.js';
import { h, $, mount, money, monthKey, shiftMonth, monthLabel } from './dom.js';

let month = monthKey();

export async function showStats() {
  const root = $('#view-stats');
  const [cur, prev, categories, methods] = await Promise.all([
    monthRows(month), monthRows(shiftMonth(month, -1)), liveRows('categories'), liveRows('payment_methods')]);
  const cat = new Map(categories.map(c => [c.id, c]));
  const pm = new Map(methods.map(m => [m.id, m]));
  const isSpend = t => t.direction === 'debit' && cat.get(t.category_id)?.kind !== 'transfer';
  const spend = cur.filter(isSpend);
  const total = sumOf(spend), last = sumOf(prev.filter(isSpend));
  const received = sumOf(cur.filter(t => t.direction === 'credit' && cat.get(t.category_id)?.kind !== 'transfer'));
  const change = last ? Math.round(((total - last) / last) * 100) : null;

  mount(root,
    h('div', { class: 'month-bar' },
      h('button', { 'aria-label': 'Previous month', onclick: () => { month = shiftMonth(month, -1); showStats(); } }, '‹'),
      h('strong', {}, monthLabel(month)),
      h('button', { 'aria-label': 'Next month', onclick: () => { month = shiftMonth(month, 1); showStats(); } }, '›')),
    h('div', { class: 'tiles' },
      tile('Spent', money(total),
        change == null ? 'No spending last month' : `${change > 0 ? '▲' : change < 0 ? '▼' : '='} ${Math.abs(change)}% vs ${money(last)} last month`,
        change > 0 ? 'up' : change < 0 ? 'down' : ''),
      tile('Received', money(received), `${cur.length} entries this month`)),
    bars('Spend by category', group(spend, t => cat.get(t.category_id)?.name || 'Uncategorised'), total),
    bars('Spend by payment method', group(spend, t => pm.get(t.payment_method_id)?.name || 'No method'), total),
    bars('Top 5 merchants', group(spend, t => t.merchant_key || t.merchant || '—', t => t.merchant).slice(0, 5), total));
}

function tile(label, value, note, cls = '') {
  return h('div', { class: 'tile' },
    h('span', { class: 'tile-label' }, label),
    h('strong', { class: 'tile-value' }, value),
    h('span', { class: `tile-note ${cls}` }, note));
}

// [{ label, amount, count }], largest amount first
function group(rows, keyOf, labelOf) {
  const m = new Map();
  for (const t of rows) {
    const k = keyOf(t);
    const g = m.get(k) || { label: labelOf?.(t) || k, amount: 0, count: 0 };
    g.amount += Number(t.amount); g.count++;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}

function bars(title, items, total) {
  return h('section', { class: 'card stat' },
    h('h3', {}, title),
    items.length ? items.map(g => h('div', { class: 'bar-row' },
      h('div', { class: 'bar-label' }, h('span', {}, g.label), h('span', {}, money(g.amount))),
      h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${total ? (g.amount / total) * 100 : 0}%` })),
      h('div', { class: 'bar-note' }, `${g.count} ${g.count === 1 ? 'entry' : 'entries'} · ${total ? Math.round((g.amount / total) * 100) : 0}%`)))
      : h('p', { class: 'empty' }, 'No spending this month.'));
}

const sumOf = rows => rows.reduce((s, t) => s + Number(t.amount || 0), 0);
