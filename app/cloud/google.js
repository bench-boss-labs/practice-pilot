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
    /**
     * Google's file picker. kind 'folder' (a team folder), 'library' (a team's files: library and shared plans)
     * or 'plans' (the shared-plans file). folderId opens that folder first. multi: select several → an array.
     * → { id, name } (or [{ id, name }] with multi) or null.
     */
    async pick({ kind, title, folderId, multi = false }) {
      await load('https://apis.google.com/js/api.js');
      await new Promise((res, rej) => window.gapi.load('picker', { callback: res, onerror: () => rej(new Error('Couldn’t open Google’s file picker.')) }));
      const P = window.google.picker;
      return new Promise((resolve, reject) => {
        const files = q => [
          ...(folderId ? [new P.DocsView(P.ViewId.DOCS).setMimeTypes('application/json').setParent(folderId)] : []),
          new P.DocsView(P.ViewId.DOCS).setMimeTypes('application/json').setQuery(q).setOwnedByMe(false),
          new P.DocsView(P.ViewId.DOCS).setMimeTypes('application/json').setQuery(q).setOwnedByMe(true)];
        const views = kind === 'folder'
          ? [new P.DocsView(P.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setOwnedByMe(true),
             new P.DocsView(P.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setOwnedByMe(false)]
          : kind === 'plans' ? files('Practice Pilot shared plans') : kind === 'club' ? files('Practice Pilot club library') : files('Practice Pilot');
        const b = new P.PickerBuilder().setTitle(title).setOAuthToken(pass && pass.token).setDeveloperKey(GOOGLE.apiKey).setAppId(GOOGLE.appId)
          .setCallback(d => {
            if (d.action === P.Action.PICKED) { const all = d.docs.map(x => ({ id: x.id, name: x.name })); resolve(multi ? all : all[0]); }
            else if (d.action === P.Action.CANCEL) resolve(null);
            else if (d.action === 'error') reject(new Error('Google’s file picker had a problem.'));
          });
        if (multi) b.enableFeature(P.Feature.MULTISELECT_ENABLED);
        views.forEach(v => b.addView(v));
        b.build().setVisible(true);
      });
    },
  };
}
