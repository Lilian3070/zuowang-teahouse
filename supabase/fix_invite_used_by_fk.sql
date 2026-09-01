-- 坐忘茗舍：修复 invite_codes.used_by 外键没设删除规则，导致 Supabase 后台删不掉用户
--
-- invite_codes.used_by 引用 auth.users(id)，当初建表时忘了写 on delete 规则，
-- Postgres 默认是 no action（相当于禁止删除被引用的那一行）。任何注册过、
-- 用过邀请码的账号，只要她的 invite_codes 记录还在（哪怕已经标记 is_used=true），
-- 在 Supabase 后台 Authentication → Users 里点删除就会报
-- "Database error deleting user"，删不掉。
--
-- 改成 on delete set null：账号被删之后，这条密钥的"是谁用的"这一格自然清空，
-- 密钥本身的使用记录（is_used、member_id）不受影响，只是不知道具体是哪个
-- auth 账号用的了——这条数据本来就只是审计用途，不影响任何功能。

alter table invite_codes drop constraint if exists invite_codes_used_by_fkey;
alter table invite_codes add constraint invite_codes_used_by_fkey
  foreign key (used_by) references auth.users(id) on delete set null;
