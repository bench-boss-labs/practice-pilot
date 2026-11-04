/* Library: empty until R1 brings the drill editor. */
import { el } from '../ui.js?v=1.0.1';

export function renderLibrary(app) {
  const welcomeSlot = el('div');
  app.store.get('meta', 'welcomed').then(w => {
    if (w) return;
    const card = el('section', { class: 'card welcome stack', id: 'welcome', 'aria-labelledby': 'welcome-title' },
      el('h2', { class: 't-section', id: 'welcome-title' }, 'Welcome to Practice Pilot'),
      el('p', {}, 'Build drills that move, put them into practice plans, and share them with your bench staff and helpers. This first version sets the app up on your device; the drill editor arrives in the next update.'),
      el('div', { class: 'row' },
        app.installPrompt ? el('button', { type: 'button', class: 'btn primary', id: 'welcome-install', onclick: () => document.getElementById('install-btn').click() }, 'Install Practice Pilot') : null,
        el('button', { type: 'button', class: app.installPrompt ? 'btn' : 'btn primary', id: 'welcome-ok', onclick: async () => { await app.store.put('meta', { key: 'welcomed', value: new Date().toISOString() }); card.remove(); } }, 'Got it')));
    welcomeSlot.replaceWith(card);
  });
  return [
    el('div', { class: 'screen-head' }, el('h1', { class: 't-title' }, 'Library')),
    welcomeSlot,
    el('section', { class: 'card empty', id: 'library-empty', 'aria-labelledby': 'empty-title' },
      el('h2', { class: 't-section', id: 'empty-title' }, 'No drills yet'),
      el('p', {}, 'The drill editor and library arrive in the next update. Practice Pilot already works offline.'),
      el('a', { class: 'btn outline', href: '#help' }, 'Open Help')),
  ];
}
