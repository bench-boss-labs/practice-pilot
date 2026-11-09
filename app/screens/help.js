/* Help: the standard Bench Boss Labs Help screen. */
import { renderHelp } from '../../vendor/bbl-kit/1.0.1/bbl-help.js';
import { APP_NAME, APP_VERSION } from '../version.js?v=1.5.2';
import { el } from '../ui.js?v=1.5.2';
import { GUIDES } from '../guides.js?v=1.5.2';

export function renderHelpScreen(app) {
  const b = t => el('b', {}, t);
  const p = (...k) => el('span', {}, ...k);
  return renderHelp({
    app: APP_NAME, version: APP_VERSION, releases: app.notes, guideUrl: GUIDES.coachManual,
    intro: 'Practice Pilot is for building hockey drills that move and turning them into practice plans. Build drills on a tablet or PC; play them anywhere.',
    tasks: [
      { title: 'Plan a practice', text: p('Tap ', b('Plans'), ', then ', b('+ New plan'), '. Add drills, stations and activities; the bar at the top shows the ice time left. ', b('Print'), ' gives a run sheet and a card for each drill, or a PDF.') },
      { title: 'Build a drill', text: p('Tap ', b('+ New drill'), ' in the library. Tap a piece in the tray, then the rink, to place it. Tap ', b('+ Step'), ' and drag players to where they go; a player with the puck on their stick carries it. Every change saves by itself.') },
      { title: 'Pass or shoot', text: p('Tap ', b('➜ Pass'), ' above the rink, tap the passer, then who gets it (a player or a coach). ', b('⇒ Shoot'), ' works the same way with a spot. If they don’t have the puck, the nearest one goes to them first.') },
      { title: 'Dump it in', text: p('Tap ', b('↷ Dump in'), ', tap who dumps it, pick ', b('Into the corner'), ' or ', b('Around the boards'), ', then tap where the puck ends up. It gets a step of its own; add the next step for the chase. Tap the puck to switch between the two.') },
      { title: 'Turn the rink', text: p(b('⤵ Up the ice'), ' turns the picture so the net is at the top; tap it again for across. It’s also in ', b('Details › Rink'), ', with ', b('Show ringette lines'), '. Printouts, sheets and videos show the drill the same way.') },
      { title: 'Make two players move at once', text: p('Drag both in the same step: everything in a step moves together. The ', b('Step'), ' tab lists what’s moving.') },
      { title: 'Skate a route', text: p('Pick a step, then drag a player along the route you want: loops, curves, around the pylons. They skate it at an even speed over the step. Drag them again to keep going; ', b('Undo'), ' or ', b('Stay still'), ' starts over.') },
      { title: 'Curve a path, pivot or wait', text: p('Tap a moving player. Drag a dot on their line to change its shape, pick ', b('Stop'), ' or ', b('Pivot'), ' as the finish, and use ', b('After skaters arrive'), ' to make a pass wait.') },
      { title: 'Add a callout', text: p('Select a player in a step, tap ', b('+ Callout'), ' and type the cue. Pick ', b('This step'), ' or ', b('Until the end'), '.') },
      { title: 'Find a drill', text: p('Search the library, or use the Tags, Age, Level and Rink filters. Tap a card to watch it play.') },
      { title: 'Share drills with your team', text: p('Open the link in your invitation email, sign in with Google and tap ', b('Pick the team files'), '. In Google’s picker, select both of your team’s Practice Pilot files, then tap Select. (Or ', b('Settings › This device › Join a team'), '.) Your coaches’ published drills and plans appear here. The top bar shows when you last synced; tap it for ', b('Sync now'), '.') },
      { title: 'Send a drill to anyone', text: p('On a drill, tap ', b('Share'), ' (in the Library, or ⋮ in the editor) and tick what to send: a ', b('Video to watch'), ', a ', b('Printable sheet'), ' (a picture of the page), or a ', b('File for another coach'), ' (they tap ', b('Import'), ' in their Library). ', b('Make and send'), ' sends them together. ', b('Print the sheet instead'), ' opens the page to print or Save as PDF.') },
            { title: 'Share a plan with helpers', text: p('Add your helpers once in ', b('Settings › This device › Helpers'), ', by their Google email. Then on a plan, tap ', b('Share'), ', ', b('Share with helpers'), ' and ', b('Send link'), '. On their phone they sign in, pick the team’s ', b('shared plans'), ' file once, and see the run sheet with each drill playing, even with no signal.') },
            { title: 'Club library', text: p('Drills every team can use. Library › ', b('Show › Club library'), ' lists them (the first time, pick the club library file in Google’s picker). ', b('Import to my team'), ' makes your own draft copy. To suggest one of yours, tap ', b('Share'), ' on it and tick ', b('Add to the club library'), '.') },
      { title: 'Admin (Bench Boss Labs)', text: p('Signed in as Bench Boss Labs, ', b('Admin'), ' sets up teams: name, logo and colours, coaches (Google emails them a link to join), helpers, ', b('Adopt a folder'), ' for a team made outside Admin, and ', b('Archive'), '. Team colours set the colour of new players.') },
      { title: 'Drafts and Publish', text: p('A new drill or plan is a ', b('Draft'), ': only you see it, on this device, even with no signal. Tap ', b('Publish'), ' when it’s ready for the team. Changes to a published drill wait for ', b('Publish changes'), ', and ', b('Discard changes'), ' goes back to the team’s version.') },
            { title: 'Put it on your phone’s home screen too', text: p('On a phone, the browser bar takes space from the rink. Added to the home screen (', b('Settings › This device › Install'), '), Practice Pilot opens full screen with a bigger rink.') },
      { title: 'Put it on your tablet’s home screen', text: p('Tap ', b('Install'), ' at the top, or go to ', b('Settings › This device › Install'), ' for the steps on your device. It then opens like any other app.') },
      { title: 'Use it at the rink with no signal', text: 'Once it has been opened online, Practice Pilot opens with no internet. Everything you make is saved on this device.' },
      { title: 'Back up your drills', text: p('Tap ', b('Settings › This device › Back up now'), '. A file goes to your Downloads folder. ', b('Restore'), ' on the same screen brings it back, on this device or another.') },
    ],
    questions: [
      { q: 'I removed something by mistake.', a: p('Tap ', b('Undo'), ' at the top of the editor, or on the message that appears. A deleted drill stays in ', b('Show › Recently deleted'), ' for 30 days.') },
      { q: 'What can helpers see?', a: p('Only the plans you share, with their drills: from the last 30 days and anything still to come. Never your drafts, the library, or plans you haven’t shared. Publishing changes to a shared plan updates their copy; ', b('Stop sharing'), ' or ', b('Remove'), ' a helper in Settings › This device › Helpers.') },
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
