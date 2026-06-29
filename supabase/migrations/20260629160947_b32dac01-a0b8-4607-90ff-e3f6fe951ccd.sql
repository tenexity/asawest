
-- Roles enum
do $$ begin
  create type public.app_role as enum ('admin', 'viewer');
exception when duplicate_object then null; end $$;

-- user_roles
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

-- has_role security definer
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- current_user_role
create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_roles where user_id = auth.uid()
  order by case role when 'admin' then 1 else 2 end limit 1
$$;

-- Policies for user_roles: users see their own; admins see/manage all
drop policy if exists "view own role" on public.user_roles;
create policy "view own role" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

drop policy if exists "admin manages roles" on public.user_roles;
create policy "admin manages roles" on public.user_roles
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Invitations table
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role public.app_role not null default 'viewer',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

grant select, insert, update, delete on public.invitations to authenticated;
grant all on public.invitations to service_role;
alter table public.invitations enable row level security;

drop policy if exists "admin manages invitations" on public.invitations;
create policy "admin manages invitations" on public.invitations
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Trigger on new auth user: assign role from invitation or default viewer
create or replace function public.handle_new_user_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_role public.app_role;
begin
  select role into invited_role
  from public.invitations
  where lower(email) = lower(new.email)
    and accepted_at is null
  limit 1;

  if invited_role is not null then
    insert into public.user_roles (user_id, role) values (new.id, invited_role)
    on conflict do nothing;
    update public.invitations set accepted_at = now()
      where lower(email) = lower(new.email) and accepted_at is null;
  else
    insert into public.user_roles (user_id, role) values (new.id, 'viewer')
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_assign_role on auth.users;
create trigger on_auth_user_created_assign_role
after insert on auth.users
for each row execute function public.handle_new_user_role();

-- Bootstrap: make all existing users admin (so the current signed-in user becomes admin)
insert into public.user_roles (user_id, role)
select id, 'admin'::public.app_role from auth.users
on conflict do nothing;

-- Admin-only list_users function
create or replace function public.admin_list_users()
returns table (user_id uuid, email text, created_at timestamptz, role public.app_role)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'not authorized';
  end if;
  return query
    select u.id, u.email::text, u.created_at,
           (select ur.role from public.user_roles ur where ur.user_id = u.id
            order by case ur.role when 'admin' then 1 else 2 end limit 1) as role
    from auth.users u
    order by u.created_at desc;
end;
$$;

revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.current_user_role() to authenticated;

-- Admin-only set_user_role helper
create or replace function public.admin_set_user_role(_user_id uuid, _role public.app_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'not authorized';
  end if;
  delete from public.user_roles where user_id = _user_id;
  insert into public.user_roles (user_id, role) values (_user_id, _role);
end;
$$;

revoke all on function public.admin_set_user_role(uuid, public.app_role) from public;
grant execute on function public.admin_set_user_role(uuid, public.app_role) to authenticated;
