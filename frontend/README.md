# CEX frontend

React + TypeScript trading UI for the simulated spot and perpetual markets.

Run the API from `../backend` and apply its PostgreSQL migrations, then start the UI:

```bash
bun install
bun dev
```

Vite proxies `/api` requests to `http://localhost:3000`. To use a separately hosted API, set `VITE_API_URL` to its origin and configure the backend's `FRONTEND_ORIGIN` to this app's browser origin.

Build and lint with `bun run build` and `bun run lint`.
