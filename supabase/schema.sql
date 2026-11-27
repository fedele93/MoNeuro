-- =====================================================================
--  Neuro Reparto - schema database Supabase
--  Incollare tutto in: Supabase -> SQL Editor -> New query -> Run
-- =====================================================================

-- ---------- PROFILI (nome visualizzato dei medici) ----------
create table if not exists public.profili (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default ''
);
alter table public.profili add column if not exists email text;
alter table public.profili add column if not exists ruolo text not null default 'medico';  -- 'medico' | 'admin'
alter table public.profili add column if not exists attivo boolean not null default true;
alter table public.profili add column if not exists scadenza date;                         -- account valido fino a (es. fine rotazione)
alter table public.profili add column if not exists creato_il timestamptz not null default now();
do $$ begin
  alter table public.profili add constraint profili_ruolo_ck check (ruolo in ('medico', 'admin'));
exception when duplicate_object then null; end $$;

-- crea automaticamente il profilo quando si aggiunge un utente
create or replace function public.nuovo_profilo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profili (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.nuovo_profilo();

-- ---------- REPARTI ----------
create table if not exists public.reparti (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ordine int not null default 0
);

-- ---------- LETTI ----------
create table if not exists public.letti (
  id uuid primary key default gen_random_uuid(),
  reparto_id uuid not null references public.reparti(id) on delete cascade,
  nome text not null,                -- es. "1", "2", "12bis"
  ordine int not null default 0,
  creato_il timestamptz not null default now()
);
create index if not exists letti_reparto_idx on public.letti(reparto_id);

-- ---------- PAZIENTI ----------
create table if not exists public.pazienti (
  id uuid primary key default gen_random_uuid(),
  letto_id uuid not null references public.letti(id) on delete cascade,
  reparto_id uuid not null references public.reparti(id) on delete cascade,
  nome text not null,
  note text not null default '',
  dimesso boolean not null default false,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid references auth.users(id)
);
create index if not exists pazienti_reparto_idx on public.pazienti(reparto_id) where not dimesso;
-- un solo paziente attivo per letto
create unique index if not exists un_paziente_per_letto on public.pazienti(letto_id) where not dimesso;

-- ---------- ATTIVITA' (e sotto-attività tramite parent_id) ----------
create table if not exists public.attivita (
  id uuid primary key default gen_random_uuid(),
  paziente_id uuid not null references public.pazienti(id) on delete cascade,
  reparto_id uuid not null references public.reparti(id) on delete cascade,
  parent_id uuid references public.attivita(id) on delete cascade,
  testo text not null,
  urgente boolean not null default false,
  fatta boolean not null default false,
  creata_da uuid references auth.users(id) default auth.uid(),
  creata_il timestamptz not null default now(),
  fatta_da uuid references auth.users(id),
  fatta_il timestamptz
);
create index if not exists attivita_reparto_idx on public.attivita(reparto_id) where not fatta;
create index if not exists attivita_paziente_idx on public.attivita(paziente_id);

-- ---------- ISCRIZIONI ALLE NOTIFICHE PUSH ----------
create table if not exists public.notifiche_iscrizioni (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  reparti uuid[],                    -- null = tutti i reparti
  creato_il timestamptz not null default now()
);

-- ---------- CONSEGNE PER LA GUARDIA ----------
alter table public.pazienti add column if not exists consegna text not null default '';
alter table public.pazienti add column if not exists gravita smallint not null default 0;   -- 0 nessuna, 1 da monitorare, 2 critico
alter table public.pazienti add column if not exists rianimazione text;                     -- null, 'si', 'limitata', 'no'
alter table public.pazienti add column if not exists allergie text not null default '';
alter table public.pazienti add column if not exists consegna_il timestamptz;
alter table public.pazienti add column if not exists consegna_da uuid references auth.users(id);
alter table public.attivita add column if not exists guardia boolean not null default false; -- valutazione per la guardia
alter table public.attivita add column if not exists ora text;                              -- es. "22:00"
create index if not exists attivita_guardia_idx on public.attivita(guardia) where guardia and not fatta;

-- ---------- aggiornamento automatico data modifica paziente / consegna ----------
create or replace function public.tocca_paziente()
returns trigger language plpgsql as $$
begin
  new.aggiornato_il := now();
  new.aggiornato_da := auth.uid();
  if new.consegna is distinct from old.consegna
     or new.gravita is distinct from old.gravita
     or new.rianimazione is distinct from old.rianimazione
     or new.allergie is distinct from old.allergie then
    new.consegna_il := now();
    new.consegna_da := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists pazienti_tocca on public.pazienti;
create trigger pazienti_tocca before update on public.pazienti
  for each row execute function public.tocca_paziente();

-- ---------- SCADENZE, RIPETIZIONI, ASSEGNAZIONE, GIORNI DI RICOVERO ----------
alter table public.attivita add column if not exists scadenza timestamptz;      -- da fare entro
alter table public.attivita add column if not exists ripeti_ore smallint;       -- es. 6 = ogni 6 ore
alter table public.attivita add column if not exists ripeti_orari text;         -- es. "08:00,12:00,18:00"
alter table public.attivita add column if not exists assegnata_a uuid references auth.users(id) on delete set null;
create index if not exists attivita_assegnata_idx on public.attivita(assegnata_a) where not fatta;
alter table public.pazienti add column if not exists data_ricovero date not null default current_date;

-- prossima azione da fare (da richiedere, da prenotare, da eseguire, da scaricare) con chi/quando
alter table public.attivita add column if not exists stato text;
alter table public.attivita add column if not exists stato_il timestamptz;
alter table public.attivita add column if not exists stato_da uuid references auth.users(id) on delete set null;
-- stati ammessi: da richiedere, da prenotare, da eseguire, da scaricare
-- (si può rieseguire senza danni: i vecchi stati vengono convertiti una volta sola)
alter table public.attivita drop constraint if exists attivita_stato_ck;
update public.attivita set stato = null where stato in ('eseguito', 'refertato', 'visionato');
update public.attivita set stato = 'da_prenotare' where stato = 'richiesto';
update public.attivita set stato = 'da_eseguire' where stato = 'prenotato';
alter table public.attivita add constraint attivita_stato_ck
  check (stato is null or stato in ('da_richiedere', 'da_prenotare', 'da_eseguire', 'da_scaricare'));
create or replace function public.tocca_stato()
returns trigger language plpgsql as $$
begin
  if new.stato is distinct from old.stato then
    new.stato_il := case when new.stato is null then null else now() end;
    new.stato_da := case when new.stato is null then null else auth.uid() end;
  end if;
  return new;
end $$;
drop trigger if exists attivita_stato on public.attivita;
create trigger attivita_stato before update on public.attivita
  for each row execute function public.tocca_stato();

-- profili esistenti: email e profilo mancante
insert into public.profili (id, nome, email)
select u.id, coalesce(u.raw_user_meta_data->>'nome', split_part(u.email, '@', 1)), u.email
from auth.users u on conflict (id) do nothing;
update public.profili p set email = u.email from auth.users u where u.id = p.id and p.email is distinct from u.email;

-- =====================================================================
--  CHI PUO' ACCEDERE: utenti attivi, non scaduti; amministratori
-- =====================================================================
create or replace function public.utente_attivo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profili
                 where id = auth.uid() and attivo and (scadenza is null or scadenza >= current_date));
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profili
                 where id = auth.uid() and ruolo = 'admin' and attivo and (scadenza is null or scadenza >= current_date));
