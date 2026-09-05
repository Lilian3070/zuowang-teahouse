-- 坐忘茗舍：预约申请接入后台日程与自动清理
-- 在 Supabase 项目后台 → SQL Editor 完整执行一次

-- 预约不能只存展示文字；开始/结束时间用于排序、周表定位、待确认占位与到期清理。
alter table booking_requests
  add column if not exists start_at timestamptz,
  add column if not exists end_at timestamptz,
  add column if not exists schedule_event_id uuid references schedule_events(id) on delete set null;

-- 补齐这次更新前已经收到的预约申请，使它们也能显示在日程中并按期清理。
do $$
declare
  r record;
  parts text[];
  booking_year integer;
  start_hour integer;
  end_hour integer;
begin
  for r in
    select id, preferred_time, created_at
    from booking_requests
    where start_at is null and preferred_time is not null
  loop
    parts := regexp_match(
      r.preferred_time,
      '([0-9]+)月([0-9]+)日.*·[[:space:]]*(凌晨|早上|上午|中午|下午|晚上)([0-9]+):([0-9]+)-(凌晨|早上|上午|中午|下午|晚上)([0-9]+):([0-9]+)'
    );
    if parts is null then
      continue;
    end if;

    booking_year := extract(year from r.created_at at time zone 'Asia/Shanghai');
    start_hour := parts[4]::integer % 12;
    end_hour := parts[8]::integer % 12;
    if parts[3] in ('中午', '上午') and parts[4]::integer = 12 then start_hour := 12; end if;
    if parts[7] in ('中午', '上午') and parts[8]::integer = 12 then end_hour := 12; end if;
    if parts[3] in ('下午', '晚上') then start_hour := start_hour + 12; end if;
    if parts[7] in ('下午', '晚上') then end_hour := end_hour + 12; end if;

    update booking_requests
    set start_at = make_timestamptz(booking_year, parts[1]::integer, parts[2]::integer, start_hour, parts[5]::integer, 0, 'Asia/Shanghai'),
        end_at = make_timestamptz(booking_year, parts[1]::integer, parts[2]::integer, end_hour, parts[9]::integer, 0, 'Asia/Shanghai')
    where id = r.id;
  end loop;
end;
$$;

create index if not exists booking_requests_status_start_at_idx
  on booking_requests (status, start_at);

comment on column booking_requests.start_at is '会员在雅室预约周表选中的开始时间';
comment on column booking_requests.end_at is '会员在雅室预约周表选中的结束时间';
comment on column booking_requests.schedule_event_id is '确认后自动生成的茶室正式日程';

-- 每天北京时间 00:10 删除预约日期已经过去的申请。
-- 已确认申请对应的 schedule_events 行程不删除，日程记录会保留。
create extension if not exists pg_cron with schema extensions;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'cleanup-expired-booking-requests';
end;
$$;

select cron.schedule(
  'cleanup-expired-booking-requests',
  '10 16 * * *', -- UTC 16:10 = 北京时间次日 00:10
  $$
    delete from booking_requests
    where start_at is not null
      and start_at < (date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai');
  $$
);
