// What earlier entries tell us: most-used categories and tags, and the last entry per merchant.
// Pure functions, no DOM or database, so tests/history-check.js can run them in Node.

const KIND_LABEL = { expense: 'Expense', income: 'Income', transfer: 'Transfer' };
const MOST_USED = 6;

const live = rows => rows.filter(r => !r.deleted_at);
const byName = (a, b) => a.name.localeCompare(b.name);

export const normTag = s => String(s ?? '').replace(/[,]/g, ' ').trim().replace(/^#+/, '').trim().replace(/\s+/g, ' ');

// Adds a tag unless it is empty or already there (case-insensitive)
export function addTag(list, tag) {
  const t = normTag(tag);
  if (!t || list.some(x => x.toLowerCase() === t.toLowerCase())) return list;
  return [...list, t];
}

// One pass over the entries.
//   catUse: category id -> times used
//   tagUse: lower-case tag -> { tag, n }
//   lastByMerchant: merchant_key -> the newest entry for it (by date, then when it was created)
export function buildHistory(txs) {
  const catUse = new Map(), tagUse = new Map(), lastByMerchant = new Map();
  for (const t of live(txs)) {
    if (t.category_id) catUse.set(t.category_id, (catUse.get(t.category_id) || 0) + 1);
    for (const raw of t.tags || []) {
      const tag = normTag(raw);
      if (!tag) continue;
      const u = tagUse.get(tag.toLowerCase()) || { tag, n: 0 };
      u.n++;
      tagUse.set(tag.toLowerCase(), u);
    }
    if (t.merchant_key) {
      const prev = lastByMerchant.get(t.merchant_key);
      if (!prev || newer(t, prev)) lastByMerchant.set(t.merchant_key, t);
    }
  }
  return { catUse, tagUse, lastByMerchant };
}

const newer = (a, b) => (a.occurred_on || '') > (b.occurred_on || '')
  || ((a.occurred_on || '') === (b.occurred_on || '') && (a.created_at || '') > (b.created_at || ''));

// Most-used tags first, for the "recent tags" row and autocomplete
export const topTags = (tagUse, n = 8) =>
  [...tagUse.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)).slice(0, n).map(u => u.tag);

// What the category sheet lists.
//   no query: "Most used" first, then everything else by kind
//   query:    matches only, names that start with it first
// `exact` is the category whose name equals the query, so the sheet does not offer to add a duplicate.
export function rankCategories(categories, catUse, query = '') {
  const cats = live(categories);
  const use = c => catUse.get(c.id) || 0;
  const q = query.trim().toLowerCase();
  const exact = q ? cats.find(c => c.name.toLowerCase() === q) || null : null;

  if (q) {
    const hits = cats.filter(c => c.name.toLowerCase().includes(q))
      .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || use(b) - use(a) || byName(a, b));
    return { groups: hits.length ? [{ label: '', items: hits }] : [], exact };
  }

  const top = cats.filter(c => use(c) > 0).sort((a, b) => use(b) - use(a) || byName(a, b)).slice(0, MOST_USED);
  const topIds = new Set(top.map(c => c.id));
  const rest = cats.filter(c => !topIds.has(c.id)).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || byName(a, b));
  const groups = top.length ? [{ label: 'Most used', items: top }] : [];
  for (const kind of ['expense', 'income', 'transfer']) {
    const items = rest.filter(c => (c.kind || 'expense') === kind);
    if (items.length) groups.push({ label: KIND_LABEL[kind], items });
  }
  return { groups, exact };
}

// What "Last time: …" would change on a card. `current` is { category_id, payment_method_id, tags }.
// Returns null when there is nothing to suggest or applying it would change nothing.
export function lastTimeSuggestion(last, current) {
  if (!last) return null;
  const sug = { category_id: last.category_id || null, payment_method_id: last.payment_method_id || null, tags: last.tags || [] };
  const sameTags = (a, b) => a.length === b.length && a.every(t => b.some(u => u.toLowerCase() === t.toLowerCase()));
  const differs = (sug.category_id && sug.category_id !== (current.category_id || null))
    || (sug.payment_method_id && sug.payment_method_id !== (current.payment_method_id || null))
    || (sug.tags.length && !sameTags(sug.tags, current.tags || []));
  return differs ? sug : null;
}
