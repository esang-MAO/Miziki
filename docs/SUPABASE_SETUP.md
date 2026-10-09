# Supabase setup checklist

A step-by-step checklist for setting up the Supabase project behind Miziki's
social layer and (once B1 ships) account backup. Written so it can be
followed on a phone or a laptop, in order, top to bottom. Nothing here needs
a terminal — every step is in the Supabase dashboard.

**Do this once**, before any of the backup feature's B1–B3 PRs are merged.
Those PRs assume a working project with sign-in already tested.

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

**Never edit a migration that's already been applied** — if something needs
to change later, it goes in a new numbered file (`005_...`, and so on; the
account-backup PRs will add `005_backup.sql` and, later, `006_images.sql`).

**Verify it worked:** open **Table Editor** in the sidebar. You should see
`profiles`, `follows`, `blocks`, `releases`, and the rest of the tables from
`001_schema.sql`, plus whatever `003`/`004` added. If a table is missing,
re-check that file ran without an error before moving on — running them out
of order, or skipping one, is the most common way this breaks.

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
