# AniFlow

AniFlow is a self-hosted LAN anime site built as a React frontend plus a Fastify backend. The current v1 integrates:

- `api.allanime.day` for search, metadata, episode discovery, and stream resolution
- Anime Skip for read-only intro/credits markers
- local SQLite persistence for continue-watching and history
- optional AniList connection for asynchronous progress sync
- a backend playback proxy so browser playback stays on the LAN host

## Local Development

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:4173`
- Backend: `http://localhost:8787`

## Production On The LAN

1. Copy `.env.example` to `.env`
2. Set `ANISKIP_CLIENT_ID`
3. Optionally set `ANIFLOW_APP_PASSWORD`
4. Optionally configure AniList OAuth env vars
5. Start the stack:

```bash
docker compose up --build -d
```

Then open `http://<your-lan-host>:8080`.

## Scripts

- `npm run dev` runs frontend and backend together
- `npm run build` builds both targets
- `npm run start` starts the compiled backend
- `npm run test` runs the current Vitest suite

## Notes

- The provider adapter is intentionally isolated in `server/src/services/provider`.
- Playback currently prefers direct provider sources when available and falls back to proxied HLS/media URLs.
- AniSkip uses the shared public client ID only when you do not provide your own; replace it for real use.
