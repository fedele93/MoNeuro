-- =====================================================================
--  ESEMPIO: caricare reparti e letti via SQL (facoltativo)
--
--  Normalmente non serve: i reparti si creano dall'app
--  (⚙︎ Impostazioni → Amministrazione → Reparti), indicando nome e numero di letti.
--  Questo file serve solo se preferite caricare tutto in una volta dall'editor SQL
--  di Supabase. Modificate l'elenco qui sotto con i VOSTRI reparti e letti, poi
--  incollate tutto in: SQL Editor → New query → Run.
--
--  Lo script non tocca i reparti già esistenti con lo stesso nome e non crea letti
--  in un reparto che ne ha già.
-- =====================================================================

with voluti(nome, ordine, letti) as (values
  ('Neurologia',  1, 12),
  ('Stroke Unit', 2,  4)
),
nuovi as (
  insert into public.reparti (nome, ordine)
  select nome, ordine from voluti
  on conflict (nome) do nothing
  returning id, nome
)
insert into public.letti (reparto_id, nome, ordine)
select r.id, n::text, n
from public.reparti r
join voluti v on v.nome = r.nome
cross join lateral generate_series(1, v.letti) as n
where not exists (select 1 from public.letti l where l.reparto_id = r.id);

-- Per riferimento, la configurazione originale del Policlinico di Bari era:
--   ('Stroke', 1, 8), ('PUCA', 2, 8), ('Ospedaliera', 3, 8),
--   ('Amaducci Uomini', 4, 10), ('Amaducci Donne', 5, 10)
