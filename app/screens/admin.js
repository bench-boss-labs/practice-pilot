/* Admin (1.5.0): the Bench Boss Labs account sets up teams — name, logo, colours, coaches — and keeps their
   sharing right. #admin (teams), #admin/new, #admin/team/<library id>. Coaches join from #team/<lib>/<folder>/<name>. */
import { el, fill, toast, dialog } from '../ui.js?v=1.5.1';
import { cloudState, signIn, signedIn, joinTeam } from '../cloud/team.js?v=1.5.1';
import { isAdmin, validEmail } from '../cloud/library.js?v=1.5.1';
import * as A from '../cloud/admin.js?v=1.5.1';
import * as C from '../cloud/club.js?v=1.5.1';
import { thumbnailSVG } from '../engine/render.js?v=1.5.1';
import { frame } from '../engine/model.js?v=1.5.1';
import { Player } from '../engine/player.js?v=1.5.1';

const problem = e => (e && e.words) || (e && e.message) || 'Something went wrong.';
const when = iso => (iso ? new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const SWATCHES = ['#c8102e', '#f26a1b', '#f2b705', '#1f7a3a', '#1d4ed8', '#0b1b31', '#6b2fa3', '#1d232b', '#7a7f87', '#ffffff'];

/** A team's logo, or its initials on its main colour. */
export function teamBadge(team = {}, size = 40) {
  if (team.logo) return el('img', { class: 'pp-teamlogo', src: team.logo, alt: '', width: size, height: size, style: `width:${size}px;height:${size}px` });
  const initials = String(team.name || '?').split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w[0])).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  return el('span', { class: 'pp-teamlogo pp-teamlogo-text', 'aria-hidden': 'true', style: `width:${size}px;height:${size}px;background:${team.mainColour || '#1d3560'};color:${team.secondColour || '#ffffff'};font-size:${Math.round(size * 0.38)}px` }, initials);
}

/** Shrink a picked picture to at most 256 px; → a data URL (PNG keeps transparency, else JPEG when smaller). */
export async function shrinkLogo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = el('canvas', { width: Math.max(1, Math.round(img.naturalWidth * k)), height: Math.max(1, Math.round(img.naturalHeight * k)) });
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const png = c.toDataURL('image/png');
    if (png.length < 90000) return png;
    const flat = el('canvas', { width: c.width, height: c.height }), x = flat.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0);
    return flat.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

export function renderAdmin(app, sub) {
  const root = el('div', { class: 'stack pp-admin', id: 'admin-screen' });
  const [, kind, id] = location.hash.replace('#', '').split('/');
  (async () => {
    const st = await cloudState(app);
    if (!isAdmin(st.email) || !signedIn(app)) {
      fill(root, el('section', { class: 'card stack' }, el('h1', { class: 't-section' }, 'Admin'),
        el('p', {}, isAdmin(st.email) ? 'Sign in again to use Admin.' : 'Admin is for the Bench Boss Labs account.'),
        isAdmin(st.email) ? el('button', { type: 'button', class: 'btn primary', id: 'admin-signin', onclick: async () => { try { await signIn(app); app.render(); } catch (e) { toast(problem(e), { error: true }); } } }, 'Sign in with Google') : null));
      return;
    }
    if (kind === 'new') return drawForm(app, root, null);
    if (kind === 'club') return drawClub(app, root);
    if (kind === 'team' && id) return drawTeam(app, root, id);
    return drawList(app, root);
  })().catch(e => { console.warn('admin', e); fill(root, el('div', { class: 'card notice', id: 'admin-problem' }, el('p', {}, problem(e)), el('a', { class: 'btn', href: '#admin' }, 'Back to teams'))); });
  return root;
}

/* ---------- teams ---------- */

