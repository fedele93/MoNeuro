# Neuro Reparto

© 2026 Ideazione e realizzazione: Paolo Roberto. Con la collaborazione di: Domenico M. Mezzapesa. Tutti i diritti riservati.

App per telefono (web app installabile) con le attività dei pazienti dei reparti di Neurologia. Si aggiorna in tempo reale per tutti i medici collegati e invia notifiche push.

- **Reparti e letti** non sono scritti nel codice: li crea l'amministratore dall'app (**⚙︎ → Amministrazione → Reparti**), indicando nome e numero di letti. Si possono rinominare, riordinare ed eliminare; i letti si aggiungono, rinominano ed eliminano dalla schermata del reparto. La stessa app serve quindi per qualsiasi ospedale.
- Per ogni letto: **paziente**, **appunti**, **attività** e **sotto-attività** da spuntare. Le attività si possono segnare come **urgenti**.
- Un'attività spuntata sparisce dalla lista. Resta nello storico (pulsante **"Fatte"**, ultimi 3 giorni) con chi l'ha fatta e quando. Subito dopo la spunta compare **"Annulla"** per correggere un errore.
- Spuntando un'attività vengono chiuse anche le sue sotto-attività.
- **🌙 Guardia**: una scheda unica con i pazienti di tutti i reparti che hanno una consegna, ordinati per gravità. Per ogni paziente: gravità (da monitorare / critico), stato rianimatorio, allergie, notizie principali e valutazioni da fare con orario. Si vede chi ha aggiornato la consegna e quando, con un avviso se è più vecchia di 24 ore. Si può stampare come copia di riserva.
- Si può **trasferire** un paziente in un altro letto, anche di un altro reparto, oppure **dimetterlo**.
- **Notifiche push**: ogni medico sceglie i reparti da seguire e riceve un avviso quando un collega aggiunge un'attività. Chi la crea non riceve la propria notifica.
- Accesso solo con account personale, creato da te: non ci si può registrare da soli.

Servizi usati, tutti con piano gratuito: **Supabase** (database, login, tempo reale, notifiche), e **GitHub** (codice e pubblicazione automatica con GitHub Pages).

---

## Aggiornare un database già creato
Se hai già eseguito lo schema in passato, riesegui semplicemente tutto [`supabase/schema.sql`](supabase/schema.sql) nell'editor SQL. Lo script aggiunge solo ciò che manca (per esempio la gestione dei reparti dall'app) e non cancella nessun dato: i reparti e i letti che avete già restano com'erano. Poi ripubblica la funzione notifiche (`npx supabase functions deploy notifica --no-verify-jwt`) e l'app.

## 1. Crea il progetto Supabase
1. Registrati su https://supabase.com, poi **New project**.
2. **Region: Central EU (Frankfurt)**, così i dati restano in UE. Scegli una password robusta per il database e conservala.
3. Apri **SQL Editor → New query**, incolla tutto il contenuto di [`supabase/schema.sql`](supabase/schema.sql) e premi **Run**.
   Vengono create le tabelle, le regole di sicurezza e il tempo reale. **Nessun reparto è prestabilito**: reparti e letti li creerai dall'app al passo 3.

## 2. Blocca le registrazioni libere
- **Authentication → Sign In / Providers → Email**: lascia attivo Email.
- Disattiva **"Allow new users to sign up"**.
- **Authentication → URL Configuration → Site URL**: lo inserirai al passo 6, quando avrai l'indirizzo dell'app.

## 3. Diventa amministratore
Dopo aver creato il tuo utente (*Authentication → Users → Add user → Create new user*, con **Auto Confirm User**),
in *SQL Editor* esegui, con la tua email:
```sql
update public.profili set ruolo = 'admin' where email = 'la-tua-email@esempio.it';
```
Da quel momento nell'app compare **⚙︎ Impostazioni → 👥 Amministrazione**.

Al primo accesso l'app ti dirà che non ci sono reparti: premi **Crea il primo reparto** (oppure **⚙︎ → Amministrazione → Reparti → + Nuovo reparto**), scrivi il nome e il numero di letti. Ripeti per ogni reparto. Tutto si può cambiare in seguito, senza toccare il codice né il database.
Se preferisci caricare molti reparti in una volta dall'editor SQL, c'è un esempio in [`supabase/esempi/reparti-esempio.sql`](supabase/esempi/reparti-esempio.sql).

## 4. Pubblica le due funzioni server (Edge Functions) — anche dal browser
Su Supabase: **Edge Functions → Deploy a new function → Via Editor** (o "Open Editor").
Ripeti per ciascuna funzione:

| Nome funzione | Codice da incollare |
|---|---|
| `admin` | [`supabase/functions/admin/index.ts`](supabase/functions/admin/index.ts) |
| `notifica` | [`supabase/functions/notifica/index.ts`](supabase/functions/notifica/index.ts) |

