# Miziki privacy policy

**Last updated: October 18, 2026**

This is the canonical source for the Privacy Policy shown inside the app
(`src/profile/legal.js`'s `renderPrivacyPolicyScreen`). The two must say the
same thing — review them together in any PR that changes either, the same
way CLAUDE.md's own facts stay in sync with the code they describe.

Miziki is a local-first music player. Your music never leaves your device.
This page explains what the app does collect, once you turn on the
optional account features (sign-in, backup, social).

## What's collected

- **Email** — only to send you a 6-digit sign-in code. It's never shown to
  other users and never used for anything else.
- **Handle, display name, bio and avatar** — the profile you choose to
  show once signed in.
- **Social activity you choose to share** — your crate (the records
  you've picked to show), ratings and notes, what you're currently
  spinning, milestones (hitting a rare pressing), and your listening
  rhythm (a one-line verdict — "Mostly a night listener" — and the
  percentage of your plays in each part of the day; never your individual
  plays or the times you played them). Sharing "now spinning", milestones
  and listening rhythm is **off by default** — you turn each on yourself
  in the Privacy screen. Listening rhythm also needs at least 20 counted
  plays before there's anything to show.
- **Your private listening backup** — play counts, session counts,
  achievements and Collection progress, sealed/broken-record state, the
  text of any track edits you've made (title/artist/album — never the
  audio itself), playlists, and your app settings. This is private to
  your account; nobody else can see it.
- **Uploaded custom covers and your profile picture** — if you set a
  custom cover for an album, or a profile picture, a resized copy (with
  photo metadata like location stripped out) is stored so it can appear
  on your other devices. Custom covers are private to your account; your
  profile picture is public, since it doubles as your account's avatar
  once you're signed in.

## What's never collected

- **Your music files.** Audio stays on your device. Nothing is uploaded,
  ever — not even when signed in.
- **Embedded cover art** inside your music files — it stays with the
  file and is never uploaded.
- **Your location.** Used only on your own device, for Sundown's sunset
  calculation. It never leaves the device and is never sent to Miziki or
  anyone else. If you choose the
  Nychthemeron appearance (light by day, dark by night), the only thing
  kept from this is today's sunrise and sunset *times* — never your
  coordinates — so the app can pick the right look before the page even
  finishes loading.
- **Contacts, analytics, advertising identifiers, or tracking of any
  kind.** Miziki makes no requests to any third party at all, other than
  your own Supabase project (the service that stores the account data
  above) when you've signed in.

## Who can see what

- Your listening backup and your custom covers are **private to your
  account** — nobody else, including Miziki's operator, ever reads them
  in the ordinary course of running the app.
- Your handle, display name and avatar are visible to other signed-in
  users, except anyone you've blocked.
- Anything you choose to share — your crate, notes, now-spinning status,
  milestones, listening rhythm — follows your visibility setting
  (private, friends, or everyone; **friends by default**), found in the
  Privacy screen.

## Where your data lives, and for how long

Your account data is stored in Miziki's own Supabase project, hosted in
the US (East region), which acts as a data processor on Miziki's behalf —
it doesn't use your data for its own purposes. Your data is kept until you
delete it or delete your account.

- **To get a copy:** use **Download my data** (Privacy screen) at any
  time, signed in or not. It produces one JSON file with everything
  described above — no audio, no images.
- **To delete it:** use **Delete account** (Account screen). This
  permanently removes your account, handle, backup, custom covers,
  profile picture, and all social data from the server. It's
  irreversible. Your music and listening history on your own device are
  never touched by this — they stay exactly as they are.

## Who can use Miziki

You must be at least **16 years old** to create an account. You must own,
or otherwise have the right to play, any music you add to your library.

## Community rules

If you use the social features, don't impersonate anyone, harass other
users, or post illegal content in your profile, bio, or notes. Reports
against other accounts are reviewed, and violations can lead to content
being removed, an account being restricted, or an account being deleted.

## Changes to this policy

If this policy changes, the date at the top will be updated and the new
version will be shown the same way — as a screen inside the app.

## Contact

Questions about this policy, or about your data: `sckhitokiri@gmail.com`
*(Temporary contact address. Update to an admin@ address on Miziki's own domain once one is purchased.)*
