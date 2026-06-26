drop policy if exists "agents_write_authenticated" on public.agents;

create policy "agents_write_authenticated"
on public.agents for all
to authenticated
using (true)
with check (true);
