/* ================= legal: Privacy Policy and Terms of use =================
   Two screens, reached from the sign-in flow
   (profile/settings.js), the Account screen (profile/settings.js) and the
   Privacy screen (profile/privacy.js) — S.profileView.screen = 'privacyPolicy'
   or 'termsOfUse', then renderProfile() (same navigation shape every other
   profile sub-screen already uses).

   The actual words live in docs/PRIVACY_POLICY.md and docs/TERMS_OF_USE.md,
   which are the reviewable source for any wording change — this file is
   the in-app rendering of the exact same text, kept in sync by hand (there's
   no markdown renderer in this app, and the content is short enough that a
   build step to generate one from the other would be more moving parts than
   the two-file-review discipline this engagement already uses for CLAUDE.md
   itself). Built with the same el()/textContent primitives as every other
   screen in this codebase, not innerHTML — not because this static,
   developer-authored text could carry a tag-injection payload (it can't,
   unlike a file's own embedded tags), but because there's no reason for
   this one screen to be the sole exception to how the rest of the app
   builds its DOM. */
import { el } from '../util/dom.js';

const LAST_UPDATED = 'October 20, 2026';

function section(body, heading, paragraphs){
  if(heading) body.appendChild(el('h2', null, heading));
  paragraphs.forEach(p => body.appendChild(el('p', null, p)));
}

function bulletList(body, items){
  const ul = el('ul','legal-list');
  items.forEach(item => ul.appendChild(el('li', null, item)));
  body.appendChild(ul);
}

function lastUpdatedNote(body){
  body.appendChild(el('p','note','Last updated: ' + LAST_UPDATED));
}

export function renderPrivacyPolicyScreen(body){
  body.innerHTML = '';
  lastUpdatedNote(body);
  body.appendChild(el('p', null,
    'Miziki is a local-first music player. Your music never leaves your device. '
    + 'This page explains what the app does collect, once you turn on the optional '
    + 'account features (sign-in, backup, social).'));

  section(body, 'What’s collected', []);
  bulletList(body, [
    'Email — only to send you a 6-digit sign-in code. It’s never shown to other users and never used for anything else.',
    'Handle, display name, bio and avatar — the profile you choose to show once signed in.',
    'Social activity you choose to share — your crate, ratings and notes, what you’re currently spinning, and your listening rhythm (a one-line verdict and the percentage of your plays in each part of the day — never your individual plays or the times you played them). Sharing “now spinning” and listening rhythm is off by default — you turn each on yourself in the Privacy screen. Listening rhythm also needs at least 20 counted plays before there’s anything to show. A “Don’t share this session” switch in the player lets you skip sharing “now spinning” for one listening session without changing the setting itself. A shared “now spinning” tag like “at golden hour” says roughly what time of day it is where you are, which implies an approximate time zone; a shared listening rhythm says which part of the day you tend to listen in, which implies something about your daily routine. Neither ever reveals exact times, a location, or individual plays.',
    'Milestones (hitting a rare pressing) show on your own disc, share card and crate — never on a friend’s feed. Anything that is posted to the feed (a record added, pinned, or reviewed) is removed automatically after 45 days.',
    'Your private listening backup — play counts, session counts, achievements and your Collection, sealed/broken-record state, the text of any track edits you’ve made (never the audio itself), playlists, and your app settings. This is private to your account.',
    'Uploaded custom covers and your profile picture — a resized copy (with photo metadata like location stripped out) is stored so it can appear on your other devices. Custom covers are private to your account; your profile picture is public, since it doubles as your account’s avatar once you’re signed in.',
  ]);

  section(body, 'What’s never collected', []);
  bulletList(body, [
    'Your music files. Audio stays on your device — nothing is uploaded, ever, even when signed in.',
    'Embedded cover art inside your music files — it stays with the file.',
    'Your location. Used only on your own device, for Sundown’s sunset calculation. It never leaves the device. If you choose the Nychthemeron appearance (light by day, dark by night), the only thing kept from this is today’s sunrise and sunset times — never your coordinates — so the app can pick the right look before the page even finishes loading.',
    'Contacts, analytics, advertising identifiers, or tracking of any kind. Miziki makes no requests to any third party at all, other than your own Supabase project, when you’ve signed in.',
  ]);

  section(body, 'Who can see what', []);
  bulletList(body, [
    'Your listening backup and your custom covers are private to your account — nobody else ever reads them in the ordinary course of running the app.',
    'Your handle, display name and avatar are visible to other signed-in users, except anyone you’ve blocked.',
    'Anything you choose to share — including listening rhythm — follows your visibility setting (private, friends, or everyone — friends by default), found in the Privacy screen.',
  ]);

  section(body, 'Where your data lives, and for how long', [
    'Your account data is stored in Miziki’s own Supabase project, hosted in the US (East region), which acts as a data processor on Miziki’s behalf — it doesn’t use your data for its own purposes. Your data is kept until you delete it or delete your account.',
    'To get a copy: use Download my data (Privacy screen) at any time, signed in or not. It produces one JSON file with everything described above — no audio, no images.',
    'To delete it: use Delete account (Account screen). This permanently removes your account, handle, backup, custom covers, profile picture, and all social data from the server. It’s irreversible. Your music and listening history on your own device are never touched by this.',
  ]);

  section(body, 'Who can use Miziki', [
    'You must be at least 16 years old to create an account. You must own, or otherwise have the right to play, any music you add to your library.',
  ]);

  section(body, 'Community rules', [
    'If you use the social features, don’t impersonate anyone, harass other users, or post illegal content in your profile, bio, or notes. Reports against other accounts are reviewed, and violations can lead to content being removed, an account being restricted, or an account being deleted.',
  ]);

  section(body, 'Changes to this policy', [
    'If this policy changes, the date at the top will be updated and the new version will be shown the same way — as a screen inside the app.',
  ]);

  section(body, 'Contact', [
    'Questions about this policy, or about your data: sckhitokiri@gmail.com',
  ]);
}

