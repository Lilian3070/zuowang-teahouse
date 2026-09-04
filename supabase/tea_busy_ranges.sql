-- 坐忘茗舍：首页预约表单读取茶室真实忙闲，只给一个安全的只读函数
-- 在 Supabase 项目后台 → SQL Editor 里粘贴执行一次

-- 客人在首页选日期后，要看这天茶室（resource = tea 或 both）哪些时段已经被占用
-- （不管是真行程还是主理人手动关闭），才能只挑真正空着的时段提交预约。
-- schedule_events 本身是后台专用表（RLS 只给管理员读），不能直接对客人开放整张表——
-- 那样会连会员姓名、行程标题这些隐私内容一起漏出去。这个函数只返回时间段本身
-- （start_at/end_at），不返回 title/member_id/note 等任何隐私字段，安全暴露给
-- 所有登录用户（含普通会员）调用。
create or replace function public.get_tea_busy_ranges(p_start timestamptz, p_end timestamptz)
returns table (start_at timestamptz, end_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select start_at, end_at
  from schedule_events
  where resource in ('tea', 'both')
    and start_at < p_end
    and end_at > p_start
$$;

comment on function public.get_tea_busy_ranges(timestamptz, timestamptz) is '首页预约表单用：查询茶室资源线在某段时间内已占用（真行程或手动关闭）的区间，只返回起止时间，不暴露标题/会员等隐私字段。';

grant execute on function public.get_tea_busy_ranges(timestamptz, timestamptz) to anon, authenticated;
