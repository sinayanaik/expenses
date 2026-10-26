// Checks for js/history.js, in the same result shape as tests/check.js so one runner shows both.
import { buildHistory, rankCategories, normTag, addTag, topTags, lastTimeSuggestion } from '../js/history.js';

const cats = [
  ['c-groc', 'Groceries', 'expense', 0], ['c-food', 'Food & dining', 'expense', 1], ['c-shop', 'Shopping', 'expense', 2],
  ['c-fuel', 'Fuel', 'expense', 3], ['c-rent', 'Rent', 'expense', 4], ['c-sal', 'Salary', 'income', 5], ['c-xfer', 'Transfers', 'transfer', 6],
  ['c-gone', 'Old one', 'expense', 7],
].map(([id, name, kind, sort_order]) => ({ id, name, kind, sort_order, deleted_at: id === 'c-gone' ? '2026-01-01' : null }));

const tx = (id, merchant_key, category_id, date, tags = [], extra = {}) =>
  ({ id, merchant_key, category_id, occurred_on: date, tags, payment_method_id: 'pm-sbi', created_at: date + 'T10:00:00Z', ...extra });

const txs = [
  tx(1, 'zepto', 'c-groc', '2026-10-01', ['veg']),
  tx(2, 'zepto', 'c-groc', '2026-10-20', ['Veg', 'weekly']),
  tx(3, 'zepto', 'c-food', '2026-10-20', ['party'], { created_at: '2026-10-20T18:00:00Z' }),   // same day, created later
  tx(4, 'swiggy', 'c-food', '2026-10-05'),
  tx(5, 'uber', 'c-groc', '2026-10-06', [], { deleted_at: '2026-10-07' }),                       // deleted: ignored
  tx(6, null, null, '2026-10-08'),
];
const h = buildHistory(txs);

const cases = [
  ['normTag strips #, commas and extra spaces', normTag('  ##Eating   out, '), 'Eating out'],
  ['addTag ignores a case-insensitive duplicate', addTag(['Veg'], '#veg'), ['Veg']],
  ['addTag ignores empty', addTag(['a'], ' # '), ['a']],
  ['addTag appends a new tag', addTag(['a'], 'b'), ['a', 'b']],
  ['catUse counts live entries only', [h.catUse.get('c-groc'), h.catUse.get('c-food')], [2, 2]],
  ['tagUse merges case variants', h.tagUse.get('veg').n, 2],
  ['topTags most used first', topTags(h.tagUse, 2), ['veg', 'party']],
  ['lastByMerchant: newest by date, then created_at', h.lastByMerchant.get('zepto').id, 3],
  ['lastByMerchant skips deleted entries', h.lastByMerchant.has('uber'), false],
  ['rank (no query): Most used first, deleted category hidden',
    rankCategories(cats, h.catUse).groups.map(g => [g.label, g.items.map(c => c.name)]),
    [['Most used', ['Food & dining', 'Groceries']],
     ['Expense', ['Shopping', 'Fuel', 'Rent']], ['Income', ['Salary']], ['Transfer', ['Transfers']]]],
  ['rank (query): prefix matches first, then other matches', rankCategories(cats, h.catUse, 'f').groups[0].items.map(c => c.name), ['Food & dining', 'Fuel', 'Transfers']],
  ['rank (query): exact match reported case-insensitively', rankCategories(cats, h.catUse, ' fuel ').exact?.id, 'c-fuel'],
  ['rank (query): no exact match for a new name', rankCategories(cats, h.catUse, 'Pets').exact, null],
  ['rank (query): no hits gives no groups', rankCategories(cats, h.catUse, 'zzz').groups, []],
  ['suggestion: nothing for an unseen merchant', lastTimeSuggestion(undefined, {}), null],
  ['suggestion: offered when category differs',
    lastTimeSuggestion(h.lastByMerchant.get('zepto'), { category_id: 'c-groc', payment_method_id: 'pm-sbi', tags: ['party'] }) !== null, true],
  ['suggestion: hidden when nothing would change',
    lastTimeSuggestion(h.lastByMerchant.get('zepto'), { category_id: 'c-food', payment_method_id: 'pm-sbi', tags: ['PARTY'] }), null],
  ['suggestion: offered when tags differ',
    lastTimeSuggestion(h.lastByMerchant.get('zepto'), { category_id: 'c-food', payment_method_id: 'pm-sbi', tags: [] })?.tags, ['party']],
];

export function historyResults() {
  return cases.map(([name, got, expected]) => {
    const pass = JSON.stringify(got) === JSON.stringify(expected);
    return { name: `history: ${name}`, sms: '', got: { value: got }, diffs: pass ? [] : [{ field: 'value', expected, got }], pass };
  });
}