export function renderTermsScreen(body){
  body.innerHTML = '';
  lastUpdatedNote(body);
  body.appendChild(el('p', null,
    'By using Miziki, you agree to these terms. If you don’t agree, don’t use the app. '
    + 'See the Privacy Policy for what data is collected and how it’s handled — these terms '
    + 'are about using the app itself.'));

  section(body, 'What Miziki is', [
    'Miziki is a local-first music player: it plays FLAC, WAV, ALAC and MP3 files you choose from your own device. Your music is never uploaded. Signing in adds optional features on top — a private backup of your listening history and settings, and a social layer for sharing your crate with friends — but the player works fully without ever signing in.',
  ]);

  section(body, 'Who can use it', [
    'You must be at least 16 years old to create an account. You must own, or otherwise have the legal right to play, every piece of music you add to your library. Miziki doesn’t provide or sell music — it only plays files you already have.',
  ]);

  section(body, 'Your account', [
    'You’re responsible for your own account and for keeping your sign-in code private (there’s no password — codes are single-use and emailed to you). You can sign out of one device or every device at once from the Account screen, and delete your account entirely at any time; see the Privacy Policy for exactly what deletion removes.',
  ]);

  section(body, 'Your content', [
    'You own the music, photos, and text (track edits, notes, bio) you add. By choosing to share something, you’re allowing the friends your visibility setting permits to see it. Miziki doesn’t claim ownership of anything you create or upload, and doesn’t use it for any purpose beyond showing it to you and whoever you’ve chosen to share it with.',
  ]);

  section(body, 'Community rules', ['Using the social features, you agree not to:']);
  bulletList(body, [
    'impersonate another person or account,',
    'harass, threaten, or abuse other users,',
    'post illegal content, or',
    'upload a profile picture, bio, note, or custom cover that violates any of the above.',
  ]);
  body.appendChild(el('p', null,
    'Reports against other accounts are reviewed. A violation of these rules can lead to '
    + 'content being removed, an account being restricted, or an account being deleted, at '
    + 'Miziki’s discretion.'));

  section(body, 'No warranty, and availability', [
    'Miziki is a small, independently run project. It’s provided “as is,” without guarantees of uptime, availability, or that it will always work exactly as described. Back up anything irreplaceable the same way you would with any other software — Download my data, in the Privacy screen, is there for exactly that.',
  ]);

  section(body, 'Changes to these terms', [
    'If these terms change, the date at the top will be updated and the new version will be shown the same way — as a screen inside the app.',
  ]);

  section(body, 'Contact', [
    'Questions about these terms: sckhitokiri@gmail.com',
  ]);
}

// TR2 (docs/19_PLAYER.md): legalLinksRow() moved to the tiny, often-reached
// profile/legal-links.js leaf, which this file's own two screens no longer
// need -- callers that only want the link row no longer pull this file's
// full Privacy Policy/Terms of use text in with it.
