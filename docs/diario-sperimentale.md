# Diario sperimentale

Registro degli esperimenti e dei problemi riscontrati durante lo sviluppo, in italiano (stile formale): il contenuto confluirà nei capitoli sperimentali della tesi (M6). Una voce per data; i dati citati sono riproducibili con i comandi indicati. Le decisioni architetturali restano di proprietà di [architettura.md](architettura.md).

## 2026-09-14 — Un aggiornamento di pypdf cambia il testo estratto senza cambiare l'instradamento

### 1. Il confronto

L'aggiornamento di `pypdf` da **6.16.1** a **6.18.1** (pull request di Dependabot) è stato accettato solo dopo aver misurato `rag.probe` sull'intero corpus prima e dopo, perché la CI non esegue alcun ingest e quindi non avrebbe potuto dire nulla al riguardo.

Il conteggio delle pagine e quello delle immagini sono **identici in tutti i 31 documenti**. Cambia soltanto la densità di testo estratto, e cambia **sempre nella stessa direzione**: 12 documenti su 31 restituiscono più caratteri per pagina, nessuno ne restituisce meno.

| Documento | 6.16.1 | 6.18.1 | Δ |
| --- | --- | --- | --- |
| Progetti Esercitazione Back-end PPM 2026 | 3975 | **4362** | +9,7% |
| javascript_info_set2 | 540 | **557** | +3,1% |
| javascript_info_set1 | 461 | **474** | +2,8% |
| jquery_basics | 465 | **478** | +2,8% |
| javascript_browser_document_events_interfaces | 566 | **581** | +2,7% |
| 1.1 Course intro 2025 (2) | 261 | **268** | +2,7% |
| 2.3 IMAGES LOSSY COMPRESSION 2024 | 413 | **423** | +2,4% |
| 3.2b VIDEO H261-H262 2024 | 410 | **418** | +2,0% |
| 4.1 Docker | 350 | **357** | +2,0% |
| 3.1b VIDEO GENERAL CONCEPTS 2024 | 537 | **547** | +1,9% |
| 4.2 Docker | 342 | **348** | +1,8% |
| 3.3b VIDEO H264-H265 2024 | 1009 | **1020** | +1,1% |
| *(gli altri 19)* | — | *invariati* | 0 |

La causa non è stata investigata: per accettare l'aggiornamento bastava sapere che il verdetto dell'instradamento non cambiava. Che il segno sia sempre positivo suggerisce una correzione a monte nell'estrazione del livello di testo, non una regressione.

### 2. Cosa non è cambiato, ed è la ragione per cui l'aggiornamento è stato accettato

L'instradamento adattivo è **identico**: gli stessi 4 documenti richiedono l'arricchimento delle formule (`2.1 IMAGES GENERAL`, `2.3 IMAGES LOSSY`, `3.2b VIDEO H261-H262`, `3.3b VIDEO H264-H265`, tutti per presenza di font matematici `SymbolMT`), lo stesso unico documento richiede OCR (`3.5-HTML5-Part-2`, 50% di pagine senza livello di testo), i restanti 26 restano `classic`. Zero falsi positivi, come alla misura originale.

Anche il recupero è invariato: `gold/smoke.jsonl` restituisce **38/40 (95%)** prima e dopo, con gli stessi due errori (`q018`, `q028`). La misura è stata ripetuta anche dopo l'aggiornamento di `qdrant-client` da 1.18.0 a 1.19.0, accettato nella stessa sessione.

### 3. La conseguenza sulla riproducibilità

Due numeri già registrati in [architettura.md](architettura.md), sezione «语料与交付范围», sono stati prodotti con `pypdf` 6.16.1: i **~650 000 caratteri** del corpus e il guadagno dell'OCR sul documento `3.5-HTML5` (**10001 → 20032 caratteri**). Non sono sbagliati, ma da oggi si sa che **dipendono dalla versione della libreria di estrazione**, esattamente come i risultati di generazione dipendono dalla revisione del modello. La versione dello stack di analisi entra quindi nell'elenco di riproducibilità.

### 4. Un punto lasciato non verificato, dichiarato come tale

`rag/live.py` usa `pypdf` anche per un secondo scopo: leggere un campione del livello di testo di un PDF scaricato dal web, da passare al gate di rilevanza. Se l'estrazione restituisce più testo, il campione cambia, e il verdetto del gate **potrebbe** cambiare con esso. Il valore di riferimento è **18/20** sull'insieme annotato.