Apri il file su GitHub, premi l'icona **Copy raw file**, incolla nell'editor al posto del testo di esempio,
scrivi il nome esatto e premi **Deploy**. Lascia attivo **Verify JWT**.

## 5. Collega le notifiche al database (Database Webhooks)
Su Supabase: **Database → Webhooks** (nelle versioni recenti **Integrations → Database Webhooks**) → **Create a new hook**.
Creane due:

| Nome | Tabella | Eventi | Funzione |
|---|---|---|---|
| `notifica_attivita` | `attivita` | **Insert** e **Update** | `notifica` |
| `notifica_richieste` | `richieste_accesso` | **Insert** | `notifica` |

Per entrambi: *Type of webhook* → **Supabase Edge Functions**, metodo **POST**, funzione **notifica**,
poi in *HTTP Headers* premi **Add auth header with service key**. Salva.

Infine nell'app: **⚙︎ → Amministrazione → Notifiche → Genera chiavi** (una volta sola).
Ogni medico poi attiva le notifiche da **⚙︎ Impostazioni → Attiva notifiche**
(su iPhone/iPad solo aprendo l'app dall'icona sulla schermata Home).

Chi riceve cosa:
- **nuova attività** → chi segue quel reparto (tranne chi l'ha scritta);
- **attività assegnata** → solo la persona a cui è stata assegnata;
- **nuova richiesta di accesso** → gli amministratori.

## Gestione degli accessi (dall'app)
- Il collega preme **"Richiedi accesso"** nella pagina di login e inserisce nome, email e ruolo.
- Un amministratore apre **⚙︎ → Amministrazione → Richieste** → **Approva**: sceglie ruolo e, se serve,
  la **data di scadenza** (es. fine rotazione dello specializzando: a quella data l'account si blocca da solo).
- L'app prepara il messaggio con indirizzo, email e **password provvisoria** da inviare con **Condividi** (WhatsApp, email…).
  Non serve configurare l'invio di email.
- In **Utenti** si può cambiare ruolo e scadenza, **bloccare** un account (effetto immediato), impostare una nuova
  password provvisoria o eliminare l'account. Nominate almeno **due amministratori**.
- In alternativa, per caricare molti account insieme dal computer: [`scripts/crea-utenti.mjs`](scripts/crea-utenti.mjs).

## 6. Pubblica l'app (GitHub Pages)
L'app viene costruita e pubblicata da GitHub stesso (file `.github/workflows/pubblica.yml`).
Ogni modifica caricata sul ramo `main` va online da sola in 1–2 minuti. Non servono altri servizi.

> Il repository deve essere **pubblico** (GitHub Pages è gratuito solo per i repository pubblici).
> Il codice non contiene dati né password: i dati stanno su Supabase e le chiavi nei *Secrets* di GitHub.

1. **Rendi pubblico il repository** (una volta sola): *Settings → General* → in fondo, *Danger Zone* → **Change visibility** → **Public**.
2. **Attiva GitHub Pages** (una volta sola): *Settings → Pages* → *Build and deployment* → **Source: GitHub Actions**.
3. **Inserisci le chiavi**: *Settings → Secrets and variables → Actions* → **New repository secret**:
   | Nome | Valore |
   |---|---|
   | `VITE_SUPABASE_URL` | Project URL di Supabase |
   | `VITE_SUPABASE_ANON_KEY` | chiave anon / publishable di Supabase (**mai** la secret) |
   | `VITE_VAPID_PUBLIC_KEY` | (facoltativa) chiave pubblica VAPID per le notifiche |
4. **Pubblica**: scheda **Actions** → **Pubblica l'app** → **Run workflow**. Dopo 1–2 minuti l'app è online su
   `https://<organizzazione>.github.io/<nome-repository>/` (l'indirizzo esatto compare in *Settings → Pages*).
5. **Supabase** → *Authentication → URL Configuration*: inserisci quell'indirizzo come **Site URL**
   e aggiungilo anche in **Redirect URLs**.
6. (Consigliato) *Settings → General → Features*: togli la spunta a **Issues**, così nessun estraneo può scrivervi.

**Se la pubblicazione non va** (pallino rosso in *Actions*): apri l'esecuzione fallita; il primo passo
"Controllo chiavi" dice se manca qualche chiave.

**Spostare l'app altrove** (Netlify, server dell'ospedale…): l'app funziona anche alla radice di un sito.
`npm run build` crea la cartella `dist` da copiare su qualsiasi server web (per Netlify c'è già `netlify.toml`).

## 7. Installare l'app sul telefono
- **iPhone (Safari)**: apri l'indirizzo, tocca **Condividi → Aggiungi alla schermata Home**. Apri l'app **dall'icona**, poi ⚙︎ → **Attiva notifiche**. Su iPhone le notifiche funzionano solo dall'icona sulla Home, con iOS 16.4 o successivo.
- **Android (Chrome)**: apri l'indirizzo, poi menu ⋮ → **Installa app** (o "Aggiungi a schermata Home"), quindi ⚙︎ → **Attiva notifiche**.

---

## Provarla sul computer
```bash
cp .env.example .env
```
Compila `.env` con i tuoi valori, poi:
```bash
npm install
```
```bash
npm run dev
```
Apri http://localhost:5173.

## Adattare l'app al proprio ospedale
Il codice non contiene nulla di specifico di un ospedale. Ecco dove si cambia cosa:

| Cosa | Dove |
|---|---|
| Reparti (nome, ordine delle schede, eliminazione) | App: **⚙︎ → Amministrazione → Reparti** (solo amministratori) |
| Letti di un reparto (numero, nomi) | App: pulsante **+ Aggiungi letto** in fondo al reparto; tocca il numero di un letto libero per rinominarlo o eliminarlo |
| Pacchetti di attività (protocolli di ingresso, ictus, …) | App: **⚙︎ → Pacchetti di attività** (quelli iniziali sono solo un esempio da adattare) |
| Elenco delle indagini riconosciute come esami | [`src/indagini.js`](src/indagini.js) |
| Nome dell'app e icone | `index.html`, `public/manifest.webmanifest`, `public/sw.js`, cartella `public/` |
| Database, login, notifiche | Il **tuo** progetto Supabase: chiavi nei *Secrets* di GitHub (passo 6) o in `.env` sul computer |

## Come si usa
| Azione | Come |
|---|---|
| Cambiare reparto | Schede in alto |
| Ricoverare un paziente | Letto libero → **+ Paziente** |
| Modificare nome, appunti, data di ricovero, trasferire, dimettere | Tocca il nome del paziente |
| Nuova attività | Campo "Nuova attività…" in fondo alla scheda; **!** per segnarla urgente |
| Sotto-attività | **↳+** accanto all'attività (puoi scriverne più di una, una per riga) |
| Segnare come fatta | Tocca la casella; compare **Annulla** per qualche secondo |
| Modificare, segnare urgente o eliminare un'attività | Tocca il testo dell'attività |
| Scrivere la consegna per la guardia | 🌙 sulla scheda del paziente |
| Valutazione da fare in guardia | 🌙 accanto a "Nuova attività…", oppure dalla scheda **🌙 Guardia** (con orario) |
| Stampare le consegne | Scheda **🌙 Guardia** → **🖨 Stampa** |
| Orario, ripetizione ("ogni 6h", "08 · 12 · 18"), assegnazione | Tocca il testo dell'attività |
| Vedere solo le attività assegnate a te | Pulsante **Mie** |
| Cercare un paziente in tutti i reparti | 🔍 in alto |
| Giornata di ricovero | **G5** accanto al nome (data modificabile nella scheda del paziente) |
| Orari nei pacchetti | in fondo alla riga: `[ogni 6h]`, `[08:00 12:00 18:00]`, `[entro 24h]` |
| Vedere le attività fatte | Pulsante **Fatte** |
| Vedere solo i letti con qualcosa da fare | Pulsante **Con attività** |
| Aggiungere un letto | **+ Aggiungi letto** in fondo alla lista |
| Rinominare o eliminare un letto libero | **⋯** sul letto libero |

## Limiti del piano gratuito
- **Pausa dopo 7 giorni senza utilizzo**: con l'uso quotidiano non succede.
- **Nessun backup automatico** nel piano gratuito. Fai un'esportazione periodica da **Database → Backups** o con `npx supabase db dump`, oppure passa al piano Pro (circa 25 $/mese) che include i backup giornalieri.
- Consumi stimati per 60 medici: molto al di sotto dei limiti gratuiti (dati scaricati, messaggi in tempo reale, chiamate alle funzioni).

## Privacy (GDPR)
I dati dei pazienti sono dati sanitari (art. 9 GDPR). Prima di usare l'app con pazienti reali:
- fai **approvare l'uso dal DPO** dell'ospedale;
- inserisci il minimo indispensabile, per esempio cognome e iniziale, senza codice fiscale né dati superflui negli appunti;
- usa account personali e non condividere le password;
- se l'ospedale lo richiede, Supabase si può installare sui server interni (self-hosting con Docker) senza cambiare il codice dell'app.

## Struttura del progetto
```
supabase/schema.sql                 database, sicurezza, reparti e letti iniziali
supabase/functions/notifica/        invio notifiche push (Edge Function)
scripts/crea-utenti.mjs             creazione account in blocco da CSV
src/App.jsx                         interfaccia
src/push.js                         iscrizione alle notifiche
public/sw.js                        service worker (riceve le notifiche)
```
