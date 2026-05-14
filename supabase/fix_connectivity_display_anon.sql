-- Run in Supabase Dashboard → SQL → New query (idempotent).
-- Fixes: missing row, RLS blocking anon, or missing SELECT grant.

insert into public.connectivity_display (id, n)
values (1, 8742)
on conflict (id) do update set n = excluded.n;

alter table public.connectivity_display enable row level security;

drop policy if exists "connectivity_display_select_public" on public.connectivity_display;
create policy "connectivity_display_select_public"
  on public.connectivity_display
  for select
  to anon, authenticated
  using (true);

grant usage on schema public to anon, authenticated;
grant select on table public.connectivity_display to anon, authenticated;