async function drawList(app, root) {
  fill(root, el('p', { class: 'muted' }, 'Getting your teams…'));
  const { doc } = await A.loadAdmin(app);
  const live = doc.teams.filter(t => !t.archived), gone = doc.teams.filter(t => t.archived);
  const infos = await Promise.all(live.map(t => A.teamInfo(app, t)));
  const status = el('p', { class: 'status-line', id: 'admin-status', role: 'status', 'aria-live': 'polite' });
  const card = info => {
    const t = info.team || { name: info.entry.name };
    return el('a', { class: 'card pp-teamcard', href: `#admin/team/${info.entry.libraryId}`, 'data-team': info.entry.name },
      teamBadge(t, 48),
      el('div', { class: 'grow stack', style: 'gap:2px' },
        el('b', {}, t.name),
        el('span', { class: 'muted' }, info.problem ? info.problem : `${info.drills} drills · ${info.plans} plans · updated ${when(info.updatedAt)}`),
        info.needsUpdate ? el('span', { class: 'pill pp-pill-warn' }, 'Sharing needs updating') : null),
      el('span', { class: 'pp-colourpair', 'aria-hidden': 'true' }, el('i', { style: `background:${t.mainColour || '#1d3560'}` }), el('i', { style: `background:${t.secondColour || '#ffffff'}` })));
  };
  fill(root, adminTabs('teams'),
    el('div', { class: 'row' }, el('h1', { class: 't-title grow', style: 'margin:0' }, 'Teams'),
      el('a', { class: 'btn primary', href: '#admin/new', id: 'new-team' }, '+ New team'),
      el('button', { type: 'button', class: 'btn', id: 'adopt-team', onclick: async () => {
        status.textContent = 'Opening Google’s file picker…';
        try { const e = await A.adoptFolder(app); status.textContent = ''; if (e) { toast(`${e.name} is in Admin.`); location.hash = `#admin/team/${e.libraryId}`; } }
        catch (e) { status.textContent = problem(e); }
      } }, 'Adopt a folder')),
    el('p', { class: 'hint', style: 'margin:0' }, 'Each team is a folder in your Google Drive. Adopt a folder brings in a team folder made outside Admin.'),
    status,
    live.length ? el('div', { class: 'stack', id: 'team-list' }, ...infos.map(card)) : el('p', { class: 'muted', id: 'team-list' }, 'No teams yet. Tap New team.'),
    gone.length ? el('details', { class: 'pp-howto', id: 'archived-teams' }, el('summary', {}, `Archived (${gone.length})`),
      el('ul', { class: 'pp-helpers' }, ...gone.map(t => el('li', { class: 'row' }, el('span', { class: 'grow' }, t.name),
        el('button', { type: 'button', class: 'btn', 'data-restore': t.name, onclick: async () => { await A.restoreTeam(app, t); toast(`${t.name} is back. Add its coaches again.`); app.render(); } }, 'Restore'))))) : null);
}

/** Teams | Club library */
function adminTabs(on) {
  return el('nav', { class: 'pp-seg pp-admintabs', 'aria-label': 'Admin' },
    el('a', { href: '#admin', class: 'btn', 'aria-current': on === 'teams' ? 'page' : null, id: 'admin-tab-teams' }, 'Teams'),
    el('a', { href: '#admin/club', class: 'btn', 'aria-current': on === 'club' ? 'page' : null, id: 'admin-tab-club' }, 'Club library'));
}

/* ---------- the club library (1.5.1) ---------- */

/** Watch a drill play, in a dialog. */
function watch(d) {
  const host = el('div', { class: 'pp-preview-player', style: 'min-height:260px' });
  const shown = dialog({ id: 'watch-drill', title: d.title, body: host, buttons: [{ label: 'Close', value: null, kind: 'primary' }] });
  const p = new Player(host, d);
  shown.then(() => p.destroy());
}
const thumb = d => { const box = el('div', { class: 'pp-thumb pp-thumb-sm' }); thumbnailSVG(d, frame).then(svg => { box.innerHTML = svg; }); return box; };