Questa misura non è stata ripetuta in questa sessione: richiede Ollama in esecuzione, e il gate è comunque destinato a essere ripensato nella direzione registrata il 2026-09-14 in [decisioni.md](decisioni.md) (conferma manuale al posto della scrittura automatica, `#48`). Va però scritto che si tratta di un punto **non misurato**, e non di un punto misurato e risultato stabile.

### Riproducibilità

```bash
uv run python -m rag.probe data/corpus/PPM      # instradamento su tutti i 31 documenti
uv run python -m rag.gold gold/smoke.jsonl      # hit@5 sul gold set di fumo
uv run python -m rag.live --measure-gate        # NON eseguito in questa sessione; richiede Ollama
```

Versioni a confronto: `pypdf` 6.16.1 → 6.18.1, `qdrant-client` 1.18.0 → 1.19.0. Corpus invariato in `data/corpus/PPM` (31 PDF); indice invariato in `data/qdrant/` (collection `slides`; `unifi_web` a 29098 punti). Nessun reindicizzamento è stato eseguito: `rag.probe` non scrive, e il confronto riguarda l'estrazione, non i vettori.

## 2026-08-27 — Collaudo dell'interfaccia web: conversazione multi-turno, risoluzione anaforica, trascrizione al posto della risposta

### 1. Il collaudo manuale di M5

L'interfaccia completa (`frontend/`, servita da Django sulla propria radice: `just fe` + `just serve` → `127.0.0.1:8000`) è stata percorsa a mano in una sessione unica. Registrazione, accesso, domanda sul corpus dei corsi, domanda di ateneo, cambio fra le tre lingue, cambio di tema, riapertura di una conversazione dalla barra laterale, larghezza ridotta, ricaricamento su `/c/<id>`: nessun difetto riscontrato sul lato dell'interfaccia. Le schede delle fonti e i richiami numerati ricompaiono anche sulle conversazioni rilette dal database, che è la ragione per cui `citations` e `route` vengono persistiti insieme al testo della risposta — l'evento `start` che li portava non esiste più al momento della rilettura.

Restano fuori da questa voce, perché appartengono alla generazione e non all'interfaccia, i due difetti descritti sotto.

### 2. La risoluzione anaforica multi-turno: una prima osservazione, favorevole

Il turno di follow-up è stato risolto correttamente in un caso reale non progettato come prova:

| Turno | Domanda | `RouteDecision.reason` |
| --- | --- | --- |
| 1 | «我九月就要毕业了，查看毕业时间» | «毕业时间是官方公布的固定信息，属于 unifi_web 范畴…» |
| 2 | «我是 ingegneria informatica 的» | «学生是信息工程专业，**需要查询该专业毕业时间**，此信息属于大学官方行政信息…» |

La seconda domanda non contiene alcun riferimento letterale alla data di laurea: dice soltanto a quale corso di laurea appartiene lo studente. L'antecedente è stato quindi recuperato dalla domanda precedente, che è esattamente ciò che l'iniezione della cronologia nel router deve produrre.

Va sottolineato il valore probatorio limitato: **un caso non è una misurazione**. L'accuratezza dell'instradamento riportata finora (exact 22/32) è una cifra a turno singolo, mentre il sistema dimostrato è multi-turno; `gold/campus.jsonl` non contiene domande di follow-up e una misurazione dell'instradamento multi-turno richiederebbe prima di costruirne un insieme. Voce aperta in M3.

Si conferma per contro la forma dell'iniezione scelta in fase di progetto: al router arrivano **soltanto le domande** dello studente, mai le risposte. Due ragioni, entrambe verificabili su questa sessione — l'antecedente di un pronome si trova nella domanda precedente e non nella risposta; e le risposte sono dense di marcatori web come `[https://ingegneria.unifi.it/… · 2026-08-22]`, che dopo tre turni trascinerebbero verso `unifi_web` qualunque domanda nuova, anche di corso.

### 3. Trascrizione al posto della risposta: un bucket nuovo per la tassonomia

