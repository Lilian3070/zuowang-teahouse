-- 坐忘茗舍：行程"手动关闭时段"标记
-- 在 Supabase 项目后台 → SQL Editor 里粘贴执行一次

alter table schedule_events
  add column if not exists is_closed boolean not null default false;

comment on column schedule_events.is_closed is '主理人手动关闭的时段：不挂会员、不是真行程，纯粹占位挡住这段时间不能被约。跟"这段时间已经排满了行程"是两回事——满是因为有别的行程占用，关闭是主理人主动不开放，就算这段时间原本空着也一样约不了。周/月视图用灰色斜纹底区分，不跟琴(红)/茶(绿)/两者都占(金)的颜色混。';