async function drawClub(app, root) {
  fill(root, adminTabs('club'), el('p', { class: 'muted' }, 'Getting the club library…'));
  const status = el('p', { class: 'status-line', id: 'admin-status', role: 'status', 'aria-live': 'polite' });
  let busy = false;
  const run = async (words, fn) => {
    if (busy) return; busy = true; status.textContent = words;
    try { await fn(); status.textContent = ''; } catch (e) { console.warn('club', e); status.textContent = problem(e); } finally { busy = false; }
  };
  const [{ doc }, reqs, mine] = await Promise.all([C.loadClub(app), C.listRequests(app), app.store.all('drills')]);
  const row = (d, ...buttons) => el('li', { class: 'row pp-clubrow' }, thumb(d), el('div', { class: 'grow stack', style: 'gap:2px' }, ...[].concat(d._label)), ...buttons);
  const requests = reqs.length ? el('ul', { class: 'pp-clublist', id: 'club-requests' }, ...reqs.map(r => row({ ...r.drill, _label: [el('b', {}, r.drill.title), el('span', { class: 'muted' }, `${r.entry.name} · ${r.req.by} · ${new Date(r.req.at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`)] },
      el('button', { type: 'button', class: 'btn', onclick: () => watch(r.drill) }, 'Watch'),
      el('button', { type: 'button', class: 'btn primary', 'data-add': r.drill.title, onclick: () => run('Adding…', async () => { await C.approveRequest(app, r); toast(`“${r.drill.title}” is in the club library.`); app.render(); }) }, 'Add'),
      el('button', { type: 'button', class: 'btn', 'data-decline': r.drill.title, onclick: () => run('Declining…', async () => { await C.declineRequest(app, r); toast(`Declined “${r.drill.title}”.`); app.render(); }) }, 'Decline'))))
    : el('p', { class: 'muted', id: 'club-requests', style: 'margin:0' }, 'No requests. Coaches ask from a drill’s Share button.');
  const drills = doc.drills.length ? el('ul', { class: 'pp-clublist', id: 'club-drills' }, ...doc.drills.slice().sort((a, b) => a.title.localeCompare(b.title)).map(d => row({ ...d, _label: [el('b', {}, d.title), el('span', { class: 'muted' }, `From ${d.club && d.club.team ? d.club.team : '—'} · added ${new Date(d.club.addedAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`)] },
      el('button', { type: 'button', class: 'btn', onclick: () => watch(d) }, 'Watch'),
      el('button', { type: 'button', class: 'btn danger', 'data-remove-club': d.title, onclick: () => run('Removing…', async () => { await C.removeFromClub(app, d.id); toast(`“${d.title}” is out of the club library. Copies teams imported stay.`); app.render(); }) }, 'Remove'))))
    : el('p', { class: 'muted', id: 'club-drills', style: 'margin:0' }, 'The club library is empty.');
  const own = mine.filter(d => !d.deletedAt && !d.template && !doc.drills.some(x => x.id === d.id)).sort((a, b) => a.title.localeCompare(b.title));
  const pick = el('select', { id: 'own-drill', 'aria-label': 'One of your drills' }, el('option', { value: '' }, 'Choose one of your drills…'), ...own.map(d => el('option', { value: d.id }, d.title)));
  fill(root, adminTabs('club'),
    el('h1', { class: 't-title', style: 'margin:0' }, 'Club library'),
    el('p', { class: 'hint', style: 'margin:0' }, 'Drills every team can import. Coaches see the drills only, not which team sent them.'),
    status,
    el('section', { class: 'card stack' }, el('h2', { class: 't-section' }, `Requests${reqs.length ? ` (${reqs.length})` : ''}`), requests),
    el('section', { class: 'card stack' }, el('h2', { class: 't-section' }, `In the club library (${doc.drills.length})`), drills,
      el('div', { class: 'row' }, pick, el('button', { type: 'button', class: 'btn', id: 'add-own', onclick: () => run('Adding…', async () => {
        const d = own.find(x => x.id === pick.value);
        if (!d) throw new Error('Choose one of your drills first.');
        await C.addOwnDrill(app, d); toast(`“${d.title}” is in the club library.`); app.render();
      }) }, 'Add to the club library'))),
    el('section', { class: 'card stack' }, el('h2', { class: 't-section' }, 'Who can see it'),
      el('p', { class: 'hint', style: 'margin:0' }, 'Every coach on every team can read the club library. Coaches you add from now on get it automatically; coaches removed from a team keep it.'),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', id: 'share-club', onclick: () => run('Giving coaches access…', async () => {
        const n = await C.shareClub(app); toast(n ? `${n} coach${n === 1 ? '' : 'es'} can now see the club library.` : 'Every coach can already see the club library.');
      }) }, 'Give every coach access'))));
}

/* ---------- new team / the team's look ---------- */