Al secondo turno il modello non ha redatto una risposta: ha **ricopiato l'estratto recuperato**, aprendo il proprio output con `[Excerpt 1] Ingegneria Informatica (INM 270/04) (INF PO INS 509/99) …` e proseguendo con la trascrizione integrale della riga di calendario, comprese le sigle amministrative. Il contenuto è corretto e pertinente; ciò che manca è l'atto di rispondere — nessuna selezione della data che riguarda lo studente, nessuna frase.

Il difetto è **distinto** da quello registrato il 2026-08-21 e il 2026-08-25 sotto «conformità dei marcatori di citazione», benché ne condivida il sintomo superficiale `[Excerpt N]`. Là il modello scriveva una risposta e sbagliava il marcatore; qui non scrive una risposta affatto. Si registra quindi come bucket autonomo della tassonomia degli errori di M3: **trascrizione al posto della risposta**, ipotesi da verificare che il fattore scatenante sia la combinazione fra turno di follow-up brevissimo (una constatazione, non una domanda) e contesto tabellare fittamente strutturato.

L'interfaccia ne attutisce metà per costruzione: le schede delle fonti sono renderizzate dai metadati di recupero e non dal testo del modello, decisione presa il 2026-08-21 proprio a fronte dell'inaffidabilità dei marcatori. La metà restante — un turno che non risponde — resta visibile allo studente e appartiene alla generazione.

### Riproducibilità

Sessione condotta su `127.0.0.1:8000` con `DEBUG=True`; PostgreSQL 18 via `docker compose up -d` (senza profilo: soltanto i servizi con stato), Django e `rag/` sul sistema ospite sotto `uv run` per l'accesso alla GPU. Collezione `unifi_web` a 29098 punti, `slides` a 1234. Modelli: Qwen3-Embedding-0.6B e reranker Qwen3-0.6B su CUDA, LLM `qwen3:4b-instruct-2507-q4_K_M` via Ollama, `temperature=0.0`, `seed=0`. Le decisioni di instradamento citate provengono dal registro della console di `just serve`.

## 2026-08-25 — Interrogazione via HTTP, conformità delle citazioni, limite della macchina locale

### 1. Il percorso interlinguistico regge end-to-end sull'endpoint

Con l'endpoint `POST /api/ask` (non in streaming, `apps/qa/`) la catena instradamento → recupero → generazione è stata percorsa per la prima volta da un client esterno al terminale. Tre lingue, corpus campus (italiano):

| Domanda | `locale` rilevato | Instradamento | Esito |
| --- | --- | --- | --- |
| «学费什么时候交？» | `zh` | `unifi_web` | query riscritta in cinese («学费缴纳时间»), 5 excerpt recuperati |
| «Quando si pagano le tasse universitarie?» | `it` | `unifi_web` | risposta completa e corretta |
| c003 · c008 · c018 (cinese, `gold/campus.jsonl`) | `zh` | `unifi_web` | risposte fluenti in cinese |

**La capacità centrale della tesi — domanda in una lingua qualsiasi, corpus in italiano, risposta nella lingua della domanda — risulta quindi verificata anche sul cinese**, non solo sull'italiano come nella voce del 2026-08-21.

Una sola domanda degenera in modo riproducibile: «学费什么时候交？» produce l'output `[febbraio]` (due esecuzioni identiche) pur avendo recuperato gli stessi 5 excerpt che, interrogati in italiano, danno una risposta corretta. Il difetto è quindi nella generazione e non nel recupero, ed è specifico della coppia (domanda breve, lingua cinese): le altre tre domande cinesi non lo mostrano. Voce per la tassonomia degli errori di M3, non un difetto dell'endpoint.

### 2. La conformità del marcatore di citazione è il problema sistematico

Il prompt di generazione (`rag/answer.py`) dedica tre righe a imporre la copia **carattere per carattere** del marcatore fra parentesi quadre. In nessuna delle esecuzioni reali di questa giornata il modello vi si è attenuto:

| Lingua della domanda | Corpus | Ciò che il modello ha scritto |
| --- | --- | --- |
| inglese | slides | `[Excerpt 1]` |
| italiano | campus | `[Excerpt 1][Excerpt 3][Excerpt 4][Excerpt 5]` |
| cinese | campus | collegamenti markdown, es. `[毕业学期日历](p602.html)` |

Il campo `cited` del contratto di risposta (`apps/qa/contract.py`) è un test di sottostringa letterale e riporta di conseguenza `false` su tutte le citazioni: **il campo non è difettoso, sta contando onestamente**. Ne discende una metrica di fedeltà delle citazioni già pronta per M3.

