# Local semantic search

Find files by what they show or are about — "birthday party", "people blowing
out candles", "invoice" — even when the file is called `IMG_0042.jpg`. Runs
entirely on this server with a local Ollama. Keyword search is never replaced.

## How it works

An embedding model reads **text**, not pixels. So each asset becomes one short
piece of *semantic text*, that text becomes one vector, and a search is one
more vector compared against those:

```
asset ──► semantic text ──► nomic-embed-text ──► stored vector
                 ▲                                     │
   images/videos: one-time local caption               ▼
                                 query ──► one embedding ──► cosine ──► hybrid ranking
```

- **Semantic text** (`buildAssetSemanticText`, `packages/shared/src/semantic-search.ts`)
  is the single definition, in priority order: title, caption, description,
  file name, document subject/author, `documentInsight` summary/keywords/topics,
  an existing transcript excerpt, folder and library, kind and duration, and a
  source's host name. Paths, ids, URLs and anything token-shaped are removed;
  the whole is capped at 2,000 characters.
- **Captions**: an image (or a video with a thumbnail) is described once by a
  local vision model found automatically (any installed Ollama model with the
  `vision` capability; `qwen3.5:0.8b` here) — but **only when its own words say
  nothing about it**: a camera name like `IMG_0042.jpg`, `DSC_1180.jpg` or
  `VID_0022.mp4` with no title, description or transcript. A titled photo, a
  descriptive file name or a video with a transcript is embedded without one,
  because a caption costs about a minute on a CPU-only host. The caption is
  stored on the index row, reused until the file itself changes, and seeded so
  the same picture always gets the same words. It is never written into the
  asset's title or description.
- **Vectors**: `nomic-embed-text`, 768 dimensions, stored unit-length as float32
  `BYTEA` (3,072 bytes) with the model name, the Ollama model **digest**, the
  index version and a fingerprint of the text.
- **Search** calls no vision model: one query embedding (cached), a dot
  product against vectors held in API memory, then the candidates go through
  the **same `buildVisibleAssetWhere`** as the listing — deleted assets, deleted
  or hidden folders, archive state, library/folder scope, media type, category
  and computer-backup ownership all apply exactly as for a keyword search.
  A locked folder is gated when it is opened, as for keyword search; meaning
  never reaches a file a keyword search would not.
- **Legacy Computer Backup files** are indexed like any other: the product is
  gone, but its files still appear in the Images/Videos/Music/Documents views
  and All Files for their owner, so they are searchable — by their owner only,
  by the same rule. On the production instance this is 10 files.

## Hybrid ranking

