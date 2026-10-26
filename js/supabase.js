// supabase.js: the sync connection and email-code login.
// The project URL and key are typed into Settings on each device and kept only in this
// browser's localStorage: never in the repo, never in IndexedDB, exports or sync.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

const CONFIG_KEY = 'supabaseConnection';

export function getConnection() {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    return c?.url && c?.key ? c : null;
  } catch { return null; }
}

// Until a connection is saved the app runs local-only: everything works, nothing syncs
const conn = getConnection();
export const configured = !!conn;

export const supabase = conn
  ? createClient(conn.url, conn.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  : null;

// The browser may hold only the public key. A secret / service_role key bypasses
// Row Level Security, so it is refused outright.
export function checkConnection(url, key) {
  url = url.trim().replace(/\/+$/, '');
  key = key.trim();
  let u;
  try { u = new URL(url); } catch { throw new Error('The project URL is not a valid URL'); }
  if (u.protocol !== 'https:') throw new Error('The project URL must start with https://');
  if (u.pathname !== '/' || u.search) throw new Error('Use just the project URL, e.g. https://abcd1234.supabase.co');
  if (!key) throw new Error('Enter the anon / publishable key');
  if (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role')
    throw new Error('That is a secret (service_role) key. Use the anon / publishable key: the secret key must never be in an app');
  return { url: u.origin, key };
}

function jwtRole(key) {
  try { return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role; } catch { return null; }
}

// Asks the project's auth server whether this URL + key pair is valid
export async function testConnection({ url, key }) {
  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
  if (res.status === 401 || res.status === 403) throw new Error('The project rejected this key');
  if (!res.ok) throw new Error(`The project answered ${res.status}: check the URL`);
}

export function saveConnection(c) { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); }
export function forgetConnection() { localStorage.removeItem(CONFIG_KEY); }

// Email one-time code: works the same in the browser tab and the installed app
export async function sendCode(email) {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyCode(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  return data.session;
}

export const signOut = () => supabase?.auth.signOut();

export async function currentUser() {
  if (!configured) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

// Prefix for stableId(): the account id, or 'local' while signed out
export async function owner() {
  return (await currentUser())?.id ?? 'local';
}
