import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, configurato } from './supabase'
import * as push from './push'
import Foglio from './Foglio'
import Amministrazione from './Amministrazione'
import { INDAGINI, èIndagine } from './indagini'
import * as T from './tempi'

// ---------------------------------------------------------------- utilità
export const GUARDIA = 'guardia'
export const GRAVITA = [
  { v: 0, nome: 'Nessuna segnalazione', breve: '' },
  { v: 1, nome: 'Da monitorare', breve: 'DA MONITORARE' },
  { v: 2, nome: 'Critico', breve: 'CRITICO' },
]
export const RIANIMAZIONE = [
  { v: null, nome: 'Non indicato' },
  { v: 'si', nome: 'Rianimabile', breve: 'Rianimabile' },
  { v: 'limitata', nome: 'Cure limitate', breve: 'Cure limitate' },
  { v: 'no', nome: 'Non rianimabile (DNR)', breve: 'DNR' },
]
// prossima azione da fare per un esame o una consulenza; a fine percorso si spunta l'attività
export const STATI = [
  { v: 'da_richiedere', nome: 'Da richiedere', icona: '📌' },
  { v: 'da_prenotare', nome: 'Da prenotare', icona: '📅' },
  { v: 'da_eseguire', nome: 'Da eseguire', icona: '🩺' },
  { v: 'da_scaricare', nome: 'Da scaricare', icona: '📥' },
]
const statoDi = (v) => STATI.find((x) => x.v === v)
// riga dei crediti mostrata nel login e nelle Impostazioni
function Crediti() {
  return (
    <p className="crediti">
      © 2026 Ideazione e realizzazione: <b>Paolo Roberto</b>.
      <br />Con la collaborazione di: Domenico M. Mezzapesa.
      <br />Tutti i diritti riservati.
    </p>
  )
}
const haConsegna = (p) => Boolean(p.consegna?.trim() || p.gravita > 0 || p.rianimazione || p.allergie?.trim())
const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* ignora */ } },
}
const uuid = () =>
  crypto.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 3) | 8).toString(16)
  })
const upsert = (xs, r) => {
  const i = xs.findIndex((x) => x.id === r.id)
  if (i < 0) return [...xs, r]
  const c = xs.slice()
  c[i] = { ...c[i], ...r }
  return c
}
const ordLetti = (a, b) =>
  a.ordine - b.ordine || a.nome.localeCompare(b.nome, 'it', { numeric: true })
const ordAtt = (a, b) =>
  a.fatta - b.fatta || b.urgente - a.urgente ||
  (a.scadenza || '9').localeCompare(b.scadenza || '9') || a.creata_il.localeCompare(b.creata_il)

function quando(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const oggi = new Date()
  const ieri = new Date(Date.now() - 864e5)
  const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === oggi.toDateString()) return ora
  if (d.toDateString() === ieri.toDateString()) return `ieri ${ora}`
  return `${d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} ${ora}`
}

