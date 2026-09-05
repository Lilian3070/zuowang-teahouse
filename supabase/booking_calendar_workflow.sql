-- 坐忘茗舍：预约申请接入后台日程 + 到期自动清理
-- 在 Supabase 项目后台 → SQL Editor 完整执行一次

-- ── 1. 预约申请补上真正的开始/结束时间 ────────────────────────────
-- 原来只存 preferred_time 这段展示文字（"9月12日 周六 · 下午1:00-下午4:00"），
-- 排序、周表定位、待确认占位、到期清理都需要能直接比较的时间戳。
alter table booking_requests
  add column if not exists start_at timestamptz,
  add column if not exists end_at timestamptz,
  add column if not exists schedule_event_id uuid references schedule_events(id) on delete set null;

-- 补齐这次更新之前收到的预约申请，让它们也能显示在日程里并按期清理。
-- 正则一共 8 个捕获组：1=月 2=日 3=开始时段 4=开始时 5=开始分 6=结束时段 7=结束时 8=结束分
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
    where (start_at is null or end_at is null) and preferred_time is not null
  loop
    parts := regexp_match(
      r.preferred_time,
      '([0-9]+)月([0-9]+)日.*·[[:space:]]*(凌晨|早上|上午|中午|下午|晚上)([0-9]+):([0-9]+)-(凌晨|早上|上午|中午|下午|晚上)([0-9]+):([0-9]+)'
    );
    if parts is null then
      continue;
    end if;

    -- preferred_time 里没有年份，用申请提交的年份兜底（跨年预约极少，真遇到主理人人工核对）
    booking_year := extract(year from r.created_at at time zone 'Asia/Shanghai');

    start_hour := parts[4]::integer % 12;
    end_hour   := parts[7]::integer % 12;
    if parts[3] in ('上午', '中午') and parts[4]::integer = 12 then start_hour := 12; end if;
    if parts[6] in ('上午', '中午') and parts[7]::integer = 12 then end_hour   := 12; end if;
    if parts[3] in ('下午', '晚上') then start_hour := start_hour + 12; end if;
    if parts[6] in ('下午', '晚上') then end_hour   := end_hour + 12; end if;

    update booking_requests
    set start_at = make_timestamptz(booking_year, parts[1]::integer, parts[2]::integer,
                                    start_hour, parts[5]::integer, 0, 'Asia/Shanghai'),
        end_at   = make_timestamptz(booking_year, parts[1]::integer, parts[2]::integer,
                                    end_hour,   parts[8]::integer, 0, 'Asia/Shanghai')
    where id = r.id;
  end loop;
end;
$$;

create index if not exists booking_requests_status_start_at_idx
  on booking_requests (status, start_at);

comment on column booking_requests.start_at is '会员在雅室预约周表选中的开始时间';
comment on column booking_requests.end_at is '会员在雅室预约周表选中的结束时间';
comment on column booking_requests.schedule_event_id is '确认后自动生成的茶室正式日程';

-- ── 2. 到期自动清理 ──────────────────────────────────────────────
-- 后台不设"删除预约"按钮，改成到访日期过去了就自动删（次日北京时间 00:10 跑）。
-- 已确认的申请删掉不丢东西：确认时已经在 schedule_events 里生成了正式行程，那条会一直留着。
--
-- ⚠️ 整段包在 do + exception 里：Supabase SQL Editor 会把整个脚本放在一个事务里跑，
-- 如果这个项目没开 pg_cron 权限，直接写 create extension / cron.schedule 会让**上面第 1 节
-- 也一起回滚**，白跑一趟还看不出是哪儿失败的。现在装不上就只发一条提示，schema 照样生效
-- （后台每次打开预约列表还有一道前端兜底清理，见 admin.html 的 sweepExpiredBookings）。
do $$
begin
  create extension if not exists pg_cron with schema extensions;

  perform cron.unschedule(jobid) from cron.job where jobname = 'cleanup-expired-booking-requests';

  perform cron.schedule(
    'cleanup-expired-booking-requests',
    '10 16 * * *', -- UTC 16:10 = 北京时间次日 00:10
    $job$
      delete from booking_requests
      where start_at is not null
        and start_at < (date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai');
    $job$
  );

  raise notice '定时清理任务已就绪：每天北京时间 00:10 删除到访日期已过去的预约申请。';
exception when others then
  raise notice '跳过定时任务（%）。schema 已生效，过期预约由后台打开时的前端兜底清理负责。', sqlerrm;
end;
$$;
