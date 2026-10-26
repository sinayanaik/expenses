import { startAutoSync } from './sync.js';
import { owner } from './supabase.js';
import { ensureSeed } from './seed.js';
import { showAdd, parseIntoDrafts } from './ui/add.js';
import { showList } from './ui/list.js';
import { showStats } from './ui/stats.js';
import { showSettings } from './ui/settings.js';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

const VIEWS = { add: showAdd, list: showList, stats: showStats, settings: showSettings };
let current = null;

function go(view) {
  current = view;
  for (const v of Object.keys(VIEWS)) {
    document.getElementById(`view-${v}`).hidden = v !== view;
    document.querySelector(`nav [data-view="${v}"]`).toggleAttribute('aria-current', v === view);
  }
  scrollTo(0, 0);
  return VIEWS[view]();
}
document.querySelectorAll('nav [data-view]').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
document.getElementById('sync-pill').addEventListener('click', () => go('settings'));

await ensureSeed(await owner());             // starter categories + your first card, once per device

// Opened from the Android share sheet: ./?text=Rs.1,002.00 spent on...
const params = new URLSearchParams(location.search);
const shared = params.get('text') || params.get('title');
await go('add');
if (shared) { parseIntoDrafts(shared); history.replaceState(null, '', './'); }

// Laptop: Ctrl+V anywhere on the Add screen parses immediately
document.addEventListener('paste', e => {
  if (e.target.closest?.('input, textarea, dialog') || current !== 'add') return;
  parseIntoDrafts(e.clipboardData.getData('text'));
});

// Your edits from a dialog, or rows pulled from your other device: redraw the open screen
addEventListener('data-changed', () => ['list', 'stats'].includes(current) && VIEWS[current]());
addEventListener('data-pulled', () => current !== 'settings' && VIEWS[current]());

const pill = document.getElementById('sync-pill');
addEventListener('sync-status', ({ detail: r }) => {
  const [label, cls] = {
    ok: ['Synced', 'ok'], offline: ['Offline', 'warn'], 'signed-out': ['Sign in to sync', 'idle'],
    'not-configured': ['Local only', 'idle'], error: ['Sync error', 'err'],
  }[r.status] || ['…', 'idle'];
  pill.textContent = label;
  pill.className = `pill ${cls}`;
  pill.title = r.message || label;
});

startAutoSync();
