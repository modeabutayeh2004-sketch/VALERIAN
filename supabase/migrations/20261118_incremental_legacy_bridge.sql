-- VALERIAN V20 compatibility bridge
-- Keeps the new incremental journal authoritative while materializing journal patches
-- server-side into valerian_state so legacy clients can still see V20 writes.
-- No full snapshot is uploaded by V20; the patch is applied inside Postgres.

create or replace function public.valerian_apply_sync_patch(p_state jsonb, p_patch jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_state jsonb := coalesce(p_state, '{}'::jsonb);
  v_op jsonb;
  v_key text;
  v_id text;
  v_arr jsonb;
  v_idx bigint;
begin
  if p_patch is null or p_patch->>'version' <> '1' or jsonb_typeof(p_patch->'ops') <> 'array' then
    raise exception 'Unsupported sync patch';
  end if;

  for v_op in select value from jsonb_array_elements(p_patch->'ops')
  loop
    if v_op->>'op' in ('set','unset') then
      v_key := coalesce(v_op->>'key','');
      if v_key = '' then
        raise exception 'Patch operation has no key';
      end if;

      if left(v_key, 9) = 'settings.' then
        v_state := jsonb_set(v_state, '{settings}', coalesce(v_state->'settings','{}'::jsonb), true);
        if v_op->>'op' = 'unset' then
          v_state := jsonb_set(v_state, '{settings}', (v_state->'settings' - substring(v_key from 10)), true);
        else
          v_state := jsonb_set(v_state, array['settings', substring(v_key from 10)], v_op->'value', true);
        end if;
      elsif v_op->>'op' = 'unset' then
        v_state := v_state - v_key;
      else
        v_state := jsonb_set(v_state, array[v_key], v_op->'value', true);
      end if;

    elsif v_op->>'op' = 'upsert' then
      v_key := coalesce(v_op->>'key','');
      v_id := coalesce(v_op->>'id','');
      v_arr := case when jsonb_typeof(v_state->v_key) = 'array' then v_state->v_key else '[]'::jsonb end;

      select ord - 1 into v_idx
      from jsonb_array_elements(v_arr) with ordinality as x(elem,ord)
      where coalesce(elem->>'id','') = v_id
      limit 1;

      if v_idx is null then
        v_arr := v_arr || jsonb_build_array(v_op->'value');
      else
        v_arr := jsonb_set(v_arr, array[v_idx::text], v_op->'value', true);
      end if;

      v_state := jsonb_set(v_state, array[v_key], v_arr, true);

    elsif v_op->>'op' = 'delete' then
      v_key := coalesce(v_op->>'key','');
      v_id := coalesce(v_op->>'id','');
      v_arr := case when jsonb_typeof(v_state->v_key) = 'array' then v_state->v_key else '[]'::jsonb end;

      select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb)
        into v_arr
      from jsonb_array_elements(v_arr) with ordinality as x(elem,ord)
      where coalesce(elem->>'id','') <> v_id;

      v_state := jsonb_set(v_state, array[v_key], v_arr, true);
    else
      raise exception 'Unsupported sync operation: %', v_op->>'op';
    end if;
  end loop;

  return v_state;
end;
$$;

revoke all on function public.valerian_apply_sync_patch(jsonb,jsonb) from public, anon;

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
  v_state jsonb;
  v_revision bigint := 0;
  v_updated_at timestamptz := now();
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'p_changes must be a JSON array';
  end if;
  if jsonb_array_length(p_changes) > 200 then
    raise exception 'Batch limit is 200 changes';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 731942));

  select state, revision
    into v_state, v_revision
  from public.valerian_state
  where user_id = v_user
  for update;

  if not found then
    v_state := '{}'::jsonb;
    v_revision := 0;
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

    if found then
      v_inserted := v_inserted + 1;
      v_state := public.valerian_apply_sync_patch(v_state, v_item->'patch');
    end if;
  end loop;

  if v_inserted > 0 then
    v_revision := v_revision + 1;
    v_updated_at := now();

    insert into public.valerian_state(user_id, state, revision, updated_at)
    values (v_user, v_state, v_revision, v_updated_at)
    on conflict (user_id) do update
      set state = excluded.state,
          revision = excluded.revision,
          updated_at = excluded.updated_at;
  end if;

  select coalesce(max(seq), 0)
    into v_cursor
  from public.valerian_sync_changes
  where user_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'cursor', v_cursor,
    'revision', v_revision
  );
end;
$$;

revoke all on function public.valerian_sync_push(jsonb) from public, anon;
grant execute on function public.valerian_sync_push(jsonb) to authenticated;
