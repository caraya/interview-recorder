# Fieldnote

An interview recorder built with React, TypeScript, Vite, Deepgram live speech-to-text, and **PostgreSQL through Drizzle ORM**. Interview metadata, notes, plain-text transcripts, and structured speaker segments live in PostgreSQL. Audio recordings live on the app server's disk.

## Run locally

Requires Node.js 24+, PostgreSQL 16+ (or Docker Compose), and a Deepgram key with speech-to-text access and credits.

```sh
npm install
cp .env.example .env
# Set your DEEPGRAM_API_KEY. The example DATABASE_URL matches Compose below.
docker compose up -d --wait postgres
npm run db:migrate
npm run dev
```

Open **http://127.0.0.1:9999**. Vite uses port 9999 with strict port binding and proxies HTTP/WebSocket `/api` traffic to the loopback API server on port 3001. The API key and database URL remain on the server.

Already running PostgreSQL? Create a dedicated database, set `DATABASE_URL` to its connection string, skip Compose, and run migrations. Do not point development or tests at an unrelated database. Compose uses a project-specific named volume and binds PostgreSQL only to `127.0.0.1:55432`; its example credentials are for local development, not production.

| Environment variable | Purpose |
| --- | --- |
| `DEEPGRAM_API_KEY` | Server-side Deepgram authentication |
| `DATABASE_URL` | PostgreSQL connection string; required for interview storage |
| `AUDIO_STORAGE_DIR` | Server audio directory; defaults to `data/audio`, relative to the project root |
| `PORT` | API/built-app port; defaults to 3001. Update Vite's proxy if changed |

Restart the server after changing environment variables. Missing database configuration or unapplied migrations are reported explicitly; the app does **not** silently fall back to browser storage. Settings shows database status and provides a library refresh action.

For a built application:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:3001`. `npm run preview` serves only the static UI on 9999; use `npm start` for the complete built app.

## Interview workflow

1. Check PostgreSQL and Deepgram status in Settings.
2. Name the interview, optionally add a project, choose a language, and confirm everyone's consent.
3. Start recording and allow microphone access. View live speaker-labeled transcription and add notes.
4. Pause/resume as needed, then finish to save audio and transcript to the server.
5. Reopen interviews for playback, notes, stars, and TXT/JSON/audio export. Search names, projects, notes, and transcripts.

Failed uploads retain the interview in memory with retry and backup export. Keep the page open until saved or exported. Successful saves survive browser data clearing and app restarts, provided PostgreSQL and the audio directory persist.

### Import previous browser interviews

In Settings, choose **Import existing browser interviews**. Import reads the old IndexedDB library at the current browser origin and uploads it to PostgreSQL. Originals remain untouched. Client-generated IDs make retries safe: existing server interviews are retained without overwriting later notes or stars.

IndexedDB data is origin-specific. Interviews previously recorded on a different port or hostname must be imported from that original origin (temporarily run the frontend there with the same API proxy). Import is explicit, not automatic.

## Storage and migrations

- `server/db/schema.mjs` defines the Drizzle PostgreSQL schema.
- `drizzle/` holds generated, versioned SQL migrations and schema snapshots.
- `npm run db:generate` generates migrations after schema changes; review the SQL.
- `npm run db:migrate` applies pending migrations using `DATABASE_URL`; migration tracking prevents reapplication.
- A scoped package override keeps Drizzle Kit's legacy `@esbuild-kit/core-utils` dependency on patched esbuild 0.25.x. Migration generation is validated with this override.
- The `interviews` table stores UUID, title, project, timestamps, duration, model/language, starred flag, notes, rendered transcript text, JSONB speaker segments, and server-generated audio filename/type/size. Created-at is indexed.
- Audio filenames are server-generated, files are outside the public web root, and playback supports HTTP byte ranges. Uploads are limited to **256 MiB per request**, including metadata, and are buffered in memory in this initial single-user backend.
- Audio is written before the database insert; failed inserts clean up their file. Retried uploads keep the existing row and remove the duplicate file. Deletion removes the row and then its recording; any filesystem cleanup failure is logged and reported to the UI.
- Filesystem and PostgreSQL writes are not a distributed transaction. A process crash between operations can leave orphan files. Back up PostgreSQL and the audio directory together; do not independently discard or relocate files while the app is running.
- pgvector/embeddings and semantic search are intentionally deferred. Original transcript text and JSONB segments are available for adding them later.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/status` | Deepgram configuration and live database/schema status |
| GET | `/api/interviews` | List interviews, including transcript text/segments (not audio bytes) |
| POST | `/api/interviews` | Multipart `metadata` JSON and `audio` file; idempotent by interview UUID |
| GET | `/api/interviews/:id` | Fetch one interview |
| PATCH | `/api/interviews/:id` | Update title, project, notes, and/or starred |
| DELETE | `/api/interviews/:id` | Delete interview and audio |
| GET/HEAD | `/api/interviews/:id/audio` | Audio playback/download, with byte-range support |
| WebSocket | `/api/listen?model=…&language=…` | Live Deepgram streaming relay |

Writes require an `Origin` matching the request host. Payloads are validated with Zod, database queries use Drizzle parameters, and database errors are surfaced instead of returning an empty successful library. The library currently fetches all transcript metadata and filters/searches on the client.

## Recording and privacy

The browser captures **microphone audio only**, not system audio or remote-call participants automatically. MediaRecorder sends WebM/Opus or MP4 container chunks every 250 ms. Deepgram detects the container; raw audio encoding/sample-rate options are intentionally omitted.

Live streaming defaults to Nova-3, with smart formatting, diarization, and interim results. Nova-2 is available. Only final results are saved. KeepAlive maintains paused connections, and finishing sends CloseStream after the last audio chunk and waits for final results. Network errors preserve captured audio; finalization timeouts are reported.

Audio is sent to Deepgram and is subject to its data handling policy and usage pricing. Recordings, notes, and transcripts are then saved on your configured server/database, **not only in the browser**. Anyone with access to this single-user app can access its library.

The API is bound to loopback and is **not an authenticated public service**. Before remote deployment add authentication, per-user authorization, rate limits, HTTPS, deployment-specific origin/host validation, and appropriate database/disk access controls and backups. Do not expose the local development credentials or server publicly.

Recording requires microphone permission and HTTPS or localhost. Current Chrome/Edge and Safari with supported audio containers are recommended. Automatic speaker numbers are estimates, not verified identities. Check Deepgram's [live streaming guide](https://developers.deepgram.com/docs/live-streaming-audio) and [model/language availability](https://developers.deepgram.com/docs/models-languages-overview).

## Validation

```sh
npm test
npm run lint
npm run build
```

The real PostgreSQL integration test requires a **dedicated test database** and applies migrations to it. It creates/removes only its own test interview IDs and uses a temporary audio directory:

```sh
docker compose exec postgres createdb -U fieldnote fieldnote_test
TEST_DATABASE_URL=postgresql://fieldnote:fieldnote_dev@127.0.0.1:55432/fieldnote_test npm run test:integration
```

Integration coverage includes database persistence, structured/plain transcripts, notes/stars, retry/import idempotency, audio retrieval/ranges, input validation, origin checks, deletion, and failed-write audio cleanup. Live transcription still requires a real Deepgram key and spoken microphone audio.