function lookFields(team, onChange) {
  const v = { name: team.name || '', logo: team.logo || null, mainColour: team.mainColour || '#c8102e', secondColour: team.secondColour || '#ffffff' };
  const preview = el('div', { class: 'row pp-lookpreview', id: 'look-preview' });
  const drawPreview = () => fill(preview, teamBadge(v, 56), el('span', { class: 'pp-teampill-sample', style: `--team-main:${v.mainColour};--team-second:${v.secondColour}` }, v.logo ? el('img', { src: v.logo, alt: '' }) : null, v.name || 'Team name'));
  const name = el('input', { type: 'text', id: 'team-name-input', value: v.name, maxlength: 60, placeholder: 'e.g. U13B Burlington Barracudas', 'aria-label': 'Team name', oninput: e => { v.name = e.target.value; drawPreview(); onChange(); } });
  const fileIn = el('input', { type: 'file', accept: 'image/*', id: 'logo-file', hidden: true, onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    try { v.logo = await shrinkLogo(f); drawPreview(); onChange(); } catch { toast('That picture couldn’t be read. Try a PNG or JPEG.', { error: true }); }
    e.target.value = '';
  } });
  const colour = key => {
    const input = el('input', { type: 'color', id: `${key}-input`, value: v[key], 'aria-label': key === 'mainColour' ? 'Main colour' : 'Second colour', oninput: e => set(e.target.value) });
    const set = c => { v[key] = c; input.value = c; for (const b of row.querySelectorAll('.pp-swatch')) b.setAttribute('aria-pressed', String(b.dataset.c === c)); drawPreview(); onChange(); };
    const row = el('div', { class: 'row pp-swatches' }, ...SWATCHES.map(c => el('button', { type: 'button', class: 'pp-swatch', 'data-c': c, 'aria-pressed': String(v[key] === c), 'aria-label': c, style: `--sw:${c}`, onclick: () => set(c) })), input);
    return row;
  };
  drawPreview();
  const node = el('div', { class: 'stack' },
    el('label', { class: 'field' }, el('span', { class: 't-label' }, 'Team name'), name),
    el('div', { class: 'field' }, el('span', { class: 't-label' }, 'Logo'),
      el('div', { class: 'row' }, fileIn,
        el('button', { type: 'button', class: 'btn', id: 'pick-logo', onclick: () => fileIn.click() }, 'Choose a picture'),
        el('button', { type: 'button', class: 'btn', id: 'remove-logo', onclick: () => { v.logo = null; drawPreview(); onChange(); } }, 'No logo')),
      el('span', { class: 'hint' }, 'A square picture works best. It’s shrunk to 256 px and every coach gets it when they sync.')),
    el('div', { class: 'field' }, el('span', { class: 't-label' }, 'Main colour'), colour('mainColour')),
    el('div', { class: 'field' }, el('span', { class: 't-label' }, 'Second colour'), colour('secondColour')),
    el('span', { class: 'hint' }, 'Team colours show in the top bar, on printouts, drill sheets and videos, and set the colour of new players.'),
    preview);
  return { node, value: () => ({ ...v, name: v.name.trim() }) };
}

async function drawForm(app, root) {
  const status = el('p', { class: 'status-line', id: 'admin-status', role: 'status', 'aria-live': 'polite' });
  const look = lookFields({}, () => {});
  const create = el('button', { type: 'button', class: 'btn primary', id: 'create-team', onclick: async () => {
    const v = look.value();
    if (!v.name) { status.textContent = 'Give the team a name.'; return; }
    create.disabled = true; status.textContent = `Making ${v.name} in Google Drive…`;
    try { const e = await A.createTeam(app, v); toast(`${e.name} is set up. Now add its coaches.`); location.hash = `#admin/team/${e.libraryId}`; }
    catch (e) { status.textContent = problem(e); create.disabled = false; }
  } }, 'Create team');
  fill(root, el('a', { href: '#admin', class: 'btn', style: 'align-self:flex-start' }, '‹ Teams'),
    el('section', { class: 'card stack' }, el('h1', { class: 't-section' }, 'New team'), look.node,
      el('div', { class: 'row' }, create), status,
      el('p', { class: 'hint', style: 'margin:0' }, 'Makes a folder for the team in Practice Pilot in your Google Drive, with its library and shared-plans files.')));
}

/* ---------- one team ---------- */

