-- 坐忘茗舍：会员个人资料 + 无档案注册
-- 在 supabase/member_system.sql 之后执行的第二批 SQL，同样在 Supabase 后台 SQL Editor 里跑一次

-- 1. members 表补几个字段：
--    nickname —— 主理人填的"备注昵称"，只用来在后台列表里显示，跟客人自己的真实姓名分开存，
--                 后台列表显示名字时优先用这个，没有才显示客人自己填的 name
--    email / address / age —— 客人自己在"个人信息"里维护的联系方式，跟登录账号（profiles.login_account）
--                 是两回事：登录账号是用来登录的，这几个是客人自愿留的联系方式
--    name 允许为空 —— 主理人可以只填备注昵称建一条"空壳"档案，姓名留给客人自己注册后填
alter table members add column if not exists nickname text;
alter table members add column if not exists email text;
alter table members add column if not exists address text;
alter table members add column if not exists age integer;
alter table members alter column name drop not null;

-- 2. 会员要能在"个人信息"里改自己的资料，之前只开了"查看自己的档案"，这里补上"修改自己的档案"
create policy "会员更新自己的档案" on members for update
  using (id = (select member_id from profiles where id = auth.uid()))
  with check (id = (select member_id from profiles where id = auth.uid()));

-- 3. 注册函数升级：密钥如果没有预先绑定档案（member_id 是空的，给全新客人用），
--    注册时自动新建一条空白档案（姓名留空，等客人自己在"个人信息"里填），
--    不再要求密钥必须先绑定一条已有档案才能生成/使用。
create or replace function redeem_invite_code(invite_code text, p_login_account text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code_row invite_codes;
  v_member_id uuid;
begin
  select * into v_code_row
  from invite_codes
  where code = invite_code and is_used = false
  for update;

  if v_code_row.code is null then
    raise exception '密钥无效或已被使用';
  end if;

  v_member_id := v_code_row.member_id;
  if v_member_id is null then
    insert into members (name, phone) values (null, null) returning id into v_member_id;
  end if;

  insert into profiles (id, role, member_type, member_id, login_account)
  values (auth.uid(), 'member', 'offline', v_member_id, p_login_account);

  -- member_id 一起回填，不然后台在新建的会员档案里查这条密钥（按 member_id 查）永远查不到，
  -- 会一直显示"没有待使用的密钥"，即便这个客人明明是靠这张密钥注册出来的
  update invite_codes set is_used = true, used_by = auth.uid(), member_id = v_member_id where code = invite_code;
end;
$$;
