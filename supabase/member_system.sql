-- 坐忘茗舍：会员/管理员账号体系
-- 在 Supabase 项目后台 → SQL Editor 里粘贴执行（一次性）

-- 1. 角色表：每个登录账号（对应 auth.users 里的一行）在这里记录是 admin 还是 member。
--    member_type 现在只会有 'offline' 一种值，是给以后"线上购物会员"预留的字段，
--    以后加新类型只是多一个允许值，不影响已有数据。
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  member_type text default 'offline',
  member_id uuid references members(id) on delete set null,
  login_account text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

-- is_admin()：判断当前登录人是不是管理员。security definer 让它能绕过 profiles 自己的
-- RLS 去查表，否则"查角色的策略"和"角色表本身的权限"会互相依赖，查不出结果。
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function is_admin() to authenticated;

create policy "查看自己的角色，或管理员查看所有" on profiles for select
  using (auth.uid() = id or is_admin());

-- 注意：这里没有给 profiles 建任何 insert/update 策略，默认就是"谁都不能直接改"。
-- 唯一能往这张表里写会员数据的路径是下面的 redeem_invite_code() 函数，
-- 管理员账号只能由你在 Supabase 后台手动插入（见文末）。
-- 这样保证了任何人都没有办法把自己伪装成 admin。


-- 2. 邀请码表：主理人为到店客人生成的一次性会员注册密钥，绑定到一条已有的会员档案（members 表）。
create table if not exists invite_codes (
  code text primary key,
  member_id uuid references members(id) on delete cascade,
  is_used boolean not null default false,
  used_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

alter table invite_codes enable row level security;

-- 只有管理员能在后台生成/查看密钥；普通访客完全没有读写权限，注册靠下面的函数。
create policy "管理员管理邀请码" on invite_codes for all
  using (is_admin()) with check (is_admin());


-- 3. 注册函数：会员先用 supabase.auth.signUp() 建好账号（邮箱或手机号都会被包装成一个
--    技术上合法的邮箱地址，客户端那层负责这个转换，这里只管存密钥校验和角色），
--    再调用这个函数传入密钥，换取正式的 member 身份。login_account 存的是客人实际填的
--    那个邮箱或手机号原文，给后台"忘记账号是哪个"时展示用。
--    security definer 让它能在校验通过后写 profiles / 改 invite_codes，
--    但这个函数只做"校验密钥 + 建会员身份"这一件事，客户端没法绕过校验直接拿到 admin。
create or replace function redeem_invite_code(invite_code text, p_login_account text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
begin
  select member_id into v_member_id
  from invite_codes
  where code = invite_code and is_used = false
  for update;

  if v_member_id is null then
    raise exception '密钥无效或已被使用';
  end if;

  insert into profiles (id, role, member_type, member_id, login_account)
  values (auth.uid(), 'member', 'offline', v_member_id, p_login_account);

  update invite_codes set is_used = true, used_by = auth.uid() where code = invite_code;
end;
$$;

grant execute on function redeem_invite_code(text, text) to authenticated;


-- 3b. 密码重置密钥表 + 函数：手机号注册的账号背后是个假邮箱，收不到 Supabase 原生的
--     "忘记密码"邮件，所以密码重置也走跟注册一样的"主理人发一次性密钥"模式。
--     这个函数直接改 auth.users 里的密码字段（用 Supabase/GoTrue 同款的 bcrypt 加密方式写入），
--     不需要知道旧密码，也不需要邮箱/短信——所以必须严格校验密钥，且密钥用一次就失效。
create table if not exists password_reset_codes (
  code text primary key,
  member_id uuid references members(id) on delete cascade,
  is_used boolean not null default false,
  created_at timestamptz default now()
);

alter table password_reset_codes enable row level security;

create policy "管理员管理密码重置密钥" on password_reset_codes for all
  using (is_admin()) with check (is_admin());

create or replace function reset_password_with_code(reset_code text, new_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_user_id uuid;
begin
  if length(new_password) < 6 then
    raise exception '密码至少 6 位';
  end if;

  select member_id into v_member_id
  from password_reset_codes
  where code = reset_code and is_used = false
  for update;

  if v_member_id is null then
    raise exception '密钥无效或已被使用';
  end if;

  select id into v_user_id from profiles where member_id = v_member_id and role = 'member' limit 1;
  if v_user_id is null then
    raise exception '找不到对应的会员账号';
  end if;

  update auth.users set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf'))
  where id = v_user_id;

  update password_reset_codes set is_used = true where code = reset_code;
end;
$$;

-- 忘记密码的人此刻是未登录状态（anon），所以这个函数要开放给 anon 调用；
-- 安全完全靠密钥校验兜底，不是靠"要求已登录"。
grant execute on function reset_password_with_code(text, text) to anon, authenticated;


-- 4. 把现有的管理员账号标记为 admin —— 去 Supabase 后台「Authentication → Users」核对邮箱，
--    把下面的邮箱换成实际登录邮箱后再执行这一段。
insert into profiles (id, role)
select id, 'admin' from auth.users where email in ('xianli0145@gmail.com', '505369456@qq.com')
on conflict (id) do update set role = 'admin';


-- 5. 会员中心要读 members / class_packages / purchases 这三张表（查自己的课时和消费记录），
--    这几张表原来很可能没开 RLS —— 后台能正常用，是因为"只要登录成功就信任"，
--    现在既然要分清 admin 和 member，就必须补上"只能看自己的"这一层，顺便把管理员的完整读写权限也一起声明好，
--    避免开了 RLS 之后反而把后台自己的增删改锁住。
alter table members enable row level security;
alter table class_packages enable row level security;
alter table purchases enable row level security;

create policy "管理员管理会员档案" on members for all using (is_admin()) with check (is_admin());
create policy "管理员管理课时套餐" on class_packages for all using (is_admin()) with check (is_admin());
create policy "管理员管理消费记录" on purchases for all using (is_admin()) with check (is_admin());

create policy "会员查看自己的档案" on members for select
  using (id = (select member_id from profiles where id = auth.uid()));
create policy "会员查看自己的课时套餐" on class_packages for select
  using (member_id = (select member_id from profiles where id = auth.uid()));
create policy "会员查看自己的消费记录" on purchases for select
  using (member_id = (select member_id from profiles where id = auth.uid()));
