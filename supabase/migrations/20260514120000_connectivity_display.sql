-- Single-row table for verifying the browser (Vercel) can read from Supabase via the anon key.
-- Matches Dashboard DDL: id PK + check (id = 1), n default 8742.
create table if not exists public.connectivity_display (
  id smallint not null,
  n integer not null default 8742,
  constraint connectivity_display_pkey primary key (id),
  constraint connectivity_display_id_check check ((id = 1))
) tablespace pg_default;

insert into public.connectivity_display (id, n)
values (1, 8742)
on conflict (id) do nothing;

alter table public.connectivity_display enable row level security;

create policy "connectivity_display_select_public"
  on public.connectivity_display
  for select
  to anon, authenticated
  using (true);

revoke all on public.connectivity_display from public;
grant select on public.connectivity_display to anon, authenticated;
