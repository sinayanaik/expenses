import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.4.7/+esm';

export const db = new Dexie('expenses');
db.version(1).stores({                       // only indexed fields are listed
  payment_methods: 'id, updated_at, dirty',
  categories:      'id, updated_at, dirty',
  merchant_rules:  'id, merchant_key, updated_at, dirty',
  transactions:    'id, occurred_on, fingerprint, category_id, payment_method_id, updated_at, dirty',
  meta:            'key',                    // sync cursors, last sync time, settings
});

// Push order matters: parents before the transactions that reference them
export const TABLES = ['payment_methods', 'categories', 'merchant_rules', 'transactions'];

// Fields that live only on this device and are never sent to Supabase:
//   dirty / _v   - sync bookkeeping
//   seed         - starter row not yet edited; pushed with "insert if missing" so it never
//                  overwrites what another device already changed
//   stable_key   - the text a stableId() was made from (':cat:Groceries'), so rows made
//                  while signed out can be re-keyed to the account on first sign-in
//   updated_at / user_id - owned by the server
export const LOCAL_ONLY = ['dirty', '_v', 'seed', 'stable_key', 'updated_at', 'user_id'];

// Every row has every column, so bulk upserts send the same keys
const TEMPLATES = {
  payment_methods: { name: '', type: 'bank_account', bank: null, last4: null, keywords: [], is_default: false, archived: false, deleted_at: null },
  categories:      { name: '', kind: 'expense', icon: null, color: null, parent_id: null, sort_order: 0, deleted_at: null },
  merchant_rules:  { merchant_key: '', category_id: null, payment_method_id: null, hits: 1, deleted_at: null },
  transactions:    { amount: 0, direction: 'debit', occurred_on: null, merchant: null, merchant_key: null,
                     payment_method_id: null, category_id: null, notes: null, tags: [], source: 'manual',
                     raw_sms: null, ref_no: null, fingerprint: null, created_at: null, deleted_at: null },
};

export async function saveRow(table, row) {
  const prev = row.id ? await db[table].get(row.id) : null;
  const full = { ...TEMPLATES[table], ...prev, ...row };
  full.id ??= crypto.randomUUID();
  full.dirty = 1;
  full._v = (prev?._v ?? 0) + 1;             // edit counter, guards the "clear dirty" step
  full.seed = row.seed && !prev ? 1 : 0;     // any edit turns a starter row into a normal one
  if (table === 'transactions') full.created_at ??= new Date().toISOString();
  await db[table].put(full);
  dispatchEvent(new Event('data-changed'));  // sync.js listens and pushes a moment later
  return full;
}

export const softDelete = (table, id) => saveRow(table, { id, deleted_at: new Date().toISOString() });

// Same text -> same UUID on every device. Use it for seeded categories
// (userId + ':cat:Groceries') and merchant rules (userId + ':rule:zepto'), so two
// devices creating the same thing offline merge instead of duplicating.
export async function stableId(text) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const x = [...h.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

// saveRow() for a row whose id comes from stableId(owner + key). Owner is the user id,
// or 'local' while signed out (adoptLocalRows() re-keys those on first sign-in).
export async function saveStable(table, owner, key, row) {
  const id = await stableId(owner + key);
  if (owner === 'local') await setMeta('hasLocalRows', true);
  return saveRow(table, { ...row, id, stable_key: key });
}

export async function getMeta(key, fallback = null) {
  return (await db.meta.get(key))?.value ?? fallback;
}

export const setMeta = (key, value) => db.meta.put({ key, value });

// Rows that are not soft-deleted
export const live = rows => rows.filter(r => !r.deleted_at);

export async function liveRows(table) {
  return live(await db[table].toArray());
}

// Rows waiting to be pushed, across all tables
export async function dirtyCount() {
  let n = 0;
  for (const t of TABLES) n += await db[t].where('dirty').equals(1).count();
  return n;
}
