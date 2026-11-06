/* Help: the standard Bench Boss Labs Help screen. */
import { renderHelp } from '../../vendor/bbl-kit/1.0.1/bbl-help.js';
import { APP_NAME, APP_VERSION } from '../version.js?v=1.3.2';
import { el } from '../ui.js?v=1.3.2';

export function renderHelpScreen(app) {
  const b = t => el('b', {}, t);
  const p = (...k) => el('span', {}, ...k);
  return renderHelp({
    app: APP_NAME, version: APP_VERSION, releases: app.notes, guideUrl: 'guide/',
    intro: 'Practice Pilot is for building hockey drills that move and turning them into practice plans. Build drills on a tablet or PC; play them anywhere.',
    tasks: [
      { title: 'Plan a practice', text: p('Tap ', b('Plans'), ', then ', b('+ New plan'), '. Add drills, stations and activities; the bar at the top shows the ice time left. ', b('Print'), ' gives a run sheet and a card for each drill, or a PDF.') },
      { title: 'Build a drill', text: p('Tap ', b('+ New drill'), ' in the library. Tap a piece in the tray, then the rink, to place it. Tap ', b('+ Step'), ' and drag players to where they go; a player with the puck on their stick carries it. Every change saves by itself.') },
      { title: 'Pass or shoot', text: p('Tap ', b('➜ Pass'), ' above the rink, tap the passer, then who gets it (a player or a coach). ', b('⇒ Shoot'), ' works the same way with a spot. If they don’t have the puck, the nearest one goes to them first.') },
      { title: 'Make two players move at once', text: p('Drag both in the same step: everything in a step moves together. The ', b('Step'), ' tab lists what’s moving.') },
      { title: 'Skate a route', text: p('Pick a step, then drag a player along the route you want: loops, curves, around the pylons. They skate it at an even speed over the step. Drag them again to keep going; ', b('Undo'), ' or ', b('Stay still'), ' starts over.') },
      { title: 'Curve a path, pivot or wait', text: p('Tap a moving player. Drag a dot on their line to change its shape, pick ', b('Stop'), ' or ', b('Pivot'), ' as the finish, and use ', b('After skaters arrive'), ' to make a pass wait.') },
      { title: 'Add a callout', text: p('Select a player in a step, tap ', b('+ Callout'), ' and type the cue. Pick ', b('This step'), ' or ', b('Until the end'), '.') },
      { title: 'Find a drill', text: p('Search the library, or use the Tags, Age, Level and Rink filters. Tap a card to watch it play.') },
      { title: 'Share drills with your team', text: p('In ', b('Settings › This device'), ', sign in with Google and tap ', b('Join a team'), ', then pick your team’s library file. Your coaches’ published drills and plans appear here. The top bar shows when you last synced; tap it for ', b('Sync now'), '.') },
      { title: 'Drafts and Publish', text: p('A new drill or plan is a ', b('Draft'), ': only you see it, on this device, even with no signal. Tap ', b('Publish'), ' when it’s ready for the team. Changes to a published drill wait for ', b('Publish changes'), ', and ', b('Discard changes'), ' goes back to the team’s version.') },
            { title: 'Put it on your phone’s home screen too', text: p('On a phone, the browser bar takes space from the rink. Added to the home screen (', b('Settings › This device › Install'), '), Practice Pilot opens full screen with a bigger rink.') },
      { title: 'Put it on your tablet’s home screen', text: p('Tap ', b('Install'), ' at the top, or go to ', b('Settings › This device › Install'), ' for the steps on your device. It then opens like any other app.') },
      { title: 'Use it at the rink with no signal', text: 'Once it has been opened online, Practice Pilot opens with no internet. Everything you make is saved on this device.' },
      { title: 'Back up your drills', text: p('Tap ', b('Settings › This device › Back up now'), '. A file goes to your Downloads folder. ', b('Restore'), ' on the same screen brings it back, on this device or another.') },
    ],
    questions: [
      { q: 'I removed something by mistake.', a: p('Tap ', b('Undo'), ' at the top of the editor, or on the message that appears. A deleted drill stays in ', b('Show › Recently deleted'), ' for 30 days.') },
      { q: 'Someone else changed the drill I was working on. What happens?', a: p('When you publish, Practice Pilot checks first. If another coach published the same drill since you started, it asks: ', b('Keep mine'), ', ', b('Take theirs'), ', or ', b('Keep both'), ' (yours is saved as a copy). Nothing is overwritten without asking.') },
      { q: 'Where are my drills kept?', a: p('On this device, and, once published, in one file in your team’s Google Drive folder. Practice Pilot can only see its own files in your Drive. Drafts stay on this device until you publish them, and they’re in this device’s Backup.') },
            { q: 'Can I edit on my phone?', a: p('Yes. Turn your phone sideways to build or change a drill: the tools run down the left, the steps along the bottom, and ', b('Options'), ' opens the piece, step and details settings. Held upright, you can play a drill and change its details (title, setup, coaching points and tags). Plans are read-only on a phone for now.') },
      { q: 'Where is my work saved?', a: 'On this device only, for now. A later update saves it to your team’s Google Drive folder so your bench staff can see it.' },
      { q: 'What happens when there’s an update?', a: p('An amber banner says a new version is ready, with what’s in it. Tap ', b('Update now'), ', or ', b('Later'), ' to keep going. Small fixes install by themselves.') },
      { q: 'Can my assistant coaches and helpers see my drills?', a: 'Not yet. Sharing with your bench staff and on-ice helpers comes in a later update, and only people you give access to will see anything.' },
      { q: 'It says it’s open in another tab.', a: p('Practice Pilot works in one tab at a time so changes never overwrite each other. Tap ', b('Use this tab instead'), ' to switch.') },
    ],
  });
}
