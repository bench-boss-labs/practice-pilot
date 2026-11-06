/* Practice Pilot — Google sign-in (Google Identity Services) and Google's file picker (R3).
   One permission only: drive.file, Practice Pilot's own files. The pass Google gives lasts about an hour; it is
   kept on this device so reopening the app within the hour needs no sign-in. The browser tests swap this whole
   object for a fake (window.__ppGoogle). */

export const GOOGLE = {
  clientId: '288699264821-1vrufu4o104mtq1acse66ue1ejidp1or.apps.googleusercontent.com',
  apiKey: 'AIzaSyCMijVo7mOwsI1PluwBKsJrG_zeHo_NVMY',   // a browser key: public by design, limited to this site and Drive + Picker
  appId: '288699264821',
  scope: 'https://www.googleapis.com/auth/drive.file',
};
const KEY = 'pp-google-pass';
const scripts = {};
const load = src => (scripts[src] ||= new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = src; s.async = true; s.onload = res;
  s.onerror = () => { delete scripts[src]; rej(new Error('Couldn’t reach Google. Check the connection and try again.')); };
  document.head.append(s);
}));

export function createGoogle() {
  if (window.__ppGoogle) return window.__ppGoogle;
  let pass = null;
  try { pass = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  const keep = p => { pass = p; try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY); } catch {} };

  return {
    /** The current pass, or null when it has run out (a minute's margin). */
    token() { return pass && pass.exp > Date.now() + 60000 ? pass.token : null; },
    /** Sign in. quiet: no account chooser (Google may still flash a window). hint: the email to use. */
    async signIn({ quiet = false, hint = '' } = {}) {
      await load('https://accounts.google.com/gsi/client');
      return new Promise((resolve, reject) => {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE.clientId, scope: GOOGLE.scope, ...(hint ? { login_hint: hint } : {}),
          callback: r => {
            if (r.error) { reject(new Error(r.error === 'access_denied' ? 'Google sign-in was cancelled.' : r.error_description || r.error)); return; }
            if (!window.google.accounts.oauth2.hasGrantedAllScopes(r, GOOGLE.scope)) { reject(new Error('Practice Pilot needs permission to its own files in Google Drive. Try again and tick the box.')); return; }
            keep({ token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
            resolve(r.access_token);
          },
          error_callback: e => reject(new Error(e && e.type === 'popup_closed' ? 'The Google sign-in window was closed before signing in.' : e && e.type === 'popup_failed_to_open' ? 'The browser blocked Google’s sign-in window. Allow pop-ups for this site and try again.' : (e && e.message) || 'Google sign-in didn’t work.')),
        });
        client.requestAccessToken(quiet ? { prompt: '' } : { prompt: 'select_account' });
      });
    },
    signOut() {
      const t = pass && pass.token;
      keep(null);
      try { if (t && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(t, () => {}); } catch {}
    },
    /** Google's file picker. kind 'folder' (set up a team) or 'library' (join a team). → { id, name } or null. */
    async pick({ kind, title }) {
      await load('https://apis.google.com/js/api.js');
      await new Promise((res, rej) => window.gapi.load('picker', { callback: res, onerror: () => rej(new Error('Couldn’t open Google’s file picker.')) }));
      const P = window.google.picker;
      return new Promise((resolve, reject) => {
        const views = kind === 'folder'
          ? [new P.DocsView(P.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setOwnedByMe(true),
             new P.DocsView(P.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setOwnedByMe(false)]
          : [new P.DocsView(P.ViewId.DOCS).setMimeTypes('application/json').setQuery('Practice Pilot library').setOwnedByMe(false),
             new P.DocsView(P.ViewId.DOCS).setMimeTypes('application/json').setQuery('Practice Pilot library').setOwnedByMe(true)];
        const b = new P.PickerBuilder().setTitle(title).setOAuthToken(pass && pass.token).setDeveloperKey(GOOGLE.apiKey).setAppId(GOOGLE.appId)
          .setCallback(d => {
            if (d.action === P.Action.PICKED) resolve({ id: d.docs[0].id, name: d.docs[0].name });
            else if (d.action === P.Action.CANCEL) resolve(null);
            else if (d.action === 'error') reject(new Error('Google’s file picker had a problem.'));
          });
        views.forEach(v => b.addView(v));
        b.build().setVisible(true);
      });
    },
  };
}