La correzione (prompt o dimensione del modello) è deliberatamente **rinviata**: il prompt di generazione fa parte della catena della rimisurazione autogrow, e modificarlo ora aggiungerebbe una variabile a una misura il cui scopo è isolarne altre due.

### 3. La macchina locale non può ospitare la rimisurazione autogrow

Tentativo di rieseguire il braccio principale del collaudo autogrow (protocollo della voce 2026-08-24, `run_id` `live-retest-main`). Pre-test pulito: **0/7**, collezione a 29098 punti. L'esecuzione è stata interrotta durante la seconda domanda:

| Fase | Misura |
| --- | --- |
| g001 | risponde al passo 0 senza alcun fetch — comportamento **invariato** dopo le due correzioni, come atteso (correggevano la scelta forzata e il grafo cieco, non la saturazione del giudizio); risposta corretta, cita il modulo RIT_02, ma il punteggio per URL la marca MISS |
| g002 | encoding denso su CPU: un batch da **293,30 s/it** (19 min 33 s per 4 batch) e uno da 55,93 s/it; oltre 25 minuti spesi senza avvicinarsi alla fine delle sette domande |

Il batch anomalo da 1470 s registrato il 2026-08-24 come «probabile throttling termico» **non è un'anomalia ma il regime normale** di questa macchina. La stima di «circa due ore per braccio» è quindi errata e il costo reale non è limitato superiormente.

