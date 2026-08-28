-- مزامنة عناصر المقاضي دون اتصال.
-- لا يحذف هذا الترحيل أي بيانات موجودة؛ يضيف فقط سجلًا للإصدارات
-- وطابور عمليات دائمًا في قاعدة البيانات لضمان عدم تكرار العملية عند إعادة الإرسال.

begin;

alter table public.maqadhi_v2_items
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists version bigint not null default 0;

create or replace function public.maqadhi_v2_touch_item()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at = old.updated_at then
    new.updated_at := now();
  end if;
  if new.version = old.version then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists maqadhi_v2_items_touch_item on public.maqadhi_v2_items;
create trigger maqadhi_v2_items_touch_item
before update on public.maqadhi_v2_items
for each row
execute function public.maqadhi_v2_touch_item();

create index if not exists maqadhi_v2_items_group_version_idx
  on public.maqadhi_v2_items (group_id, version);

create table if not exists public.maqadhi_v2_item_tombstones (
  item_id uuid primary key,
  group_id uuid not null references public.maqadhi_v2_groups(id) on delete cascade,
  deleted_by text not null,
  deleted_at timestamptz not null default now(),
  delete_operation_id uuid not null unique
);

create index if not exists maqadhi_v2_item_tombstones_group_idx
  on public.maqadhi_v2_item_tombstones (group_id, deleted_at desc);

create table if not exists public.maqadhi_v2_item_operations (
  operation_id uuid primary key,
  group_id uuid not null references public.maqadhi_v2_groups(id) on delete cascade,
  item_id uuid not null,
  actor_name text not null,
  operation_type text not null check (operation_type in ('add', 'quantity_delta', 'set_purchased', 'rename', 'delete')),
  payload jsonb not null default '{}'::jsonb,
  base_version bigint,
  client_created_at timestamptz,
  received_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'received' check (status in ('received', 'applied', 'noop', 'rejected')),
  result jsonb not null default '{}'::jsonb
);

create index if not exists maqadhi_v2_item_operations_group_received_idx
  on public.maqadhi_v2_item_operations (group_id, received_at desc);

