# Moderation

How to review reports against Miziki accounts and what to do about them.
Everything here happens in the Supabase dashboard — no terminal, no admin
screen in the app itself. `public.reports` is write-only for users by design
(RLS lets someone insert their own report and read it back, nothing else —
see `supabase/migrations/001_schema.sql`'s own comment: "write-only for
users, review via service role / dashboard") — this doc is that review.

## How often

**Weekly is fine at this scale.** Open the dashboard, run the query in the
next section, work through whatever's there. If a report ever looks urgent
(a threat, something that needs to come down now), don't wait for the next
weekly pass — do it the same day.

## Reviewing reports

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Run:

   ```sql
   select r.id, r.created_at,
          reporter.handle as reporter_handle,
          target.handle   as target_handle,
          target.id       as target_user_id,
          r.release_id, rel.title as release_title, rel.artist as release_artist,
          r.reason, r.status
   from public.reports r
   join public.profiles reporter on reporter.id = r.reporter_id
   join public.profiles target   on target.id   = r.target_user_id
   left join public.releases rel on rel.id = r.release_id
   where r.status = 'open'
   order by r.created_at asc;
   ```

3. For each row, read the reason, decide which action below applies (if
   any), do it, then mark the report so it doesn't show up again next time:

   ```sql
   update public.reports set status = 'actioned' where id = <id>;
   -- or 'dismissed' if nothing was wrong
   ```

   `status` is a plain `text` column (no enum), so any value works — `open`
   (the default on insert), `actioned` and `dismissed` are just the three
   this doc uses consistently. Pick whichever of the other two fits and
   stay consistent, so next week's query (`where r.status = 'open'`) only
   ever shows what's genuinely still pending.

   **One ordering note for account deletion specifically**: deleting an
   account cascades away any report that names it as the target (see
   below) — close out *that* report, or at least copy its `reason` and
   `created_at` somewhere you'll keep them, **before** you run the delete,
   not after. There's no separate moderation log in this schema; the
   `reports` row is the only record of why an action happened, and the
   delete removes it along with everything else.

## Finding a user

Most actions below need the target's `profiles.id` (a uuid), not just
their handle:

```sql
select id, handle, display_name from public.profiles where handle = '<handle>';
```

(The report query above already includes `target_user_id`, so you usually
won't need this separately — it's here for when a report names someone by
handle only, or you're looking someone up from outside a report.)

## Actions

### Clear an avatar or bio

```sql
update public.profiles
set avatar_url = null, bio = null   -- or just one of the two
where id = '<user-id>';
```

(Table Editor → `profiles` → find the row → edit the `avatar_url`/`bio`
cells directly works the same way, if you'd rather click than type SQL.)

This stops Miziki from showing the avatar or bio **but doesn't delete the
stored image file** — `avatar_url` is just a pointer into the `avatars`
Storage bucket, which the column update never touches. If the avatar itself
is the problem (not just "the bio is empty now so the picture looks odd"),
also delete the file:

1. Dashboard → **Storage** → `avatars` bucket.
2. Browse to the `<user-id>/` folder.
3. Delete the `avatar-<hash>.jpg` file(s) inside it.

The account can upload a new picture later, which lands under a new hash —
clearing the column and the file only removes what's there today.

### Remove a sleeve note

Sleeve notes live on `crate_items`, one per `(user_id, release_id)` pair.
Find the offending one (the report query above gives you `release_id`
directly when the report is about a specific record; otherwise, list
everything that user has a note on):

```sql
select c.release_id, r.title, r.artist, c.sleeve_note
from public.crate_items c
join public.releases r on r.id = c.release_id
where c.user_id = '<user-id>'
  and c.sleeve_note is not null;
```

Then clear it:

```sql
update public.crate_items
set sleeve_note = null
where user_id = '<user-id>' and release_id = '<release-id>';
```

(Table Editor → `crate_items` → find the row by `user_id`/`release_id` →
clear the `sleeve_note` cell works the same way.)

### Rebuild someone's feed events

The feed triggers (`crate_items_emit_events`/`crate_items_after_delete`,
`supabase/migrations/001_schema.sql`/`005_backup.sql`/`009_feed_privacy.sql`)
are what's supposed to keep `public.feed_events` in sync with a user's own
crate/stats visibility — a private record should leave no trace there. If a
future bug in one of those triggers ever lets a stale or wrongly-visible
event sit in the feed (the shape of the bug `009_feed_privacy.sql` itself
fixed — see its own header comment), there's a repair path that doesn't
need a one-off manual cleanup: `public.rebuild_feed_events(p_user uuid)`
deletes every `feed_events` row that account is the actor of and
regenerates it from `crate_items`/`verified_stats` under today's visibility
rules — exactly what the triggers would have written, had they always had
today's fix.

It only ever rebuilds the caller's own feed (`p_user = auth.uid()`; it
raises otherwise), so from the SQL editor — not signed in as anyone — it
can't be run on someone else's behalf. If you need to fix a specific
user's feed as a moderator, run it from the **impersonation** feature in
Supabase's Auth dashboard (sign in as that user, run the RPC in that
session) or, if that isn't available, give the account the fix via its
own UI (reinstating the correct visibility setting and letting the client
re-sync triggers it naturally). For most reports, you won't need this at
all — it exists for "the trigger itself was wrong for a while," not for
day-to-day moderation.

### Delete an account

The in-app "Delete account" button (Account screen → type-your-handle-to-
confirm → `MizikiSocial.deleteAccount()`) only works for someone acting on
their *own* account — the underlying `delete_my_account()` RPC is written
`where id = auth.uid()`, and running it from the SQL editor doesn't change
that: the SQL editor isn't signed in as that user, so `auth.uid()` wouldn't
resolve to them and the RPC would just raise "not signed in." To remove an
account as a moderator, delete the `auth.users` row directly instead:

```sql
delete from auth.users where id = '<user-id>';
```

`on delete cascade` foreign keys do the rest, the same cascades
`delete_my_account()` itself relies on — `profiles`, `follows`, `blocks`,
`crate_items`, `verified_stats`, `now_spinning`, `digging_list`,
`feed_events`, `library_backup`, `library_backup_history`,
`release_credits`, and (per the ordering note above) any `reports` row
naming this account as the target, all disappear in the same transaction.

**Deletion checklist (RF25, `docs/12_REFINE.md`)** — what a full account
delete leaves behind, and what doesn't clean itself up:

1. **Backup tombstones across the account's own devices.** `library_backup`
   has one row per `(user_id, device_id)` — every device this account ever
   signed into, not just the one doing the deleting. The `user_id` foreign
   key cascades all of them (and their `library_backup_history` rows,
   migration `014_backup_history.sql`) in the same transaction as the
   `auth.users` delete — nothing to do by hand here, this item is only on
   the checklist so a reviewer doesn't have to re-derive that it's already
   covered.
2. **Orphaned Storage files** — `covers`/`avatars` objects have no foreign
   key to `auth.users` (the same limitation `006_images.sql`'s own closing
   comment flags: Storage cleanup on account deletion has to happen
   client-side, in `deleteAccount()`'s own `removeStorageFolder()` calls,
   which only run when the *user* deletes their own account through the
   app). **This never touches Storage** when run as a moderator, so clean
   up both buckets by hand right after:
   1. Dashboard → **Storage** → `covers` bucket → browse to `<user-id>/` →
      select all files → delete.
   2. Dashboard → **Storage** → `avatars` bucket → browse to `<user-id>/` →
      select all files → delete.
3. **`feed_events` about the deleted account.** `feed_events.actor_id`
   references `profiles.id` (itself cascading from `auth.users`), so every
   row this account ever posted to the feed is removed along with the rest
   — nothing to do by hand. (RF21's own 45-day expiry sweep would have
   removed most of these anyway; this just means none linger past that.)
4. **`release_credits` rows** (RF23, migration `017_credits_across_friends.sql`)
   — `user_id` cascades the same way, so every credit this account ever
   synced from its own crate disappears with it. Nothing to do by hand.

Everything cascades except Storage (step 2) — that's the one manual step.

Irreversible, same as the in-app version — there's no undo once the
`auth.users` row is gone.

### Restoring a device's backup from history

`public.library_backup_history` (migration `014_backup_history.sql`, RF19)
keeps the last 10 rows a device's own `library_backup` row has ever held,
written by a `before update` trigger right before each overwrite. Nothing in
the app reads this table — it exists only for a moderator (or Ken himself,
from the dashboard) to look at or restore from, if a bad push (a client bug,
a doc that somehow slipped past the client's own `validateDoc()` checks)
ever leaves a device's row worse off than it was.

See what a device's history looks like:

```sql
select recorded_at, doc_seq, checksum, updated_at
from public.library_backup_history
where user_id = '<user-id>' and device_id = '<device-id>'
order by recorded_at desc;
```

Restore the most recent history row back onto the live row (this does
**not** itself go through `put_library_backup()`'s `doc_seq` guard — running
it is a deliberate override, so double-check you're restoring the row you
mean to before running it):

```sql
update public.library_backup lb
set doc = h.doc, doc_seq = h.doc_seq, checksum = h.checksum,
    schema_version = h.schema_version, device_label = h.device_label
from (
  select * from public.library_backup_history
  where user_id = '<user-id>' and device_id = '<device-id>'
  order by recorded_at desc limit 1
) h
where lb.user_id = h.user_id and lb.device_id = h.device_id;
```

That device picks up the restored doc on its very next pull. The restore
itself fires the same `before update` trigger, so the row being overwritten
is captured into history too — nothing is ever lost by restoring.
