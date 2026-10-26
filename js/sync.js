import { db, TABLES, LOCAL_ONLY, setMeta } from './db.js';
import { supabase, configured } from './supabase.js';
import { adoptLocalRows } from './seed.js';

const PAGE = 1000;
let running = null, timer = null;

export function queueSync(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export function syncNow() {
  running ??= doSync()
    .catch(err => ({ status: 'error', message: err.message }))
    .then(r => { dispatchEvent(new CustomEvent('sync-status', { detail: r })); return r; })
    .finally(() => { running = null; });
  return running;
}

async function doSync() {
  if (!configured) return { status: 'not-configured' };
  if (!navigator.onLine) return { status: 'offline' };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { status: 'signed-out' };
  await adoptLocalRows(session.user.id);     // rows made before the first sign-in
  const failed = [];
  for (const t of TABLES) failed.push(...await push(t));
  let pulled = 0;
  for (const t of TABLES) pulled += await pull(t);
  if (pulled) dispatchEvent(new Event('data-pulled'));   // screens re-render with the other device's edits
  await setMeta('lastSyncAt', new Date().toISOString());
  if (failed.length) return { status: 'error', message: `${failed.length} item(s) could not be synced: ${failed[0]}` };
  return { status: 'ok' };
}

const toServer = r => Object.fromEntries(Object.entries(r).filter(([k]) => !LOCAL_ONLY.includes(k)));

async function push(table) {
  const rows = await db[table].where('dirty').equals(1).toArray();
  const failed = [];
  // Untouched starter rows are inserted only if missing, so they never overwrite an edit made elsewhere
  for (const [list, opts] of [
    [rows.filter(r => r.seed), { ignoreDuplicates: true }],
    [rows.filter(r => !r.seed), { defaultToNull: false }],
  ]) {
    for (let i = 0; i < list.length; i += 200) {
      const batch = list.slice(i, i + 200);
      let { error } = await supabase.from(table).upsert(batch.map(toServer), opts);
      let ok = batch;
      if (error) {                             // one bad row must not block the rest: retry one by one
        if (!error.code) throw error;          // network / auth problem, not a row problem
        ok = [];
        for (const r of batch) {
          ({ error } = await supabase.from(table).upsert([toServer(r)], opts));
          if (error) failed.push(`${table}: ${error.message}`); else ok.push(r);
        }
      }
      await markClean(table, ok);
    }
  }
  return failed;
}

async function markClean(table, batch) {
  await db.transaction('rw', db[table], async () => {
    for (const r of batch) {                   // skip rows edited again while we were pushing
      const cur = await db[table].get(r.id);
      if (cur && cur._v === r._v) await db[table].update(r.id, { dirty: 0 });
    }
  });
}

async function pull(table) {
  const key = `pulled:${table}`;
  let since = (await db.meta.get(key))?.value ?? '1970-01-01T00:00:00Z', count = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select('*')
      .gt('updated_at', since).order('updated_at').limit(PAGE);
    if (error) throw error;
    if (!data.length) break;
    count += data.length;
    await db.transaction('rw', db[table], db.meta, async () => {
      for (const row of data) {
        const local = await db[table].get(row.id);
        if (local?.dirty) continue;            // unpushed local edit wins; it goes up next sync
        await db[table].put({ ...row, dirty: 0, _v: local?._v ?? 0 });
      }
      since = data.at(-1).updated_at;
      await db.meta.put({ key, value: since });
    });
    if (data.length < PAGE) break;
  }
  return count;
}

// When to sync: after edits, on reconnect, when the app comes to the front, every 5 min
export function startAutoSync() {
  addEventListener('data-changed', () => queueSync());
  addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());
  setInterval(() => document.visibilityState === 'visible' && syncNow(), 5 * 60 * 1000);
  supabase.auth.onAuthStateChange(evt => evt === 'SIGNED_IN' && syncNow());
  syncNow();
}
