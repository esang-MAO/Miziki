# Supabase setup checklist

A step-by-step checklist for setting up the Supabase project behind Miziki's
social layer and (once B1 ships) account backup. Written so it can be
followed on a phone or a laptop, in order, top to bottom. Nothing here needs
a terminal — every step is in the Supabase dashboard.

**Do this once**, before any of the backup feature's B1–B3 PRs are merged.
Those PRs assume a working project with sign-in already tested.

Steps 1–7 below are about **this one project** — the real, production
Supabase project every migration has gone straight at until step RF5. **See
"8. Staging: a second project to push migrations through first"** at the
end of this file for the one-time staging setup RF5 (`docs/12_REFINE.md`,
point 2) adds on top of all of this, and the workflow every migration from
`013_...` on should follow.

---

## 1. Create the project

1. Go to [supabase.com](https://supabase.com) and sign in (or create an account).
2. **New project** → pick your organization (or create one — it's free for
   this).
3. **Name:** `miziki` (or anything you'll recognize).
4. **Database password:** generate a strong one and save it somewhere safe
   (a password manager). You won't need it day-to-day — the app only ever
   uses the anon key (step 5) — but you'll want it if you ever need to
   connect a Postgres client directly.
5. **Region:** pick the one physically closest to Maryland —
   **US East (N. Virginia)**. It's the AWS region Supabase offers nearest to
   you, and keeps the round-trip for every sign-in and sync short.
6. **Pricing plan:** the free tier is enough for this — one project, your
   own testing, and friends-and-family use. Create the project and wait for
   it to finish provisioning (a minute or two).

   **Free-tier projects pause themselves after a week with no activity.**
   That's fine while you're building and testing yourself — just open the
   project in the dashboard (or sign in through the app) to wake it back up.
   Upgrade to a paid plan before real people start relying on sign-in or
   backups, so the project doesn't go quiet on them between visits.

---

## 2. Apply the migrations, in order

Miziki's schema lives in `supabase/migrations/` in the repo, as plain `.sql`
files, numbered in the order they must run. Apply them with the dashboard's
SQL editor — no CLI needed.

For **each** file below, in this exact order:

1. Open the file in the repo (`supabase/migrations/<name>.sql`) and copy its
   entire contents.
2. In the Supabase dashboard: **SQL Editor** (left sidebar) → **New query**.
3. Paste the file's contents in, exactly as they are — don't edit anything.
4. Click **Run**. It should finish with no errors.
5. Move to the next file.

Order:

1. `001_schema.sql` — the core tables (profiles, follows, blocks, releases,
   etc.), types, and row-level security.
2. `002_rpc.sql` — the RPC functions the client calls.
3. `003_digging.sql` — the digging-list table.
4. `004_follow_counts.sql` — follower/following counts.
5. `005_backup.sql` — the account-backup table, reserved handles, account
   deletion, and a security hardening pass. **See its own section below**
   before applying this one — it needs a follow-up step (re-running the
   Security Advisor) that the others don't.
6. `006_images.sql` — the `covers` and `avatars` Storage buckets and their
   policies, for custom cover art and the profile picture / public avatar.
   **See its own section below** — it needs a follow-up check (confirming
   the buckets exist with the right settings) the SQL alone can't prove.

**Never edit a migration that's already been applied** — if something needs
to change later, it goes in a new numbered file (`006_...`, and so on).

**Verify it worked:** open **Table Editor** in the sidebar. You should see
`profiles`, `follows`, `blocks`, `releases`, and the rest of the tables from
`001_schema.sql`, plus whatever `003`/`004` added. If a table is missing,
re-check that file ran without an error before moving on — running them out
of order, or skipping one, is the most common way this breaks.

### Applying `005_backup.sql`

This one needs a follow-up step the earlier four don't, because part of what
it does is fix findings from Supabase's own **Security Advisor** scan.

1. Apply it the same way as every other migration (copy, paste into a new
   SQL editor query, **Run**). It should finish with no errors.
2. **Verify the new table:** **Table Editor** → confirm `library_backup`
   exists, with columns `user_id`, `device_id`, `device_label`,
   `schema_version`, `doc`, `updated_at`.
3. **Re-run the Security Advisor:** **Advisors** (sidebar) → **Security
   Advisor** → **Rerun linter** (or refresh the page — it re-scans
   automatically on load too). Confirm the four `security definer`-function-
   in-`public` findings this migration fixes are gone:
   `is_blocked_between`, `item_visibility`, `effective_visibility`, and
   `can_view` — all four now live in a new `private` schema the Advisor
   (and the Data API) can't reach directly. The "Leaked password
   protection" suggestion, if the Advisor still shows it, doesn't apply to
   this app — Miziki signs in with emailed one-time codes, never
   passwords; it's safe to leave as is.
4. **Test reserved handles**: try (as yourself, or a throwaway test
   account) to claim the handle `admin` or `support` — it should be
   rejected with "That handle is reserved." A handle you'd already claimed
   before this migration keeps working untouched; this only blocks new
   claims and renames going forward.

`public.delete_my_account()` (added by this migration too) isn't called
from the app yet — there's no "delete my account" button in Settings as of
this step — so there's nothing to test by hand here beyond confirming the
migration itself applied cleanly. See CLAUDE.md's step 05 changelog entry
for the full detail on everything `005_backup.sql` does.

### Applying `006_images.sql`

This one creates two **Storage** buckets, not database tables — Supabase
Storage has its own section of the dashboard, separate from Table Editor,
so the usual "check Table Editor" verification doesn't apply here.

1. Apply it the same way as every other migration (copy, paste into a new
   SQL editor query, **Run**). It should finish with no errors.
2. **Verify the buckets:** **Storage** (sidebar) → confirm two buckets
   exist: `covers` and `avatars`.
   - `covers` should show as **Private**, with a file size limit around
     **1 MB** and allowed types `image/jpeg`, `image/webp`.
   - `avatars` should show as **Public**, with a file size limit around
     **300 KB** and the same two allowed types.
3. **Manual policy check** (RLS on `storage.objects` can't be fully
   exercised from the SQL editor the way a table's policies can, since
   there's no `auth.uid()` session there to sign in as — this is the
   "manual-check fallback" the B4 spec itself asks for): with two
   different signed-in test accounts (or one account and a signed-out
   browser tab for the avatars half):
   - Set a custom cover on a track (the edit sheet's art picker) on
     account A, then sign in as account B and confirm there's no way to
     read or list account A's file under `covers/<A's user id>/` — the
     Storage API should return nothing, same as a real cross-user RLS
     rejection.
   - Set a profile picture on account A, then open the app **signed out**
     (or as account B) and confirm the picture is visible — `avatars` is
     the one bucket that's supposed to be readable by anyone.
   - Still signed in as account B, confirm there's no way to upload or
     delete a file under `avatars/<A's user id>/` — only A's own session
     can write there.
   This mirrors what `tests/client.test.js`'s own `covers`/`avatars` tests
   already check against a real Postgres `storage.objects` stand-in (see
   `tests/supabase_stub.sql`) — this manual pass is the real-Supabase-API
   confirmation that the actual Storage service enforces the same thing,
   plus the one thing the stub can't check at all: the `file_size_limit`/
   `allowed_mime_types` enforcement itself (try uploading an oversized or
   wrong-type file from the app and confirm it's rejected, rather than
   silently accepted).

Account deletion's own Storage cleanup (every file under both buckets'
`<user id>/` folder, since Storage objects have no foreign key to
`auth.users` for `delete_my_account()`'s cascades to reach) happens in the
app (`src/miziki-social.js`'s `deleteAccount()`), before the RPC call —
nothing in this migration does it. See CLAUDE.md's step 07 changelog entry
for the full detail on everything `006_images.sql` does and how the app
uploads/downloads/cleans up around it.

---

## 3. Turn on email sign-in with one-time codes

Miziki signs people in with a **6-digit code**, not a magic link. This
matters specifically because the app is used as a home-screen app on iPhone:
tapping a link in the Mail app would open Safari and strand the session
there, outside the installed app, instead of back in Miziki. (See the
comment above `signInWithOtp`/`verifyOtp` in `src/miziki-social.js` if you
want the exact reasoning.) Supabase's default email template sends a link;
this step changes that so the email shows a code instead.

1. **Authentication** (sidebar) → **Providers** → make sure **Email** is
   enabled. (It is by default.) Leave "Confirm email" settings as the
   Supabase default — the app doesn't use email/password sign-up, only the
   code flow.
2. **Authentication** → **Email Templates** → edit **both** of these the
   same way:
   - **Magic Link** — the template `signInWithOtp` actually sends for an
     existing user signing back in.
   - **Confirm signup** — a brand-new email on its very first sign-in can
     get this template instead. If it still shows the default link, that
     new user's first sign-in attempt opens Safari and strands them there
     instead of back in the app — the same problem the Magic Link template
     has by default, just on first use instead of every time. Supabase
     doesn't have a separate "OTP" template for either case, so both of
     these existing ones need the same edit.

   Supabase exposes the raw 6-digit code to every email template as
   `{{ .Token }}`, regardless of the template's name — this works
   identically in both templates above.
3. Replace **each** template's body with something that shows the code
   front and center. Use the same subject and body in both:

   **Subject:**
   ```
   Your Miziki sign-in code
   ```

   **Body (HTML):**
   ```html
   <h2>Your Miziki sign-in code</h2>
   <p>Enter this code in the app to sign in:</p>
   <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px;">{{ .Token }}</p>
   <p>This code expires shortly. If you didn't request it, you can ignore this email.</p>
   ```

   The link variables (`{{ .ConfirmationURL }}` etc.) that come in the
   default template can be deleted — the app never uses them, and leaving
   them in just invites someone to tap the wrong thing.
4. Save both templates. There's no separate toggle for "code mode" —
   sending the code instead of a usable link is purely a property of what
   the template displays; `signInWithOtp`/`verifyOtp` on the client side
   already expect a code and don't change.
5. **Code expiration and length:** **Authentication** → **Sign In /
   Providers** → **Email** → **"Email OTP expiration"** controls how long a
   sent code stays valid — it defaults to 1 hour, which is fine to leave as
   is. The app's own check (`src/miziki-social.js`) accepts any 6–8 digit
   code, so it won't reject a code if this setting is ever changed.

---

## 4. Site URL and redirect URLs

**Authentication** → **URL Configuration**.

- **Site URL:** set to the real deployed app —
  `https://esang-mao.github.io/Miziki/miziki.html`.
- **Redirect URLs:** add both places the app runs, so Supabase will accept
  either as a valid origin:
  - `https://esang-mao.github.io/Miziki/*`
  - `https://deploy-preview-*--miziki.netlify.app/*` (Netlify's preview URL
    pattern — one per PR, e.g. `deploy-preview-48--miziki.netlify.app`; the
    wildcard covers all of them without adding one per PR)

Today's code-based sign-in (`signInWithOtp` → enter the code →
`verifyOtp`) never actually follows a redirect — there's no link to click,
so these settings aren't exercised by the flow you'll test in step 7. Set
them anyway: Supabase requires a Site URL regardless, other email templates
reference it, and any future auth flow (password reset, an OAuth provider)
would need the redirect allowlist already in place.

---

## 5. Project URL and key → `src/state.js`

**Project Settings** (gear icon, bottom of sidebar) → **API Keys**.

Supabase is retiring the legacy `anon`/`service_role` keys by the end of
2026, in favor of a new pair, and new projects may only show the new ones.
Use whichever pair your project's **API Keys** page shows — if it's the new
pair:

- **Project URL** — looks like `https://xxxxxxxxxxxx.supabase.co`.
- **Publishable key** — under **"Publishable and secret API keys"**, starts
  `sb_publishable_...`.

These go into `src/state.js`:

```js
export const SOCIAL_SUPABASE_URL = '';          // <- Project URL here
export const SOCIAL_SUPABASE_ANON_KEY = '';     // <- publishable key here
```

`SOCIAL_SUPABASE_ANON_KEY` keeps its old name for now even though it holds
the new publishable key — `supabase-js` accepts a publishable key anywhere
it used to take an anon key, and row-level security protects the data
exactly the same way either key is named.

**The publishable key is safe to put in client code and commit to the
repo**, the same way the old anon key was. It's meant to be public — RLS
(the policies the migrations set up) is what actually protects everyone's
data, not keeping this key secret.

**The secret key (`sb_secret_...`, same page) must never go in the repo, in
`src/state.js`, or anywhere in client code** — same rule, same reasoning, as
the old `service_role` key it replaces: it bypasses row-level security
entirely. If you ever need it (for the Postgres test harness, for example),
it belongs in a local environment variable or CI secret, never committed.

If your project still shows the legacy pair instead, the same rules carry
over unchanged: the **anon / public** key (a JWT starting `eyJ...`) is the
one that goes into `SOCIAL_SUPABASE_ANON_KEY`, and **`service_role`** is the
one that never goes in the repo.

Per Part 0's own instructions, filling in the project URL and key is a
**separate, small PR** by itself — not part of this checklist's PR, and not
something to do before the project exists.

**Done, as of step 04.** `src/state.js` now has this project's real URL and
publishable key. **That PR also had to widen the CSP** (`miziki.html`'s
`<meta http-equiv="Content-Security-Policy">`) — the project's
`https://<ref>.supabase.co` origin in both `connect-src` and `img-src`, and
`wss://<ref>.supabase.co` in `connect-src` for the realtime subscription.
If you're repeating this setup for a different project later, remember that
CSP update too — without it, sign-in fails closed with a CSP violation,
not a clear error. See CLAUDE.md's "Security" section for the exact policy.

---

## 6. Email rate limits, and moving to a real sender later

Supabase's built-in email sending (the one you've been using in steps 3–5)
is rate-limited — on the free tier, a small number of emails per hour.
That's **fine for testing**: setting up sign-in yourself, and the two-device
testing the backup PRs ask for later, both fit comfortably inside it.

It is **not** enough once real people (friends, family) start signing up —
you'll hit the limit and some of them won't get their code. Before inviting
anyone beyond yourself, plug in a real email sender:

1. Pick an SMTP provider. Any standard one works — Resend, Postmark,
   SendGrid, Amazon SES, even a personal account with a provider that allows
   SMTP (results vary; a transactional-email provider is the reliable
   choice).
2. **Project Settings** → **Auth** → **SMTP Settings** → enable "Custom
   SMTP" and fill in the host, port, username, password and sender address
   your provider gives you.
3. Save, then re-test sign-in (step 7 below) once more — codes should now
   arrive from your own sender address instead of Supabase's shared one, and
   won't be rate-limited the same way.

This step can wait until you're actually ready to invite people — it isn't
needed to finish Part 0 or to start on B1.

---

## 7. Confirm it all works

1. Open the Netlify preview (or run `MIZIKI_BASE=/ npm run dev` locally) for
   whichever PR has `SOCIAL_SUPABASE_URL`/`SOCIAL_SUPABASE_ANON_KEY` filled
   in.
2. Go to sign-in, enter a test email, and confirm a code arrives showing
   the big `{{ .Token }}` number from step 3 — not a link.
3. Enter the code, confirm you're signed in, and claim a handle.
4. In the Supabase dashboard, **Table Editor** → `profiles` — confirm a new
   row appeared with your handle.

Once this works, you're ready for B1.

---

## 7b. Connected crate: the MusicBrainz edge function (optional, off by default)

The artist page's Connected shelf reads a shared cache (`023_artist_connections.sql`) that one edge function fills from MusicBrainz. Everything ships switched off; the shelf just stays hidden. To turn it on, follow **docs/20_CONNECTED.md → Switching it on** (deploy `mb-connections`, set `MB_CONTACT` and `MB_ENABLED=true`, update the privacy text in the same PR). Unset `MB_ENABLED` to stop all MusicBrainz traffic without a redeploy.

---

## 8. Staging: a second project to push migrations through first

(Step RF5, `docs/12_REFINE.md`, point 2 — "guardrails for a one-person
team.")

Through migration 012, every migration has gone straight at the one real
project from steps 1–7 above, with no intermediate check beyond the local
Postgres harness (`tests/client.test.js`, `tests/supabase_stub.sql`). That
harness is a close stand-in for Postgres itself (RLS, triggers, functions),
but it isn't a real Supabase project: no real `auth.users`/Supabase Auth, no
real Storage buckets, no realtime publication actually pushing to a client,
and no Supabase CLI migration history to catch a file applied out of order.
A migration that only looks right against the local stub can still fail, or
do the wrong thing, against the real service. With one person doing all of
this, there's no second reviewer to catch that before it reaches real user
data — so the check has to be a second environment instead.

### One-time setup

1. **Create a second, free Supabase project**, the same way as step 1 above
   — any name that's clearly not production works, e.g. "Miziki staging."
   The free tier is enough; staging never needs to hold real user data,
   only enough to exercise a migration and the app's own calls against it.
   Its own free-tier pause-after-a-week behavior (step 1's own note) doesn't
   matter here the way it does for production — staging being asleep
   between migrations is fine.
2. **Install the Supabase CLI** (`npm install -g supabase`, or see
   [Supabase's own CLI docs](https://supabase.com/docs/guides/cli) for the
   current install method — this changes faster than this file should try
   to track it). Unlike steps 1–7 above, this part does need a terminal.
3. **Link the CLI to a project**, from the repo root:
   ```
   supabase link --project-ref <project-ref>
   ```
   (`supabase link` stores which project a later `db push` targets; re-run
   it with the other project's ref to switch targets — the CLI doesn't hold
   both linked at once.) A project's ref is the subdomain in its own
   `https://<ref>.supabase.co` URL (step 5 above).
4. The staging project's own ref/URL/keys are **Ken's own credentials,
   never committed to this repo** — keep them the same way the production
   publishable key already lives only in `src/state.js` as a public,
   RLS-protected value, never the secret key, which never belongs in source
   control for either project.
5. To exercise the app itself against staging rather than production, point
   whichever build is testing at its URL/anon key — easiest as a local,
   uncommitted override of `src/state.js`'s own
   `SOCIAL_SUPABASE_URL`/`SOCIAL_SUPABASE_ANON_KEY` for that one test,
   reverted before committing, never a second code path baked into the app
   (there is exactly one social config, production's, same as today — see
   CLAUDE.md's "Social config" section).

### The workflow, from migration 013 on

1. Write the migration as a new numbered file in `supabase/migrations/`,
   same as always (see CLAUDE.md's own rules: apply in numeric order, never
   edit an already-applied migration, and — since `012_migrations_log.sql`
   — open with an assertion that the previous ledger version is present and
   close by inserting its own).
2. Validate it against the local Postgres harness first, same as every
   migration before this step (`tests/client.test.js`) — this is the fast,
   every-day check and stays the first gate, not a replacement for staging.
3. **Push to staging first:**
   ```
   supabase link --project-ref <staging-project-ref>
   supabase db push
   ```
   `db push` applies whichever migrations in `supabase/migrations/` staging
   doesn't already have, in order, using the CLI's own migration-history
   tracking (a second, independent check from `private.schema_migrations`
   above — the CLI's history lives in staging/production's own
   `supabase_migrations` schema, not in this repo).
4. **Exercise it for real against staging** — sign in, run the feature the
   migration supports, watch for anything the local stub couldn't have
   caught (a Storage policy, a realtime payload, an actual emailed sign-in
   code) — the same "verify it worked" instinct steps 2's and 2/006's own
   sections above already ask for, just against a throwaway project instead
   of production.
5. **Only once staging looks right, push to production:**
   ```
   supabase link --project-ref <production-project-ref>
   supabase db push
   ```
   (Steps 2–7 above didn't use the CLI at all — they were applied by hand
   through the dashboard's SQL editor, before this workflow existed. That's
   fine; the CLI's migration-history tracking only needs to know the
   migrations it's pushed itself, and `db push` against production the
   first time under this workflow will simply try to (re-)apply everything
   in `supabase/migrations/` the CLI hasn't recorded yet — reconcile that
   the first time by hand if it tries to re-run something already applied
   by hand earlier, rather than assuming it'll skip them correctly.)
6. If something's wrong on staging, fix it with a *new* numbered migration
   file (never edit the one that just ran) and repeat from step 2 —
   staging is disposable; if it ever gets into a state that's easier to
   throw away than fix forward, drop and recreate the project rather than
   trying to reconcile it by hand.

### What staging is for, and what it isn't

- It's the place a migration gets exercised against real Supabase semantics
  before it ever touches an account that matters.
- It is not a second copy of production data, not a place to keep real
  users' information, and not something CI touches — this is a manual,
  Ken-run step between "the migration passes locally" and "the migration is
  live," the same one-person-team discipline the rest of
  `docs/12_REFINE.md`'s Phase A is about.
- A thread continuing this plan that needs to push a migration through this
  workflow needs Ken's own staging project ref and CLI link — it can't
  create or access the staging project itself.