Nessuna scrittura ha raggiunto la base di conoscenza: `unifi_web` è rimasta a 29098 punti e i punti con `ingest_run_id='live-retest-main'` sono **0** (g001 non ha acquisito nulla; dei due fetch di g002 uno è risultato invariato dal crawl e l'altro è stato rifiutato dal gate). Nessun rollback necessario.

**Conseguenza operativa**: le misurazioni che coinvolgono l'LLM passano al server MICC; la macchina locale resta destinata allo sviluppo e alle verifiche funzionali. La separazione è resa possibile dal vincolo architetturale per cui `rag/` non importa Django ed è eseguibile fuori dal web. Decisioni registrate in [decisioni.md](decisioni.md), voce del 2026-08-25 «测量场地划线».

### 4. Passaggio allo streaming SSE: due vincoli non evidenti

`POST /api/ask` è stato convertito a **server-sent events** e non possiede più una forma non in streaming: la generazione dura decine di secondi, e un client che le attende in silenzio è precisamente il difetto che lo streaming rimuove. Il flusso è un evento `start` (lingua, decisione di instradamento, excerpt di ancoraggio), un evento `token` per ogni frammento generato e un evento `end` conclusivo — la cui assenza è il segnale di fallimento.

Due vincoli sono emersi durante l'implementazione e vanno registrati perché condizionano il capitolo architetturale.

**Il codice di stato esiste solo prima del primo byte.** Le intestazioni della risposta partono insieme al primo evento: un endpoint di generazione che muore a metà risposta non può più diventare un 503. Il generatore del motore viene quindi *innescato* esplicitamente nella vista (una prima `next()`), affinché instradamento e recupero avvengano finché una risposta di stato è ancora disponibile; ciò che fallisce dopo viaggia come evento `error` dentro un 200 già impegnato. Il confine è verificabile in entrambe le direzioni: un modello mai scaricato (404 dal server durante l'instradamento) resta un 503, un endpoint di generazione spento produce la sequenza `["start", "error"]`.

**Il corpo della risposta non può essere un generatore.** Il lucchetto che serializza le risposte (una sola GPU, un solo indice embedded) viene preso quando la vista innesca il flusso e restituito quando il flusso viene chiuso. Django chiude la risposta quando il client se ne va — ed è esattamente il caso in cui un generatore non funziona: chiudere un generatore **mai iterato** non esegue nulla, perché il suo corpo non è mai partito e non ha alcun `finally` da eseguire. Un lettore che chiudesse la connessione senza leggere un solo byte lascerebbe il lucchetto preso, e da quel momento ogni domanda successiva riceverebbe 503. Il corpo della risposta è quindi una classe con un `close()` esplicito.

La verifica è stata condotta in modo avversariale: reintroducendo la versione a generatore, il test `test_a_client_that_never_reads_a_byte_releases_the_lock` fallisce riportando `<locked _thread.lock object>`, mentre il test complementare — lettore che si interrompe *dopo* il primo frammento — continua a passare. I due casi sono distinti e servono entrambi.

Effetto collaterale utile: poiché la chiusura si propaga fino al generatore sospeso in `rag/answer.py`, **un lettore che se ne va annulla anche la generazione**; la coda passa immediatamente alla domanda successiva invece di far scrivere il modello per nessuno.

Nota su DRF: la negoziazione del contenuto avviene *prima* dell'esecuzione del gestore (`APIView.initial`). Senza un renderer che dichiari `text/event-stream`, l'endpoint rifiuterebbe con 406 un client che chiede l'unico tipo di media che l'endpoint parla. Il renderer aggiunto serve solo alla negoziazione: la risposta riuscita non lo attraversa mai.

Conseguenza sul contratto: il campo `cited` è stato rimosso dalle citazioni. Un marcatore viene regolarmente spezzato fra due eventi `token`, quindi il test di sottostringa è significativo solo sulla risposta ricomposta — che è ciò che il client possiede, insieme al marcatore. La metrica di fedeltà delle citazioni annunciata nella sezione 2 non scompare ma cambia sede: appartiene al percorso di valutazione di M3 (`rag/`, dove girano i gold set), non all'API.

### Riproducibilità

Endpoint: `uv run python manage.py runserver`, quindi `POST /api/ask` con corpo JSON codificato **esplicitamente in UTF-8** (`Invoke-RestMethod` di Windows PowerShell 5.1 codifica in ASCII un corpo stringa quando il `Content-Type` non dichiara il charset: le domande cinesi arrivavano al server come `????????` e venivano di conseguenza instradate su `both` con `locale=en`). Pre-test autogrow: `uv run python -m rag.gold gold/campus-autogrow.jsonl --live on`. Modelli invariati rispetto alla voce precedente: Qwen3-Embedding-0.6B, reranker Qwen3 0.6B, LLM `qwen3:4b-instruct-2507-q4_K_M` via Ollama, `temperature=0.0`.

## 2026-08-24 — M2.5b: gate di rilevanza, ciclo di approfondimento, collaudo autogrow

### 1. Gate di rilevanza: 15/20 → 18/20 senza toccare le etichette

Il gate LLM (Qwen3-4B q4, giudizio binario JSON, `temperature=0.0`, `seed=0`) è stato misurato contro un insieme di annotazione di 20 URL **congelato con un commit dedicato prima di ogni misurazione** (`gold/relevance-gate.jsonl`, 10 rilevanti + 10 non rilevanti, tratti dal grafo dei link non ancora acquisiti): la disciplina «prima si congela il metro, poi si misura» esclude per costruzione l'aggiustamento delle etichette a posteriori.

- **Prima misurazione: 15/20.** Analisi dei cinque disaccordi: due falsi negativi sistematici (calendari TOLC rifiutati perché nominano altri atenei toscani), un falso positivo sistematico (piattaforma commerciale di alloggi che si autodefinisce «servizio ufficiale»), un caso di design (PDF giudicabile solo dal nome file), due casi di confine discutibili.
- **Interventi — solo sul gate, mai sulle etichette**: due regole aggiunte al prompt di sistema (i servizi studenteschi su scala regionale toscana — DSU, CISIA/TOLC — servono anche gli studenti UniFi; il test dell'operatore: istituzione che pubblica informazione propria vs. azienda che vende) e un'anteprima testuale per i PDF (`pypdf`, prima pagina, solo text layer: una sbirciata, non un parsing — il costo del pipeline classico non è pagabile prima del gate).
- **Seconda misurazione: 18/20 ≥ 18 (soglia).** Una sola iterazione di revisione. I due disaccordi residui sono i casi di confine già noti: la rubrica telefonica interna (etichetta: rilevante; gate: non rilevante) e la pagina di accesso a Tesi Online (contro-esempio «hard negative»; il gate si lascia convincere dal nome del servizio).

Con decodifica greedy e seed fissato, la misura ripetuta produce verdetti identici (verificato anche per il report di routing, eseguito due volte con esito identico); l'accordo del gate non poggia quindi sulla fortuna del campionamento.

### 2. Budget di memoria video e di tempo (RTX 4070 Laptop, 8 GB)

- **Picco VRAM durante l'intero collaudo: 7923 MiB < 8188**, incremento di **+162 MiB** sul baseline 7761 di M2 (< 200 consentiti). Campionamento `nvidia-smi -l 1`: la risoluzione di 1 Hz può in linea di principio perdere picchi sub-secondo, il margine residuo (265 MiB) copre questa incertezza.
- **Parsing PDF su CPU**: il PDF più grande del corpus (18,4 MB, cap a 40 pagine, pipeline classic) richiede **68,8 s / 65,9 s** su due esecuzioni. Il budget di parsing è stato quindi separato dall'orologio di passo (60 s) e fissato a **120 s** (`PDF_PARSE_TIMEOUT_SECONDS`): un parsing tenuto dentro i 60 s renderebbe non archiviabili esattamente i documenti lunghi (decreti) per cui il livello live esiste. Nel collaudo il parsing reale ha toccato al massimo 46,6 s.
- **Encoding denso su CPU, fuori dall'orologio di passo**: 13 chunk ≈ 77 s, 18 chunk ≈ 117 s; un batch anomalo da **1470 s** (24,5 min, probabile throttling termico) non ha prodotto alcun falso timeout — conferma empirica della scelta di non contare parsing/encoding nel budget di passo (contarli avrebbe marcato «perso» ogni inserimento riuscito).
- **Orologio di passo (60 s)**: copre le quattro attese di rete/LLM (giudizio «basta per rispondere?», scelta del candidato, fetch, gate); il ricaricamento del modello dopo lo scarico (`OLLAMA_KEEP_ALIVE=0`) cade per costruzione sulla prima chiamata LLM del passo successivo ed è quindi **incluso** nel budget. Tetto per singola richiesta LLM: 30 s (il default SDK di 10 minuti renderebbe fittizio qualunque budget).

### 3. Collaudo autogrow: 0/7 su entrambi i bracci (obiettivo ≥ 5/7 non raggiunto)

Protocollo (KB riportata allo stato di snapshot prima di ogni braccio; un solo `run_id` per braccio, rollback in un comando):

1. pre-test `--live on`: **0/7** (baseline pulita: nessuna delle 11 pagine-risposta è nello snapshot);
2. sette domande end-to-end (`rag.agent`, `--question-id` per l'attribuzione, `--run-id live-stage9-autogrow`);
3. post-test `--live on`: **0/7**; rollback (33 punti rimossi → 29098);
4. braccio degradato `--no-deepen` (`live-stage9-nodeepen`): post-test **0/7**; rollback (31 punti → 29098).

| Domanda | Braccio principale | Braccio `--no-deepen` | Attribuzione |
| --- | --- | --- | --- |
| g001 | risponde al passo 0, nessun fetch | identico | **saturazione del giudizio**: il testo della pagina indice (moduli-e-certificati) basta al 4B; la risposta è corretta e cita il modulo RIT_02, ma il PDF bersaglio non viene mai acquisito — il punteggio per URL e la qualità della risposta divergono |
| g002 | 3 passi, 2 rifiuti del gate corretti, 1 pagina irrilevante | pool di candidati vuoto | perdita di contesto («Annex 1» senza il bando di riferimento); i top hit sono PDF, che non portano out-link |
| g004 | 3 pagine tasse/ISEE persistite (21 chunk), non quelle bersaglio | 3 PDF irrilevanti | **scelta forzata**: il modello dichiara «nessun candidato è pertinente… ma dovendo sceglierne uno» — il prompt di scelta non prevede l'opzione «nessuno» |
| g005 | 2 pagine adiacenti + 1 rifiuto corretto (piattaforma commerciale) | pool vuoto | pagine semanticamente vicine ma diverse da quella d'oro |
| g006 | gate rifiuta la pagina degli organi di governo → ephemeral → **risposta corretta e completa** | 3 PDF fuori tema | il criterio «servizi agli studenti» del gate non copre le domande di governance; il ramo ephemeral mantiene la promessa di Stage 7 (l'errore del gate costa alla KB, non alla risposta) |
| g007 | pool vuoto | identico | i top hit sono guide PDF: nessun out-link nel registro → grafo cieco |
| g008 | instradata su `slides` | identico | errore di routing (domanda campus classificata come materiale di corso) |

**L'uguaglianza dei due bracci è essa stessa il risultato**: il fallimento non dipende dal salto di link (l'unica variabile progettata tra i bracci, con la nota che i bracci differiscono di fatto anche nel troncamento top-5), ma da quattro colli di bottiglia a monte — saturazione del giudizio di sufficienza, scelta forzata senza opzione di rifiuto, instradamento errato, criterio del gate disallineato sulle domande di governance. Questi quattro, più il grafo cieco dei PDF, costituiscono lo scheletro della tassonomia degli errori di M3.

L'infrastruttura risulta invece interamente validata sul campo: il gate ha rifiutato correttamente 4 candidati inadatti in produzione; il log incrementale a tre stati ha classificato onestamente ogni scrittura (6 × `first fetch`, 6 × `content changed`, nessun salto errato); i due rollback hanno riportato la collezione esattamente a 29098 punti; l'isolamento di lettura ha retto (campus 28/32 **con** 33 punti live in collezione).

### 4. Regressioni finali (stato post-rollback, collezione a 29098 punti)

| Insieme | Esito | Invariante |
| --- | --- | --- |
| campus (32 domande) | **28/32 = 88%** (EN 92% · IT 85% · ZH 86%) | MISS identici: c003 · c011 · c012 · c034 |
| smoke slides (40) | **38/40 = 95%** | MISS identici: q018 · q028 |
| controllo (5) | **5/5 = 100%** | — |

Lo snapshot non è stato intaccato da due esami completi con scritture live e rollback: la dualità lettura/scrittura (filtro `ingest_source` nei rami prefetch; cancellazione vincolata a `(url, ingest_source)`) è verificata end-to-end.

### Riproducibilità

**Configurazione misurata**: tutte le cifre di questa voce provengono dal commit `ee15f37`; entrambi i bracci hanno girato sullo stesso albero (nessuna modifica al codice tra i due esami). Successivamente, **senza rimisurazione**, sono stati corretti due difetti di progettazione che l'esame stesso ha portato alla luce: la scelta del candidato ammette ora il rifiuto esplicito («nessuno dei candidati può contenere la risposta»), e i candidati vengono risaliti dal `referrer_url` quando gli hit di retrieval sono PDF privi di out-link. Entrambe le correzioni si giustificano per conto proprio — una scelta forzata scrive nella base di conoscenza condivisa pagine che il modello stesso dichiara irrilevanti; un grafo cieco preclude l'approfondimento a un'intera classe di domande — ma **il loro effetto sul punteggio non è misurato**. La rimisurazione è rimandata a M3 sulla griglia dimensionale: nel confronto con lo 0/7 qui riportato andranno quindi tenute presenti due variabili cambiate insieme (correzioni e dimensione del modello).

Gate: `uv run python -m rag.live --measure-gate` (annotazioni in `gold/relevance-gate.jsonl`). Esame: `uv run python -m rag.agent "<domanda>" --question-id gNNN --run-id live-<id>` per le sette domande di `gold/campus-autogrow.jsonl`; punteggio con `uv run python -m rag.gold gold/campus-autogrow.jsonl --live on`; rollback con `uv run python -m rag.live --rollback <run_id>`. Log decisionale per domanda in `data/webcorpus/decisions.jsonl` (fuori repository). Modelli: Qwen3-Embedding-0.6B (CPU per il ramo live), reranker Qwen3 0.6B, LLM `qwen3:4b-instruct-2507-q4_K_M` via Ollama, `temperature=0.0`, `seed=0`.

## 2026-08-21 — Indicizzazione completa del corpus, gold set esteso, generazione locale

### 1. Espansione dell'indice: da 4 a 31 slide deck

L'intero corpus PPM (31 PDF, ~1200 pagine) è stato convertito e indicizzato in locale (GPU RTX 4070 Laptop, 8 GB):

| Fase | Comando | Esito |
| --- | --- | --- |
| Parsing | `just parse data\corpus\PPM` | 31/31, ~15 min |
| Chunking | `just chunk data\parsed` | 31/31, **1234 chunk** |
| Indicizzazione | `just index data\chunks` | collection `slides`, count = 1234 |

Il routing adattivo ha confermato la distribuzione prevista dalla fase di probing: 26 file `classic`, 4 `classic-formula`, 1 `classic-ocr`. Il tempo di parsing è risultato molto inferiore alla stima iniziale (~1 h): i modelli di layout girano su CUDA e il motore OCR selezionato da Docling (RapidOCR/onnxruntime) è di un ordine di grandezza più rapido della misurazione precedente con EasyOCR (527 s per il deck `3.5-HTML5-Part-2`).

### 2. Valutazione del retrieval: gold set 40 domande + gruppo di controllo

Il gold set di fumo è stato esteso da 2 a **40 domande** (copertura stratificata dei 31 deck; bozza generata da LLM a partire dai chunk e verificata manualmente contro le fonti citate). Metodologia anti-inflazione: un **gruppo di controllo** di 5 domande è stato redatto direttamente dai PDF originali, senza consultare i chunk, per misurare l'eventuale «lexical leakage» tra formulazione della domanda e testo indicizzato.

| Insieme | hit@5 (rerank attivo) |
| --- | --- |
| smoke (40 domande, EN→EN) | **38/40 = 95%** |
| controllo (5 domande) | **5/5 = 100%** |

Il gruppo di controllo non ottiene risultati inferiori al gruppo principale: non è quindi misurabile un'inflazione da leakage lessicale, e il 95% è considerato attendibile. I due errori sono «near miss» istruttivi per la tassonomia degli errori (M3): `q018` (media query) recupera il deck corretto ma una pagina adiacente semanticamente sovrapposta; `q028` (forma exec di CMD) subisce la concorrenza tra i due deck Docker, i cui contenuti si sovrappongono.

Osservazione collaterale: il testo estratto dai PDF contiene rumore tipografico (`E XAM G RADING`, `c1ass`, `handleerrors`) che penalizza il richiamo lessicale BM25; il ramo denso ne è immune. Da approfondire in M3.

### 3. Generazione locale con Ollama (Qwen3-4B instruct, q4_K_M)

Prima verifica end-to-end della catena retrieval → generazione interamente in locale (endpoint OpenAI-compatibile, `just answer`):

- **Groundedness**: le 8 risposte di prova sono risultate corrette e aderenti agli estratti recuperati; nessuna allucinazione di contenuto osservata.
- **Aderenza linguistica**: domanda in italiano → risposta in italiano (requisito «stessa lingua della domanda»).
- **Rifiuto fuori dominio**: a una domanda estranea al corso (Kubernetes ingress) il modello risponde correttamente che gli estratti non contengono l'informazione, senza inventare.
- **Fedeltà dei marcatori di citazione — problema riscontrato**: il modello a 4B quantizzato non ricopia in modo affidabile i marcatori `[file p.N]` nel corpo della risposta: li abbrevia, scrive `[Excerpt N]`, o (prima della correzione) ricopiava il nome di file **d'esempio** contenuto nel prompt di sistema. La correzione del prompt (rimozione dell'esempio, istruzione di copia letterale) elimina i nomi inventati ma non garantisce la copia integrale. Conclusione operativa: la lista «Sources» generata dal codice a valle del retrieval è l'unica fonte affidabile di citazione; l'interfaccia web (M5) dovrà renderizzare le citazioni dai metadati di retrieval, non dal testo del modello. La fedeltà dei marcatori diventa una variabile del confronto dimensionale 0.6B/4B/8B (M3).
- **Memoria video**: picco misurato **7761 / 8188 MiB** durante una risposta (encoder denso Qwen3-Embedding-0.6B in **bfloat16** ≈ 1,2 GB + reranker fp16 ≈ 1,2 GB + LLM q4 ≈ 2,6 GB + attivazioni). La coesistenza dei tre modelli su 8 GB è quindi possibile ma al limite: tra una domanda e l'altra il modello Ollama va scaricato (`ollama stop …` o `OLLAMA_KEEP_ALIVE=0` lato server), altrimenti la residenza di default (5 min) causa OOM alla domanda successiva.

### Riproducibilità

Indice ricostruito da zero nella collection `slides` (Qdrant embedded, `data/qdrant/`); gold set versionato in `gold/smoke.jsonl` e `gold/control.jsonl`; risposte di riferimento (estratti coperti da copyright) fuori dal repository in `data/gold/answers/`. Modello di generazione: `qwen3:4b-instruct-2507-q4_K_M` via Ollama 0.32.15, endpoint `http://localhost:11434/v1`.
