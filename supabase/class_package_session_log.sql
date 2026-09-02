-- 坐忘茗舍：课时套餐扣课记录（只给主理人自己追踪用，前台/会员中心不展示）
-- 在 Supabase 项目后台 → SQL Editor 里粘贴执行一次

alter table class_packages
  add column if not exists session_log jsonb not null default '[]'::jsonb;

comment on column class_packages.session_log is '每次扣课时记一条 {date: 主理人选的上课日期, logged_at: 操作时间戳}，仅后台展示，member.html 不读这个字段';