Literal matches keep their place in front — exact file name or title first,
then prefix, then contains — and semantic matches that are not already there
follow, strongest first. A vector hit never outranks a file you named. Results
found by meaning carry a word label ("Matched by meaning" / "Related by
meaning"), never a score.

If Ollama is stopped, the model is missing or a query embedding takes longer
than 4 s, the search returns its keyword results as always, with one quiet
line: *Semantic search unavailable — showing name matches.* If nothing is
indexed yet it says *Semantic index still building — showing name matches.*
Nothing ever blocks the search box.

## Threshold

`SEMANTIC_MIN_SIMILARITY = 0.62`, `SEMANTIC_STRONG_SIMILARITY = 0.70`, chosen by
measurement and re-measured for v1.1.2 on the integrated code
(`tests/semantic-live-ollama.test.ts`, controlled corpus in
`tests/fixtures/semantic-corpus.ts`: 18 assets, 18 queries, 324 pairs):

| threshold | recall | false hits |
|---|---|---|
| 0.55 | 92% (23/25) | 8 / 299 |
| 0.58 | 92% (23/25) | 4 / 299 |
| 0.60 | 88% (22/25) | 3 / 299 |
| **0.62** | **80% (20/25)** | **0 / 299** |
| 0.65 | 68% (17/25) | 0 / 299 |

At 0.62: 5 false negatives, 0 false positives, and every answerable query's
top result is right (15/15). The closest unrelated pair was 0.614
("graduation ceremony" against a wedding video), so a lower threshold starts
showing wrong files. Queries with nothing to find ("submarine", "tax return
1998") top out at 0.55 and return nothing.

The IMG_0042 acceptance example: "birthday party" 0.79 and "people blowing out
candles" 0.70 against its caption; "beach sunset" 0.48, "graduation ceremony"
0.54 and "red car" 0.45 — none of those reach it. End to end, a drawn birthday
scene with no words in it (`tests/semantic-live-caption.test.ts`) is captioned
locally as "a two-tiered pink cake with yellow candles … balloons … party hats,
and confetti" and found by "birthday party" at 0.64.

## Privacy

- Ollama **cloud** models (names ending `-cloud`/`:cloud`, or reported with a
  remote host) are listed by a local Ollama but run on ollama.com; they are
  never used for captions or embeddings, even if installed or preferred.
- Only an Ollama on this machine or its private network is ever contacted
  (`isLocalOllamaUrl`: loopback, RFC 1918/ULA/link-local, single-label names
  such as a Docker service). There is **no fallback** to any cloud provider.
- `ARCIIN_SEMANTIC_OLLAMA_URL` sets the address (default
  `http://127.0.0.1:11434`); a non-local value is refused.
- Captions and document text are never logged; failures are recorded as short
  codes (`OLLAMA_OFFLINE`, `MODEL_MISSING`, …).
- The settings routes are owner-only and return counts and model state only —
  never text, captions or vectors.

## Operating it

Settings → **Models** → *Semantic search*:

1. **Enable** — turns search-time use on. Nothing is indexed yet.
2. **Install model** — only if `nomic-embed-text` is missing; installs it into
   the local Ollama with Ollama's own progress. Never automatic.
3. **Index library** — the worker starts indexing (one asset at a time) and
   then keeps the index current as files arrive or change. **Pause** stops it
   straight away (anything already queued finishes without calling Ollama);
   **Index library** again resumes; **Rebuild** re-embeds everything.

Indexing is progressive — the cheapest meaning first, so search helps long
before the backlog is done: documents with real text, then titled or
described files, then audio/video with a transcript, then files whose caption
already exists, then name-only files, and last the photos and videos that need
a caption made.

Deploying Arciin never starts indexing and never installs a model.

The worker's sweep runs every minute, queues at most 40 assets ahead, skips
entirely while Ollama is unreachable (no retry storm), retries a failed asset
after 2, 4, 8, 16 minutes and gives up after 5 attempts. Unchanged assets are
skipped by fingerprint. A new model build (different digest) marks old vectors
stale: they are not compared with new ones and are re-embedded.

Deleting an asset deletes its index row (foreign key, `ON DELETE CASCADE`);
a soft-deleted asset keeps its row for Trash restore but is never returned.

### Resource settings

| variable | default | meaning |
|---|---|---|
| `ARCIIN_SEMANTIC_OLLAMA_URL` | `http://127.0.0.1:11434` | local Ollama |
| `ARCIIN_SEMANTIC_CAPTION_PX` | `256` | longest side of the image a caption is made from |
| `ARCIIN_SEMANTIC_OLLAMA_THREADS` | `2` | CPU threads a caption may use |

## Storage: why not pgvector (yet)

pgvector is **not installed** on the target PostgreSQL 18 and is available only
as an OS package (`postgresql-18-pgvector`), i.e. a production package change.
This release therefore stores vectors as `BYTEA` and scores them in the API,
which needs no extension and is fast enough for a personal library:

Measured on the target host (4 cores, 7 GB RAM, CPU-only Ollama 0.24). The
v1.1.2 re-run of the scan (`tests/semantic-benchmark.test.ts`, synthetic
768-d vectors) agrees with the original figures:

| | 100 | 1,000 | 10,000 | 100,000 |
|---|---|---|---|---|
| similarity scan per query (v1.1.2) | 0.2 ms | ~3–8 ms | 26 ms | 300 ms |
| vectors held in API memory | — | ~5 MB | ~33 MB | ~290–300 MB |
| database (table + TOAST + indexes) | — | 4.8 MB | 47.6 MB | ~476 MB (linear) |
| first load of vectors into memory | — | 14 ms | 75 ms | 1.3 s |

Hybrid merge of 200 literal + 60 semantic rows: under 1 ms.

Per asset: 768 × 4 = 3,072 bytes of vector, ~260 bytes of semantic text,
~180 bytes of caption, plus row overhead.

Indexing time (89 real assets on the dev stack, 60 of them captioned; the run
took 76.5 minutes, one asset at a time):

| step | time |
|---|---|
| caption an image (qwen3.5:0.8b, 256px, 2 threads) | median 63 s (v1.1.2 re-run: 58–65 s) |
| caption a video thumbnail | median 80 s |
| embed a text-only asset (document, code) | median 2.8 s |
| query embedding, idle / while captioning | ~1.0–1.3 s / ~2.1 s (v1.1.2: 1.04 s median) |
| repeated query (cached embedding) | ~0.02 s |

While indexing, Ollama used ~2.2 cores on average (peak 3.2) and up to 2.5 GB
of RAM (the vision model is unloaded two minutes after indexing stops); the
worker stayed under 60 MB and the API under 260 MB. The v1.1.2 re-run peaked
at 2.4 GB and ~2.5 cores for Ollama while captioning.

At the current production scale (~930 assets, ~500 of them camera-named
photos) a full first index is roughly 8–9 hours of background captioning plus
a few minutes of embeddings; documents and titled files are searchable within
the first minutes.

Brute force is the right tool up to roughly 10–20k indexed assets. Move to
pgvector when **any** of these holds: more than ~20,000 indexed assets, a
query scan above ~50 ms, or more than ~100 MB of vectors in the API process.

**Migrating to pgvector later** (owner-approved package install): `CREATE
EXTENSION vector`, add `embedding_v vector(768)`, backfill from the `BYTEA`
column, create an HNSW index (`vector_cosine_ops`), and move the candidate
query into SQL joined with the visibility `where`. The index rows, fingerprints
and versioning stay as they are.

## Production activation

The v1.1.2 deploy adds the tables and the code and leaves semantic search
**off**. To turn it on:

1. Settings → **Models** → *Semantic search* → **Enable**.
2. If the card says the model is missing, **Install model** and confirm.
3. **Index library**. The index builds in the background; search starts using
   it as soon as the first files are indexed.

## Troubleshooting

| what you see | why | what to do |
|---|---|---|
| *Semantic search unavailable* under the search box | Ollama stopped, model missing, or the query took over 4 s | `systemctl status ollama`; check the Models card; results by name keep working |
| *Semantic index still building* | enabled, nothing indexed for the current model build yet | press **Index library**, or wait for the first files |
| Card: **Ollama offline** | the API cannot reach `ARCIIN_SEMANTIC_OLLAMA_URL` | start Ollama; indexing resumes by itself |
| Card: **Not local** | the Ollama URL is not on this machine or network | set a local URL; a remote one is refused by design |
| Photos stay un-indexed while documents are done | photos need a caption and come last | expected; leave indexing running |
| A file keeps failing | recorded as a short code on its index row; retried after 2, 4, 8, 16 min, then left | check the worker log for the code (never the content) |
| Results changed after an Ollama update | a new model build (digest) makes old vectors stale | they re-embed automatically while indexing is on |
