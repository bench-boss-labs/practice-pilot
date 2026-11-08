/* Practice Pilot — a small Google Drive v3 client (R3). Works with the drive.file permission: the app sees only
   files it made for this person, or files they picked in Google's file picker. No Google libraries needed:
   plain fetch, so the tests run it against a fake Drive. */

export const API = 'https://www.googleapis.com/drive/v3';
export const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,parents,version,modifiedTime,appProperties,capabilities(canEdit,canShare),owners(emailAddress)';

export class DriveError extends Error {
  constructor(status, message) { super(message); this.status = status; }
  /** Words for the person: what went wrong and what to do. */
  get words() {
    if (this.status === 401) return 'Google needs you to sign in again.';
    if (this.status === 403) return 'Google Drive refused: the team folder may no longer be shared with you.';
    if (this.status === 404) return 'The team library isn’t in Google Drive any more (deleted, or no longer shared with you).';
    if (this.status === 0) return 'No connection to Google Drive right now.';
    return `Google Drive had a problem (${this.message}). Try again in a minute.`;
  }
}
const q = s => encodeURIComponent(s);
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class Drive {
  /** getToken() → a Google access token (or throws); fetchFn defaults to the browser's fetch. */
  constructor({ getToken, fetchFn = (...a) => fetch(...a) }) { this.getToken = getToken; this.fetch = fetchFn; }

  async call(method, url, { body, headers = {}, raw = false } = {}) {
    const token = await this.getToken();
    let res;
    try { res = await this.fetch(url, { method, body, headers: { Authorization: `Bearer ${token}`, ...headers } }); }
    catch (e) { throw new DriveError(0, e.message || 'offline'); }
    if (!res.ok) {
      let m = res.statusText || 'error';
      try { const j = await res.json(); m = (j.error && j.error.message) || m; } catch {}
      throw new DriveError(res.status, m);
    }
    if (raw) return res.text();
    const t = await res.text();
    return t ? JSON.parse(t) : {};
  }

  /** Who is signed in: { email, name }. */
  async about() { const a = await this.call('GET', `${API}/about?fields=user(emailAddress,displayName)`); return { email: a.user.emailAddress, name: a.user.displayName || '' }; }
  meta(id) { return this.call('GET', `${API}/files/${id}?fields=${FIELDS}&supportsAllDrives=true`); }
  /** Files in a folder this app can see (any folder when parent is null); optional exact name and type. */
  async list(parent, { name, mime } = {}) {
    let s = parent ? `'${esc(parent)}' in parents and trashed=false` : 'trashed=false';
    if (name) s += ` and name='${esc(name)}'`;
    if (mime) s += ` and mimeType='${esc(mime)}'`;
    const r = await this.call('GET', `${API}/files?q=${q(s)}&fields=files(${FIELDS})&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`);
    return r.files || [];
  }
  createFolder(parent, name) {
    return this.call('POST', `${API}/files?fields=${FIELDS}&supportsAllDrives=true`, { body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }), headers: { 'Content-Type': 'application/json' } });
  }
  /** The folder of this name in parent, made if this app can't see one. */
  async folder(parent, name) { return (await this.list(parent, { name, mime: FOLDER }))[0] || this.createFolder(parent, name); }
  createJson(parent, name, data, appProperties) {
    const b = 'pp' + Math.random().toString(36).slice(2);
    const meta = { name, parents: [parent], mimeType: 'application/json', ...(appProperties ? { appProperties } : {}) };
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${b}--`;
    return this.call('POST', `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}&supportsAllDrives=true`, { body, headers: { 'Content-Type': `multipart/related; boundary=${b}` } });
  }
  async readJson(id) { return JSON.parse(await this.call('GET', `${API}/files/${id}?alt=media&supportsAllDrives=true`, { raw: true })); }
  /** Replace a file's contents. → its new metadata (with the new version). */
  writeJson(id, data) {
    return this.call('PATCH', `${UPLOAD}/files/${id}?uploadType=media&fields=${FIELDS}&supportsAllDrives=true`, { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
  }
  /** Who a file or folder is shared with. */
  async permissions(id) {
    const r = await this.call('GET', `${API}/files/${id}/permissions?fields=permissions(id,type,role,emailAddress,displayName)&supportsAllDrives=true`);
    return r.permissions || [];
  }
  /** Share with someone; Google emails them with the message. */
  share(id, email, role, message, { notify = true } = {}) {
    const mail = notify ? `sendNotificationEmail=true&emailMessage=${q(message || '')}` : 'sendNotificationEmail=false';
    return this.call('POST', `${API}/files/${id}/permissions?${mail}&supportsAllDrives=true&fields=id,emailAddress,role`, { body: JSON.stringify({ type: 'user', role, emailAddress: email }), headers: { 'Content-Type': 'application/json' } });
  }
  /** Rename a file or folder. */
  rename(id, name) {
    return this.call('PATCH', `${API}/files/${id}?fields=${FIELDS}&supportsAllDrives=true`, { body: JSON.stringify({ name }), headers: { 'Content-Type': 'application/json' } });
  }
  /** Move a file from one folder to another. */
  move(id, to, from) {
    return this.call('PATCH', `${API}/files/${id}?addParents=${q(to)}&removeParents=${q(from)}&fields=${FIELDS}&supportsAllDrives=true`, { body: '{}', headers: { 'Content-Type': 'application/json' } });
  }
  unshare(id, permissionId) { return this.call('DELETE', `${API}/files/${id}/permissions/${permissionId}?supportsAllDrives=true`); }
  /** Change small labels on a file (edit marks). A null value removes that label. */
  setProps(id, appProperties) {
    return this.call('PATCH', `${API}/files/${id}?fields=${FIELDS}&supportsAllDrives=true`, { body: JSON.stringify({ appProperties }), headers: { 'Content-Type': 'application/json' } });
  }
}
