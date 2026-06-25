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

drop policy if exists "profiles_write_authenticated" on public.profiles;
drop policy if exists "agents_write_authenticated" on public.agents;

create policy "profiles_write_authenticated"
on public.profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "agents_write_authenticated"
on public.agents for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
