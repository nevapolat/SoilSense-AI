-- Run this in the Supabase SQL editor after creating a project.
-- Enables the same SoilSense account (email + profile JSON) on every device.

create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

create policy "user_profiles_select_own"
  on public.user_profiles for select
  using (auth.uid() = id);

create policy "user_profiles_insert_own"
  on public.user_profiles for insert
  with check (auth.uid() = id);

create policy "user_profiles_update_own"
  on public.user_profiles for update
  using (auth.uid() = id);

-- Optional but recommended: creates a profile row even when email confirmation is enabled
-- (the client cannot insert until the user has a session).
create or replace function public.soilsense_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, data)
  values (
    new.id,
    new.email,
    jsonb_build_object(
      'id', new.id::text,
      'email', new.email,
      'hasCompletedTour', false,
      'activeFieldId', null,
      'fields', '[]'::jsonb,
      'trustedDeviceIds', '[]'::jsonb,
      'createdAt', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists soilsense_on_auth_user_created on auth.users;
create trigger soilsense_on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.soilsense_handle_new_user();