create or replace function public.maqadhi_v2_apply_item_operation(
  p_operation_id uuid,
  p_group_id uuid,
  p_actor_name text,
  p_operation_type text,
  p_item_id uuid,
  p_payload jsonb default '{}'::jsonb,
  p_base_version bigint default null,
  p_client_created_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_name text := nullif(btrim(p_actor_name), '');
  v_type text := lower(btrim(coalesce(p_operation_type, '')));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_existing public.maqadhi_v2_item_operations%rowtype;
  v_item public.maqadhi_v2_items%rowtype;
  v_inserted_id uuid;
  v_allowed boolean;
  v_is_manager boolean;
  v_tombstoned boolean;
  v_status text := 'rejected';
  v_reason text := 'invalid_request';
  v_name text;
  v_delta integer;
  v_quantity integer;
  v_next_quantity integer;
  v_target_purchased boolean;
  v_result jsonb;
begin
  if p_operation_id is null or p_group_id is null or p_item_id is null or v_actor_name is null then
    return jsonb_build_object('ok', false, 'status', 'rejected', 'reason', 'invalid_request');
  end if;

  if v_type not in ('add', 'quantity_delta', 'set_purchased', 'rename', 'delete') then
    return jsonb_build_object('ok', false, 'status', 'rejected', 'reason', 'invalid_operation_type');
  end if;

  -- الاستدعاء المكرر لنفس العملية يعيد النتيجة السابقة ولا ينفذها مرة أخرى.
  select * into v_existing
  from public.maqadhi_v2_item_operations
  where operation_id = p_operation_id;

  if found then
    if v_existing.actor_name is distinct from v_actor_name
      or v_existing.group_id is distinct from p_group_id
      or v_existing.item_id is distinct from p_item_id
      or v_existing.operation_type is distinct from v_type
      or v_existing.payload is distinct from v_payload
      or v_existing.base_version is distinct from p_base_version then
      return jsonb_build_object('ok', false, 'status', 'rejected', 'reason', 'operation_id_reused');
    end if;
    return v_existing.result || jsonb_build_object('duplicate', true);
  end if;

  if not exists (select 1 from public.maqadhi_v2_groups where id = p_group_id) then
    return jsonb_build_object('ok', false, 'status', 'rejected', 'reason', 'group_missing');
  end if;

  insert into public.maqadhi_v2_item_operations (
    operation_id, group_id, item_id, actor_name, operation_type, payload, base_version, client_created_at
  ) values (
    p_operation_id, p_group_id, p_item_id, v_actor_name, v_type, v_payload, p_base_version, p_client_created_at
  ) on conflict (operation_id) do nothing
  returning operation_id into v_inserted_id;

  if v_inserted_id is null then
    select * into v_existing
    from public.maqadhi_v2_item_operations
    where operation_id = p_operation_id;
    if v_existing.actor_name is distinct from v_actor_name
      or v_existing.group_id is distinct from p_group_id
      or v_existing.item_id is distinct from p_item_id
      or v_existing.operation_type is distinct from v_type
      or v_existing.payload is distinct from v_payload
      or v_existing.base_version is distinct from p_base_version then
      return jsonb_build_object('ok', false, 'status', 'rejected', 'reason', 'operation_id_reused');
    end if;
    return v_existing.result || jsonb_build_object('duplicate', true);
  end if;

  select exists (
    select 1
    from public.maqadhi_v2_members
    where group_id = p_group_id
      and name = v_actor_name
      and status = 'approved'
  ) into v_allowed;

  select exists (
    select 1
    from public.maqadhi_v2_members
    where group_id = p_group_id
      and name = v_actor_name
      and role = 'manager'
      and status = 'approved'
  ) into v_is_manager;

  if not v_allowed then
    v_reason := 'not_an_approved_member';

  elsif v_type = 'add' then
    v_name := btrim(coalesce(v_payload ->> 'name', ''));
    if char_length(v_name) not between 1 and 120 then
      v_reason := 'invalid_name';
    elsif exists (select 1 from public.maqadhi_v2_item_tombstones where item_id = p_item_id) then
      -- الحذف النهائي يتقدم على إضافة متأخرة من جهاز كان بلا اتصال.
      v_reason := 'item_deleted';
    elsif v_payload ? 'quantity' and (v_payload ->> 'quantity') !~ '^[1-9][0-9]{0,5}$' then
      v_reason := 'invalid_quantity';
    else
      v_quantity := coalesce((v_payload ->> 'quantity')::integer, 1);
      insert into public.maqadhi_v2_items (
        id, group_id, name, quantity, added_by, purchased, purchased_by, version
      ) values (
        p_item_id, p_group_id, v_name, v_quantity, v_actor_name, false, null, 1
      ) on conflict (id) do nothing
      returning * into v_item;

      if found then
        v_status := 'applied';
        v_reason := null;
      else
        select * into v_item
        from public.maqadhi_v2_items
        where id = p_item_id;
        -- يغطي الحالة النادرة التي وصل فيها الطلب قبل انقطاع الاتصال لكن لم يصل الرد للجوال.
        if found
          and v_item.group_id = p_group_id
          and v_item.added_by = v_actor_name
          and v_item.name = v_name then
          v_status := 'noop';
          v_reason := null;
        else
          v_reason := 'item_id_exists';
        end if;
      end if;
    end if;

  else
    select * into v_item
    from public.maqadhi_v2_items
    where id = p_item_id and group_id = p_group_id
    for update;

    if not found then
      select exists (
        select 1 from public.maqadhi_v2_item_tombstones where item_id = p_item_id
      ) into v_tombstoned;
      v_reason := case when v_tombstoned then 'item_deleted' else 'item_missing' end;

    elsif v_type = 'quantity_delta' then
      if not (v_payload ? 'delta') or (v_payload ->> 'delta') !~ '^-?[0-9]{1,5}$' then
        v_reason := 'invalid_delta';
      else
        v_delta := (v_payload ->> 'delta')::integer;
        v_next_quantity := greatest(1, v_item.quantity + v_delta);
        if v_next_quantity = v_item.quantity then
          v_status := 'noop';
          v_reason := null;
        else
          update public.maqadhi_v2_items
          set quantity = v_next_quantity,
              version = v_item.version + 1,
              updated_at = now()
          where id = p_item_id and group_id = p_group_id
          returning * into v_item;
          v_status := 'applied';
          v_reason := null;
        end if;
      end if;

    elsif v_type = 'set_purchased' then
      if jsonb_typeof(v_payload -> 'purchased') is distinct from 'boolean' then
        v_reason := 'invalid_purchased_value';
      else
        v_target_purchased := (v_payload ->> 'purchased')::boolean;
        if v_item.purchased = v_target_purchased then
          v_status := 'noop';
          v_reason := null;
        elsif p_base_version is null or p_base_version <> v_item.version then
          -- الحالة الصريحة (اشتري/أعد للمطلوب) لا تُدمج تلقائيًا إن تغيّرت من جهاز آخر.
          v_reason := 'stale_version';
        else
          update public.maqadhi_v2_items
          set purchased = v_target_purchased,
              purchased_by = case when v_target_purchased then v_actor_name else null end,
              version = v_item.version + 1,
              updated_at = now()
          where id = p_item_id and group_id = p_group_id
          returning * into v_item;
          v_status := 'applied';
          v_reason := null;
        end if;
      end if;

    elsif v_type = 'rename' then
      v_name := btrim(coalesce(v_payload ->> 'name', ''));
      if v_item.added_by <> v_actor_name then
        v_reason := 'not_item_owner';
      elsif char_length(v_name) not between 1 and 120 then
        v_reason := 'invalid_name';
      elsif v_item.name = v_name then
        v_status := 'noop';
        v_reason := null;
      elsif p_base_version is null or p_base_version <> v_item.version then
        v_reason := 'stale_version';
      else
        update public.maqadhi_v2_items
        set name = v_name,
            version = v_item.version + 1,
            updated_at = now()
        where id = p_item_id and group_id = p_group_id
        returning * into v_item;
        v_status := 'applied';
        v_reason := null;
      end if;

    elsif v_type = 'delete' then
      if not v_item.purchased then
        v_reason := 'delete_only_after_purchase';
      elsif not (v_is_manager or v_item.added_by = v_actor_name) then
        v_reason := 'not_allowed_to_delete';
      else
        insert into public.maqadhi_v2_item_tombstones (
          item_id, group_id, deleted_by, delete_operation_id
        ) values (
          p_item_id, p_group_id, v_actor_name, p_operation_id
        ) on conflict (item_id) do nothing;

        delete from public.maqadhi_v2_items
        where id = p_item_id and group_id = p_group_id
        returning * into v_item;

        if found then
          v_status := 'applied';
          v_reason := null;
        else
          v_reason := 'item_deleted';
        end if;
      end if;
    end if;
  end if;

  v_result := jsonb_strip_nulls(jsonb_build_object(
    'ok', v_status in ('applied', 'noop'),
    'status', v_status,
    'reason', v_reason,
    'operation_id', p_operation_id,
    'item', case when v_item.id is null then null else to_jsonb(v_item) end
  ));

  update public.maqadhi_v2_item_operations
  set status = v_status,
      result = v_result,
      finished_at = now()
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

-- لا يقرأ العميل السجلّين مباشرة؛ يتعامل معهما فقط عبر الدالة أعلاه.
revoke all on table public.maqadhi_v2_item_operations from anon, authenticated;
revoke all on table public.maqadhi_v2_item_tombstones from anon, authenticated;
alter table public.maqadhi_v2_item_operations enable row level security;
alter table public.maqadhi_v2_item_tombstones enable row level security;

revoke all on function public.maqadhi_v2_apply_item_operation(uuid, uuid, text, text, uuid, jsonb, bigint, timestamptz) from public;
grant execute on function public.maqadhi_v2_apply_item_operation(uuid, uuid, text, text, uuid, jsonb, bigint, timestamptz) to anon, authenticated;

commit;
