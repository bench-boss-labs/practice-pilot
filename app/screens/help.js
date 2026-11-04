/* Help: the standard Bench Boss Labs Help screen. */
import { renderHelp } from '../../vendor/bbl-kit/1.0.0/bbl-help.js';
import { APP_NAME, APP_VERSION } from '../version.js?v=1.0.0';
import { el } from '../ui.js?v=1.0.0';

export function renderHelpScreen(app) {
  const b = t => el('b', {}, t);
  const p = (...k) => el('span', {}, ...k);
  return renderHelp({
    app: APP_NAME, version: APP_VERSION, releases: app.notes, guideUrl: 'guide/',
    intro: 'Practice Pilot is for building hockey drills that move and turning them into practice plans. This first version sets the app up; drills arrive in the next update.',
    tasks: [
      { title: 'Put it on your tablet’s home screen', text: p('Tap ', b('Install'), ' at the top, or go to ', b('Settings › This device › Install'), ' for the steps on your device. It then opens like any other app.') },
      { title: 'Use it at the rink with no signal', text: 'Once it has been opened online, Practice Pilot opens with no internet. Everything you make is saved on this device.' },
      { title: 'Back up your drills', text: p('Tap ', b('Settings › This device › Back up now'), '. A file goes to your Downloads folder. ', b('Restore'), ' on the same screen brings it back, on this device or another.') },
    ],
    questions: [
      { q: 'Where is my work saved?', a: 'On this device only, for now. A later update saves it to your team’s Google Drive folder so your bench staff can see it.' },
      { q: 'What happens when there’s an update?', a: p('An amber banner says a new version is ready, with what’s in it. Tap ', b('Update now'), ', or ', b('Later'), ' to keep going. Small fixes install by themselves.') },
      { q: 'Can my assistant coaches and helpers see my drills?', a: 'Not yet. Sharing with your bench staff and on-ice helpers comes in a later update, and only people you give access to will see anything.' },
      { q: 'It says it’s open in another tab.', a: p('Practice Pilot works in one tab at a time so changes never overwrite each other. Tap ', b('Use this tab instead'), ' to switch.') },
    ],
  });
}
