-- VALERIAN metadata-only bootstrap for existing devices.
-- Existing devices keep their local incremental cursor and do not download the
-- immutable legacy baseline snapshot on every sign-in.
create or replace function public.valerian_sync_bootstrap_meta()
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

  select base_cursor
    into v_cursor
  from public.valerian_sync_baselines
  where user_id = v_user;

  if not found then
    select state, revision, updated_at
      into v_state, v_revision, v_updated_at
    from public.valerian_state
    where user_id = v_user;

    select coalesce(max(seq), 0)
      into v_cursor
    from public.valerian_sync_changes
    where user_id = v_user;

    insert into public.valerian_sync_baselines(user_id, base_state, base_cursor)
    values (v_user, v_state, coalesce(v_cursor, 0))
    on conflict (user_id) do nothing;

    select base_cursor
      into v_cursor
    from public.valerian_sync_baselines
    where user_id = v_user;
  else
    select revision, updated_at
      into v_revision, v_updated_at
    from public.valerian_state
    where user_id = v_user;
  end if;

  return jsonb_build_object(
    'ok', true,
    'cursor', coalesce(v_cursor, 0),
    'revision', coalesce(v_revision, 0),
    'updated_at', v_updated_at
  );
end;
$$;

revoke all on function public.valerian_sync_bootstrap_meta() from public, anon;
grant execute on function public.valerian_sync_bootstrap_meta() to authenticated;

comment on function public.valerian_sync_bootstrap_meta() is
  'Returns only baseline cursor and revision metadata; never transfers the full business snapshot.';