// ---------------------------------------------------------------- app
export default function App() {
  const [session, setSession] = useState(undefined)
  const [recupero, setRecupero] = useState(false)

  useEffect(() => {
    if (!configurato) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((ev, s) => {
      setSession(s)
      if (ev === 'PASSWORD_RECOVERY') setRecupero(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (!configurato)
    return (
      <div className="centro">
        <div className="box">
          <h1>Configurazione mancante</h1>
          <p>Crea il file <code>.env</code> partendo da <code>.env.example</code> con i dati del progetto Supabase.</p>
        </div>
      </div>
    )
  if (session === undefined) return <div className="centro">Caricamento…</div>
  if (!session) return <Login />
  if (recupero) return <NuovaPassword onFatto={() => setRecupero(false)} />
  return <Principale session={session} />
}

// ---------------------------------------------------------------- login
function spiegaErroreLogin(e) {
  const m = String(e?.message || e || '')
  const c = e?.code || ''
  if (c === 'invalid_credentials' || /invalid login credentials/i.test(m))
    return 'Email o password non corretti.'
  if (c === 'email_not_confirmed' || /not confirmed/i.test(m))
    return 'Account non ancora confermato: in Supabase ricrea l\'utente spuntando "Auto Confirm User".'
  if (/api key|apikey|jwt|unauthorized|no api key/i.test(m) || e?.status === 401)
    return 'Chiave Supabase non valida nella configurazione dell\'app (VITE_SUPABASE_ANON_KEY).'
  if (/failed to fetch|network|load failed|fetch/i.test(m))
    return 'Impossibile collegarsi al server: controlla la connessione o l\'indirizzo Supabase (VITE_SUPABASE_URL).'
  return `Accesso non riuscito: ${m || 'errore sconosciuto'}`
}

function RichiestaAccesso({ indietro }) {
  const [v, setV] = useState({ nome: '', email: '', messaggio: '' })
  const [msg, setMsg] = useState('')
  const [inviata, setInviata] = useState(false)
  const [occupato, setOccupato] = useState(false)
  async function invia(e) {
    e.preventDefault()
    setOccupato(true)
    setMsg('')
    const { error } = await supabase.from('richieste_accesso').insert({
      nome: v.nome.trim(), email: v.email.trim().toLowerCase(), messaggio: v.messaggio.trim(),
    })
    setOccupato(false)
    if (!error) return setInviata(true)
    if (/duplicate|unique/i.test(error.message)) setMsg('C\'è già una richiesta in attesa per questa email.')
    else if (/check constraint/i.test(error.message)) setMsg('Controlla nome ed email.')
    else setMsg(`Invio non riuscito: ${error.message}`)
  }
  if (inviata) {
    return (
      <div className="centro">
        <div className="box">
          <h1>Richiesta inviata ✓</h1>
          <p>Un amministratore la controllerà e ti invierà le credenziali per entrare.</p>
          <button className="btn" onClick={indietro}>Torna al login</button>
        </div>
      </div>
    )
  }
  return (
    <div className="centro">
      <form className="box" onSubmit={invia}>
        <h1>Richiedi accesso</h1>
        <label>Nome e cognome
          <input value={v.nome} onChange={(e) => setV({ ...v, nome: e.target.value })} required minLength={2} maxLength={100} />
        </label>
        <label>Email
          <input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} required />
        </label>
        <label>Ruolo / reparto <span className="grigio">(facoltativo)</span>
          <input value={v.messaggio} onChange={(e) => setV({ ...v, messaggio: e.target.value })} maxLength={500}
            placeholder="es. Specializzando 2° anno" />
        </label>
        {msg && <p className="avviso">{msg}</p>}
        <button className="btn primario" disabled={occupato}>{occupato ? 'Invio…' : 'Invia richiesta'}</button>
        <button type="button" className="btn link" onClick={indietro}>‹ Torna al login</button>
      </form>
    </div>
  )
}

function Login() {
  const [richiedi, setRichiedi] = useState(false)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [occupato, setOccupato] = useState(false)

  async function entra(e) {
    e.preventDefault()
    setOccupato(true)
    setMsg('')
    let error
    try {
      ;({ error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw }))
    } catch (e) {
      error = e
    }
    setOccupato(false)
    if (error) setMsg(spiegaErroreLogin(error))
  }
  async function recupera() {
    if (!email.trim()) return setMsg('Scrivi prima la tua email.')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: new URL(import.meta.env.BASE_URL, location.origin).href,
    })
    setMsg(error ? error.message : 'Ti abbiamo inviato un\'email per reimpostare la password.')
  }

  if (richiedi) return <RichiestaAccesso indietro={() => setRichiedi(false)} />
  return (
    <div className="centro">
      <form className="box" onSubmit={entra}>
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" className="logo" />
        <h1>Neuro Reparto</h1>
        <label>Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>Password
          <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </label>
        {msg && <p className="avviso">{msg}</p>}
        <button className="btn primario" disabled={occupato}>{occupato ? 'Accesso…' : 'Entra'}</button>
        <button type="button" className="btn link" onClick={recupera}>Password dimenticata?</button>
        <button type="button" className="btn" onClick={() => setRichiedi(true)}>Non hai un account? Richiedi accesso</button>
        <Crediti />
      </form>
    </div>
  )
}

function NuovaPassword({ onFatto }) {
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  async function salva(e) {
    e.preventDefault()
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) setMsg(error.message)
    else onFatto()
  }
  return (
    <div className="centro">
      <form className="box" onSubmit={salva}>
        <h1>Nuova password</h1>
        <label>Password (min. 8 caratteri)
          <input type="password" minLength={8} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </label>
        {msg && <p className="avviso">{msg}</p>}
        <button className="btn primario">Salva</button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------- schermata principale
function Principale({ session }) {
  const uid = session.user.id
  const [reparti, setReparti] = useState([])
  const [repartiCaricati, setRepartiCaricati] = useState(false)
  const [repId, setRepId] = useState(
    () => new URLSearchParams(location.search).get('reparto') || store.get('reparto'),
  )
  const [profili, setProfili] = useState({})
  const [letti, setLetti] = useState([])
  const [pazienti, setPazienti] = useState([])
  const [attivita, setAttivita] = useState([])
  const [mostraFatte, setMostraFatte] = useState(false)
  const [soloConAttivita, setSoloConAttivita] = useState(() => store.get('soloConAttivita') === '1')
  const [live, setLive] = useState(false)
  const [caricato, setCaricato] = useState(false)
  const [modale, setModale] = useState(null)
  const [toast, setToast] = useState(null)
  const [pacchetti, setPacchetti] = useState([])
  const [medici, setMedici] = useState([])          // profili completi (attivi e no)
  const [io, setIo] = useState(null)                // il mio profilo
  const [richiesteAttesa, setRichiesteAttesa] = useState(0)
  const [soloMie, setSoloMie] = useState(false)
  const [filtroStato, setFiltroStato] = useState(null)   // una delle azioni di STATI, oppure null
  const [evidenzia, setEvidenzia] = useState(null)  // paziente trovato con la ricerca
  // attività con le sotto-attività aperte (ricordate su questo dispositivo)
  const [sottoAperte, setSottoAperte] = useState(() => {
    try { return new Set(JSON.parse(store.get('sottoAperte') || '[]')) } catch { return new Set() }
  })
  useEffect(() => { store.set('sottoAperte', JSON.stringify([...sottoAperte].slice(-300))) }, [sottoAperte])
  // schede dei pazienti aperte (chiuse di default: si apre cliccando sul nome del paziente)
  const [schedeAperte, setSchedeAperte] = useState(() => new Set())
  const [, setTick] = useState(0)                   // aggiorna scadenze ogni minuto
  const toastTimer = useRef()
  const richiesta = useRef(0)
  const profiliRef = useRef(profili)
  profiliRef.current = profili

  const mostraToast = useCallback((testo, annulla, tipo) => {
    clearTimeout(toastTimer.current)
    setToast({ testo, annulla, tipo })
    toastTimer.current = setTimeout(() => setToast(null), annulla ? 6000 : 3500)
  }, [])
  const errore = useCallback((e) => {
    console.error(e)
    mostraToast(`Errore: ${e?.message || e}`, null, 'errore')
  }, [mostraToast])

  // --- dati comuni
  const caricaProfili = useCallback(async () => {
    const { data } = await supabase.from('profili').select('*').order('nome')
    if (!data) return
    setProfili(Object.fromEntries(data.map((p) => [p.id, p.nome])))
    setMedici(data)
    setIo(data.find((p) => p.id === uid) ?? { id: uid, attivo: false })
  }, [uid])

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60e3)
    return () => clearInterval(t)
  }, [])

  // amministratori: richieste di accesso in attesa (e apertura da notifica)
  const admin = io?.ruolo === 'admin'
  useEffect(() => {
    if (!admin) return
    supabase.from('richieste_accesso').select('id', { count: 'exact', head: true }).eq('stato', 'in_attesa')
      .then(({ count }) => setRichiesteAttesa(count || 0))
    const u = new URL(location.href)
    if (u.searchParams.get('admin')) {
      setModale({ tipo: 'admin', iniziale: u.searchParams.get('admin') })
      u.searchParams.delete('admin')
      history.replaceState(null, '', u)
    }
  }, [admin])

  // reparti: letti dal database (nomi e numero di letti non sono scritti nel codice)
  const caricaReparti = useCallback(async () => {
    const { data, error } = await supabase.from('reparti').select('*').order('ordine')
    if (error) return errore(error)
    setReparti(data)
    setRepId((cur) => (cur === GUARDIA || data.some((r) => r.id === cur) ? cur : data[0]?.id))
    setRepartiCaricati(true)
  }, [errore])
  useEffect(() => { caricaReparti(); caricaProfili() }, [caricaReparti, caricaProfili])

  // un amministratore crea o modifica un reparto: tutti i telefoni si aggiornano
  useEffect(() => {
    const ch = supabase.channel('reparti')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reparti' }, () => caricaReparti())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [caricaReparti])

  const caricaPacchetti = useCallback(async () => {
    const { data } = await supabase.from('pacchetti').select('*').order('ordine')
    if (data) setPacchetti(data)
  }, [])
  useEffect(() => { caricaPacchetti() }, [caricaPacchetti])

  useEffect(() => {
    if (!repId) return
    store.set('reparto', repId)
    const u = new URL(location.href)
    if (u.searchParams.has('reparto')) {
      u.searchParams.delete('reparto')
      history.replaceState(null, '', u)
    }
  }, [repId])

  // apertura da notifica mentre l'app è già aperta
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const h = (e) => {
      if (e.data?.tipo === 'apri') {
        const q = new URL(e.data.url).searchParams
        if (q.get('reparto')) setRepId(q.get('reparto'))
        if (q.get('admin')) setModale({ tipo: 'admin', iniziale: q.get('admin') })
      }
    }
    navigator.serviceWorker.addEventListener('message', h)
    return () => navigator.serviceWorker.removeEventListener('message', h)
  }, [])

  // --- caricamento reparto
  const carica = useCallback(async () => {
    if (!repId) return
    const n = ++richiesta.current
    const da = new Date(Date.now() - 3 * 864e5).toISOString()
    const g = repId === GUARDIA // vista guardia: tutti i reparti, solo valutazioni di guardia
    let qa = supabase.from('attivita').select('*')
    qa = g ? qa.eq('guardia', true) : qa.eq('reparto_id', repId)
    qa = mostraFatte ? qa.or(`fatta.eq.false,fatta_il.gte."${da}"`) : qa.eq('fatta', false)
    let ql = supabase.from('letti').select('*')
    let qp = supabase.from('pazienti').select('*').eq('dimesso', false)
    if (!g) { ql = ql.eq('reparto_id', repId); qp = qp.eq('reparto_id', repId) }
    const [l, p, a] = await Promise.all([ql, qp, qa])
    if (n !== richiesta.current) return // risposta vecchia: ignoro
    const err = l.error || p.error || a.error
    if (err) return errore(err)
    setLetti(l.data)
    setPazienti(p.data)
    setAttivita(a.data)
    setCaricato(true)
    if (a.data.some((x) => x.creata_da && !(x.creata_da in profiliRef.current))) caricaProfili()
  }, [repId, mostraFatte, errore, caricaProfili])
  const caricaRef = useRef(carica)
  caricaRef.current = carica

  useEffect(() => { carica() }, [carica])

  // --- tempo reale
  useEffect(() => {
    if (!repId) return
    const filtro = repId === GUARDIA ? undefined : `reparto_id=eq.${repId}`
    const ch = supabase.channel(`reparto-${repId}`)
    const tabelle = [['letti', setLetti], ['pazienti', setPazienti], ['attivita', setAttivita]]
    for (const [table, set] of tabelle) {
      const suCambio = (p) => {
        set((xs) => upsert(xs, p.new))
        if (table === 'attivita' && p.new.creata_da && !(p.new.creata_da in profiliRef.current)) caricaProfili()
      }
      const f = filtro ? { filter: filtro } : {}
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table, ...f }, suCambio)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, ...f }, suCambio)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table }, (p) =>
          set((xs) => xs.filter((x) => x.id !== p.old.id)))
    }
    let prima = true
    ch.subscribe((stato) => {
      if (stato === 'SUBSCRIBED') {
        setLive(true)
        if (!prima) caricaRef.current() // riconnessione: ricarico per non perdere modifiche
        prima = false
      } else setLive(false)
    })
    return () => { supabase.removeChannel(ch) }
  }, [repId, caricaProfili])

  // ricarico quando il telefono torna in primo piano dopo un po'
  useEffect(() => {
    let nascosto = 0
    const vis = () => {
      if (document.hidden) nascosto = Date.now()
      else if (nascosto && Date.now() - nascosto > 20000) caricaRef.current()
    }
    const on = () => caricaRef.current()
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('online', on)
    return () => {
      document.removeEventListener('visibilitychange', vis)
      window.removeEventListener('online', on)
    }
  }, [])

  // --- azioni
  const esegui = useCallback(async (q) => {
    const { error } = await q
    if (error) { errore(error); caricaRef.current() }
    return !error
  }, [errore])

  const az = useMemo(() => ({
    aggiungiAttivita(paz, testo, urgente = false, parentId = null, extra = {}) {
      const row = {
        id: uuid(), paziente_id: paz.id, reparto_id: paz.reparto_id, parent_id: parentId,
        testo, urgente, fatta: false, creata_da: uid, creata_il: new Date().toISOString(),
        fatta_da: null, fatta_il: null, guardia: Boolean(extra.guardia), ora: null,
        scadenza: extra.scadenza || null, ripeti_ore: extra.ripeti_ore || null,
        ripeti_orari: extra.ripeti_orari || null, assegnata_a: extra.assegnata_a || null,
      }
      // le indagini dell'elenco partono da "Da richiedere"; le altre attività (es. "Rivalutare PA") restano senza stato
      if (extra.esame && !parentId && !extra.guardia) Object.assign(row, { stato: 'da_richiedere', stato_il: row.creata_il, stato_da: uid })
      setAttivita((xs) => upsert(xs, row))
      esegui(supabase.from('attivita').insert(row))
    },
    aggiungiPacchetto(paz, voci) {
      const t0 = Date.now()
      let k = 0
      const base = () => ({
        paziente_id: paz.id, reparto_id: paz.reparto_id, urgente: false, fatta: false,
        creata_da: uid, creata_il: new Date(t0 + k++).toISOString(), // mantiene l'ordine del pacchetto
        fatta_da: null, fatta_il: null, guardia: false, ora: null, assegnata_a: null,
        scadenza: null, ripeti_ore: null, ripeti_orari: null,
      })
      const rows = []
      for (const v of voci) {
        const tempi = {
          ripeti_ore: v.ripeti_ore || null, ripeti_orari: v.ripeti_orari || null,
          scadenza: T.primaScadenza(v)?.toISOString() ?? null,
        }
        const padre = { ...base(), ...tempi, id: uuid(), parent_id: null, testo: v.t }
        rows.push(padre)
        for (const f of v.f || []) rows.push({ ...base(), id: uuid(), parent_id: padre.id, testo: f })
      }
      if (!rows.length) return
      setAttivita((xs) => rows.reduce(upsert, xs))
      esegui(supabase.from('attivita').insert(rows))
      mostraToast(`Aggiunte ${rows.length} attività`)
    },
    impostaFatta(ids, val) {
      const patch = val
        ? { fatta: true, fatta_da: uid, fatta_il: new Date().toISOString() }
        : { fatta: false, fatta_da: null, fatta_il: null }
      setAttivita((xs) => xs.map((x) => (ids.includes(x.id) ? { ...x, ...patch } : x)))
      return esegui(supabase.from('attivita').update(patch).in('id', ids))
    },
    spunta(a, tutte) {
      const val = !a.fatta
      const figliTutti = tutte.filter((x) => x.parent_id === a.id)
      const figli = val ? figliTutti.filter((x) => !x.fatta).map((x) => x.id) : []
      const ids = [a.id, ...figli]
      az.impostaFatta(ids, val)
      if (!val) return
      // attività ripetuta: creo subito la prossima (con le sue sotto-attività)
      const quando = T.ripetuta(a) ? T.prossimaScadenza(a) : null
      if (!quando) return mostraToast(`✓ ${a.testo}`, () => az.impostaFatta(ids, false))
      const ora = new Date().toISOString()
      const copia = (x, extra) => ({
        ...x, id: uuid(), fatta: false, fatta_da: null, fatta_il: null, creata_da: uid, creata_il: ora, ...extra,
        ...(x.stato ? { stato: 'da_richiedere', stato_il: ora, stato_da: uid } : {}),
      })
      const nuova = copia(a, { scadenza: quando.toISOString() })
      const nuoviFigli = figliTutti.map((f) => copia(f, { parent_id: nuova.id, scadenza: null }))
      const righe = [nuova, ...nuoviFigli]
      setAttivita((xs) => righe.reduce(upsert, xs))
      esegui(supabase.from('attivita').insert(righe))
      const etichetta = T.etichettaScadenza(nuova)?.testo
      mostraToast(`✓ ${a.testo} · prossima ${etichetta}`, () => {
        const via = righe.map((r) => r.id)
        setAttivita((xs) => xs.filter((x) => !via.includes(x.id)))
        esegui(supabase.from('attivita').delete().in('id', via))
        az.impostaFatta(ids, false)
      })
    },
    modificaAttivita(a, patch) {
      setAttivita((xs) => upsert(xs, { ...a, ...patch }))
      esegui(supabase.from('attivita').update(patch).eq('id', a.id))
    },
    eliminaAttivita(a) {
      setAttivita((xs) => xs.filter((x) => x.id !== a.id && x.parent_id !== a.id))
      esegui(supabase.from('attivita').delete().eq('id', a.id))
    },
    async ricovera(letto, nome, note, dataRicovero) {
      const row = {
        id: uuid(), letto_id: letto.id, reparto_id: letto.reparto_id, nome, note,
        dimesso: false, creato_il: new Date().toISOString(), data_ricovero: dataRicovero || T.oggiLocale(),
      }
      setPazienti((xs) => upsert(xs, row))
      setSchedeAperte(new Set([row.id]))
      return (await esegui(supabase.from('pazienti').insert(row))) ? row : null
    },
    modificaPaziente(p, patch) {
      const locale = ['consegna', 'gravita', 'rianimazione', 'allergie'].some((k) => k in patch)
        ? { consegna_il: new Date().toISOString(), consegna_da: uid } : {}
      setPazienti((xs) => upsert(xs, { ...p, ...patch, ...locale }))
      return esegui(supabase.from('pazienti').update(patch).eq('id', p.id))
    },
    dimetti(p) {
      az.modificaPaziente(p, { dimesso: true })
      mostraToast(`${p.nome} dimesso`, () => az.modificaPaziente(p, { dimesso: false }))
    },
    async trasferisci(p, lettoId) {
      const ok = await esegui(supabase.rpc('trasferisci_paziente', { p_paziente: p.id, p_letto: lettoId }))
      if (ok) { caricaRef.current(); mostraToast(`${p.nome} trasferito`) }
      return ok
    },
    async aggiungiLetto(nome) {
      const ordine = Math.max(0, ...letti.map((l) => l.ordine)) + 1
      const row = { id: uuid(), reparto_id: repId, nome, ordine }
      setLetti((xs) => upsert(xs, row))
      return esegui(supabase.from('letti').insert(row))
    },
    rinominaLetto(l, nome) {
      setLetti((xs) => upsert(xs, { ...l, nome }))
      return esegui(supabase.from('letti').update({ nome }).eq('id', l.id))
    },
    eliminaLetto(l) {
      setLetti((xs) => xs.filter((x) => x.id !== l.id))
      return esegui(supabase.from('letti').delete().eq('id', l.id))
    },
    impostaStato(a, v) {
      const ora = new Date().toISOString()
      const patch = { stato: v, stato_il: ora, stato_da: uid }
      if (v && a.fatta) Object.assign(patch, { fatta: false, fatta_da: null, fatta_il: null })
      setAttivita((xs) => upsert(xs, { ...a, ...patch }))
      esegui(supabase.from('attivita').update(patch).eq('id', a.id))
    },
    io: uid,
    schedaAperta: (pid) => schedeAperte.has(pid),
    // una sola scheda aperta alla volta: aprendone una si chiudono le altre
    alternaScheda(pid, val) {
      setSchedeAperte((xs) => (val ?? !xs.has(pid) ? new Set([pid]) : new Set([...xs].filter((x) => x !== pid))))
    },
    aperta: (id) => sottoAperte.has(id),
    alterna(id, val) {
      setSottoAperte((xs) => {
        const n = new Set(xs)
        if (val ?? !n.has(id)) n.add(id); else n.delete(id)
        return n
      })
    },
  }), [uid, esegui, mostraToast, letti, repId, sottoAperte, schedeAperte])

  // --- dati derivati
  // solo le attività dei pazienti ancora ricoverati (quelle dei dimessi restano come storico)
  const ricoverati = useMemo(
    () => new Set(pazienti.filter((p) => !p.dimesso && p.reparto_id === repId).map((p) => p.id)),
    [pazienti, repId],
  )
  const visibili = useMemo(() => {
    let xs = attivita.filter((a) => a.reparto_id === repId && ricoverati.has(a.paziente_id) && (mostraFatte || !a.fatta))
    if (filtroStato) xs = xs.filter((a) => !a.fatta && a.stato === filtroStato)
    if (!soloMie) return xs
    const mie = new Set(xs.filter((a) => a.assegnata_a === uid).map((a) => a.id))
    return xs.filter((a) => mie.has(a.id) || mie.has(a.parent_id))
  }, [attivita, repId, mostraFatte, soloMie, filtroStato, uid, ricoverati])
  const attPerPaz = useMemo(() => {
    const m = {}
    for (const a of visibili) (m[a.paziente_id] ??= []).push(a)
    return m
  }, [visibili])
  const pazPerLetto = useMemo(() => {
    const m = {}
    for (const p of pazienti) if (!p.dimesso && p.reparto_id === repId) m[p.letto_id] = p
    return m
  }, [pazienti, repId])
  const lettiRep = useMemo(
    () => letti.filter((l) => l.reparto_id === repId).sort(ordLetti),
    [letti, repId],
  )
  const aperte = visibili.filter((a) => !a.fatta).length
  const urgenti = visibili.filter((a) => !a.fatta && a.urgente).length
  const adesso = new Date()
  const scadute = visibili.filter((a) => T.etichettaScadenza(a, adesso)?.stato === 'scaduta').length
  const perStato = Object.fromEntries(STATI.map((x) => [x.v, attivita.filter(
    (a) => a.reparto_id === repId && ricoverati.has(a.paziente_id) && !a.fatta && a.stato === x.v).length]))
  const occupati = lettiRep.filter((l) => pazPerLetto[l.id]).length
  const repCorrente = reparti.find((r) => r.id === repId)

  const lettiMostrati = soloConAttivita || soloMie || filtroStato
    ? lettiRep.filter((l) => {
        const p = pazPerLetto[l.id]
        return p && (attPerPaz[p.id] || []).some((a) => !a.fatta)
      })
    : lettiRep

  if (io && (!io.attivo || (io.scadenza && io.scadenza < T.oggiLocale()))) {
    return (
      <div className="centro">
        <div className="box">
          <h1>Accesso non attivo</h1>
          <p>{!io.attivo ? 'Il tuo account è stato disattivato' : 'Il tuo accesso è scaduto'}.
            Chiedi a un amministratore dell'app di riattivarlo.</p>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Esci</button>
        </div>
      </div>
    )
  }

  if (repartiCaricati && reparti.length === 0 && modale?.tipo !== 'admin') {
    return (
      <div className="centro">
        <div className="box">
          <h1>Nessun reparto</h1>
          {admin ? (
            <>
              <p>Per cominciare crea i reparti del tuo ospedale, con i loro letti. Potrai sempre aggiungerne, rinominarli o eliminarli in seguito.</p>
              <button className="btn primario" onClick={() => setModale({ tipo: 'admin', iniziale: 'reparti' })}>Crea il primo reparto</button>
            </>
          ) : (
            <p>I reparti non sono ancora stati configurati. Chiedi a un amministratore dell'app di crearli da ⚙︎ Impostazioni → Amministrazione → Reparti.</p>
          )}
          <button className="btn" onClick={() => supabase.auth.signOut()}>Esci</button>
        </div>
        {toast && <div className={`toast ${toast.tipo || ''}`} role="status"><span>{toast.testo}</span></div>}
      </div>
    )
  }

  return (
    <div className="app">
      <header className="testata">
        <div className="riga-titolo">
          <h1>{repId === GUARDIA ? '🌙 Guardia' : repCorrente?.nome ?? 'Neuro Reparto'}</h1>
          <span className={`stato ${live ? 'on' : ''}`} title={live ? 'Collegato in tempo reale' : 'Connessione…'}>
            {live ? 'live' : '…'}
          </span>
          <button className="icona" aria-label="Cerca paziente" onClick={() => setModale({ tipo: 'cerca' })}>🔍</button>
          <button className="icona impost" aria-label="Impostazioni" onClick={() => setModale({ tipo: 'impostazioni' })}>
            ⚙︎{admin && richiesteAttesa > 0 && <span className="pallino">{richiesteAttesa}</span>}
          </button>
        </div>
        <nav className="reparti">
          <button className={`chip guardia ${repId === GUARDIA ? 'attivo' : ''}`} onClick={() => setRepId(GUARDIA)}>
            🌙 Guardia
          </button>
          {reparti.map((r) => (
            <button key={r.id} className={`chip ${r.id === repId ? 'attivo' : ''}`} onClick={() => setRepId(r.id)}>
              {r.nome}
            </button>
          ))}
        </nav>
        {repId !== GUARDIA && <div className="riepilogo">
          <span><b>{aperte}</b> da fare</span>
          {urgenti > 0 && <span className="rosso"><b>{urgenti}</b> {urgenti === 1 ? 'urgente' : 'urgenti'}</span>}
          {scadute > 0 && <span className="rosso"><b>{scadute}</b> {scadute === 1 ? 'scaduta' : 'scadute'}</span>}
          {STATI.filter((x) => perStato[x.v] > 0 || filtroStato === x.v).map((x) => (
            <button key={x.v} className={`mini filtro-stato s-${x.v} ${filtroStato === x.v ? 'attivo' : ''}`}
              onClick={() => setFiltroStato((v) => (v === x.v ? null : x.v))}>
              {x.icona} {perStato[x.v]} {x.nome.toLowerCase()}
            </button>
          ))}
          <span>{occupati}/{lettiRep.length} letti</span>
          <span className="spazio" />
          <button className={`mini ${soloMie ? 'attivo' : ''}`} onClick={() => setSoloMie((v) => !v)}>Mie</button>
          <button className={`mini ${soloConAttivita ? 'attivo' : ''}`} onClick={() => {
            setSoloConAttivita((v) => { store.set('soloConAttivita', v ? '0' : '1'); return !v })
          }}>Con attività</button>
          <button className={`mini ${mostraFatte ? 'attivo' : ''}`} onClick={() => setMostraFatte((v) => !v)}>Fatte</button>
        </div>}
      </header>

      {repId === GUARDIA ? (
        <Guardia
          reparti={reparti} letti={letti} pazienti={pazienti} attivita={attivita} profili={profili}
          az={az} apri={setModale} caricato={caricato}
          mostraFatte={mostraFatte} setMostraFatte={setMostraFatte}
        />
      ) : (
      <main className="lista">
        {!caricato && <p className="vuoto">Caricamento…</p>}
        {caricato && lettiMostrati.length === 0 && (
          <p className="vuoto">{filtroStato ? `Nessuna attività "${statoDi(filtroStato).nome.toLowerCase()}" 🎉` : soloMie ? 'Nessuna attività assegnata a te 🎉' : soloConAttivita ? 'Nessuna attività da fare 🎉' : 'Nessun letto.'}</p>
        )}
        {lettiMostrati.map((l) => (
          <Letto
            key={l.id}
            letto={l}
            paziente={pazPerLetto[l.id]}
            attivita={pazPerLetto[l.id] ? attPerPaz[pazPerLetto[l.id].id] || [] : []}
            profili={profili}
            az={az}
            apri={setModale}
            evidenziato={evidenzia && pazPerLetto[l.id]?.id === evidenzia}
            forzaAperta={soloMie || Boolean(filtroStato)}
          />
        ))}
        {caricato && !soloConAttivita && !soloMie && !filtroStato && (
          <button className="btn tratteggio" onClick={() => setModale({ tipo: 'nuovoLetto' })}>+ Aggiungi letto</button>
        )}
      </main>
      )}

      {modale && (
        <Modale
          m={modale}
          chiudi={() => setModale(null)}
          az={az}
          reparti={reparti}
          caricaReparti={caricaReparti}
          repId={repId}
          lettiRep={lettiRep}
          pazPerLetto={pazPerLetto}
          profili={profili}
          setProfili={setProfili}
          session={session}
          mostraToast={mostraToast}
          apri={setModale}
          pacchetti={pacchetti}
          caricaPacchetti={caricaPacchetti}
          attivita={attivita}
          medici={medici}
          io={io}
          richiesteAttesa={richiesteAttesa}
          setRichiesteAttesa={setRichiesteAttesa}
          vaiA={(p) => { setRepId(p.reparto_id); setSchedeAperte(new Set([p.id])); setEvidenzia(p.id); setTimeout(() => setEvidenzia(null), 4000) }}
        />
      )}

      {toast && (
        <div className={`toast ${toast.tipo || ''}`} role="status">
          <span>{toast.testo}</span>
          {toast.annulla && (
            <button onClick={() => { toast.annulla(); setToast(null) }}>Annulla</button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- scheda letto
function Letto({ letto, paziente, attivita, profili, az, apri, evidenziato, forzaAperta }) {
  const [testo, setTesto] = useState('')
  const [menuIndagini, setMenuIndagini] = useState(false)
  const [urgente, setUrgente] = useState(false)
  const [perGuardia, setPerGuardia] = useState(false)
  const rif = useRef()
  useEffect(() => {
    if (evidenziato) rif.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [evidenziato])

  if (!paziente) {
    return (
      <section className="letto libero">
        <div className="intest">
          <span className="num">{letto.nome}</span>
          <span className="nome grigio">Libero</span>
          <button className="mini" onClick={() => apri({ tipo: 'ricovero', letto })}>+ Paziente</button>
          <button className="icona" aria-label="Opzioni letto" onClick={() => apri({ tipo: 'letto', letto })}>⋯</button>
        </div>
      </section>
    )
  }

  const ids = new Set(attivita.map((a) => a.id))
  const radici = attivita.filter((a) => !a.parent_id || !ids.has(a.parent_id)).sort(ordAtt)
  const figliDi = (id) => attivita.filter((a) => a.parent_id === id).sort(ordAtt)
  const aperte = attivita.filter((a) => !a.fatta).length
  const haUrgenti = attivita.some((a) => !a.fatta && a.urgente)

  function aggiungi(e) {
    e.preventDefault()
    const t = testo.trim()
    if (!t) return
    az.aggiungiAttivita(paziente, t, urgente, null, { guardia: perGuardia, esame: !perGuardia && èIndagine(t) })
    setTesto('')
    setUrgente(false)
    setPerGuardia(false)
    setMenuIndagini(false)
  }

  const aperta = forzaAperta || az.schedaAperta(paziente.id)
  // aprendo la scheda si aprono anche le sotto-attività (poi si chiudono una a una con la freccia)
  function alternaScheda() {
    if (!aperta) radici.filter((r) => figliDi(r.id).length > 0).forEach((r) => az.alterna(r.id, true))
    az.alternaScheda(paziente.id)
  }

  return (
    <section ref={rif} className={`letto ${haUrgenti ? 'urgente' : ''} ${evidenziato ? 'evidenziato' : ''} ${aperta ? 'aperta' : 'chiusa'}`}>
      <div className="intest" role="button" aria-expanded={aperta} onClick={alternaScheda}>
        <button type="button" className="num num-btn" aria-label="Modifica paziente, trasferisci o dimetti"
          onClick={(e) => { e.stopPropagation(); apri({ tipo: 'paziente', paziente, letto }) }}>{letto.nome}</button>
        <span className="nome">{paziente.nome}</span>
        {aperta && paziente.data_ricovero && <span className="giorno" title="Giornata di ricovero">G{T.giornoRicovero(paziente.data_ricovero)}</span>}
        {aperte > 0 && <span className="badge">{aperte}</span>}
        <span className="freccia-scheda" aria-hidden="true">{aperta ? '▾' : '▸'}</span>
        {aperta && (
          <>
            <button className="icona" aria-label="Aggiungi pacchetto di attività"
              onClick={(e) => { e.stopPropagation(); apri({ tipo: 'pacchetto', paziente, letto }) }}>📋</button>
            <button className="icona" aria-label="Consegna per la guardia"
              onClick={(e) => { e.stopPropagation(); apri({ tipo: 'consegna', paziente, letto }) }}>🌙</button>
          </>
        )}
      </div>
      {aperta && (
        <>
        {haConsegna(paziente) && (
          <BoxConsegna paziente={paziente} compatto onClick={() => apri({ tipo: 'consegna', paziente, letto })} />
        )}
        {paziente.note && (
          <p className="note" onClick={() => apri({ tipo: 'paziente', paziente, letto })}>{paziente.note}</p>
        )}
        <ul className="attivita">
          {radici.map((a) => (
            <Attivita key={a.id} a={a} figli={figliDi(a.id)} tutte={attivita} profili={profili} az={az} apri={apri} paziente={paziente} />
          ))}
        </ul>
        {menuIndagini && !perGuardia && (
          <MenuIndagini filtro={testo} scegli={(v) => { setTesto(v); setMenuIndagini(false) }} />
        )}
        {/* i pulsanti del modulo non tolgono il focus al campo: altrimenti il menu si chiude, il modulo si sposta e il tocco su "+" va perso */}
        <form className="aggiungi" onSubmit={aggiungi} onPointerDown={(e) => { if (e.target.closest('button')) e.preventDefault() }}>
          <input
            value={testo}
            onChange={(e) => { setTesto(e.target.value); setMenuIndagini(true) }}
            onFocus={() => setMenuIndagini(true)}
            onBlur={() => setTimeout(() => setMenuIndagini(false), 200)}
            placeholder={perGuardia ? 'Valutazione per la guardia…' : 'Nuova attività…'}
            enterKeyHint="done"
          />
          <button type="button" className={`luna ${perGuardia ? 'attivo' : ''}`} onClick={() => setPerGuardia((v) => !v)} aria-label="Per la guardia">🌙</button>
          <button type="button" className={`urg ${urgente ? 'attivo' : ''}`} onClick={() => setUrgente((v) => !v)} aria-label="Urgente">!</button>
          <button className="piu" aria-label="Aggiungi" disabled={!testo.trim()}>+</button>
        </form>
        </>
      )}
    </section>
  )
}

// menu a discesa con le indagini possibili: si apre toccando "Nuova attività" e si restringe mentre si scrive
function MenuIndagini({ filtro, scegli }) {
  const q = filtro.trim().toLowerCase()
  const gruppi = INDAGINI
    .map((g) => ({ ...g, voci: g.voci.filter((v) => !q || v.toLowerCase().includes(q) || g.gruppo.toLowerCase().includes(q)) }))
    .filter((g) => g.voci.length > 0)
  if (gruppi.length === 0) return null
  return (
    // onPointerDown/preventDefault: il campo di testo non perde il focus quando si tocca una voce
    <div className="menu-indagini" onPointerDown={(e) => e.preventDefault()} role="listbox" aria-label="Indagini possibili">
      {gruppi.map((g) => (
        <div key={g.gruppo}>
          <div className="gruppo-ind">{g.gruppo}</div>
          {g.voci.map((v) => (
            <button key={v} type="button" role="option" className="voce-ind" onClick={() => scegli(v)}>{v}</button>
          ))}
        </div>
      ))}
    </div>
  )
}

function Attivita({ a, figli, tutte, profili, az, apri, paziente, sotto, nascondiLuna }) {
  const meta = a.fatta
    ? `fatta da ${profili[a.fatta_da] ?? '—'} · ${quando(a.fatta_il)}`
    : `${profili[a.creata_da] ?? ''} · ${quando(a.creata_il)}`
  const sc = T.etichettaScadenza(a)
  const rip = T.testoRipeti(a)
  const mia = a.assegnata_a && a.assegnata_a === az.io
  const padreNascosto = a.parent_id && !sotto
  const padre = padreNascosto ? tutte.find((x) => x.id === a.parent_id) : null
  const aperta = figli.length > 0 && az.aperta(a.id)
  const daFare = figli.filter((f) => !f.fatta)
  // se è chiusa ma dentro c'è qualcosa di urgente o scaduto, il pulsante diventa rosso
  const allarme = !aperta && daFare.some((f) => f.urgente || T.etichettaScadenza(f)?.stato === 'scaduta')
  return (
    <li className={`att ${a.fatta ? 'fatta' : ''} ${a.urgente ? 'urg' : ''} ${sotto ? 'sotto' : ''} ${mia ? 'mia' : ''}`}>
      <div className="riga">
        <button
          className="check"
          role="checkbox"
          aria-checked={a.fatta}
          aria-label={a.fatta ? 'Segna come da fare' : 'Segna come fatta'}
          onClick={() => az.spunta(a, tutte)}
        >{a.fatta ? '✓' : ''}</button>
        <div className="testo" onClick={() => apri({ tipo: 'attivita', a, paziente })}>
          <span>
            {a.guardia && !nascondiLuna && <span className="tag-g" title="Valutazione per la guardia">🌙</span>}
            {sc && <span className={`tag-ora ${sc.stato}`}>{sc.stato === 'scaduta' ? '⚠ ' : ''}{sc.testo}</span>}
            {rip && <span className="tag-rip" title="Si ripete">🔁 {rip}</span>}
            {statoDi(a.stato) && (
              <button className={`pill-stato s-${a.stato}`} onClick={(e) => { e.stopPropagation(); apri({ tipo: 'stato', a, paziente }) }}>
                {statoDi(a.stato).icona} {statoDi(a.stato).nome}
              </button>
            )}
            {padre ? <span className="grigio">{padre.testo} › </span> : null}{a.testo}
          </span>
          <small>
            {a.assegnata_a && <b className="assegnata">→ {mia ? 'te' : profili[a.assegnata_a] ?? '—'} · </b>}
            {meta}
          </small>
        </div>
        {figli.length > 0 && (
          <button className={`apri-figli ${aperta ? 'aperta' : ''} ${allarme ? 'allarme' : ''}`}
            aria-expanded={aperta} aria-label={aperta ? 'Chiudi sotto-attività' : 'Apri sotto-attività'}
            onClick={() => az.alterna(a.id)}>
            <span className="freccina">▸</span>{daFare.length || '✓'}
          </button>
        )}
        {!sotto && (
          <button className="icona sub" aria-label="Aggiungi sotto-attività"
            onClick={() => apri({ tipo: 'sotto', a, paziente })}>↳+</button>
        )}
      </div>
      {aperta && (
        <ul className="figli">
          {figli.map((f) => (
            <Attivita key={f.id} a={f} figli={[]} tutte={tutte} profili={profili} az={az} apri={apri} paziente={paziente} sotto nascondiLuna={nascondiLuna} />
          ))}
        </ul>
      )}
    </li>
  )
}

// ---------------------------------------------------------------- finestre
function Modale(props) {
  const { m, chiudi } = props
  switch (m.tipo) {
    case 'ricovero': return <FormPaziente {...props} letto={m.letto} />
    case 'paziente': return <FormPaziente {...props} letto={m.letto} paziente={m.paziente} />
    case 'letto': return <FormLetto {...props} letto={m.letto} />
    case 'nuovoLetto': return <FormLetto {...props} />
    case 'attivita': return <FormAttivita {...props} a={m.a} paziente={m.paziente} />
    case 'sotto': return <FormSotto {...props} a={m.a} paziente={m.paziente} />
    case 'impostazioni': return <Impostazioni {...props} />
    case 'consegna': return <FormConsegna {...props} paziente={m.paziente} letto={m.letto} />
    case 'pacchetto': return <FormPacchetto {...props} paziente={m.paziente} letto={m.letto} iniziale={m.pacchettoId} />
    case 'gestionePacchetti': return <GestionePacchetti {...props} />
    case 'cerca': return <Cerca {...props} />
    case 'stato': return <FormStato {...props} a={m.a} paziente={m.paziente} />
    case 'admin': return <Amministrazione {...props} iniziale={m.iniziale} aggiornaConteggio={props.setRichiesteAttesa} />
    default: chiudi(); return null
  }
}

function FormPaziente({ chiudi, az, letto, paziente, reparti, repId, pacchetti = [], apri }) {
  const [nome, setNome] = useState(paziente?.nome ?? '')
  const [pacchettoId, setPacchettoId] = useState('')
  const [note, setNote] = useState(paziente?.note ?? '')
  const [dataRic, setDataRic] = useState(paziente?.data_ricovero ?? T.oggiLocale())
  const [liberi, setLiberi] = useState(null)
  const [dest, setDest] = useState('')

  useEffect(() => {
    if (!paziente) return
    Promise.all([
      supabase.from('letti').select('id, nome, ordine, reparto_id'),
      supabase.from('pazienti').select('letto_id').eq('dimesso', false),
    ]).then(([l, p]) => {
      if (l.error || p.error) return
      const occ = new Set(p.data.map((x) => x.letto_id))
      setLiberi(l.data.filter((x) => !occ.has(x.id)).sort(ordLetti))
    })
  }, [paziente])

  async function salva(e) {
    e.preventDefault()
    if (!nome.trim()) return
    if (paziente) { az.modificaPaziente(paziente, { nome: nome.trim(), note, data_ricovero: dataRic || T.oggiLocale() }); return chiudi() }
    const nuovo = await az.ricovera(letto, nome.trim(), note, dataRic)
    if (nuovo && pacchettoId) apri({ tipo: 'pacchetto', paziente: nuovo, letto, pacchettoId })
    else chiudi()
  }

  const nomeRep = (id) => reparti.find((r) => r.id === id)?.nome ?? ''
  const ordinati = liberi
    ? [...liberi].sort((a, b) => (a.reparto_id === repId ? -1 : 0) - (b.reparto_id === repId ? -1 : 0))
    : []

  return (
    <Foglio titolo={paziente ? `Letto ${letto.nome}` : `Ricovero · letto ${letto.nome}`} chiudi={chiudi}>
      <form onSubmit={salva} className="form">
        <label>Paziente
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Cognome Nome" autoFocus={!paziente} required />
        </label>
        <label>Data di ricovero <span className="grigio">(G{T.giornoRicovero(dataRic) ?? 1} oggi)</span>
          <input type="date" value={dataRic} max={T.oggiLocale()} onChange={(e) => setDataRic(e.target.value)} />
        </label>
        <label>Appunti
          <textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Diagnosi, terapia, cose da ricordare…" />
        </label>
        {!paziente && pacchetti.length > 0 && (
          <label>📋 Pacchetto di attività iniziale
            <select value={pacchettoId} onChange={(e) => setPacchettoId(e.target.value)}>
              <option value="">Nessuno</option>
              {pacchetti.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
        )}
        <button className="btn primario">{!paziente && pacchettoId ? 'Salva e scegli attività →' : 'Salva'}</button>
      </form>
      {paziente && (
        <>
          <div className="sezione">
            <h3>Trasferisci in altro letto</h3>
            {liberi === null ? <p className="grigio">Caricamento letti liberi…</p> : (
              <div className="riga-form">
                <select value={dest} onChange={(e) => setDest(e.target.value)}>
                  <option value="">Scegli letto libero…</option>
                  {ordinati.map((l) => (
                    <option key={l.id} value={l.id}>{nomeRep(l.reparto_id)} · letto {l.nome}</option>
                  ))}
                </select>
                <button className="btn" disabled={!dest}
                  onClick={async () => { if (await az.trasferisci(paziente, dest)) chiudi() }}>Sposta</button>
              </div>
            )}
          </div>
          <div className="sezione">
            <button className="btn pericolo" onClick={() => {
              if (confirm(`Dimettere ${paziente.nome}? Il letto tornerà libero.`)) { az.dimetti(paziente); chiudi() }
            }}>Dimetti paziente</button>
          </div>
        </>
      )}
    </Foglio>
  )
}

function FormLetto({ chiudi, az, letto, lettiRep, pazPerLetto }) {
  const suggerito = useMemo(() => {
    const nums = lettiRep.map((l) => parseInt(l.nome, 10)).filter((n) => !isNaN(n))
    return String(nums.length ? Math.max(...nums) + 1 : 1)
  }, [lettiRep])
  const [nome, setNome] = useState(letto?.nome ?? suggerito)
  async function salva(e) {
    e.preventDefault()
    const n = nome.trim()
    if (!n) return
    if (letto) await az.rinominaLetto(letto, n)
    else await az.aggiungiLetto(n)
    chiudi()
  }
  return (
    <Foglio titolo={letto ? `Letto ${letto.nome}` : 'Nuovo letto'} chiudi={chiudi}>
      <form onSubmit={salva} className="form">
        <label>Nome / numero letto
          <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus required />
        </label>
        <button className="btn primario">{letto ? 'Rinomina' : 'Aggiungi letto'}</button>
      </form>
      {letto && !pazPerLetto[letto.id] && (
        <div className="sezione">
          <button className="btn pericolo" onClick={() => {
            if (confirm(`Eliminare il letto ${letto.nome}? Verrà cancellato anche lo storico dei pazienti dimessi da questo letto.`)) {
              az.eliminaLetto(letto); chiudi()
            }
          }}>Elimina letto</button>
        </div>
      )}
    </Foglio>
  )
}

function FormAttivita({ chiudi, az, a, paziente, profili, medici = [] }) {
  const [testo, setTesto] = useState(a.testo)
  const [guardia, setGuardia] = useState(a.guardia)
  const [scad, setScad] = useState(T.inInputLocale(a.scadenza))
  const tipoRip = a.ripeti_ore ? 'ore' : T.leggiOrari(a.ripeti_orari).length ? 'orari' : ''
  const [rip, setRip] = useState(tipoRip)
  const [ogni, setOgni] = useState(a.ripeti_ore || 6)
  const [orari, setOrari] = useState(T.leggiOrari(a.ripeti_orari).join(' ') || '08:00 12:00 18:00')
  const [assegnata, setAssegnata] = useState(a.assegnata_a || '')
  const oggi = T.oggiLocale()
  const attivi = medici.filter((m) => m.attivo && (!m.scadenza || m.scadenza >= oggi))

  function salva(e) {
    e.preventDefault()
    const nuovo = {
      testo: testo.trim() || a.testo,
      guardia,
      ripeti_ore: rip === 'ore' ? Number(ogni) : null,
      ripeti_orari: rip === 'orari' ? (T.leggiOrari(orari).join(',') || null) : null,
      assegnata_a: assegnata || null,
    }
    let sc = T.daInputLocale(scad)
    // ripetizione appena impostata e nessun orario: parto dalla prima scadenza utile
    if (!sc && rip && !tipoRip) sc = T.primaScadenza(nuovo)?.toISOString() ?? null
    nuovo.scadenza = sc
    const patch = {}
    for (const k of Object.keys(nuovo)) if ((nuovo[k] ?? null) !== (a[k] ?? null)) patch[k] = nuovo[k]
    if (Object.keys(patch).length) az.modificaAttivita(a, patch)
    chiudi()
  }
  return (
    <Foglio titolo={paziente.nome} chiudi={chiudi}>
      <SceltaStato a={a} az={az} profili={profili} dopo={chiudi} />
      <form onSubmit={salva} className="form">
        <label>Attività
          <textarea rows={3} value={testo} onChange={(e) => setTesto(e.target.value)} />
        </label>
        <label>Da fare entro
          <div className="riga-form">
            <input type="datetime-local" value={scad} onChange={(e) => setScad(e.target.value)} />
            {scad && <button type="button" className="btn" onClick={() => setScad('')}>Togli</button>}
          </div>
        </label>
        <div className="bottoni">
          {[['+1h', 1], ['+4h', 4], ['Domani 8:00', 'domani']].map(([t, v]) => (
            <button type="button" key={t} className="btn" onClick={() => {
              const d = new Date()
              if (v === 'domani') { d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0) } else d.setTime(d.getTime() + v * 3600e3)
              setScad(T.inInputLocale(d.toISOString()))
            }}>{t}</button>
          ))}
        </div>
        <label>Si ripete
          <select value={rip} onChange={(e) => setRip(e.target.value)}>
            <option value="">No</option>
            <option value="ore">Ogni N ore</option>
            <option value="orari">A orari fissi</option>
          </select>
        </label>
        {rip === 'ore' && (
          <label>Ogni quante ore
            <select value={ogni} onChange={(e) => setOgni(e.target.value)}>
              {[1, 2, 3, 4, 6, 8, 12, 24].map((n) => <option key={n} value={n}>ogni {n} {n === 1 ? 'ora' : 'ore'}</option>)}
            </select>
          </label>
        )}
        {rip === 'orari' && (
          <label>Orari <span className="grigio">(es. 08:00 12:00 18:00)</span>
            <input value={orari} onChange={(e) => setOrari(e.target.value)} inputMode="numeric" />
          </label>
        )}
        {rip && <p className="grigio piccolo">Quando la spunti, compare subito la prossima con il nuovo orario.</p>}
        <label>Assegnata a
          <select value={assegnata} onChange={(e) => setAssegnata(e.target.value)}>
            <option value="">Nessuno</option>
            {attivi.map((m) => <option key={m.id} value={m.id}>{m.nome || m.email}{m.id === az.io ? ' (tu)' : ''}</option>)}
          </select>
        </label>
        <label className="spunta">
          <input type="checkbox" checked={guardia} onChange={(e) => setGuardia(e.target.checked)} />
          🌙 Per la guardia
        </label>
        <p className="grigio piccolo">
          Creata da {profili[a.creata_da] ?? '—'} · {quando(a.creata_il)}
          {a.fatta && <><br />Fatta da {profili[a.fatta_da] ?? '—'} · {quando(a.fatta_il)}</>}
        </p>
        <button className="btn primario">Salva</button>
      </form>
      <div className="sezione bottoni">
        <button className="btn" onClick={() => { az.modificaAttivita(a, { urgente: !a.urgente }); chiudi() }}>
          {a.urgente ? 'Togli urgenza' : '🔴 Segna urgente'}
        </button>
        <button className="btn pericolo" onClick={() => {
          if (confirm('Eliminare definitivamente questa attività?')) { az.eliminaAttivita(a); chiudi() }
        }}>Elimina</button>
      </div>
    </Foglio>
  )
}

function FormSotto({ chiudi, az, a, paziente }) {
  const [righe, setRighe] = useState('')
  function salva(e) {
    e.preventDefault()
    righe.split('\n').map((s) => s.trim()).filter(Boolean)
      .forEach((t) => az.aggiungiAttivita(paziente, t, false, a.id, { guardia: a.guardia }))
    az.alterna(a.id, true)
    az.alternaScheda(paziente.id, true)
    chiudi()
  }
  return (
    <Foglio titolo="Sotto-attività" chiudi={chiudi}>
      <form onSubmit={salva} className="form">
        <p className="grigio">{paziente.nome} › <b>{a.testo}</b></p>
        <label>Una per riga
          <textarea rows={4} value={righe} onChange={(e) => setRighe(e.target.value)} autoFocus
            placeholder={'es.\nEmocromo\nPCR\nElettroliti'} />
        </label>
        <button className="btn primario" disabled={!righe.trim()}>Aggiungi</button>
      </form>
    </Foglio>
  )
}

function Impostazioni({ chiudi, session, profili, setProfili, reparti, mostraToast, apri, io, richiesteAttesa }) {
  const uid = session.user.id
  const [nome, setNome] = useState(profili[uid] ?? '')
  const [notif, setNotif] = useState({ caricato: false, attive: false, reparti: null })
  const [sel, setSel] = useState([])
  const [pw, setPw] = useState('')
  const [occupato, setOccupato] = useState(false)
  const [passoNotif, setPassoNotif] = useState('')
  const [erroreNotif, setErroreNotif] = useState('')
  const [perm, setPerm] = useState(push.permesso())
  const ok = push.supportato()

  useEffect(() => {
    if (!ok) return
    Promise.all([push.statoAttuale(), push.chiavePubblica()]).then(([s, k]) => {
      setNotif({ caricato: true, configurate: Boolean(k), ...s })
      setSel(s.reparti ?? reparti.map((r) => r.id))
    }).catch(() => setNotif({ caricato: true, attive: false }))
  }, [ok, reparti])

  async function salvaNome() {
    const n = nome.trim()
    if (!n) return
    const { error } = await supabase.from('profili').update({ nome: n }).eq('id', uid)
    if (error) return mostraToast(error.message, null, 'errore')
    setProfili((p) => ({ ...p, [uid]: n }))
    mostraToast('Nome salvato')
  }
  async function attivaNotifiche() {
    setOccupato(true)
    setErroreNotif('')
    try {
      const tutti = sel.length === reparti.length
      await push.attiva(tutti ? null : sel, setPassoNotif)
      setNotif((n) => ({ ...n, attive: true, reparti: tutti ? null : sel }))
      mostraToast('Notifiche attive')
    } catch (e) {
      setErroreNotif(e.message || String(e))
    }
    setPassoNotif('')
    setPerm(push.permesso())
    setOccupato(false)
  }
  async function disattivaNotifiche() {
    setOccupato(true)
    await push.disattiva().catch(() => {})
    setNotif({ caricato: true, attive: false, reparti: null })
    setOccupato(false)
  }
  async function cambiaPw(e) {
    e.preventDefault()
    const { error } = await supabase.auth.updateUser({ password: pw })
    mostraToast(error ? error.message : 'Password aggiornata', null, error ? 'errore' : '')
    if (!error) setPw('')
  }

  return (
    <Foglio titolo="Impostazioni" chiudi={chiudi}>
      {io?.ruolo === 'admin' && (
        <div className="sezione">
          <button className="btn primario" onClick={() => apri({ tipo: 'admin' })}>
            👥 Amministrazione{richiesteAttesa > 0 ? ` · ${richiesteAttesa} ${richiesteAttesa === 1 ? 'richiesta' : 'richieste'}` : ''}
          </button>
        </div>
      )}
      <div className="sezione">
        <h3>Il tuo nome</h3>
        <div className="riga-form">
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Dr. Rossi" />
          <button className="btn" onClick={salvaNome}>Salva</button>
        </div>
        <p className="grigio piccolo">{session.user.email}</p>
      </div>

      <div className="sezione">
        <h3>Notifiche</h3>
        {!ok && push.isIOS && !push.isStandalone && (
          <p className="info">Su iPhone: tocca <b>Condividi</b> → <b>Aggiungi alla schermata Home</b>, poi apri l'app dall'icona e torna qui.</p>
        )}
        {!ok && !(push.isIOS && !push.isStandalone) && (
          <p className="grigio">Questo browser non supporta le notifiche push.</p>
        )}
        {ok && notif.caricato && !notif.configurate && (
          <p className="grigio">Le notifiche non sono ancora state configurate da un amministratore.</p>
        )}
        {ok && notif.caricato && notif.configurate && (
          <>
            <p className="grigio piccolo">Ricevi un avviso quando un collega aggiunge un'attività nei reparti scelti.</p>
            <div className="spunte">
              {reparti.map((r) => (
                <label key={r.id} className="spunta">
                  <input type="checkbox" checked={sel.includes(r.id)}
                    onChange={(e) => setSel((s) => e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id))} />
                  {r.nome}
                </label>
              ))}
            </div>
            <div className="bottoni">
              <button className="btn primario" disabled={occupato || sel.length === 0} onClick={attivaNotifiche}>
                {notif.attive ? 'Aggiorna reparti' : 'Attiva notifiche'}
              </button>
              {notif.attive && <button className="btn" disabled={occupato} onClick={disattivaNotifiche}>Disattiva</button>}
            </div>
            {passoNotif && <p className="grigio piccolo">⏳ {passoNotif}</p>}
            {erroreNotif && <p className="info errore-box">{erroreNotif}</p>}
            {notif.attive && !erroreNotif && <p className="verde piccolo">✓ Notifiche attive su questo dispositivo</p>}
            <p className="grigio piccolo">Permesso del telefono: {
              { granted: '✓ concesso', denied: '✗ bloccato', default: 'non ancora chiesto' }[perm] ?? perm}</p>
          </>
        )}
      </div>

      <div className="sezione">
        <h3>Pacchetti di attività</h3>
        <p className="grigio piccolo">Elenchi di attività predefinite da aggiungere con un tocco (📋 sulla scheda del paziente). Sono condivisi con tutti i medici.</p>
        <button className="btn" onClick={() => apri({ tipo: 'gestionePacchetti' })}>Gestisci pacchetti</button>
      </div>

      <div className="sezione">
        <h3>Cambia password</h3>
        <form className="riga-form" onSubmit={cambiaPw}>
          <input type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nuova password" autoComplete="new-password" />
          <button className="btn" disabled={pw.length < 8}>Salva</button>
        </form>
      </div>

      <div className="sezione">
        <button className="btn pericolo" onClick={async () => { await push.disattiva().catch(() => {}); supabase.auth.signOut() }}>Esci</button>
      </div>
      <Crediti />
    </Foglio>
  )
}

// ---------------------------------------------------------------- GUARDIA
function BoxConsegna({ paziente: p, compatto, onClick, profili = {} }) {
  const g = GRAVITA.find((x) => x.v === p.gravita) ?? GRAVITA[0]
  const r = RIANIMAZIONE.find((x) => x.v === (p.rianimazione ?? null))
  const vecchia = p.consegna_il && Date.now() - new Date(p.consegna_il).getTime() > 24 * 3600e3
  return (
    <div className={`consegna g${p.gravita} ${compatto ? 'compatta' : ''}`} onClick={onClick}>
      <div className="tags">
        {compatto && <span className="tag luna-tag">🌙 Consegna</span>}
        {p.gravita > 0 && <span className={`tag grav${p.gravita}`}>{g.breve}</span>}
        {r?.breve && <span className={`tag ria-${p.rianimazione}`}>{r.breve}</span>}
        {p.allergie?.trim() && <span className="tag allergia">⚠ Allergie: {p.allergie.trim()}</span>}
      </div>
      {p.consegna?.trim() && <p className="testo-consegna">{p.consegna.trim()}</p>}
      {!compatto && p.consegna_il && (
        <small className={vecchia ? 'rosso' : 'grigio'}>
          {vecchia ? '⚠ Da verificare · aggiornata ' : 'Aggiornata '}
          {quando(p.consegna_il)}{p.consegna_da && profili[p.consegna_da] ? ` da ${profili[p.consegna_da]}` : ''}
        </small>
      )}
    </div>
  )
}

function Guardia({ reparti, letti, pazienti, attivita, profili, az, apri, caricato, mostraFatte, setMostraFatte }) {
  const [filtroRep, setFiltroRep] = useState(() => store.get('guardiaRep') || 'tutti')
  const [tutti, setTutti] = useState(false)

  const ordRep = useMemo(() => Object.fromEntries(reparti.map((r) => [r.id, r.ordine])), [reparti])
  const nomeRep = useMemo(() => Object.fromEntries(reparti.map((r) => [r.id, r.nome])), [reparti])
  const lettoDi = useMemo(() => Object.fromEntries(letti.map((l) => [l.id, l])), [letti])
  const valPerPaz = useMemo(() => {
    const m = {}
    for (const a of attivita) if (a.guardia && (mostraFatte || !a.fatta)) (m[a.paziente_id] ??= []).push(a)
    return m
  }, [attivita, mostraFatte])

  const vuoto = { ordine: 0, nome: '' }
  let lista = pazienti.filter((p) => !p.dimesso && (filtroRep === 'tutti' || p.reparto_id === filtroRep))
  if (!tutti) lista = lista.filter((p) => haConsegna(p) || valPerPaz[p.id]?.length)
  lista = [...lista].sort((a, b) =>
    b.gravita - a.gravita ||
    (ordRep[a.reparto_id] ?? 0) - (ordRep[b.reparto_id] ?? 0) ||
    ordLetti(lettoDi[a.letto_id] ?? vuoto, lettoDi[b.letto_id] ?? vuoto))

  const critici = lista.filter((p) => p.gravita === 2).length
  const daFare = lista.reduce((n, p) => n + (valPerPaz[p.id] || []).filter((a) => !a.fatta).length, 0)

  return (
    <>
      <div className="barra-guardia">
        <span><b>{lista.length}</b> {tutti ? 'pazienti' : 'in consegna'}</span>
        {critici > 0 && <span className="rosso"><b>{critici}</b> {critici === 1 ? 'critico' : 'critici'}</span>}
        <span><b>{daFare}</b> {daFare === 1 ? 'valutazione' : 'valutazioni'}</span>
        <span className="spazio" />
        <select className="mini-select" value={filtroRep}
          onChange={(e) => { setFiltroRep(e.target.value); store.set('guardiaRep', e.target.value) }}>
          <option value="tutti">Tutti i reparti</option>
          {reparti.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
        </select>
        <button className={`mini ${tutti ? 'attivo' : ''}`} onClick={() => setTutti((v) => !v)}>Tutti i pazienti</button>
        <button className={`mini ${mostraFatte ? 'attivo' : ''}`} onClick={() => setMostraFatte((v) => !v)}>Fatte</button>
        <button className="mini" onClick={() => {
          document.querySelectorAll('details.appunti').forEach((d) => { d.open = true })
          setTimeout(() => window.print(), 50)
        }}>🖨 Stampa</button>
      </div>
      <main className="lista">
        <h2 className="solo-stampa">
          Consegne di guardia · {filtroRep === 'tutti' ? 'tutti i reparti' : nomeRep[filtroRep]} · {new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}
        </h2>
        {!caricato && <p className="vuoto">Caricamento…</p>}
        {caricato && lista.length === 0 && (
          <p className="vuoto">
            Nessuna consegna.<br />
            <span className="piccolo">Per aggiungerne una tocca 🌙 sulla scheda del paziente nel suo reparto, oppure “Tutti i pazienti”.</span>
          </p>
        )}
        {lista.map((p) => (
          <SchedaGuardia key={p.id} p={p} letto={lettoDi[p.letto_id]} nomeRep={nomeRep[p.reparto_id]}
            valutazioni={valPerPaz[p.id] || []} profili={profili} az={az} apri={apri} />
        ))}
      </main>
    </>
  )
}

function SchedaGuardia({ p, letto, nomeRep, valutazioni, profili, az, apri }) {
  const [testo, setTesto] = useState('')
  const [ora, setOra] = useState('')
  const ids = new Set(valutazioni.map((a) => a.id))
  const perOra = (a, b) => a.fatta - b.fatta || b.urgente - a.urgente ||
    (a.scadenza || '9').localeCompare(b.scadenza || '9') || (a.ora || '99').localeCompare(b.ora || '99') ||
    a.creata_il.localeCompare(b.creata_il)
  const radici = valutazioni.filter((a) => !a.parent_id || !ids.has(a.parent_id)).sort(perOra)
  const figliDi = (id) => valutazioni.filter((a) => a.parent_id === id).sort(perOra)

  function aggiungi(e) {
    e.preventDefault()
    const t = testo.trim()
    if (!t) return
    az.aggiungiAttivita(p, t, false, null, { guardia: true, scadenza: T.oraInScadenza(ora)?.toISOString() })
    setTesto('')
    setOra('')
  }

  return (
    <section className={`letto scheda-g g${p.gravita}`}>
      <div className="intest" onClick={() => apri({ tipo: 'consegna', paziente: p, letto })}>
        <span className="num">{letto?.nome ?? '?'}</span>
        <div className="nome-blocco">
          <span className="nome">{p.nome}</span>
          <small className="grigio">{nomeRep}{p.data_ricovero ? ` · G${T.giornoRicovero(p.data_ricovero)}` : ''}</small>
        </div>
        <button className="icona" aria-label="Modifica consegna">✎</button>
      </div>
      {haConsegna(p)
        ? <BoxConsegna paziente={p} profili={profili} onClick={() => apri({ tipo: 'consegna', paziente: p, letto })} />
        : <p className="grigio piccolo margine">Nessuna consegna.</p>}
      {p.note?.trim() && (
        <details className="appunti">
          <summary>Appunti di reparto</summary>
          <p>{p.note}</p>
        </details>
      )}
      {radici.length > 0 && (
        <ul className="attivita">
          {radici.map((a) => (
            <Attivita key={a.id} a={a} figli={figliDi(a.id)} tutte={valutazioni} profili={profili}
              az={az} apri={apri} paziente={p} nascondiLuna />
          ))}
        </ul>
      )}
      <form className="aggiungi" onSubmit={aggiungi}>
        <input value={testo} onChange={(e) => setTesto(e.target.value)} placeholder="Valutazione da fare…" enterKeyHint="done" />
        <input type="time" className="ora" value={ora} onChange={(e) => setOra(e.target.value)} aria-label="Ora" />
        <button className="piu" aria-label="Aggiungi" disabled={!testo.trim()}>+</button>
      </form>
    </section>
  )
}

function FormConsegna({ chiudi, az, paziente, letto, profili }) {
  const [gravita, setGravita] = useState(paziente.gravita ?? 0)
  const [ria, setRia] = useState(paziente.rianimazione ?? null)
  const [allergie, setAllergie] = useState(paziente.allergie ?? '')
  const [consegna, setConsegna] = useState(paziente.consegna ?? '')

  function salva(e) {
    e.preventDefault()
    az.modificaPaziente(paziente, { gravita, rianimazione: ria, allergie: allergie.trim(), consegna })
    chiudi()
  }
  function svuota() {
    if (!confirm('Cancellare la consegna di questo paziente?')) return
    az.modificaPaziente(paziente, { gravita: 0, rianimazione: null, allergie: '', consegna: '' })
    chiudi()
  }

  return (
    <Foglio titolo={`🌙 Consegna · letto ${letto?.nome ?? ''}`} chiudi={chiudi}>
      <form onSubmit={salva} className="form">
        <p><b>{paziente.nome}</b></p>
        <div>
          <div className="etichetta">Gravità</div>
          <div className="segmenti">
            {GRAVITA.map((g) => (
              <button type="button" key={g.v} className={`seg grav-seg${g.v} ${gravita === g.v ? 'attivo' : ''}`}
                onClick={() => setGravita(g.v)}>{g.v === 0 ? 'Nessuna' : g.nome}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="etichetta">Stato rianimatorio</div>
          <div className="segmenti due">
            {RIANIMAZIONE.map((r) => (
              <button type="button" key={String(r.v)} className={`seg ${ria === r.v ? 'attivo' : ''}`}
                onClick={() => setRia(r.v)}>{r.nome}</button>
            ))}
          </div>
        </div>
        <label>Allergie
          <input value={allergie} onChange={(e) => setAllergie(e.target.value)} placeholder="es. penicillina, mezzo di contrasto" />
        </label>
        <label>Consegna per la guardia
          <textarea rows={6} value={consegna} onChange={(e) => setConsegna(e.target.value)}
            placeholder={'Notizie principali e cosa fare in caso di urgenza.\nes. In TAO (INR 2.8). Se peggioramento neurologico → TC urgente e avvisare neurochirurgo.'} />
        </label>
        {paziente.consegna_il && (
          <p className="grigio piccolo">Ultimo aggiornamento {quando(paziente.consegna_il)}{profili[paziente.consegna_da] ? ` da ${profili[paziente.consegna_da]}` : ''}</p>
        )}
        <button className="btn primario">Salva consegna</button>
        <p className="grigio piccolo">Le valutazioni da fare si aggiungono dalla scheda 🌙 Guardia, oppure con il pulsante 🌙 accanto al campo “Nuova attività”.</p>
      </form>
      {haConsegna(paziente) && (
        <div className="sezione">
          <button className="btn pericolo" onClick={svuota}>Cancella consegna</button>
        </div>
      )}
    </Foglio>
  )
}

// ---------------------------------------------------------------- PACCHETTI
const norm = (t) => t.trim().toLowerCase()

function FormPacchetto({ chiudi, az, paziente, letto, pacchetti, attivita, iniziale, apri }) {
  const [selId, setSelId] = useState(iniziale || null)
  const [spunte, setSpunte] = useState({})
  const pac = pacchetti.find((p) => p.id === selId)
  const esistenti = useMemo(
    () => new Set(attivita.filter((a) => a.paziente_id === paziente.id && !a.fatta).map((a) => norm(a.testo))),
    [attivita, paziente.id],
  )

  // quando scelgo un pacchetto: tutto spuntato tranne ciò che il paziente ha già
  useEffect(() => {
    if (!pac) return
    const s = {}
    pac.voci.forEach((v, i) => {
      s[i] = !esistenti.has(norm(v.t))
      ;(v.f || []).forEach((f, j) => { s[`${i}.${j}`] = true })
    })
    setSpunte(s)
  }, [selId]) // eslint-disable-line react-hooks/exhaustive-deps

  const conta = pac
    ? pac.voci.reduce((n, v, i) => n + (spunte[i] ? 1 + (v.f || []).filter((_, j) => spunte[`${i}.${j}`]).length : 0), 0)
    : 0

  function conferma() {
    const voci = pac.voci
      .map((v, i) => spunte[i] && { ...v, f: (v.f || []).filter((_, j) => spunte[`${i}.${j}`]) })
      .filter(Boolean)
    az.aggiungiPacchetto(paziente, voci)
    chiudi()
  }
  const tutte = (val) => {
    const s = {}
    pac.voci.forEach((v, i) => { s[i] = val; (v.f || []).forEach((_, j) => { s[`${i}.${j}`] = val }) })
    setSpunte(s)
  }

  if (!pac) {
    return (
      <Foglio titolo={`📋 Pacchetto · ${paziente.nome}`} chiudi={chiudi}>
        <div className="elenco-pacchetti">
          {pacchetti.length === 0 && <p className="grigio">Nessun pacchetto. Creane uno da Impostazioni → Gestisci pacchetti.</p>}
          {pacchetti.map((p) => (
            <button key={p.id ?? p.nome} className="pacchetto" onClick={() => setSelId(p.id)}>
              <span className="nome-pac">{p.nome}</span>
              <span className="grigio piccolo">
                {p.voci.length} attività
                {p.voci.some((v) => v.f?.length) ? ` · ${p.voci.reduce((n, v) => n + (v.f?.length || 0), 0)} sotto-attività` : ''}
              </span>
              <span className="freccia">›</span>
            </button>
          ))}
        </div>
        <div className="sezione">
          <button className="btn" onClick={() => apri({ tipo: 'gestionePacchetti' })}>Gestisci pacchetti</button>
        </div>
      </Foglio>
    )
  }

  return (
    <Foglio titolo={`📋 ${pac.nome}`} chiudi={chiudi}>
      <p className="grigio piccolo">Letto {letto?.nome} · <b>{paziente.nome}</b> — togli la spunta a ciò che non serve.</p>
      <div className="riga-azioni">
        {!iniziale && <button className="btn link" onClick={() => setSelId(null)}>‹ Altri pacchetti</button>}
        <span className="spazio" />
        <button className="btn link" onClick={() => tutte(true)}>Tutte</button>
        <button className="btn link" onClick={() => tutte(false)}>Nessuna</button>
      </div>
      <ul className="voci-pac">
        {pac.voci.map((v, i) => {
          const gia = esistenti.has(norm(v.t))
          return (
            <li key={i}>
              <label className={`voce ${spunte[i] ? '' : 'spenta'}`}>
                <input type="checkbox" checked={!!spunte[i]} onChange={(e) => setSpunte((s) => ({ ...s, [i]: e.target.checked }))} />
                <span>{v.t}{T.testoRipeti(v) && <small className="tag-rip"> 🔁 {T.testoRipeti(v)}</small>}
                  {v.entro_ore && <small className="tag-rip"> entro {v.entro_ore}h</small>}
                  {gia && <small className="gia"> · già presente</small>}</span>
              </label>
              {v.f?.length > 0 && (
                <ul>
                  {v.f.map((f, j) => (
                    <li key={j}>
                      <label className={`voce sotto ${spunte[i] && spunte[`${i}.${j}`] ? '' : 'spenta'}`}>
                        <input type="checkbox" disabled={!spunte[i]} checked={!!spunte[`${i}.${j}`]}
                          onChange={(e) => setSpunte((s) => ({ ...s, [`${i}.${j}`]: e.target.checked }))} />
                        <span>{f}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      <div className="piede-fisso">
        <button className="btn primario largo" disabled={conta === 0} onClick={conferma}>
          Aggiungi {conta} {conta === 1 ? 'attività' : 'attività'}
        </button>
      </div>
    </Foglio>
  )
}

// testo <-> voci:  una riga = attività; riga che inizia con "-" = sotto-attività della precedente
// tempi facoltativi tra parentesi quadre: "NIHSS [ogni 6h]", "Glicemia [08:00 12:00 18:00]", "TC [entro 24h]"
const vociInTesto = (voci) => voci.map((v) => [T.scriviTempi(v), ...(v.f || []).map((f) => `- ${f}`)].join('\n')).join('\n')
function testoInVoci(txt) {
  const voci = []
  for (const riga of txt.split('\n')) {
    const r = riga.trim()
    if (!r) continue
    if (/^[-–•*]/.test(r) && voci.length) (voci[voci.length - 1].f ??= []).push(r.replace(/^[-–•*]\s*/, ''))
    else voci.push(T.leggiTempi(r.replace(/^[-–•*]\s*/, '')))
  }
  return voci
}

function GestionePacchetti({ chiudi, pacchetti, caricaPacchetti, mostraToast }) {
  const [modifica, setModifica] = useState(null) // {id?, nome, testo}

  async function salva(e) {
    e.preventDefault()
    const voci = testoInVoci(modifica.testo)
    if (!modifica.nome.trim() || !voci.length) return mostraToast('Inserisci nome e almeno una attività', null, 'errore')
    const row = { nome: modifica.nome.trim(), voci, aggiornato_il: new Date().toISOString() }
    const q = modifica.id
      ? supabase.from('pacchetti').update(row).eq('id', modifica.id)
      : supabase.from('pacchetti').insert({ ...row, ordine: Math.max(0, ...pacchetti.map((p) => p.ordine)) + 1 })
    const { error } = await q
    if (error) return mostraToast(error.message.includes('duplicate') ? 'Esiste già un pacchetto con questo nome' : error.message, null, 'errore')
    await caricaPacchetti()
    setModifica(null)
    mostraToast('Pacchetto salvato')
  }
  async function elimina() {
    if (!confirm(`Eliminare il pacchetto "${modifica.nome}"? Le attività già aggiunte ai pazienti restano.`)) return
    const { error } = await supabase.from('pacchetti').delete().eq('id', modifica.id)
    if (error) return mostraToast(error.message, null, 'errore')
    await caricaPacchetti()
    setModifica(null)
  }

  if (modifica) {
    return (
      <Foglio titolo={modifica.id ? 'Modifica pacchetto' : 'Nuovo pacchetto'} chiudi={() => setModifica(null)}>
        <form className="form" onSubmit={salva}>
          <label>Nome
            <input value={modifica.nome} onChange={(e) => setModifica({ ...modifica, nome: e.target.value })} placeholder="es. Ictus ischemico" required />
          </label>
          <label>Attività — una per riga; con “-” davanti diventa sotto-attività della riga sopra.
            Orari facoltativi tra parentesi quadre: [ogni 6h], [08:00 12:00 18:00], [entro 24h]
            <textarea rows={14} className="mono" value={modifica.testo}
              onChange={(e) => setModifica({ ...modifica, testo: e.target.value })}
              placeholder={'TC encefalo di controllo [entro 24h]\nNIHSS [ogni 6h]\nEsami ematici\n- Emocromo\n- PCR\nGlicemia [08:00 12:00 18:00]'} />
          </label>
          <button className="btn primario">Salva pacchetto</button>
        </form>
        {modifica.id && (
          <div className="sezione"><button className="btn pericolo" onClick={elimina}>Elimina pacchetto</button></div>
        )}
      </Foglio>
    )
  }

  return (
    <Foglio titolo="Pacchetti di attività" chiudi={chiudi}>
      <div className="elenco-pacchetti">
        {pacchetti.map((p) => (
          <button key={p.id ?? p.nome} className="pacchetto" onClick={() => setModifica({ id: p.id, nome: p.nome, testo: vociInTesto(p.voci) })}>
            <span className="nome-pac">{p.nome}</span>
            <span className="grigio piccolo">{p.voci.length} attività</span>
            <span className="freccia">✎</span>
          </button>
        ))}
      </div>
      <div className="sezione">
        <button className="btn primario" onClick={() => setModifica({ nome: '', testo: '' })}>+ Nuovo pacchetto</button>
      </div>
    </Foglio>
  )
}

// ---------------------------------------------------------------- RICERCA
function Cerca({ chiudi, reparti, vaiA }) {
  const [q, setQ] = useState('')
  const [ris, setRis] = useState([])
  const [cercando, setCercando] = useState(false)
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setRis([]); return }
    setCercando(true)
    const timer = setTimeout(async () => {
      const { data } = await supabase.from('pazienti').select('id, nome, reparto_id, letto_id, data_ricovero, letti(nome)')
        .eq('dimesso', false).ilike('nome', `%${t.replace(/[%_]/g, '')}%`).order('nome').limit(20)
      setRis(data || [])
      setCercando(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [q])
  const nomeRep = (id) => reparti.find((r) => r.id === id)?.nome ?? ''
  return (
    <Foglio titolo="🔍 Cerca paziente" chiudi={chiudi}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cognome o nome…" enterKeyHint="search" />
      <div className="elenco-admin">
        {q.trim().length >= 2 && !cercando && ris.length === 0 && <p className="grigio">Nessun paziente ricoverato con questo nome.</p>}
        {ris.map((p) => (
          <button key={p.id} className="riga-admin cliccabile" onClick={() => { vaiA(p); chiudi() }}>
            <span className="num">{p.letti?.nome ?? '?'}</span>
            <div className="cresce"><b>{p.nome}</b><br /><span className="grigio piccolo">{nomeRep(p.reparto_id)}
              {p.data_ricovero ? ` · G${T.giornoRicovero(p.data_ricovero)}` : ''}</span></div>
            <span className="freccia">›</span>
          </button>
        ))}
      </div>
    </Foglio>
  )
}

// ---------------------------------------------------------------- STATO DELL'ATTIVITÀ
function SceltaStato({ a, az, profili, dopo }) {
  return (
    <div className="scelta-stato">
      <div className="etichetta">Stato</div>
      <div className="stati">
        {STATI.map((x) => (
          <button key={x.v} type="button" className={`stato-btn s-${x.v} ${a.stato === x.v ? 'attivo' : ''}`}
            onClick={() => { az.impostaStato(a, a.stato === x.v ? null : x.v); dopo() }}>
            <span>{x.icona}</span>{x.nome}
          </button>
        ))}
      </div>
      {a.stato && a.stato_il && (
        <p className="grigio piccolo">{statoDi(a.stato)?.nome} da {profili[a.stato_da] ?? '—'} · {quando(a.stato_il)}
          {' · '}<button type="button" className="btn link mini-link" onClick={() => { az.impostaStato(a, null); dopo() }}>togli stato</button></p>
      )}
    </div>
  )
}

function FormStato({ chiudi, az, a, paziente, profili }) {
  return (
    <Foglio titolo={a.testo} chiudi={chiudi}>
      <p className="grigio piccolo">{paziente.nome}</p>
      <SceltaStato a={a} az={az} profili={profili} dopo={chiudi} />
    </Foglio>
  )
}
