-- Read-only. Prints one checksum per kind of schema object in the public schema.
-- Run it in the TEST project after apply.sh and compare with the expected values
-- below. These were produced by replaying the files on PostgreSQL 16 and match
-- production's metadata (structure only) apart from the two migrations that
-- production has not applied yet.
--
-- Expected after apply.sh (all migrations, including 180000 and 200000):
--   col 219 797db45711cdbd1f1a6b02a2ee08643f
--   con 147 517792774bd72b9bcca5f4fc74ce789f
--   idx  62 a0b6eeedc66e36b392dfb80acfdca107
--   rls  19 9afced0d6fe6a2274635ce25b61f0d74
--   trg   8 c99016795c9c650775099133b2ec25ba
-- A different checksum is not automatically a problem (Postgres versions print
-- some definitions differently). Compare the counts first; if they differ, stop.
with x as (
select 'col' k, table_name||'.'||column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'') v from information_schema.columns where table_schema='public'
union all select 'con', (select relname from pg_class where oid=conrelid)||' '||contype::text||' '||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace
union all select 'idx', indexdef from pg_indexes where schemaname='public'
union all select 'rls', relname||' '||relrowsecurity::text from pg_class where relnamespace='public'::regnamespace and relkind='r'
union all select 'trg', (select relname from pg_class where oid=tgrelid)||' '||tgname::text from pg_trigger where not tgisinternal and (select relnamespace from pg_class where oid=tgrelid)='public'::regnamespace)
select k, count(*) n, md5(string_agg(v, '|' order by v)) h from x group by k order by k;
