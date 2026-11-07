/* The helper's phone (1.4.1): the team's shared plans, a plan's run sheet, each drill playing. Kept for no signal.
   #join/<file>/<folder>/<team> is the link a coach sends; #helper, #helper/plan/<id>, #helper/drill/<plan>/<drill>. */
import { el, fill, toast } from '../ui.js?v=1.4.2';
import { Player } from '../engine/player.js?v=1.4.2';
import * as P from '../plans.js?v=1.4.2';
import { planView } from './plans.js?v=1.4.2';
import { visibleShared } from '../cloud/library.js?v=1.4.2';
import { cloudState, signIn, signOut } from '../cloud/team.js?v=1.4.2';
import { helperState, setHelper, helperLoad, helperPick, helperCache } from '../cloud/sharing.js?v=1.4.2';

const when = iso => (iso ? new Date(iso).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const problem = e => (e && e.words) || (e && e.message) || 'Something went wrong.';

/** The link from a coach: remember the team, then show its plans. */
export function renderJoin(app) {
  const root = el('div', { class: 'stack pp-helper' });
  (async () => {
    const [, fileId, folderId, team] = location.hash.replace('#', '').split('/');
    const teamName = decodeURIComponent(team || '');
    if (!fileId) { location.hash = '#helper'; return; }
    if ((await cloudState(app)).libraryId) {
      fill(root, el('section', { class: 'card stack' }, el('h1', { class: 't-section' }, `Practice plans for ${teamName}`),
        el('p', {}, 'This device belongs to a coach on a team, and coaches already see every published plan in Plans.'),
        el('a', { class: 'btn primary', href: '#plans' }, 'Open Plans')));
      return;
    }
    const was = await helperState(app);
    await setHelper(app, { ...(was && was.fileId === fileId ? was : {}), fileId, folderId, teamName });
    location.replace(`${location.pathname}${location.search}#helper`);
  })();
  return root;
}

export function renderHelper(app) {
  const root = el('div', { class: 'stack pp-helper', id: 'helper-screen' });
  const [, kind, a, b] = location.hash.replace('#', '').split('/');
  draw(app, root, kind, a, b).catch(e => fill(root, el('div', { class: 'card notice' }, el('p', {}, problem(e)))));
  return root;
}

async function draw(app, root, kind, planId, drillId) {
  const h = await helperState(app);
  if (!h) {
    fill(root, el('section', { class: 'card stack' }, el('h1', { class: 't-section' }, 'Shared practice plans'),
      el('p', {}, 'Open the link your coach sent you to see your team’s practice plans here.')));
    return;
  }
  if (kind === 'plan' || kind === 'drill') {
    const doc = await helperCache(app);
    const entry = doc && doc.plans.find(e => e.plan.id === planId);
    if (!entry) { location.hash = '#helper'; return; }
    return kind === 'plan' ? drawPlan(app, root, entry) : drawDrill(app, root, entry, drillId);
  }
  fill(root, el('p', { class: 'muted' }, `Getting ${h.teamName || 'the team'}’s plans…`));
  let r;
  try { r = await helperLoad(app); } catch (e) { r = { doc: await helperCache(app), state: 'error', words: problem(e) }; }
  const title = el('h1', { class: 't-section', style: 'margin:0' }, `${h.teamName || 'Team'} · practice plans`);
  const again = () => app.render();
  if (r.state === 'signin' && !r.doc) {
    fill(root, el('section', { class: 'card stack', id: 'helper-invite' }, title,
      el('p', {}, `You’re invited to see ${h.teamName || 'your team'}’s practice plans. Sign in with the Google account the coach added as a helper.`),
      el('button', { type: 'button', class: 'btn primary', id: 'helper-signin', onclick: async () => { try { await signIn(app); again(); } catch (e) { toast(problem(e), { error: true }); } } }, 'Sign in with Google'),
      el('p', { class: 'hint', style: 'margin:0' }, 'Practice Pilot asks Google for one permission: its own files. It can’t see anything else in your Drive.')));
    return;
  }
  if (r.state === 'pick') {
    fill(root, el('section', { class: 'card stack', id: 'helper-pick' }, title,
      el('p', {}, el('b', {}, 'One more step, just this once. '), `In Google’s file picker, open Shared with me › ${h.teamName || 'your team'} and pick the folder named “shared”.`),
      el('button', { type: 'button', class: 'btn primary', id: 'helper-pick-btn', onclick: async () => { try { const x = await helperPick(app); if (x) again(); } catch (e) { toast(problem(e), { error: true }); } } }, 'Pick the shared folder')));
    return;
  }
  if (r.state === 'gone' && !r.doc) {
    fill(root, el('section', { class: 'card stack', id: 'helper-gone' }, title,
      el('p', {}, `You don’t have access to ${h.teamName || 'this team'}’s plans. Ask the coach to add you as a helper, then open their link again.`),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', onclick: again }, 'Try again'),
        el('button', { type: 'button', class: 'btn', onclick: async () => { await setHelper(app, null); await signOut(app); location.hash = '#help'; } }, 'Stop being a helper here'))));
    return;
  }
  if (!r.doc) {
    fill(root, el('section', { class: 'card stack' }, title, el('p', {}, r.state === 'offline' ? 'Connect to the internet once to get the team’s plans. After that they work with no signal.' : r.words || 'Couldn’t get the plans.'),
      el('button', { type: 'button', class: 'btn', onclick: again }, 'Try again')));
    return;
  }
  const plans = visibleShared(r.doc);
  const fresh = await helperState(app);
  fill(root, title,
    el('p', { class: 'muted', id: 'helper-saved', style: 'margin:0' }, r.state === 'ok' ? `Up to date · ${when(fresh.savedAt)}` : r.state === 'offline' ? `Offline · saved ${when(fresh.savedAt)}` : r.state === 'signin' ? `Saved ${when(fresh.savedAt)} · sign in to catch up` : `Saved ${when(fresh.savedAt)}`),
    r.state === 'signin' ? el('button', { type: 'button', class: 'btn', id: 'helper-signin', onclick: async () => { try { await signIn(app); again(); } catch (e) { toast(problem(e), { error: true }); } } }, 'Sign in to catch up') : null,
    plans.length ? el('div', { class: 'pp-plancards', id: 'helper-plans' }, ...plans.map(e => {
      const p = e.plan;
      return el('a', { class: 'card pp-plancard', href: `#helper/plan/${p.id}` },
        el('span', { class: 'pp-card-title' }, p.title),
        el('span', { class: 'muted pp-card-meta' }, [P.dayLabel(p.date), P.clock(p.startTime), `${P.totalMinutes(p)} min`].filter(Boolean).join(' · ')));
    })) : el('p', { class: 'muted' }, 'No plans shared yet. Your coach shares them here before practice.'));
}