async function drawTeam(app, root, libraryId) {
  fill(root, el('p', { class: 'muted' }, 'Getting the team…'));
  const { doc } = await A.loadAdmin(app);
  const entry = doc.teams.find(t => t.libraryId === libraryId);
  if (!entry) { location.hash = '#admin'; return; }
  const info = await A.teamInfo(app, entry);
  if (!info.team) throw new Error(info.problem);
  const status = el('p', { class: 'status-line', id: 'admin-status', role: 'status', 'aria-live': 'polite' });
  let busy = false;
  const run = async (words, fn) => {
    if (busy) return; busy = true; status.textContent = words;
    try { await fn(); status.textContent = ''; } catch (e) { console.warn('admin', e); status.textContent = problem(e); } finally { busy = false; }
  };

  // look
  const save = el('button', { type: 'button', class: 'btn primary', id: 'save-team', disabled: true, onclick: () => run('Saving…', async () => {
    const v = look.value();
    if (!v.name) throw new Error('Give the team a name.');
    const e = await A.updateTeam(app, entry, v);
    Object.assign(entry, e);
    save.disabled = true;
    toast(`${e.name} saved. Coaches get it next time they sync.`);
    app.render();
  }) }, 'Save');
  const look = lookFields(info.team, () => { save.disabled = false; });

  // coaches
  const coachList = el('div', { id: 'coach-list' });
  const coachEmail = el('input', { type: 'email', id: 'coach-email', inputmode: 'email', autocomplete: 'off', placeholder: 'coach@gmail.com', 'aria-label': 'Coach’s Google email' });
  const drawCoaches = async () => {
    const cs = await A.coachesOf(app, entry);
    fill(coachList, cs.length ? el('ul', { class: 'pp-helpers' }, ...cs.map(c => el('li', { class: 'row' }, el('span', { class: 'grow' }, c.email),
      el('button', { type: 'button', class: 'btn', 'data-remove-coach': c.email, onclick: () => run(`Removing ${c.email}…`, async () => {
        const ok = await dialog({ id: 'remove-coach', title: `Remove ${c.email}?`, body: `They lose access to ${entry.name} in Google Drive straight away. What’s already on their device stays there.`, buttons: [{ label: 'Cancel', value: null }, { label: 'Remove', value: 'yes', kind: 'danger' }] });
        if (!ok) return;
        await A.removeCoach(app, entry, c.id); toast(`${c.email} is no longer a coach on ${entry.name}.`); await drawCoaches();
      }) }, 'Remove'))))
      : el('p', { class: 'muted', style: 'margin:0' }, 'No coaches yet.'));
  };
  const addCoach = el('button', { type: 'button', class: 'btn', id: 'add-coach', onclick: () => run('Adding…', async () => {
    if (!validEmail(coachEmail.value)) throw new Error('Type the coach’s Google email address.');
    const e = await A.addCoach(app, entry, coachEmail.value);
    coachEmail.value = '';
    toast(`${e} is a coach. Google emailed them the link to join.`);
    await drawCoaches();
  }) }, 'Add coach');

  // helpers
  const helperList = el('div', { id: 'admin-helpers' });
  const drawHelpers = async () => {
    const hs = await A.helpersOf(app, entry);
    fill(helperList, hs.length ? el('ul', { class: 'pp-helpers' }, ...hs.map(h => el('li', { class: 'row' }, el('span', { class: 'grow' }, h.email),
      el('button', { type: 'button', class: 'btn', 'data-remove-helper': h.email, onclick: () => run(`Removing ${h.email}…`, async () => { await A.removeHelperOf(app, entry, h.id); toast(`${h.email} is no longer a helper.`); await drawHelpers(); }) }, 'Remove'))))
      : el('p', { class: 'muted', style: 'margin:0' }, 'No helpers. Coaches add them in Settings › This device › Helpers.'));
  };

  const upgrade = info.needsUpdate ? el('section', { class: 'card stack notice', id: 'update-sharing' },
    el('p', { style: 'margin:0' }, el('b', {}, 'Sharing needs updating. '), 'This team was set up before 1.5.0: its shared plans sit in a “shared” folder that helpers’ phones can’t open. Updating moves them next to the library file and keeps its helpers.'),
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn primary', id: 'update-sharing-btn', onclick: () => run('Updating sharing…', async () => {
      const n = await A.updateSharing(app, entry);
      toast(`Sharing updated${n ? `; ${n} helper${n === 1 ? '' : 's'} carried over` : ''}. Helpers pick the plans file once on their phone.`);
      app.render();
    }) }, 'Update sharing'))) : null;

  fill(root, el('a', { href: '#admin', class: 'btn', style: 'align-self:flex-start' }, '‹ Teams'),
    el('div', { class: 'row' }, teamBadge(info.team, 48), el('h1', { class: 't-title grow', style: 'margin:0', id: 'admin-team-title' }, info.team.name)),
    status,
    upgrade,
    el('section', { class: 'card stack', id: 'team-look' }, el('h2', { class: 't-section' }, 'Name, logo and colours'), look.node, el('div', { class: 'row' }, save)),
    el('section', { class: 'card stack', id: 'team-coaches' }, el('h2', { class: 't-section' }, 'Coaches'),
      el('p', { class: 'hint', style: 'margin:0' }, 'Coaches can make, edit, publish and share drills and plans. Adding one shares the team folder with them as Editor; Google emails them a link to join.'),
      coachList, el('div', { class: 'row' }, coachEmail, addCoach),
      el('details', { class: 'pp-howto' }, el('summary', {}, 'The join link'), el('p', { style: 'margin:0;word-break:break-all', id: 'coach-link' }, A.coachLink(entry)))),
    el('section', { class: 'card stack', id: 'team-helpers' }, el('h2', { class: 't-section' }, 'Helpers'),
      el('p', { class: 'hint', style: 'margin:0' }, 'Helpers see shared plans on their phone.'), helperList),
    el('section', { class: 'card stack' }, el('h2', { class: 't-section' }, 'Archive'),
      el('p', { class: 'hint', style: 'margin:0' }, 'Hides the team here and removes every coach’s and helper’s access. Nothing in Google Drive is deleted, and you can restore it.'),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn danger', id: 'archive-team', onclick: () => run('Archiving…', async () => {
        const ok = await dialog({ id: 'archive-confirm', title: `Archive ${entry.name}?`, body: 'Every coach and helper loses access in Google Drive. Nothing is deleted.', buttons: [{ label: 'Cancel', value: null }, { label: 'Archive', value: 'yes', kind: 'danger' }] });
        if (!ok) return;
        await A.archiveTeam(app, entry); toast(`${entry.name} is archived.`); location.hash = '#admin';
      }) }, 'Archive team'))));
  await Promise.all([run('Getting coaches and helpers…', async () => { await Promise.all([drawCoaches(), drawHelpers()]); })]);
}

