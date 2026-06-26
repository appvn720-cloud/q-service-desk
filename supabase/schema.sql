create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  role text not null check (role in ('admin', 't1')),
  created_at timestamptz not null default now()
);

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  business text not null check (business in ('KFC', 'NonKFC')),
  work_start time not null,
  break_start time,
  break_end time,
  work_end time not null,
  active boolean not null default true,
  open_count integer not null default 0 check (open_count >= 0),
  last_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null,
  business text not null check (business in ('KFC', 'NonKFC')),
  assignee_id uuid references public.agents(id),
  assignee_name text not null,
  created_by uuid references public.profiles(id),
  created_by_name text not null,
  status text not null default 'open' check (status in ('open', 'closed', 'reopened')),
  reopen_count integer not null default 0 check (reopen_count >= 0),
  reopen_times timestamptz[] not null default '{}',
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_agents_active_business on public.agents(active, business);
create index if not exists idx_tickets_created_at on public.tickets(created_at desc);
create index if not exists idx_tickets_business_status on public.tickets(business, status);
create index if not exists idx_tickets_assignee on public.tickets(assignee_id);

create or replace function public.create_ticket_with_agent_load(
  p_ticket_number text,
  p_business text,
  p_assignee_id uuid,
  p_assignee_name text,
  p_created_by uuid,
  p_created_by_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_ticket_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_assignee_id::text));

  insert into public.tickets (
    ticket_number,
    business,
    assignee_id,
    assignee_name,
    created_by,
    created_by_name,
    status,
    created_at
  )
  values (
    trim(p_ticket_number),
    p_business,
    p_assignee_id,
    p_assignee_name,
    p_created_by,
    p_created_by_name,
    'open',
    now()
  )
  returning id into new_ticket_id;

  update public.agents
  set open_count = open_count + 1,
      last_assigned_at = now(),
      updated_at = now()
  where id = p_assignee_id;

  return new_ticket_id;
end;
$$;

create or replace function public.update_ticket_status_with_agent_load(
  p_ticket_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_ticket public.tickets%rowtype;
begin
  select * into current_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'Ticket not found';
  end if;

  if p_status not in ('open', 'closed', 'reopened') then
    raise exception 'Invalid status';
  end if;

  if p_status = 'closed' then
    update public.tickets
    set status = 'closed',
        closed_at = now(),
        updated_at = now()
    where id = p_ticket_id;

    if current_ticket.status <> 'closed' and current_ticket.assignee_id is not null then
      update public.agents
      set open_count = greatest(0, open_count - 1),
          updated_at = now()
      where id = current_ticket.assignee_id;
    end if;
  elsif p_status = 'reopened' then
    update public.tickets
    set status = 'reopened',
        closed_at = null,
        reopen_count = reopen_count + 1,
        reopen_times = array_append(reopen_times, now()),
        updated_at = now()
    where id = p_ticket_id;

    if current_ticket.status = 'closed' and current_ticket.assignee_id is not null then
      update public.agents
      set open_count = open_count + 1,
          updated_at = now()
      where id = current_ticket.assignee_id;
    end if;
  else
    update public.tickets
    set status = 'open',
        updated_at = now()
    where id = p_ticket_id;
  end if;
end;
$$;

revoke all on function public.create_ticket_with_agent_load(text, text, uuid, text, uuid, text) from public;
grant execute on function public.create_ticket_with_agent_load(text, text, uuid, text, uuid, text) to authenticated;
revoke all on function public.update_ticket_status_with_agent_load(uuid, text) from public;
grant execute on function public.update_ticket_status_with_agent_load(uuid, text) to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.agents enable row level security;
alter table public.tickets enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_write_authenticated" on public.profiles;
drop policy if exists "agents_select_authenticated" on public.agents;
drop policy if exists "agents_write_authenticated" on public.agents;
drop policy if exists "tickets_select_authenticated" on public.tickets;
drop policy if exists "tickets_write_authenticated" on public.tickets;

create policy "profiles_select_authenticated"
on public.profiles for select
to authenticated
using (true);

create policy "profiles_write_authenticated"
on public.profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "agents_select_authenticated"
on public.agents for select
to authenticated
using (true);

create policy "agents_write_authenticated"
on public.agents for all
to authenticated
using (true)
with check (true);

create policy "tickets_select_authenticated"
on public.tickets for select
to authenticated
using (true);

create policy "tickets_write_authenticated"
on public.tickets for all
to authenticated
using (true)
with check (true);

do $$
begin
  alter publication supabase_realtime add table public.agents;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.tickets;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then
  null;
end $$;
