/* A fake Google Drive for the tests (unit and browser). It follows the drive.file rule the Nov 5 trial showed:
   a person's Practice Pilot sees only files the app made for them, and files or folders they picked in the
   file picker. Drive sharing (owner, Editor, Viewer) works through parent folders, as in real Drive. */

const FOLDER = 'application/vnd.google-apps.folder';
let seq = 0;
const nid = () => `f${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class FakeDrive {
  constructor() { this.files = new Map(); this.offline = false; this.expired = new Set(); this.log = []; }
  token(email) { return `tok:${email}`; }

  /* ---- set-up helpers (what a person does in Drive itself) ---- */
  /** A folder made by hand in Drive (not by the app). */
  addFolder(name, owner, { parent = null, shared = {} } = {}) { return this.#add({ name, mimeType: FOLDER, owner, parents: parent ? [parent] : [], shared, app: new Set() }); }
  /** A file made by hand in Drive (dropped in). */
  addFile(name, owner, parent, content = '{}') { return this.#add({ name, mimeType: 'application/json', owner, parents: [parent], shared: {}, app: new Set(), content }); }
  share(id, email, role = 'writer') { this.files.get(id).shared[email] = role; }
  unshare(id, email) { delete this.files.get(id).shared[email]; }
  /** The file picker: picking grants this person's app the file. */
  pick(email, id) { this.files.get(id).app.add(email); }
  file(id) { return this.files.get(id); }
  find(name) { return [...this.files.values()].find(f => f.name === name && !f.trashed) || null; }
  read(id) { return JSON.parse(this.files.get(id).content); }

  #add(f) {
    const id = nid();
    this.files.set(id, { id, version: 1, modifiedTime: new Date().toISOString(), appProperties: {}, trashed: false, content: '', ...f });
    return id;
  }
  /** Drive permission through the folder chain: 'owner', 'writer', 'reader' or null. */
  role(email, f) {
    const rank = { reader: 1, writer: 2, owner: 3 };
    let best = null;
    for (let x = f; x; x = x.parents[0] && this.files.get(x.parents[0])) {
      const r = x.owner === email ? 'owner' : x.shared[email] || null;
      if (r && (!best || rank[r] > rank[best])) best = r;
    }
    return best;
  }
  /** What the app (drive.file) may touch for this person. */
  can(email, f) { return !!f && !f.trashed && f.app.has(email) && !!this.role(email, f); }
  #meta(f, email) {
    return { id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, version: String(f.version), modifiedTime: f.modifiedTime,
      appProperties: { ...f.appProperties }, capabilities: { canEdit: ['owner', 'writer'].includes(this.role(email, f)), canShare: ['owner', 'writer'].includes(this.role(email, f)) },
      owners: [{ emailAddress: f.owner }] };
  }
  #touch(f) { f.version++; f.modifiedTime = new Date(Date.now() + f.version).toISOString(); }

  /** fetch-compatible: (url, { method, headers, body }) → Response-like. */
  async fetch(url, init = {}) {
    const r = await this.handle({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body || '' });
    return { ok: r.status < 400, status: r.status, statusText: String(r.status), text: async () => r.body, json: async () => JSON.parse(r.body) };
  }

  /** The Drive REST calls Practice Pilot uses. → { status, body } */
  async handle({ url, method, headers, body }) {
    const json = (status, o) => ({ status, body: JSON.stringify(o) });
    const err = (status, message) => json(status, { error: { code: status, message } });
    if (this.offline) throw new TypeError('Failed to fetch');
    const auth = headers.Authorization || headers.authorization || '';
    const email = (/^Bearer tok:(.+)$/.exec(auth) || [])[1];
    if (!email || this.expired.has(email)) return err(401, 'Invalid Credentials');
    const u = new URL(url);
    const path = u.pathname.replace(/^\/(upload\/)?drive\/v3/, '');
    this.log.push(`${method} ${path} ${email}`);
    const m = /^\/files\/([^/]+)$/.exec(path);
    const f = m && this.files.get(m[1]);

    if (method === 'GET' && path === '/about') return json(200, { user: { emailAddress: email, displayName: email.split('@')[0] } });
    if (method === 'GET' && path === '/files') {
      const s = u.searchParams.get('q') || '';
      const parent = (/'([^']+)' in parents/.exec(s) || [])[1];
      const name = (/name='((?:[^'\\]|\\.)*)'/.exec(s) || [])[1];
      const mime = (/mimeType='([^']+)'/.exec(s) || [])[1];
      const out = [...this.files.values()].filter(x => this.can(email, x) && (!parent || x.parents.includes(parent))
        && (!name || x.name === name.replace(/\\'/g, "'")) && (!mime || x.mimeType === mime));
      return json(200, { files: out.map(x => this.#meta(x, email)) });
    }
    if (method === 'GET' && m) {
      if (!this.can(email, f)) return err(404, `File not found: ${m[1]}.`);
      if (u.searchParams.get('alt') === 'media') return { status: 200, body: f.content };
      return json(200, this.#meta(f, email));
    }
    if (method === 'POST' && path === '/files') {
      const isUpload = u.pathname.startsWith('/upload/');
      let meta, content = '';
      if (isUpload) {
        const parts = String(body).split(/--pp[a-z0-9]+(?:--)?\r?\n?/).map(p => p.split(/\r?\n\r?\n/).slice(1).join('\n\n').trim()).filter(Boolean);
        meta = JSON.parse(parts[0]); content = parts[1] || '';
      } else meta = JSON.parse(body);
      const parent = this.files.get((meta.parents || [])[0]);
      if (!this.can(email, parent) || !['owner', 'writer'].includes(this.role(email, parent))) return err(404, 'Parent not found.');
      const id = this.#add({ name: meta.name, mimeType: meta.mimeType || 'application/octet-stream', owner: email, parents: [parent.id], shared: {}, app: new Set([email]), content, appProperties: meta.appProperties || {} });
      return json(200, this.#meta(this.files.get(id), email));
    }
    if (method === 'PATCH' && m) {
      if (!this.can(email, f)) return err(404, `File not found: ${m[1]}.`);
      if (!['owner', 'writer'].includes(this.role(email, f))) return err(403, 'The user does not have sufficient permissions for this file.');
      if (u.pathname.startsWith('/upload/')) f.content = String(body);
      else {
        const p = JSON.parse(body || '{}');
        for (const [k, v] of Object.entries(p.appProperties || {})) { if (v === null) delete f.appProperties[k]; else f.appProperties[k] = String(v); }
        if (p.name) f.name = p.name;
      }
      this.#touch(f);
      return json(200, this.#meta(f, email));
    }
    return err(400, `FakeDrive doesn't know ${method} ${path}`);
  }
}
