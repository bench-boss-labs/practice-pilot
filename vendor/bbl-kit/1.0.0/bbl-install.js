/* Bench Boss Labs kit — the standard "Install" section for Settings › This device.
   Every app shows one of: installed, an Install button, or the steps for this device. */
import { el } from './bbl-updates.js';

/** Which device family, from the browser's description (pure, testable). */
export function platformOf(ua = '', maxTouchPoints = 0) {
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/**
 * 'installed' | 'ready' (the browser offers its install button) | 'ios' | 'android' | 'desktop' (steps).
 * standalone = the app is running from its home-screen icon.
 */
export function installState({ standalone = false, installed = false, prompt = null, ua = '', maxTouchPoints = 0 } = {}) {
  if (standalone || installed) return 'installed';
  if (prompt) return 'ready';
  return platformOf(ua, maxTouchPoints);
}

/** The steps shown when there's no Install button, in the Product Standards' writing style. */
export function installSteps(state, appName) {
  switch (state) {
    case 'ios': return ['Open this page in Safari.', 'Tap Share (the square with an arrow).', `Tap Add to Home Screen, then Add. ${appName} appears with your other apps.`];
    case 'android': return ['Open this page in Chrome.', 'Tap ⋮ at the top right.', `Tap Add to Home screen (or Install app), then Install. ${appName} appears with your other apps.`];
    case 'desktop': return ['Open this page in Chrome or Edge.', 'Click the install icon at the right of the address bar (a screen with a down arrow), or ⋮ › Install.', `${appName} then opens in its own window and from the Start menu.`];
    default: return [];
  }
}

/** Read the live state from the browser. */
export function currentInstallState(prompt, installed = false) {
  const standalone = !!((globalThis.matchMedia && matchMedia('(display-mode: standalone)').matches) || (globalThis.navigator && navigator.standalone));
  return installState({ standalone, installed, prompt, ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints || 0 });
}

/**
 * renderInstallCard({ appName, prompt, installed, onInstall }) → <section class="card"> for Settings › This device.
 * onInstall() should call prompt.prompt() (apps keep the beforeinstallprompt event).
 */
export function renderInstallCard({ appName, prompt = null, installed = false, onInstall }) {
  const state = currentInstallState(prompt, installed);
  const card = el('section', { class: 'card stack', id: 'install-card', 'data-state': state, 'aria-labelledby': 'install-title' },
    el('h2', { class: 't-section', id: 'install-title' }, 'Install'));
  if (state === 'installed') {
    card.append(el('p', { class: 'status-line good', style: 'margin:0' }, `● ${appName} is installed on this device. Open it from its icon on your home screen.`));
  } else if (state === 'ready') {
    card.append(
      el('p', { style: 'margin:0' }, `Put ${appName} on your home screen so it opens like any other app, with no browser bar, and works with no signal.`),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn primary', id: 'install-now', onclick: () => onInstall && onInstall() }, `Install ${appName}`)));
  } else {
    card.append(
      el('p', { style: 'margin:0' }, `Put ${appName} on your home screen so it opens like any other app and works with no signal:`),
      el('ol', { style: 'margin:0;padding-left:20px', id: 'install-steps' }, installSteps(state, appName).map(s => el('li', {}, s))));
  }
  return card;
}
