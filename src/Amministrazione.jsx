import { useCallback, useEffect, useState } from 'react'
import { supabase, infoConfigurazione } from './supabase'
import Foglio from './Foglio'
import * as push from './push'
import { oggiLocale } from './tempi'

export const INDIRIZZO_APP = new URL(import.meta.env.BASE_URL, location.origin).href

/** password provvisoria facile da dettare: Neuro-kmtr-4821 */
export function passwordProvvisoria() {
  const lettere = 'abcdefghjkmnpqrstuvwxyz'
  const r = new Uint32Array(8)
  crypto.getRandomValues(r)
  const l = [...r.slice(0, 4)].map((x) => lettere[x % lettere.length]).join('')
  const n = [...r.slice(4)].map((x) => x % 10).join('')
  return `Neuro-${l}-${n}`
}

export function messaggioCredenziali({ nome, email, password }) {
  return [
    `Ciao${nome ? ' ' + nome : ''}, ecco l'accesso all'app del reparto di Neurologia:`,
    `🔗 ${INDIRIZZO_APP}`,
    `Email: ${email}`,
    `Password provvisoria: ${password}`,
    '',
    'Appena entri: ⚙︎ Impostazioni → scrivi il tuo nome e cambia la password.',
    'Per averla come app: Safari/Chrome → Condividi → "Aggiungi alla schermata Home".',
  ].join('\n')
}

/** chiamata alla funzione server "admin" con messaggi di errore comprensibili */
export async function chiamaAdmin(body) {
  const { data, error } = await supabase.functions.invoke('admin', { body })
  if (error) {
    let msg = error.message || String(error)
    try {
      const j = await error.context?.json?.()
      if (j?.errore) msg = j.errore
    } catch { /* risposta non JSON */ }
    if (/failed to send|failed to fetch|not found|404/i.test(msg))
      msg = 'La funzione "admin" non è raggiungibile: va pubblicata su Supabase (vedi istruzioni nel README).'
    throw new Error(msg)
  }
  if (data?.errore) throw new Error(data.errore)
  return data
}

function Condividi({ testo, mostraToast }) {
  async function copia() {
    try { await navigator.clipboard.writeText(testo); mostraToast('Copiato') } catch { mostraToast('Copia non riuscita: seleziona il testo e copialo', null, 'errore') }
  }
  return (
    <>
      <pre className="messaggio">{testo}</pre>
      <div className="bottoni">
        {navigator.share && <button className="btn primario" onClick={() => navigator.share({ text: testo }).catch(() => {})}>Condividi…</button>}
        <button className="btn" onClick={copia}>Copia messaggio</button>
      </div>
      <p className="grigio piccolo">Invialo al collega (WhatsApp, email, SMS). La password non verrà più mostrata.</p>
    </>
  )
}

const scaduto = (u) => u.scadenza && u.scadenza < oggiLocale()

