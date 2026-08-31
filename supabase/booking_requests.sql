-- 坐忘茗舍：茶席预约申请
-- 在 Supabase 项目后台 → SQL Editor 里粘贴执行一次

-- 只是"客人提交一个到访意向，主理人人工判断要不要接"，不做真实时段占用/冲突检测——
-- 那一套（主理人忙碌时段、茶室/琴课资源独立开放）以后设计好了再说，现在先不管。
create table if not exists booking_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id) on delete cascade,
  preferred_time text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined')),
  admin_note text,
  created_at timestamptz default now()
);

alter table booking_requests enable row level security;

create policy "会员提交自己的预约申请" on booking_requests for insert
  with check (member_id = (select member_id from profiles where id = auth.uid()));

create policy "会员查看自己的预约申请" on booking_requests for select
  using (member_id = (select member_id from profiles where id = auth.uid()));

create policy "管理员管理预约申请" on booking_requests for all
  using (is_admin()) with check (is_admin());
