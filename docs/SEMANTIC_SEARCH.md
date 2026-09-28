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
- **Captions**: images (and videos with a thumbnail) are described once by a
  local vision model found automatically (any installed Ollama model with the
  `vision` capability; `qwen3.5:0.8b` here). The caption is stored on the index
  row and reused until the file itself changes. It is never written into the
  asset's title or description.
- **Vectors**: `nomic-embed-text`, 768 dimensions, stored unit-length as float32
  `BYTEA` (3,072 bytes) with the model name, the Ollama model **digest**, the
  index version and a fingerprint of the text.
- **Search** calls no vision model: one query embedding (cached), a dot
  product against vectors held in API memory, then the candidates go through
  the **same `buildVisibleAssetWhere`** as the listing — deleted assets, deleted
  or hidden folders, archive state, library/folder scope, media type, category
  and computer-backup ownership all apply exactly as for a keyword search.

## Hybrid ranking

Literal matches keep their place in front — exact file name or title first,
then prefix, then contains — and semantic matches that are not already there
follow, strongest first. A vector hit never outranks a file you named. Results
found by meaning carry a word label ("Matched by meaning" / "Related by
meaning"), never a score.

If Ollama is stopped, the model is missing, the index is empty or a query
embedding takes longer than 4 s, the search returns its keyword results as
always, with one quiet line: *Semantic search unavailable — showing name
matches.*

## Threshold

`SEMANTIC_MIN_SIMILARITY = 0.62`, `SEMANTIC_STRONG_SIMILARITY = 0.70`, chosen by
measurement (`tests/semantic-live-ollama.test.ts`, controlled corpus in
`tests/fixtures/semantic-corpus.ts`: 18 assets, 16 queries, 288 pairs):

| threshold | recall | false hits |
|---|---|---|
| 0.55 | 90% | 7 / 267 |
| 0.58 | 90% | 3 / 267 |
| 0.60 | 86% | 2 / 267 |
| **0.62** | **86%** | **0 / 267** |
| 0.65 | 71% | 0 / 267 |

Every answerable query ranked the right asset first; unrelated pairs peaked at
0.609; queries with nothing to find ("submarine") topped out at 0.55.

## Privacy

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
   then keeps the index current as files arrive or change. **Pause** stops it;
   **Rebuild** re-embeds everything.

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

Measured on the target host (4 cores, 7 GB RAM, CPU-only Ollama 0.24):

| | 1,000 assets | 10,000 assets | 100,000 assets |
|---|---|---|---|
| database (table + TOAST + indexes, measured) | 4.8 MB | 47.6 MB | ~476 MB (linear, 4.9 KB/asset) |
| vectors held in API memory (measured) | ~5 MB | ~33 MB | ~286 MB |
| similarity scan per query (measured) | 2.8 ms | 27.5 ms | 287 ms |
| first load of vectors into memory | 14 ms | 75 ms | 1.3 s |

Per asset: 768 × 4 = 3,072 bytes of vector, ~260 bytes of semantic text,
~180 bytes of caption, plus row overhead.

Indexing time (89 real assets on the dev stack, 60 of them captioned; the run
took 76.5 minutes, one asset at a time):

| step | time |
|---|---|
| caption an image (qwen3.5:0.8b, 256px, 2 threads) | median 63 s |
| caption a video thumbnail | median 80 s |
| embed a text-only asset (document, code) | median 2.8 s |
| query embedding, idle / while captioning | ~1.0–1.3 s / ~2.1 s |
| repeated query (cached embedding) | ~0.02 s |

While indexing, Ollama used ~2.2 cores on average (peak 3.2) and up to 2.5 GB
of RAM (the vision model is unloaded two minutes after indexing stops); the
worker stayed under 60 MB and the API under 260 MB.

Brute force is the right tool up to roughly 10–20k assets. Beyond that, move
to pgvector:

**Migrating to pgvector later** (owner-approved package install): `CREATE
EXTENSION vector`, add `embedding_v vector(768)`, backfill from the `BYTEA`
column, create an HNSW index (`vector_cosine_ops`), and move the candidate
query into SQL joined with the visibility `where`. The index rows, fingerprints
and versioning stay as they are.
