-- 坐忘茗舍：误删会员档案后，把原来的登录账号重新绑定回一条会员档案
-- 在 supabase/member_profile.sql 之后执行的第三批 SQL，同样在 Supabase 后台 SQL Editor 里跑一次

-- 背景：members 表被删除时，class_packages / purchases / booking_requests / invite_codes /
-- password_reset_codes 这些关联数据都是 on delete cascade，会跟着一起被永久删掉，无法恢复；
-- 但 profiles.member_id 是 on delete set null，登录账号（auth.users + profiles）本身不会被删，
-- 只是 member_id 变成空，导致这个账号还能登录，但会员中心找不到任何数据。
--
-- 误删之后能做的，是重新建一条 members 档案（course/购买历史如果没有备份就补不回来了），
-- 再把这个"游离"的登录账号重新指回这条新档案——profiles 表本身没有开放任何 update 策略
-- （见 member_system.sql 里的说明，任何人都不能直接改），所以要用一个管理员专用的
-- security definer 函数来做这次绑定。

create or replace function admin_rebind_login(p_login_account text, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  if not is_admin() then
    raise exception '只有管理员能操作';
  end if;

  select id into v_profile_id
  from profiles
  where login_account = p_login_account and role = 'member' and member_id is null;

  if v_profile_id is null then
    raise exception '没有找到这个账号，或者它已经绑定了别的会员档案';
  end if;

  update profiles set member_id = p_member_id where id = v_profile_id;
end;
$$;

grant execute on function admin_rebind_login(text, uuid) to authenticated;
