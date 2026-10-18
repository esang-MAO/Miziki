-- =====================================================================
-- Migration 9: feed privacy fix (RF2, docs/12_REFINE.md)
--
-- Bug: when a crate item's effective visibility is private, the feed
-- trigger only ever deleted its 'pinned'/'review' feed_events rows — never
-- 'added' or 'unlock'. Hiding a record (or a whole profile) therefore left
-- its original "added to crate" event, and any 'unlock' event verified_stats
-- had already written, sitting in public.feed_events, still visible to
-- anyone feed_select's can_view(actor_id, null) check already lets see that
-- actor's feed at all. Hiding a record did not actually hide it from a
-- friend's Home feed.
--
-- Fix, in two parts:
--   1. Re-declare crate_items_emit_events (005_backup.sql's own version —
--      the private.effective_visibility one, not 001/002's public.* one)
--      and crate_items_after_delete (still 001_schema.sql's own version,
--      never re-declared since) with the private-visibility delete widened
--      to all four feed_event_type values, not just 'pinned'/'review'.
--      Bodies are otherwise byte-identical to their currently-live versions.
--   2. public.rebuild_feed_events(p_user uuid): the repair path for any
--      future trigger bug of this shape — deletes the caller's own events
--      and regenerates them from crate_items/verified_stats under today's
--      visibility rules, so a bad trigger's past damage can be undone
--      without a manual SQL cleanup per account. Caller can only ever
--      rebuild their own feed (p_user = auth.uid()), same "can't act on
--      someone else's data" shape as delete_my_account().
-- =====================================================================

create or replace function public.crate_items_emit_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  eff        public.visibility_level;
  is_new     boolean := (TG_OP = 'INSERT');
  old_pin    smallint;
  old_rating smallint;
  old_note   text;
  recent_id  bigint;
  vis_changed boolean := false;
begin
  if current_setting('miziki.quiet', true) = 'on' then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    old_pin := OLD.pin_rank;
    old_rating := OLD.rating;
    old_note := OLD.sleeve_note;
    vis_changed := NEW.visibility is distinct from OLD.visibility;
  end if;

  eff := private.effective_visibility(NEW.user_id, NEW.visibility);

  -- Private items leave no trace in the feed at all — 'added'/'unlock'
  -- included, not just 'pinned'/'review' (RF2: this was the actual bug).
  if eff is null or eff = 'private' then
    delete from public.feed_events
    where actor_id = NEW.user_id and release_id = NEW.release_id
      and type in ('added', 'unlock', 'pinned', 'review');
    return NEW;
  end if;

  if is_new then
    select id into recent_id from public.feed_events
    where actor_id = NEW.user_id and type = 'added'
      and created_at > now() - interval '15 minutes'
    order by created_at desc limit 1;

    if recent_id is not null then
      update public.feed_events
      set payload = jsonb_set(
            payload, '{count}',
            to_jsonb(coalesce((payload->>'count')::int, 1) + 1)),
          created_at = now()
      where id = recent_id;
    else
      insert into public.feed_events (actor_id, type, release_id, payload)
      values (NEW.user_id, 'added', NEW.release_id, '{"count": 1}'::jsonb);
    end if;
  end if;

  if NEW.pin_rank is null then
    delete from public.feed_events
    where actor_id = NEW.user_id and release_id = NEW.release_id and type = 'pinned';
  elsif is_new or old_pin is null or vis_changed then
    delete from public.feed_events
    where actor_id = NEW.user_id and release_id = NEW.release_id and type = 'pinned';
    insert into public.feed_events (actor_id, type, release_id, payload)
    values (NEW.user_id, 'pinned', NEW.release_id, '{}'::jsonb);
  end if;

  if NEW.rating is null and NEW.sleeve_note is null then
    delete from public.feed_events
    where actor_id = NEW.user_id and release_id = NEW.release_id and type = 'review';
  elsif is_new
     or NEW.rating is distinct from old_rating
     or NEW.sleeve_note is distinct from old_note
     or vis_changed then
    delete from public.feed_events
    where actor_id = NEW.user_id and release_id = NEW.release_id and type = 'review';
    insert into public.feed_events (actor_id, type, release_id, payload)
    values (NEW.user_id, 'review', NEW.release_id,
            jsonb_build_object('rating', NEW.rating, 'note', NEW.sleeve_note));
  end if;

  return NEW;
end $$;

create or replace function public.crate_items_after_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.feed_events
  where actor_id = OLD.user_id and release_id = OLD.release_id
    and type in ('added', 'unlock', 'pinned', 'review');
  return OLD;
end $$;

-- ---------- repair path ----------------------------------------------

-- Rebuilds the caller's own feed_events from scratch under today's
-- visibility rules: deletes every row this account is the actor of, then
-- regenerates it from crate_items/verified_stats exactly as the triggers
-- above would have, had they always had this fix. Never widens anything a
-- normal sync wouldn't have written: a private item contributes nothing,
-- same as the triggers.
--
-- security definer, not invoker, same as the trigger functions above and
-- for the same reason: feed_events grants authenticated select/delete/
-- trigger only (no insert, no update -- `\z feed_events` shows
-- `authenticated=rDxt`), since every other write to this table is only
-- ever supposed to happen from inside a trigger running as the table
-- owner. The p_user = auth.uid() check right below is what keeps this
-- definer-rights function from ever touching anyone else's rows, the same
-- shape delete_my_account() already uses for the same reason.
create function public.rebuild_feed_events(p_user uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_user <> auth.uid() then raise exception 'can only rebuild your own feed'; end if;

  delete from public.feed_events where actor_id = p_user;

  -- added: one event per crate item, collapsing nothing (the 15-minute
  -- burst-collapse is an import-time nicety, not a visibility guarantee —
  -- a rebuilt feed with one 'added' row per record is still correct, just
  -- not bunched the way a live, incremental sync would have left it).
  insert into public.feed_events (actor_id, type, release_id, payload, created_at)
  select c.user_id, 'added', c.release_id, '{"count": 1}'::jsonb, c.added_at
  from public.crate_items c
  where c.user_id = p_user
    and private.effective_visibility(c.user_id, c.visibility) is distinct from 'private'
    and private.effective_visibility(c.user_id, c.visibility) is not null;

  -- pinned
  insert into public.feed_events (actor_id, type, release_id, payload, created_at)
  select c.user_id, 'pinned', c.release_id, '{}'::jsonb, c.updated_at
  from public.crate_items c
  where c.user_id = p_user and c.pin_rank is not null
    and private.effective_visibility(c.user_id, c.visibility) is distinct from 'private'
    and private.effective_visibility(c.user_id, c.visibility) is not null;

  -- review
  insert into public.feed_events (actor_id, type, release_id, payload, created_at)
  select c.user_id, 'review', c.release_id,
         jsonb_build_object('rating', c.rating, 'note', c.sleeve_note), c.updated_at
  from public.crate_items c
  where c.user_id = p_user and (c.rating is not null or c.sleeve_note is not null)
    and private.effective_visibility(c.user_id, c.visibility) is distinct from 'private'
    and private.effective_visibility(c.user_id, c.visibility) is not null;

  -- unlock
  insert into public.feed_events (actor_id, type, release_id, payload, created_at)
  select v.user_id, 'unlock', v.release_id,
         jsonb_build_object('variant', v.unlocked_variant),
         coalesce(v.last_session_at, now())
  from public.verified_stats v
  where v.user_id = p_user and v.unlocked_variant is not null
    and private.effective_visibility(
          v.user_id, private.item_visibility(v.user_id, v.release_id)) is distinct from 'private'
    and private.effective_visibility(
          v.user_id, private.item_visibility(v.user_id, v.release_id)) is not null;

  get diagnostics n = row_count;
  return n;
end $$;
