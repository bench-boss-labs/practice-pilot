/* Settings › This device: the Google Drive and team card (R3). Sign in, set up a team (benchbosslabs only),
   join a team by picking its library once, change or leave the team, sign out. */
import { el, toast, dialog, fill } from '../ui.js?v=1.4.2';
import { cloudState, signIn, signOut, signedIn, setupTeam, joinTeam, leaveTeam } from '../cloud/team.js?v=1.4.2';
import { isAdmin, LIBRARY_PREFIX } from '../cloud/library.js?v=1.4.2';
import { setHelper } from '../cloud/sharing.js?v=1.4.2';

const APP_ADDRESS = 'bench-boss-labs.github.io/practice-pilot';
const when = iso => (iso ? new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not yet');
const problem = e => (e && e.words) || (e && e.message) || 'Something went wrong.';

export function renderTeamCard(app) {
  const card = el('section', { class: 'card stack', id: 'cloud-card', 'aria-labelledby': 'cloud-title' });
  const status = el('p', { class: 'status-line', id: 'cloud-status', role: 'status', 'aria-live': 'polite' });
  let working = false;

  const run = async (label, fn) => {
    if (working) return;
    working = true; status.textContent = label;
    for (const b of card.querySelectorAll('button')) b.disabled = true;
    const was = (await cloudState(app)).libraryId;
    try { await fn(); status.textContent = ''; }
    catch (e) { console.warn('team', e); status.textContent = problem(e); toast(problem(e), { error: true }); }
    finally {
      working = false;
      if ((await cloudState(app)).libraryId !== was && card.isConnected) { app.render(); if (app.catchUp) app.catchUp(); }   // team changed: redraw Settings, catch up
      else await draw();
    }
  };
  const btn = (id, label, fn, kind = '') => el('button', { type: 'button', class: `btn ${kind}`, id, onclick: fn }, label);

  async function draw() {
    const st = await cloudState(app);
    const inTeam = !!st.libraryId, on = signedIn(app) && !!st.email;
    const parts = [el('h2', { class: 't-section', id: 'cloud-title' }, 'Google Drive and your team')];

    if (!inTeam && app.helper) {
      parts.push(el('p', {}, 'This phone is a helper’s for ', el('b', { id: 'cloud-helper-team' }, app.helper.teamName || 'a team'), on ? ['. Signed in as ', el('b', { id: 'cloud-email' }, st.email), '.'] : '. Signed out.'));
      parts.push(el('div', { class: 'row' },
        on ? btn('google-signout', 'Sign out', () => run('Signing out…', () => signOut(app))) : btn('google-signin', 'Sign in with Google', () => run('Signing in…', () => signIn(app)), 'primary'),
        btn('stop-helper', 'Stop being a helper here', () => run('Removing…', async () => { await setHelper(app, null); toast('This phone no longer shows the team’s plans.'); app.render(); }))));
    } else if (inTeam) {
      parts.push(el('dl', { class: 'kv' },
        el('dt', {}, 'Team'), el('dd', { id: 'cloud-team' }, st.teamName),
        el('dt', {}, 'Signed in as'), el('dd', { id: 'cloud-email' }, on ? st.email : 'Signed out'),
        el('dt', {}, 'Last synced'), el('dd', { id: 'cloud-synced' }, when(st.syncedAt))));
      parts.push(el('div', { class: 'row' },
        on ? null : btn('google-signin', 'Sign in to sync', () => run('Signing in…', () => signIn(app)), 'primary'),
        on ? btn('change-team', 'Change team', () => run('Changing team…', () => changeTeam(app))) : null,
        btn('leave-team', 'Leave team', () => run('Leaving…', async () => {
          const v = await dialog({ id: 'leave-confirm', title: `Leave ${st.teamName} on this device?`, body: 'Its drills and plans stay on this device as your own, and stop syncing. The team’s library in Google Drive isn’t changed.', buttons: [{ label: 'Cancel', value: 'no' }, { label: 'Leave team', value: 'yes', kind: 'danger' }] });
          if (v === 'yes') { await leaveTeam(app); toast(`Left ${st.teamName}. Its drills stay on this device.`); }
        })),
        on ? btn('google-signout', 'Sign out', () => run('Signing out…', async () => { await signOut(app); toast('Signed out. The team’s drills stay on this device to view.'); })) : null));
      parts.push(el('details', { class: 'pp-howto' }, el('summary', {}, 'How to add a coach'),
        el('ol', {},
          el('li', {}, 'In Google Drive, signed in as benchbosslabs, share the team folder (', el('b', {}, st.folderName || st.teamName), ') with the coach as ', el('b', {}, 'Editor'), '.'),
          el('li', {}, `Send them the app’s address: ${APP_ADDRESS}`),
          el('li', {}, 'They open Settings › This device, sign in with Google and tap ', el('b', {}, 'Join a team'), '.'))));
    } else if (on) {
      parts.push(el('p', {}, 'Signed in as ', el('b', { id: 'cloud-email' }, st.email), '. Join your team to share drills and plans with your other coaches and devices.'));
      parts.push(el('div', { class: 'row' },
        btn('join-team', 'Join a team', () => run('Opening Google’s file picker…', async () => {
          const r = await joinTeam(app, { dialog });
          if (r) toast(`Joined ${r.teamName}.${r.moved ? ` ${r.moved} moved into the team library.` : ''}`);
        }), 'primary'),
        isAdmin(st.email) ? btn('setup-team', 'Set up a team', () => run('Opening Google’s file picker…', async () => {
          const r = await setupTeam(app, { dialog });
          if (r) toast(`${r.teamName} is set up.${r.moved ? ` ${r.moved} moved into the team library.` : ''} Share its folder with your coaches in Google Drive.`, { ms: 9000 });
        })) : null,
        btn('google-signout', 'Sign out', () => run('Signing out…', () => signOut(app)))));
      parts.push(el('p', { class: 'hint' }, `Join a team: in Google’s file picker, pick the file named “${LIBRARY_PREFIX} · ” and your team’s name. A coach shares the team folder with you first.`));
    } else {
      parts.push(el('p', {}, 'Sign in with Google to keep your drills and plans in your team’s Google Drive folder, shared with your other coaches and devices. Without signing in, everything stays on this device, as now.'));
      parts.push(el('div', { class: 'row' }, btn('google-signin', 'Sign in with Google', () => run('Signing in…', () => signIn(app)), 'primary')));
      parts.push(el('p', { class: 'hint' }, 'Practice Pilot asks Google for one permission: its own files in your Drive. It can’t see anything else there.'));
    }
    parts.push(status);
    fill(card, ...parts);
    if (app.renderTeamPill) app.renderTeamPill();
  }
  draw();
  return card;
}

/** Switch to another team's library: the old team's published drills leave this device (they're in Drive); drafts stay. */
async function changeTeam(app) {
  const st = await cloudState(app);
  const v = await dialog({ id: 'change-confirm', title: 'Change team on this device?', body: `${st.teamName}’s drills and plans leave this device; they stay safe in Google Drive. Your drafts stay here. Then you pick the other team’s library.`, buttons: [{ label: 'Cancel', value: 'no' }, { label: 'Pick another team', value: 'yes', kind: 'primary' }] });
  if (v !== 'yes') return;
  const keep = { drills: [], plans: [] };
  for (const kind of ['drills', 'plans']) keep[kind] = (await app.store.all(kind)).filter(r => r.pub && r.pub.state === 'published');
  const r = await joinTeam(app, { dialog, before: async () => { for (const kind of ['drills', 'plans']) for (const x of keep[kind]) await app.store.delete(kind, x.id); } });
  if (r) toast(`Now on ${r.teamName}.`);
}
