// supabase.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Until config.js is filled in the app runs local-only: everything works, nothing syncs
export const configured = !SUPABASE_URL.includes('YOUR-PROJECT-REF') && !SUPABASE_KEY.startsWith('YOUR-');

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

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

export const signOut = () => supabase.auth.signOut();

export async function currentUser() {
  if (!configured) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

// Prefix for stableId(): the account id, or 'local' while signed out
export async function owner() {
  return (await currentUser())?.id ?? 'local';
}
