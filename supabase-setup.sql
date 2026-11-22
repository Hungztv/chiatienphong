-- Chạy đoạn SQL này trong Supabase Dashboard -> SQL Editor -> New Query -> Run

create table if not exists public.troshare_rooms (
  room_code text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.troshare_rooms enable row level security;

drop policy if exists "Allow public read/write troshare_rooms" on public.troshare_rooms;
create policy "Allow public read/write troshare_rooms"
  on public.troshare_rooms
  for all
  using (true)
  with check (true);

-- Bật Realtime để 2 máy tự động thấy thay đổi ngay lập tức
do $$
begin
  alter publication supabase_realtime add table public.troshare_rooms;
exception
  when duplicate_object then null;
end $$;
