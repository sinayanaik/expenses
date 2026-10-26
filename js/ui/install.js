// Installing the app is what puts it in Android's share sheet (manifest share_target),
// so SMS can be shared from Messages straight into the Add screen.
import { h, mount } from './dom.js';

let prompt = null;                           // Chrome's deferred install prompt
const slots = new Set();

addEventListener('beforeinstallprompt', e => { e.preventDefault(); prompt = e; repaint(); });
addEventListener('appinstalled', () => { prompt = null; repaint(); });

export const isInstalled = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

function dismissed() {
  try { return localStorage.getItem('installHintDismissed') === '1'; } catch { return false; }
}

// compact: the Add screen's hint, shown only while Chrome offers to install
export function installCard({ compact = false } = {}) {
  const el = h('section', { class: 'card install' });
  el.compact = compact;
  slots.add(el);
  paint(el);
  return el;
}

function repaint() {
  for (const el of slots) el.isConnected ? paint(el) : slots.delete(el);
}

async function install() {
  if (!prompt) return;
  prompt.prompt();
  await prompt.userChoice;
  prompt = null;
  repaint();
}

function paint(el) {
  if (el.compact) {
    el.hidden = isInstalled() || !prompt || dismissed();
    if (el.hidden) return mount(el);
    return mount(el,
      h('p', {}, h('strong', {}, 'Share SMS straight into the app. '),
        'Install it, then in Messages long-press an SMS → Share → Expenses.'),
      h('div', { class: 'actions' },
        h('button', { onclick: () => { try { localStorage.setItem('installHintDismissed', '1'); } catch {} paint(el); } }, 'Not now'),
        h('button', { class: 'primary', onclick: install }, 'Install app')));
  }

  const steps = isInstalled()
    ? isIOS
      ? ['Installed. iPhone does not let web apps receive shares: copy the SMS, then tap Paste from clipboard.']
      : ['Installed. In Messages, long-press an SMS → Share → Expenses. It opens here as a draft, ready to save.']
    : isIOS
      ? ['Safari → Share → Add to Home Screen.',
         'iPhone does not let web apps receive shares, so there you copy the SMS and tap Paste from clipboard.']
      : prompt
        ? ['Install the app and it appears in the share sheet: long-press an SMS in Messages → Share → Expenses.']
        : ['Open this site in Chrome on your Android phone and choose ⋮ → Install app (or Add to Home screen).',
           'Once installed, long-press an SMS in Messages → Share → Expenses.'];
  mount(el,
    h('h3', {}, 'Install & share'),
    steps.map(s => h('p', { class: 'muted' }, s)),
    !isInstalled() && prompt && h('button', { class: 'primary', onclick: install }, 'Install app'));
}
