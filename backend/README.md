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

- The market screen uses Binance's public, no-key REST API for spot or USDⓈ-M perpetual candles, 24-hour ticker data, and reference order-book depth. Data refreshes every 15 seconds; Binance is read-only and receives no account or order information.
- Orders are paper trades matched against the local simulated order book, not Binance. The UI labels Binance prices and depth as reference data to keep this distinction clear.
- BTC-USDT, ETH-USDT, SOL-USDT, BNB-USDT, XRP-USDT, ADA-USDT, and DOGE-USDT are available for spot and perpetual paper trading. Startup synthetic liquidity is centered on Binance spot reference prices when reachable, with configured demo prices as a logged fallback.
- New demo accounts start with 100,000 USDT and demo BTC, ETH, SOL, BNB, XRP, ADA, and DOGE balances. The market-expansion migration grants the new demo assets to existing accounts without changing balances they already hold. All balances are simulated; no real exchange or custody system is connected.
- Spot supports market/limit buy and sell, balance reservation, partial fills, cancellation, and persisted fills.
- Perpetuals use isolated USDT margin, 1–20× leverage, a 0.5% maintenance margin rate, mark-price liquidations, and a fixed positive funding rate of 0.01% every eight hours. Positions can be closed at the latest perp trade price.
- Market orders may partially fill; any unfilled remainder is cancelled. Limit remainders remain on the book.
- Amounts and prices are stored to eight decimal places. This project is a learning/demo implementation, not production exchange software.

Run backend checks with `bun run typecheck` and `bun test`; build the UI with `cd frontend && bun run build`.
