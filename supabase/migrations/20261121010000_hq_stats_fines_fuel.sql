-- HQ Statistik: fines and fuel warnings (#1191).
--
-- Adds two objects to hq_stats, from events the desktop app already uploads:
--   fines { total, amount, series }  crime.fined - payload {amount, key}; amount is the fine in aUEC
--                                    (a missing or non-numeric amount counts the fine, adds 0)
--   fuel  { total, series }          fuel.low - payload {fuel: 'hydrogen' | 'quantum', key}
-- Series are sparse like the other tiles; the client zero-fills.
--
-- Same signature, volatility, search_path and grants as 20261106200000_hq_stats_contracts.sql
-- (the latest body, copied whole). Alpha-phase data policy: purely additive, the other tiles are unchanged.

create or replace function public.hq_stats(p_range text default '30d')
returns jsonb
language sql
stable
set search_path = ''
as $$
  with params as (
    select case p_range when '7d' then 7 when '90d' then 90 else 30 end as days,
           case p_range when '7d' then 'day' else 'week' end as bucket_unit
  ),
  ev as materialized (
    select date_trunc((select bucket_unit from params), e.at)::date as bucket,
           e.type,
           e.data ->> 'kind' as kind,
           case when e.data ->> 'price' ~ '^-?[0-9]{1,15}(\.[0-9]+)?$' then (e.data ->> 'price')::numeric else 0 end as price,
           case when e.data ->> 'count' ~ '^[0-9]{1,6}$' then (e.data ->> 'count')::integer else 1 end as cnt,
           case when e.data ->> 'amount' ~ '^[0-9]{1,15}(\.[0-9]+)?$' then (e.data ->> 'amount')::numeric else 0 end as amount
      from public.hq_live_events e
     where e.user_id = (select auth.uid())
       and e.at >= now() - make_interval(days => (select days from params))
       and e.type in ('shop.purchase', 'contract.completed', 'contract.failed', 'contract.abandoned', 'incapacitated', 'insurance.claim_complete',
                      'crime.crimestat_increased', 'refinery.complete', 'blueprint.received',
                      'crime.fined', 'fuel.low')
  ),
  per_bucket as (
    select bucket,
           coalesce(sum(price) filter (where type = 'shop.purchase' and kind = 'sell'), 0) as earned,
           coalesce(sum(price) filter (where type = 'shop.purchase' and kind is distinct from 'sell'), 0) as spent,
           count(*) filter (where type = 'contract.completed') as missions,
           count(*) filter (where type = 'contract.failed') as failed,
           count(*) filter (where type = 'contract.abandoned') as abandoned,
           count(*) filter (where type = 'incapacitated') as deaths,
           count(*) filter (where type = 'insurance.claim_complete') as claims,
           count(*) filter (where type = 'crime.crimestat_increased') as crimestat,
           coalesce(sum(cnt) filter (where type = 'refinery.complete'), 0) as refinery,
           count(*) filter (where type = 'blueprint.received') as blueprints,
           count(*) filter (where type = 'crime.fined') as fines,
           coalesce(sum(amount) filter (where type = 'crime.fined'), 0) as fine_amount,
           count(*) filter (where type = 'fuel.low') as fuel
      from ev
     group by bucket
  )
  select jsonb_build_object(
    'range', (select case when p_range in ('7d', '90d') then p_range else '30d' end),
    'bucket', (select bucket_unit from params),
    'auec', jsonb_build_object(
      'earned', coalesce((select sum(earned) from per_bucket), 0),
      'spent',  coalesce((select sum(spent) from per_bucket), 0),
      'net',    coalesce((select sum(earned - spent) from per_bucket), 0),
      'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'value', earned - spent) order by bucket) from per_bucket), '[]'::jsonb)),
    'missions', jsonb_build_object(
      'total',  coalesce((select sum(missions) from per_bucket), 0),
      'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'value', missions) order by bucket) from per_bucket where missions > 0), '[]'::jsonb)),
    'contracts', jsonb_build_object(
      'failed',    coalesce((select sum(failed) from per_bucket), 0),
      'abandoned', coalesce((select sum(abandoned) from per_bucket), 0),
      'series',    coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'value', failed + abandoned) order by bucket) from per_bucket where failed + abandoned > 0), '[]'::jsonb)),
    'deaths_claims', jsonb_build_object(
      'deaths', coalesce((select sum(deaths) from per_bucket), 0),
      'claims', coalesce((select sum(claims) from per_bucket), 0),
      'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'deaths', deaths, 'claims', claims) order by bucket) from per_bucket where deaths > 0 or claims > 0), '[]'::jsonb)),
    'crimestat', jsonb_build_object(
      'total',  coalesce((select sum(crimestat) from per_bucket), 0),
      'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'value', crimestat) order by bucket) from per_bucket where crimestat > 0), '[]'::jsonb)),
    'refinery', jsonb_build_object(
      'total',  coalesce((select sum(refinery) from per_bucket), 0),
      'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'value', refinery) order by bucket) from per_bucket where refinery > 0), '[]'::jsonb)),
    'blueprints', jsonb_build_object(
      'total',  coalesce((select sum(blueprints) from per_bucket), 0),
      'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'value', blueprints) order by bucket) from per_bucket where blueprints > 0), '[]'::jsonb)),
    'fines', jsonb_build_object(
      'total',  coalesce((select sum(fines) from per_bucket), 0),
      'amount', coalesce((select sum(fine_amount) from per_bucket), 0),
      'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'value', fines) order by bucket) from per_bucket where fines > 0), '[]'::jsonb)),
    'fuel', jsonb_build_object(
      'total',  coalesce((select sum(fuel) from per_bucket), 0),
      'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'value', fuel) order by bucket) from per_bucket where fuel > 0), '[]'::jsonb))
  )
$$;

revoke all on function public.hq_stats(text) from public, anon;
grant execute on function public.hq_stats(text) to authenticated;

comment on function public.hq_stats(text) is
  'HQ Statistik: tiles (auec, missions, contracts, deaths_claims, crimestat, refinery, blueprints, fines, fuel) aggregated from the caller''s hq_live_events. '
  'p_range 7d|30d|90d; sparse series [{bucket (date), value}] - the client zero-fills. Empty data returns zeros and [] (never an error).';