function drawPlan(app, root, entry) {
  const map = new Map(entry.drills.map(d => [d.id, d])), lookup = id => map.get(id) || null;
  const sheet = P.setupSheet(entry.plan, lookup);
  fill(root,
    el('a', { class: 'btn', href: '#helper', id: 'helper-back' }, '‹ Shared plans'),
    el('h1', { class: 't-section', style: 'margin:0' }, entry.plan.title),
    planView(entry.plan, { lookup, team: null, helper: true, onDrill: d => { location.hash = `#helper/drill/${entry.plan.id}/${d.id}`; } }),
    sheet.length ? el('section', { class: 'card stack' }, el('h3', { class: 't-label' }, 'Setup'), ...sheet.map(s => el('div', {}, el('b', {}, s.title), el('ul', {}, ...s.lines.map(l => el('li', {}, l)))))) : null,
    el('p', { class: 'hint' }, 'Tap a drill to see it play.'));
}

function drawDrill(app, root, entry, drillId) {
  const d = entry.drills.find(x => x.id === drillId);
  if (!d) { location.hash = `#helper/plan/${entry.plan.id}`; return; }
  const host = el('div', { class: 'pp-review-player', id: 'helper-player' });
  const list = (title, items) => (items.length ? el('section', { class: 'stack' }, el('h3', { class: 't-label' }, title), el('ul', {}, ...items.map(x => el('li', {}, x)))) : null);
  fill(root,
    el('a', { class: 'btn', href: `#helper/plan/${entry.plan.id}`, id: 'helper-back' }, `‹ ${entry.plan.title}`),
    el('h1', { class: 't-section', style: 'margin:0' }, d.title),
    host,
    d.description ? el('p', {}, d.description) : null,
    list('Setup', (d.setupNotes || []).filter(x => x.trim())),
    list('Coaching points', (d.coachingPoints || []).filter(x => x.trim())),
    d.goalieNotes ? el('p', {}, el('b', {}, 'Goalie: '), d.goalieNotes) : null);
  const player = new Player(host, d);
  app.cleanup = () => player.destroy();
}
