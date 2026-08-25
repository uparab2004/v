-- تهيئة آمنة للانتقال من الأسماء المحلية إلى حسابات مرتبطة برقم الجوال.
-- لا تحذف هذه الترحيلات بيانات المجموعات أو العضويات الحالية.

create table if not exists public.maqadhi_v2_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.maqadhi_v2_members
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.maqadhi_v2_items
  add column if not exists added_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists purchased_by_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists maqadhi_v2_members_group_user_unique
  on public.maqadhi_v2_members (group_id, user_id)
  where user_id is not null;

create index if not exists maqadhi_v2_members_user_id_idx
  on public.maqadhi_v2_members (user_id);

create index if not exists maqadhi_v2_items_added_by_user_id_idx
  on public.maqadhi_v2_items (added_by_user_id);

create table if not exists public.maqadhi_v2_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_token text not null unique,
  platform text not null check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists maqadhi_v2_push_tokens_user_id_idx
  on public.maqadhi_v2_push_tokens (user_id);
