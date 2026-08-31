-- 坐忘茗舍：注册密钥 / 密码重置密钥超过 3 天未使用自动清理
-- 在 Supabase 项目后台 → SQL Editor 里粘贴执行一次即可，之后每天凌晨自动运行，不用再管

-- 开启 pg_cron 扩展（数据库自带的定时任务功能）
create extension if not exists pg_cron with schema extensions;

-- 每天 UTC 3 点（北京时间 11 点）跑一次，删掉生成超过 3 天、还没被使用的密钥。
-- 已经使用过的密钥不会被删，留着对账/追溯用。
select cron.schedule(
  'cleanup-expired-codes',
  '0 3 * * *',
  $$
  delete from invite_codes where is_used = false and created_at < now() - interval '3 days';
  delete from password_reset_codes where is_used = false and created_at < now() - interval '3 days';
  $$
);
