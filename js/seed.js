import { db, TABLES, saveStable, stableId, getMeta, setMeta } from './db.js';

export const STARTER_CATEGORIES = [
  ['Groceries', 'expense'], ['Food & dining', 'expense'], ['Shopping', 'expense'], ['Transport', 'expense'],
  ['Fuel', 'expense'], ['Rent', 'expense'], ['Bills & utilities', 'expense'], ['Subscriptions', 'expense'],
  ['Entertainment', 'expense'], ['Health', 'expense'], ['Travel', 'expense'], ['Education', 'expense'],
  ['Personal care', 'expense'], ['Gifts', 'expense'], ['Transfers', 'transfer'],
  ['Salary', 'income'], ['Refunds', 'income'],
];

const STARTER_METHODS = [
  [':pm:sbi-cc-1046', { name: 'SBI Credit Card', type: 'credit_card', bank: 'SBI', last4: '1046', is_default: true }],
];

// Starter categories and payment method, only when this device has none yet.
// Their ids are stableId(owner + ':cat:<name>'), so every device makes the same rows,
// and `seed: 1` makes sync insert them only where the server does not have them yet.
export async function ensureSeed(owner) {
  if (await db.categories.count()) return;
  for (const [i, [name, kind]] of STARTER_CATEGORIES.entries())
    await saveStable('categories', owner, `:cat:${name}`, { name, kind, sort_order: i, seed: 1 });
  for (const [key, row] of STARTER_METHODS)
    await saveStable('payment_methods', owner, key, { ...row, seed: 1 });
}

// First sign-in after using the app signed out: rows with stable ids made for
// 'local' get the ids they would have had for this account, and every reference
// to them follows. Rows with random ids need nothing, they are unique already.
export async function adoptLocalRows(uid) {
  if (!(await getMeta('hasLocalRows'))) return;
  const idMap = new Map();                   // computed first: crypto.subtle can't run inside a Dexie transaction
  for (const t of TABLES) {
    for (const r of await db[t].toArray()) {
      if (r.stable_key && r.id === await stableId('local' + r.stable_key))
        idMap.set(r.id, await stableId(uid + r.stable_key));
    }
  }
  const remap = id => idMap.get(id) ?? id;
  await db.transaction('rw', TABLES.map(t => db[t]), async () => {
    for (const t of TABLES) {
      for (const r of await db[t].toArray()) {
        const next = { ...r, id: remap(r.id) };
        for (const f of ['category_id', 'payment_method_id', 'parent_id']) if (r[f]) next[f] = remap(r[f]);
        if (['id', 'category_id', 'payment_method_id', 'parent_id'].every(f => next[f] === r[f])) continue;
        if (next.id !== r.id) await db[t].delete(r.id);
        await db[t].put({ ...next, dirty: 1 });
      }
    }
  });
  await setMeta('hasLocalRows', false);
}
