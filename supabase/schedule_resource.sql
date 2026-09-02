-- 坐忘茗舍：行程占用资源（琴/茶/两者都占），配合周视图左右分栏展示
-- 在 Supabase 项目后台 → SQL Editor 里粘贴执行一次

alter table schedule_events
  add column if not exists resource text not null default 'both'
  check (resource in ('guqin', 'tea', 'both'));

comment on column schedule_events.resource is '这条行程占用的资源线：guqin=只占琴课时间线，tea=只占茶室时间线，both=两条都占（外出/大活动等）。周视图据此把每天分左右两栏展示，老数据没有这个字段时默认 both，避免误判某条线其实是空的。';
