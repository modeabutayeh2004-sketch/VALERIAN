-- VALERIAN journal Realtime wake-up channel.
-- Realtime is a notification only; the cursor-based RPC pull remains authoritative.
-- Run once after 20261118_incremental_sync.sql.

grant select on table public.valerian_sync_changes to authenticated;
drop policy if exists "VALERIAN journal read own" on public.valerian_sync_changes;
create policy "VALERIAN journal read own"
on public.valerian_sync_changes for select to authenticated
using (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'valerian_sync_changes'
  ) then
    alter publication supabase_realtime add table public.valerian_sync_changes;
  end if;
end
$$;

comment on table public.valerian_sync_changes is
  'Append-only per-user incremental sync journal; Realtime INSERT events are wake-up hints and cursor-based RPC pull is authoritative.';