/* ---------- a coach's invitation: #team/<library>/<folder>/<name> ---------- */

export function renderTeamJoin(app) {
  const root = el('div', { class: 'stack pp-helper', id: 'team-join' });
  const [, libraryId, folderId, nameEnc] = location.hash.replace('#', '').split('/');
  const teamName = decodeURIComponent(nameEnc || '') || 'your team';
  const status = el('p', { class: 'status-line', id: 'join-status', role: 'status', 'aria-live': 'polite' });
  const draw = async () => {
    const st = await cloudState(app);
    const title = el('h1', { class: 't-section' }, `Join ${teamName}`);
    if (st.libraryId === libraryId) {
      fill(root, el('section', { class: 'card stack' }, title, el('p', {}, `This device is already on ${teamName}.`), el('a', { class: 'btn primary', href: '#library' }, 'Open the Library')));
      return;
    }
    if (st.libraryId) {
      fill(root, el('section', { class: 'card stack' }, title, el('p', {}, `This device is on ${st.teamName}. To switch, go to Settings › This device and tap Change team.`), el('a', { class: 'btn primary', href: '#settings/device' }, 'Open Settings')));
      return;
    }
    const on = signedIn(app) && st.email;
    fill(root, el('section', { class: 'card stack' }, title,
      el('p', {}, `You’ve been added as a coach on ${teamName}. Two quick steps, just this once:`),
      el('ol', {}, el('li', {}, 'Sign in with the Google account the invitation was sent to.'),
        el('li', {}, 'In Google’s file picker, select ', el('b', {}, 'both'), ` files in ${teamName}: “Practice Pilot library” and “Practice Pilot shared plans”. Then tap Select.`)),
      on ? el('p', {}, 'Signed in as ', el('b', {}, st.email), '.') : null,
      el('div', { class: 'row' },
        on ? el('button', { type: 'button', class: 'btn primary', id: 'join-pick', onclick: async () => {
          status.textContent = 'Opening Google’s file picker…';
          try { const r = await joinTeam(app, { dialog, folderId, libraryId }); status.textContent = ''; if (r) { toast(`Joined ${r.teamName}.`); app.render(); if (app.catchUp) app.catchUp(); location.hash = '#library'; } }
          catch (e) { status.textContent = problem(e); }
        } }, 'Pick the team files')
          : el('button', { type: 'button', class: 'btn primary', id: 'join-signin', onclick: async () => { status.textContent = 'Signing in…'; try { await signIn(app); status.textContent = ''; draw(); } catch (e) { status.textContent = problem(e); } } }, 'Sign in with Google')),
      status));
  };
  draw();
  return root;
}
