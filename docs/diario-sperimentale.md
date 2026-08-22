# Diario sperimentale

Registro degli esperimenti e dei problemi riscontrati durante lo sviluppo, in italiano (stile formale): il contenuto confluirà nei capitoli sperimentali della tesi (M6). Una voce per data; i dati citati sono riproducibili con i comandi indicati. Le decisioni architetturali restano di proprietà di [architettura.md](architettura.md).

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
