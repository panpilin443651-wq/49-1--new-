-- ระบบคุมค่าใช้จ่าย 49(1) — สร้างตารางบน Supabase
-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์นี้ → Run

-- ตารางเก็บรายการ: หน่วยงาน / หมวด / งบจัดสรร / ค่าใช้จ่าย
-- เก็บเป็น 1 แถวต่อ 1 รายการ เวลาสองคนบันทึกคนละรายการพร้อมกันจึงไม่ทับกัน
create table if not exists public.b491_items (
  coll       text not null,
  id         text not null,
  doc        jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);

-- ค่าตั้งค่าที่ใช้ร่วมกัน (เกณฑ์สีงบคงเหลือ, ปีงบที่เพิ่มเอง)
create table if not exists public.b491_meta (
  k          text primary key,
  v          jsonb not null,
  updated_at timestamptz not null default now()
);

-- ประวัติการแก้ไข
create table if not exists public.b491_log (
  id   bigserial primary key,
  at   timestamptz not null default now(),
  by   text,
  what text
);
create index if not exists b491_log_at_idx on public.b491_log (at desc);

-- เปิด RLS แล้วอนุญาตให้ anon key เข้าถึงได้
-- (anon key ถูกเก็บไว้ที่เซิร์ฟเวอร์ Vercel เท่านั้น ไม่ได้ส่งลงหน้าเว็บ
--  และการเข้าใช้งานถูกกั้นด้วยชื่อผู้ใช้/รหัสผ่านของแอปอีกชั้นหนึ่ง)
alter table public.b491_items enable row level security;
alter table public.b491_meta  enable row level security;
alter table public.b491_log   enable row level security;

drop policy if exists b491_items_all on public.b491_items;
drop policy if exists b491_meta_all  on public.b491_meta;
drop policy if exists b491_log_all   on public.b491_log;

create policy b491_items_all on public.b491_items
  for all to anon, authenticated using (true) with check (true);
create policy b491_meta_all on public.b491_meta
  for all to anon, authenticated using (true) with check (true);
create policy b491_log_all on public.b491_log
  for all to anon, authenticated using (true) with check (true);

-- ตรวจผลลัพธ์
select 'สร้างตารางเรียบร้อย' as status,
       (select count(*) from public.b491_items) as items,
       (select count(*) from public.b491_meta)  as meta,
       (select count(*) from public.b491_log)   as logs;
