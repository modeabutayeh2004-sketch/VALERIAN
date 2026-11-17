-- VALERIAN incremental sync foundation
-- Safe additive migration: does not alter or delete valerian_state or its existing snapshot.
-- Run once in the Supabase SQL Editor for project uamxuocwwxoqbiopinuh.

create table if not exists public.valerian_sync_changes (
  seq bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  change_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint valerian_sync_changes_user_change_unique unique (user_id, change_id),
  constraint valerian_sync_changes_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists valerian_sync_changes_user_seq_idx
  on public.valerian_sync_changes (user_id, seq);

alter table public.valerian_sync_changes enable row level security;
revoke all on public.valerian_sync_changes from anon, authenticated;
-- Append a batch idempotently. Each payload is one record-level change/patch.
create or replace function public.valerian_sync_push(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_item jsonb;
  v_change_id uuid;
  v_inserted integer := 0;
  v_cursor bigint;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 731942));

  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'p_changes must be a JSON array';
  end if;
  if jsonb_array_length(p_changes) > 200 then
    raise exception 'Batch limit is 200 changes';
  end if;

  for v_item in select value from jsonb_array_elements(p_changes)
  loop
    if jsonb_typeof(v_item) <> 'object' or not (v_item ? 'change_id') or not (v_item ? 'patch') then
      raise exception 'Each change requires change_id and patch';
    end if;
    v_change_id := (v_item->>'change_id')::uuid;
    insert into public.valerian_sync_changes(user_id, change_id, payload)
    values (v_user, v_change_id, v_item->'patch')
    on conflict (user_id, change_id) do nothing;
    if found then v_inserted := v_inserted + 1; end if;
  end loop;

  select coalesce(max(seq), 0) into v_cursor
  from public.valerian_sync_changes where user_id = v_user;
  return jsonb_build_object('ok', true, 'inserted', v_inserted, 'cursor', v_cursor);
end;
$$;

-- Return ordered changes after a per-user cursor.
create or replace function public.valerian_sync_pull(p_after_seq bigint default 0, p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_changes jsonb;
  v_cursor bigint;
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 500));
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'seq', seq, 'change_id', change_id, 'patch', payload, 'created_at', created_at
    ) order by seq), '[]'::jsonb)
    into v_changes
  from (
    select seq, change_id, payload, created_at
    from public.valerian_sync_changes
    where user_id = v_user and seq > greatest(coalesce(p_after_seq, 0), 0)
    order by seq
    limit v_limit
  ) page;

  select coalesce(max(seq), greatest(coalesce(p_after_seq, 0), 0))
    into v_cursor
  from jsonb_to_recordset(v_changes) as x(seq bigint);

  return jsonb_build_object('ok', true, 'changes', v_changes, 'cursor', v_cursor);
end;
$$;

revoke all on function public.valerian_sync_push(jsonb) from public, anon;
revoke all on function public.valerian_sync_pull(bigint, integer) from public, anon;
grant execute on function public.valerian_sync_push(jsonb) to authenticated;
grant execute on function public.valerian_sync_pull(bigint, integer) to authenticated;

comment on table public.valerian_sync_changes is
  'Append-only per-user incremental sync journal. Existing valerian_state snapshots remain intact.';

-- Stable bootstrap point: every device starts from the same immutable legacy snapshot
-- and replays only journal entries created after the migration baseline.
create table if not exists public.valerian_sync_baselines (
  user_id uuid primary key references auth.users(id) on delete cascade,
  base_state jsonb,
  base_cursor bigint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.valerian_sync_baselines enable row level security;
revoke all on public.valerian_sync_baselines from anon, authenticated;

create or replace function public.valerian_sync_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_state jsonb;
  v_cursor bigint;
  v_revision bigint := 0;
  v_updated_at timestamptz;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 731942));

  select base_state, base_cursor
    into v_state, v_cursor
  from public.valerian_sync_baselines
  where user_id = v_user;

  if not found then
    select state, revision, updated_at
      into v_state, v_revision, v_updated_at
    from public.valerian_state
    where user_id = v_user;

    select coalesce(max(seq), 0) into v_cursor
    from public.valerian_sync_changes
    where user_id = v_user;

    insert into public.valerian_sync_baselines(user_id, base_state, base_cursor)
    values (v_user, v_state, v_cursor)
    on conflict (user_id) do nothing;

    select base_state, base_cursor
      into v_state, v_cursor
    from public.valerian_sync_baselines
    where user_id = v_user;
  else
    select revision, updated_at into v_revision, v_updated_at
    from public.valerian_state where user_id = v_user;
  end if;

  return jsonb_build_object(
    'ok', true,
    'state', v_state,
    'cursor', coalesce(v_cursor, 0),
    'revision', coalesce(v_revision, 0),
    'updated_at', v_updated_at
  );
end;
$$;

revoke all on function public.valerian_sync_bootstrap() from public, anon;
grant execute on function public.valerian_sync_bootstrap() to authenticated;
