/* Bench Boss Labs kit — page side of offline support: service worker registration,
   applying an update, online/offline status, and one-tab-at-a-time. */

export async function registerOffline(swUrl = 'sw.js') {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register(swUrl); } catch { return null; }
}

/** Install the newest files and reload. Works whether or not the browser already found the new worker. */
export async function applyUpdate(reg, reload = () => location.reload()) {
  try {
    if (reg) {
      await reg.update().catch(() => {});
      const waiting = reg.waiting || (reg.installing && await new Promise(res => {
        const w = reg.installing;
        w.addEventListener('statechange', () => { if (w.state === 'installed' || w.state === 'redundant') res(reg.waiting); });
        setTimeout(() => res(reg.waiting), 5000);
      }));
      if (waiting) {
        await new Promise(res => {
          navigator.serviceWorker.addEventListener('controllerchange', res, { once: true });
          waiting.postMessage('skip-waiting');
          setTimeout(res, 3000);
        });
      }
    }
  } finally { reload(); }
}

/** Calls cb(online:boolean) now and whenever it changes. */
export function watchOnline(cb) {
  const fire = () => cb(navigator.onLine !== false);
  addEventListener('online', fire); addEventListener('offline', fire);
  fire();
}

/**
 * Keep the app open in one tab at a time, so two copies never overwrite each other.
 * onBlocked(takeOver) runs in a tab that isn't the active one; call takeOver() to make it active.
 * onReleased() runs in the old tab when another tab takes over.
 * Returns a promise that resolves when this tab is the active one.
 */
export function singleTab(name, { onBlocked, onReleased } = {}) {
  const ch = 'BroadcastChannel' in self ? new BroadcastChannel(`${name}-tabs`) : null;
  let release = null;
  const hold = () => new Promise(resolve => {
    navigator.locks.request(`${name}-active`, () => new Promise(r => { release = r; resolve(true); }));
  });
  if (!navigator.locks) return Promise.resolve(true);
  if (ch) ch.onmessage = ev => {
    if (ev.data === 'take-over' && release) { release(); release = null; onReleased && onReleased(); }
  };
  return new Promise(resolve => {
    navigator.locks.request(`${name}-active`, { ifAvailable: true }, lock => {
      if (lock) return new Promise(r => { release = r; resolve(true); });
      const takeOver = async () => { ch && ch.postMessage('take-over'); await hold(); resolve(true); };
      onBlocked ? onBlocked(takeOver) : takeOver();
      return null;
    });
  });
}
