-- Durable rate-limit counters for public endpoints (currently /api/license/validate).
-- ADDITIVE ONLY: creates one table and one function. NOT YET APPLIED to production;
-- apply after owner approval. The application fails open if this table is missing.
-- No personal data: `bucket` holds a keyed hash of the client address or a public embed id.
set local lock_timeout = '10s';

create table if not exists public.rate_limit_counters (
  bucket text not null check (char_length(bucket) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
create index if not exists rate_limit_counters_window_idx on public.rate_limit_counters (window_start);

alter table public.rate_limit_counters enable row level security;
revoke all on table public.rate_limit_counters from anon, authenticated;
grant select, insert, update, delete on table public.rate_limit_counters to service_role;

-- Atomic increment. Opportunistically prunes rows older than one day (about 1 call in 100).
create or replace function public.hit_rate_limit(p_bucket text, p_window_start timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_hits integer;
begin
  insert into public.rate_limit_counters as c (bucket, window_start, hits)
  values (p_bucket, p_window_start, 1)
  on conflict (bucket, window_start) do update set hits = c.hits + 1
  returning c.hits into new_hits;

  if random() < 0.01 then
    delete from public.rate_limit_counters where window_start < p_window_start - interval '1 day';
  end if;

  return new_hits;
end;
$$;

revoke all on function public.hit_rate_limit(text, timestamptz) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, timestamptz) to service_role;
