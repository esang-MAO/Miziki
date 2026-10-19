-- =====================================================================
-- Migration 18: stale backup devices (RF25 point 3, docs/12_REFINE.md)
--
-- A device that hasn't synced in 12 months is still taking up a row in
-- library_backup, still counted in the Account screen's device list, and
-- still has a vote in every future merge (src/sync/merge.js) even though
-- nobody's touched it in a year. RF25 asks for a notice on the Account
-- screen ("[Device] hasn't synced since [date]. Remove it?") rather than
-- a silent server-side sweep -- deleting someone's backup data without
-- an explicit tap is the kind of destructive action this project avoids
-- elsewhere (see CLAUDE.md's own RF1 "a clear on one device stays
-- cleared everywhere" -- even that is a client-initiated reset, never an
-- automatic one). So this migration adds no cron job: it only adds the
-- one column the client needs to remember "the user said keep this one",
-- so the notice doesn't keep nagging about a device they've already
-- confirmed they still want.
--
-- The actual delete, when the user taps "Remove", is a plain client-side
-- `.from('library_backup').delete().eq('device_id', ...)` -- the existing
-- library_backup_delete policy (`user_id = auth.uid()`, 005_backup.sql)
-- already allows a signed-in user to delete any of their own device rows,
-- so no new RPC is needed for that half either.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 17) then
    raise exception 'migration 017 must be applied before 018';
  end if;
end $$;

alter table public.library_backup
  add column stale_notice_dismissed_at timestamptz;

insert into private.schema_migrations (version) values (18);
