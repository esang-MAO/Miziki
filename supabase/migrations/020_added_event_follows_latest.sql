-- =====================================================================
-- Migration 20: the collapsed "added" event follows the latest item
--
-- Bug (found verifying PR #170, flagged by a pre-existing failing test:
-- "RF2/RF21: deleting a crate item entirely removes its added events"):
-- crate_items_emit_events()'s 15-minute burst-collapse, on finding a
-- recent 'added' row for the same actor, bumped that row's payload count
-- and created_at -- but never its release_id. The row stayed permanently
-- pointed at whichever release started the burst, so:
--   1. A later item added in the same burst got no feed_events row of its
--      own at all -- a friend's Home feed showed the *first* record added,
--      never the most recent, however many more followed it.
--   2. Removing that later item from the crate matched nothing in
--      crate_items_after_delete (which deletes by release_id), so the
--      stale row for the first-added release was never cleaned up by
--      removing a different one.
--
-- Fix: the UPDATE branch also sets release_id = NEW.release_id, so a
-- collapsed "added N records" event always tracks whichever item was
-- added most recently -- the same item a friend's feed card can actually
-- show art/title for. rebuild_feed_events() is untouched: it already
-- builds one row per crate item with no collapsing at all (009's own
-- comment: "a rebuilt feed with one 'added' row per record is still
-- correct, just not bunched the way a live, incremental sync would
-- have left it"), so there's nothing stale there to fix.
--
-- Body is otherwise byte-identical to 009_feed_privacy.sql's version.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 19) then
    raise exception 'migration 019 must be applied before 020';
  end if;
end $$;

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

  -- Private items leave no trace in the feed at all -- 'added'/'unlock'
  -- included, not just 'pinned'/'review' (RF2: this was the actual bug).
  if eff is null or eff = 'private' then
    delete from public.feed_events
    where actor_id = NEW.user_id and release_id = NEW.release_id
      and type in ('added', 'unlock', 'pinned', 'review');
    return NEW;
  end if;

  -- added: collapse bursts (imports) into one event per 15 minutes --
  -- always re-pointed at the most recently added item in the burst (see
  -- this migration's own header comment for why release_id moves too).
  if is_new then
    select id into recent_id from public.feed_events
    where actor_id = NEW.user_id and type = 'added'
      and created_at > now() - interval '15 minutes'
    order by created_at desc limit 1;

    if recent_id is not null then
      update public.feed_events
      set release_id = NEW.release_id,
          payload = jsonb_set(
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

insert into private.schema_migrations (version) values (20);
