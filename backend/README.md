# CEX paper exchange

This repository contains a simulated spot and USDT-margined perpetual exchange. It uses PostgreSQL for accounts, balances, orders, fills, positions, funding payments, and liquidations; the price/time-priority order book is held in memory and restored from open orders at startup.

## Requirements

- Bun 1.3+
- PostgreSQL

Create `backend/.env` (see `.env.example`) and configure a PostgreSQL database. Then run:

```bash
cd backend
bun install
bun run db:generate
bun run db:migrate
bun run dev
```

In another terminal:

```bash
cd frontend
bun install
bun dev
```

The React app is available at `http://localhost:5173`; the API listens on port `3000` by default. Vite proxies `/api` requests to the backend. Set `VITE_API_URL` to an API origin only if the frontend and backend are hosted separately; configure `FRONTEND_ORIGIN` on the backend to match the browser origin.

## Trading behavior

- New demo accounts start with 100,000 USDT, 1 BTC, and 10 ETH.
- BTC-USDT and ETH-USDT have synthetic demo liquidity around fixed startup reference prices. This liquidity and all balances are simulated; no real exchange or custody system is connected.
- Spot supports market/limit buy and sell, balance reservation, partial fills, cancellation, and persisted fills.
- Perpetuals use isolated USDT margin, 1–20× leverage, a 0.5% maintenance margin rate, mark-price liquidations, and a fixed positive funding rate of 0.01% every eight hours. Positions can be closed at the latest perp trade price.
- Market orders may partially fill; any unfilled remainder is cancelled. Limit remainders remain on the book.
- Amounts and prices are stored to eight decimal places. This project is a learning/demo implementation, not production exchange software.

Run backend checks with `bun run typecheck` and `bun test`; build the UI with `cd frontend && bun run build`.
