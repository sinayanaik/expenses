// Tiny helpers shared by the screens

// h('button', { class: 'primary', onclick: save }, 'Save')
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false || k === 'value') continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;   // checked, selected, disabled…
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  if (attrs?.value != null) el.value = attrs.value;          // after children, so a <select> has its options
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// Replace an element's content; children are flattened and empty ones skipped, as in h()
export const mount = (el, ...children) =>
  el.replaceChildren(...children.flat(Infinity).filter(c => c != null && c !== false));

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = n => '₹' + inr.format(Number(n) || 0);

export const today = () => new Date().toLocaleDateString('en-CA');   // local YYYY-MM-DD

export const monthKey = (d = today()) => d.slice(0, 7);              // '2026-10'

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const monthLabel = month =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export const dayLabel = date =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

export function toast(message, ms = 2500) {
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

// Save a string as a file the user downloads
export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A modal form. fields: [{ name, label, type: 'text'|'select'|'checkbox', options: [[value, label]] }]
// Resolves to the entered values, or null when cancelled.
export function formDialog(title, fields, values = {}) {
  return new Promise(resolve => {
    const inputs = {};
    const form = h('form', { method: 'dialog', class: 'form' },
      h('h3', {}, title),
      fields.map(f => {
        let input;
        if (f.type === 'select') {
          input = h('select', { name: f.name },
            f.options.map(([v, l]) => h('option', { value: v, selected: String(values[f.name] ?? '') === String(v) }, l)));
        } else if (f.type === 'checkbox') {
          input = h('input', { type: 'checkbox', name: f.name, checked: !!values[f.name] });
        } else {
          input = h('input', { type: 'text', name: f.name, value: values[f.name] ?? '', placeholder: f.placeholder,
                               required: f.required, inputmode: f.inputmode, maxlength: f.maxlength, pattern: f.pattern });
        }
        inputs[f.name] = input;
        return f.type === 'checkbox'
          ? h('label', { class: 'check' }, input, ' ', f.label)
          : h('label', {}, h('span', {}, f.label), input);
      }),
      h('div', { class: 'actions' },
        h('button', { type: 'button', onclick: () => dlg.close('cancel') }, 'Cancel'),
        h('button', { type: 'submit', class: 'primary', value: 'ok' }, 'Save')));
    const dlg = h('dialog', {}, form);
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (dlg.returnValue !== 'ok') return resolve(null);
      resolve(Object.fromEntries(Object.entries(inputs).map(([k, el]) =>
        [k, el.type === 'checkbox' ? el.checked : el.value.trim()])));
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}
