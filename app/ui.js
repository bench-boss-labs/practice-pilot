/* Small UI helpers: toasts and in-app dialogs (never browser pop-ups). */
import { el } from '../vendor/bbl-kit/1.0.1/bbl-updates.js';
export { el };

/** Replace an element's children, skipping empty slots (null/false), which replaceChildren would print. */
export function fill(node, ...kids) { node.replaceChildren(...kids.flat().filter(k => k != null && k !== false)); return node; }

/** toast('Saved', { action: ['Undo', fn], error: true }) */
export function toast(text, { action, error = false, ms } = {}) {
  const host = document.getElementById('toasts');
  const t = el('div', { class: `toast${error ? ' err' : ''}`, role: error ? 'alert' : 'status' }, el('span', {}, text));
  if (action) t.append(el('button', { type: 'button', onclick: () => { t.remove(); action[1](); } }, action[0]));
  host.append(t);
  setTimeout(() => t.remove(), ms || (error ? 9000 : 5000));
  return t;
}

/**
 * dialog({ title, body, buttons: [{ label, value, kind: 'primary'|'danger'|'' }] }) → Promise<value | null>
 * Escape or the backdrop = null (the safe choice).
 */
export function dialog({ title, body, buttons, id }) {
  return new Promise(resolve => {
    const prev = document.activeElement;
    const close = v => { overlay.remove(); document.removeEventListener('keydown', onKey); prev && prev.focus && prev.focus(); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    const heading = el('h2', { class: 't-section', id: 'dlg-title' }, title);
    const box = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title', id: id || null },
      el('div', { class: 'dhead' }, heading),
      el('div', { class: 'dbody' }, body),
      el('div', { class: 'dfoot' }, buttons.map(b => el('button', {
        type: 'button', class: `btn${b.kind === 'primary' ? ' primary' : b.kind === 'danger' ? ' danger solid' : ''}`,
        'data-value': b.value, onclick: () => close(b.value),
      }, b.label))));
    const overlay = el('div', { class: 'bbl-overlay', onclick: e => { if (e.target === overlay) close(null); } }, box);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    (box.querySelector('.btn.primary') || box.querySelector('.btn')).focus();
  });
}

/** A blocking overlay with no way out except its one button (used for the two-tab rule). */
export function blocker({ title, text, button, onClick, id }) {
  const b = el('div', { class: 'bbl-overlay', id },
    el('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-t` },
      el('div', { class: 'dhead' }, el('h2', { class: 't-section', id: `${id}-t` }, title)),
      el('div', { class: 'dbody' }, el('p', { style: 'margin:0' }, text)),
      el('div', { class: 'dfoot' }, el('button', { type: 'button', class: 'btn primary', onclick: () => { b.remove(); onClick(); } }, button))));
  document.body.append(b);
  b.querySelector('button').focus();
  return b;
}

/** Save a file to the device (Downloads on Android). */
export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name, style: 'display:none' });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60000);
}

/** "2026-11-04T13:45:00Z" → "Nov 4, 2026" in local time. */
export function shortDate(iso) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}
