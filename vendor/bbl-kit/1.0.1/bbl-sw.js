/* Bench Boss Labs kit — service worker helper (classic script, loaded with importScripts).
   Versioned files load from the device. Pages and unversioned files: fresh from the network,
   falling back to the saved copy if it doesn't answer in time (then no more waiting for 30 s).
   Offline: the saved copy. A rink Wi-Fi sign-in page can never replace a saved file.

   Usage in an app's sw.js:
     importScripts('vendor/bbl-kit/1.0.1/bbl-sw.js');
     BBLsw.start({ cache: 'practice-pilot-1.0.0', marker: 'practice-pilot', files: [...], timeoutMs: 4000 });
*/
(function () {
  const EXPECT = [
    [/\.m?js(\?|$)/, /javascript|ecmascript/],
    [/\.css(\?|$)/, /text\/css/],
    [/\.json(\?|$)/, /json/],
    [/\.webmanifest(\?|$)/, /manifest\+json|json/],
    [/\.svg(\?|$)/, /image\/svg/],
    [/\.png(\?|$)/, /image\/png/],
    [/\.(woff2?|ttf)(\?|$)/, /font|octet-stream/],
  ];

  /** Is this response the real file, not a sign-in page pretending to be it? */
  async function genuine(request, response, marker) {
    if (!response || !response.ok || response.type === 'opaqueredirect') return false;
    if (response.redirected && new URL(response.url).origin !== self.location.origin) return false;
    const url = request.url;
    const type = response.headers.get('content-type') || '';
    if (request.mode === 'navigate' || /\.html?(\?|$)/.test(url) || url.endsWith('/')) {
      if (!/text\/html/.test(type)) return false;
      const text = await response.clone().text();
      return text.includes(`name="bbl-app" content="${marker}"`) || text.includes('name="bbl-guide"');
    }
    for (const [pat, want] of EXPECT) if (pat.test(url)) return want.test(type);
    return true;
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), ms);
      promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  const immutable = u => /[?&]v=\d+\.\d+\.\d+/.test(u.search) || /\/vendor\/bbl-kit\/\d+\.\d+\.\d+\//.test(u.pathname);

  function start(o) {
    const timeoutMs = o.timeoutMs || 4000;
    let slowUntil = 0;
    const scope = self.registration.scope;
    const keyFor = req => {
      const u = new URL(req.url);
      const p = u.origin + u.pathname;
      if (p === scope || p === scope + 'index.html') return scope + 'index.html';
      return req.mode === 'navigate' ? p : p + u.search;
    };

    self.addEventListener('install', ev => {
      ev.waitUntil((async () => {
        const c = await caches.open(o.cache);
        await Promise.all(o.files.map(async f => {
          const req = new Request(new URL(f, scope).href, { cache: 'reload' });
          try {
            const res = await fetch(req);
            if (await genuine(req, res.clone(), o.marker)) await c.put(keyFor(req), res);
          } catch (e) { /* offline during install: the next online visit fills it */ }
        }));
      })());
    });

    self.addEventListener('activate', ev => {
      ev.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(n => n.startsWith(o.prefix || o.cache.replace(/-[\d.]+$/, '')) && n !== o.cache && n !== (o.cache + '-fonts')).map(n => caches.delete(n)));
        await self.clients.claim();
      })());
    });

    self.addEventListener('message', ev => {
      if (ev.data === 'skip-waiting') self.skipWaiting();
    });

    self.addEventListener('fetch', ev => {
      const req = ev.request;
      if (req.method !== 'GET') return;
      const url = new URL(req.url);
      // Fonts from Google: saved the first time, then always from the device.
      if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
        ev.respondWith((async () => {
          const c = await caches.open(o.cache + '-fonts');
          const hit = await c.match(req);
          if (hit) return hit;
          try { const res = await fetch(req); if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; } catch { return Response.error(); }
        })());
        return;
      }
      if (url.origin !== self.location.origin || !url.href.startsWith(scope)) return;
      if (url.searchParams.has('fresh')) return; // version checks always go to the network
      ev.respondWith((async () => {
        const c = await caches.open(o.cache);
        const key = keyFor(req);
        const saved = () => c.match(key, { ignoreSearch: false }).then(r => r || c.match(key, { ignoreSearch: true }));
        // Versioned files (?v=1.2.3, or inside the kit's version folder) never change: the saved copy is used first.
        if (immutable(url)) {
          const hit = await c.match(key);
          if (hit) return hit;
        } else if (Date.now() < slowUntil) {
          // The network just failed to answer: don't make every file wait again for a while.
          const hit = await saved();
          if (hit) return hit;
        }
        try {
          const res = await withTimeout(fetch(req), timeoutMs);
          if (await genuine(req, res.clone(), o.marker)) {
            c.put(key, res.clone());
            return res;
          }
          return (await saved()) || res;
        } catch (e) {
          slowUntil = Date.now() + 30000;
          const s = await saved();
          if (s) return s;
          if (req.mode === 'navigate') {
            return new Response(o.offlinePage || '<!doctype html><meta charset="utf-8"><title>Offline</title><p style="font:16px system-ui;padding:24px">This app needs the internet once to install. Connect and reload.</p>',
              { headers: { 'content-type': 'text/html; charset=utf-8' } });
          }
          return Response.error();
        }
      })());
    });
  }

  self.BBLsw = { start, genuine };
})();