$$;

-- solo un amministratore cambia ruolo, stato e scadenza; resta sempre almeno un amministratore
create or replace function public.proteggi_profilo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() and (
       new.ruolo is distinct from old.ruolo or new.attivo is distinct from old.attivo
    or new.scadenza is distinct from old.scadenza or new.email is distinct from old.email) then
    raise exception 'Solo un amministratore può modificare ruolo, stato o scadenza';
  end if;
  if old.ruolo = 'admin' and old.attivo and (new.ruolo <> 'admin' or not new.attivo)
     and not exists (select 1 from public.profili where ruolo = 'admin' and attivo and id <> old.id) then
    raise exception 'Deve restare almeno un amministratore attivo';
  end if;
  return new;
end $$;
drop trigger if exists profili_proteggi on public.profili;
create trigger profili_proteggi before update on public.profili
  for each row execute function public.proteggi_profilo();

-- ---------- RICHIESTE DI ACCESSO (dalla pagina di login) ----------
create table if not exists public.richieste_accesso (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text not null,
  messaggio text not null default '',
  stato text not null default 'in_attesa',          -- in_attesa | approvata | rifiutata
  creata_il timestamptz not null default now(),
  gestita_da uuid references auth.users(id) on delete set null,
  gestita_il timestamptz
);
do $$ begin
  alter table public.richieste_accesso add constraint richieste_ck check (
    stato in ('in_attesa', 'approvata', 'rifiutata')
    and length(nome) between 2 and 100 and length(email) between 5 and 200 and length(messaggio) <= 500
    and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
exception when duplicate_object then null; end $$;
create unique index if not exists richieste_una_in_attesa on public.richieste_accesso (lower(email)) where stato = 'in_attesa';

-- ---------- IMPOSTAZIONI (leggibili dall'app) e SEGRETI (solo server) ----------
create table if not exists public.impostazioni (chiave text primary key, valore text not null);
create table if not exists public.segreti (chiave text primary key, valore text not null);

-- l'amministratore salva le chiavi delle notifiche generate nell'app:
-- la pubblica va in "impostazioni", la privata in "segreti" (non rileggibile dall'app)
create or replace function public.imposta_chiavi_notifiche(p_pubblica text, p_privata text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo un amministratore'; end if;
  insert into public.impostazioni values ('vapid_public', p_pubblica)
    on conflict (chiave) do update set valore = excluded.valore;
  insert into public.segreti values ('vapid_private', p_privata)
    on conflict (chiave) do update set valore = excluded.valore;
end $$;

-- =====================================================================
--  SICUREZZA (Row Level Security): solo utenti autenticati
-- =====================================================================
alter table public.profili               enable row level security;
alter table public.reparti               enable row level security;
alter table public.letti                 enable row level security;
alter table public.pazienti              enable row level security;
alter table public.attivita              enable row level security;
alter table public.notifiche_iscrizioni  enable row level security;
alter table public.richieste_accesso     enable row level security;
alter table public.impostazioni          enable row level security;
alter table public.segreti               enable row level security;  -- nessuna regola: solo il server

-- (select ...) fa calcolare il controllo una volta sola per richiesta
drop policy if exists "leggi profili" on public.profili;
create policy "leggi profili" on public.profili for select to authenticated
  using (id = auth.uid() or (select public.utente_attivo()));
drop policy if exists "modifica proprio profilo" on public.profili;
create policy "modifica proprio profilo" on public.profili for update to authenticated
  using ((id = auth.uid() and (select public.utente_attivo())) or (select public.is_admin()))
  with check ((id = auth.uid() and (select public.utente_attivo())) or (select public.is_admin()));

drop policy if exists "leggi reparti" on public.reparti;
create policy "leggi reparti" on public.reparti for select to authenticated using ((select public.utente_attivo()));

drop policy if exists "medici letti" on public.letti;
create policy "medici letti" on public.letti for all to authenticated
  using ((select public.utente_attivo())) with check ((select public.utente_attivo()));

drop policy if exists "medici pazienti" on public.pazienti;
create policy "medici pazienti" on public.pazienti for all to authenticated
  using ((select public.utente_attivo())) with check ((select public.utente_attivo()));

drop policy if exists "medici attivita" on public.attivita;
create policy "medici attivita" on public.attivita for all to authenticated
  using ((select public.utente_attivo())) with check ((select public.utente_attivo()));

drop policy if exists "proprie iscrizioni" on public.notifiche_iscrizioni;
create policy "proprie iscrizioni" on public.notifiche_iscrizioni for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and (select public.utente_attivo()));

drop policy if exists "invia richiesta" on public.richieste_accesso;
create policy "invia richiesta" on public.richieste_accesso for insert to anon, authenticated
  with check (stato = 'in_attesa' and gestita_da is null and gestita_il is null);
drop policy if exists "admin richieste" on public.richieste_accesso;
create policy "admin richieste" on public.richieste_accesso for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "leggi impostazioni" on public.impostazioni;
create policy "leggi impostazioni" on public.impostazioni for select to authenticated using ((select public.utente_attivo()));

-- =====================================================================
--  TEMPO REALE
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.letti;    exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.pazienti; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.attivita; exception when duplicate_object then null; end;
  end if;
end $$;

-- =====================================================================
--  REPARTI E LETTI: si creano e si modificano dall'app
--  (⚙︎ Impostazioni → Amministrazione → Reparti). Lo schema non impone
--  né nomi né numero di letti: ogni ospedale configura i propri.
--  Un esempio di caricamento via SQL è in supabase/esempi/reparti-esempio.sql
-- =====================================================================

-- solo gli amministratori creano, rinominano, riordinano ed eliminano i reparti
drop policy if exists "admin reparti" on public.reparti;
create policy "admin reparti" on public.reparti for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- non si elimina un reparto con pazienti ricoverati (verrebbero cancellati a cascata)
create or replace function public.proteggi_reparto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.pazienti where reparto_id = old.id and not dimesso) then
    raise exception 'Il reparto "%" ha pazienti ricoverati: trasferiscili o dimettili prima di eliminarlo', old.nome;
  end if;
  return old;
end $$;
drop trigger if exists reparti_proteggi on public.reparti;
create trigger reparti_proteggi before delete on public.reparti
  for each row execute function public.proteggi_reparto();

-- crea un reparto con i suoi letti numerati (1..N) in una sola operazione
create or replace function public.crea_reparto(p_nome text, p_letti int default 0)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_ordine int;
begin
  if length(trim(p_nome)) = 0 then raise exception 'Nome del reparto mancante'; end if;
  if p_letti < 0 or p_letti > 200 then raise exception 'Numero di letti non valido'; end if;
  select coalesce(max(ordine), 0) + 1 into v_ordine from public.reparti;
  insert into public.reparti (nome, ordine) values (trim(p_nome), v_ordine) returning id into v_id;
  insert into public.letti (reparto_id, nome, ordine)
  select v_id, n::text, n from generate_series(1, p_letti) as n;
  return v_id;
end $$;
grant execute on function public.crea_reparto(text, int) to authenticated;

-- i reparti si aggiornano in tempo reale su tutti i telefoni
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.reparti; exception when duplicate_object then null; end;
  end if;
end $$;

-- =====================================================================
--  TRASFERIMENTO paziente in un altro letto (anche di altro reparto)
-- =====================================================================
create or replace function public.trasferisci_paziente(p_paziente uuid, p_letto uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_reparto uuid;
begin
  select reparto_id into v_reparto from public.letti where id = p_letto;
  if v_reparto is null then raise exception 'Letto non trovato'; end if;
  update public.pazienti set letto_id = p_letto, reparto_id = v_reparto where id = p_paziente;
  update public.attivita set reparto_id = v_reparto where paziente_id = p_paziente and reparto_id <> v_reparto;
end $$;
grant execute on function public.trasferisci_paziente(uuid, uuid) to authenticated;

-- =====================================================================
--  PACCHETTI DI ATTIVITA' (modificabili dall'app)
--  voci = [{"t": "testo attività", "f": ["sotto-attività", ...]}, ...]
-- =====================================================================
create table if not exists public.pacchetti (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ordine int not null default 0,
  voci jsonb not null default '[]'::jsonb,
  aggiornato_il timestamptz not null default now()
);
alter table public.pacchetti enable row level security;
drop policy if exists "medici pacchetti" on public.pacchetti;
create policy "medici pacchetti" on public.pacchetti for all to authenticated
  using ((select public.utente_attivo())) with check ((select public.utente_attivo()));

-- pacchetti iniziali di esempio (inseriti solo se la tabella è vuota): da adattare ai vostri protocolli
insert into public.pacchetti (nome, ordine, voci)
select v.nome, v.ordine, v.voci::jsonb from (values
  ('Ingresso (generale)', 1, '[
    {"t":"Riconciliazione terapia domiciliare"},
    {"t":"Esami ematici di ingresso","f":["Emocromo","Funzionalità renale ed elettroliti","Funzionalità epatica","Coagulazione","Glicemia"]},
    {"t":"ECG"},
    {"t":"Valutazione rischio cadute e lesioni da pressione"},
    {"t":"Contatto con i familiari / caregiver"}
  ]'),
  ('Ictus ischemico', 2, '[
    {"t":"TC encefalo di controllo a 24h"},
    {"t":"RM encefalo"},
    {"t":"Ecocolordoppler TSA"},
    {"t":"Ecocardiogramma"},
    {"t":"Monitoraggio ECG / Holter"},
    {"t":"Esami fattori di rischio","f":["Profilo lipidico","HbA1c","TSH"]},
    {"t":"Screening disfagia"},
    {"t":"Valutazione fisiatrica"},
    {"t":"Valutazione logopedica"},
    {"t":"Impostare terapia antitrombotica"},
    {"t":"Profilassi TVP"}
  ]'),
  ('Post trombolisi / trombectomia', 3, '[
    {"t":"NIHSS seriati"},
    {"t":"Monitoraggio PA"},
    {"t":"Glicemia"},
    {"t":"TC encefalo di controllo a 24h"},
    {"t":"Antitrombotici solo dopo TC di controllo"}
  ]'),
  ('Ictus emorragico', 4, '[
    {"t":"TC encefalo di controllo"},
    {"t":"Angio-TC"},
    {"t":"Controllo PA al target"},
    {"t":"Coagulazione / reverse anticoagulante"},
    {"t":"Consulenza neurochirurgica"},
    {"t":"Screening disfagia"},
    {"t":"Valutazione fisiatrica"}
  ]'),
  ('Crisi epilettica', 5, '[
    {"t":"EEG"},
    {"t":"RM encefalo"},
    {"t":"Esami","f":["Glicemia","Elettroliti, Ca, Mg","CK","Livelli antiepilettici"]},
    {"t":"ECG"},
    {"t":"Valutare terapia antiepilettica"},
    {"t":"Informare su idoneità alla guida"}
  ]'),
  ('Malattia demielinizzante', 6, '[
    {"t":"RM encefalo e midollo con mdc"},
    {"t":"Rachicentesi","f":["Esame chimico-fisico","Bande oligoclonali","Indice IgG"]},
    {"t":"Potenziali evocati"},
    {"t":"Esami","f":["Vitamina D","Autoimmunità","Anticorpi AQP4 / MOG"]},
    {"t":"Programmare terapia"}
  ]'),
  ('Dimissione', 7, '[
    {"t":"Lettera di dimissione"},
    {"t":"Prescrizioni / piani terapeutici"},
    {"t":"Prenotare controllo ambulatoriale"},
    {"t":"Esami da eseguire dopo la dimissione"},
    {"t":"Riabilitazione / continuità assistenziale"}
  ]')
) as v(nome, ordine, voci)
where not exists (select 1 from public.pacchetti);

-- =====================================================================
--  PERMESSI DI ACCESSO ALLE TABELLE (solo utenti autenticati)
--  Nei progetti Supabase recenti le tabelle create via SQL non sono
--  accessibili all'app senza questi permessi. Chi può fare cosa riga per
--  riga resta deciso dalle regole RLS definite sopra.
-- =====================================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.trasferisci_paziente(uuid, uuid) to authenticated;
grant execute on function public.crea_reparto(text, int) to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
-- nessun accesso per chi non ha fatto login, tranne inviare una richiesta di accesso
revoke all on all tables in schema public from anon;
grant usage on schema public to anon;
grant insert on public.richieste_accesso to anon;
-- le chiavi segrete non sono mai leggibili dall'app
revoke all on public.segreti from authenticated, anon;
revoke execute on function public.imposta_chiavi_notifiche(text, text) from anon;
-- il server (Edge Functions) accede a tutto
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