export default function Amministrazione({ chiudi, mostraToast, session, iniziale, aggiornaConteggio, reparti = [], caricaReparti }) {
  const io = session.user.id
  const [tab, setTab] = useState(iniziale || 'richieste')
  const [richieste, setRichieste] = useState(null)
  const [utenti, setUtenti] = useState(null)
  const [vista, setVista] = useState(null)
  const [occupato, setOccupato] = useState(false)

  const carica = useCallback(async () => {
    const [r, u] = await Promise.all([
      supabase.from('richieste_accesso').select('*').eq('stato', 'in_attesa').order('creata_il'),
      supabase.from('profili').select('*').order('nome'),
    ])
    if (r.error || u.error) return mostraToast(`Errore: ${(r.error || u.error).message}`, null, 'errore')
    setRichieste(r.data)
    setUtenti(u.data)
    aggiornaConteggio?.(r.data.length)
  }, [mostraToast, aggiornaConteggio])
  useEffect(() => { carica() }, [carica])

  async function rifiuta(r) {
    if (!confirm(`Rifiutare la richiesta di ${r.nome}?`)) return
    const { error } = await supabase.from('richieste_accesso')
      .update({ stato: 'rifiutata', gestita_da: io, gestita_il: new Date().toISOString() }).eq('id', r.id)
    if (error) return mostraToast(error.message, null, 'errore')
    carica()
  }

  // ----- sotto-schermate
  if (vista?.tipo === 'crea') {
    return <CreaUtente {...{ chiudi, mostraToast, occupato, setOccupato }} richiesta={vista.richiesta}
      indietro={() => setVista(null)} fatto={(testo) => { setVista({ tipo: 'fatto', testo }); carica() }} />
  }
  if (vista?.tipo === 'utente') {
    return <SchedaUtente {...{ chiudi, mostraToast, occupato, setOccupato, io }} u={vista.u}
      indietro={() => { setVista(null); carica() }} fatto={(testo) => { setVista({ tipo: 'fatto', testo }); carica() }} />
  }
  if (vista?.tipo === 'fatto') {
    return (
      <Foglio titolo="✓ Fatto" chiudi={chiudi} indietro={() => setVista(null)}>
        <Condividi testo={vista.testo} mostraToast={mostraToast} />
      </Foglio>
    )
  }

  const attesa = richieste?.length ?? 0
  return (
    <Foglio titolo="Amministrazione" chiudi={chiudi}>
      <div className="schede">
        {[['richieste', `Richieste${attesa ? ` (${attesa})` : ''}`], ['utenti', 'Utenti'], ['reparti', 'Reparti'], ['notifiche', 'Notifiche']].map(([k, t]) => (
          <button key={k} className={`scheda ${tab === k ? 'attiva' : ''}`} onClick={() => setTab(k)}>{t}</button>
        ))}
      </div>

      {tab === 'richieste' && (
        <div className="elenco-admin">
          {richieste === null && <p className="grigio">Caricamento…</p>}
          {richieste?.length === 0 && (
            <p className="grigio">Nessuna richiesta in attesa. I colleghi possono chiedere l'accesso dal pulsante
              “Richiedi accesso” nella pagina di login.</p>
          )}
          {richieste?.map((r) => (
            <div key={r.id} className="riga-admin">
              <div className="cresce">
                <b>{r.nome}</b><br />
                <span className="grigio piccolo">{r.email}</span>
                {r.messaggio && <p className="piccolo">{r.messaggio}</p>}
                <span className="grigio piccolo">{new Date(r.creata_il).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <div className="azioni-verticali">
                <button className="btn primario" onClick={() => setVista({ tipo: 'crea', richiesta: r })}>Approva</button>
                <button className="btn" onClick={() => rifiuta(r)}>Rifiuta</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'utenti' && (
        <div className="elenco-admin">
          <button className="btn primario largo" onClick={() => setVista({ tipo: 'crea' })}>+ Nuovo utente</button>
          {utenti === null && <p className="grigio">Caricamento…</p>}
          {utenti?.map((u) => (
            <button key={u.id} className="riga-admin cliccabile" onClick={() => setVista({ tipo: 'utente', u })}>
              <div className="cresce">
                <b>{u.nome || '—'}</b>{u.id === io && <span className="grigio"> (tu)</span>}<br />
                <span className="grigio piccolo">{u.email}</span>
              </div>
              <div className="tags">
                {u.ruolo === 'admin' && <span className="tag admin">Amministratore</span>}
                {!u.attivo && <span className="tag spento">Bloccato</span>}
                {u.attivo && scaduto(u) && <span className="tag spento">Scaduto</span>}
                {u.attivo && !scaduto(u) && u.scadenza && (
                  <span className="tag">fino al {new Date(u.scadenza).toLocaleDateString('it-IT')}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {tab === 'reparti' && <GestioneReparti reparti={reparti} caricaReparti={caricaReparti} mostraToast={mostraToast} />}

      {tab === 'notifiche' && <ConfiguraNotifiche mostraToast={mostraToast} />}
    </Foglio>
  )
}

// ---------------------------------------------------------------- REPARTI E LETTI
// Nomi e numero di letti non sono scritti nel codice: ogni ospedale li configura qui.
function GestioneReparti({ reparti, caricaReparti, mostraToast }) {
  const [conteggi, setConteggi] = useState({})      // reparto_id -> { letti, ricoverati }
  const [nuovo, setNuovo] = useState(null)          // { nome, letti }
  const [modifica, setModifica] = useState(null)    // reparto in modifica { id, nome }
  const [occupato, setOccupato] = useState(false)

  const contaLetti = useCallback(async () => {
    const [l, p] = await Promise.all([
      supabase.from('letti').select('reparto_id'),
      supabase.from('pazienti').select('reparto_id').eq('dimesso', false),
    ])
    if (l.error || p.error) return
    const c = {}
    for (const x of l.data) (c[x.reparto_id] ??= { letti: 0, ricoverati: 0 }).letti++
    for (const x of p.data) (c[x.reparto_id] ??= { letti: 0, ricoverati: 0 }).ricoverati++
    setConteggi(c)
  }, [])
  useEffect(() => { contaLetti() }, [contaLetti, reparti])

  const errore = (e) => mostraToast(
    /duplicate|unique/i.test(e.message) ? 'Esiste già un reparto con questo nome' : e.message, null, 'errore')

  async function crea(e) {
    e.preventDefault()
    const nome = nuovo.nome.trim()
    const n = parseInt(nuovo.letti, 10)
    if (!nome) return
    setOccupato(true)
    const { error } = await supabase.rpc('crea_reparto', { p_nome: nome, p_letti: isNaN(n) ? 0 : n })
    setOccupato(false)
    if (error) return errore(error)
    await caricaReparti?.()
    setNuovo(null)
    mostraToast(`Reparto "${nome}" creato${n > 0 ? ` con ${n} letti` : ''}`)
  }

  async function rinomina(e) {
    e.preventDefault()
    const nome = modifica.nome.trim()
    if (!nome) return
    const { error } = await supabase.from('reparti').update({ nome }).eq('id', modifica.id)
    if (error) return errore(error)
    await caricaReparti?.()
    setModifica(null)
    mostraToast('Reparto rinominato')
  }

  async function elimina(r) {
    const c = conteggi[r.id] ?? { letti: 0, ricoverati: 0 }
    if (c.ricoverati > 0) return mostraToast('Prima trasferisci o dimetti i pazienti ricoverati in questo reparto', null, 'errore')
    if (!confirm(`Eliminare il reparto "${r.nome}" con i suoi ${c.letti} letti? Verrà cancellato anche lo storico dei pazienti dimessi.`)) return
    const { error } = await supabase.from('reparti').delete().eq('id', r.id)
    if (error) return errore(error)
    await caricaReparti?.()
    setModifica(null)
    mostraToast('Reparto eliminato')
  }

  // sposta un reparto su o giù, poi rinumera "ordine" (1, 2, 3…) per tutta la lista
  async function sposta(i, di) {
    const lista = reparti.slice()
    const j = i + di
    if (j < 0 || j >= lista.length) return
    ;[lista[i], lista[j]] = [lista[j], lista[i]]
    const daAggiornare = lista.map((r, k) => ({ id: r.id, ordine: k + 1 })).filter((x, k) => lista[k].ordine !== x.ordine)
    const esiti = await Promise.all(daAggiornare.map((x) => supabase.from('reparti').update({ ordine: x.ordine }).eq('id', x.id)))
    const err = esiti.find((e) => e.error)?.error
    if (err) return errore(err)
    caricaReparti?.()
  }

  if (nuovo) {
    return (
      <form className="form" onSubmit={crea}>
        <h3>Nuovo reparto</h3>
        <label>Nome del reparto
          <input value={nuovo.nome} onChange={(e) => setNuovo({ ...nuovo, nome: e.target.value })}
            placeholder="es. Neurologia, Stroke Unit" autoFocus required />
        </label>
        <label>Numero di letti <span className="grigio">(numerati da 1; si potranno aggiungere, rinominare o togliere dopo)</span>
          <input type="number" min={0} max={200} inputMode="numeric" value={nuovo.letti}
            onChange={(e) => setNuovo({ ...nuovo, letti: e.target.value })} />
        </label>
        <div className="bottoni">
          <button className="btn primario" disabled={occupato || !nuovo.nome.trim()}>{occupato ? 'Creazione…' : 'Crea reparto'}</button>
          <button type="button" className="btn" onClick={() => setNuovo(null)}>Annulla</button>
        </div>
      </form>
    )
  }

  if (modifica) {
    const c = conteggi[modifica.id] ?? { letti: 0, ricoverati: 0 }
    return (
      <div className="form">
        <form className="form" onSubmit={rinomina}>
          <h3>Modifica reparto</h3>
          <label>Nome del reparto
            <input value={modifica.nome} onChange={(e) => setModifica({ ...modifica, nome: e.target.value })} autoFocus required />
          </label>
          <div className="bottoni">
            <button className="btn primario" disabled={!modifica.nome.trim()}>Rinomina</button>
            <button type="button" className="btn" onClick={() => setModifica(null)}>Annulla</button>
          </div>
        </form>
        <p className="grigio piccolo">{c.letti} {c.letti === 1 ? 'letto' : 'letti'}, {c.ricoverati} {c.ricoverati === 1 ? 'paziente ricoverato' : 'pazienti ricoverati'}.
          I letti si aggiungono, rinominano ed eliminano dalla schermata del reparto (pulsante “+ Aggiungi letto” in fondo, oppure toccando il numero di un letto libero).</p>
        <div className="sezione">
          <button className="btn pericolo" disabled={c.ricoverati > 0} onClick={() => elimina(reparti.find((r) => r.id === modifica.id))}>
            Elimina reparto
          </button>
          {c.ricoverati > 0 && <p className="grigio piccolo">Si può eliminare solo un reparto senza pazienti ricoverati.</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="elenco-admin">
      <button className="btn primario largo" onClick={() => setNuovo({ nome: '', letti: '' })}>+ Nuovo reparto</button>
      {reparti.length === 0 && (
        <p className="grigio">Nessun reparto. Crea i reparti del tuo ospedale indicando nome e numero di letti:
          l'app non ha nulla di prestabilito.</p>
      )}
      {reparti.map((r, i) => {
        const c = conteggi[r.id] ?? { letti: 0, ricoverati: 0 }
        return (
          <div key={r.id} className="riga-admin">
            <div className="azioni-verticali ordine-frecce">
              <button className="icona" aria-label="Sposta su" disabled={i === 0} onClick={() => sposta(i, -1)}>▲</button>
              <button className="icona" aria-label="Sposta giù" disabled={i === reparti.length - 1} onClick={() => sposta(i, 1)}>▼</button>
            </div>
            <button className="testo-reparto" onClick={() => setModifica({ id: r.id, nome: r.nome })}>
              <b>{r.nome}</b><br />
              <span className="grigio piccolo">{c.letti} {c.letti === 1 ? 'letto' : 'letti'} · {c.ricoverati} {c.ricoverati === 1 ? 'ricoverato' : 'ricoverati'}</span>
            </button>
            <span className="freccia">✎</span>
          </div>
        )
      })}
      <p className="grigio piccolo">L'ordine qui è l'ordine delle schede in alto nell'app. Le modifiche arrivano subito a tutti i colleghi.</p>
    </div>
  )
}

function CampiAccount({ v, set, conPassword = true }) {
  return (
    <>
      <label>Nome e cognome
        <input value={v.nome} onChange={(e) => set({ ...v, nome: e.target.value })} placeholder="Dr. Mario Rossi" />
      </label>
      {v.email !== undefined && (
        <label>Email
          <input type="email" value={v.email} onChange={(e) => set({ ...v, email: e.target.value })} required />
        </label>
      )}
      {conPassword && (
        <label>Password provvisoria
          <div className="riga-form">
            <input value={v.password} onChange={(e) => set({ ...v, password: e.target.value })} minLength={8} required />
            <button type="button" className="btn" onClick={() => set({ ...v, password: passwordProvvisoria() })}>↻</button>
          </div>
        </label>
      )}
      <label>Ruolo
        <select value={v.ruolo} onChange={(e) => set({ ...v, ruolo: e.target.value })}>
          <option value="medico">Medico</option>
          <option value="admin">Amministratore (gestisce utenti e richieste)</option>
        </select>
      </label>
      <label>Accesso valido fino al <span className="grigio">(vuoto = senza scadenza)</span>
        <div className="riga-form">
          <input type="date" value={v.scadenza || ''} onChange={(e) => set({ ...v, scadenza: e.target.value })} />
          {v.scadenza && <button type="button" className="btn" onClick={() => set({ ...v, scadenza: '' })}>Togli</button>}
        </div>
      </label>
      <div className="bottoni">
        {[['+3 mesi', 3], ['+6 mesi', 6], ['+1 anno', 12]].map(([t, mesi]) => (
          <button type="button" key={t} className="btn" onClick={() => {
            const d = new Date(); d.setMonth(d.getMonth() + mesi)
            set({ ...v, scadenza: oggiLocale(d) })
          }}>{t}</button>
        ))}
      </div>
      <p className="grigio piccolo">Utile per gli specializzandi: alla data indicata l'account si disattiva da solo.</p>
    </>
  )
}

function CreaUtente({ chiudi, indietro, fatto, mostraToast, richiesta, occupato, setOccupato }) {
  const [v, setV] = useState({
    nome: richiesta?.nome ?? '', email: richiesta?.email ?? '', password: passwordProvvisoria(),
    ruolo: 'medico', scadenza: '',
  })
  async function crea(e) {
    e.preventDefault()
    setOccupato(true)
    try {
      await chiamaAdmin({ azione: 'crea', ...v, scadenza: v.scadenza || null, richiesta_id: richiesta?.id })
      fatto(messaggioCredenziali(v))
    } catch (err) {
      mostraToast(err.message, null, 'errore')
    }
    setOccupato(false)
  }
  return (
    <Foglio titolo={richiesta ? 'Approva richiesta' : 'Nuovo utente'} chiudi={chiudi} indietro={indietro}>
      <form className="form" onSubmit={crea}>
        {richiesta?.messaggio && <p className="info">“{richiesta.messaggio}”</p>}
        <CampiAccount v={v} set={setV} />
        <button className="btn primario" disabled={occupato}>{occupato ? 'Creazione…' : 'Crea account'}</button>
      </form>
    </Foglio>
  )
}

function SchedaUtente({ chiudi, indietro, fatto, mostraToast, u, io, occupato, setOccupato }) {
  const [v, setV] = useState({ nome: u.nome, ruolo: u.ruolo, scadenza: u.scadenza || '', attivo: u.attivo })
  async function salva(e) {
    e.preventDefault()
    const { error } = await supabase.from('profili')
      .update({ nome: v.nome.trim(), ruolo: v.ruolo, scadenza: v.scadenza || null, attivo: v.attivo }).eq('id', u.id)
    if (error) return mostraToast(error.message, null, 'errore')
    mostraToast('Salvato')
    indietro()
  }
  async function nuovaPassword() {
    if (!confirm(`Impostare una nuova password provvisoria per ${u.nome || u.email}?`)) return
    const password = passwordProvvisoria()
    setOccupato(true)
    try {
      await chiamaAdmin({ azione: 'password', user_id: u.id, password })
      fatto(messaggioCredenziali({ nome: u.nome, email: u.email, password }))
    } catch (err) { mostraToast(err.message, null, 'errore') }
    setOccupato(false)
  }
  async function elimina() {
    if (!confirm(`Eliminare definitivamente l'account di ${u.nome || u.email}? Le attività che ha creato restano.`)) return
    setOccupato(true)
    try {
      await chiamaAdmin({ azione: 'elimina', user_id: u.id })
      mostraToast('Account eliminato')
      indietro()
    } catch (err) { mostraToast(err.message, null, 'errore') }
    setOccupato(false)
  }
  return (
    <Foglio titolo={u.nome || u.email} chiudi={chiudi} indietro={indietro}>
      <form className="form" onSubmit={salva}>
        <p className="grigio piccolo">{u.email}</p>
        <CampiAccount v={v} set={setV} conPassword={false} />
        <label className="spunta">
          <input type="checkbox" checked={v.attivo} onChange={(e) => setV({ ...v, attivo: e.target.checked })} disabled={u.id === io} />
          Account attivo (togli la spunta per bloccare subito l'accesso)
        </label>
        <button className="btn primario">Salva</button>
      </form>
      <div className="sezione">
        <button className="btn" disabled={occupato} onClick={nuovaPassword}>Imposta nuova password provvisoria</button>
        {u.id !== io && <button className="btn pericolo" disabled={occupato} onClick={elimina}>Elimina account</button>}
      </div>
    </Foglio>
  )
}

function ConfiguraNotifiche({ mostraToast }) {
  const [presente, setPresente] = useState(null)
  const [occupato, setOccupato] = useState(false)
  const verifica = useCallback(async () => {
    const { data } = await supabase.from('impostazioni').select('valore').eq('chiave', 'vapid_public').maybeSingle()
    setPresente(Boolean(data?.valore))
  }, [])
  useEffect(() => { verifica() }, [verifica])

  async function genera() {
    if (presente && !confirm('Rigenerare le chiavi? Tutti dovranno riattivare le notifiche dalle Impostazioni.')) return
    setOccupato(true)
    try {
      const k = await push.generaChiavi()
      const { error } = await supabase.rpc('imposta_chiavi_notifiche', { p_pubblica: k.pubblica, p_privata: k.privata })
      if (error) throw error
      push.dimenticaChiave()
      mostraToast('Chiavi delle notifiche salvate')
      verifica()
    } catch (e) { mostraToast(e.message || String(e), null, 'errore') }
    setOccupato(false)
  }

  return (
    <div className="form">
      <p><b>1. Chiavi delle notifiche</b> {presente === null ? '…' : presente ? <span className="verde">✓ configurate</span> : <span className="rosso">non ancora create</span>}</p>
      <button className="btn" disabled={occupato} onClick={genera}>{presente ? 'Rigenera chiavi (sconsigliato)' : 'Genera chiavi'}</button>
      <p className="grigio piccolo">Le chiavi vengono create su questo dispositivo e salvate nel database: quella segreta non è più leggibile dall'app.</p>
      <p><b>2. Su Supabase</b> (una volta sola, vedi README del progetto, sezione “Notifiche”):</p>
      <ul className="piccolo elenco-passi">
        <li>Edge Functions → pubblica le funzioni <code>notifica</code> e <code>admin</code></li>
        <li>Database → Webhooks: <code>attivita</code> (Insert, Update) e <code>richieste_accesso</code> (Insert) → funzione <code>notifica</code></li>
      </ul>
      <p><b>3.</b> Ogni medico: ⚙︎ Impostazioni → <b>Attiva notifiche</b>.</p>
      <details className="dettagli-tecnici sinistra">
        <summary>Dettagli tecnici della configurazione</summary>
        <p>Progetto Supabase: <code>{infoConfigurazione().progetto}</code></p>
        <p>Tipo di chiave dell'app: <code>{infoConfigurazione().tipo}</code></p>
      </details>
    </div>
  )
}
