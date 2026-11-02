import { useCallback, useEffect, useState, type FormEvent } from 'react'
import './App.css'

type MarketType = 'SPOT' | 'PERP'
type Side = 'BID' | 'ASK'
type Level = { price: number; quantity: number }
type Market = {
  name: string
  symbol: string
  baseAsset: string
  quoteAsset: string
  lastPrice: number
  perpLastPrice: number
  fundingRate: number
  nextFundingAt: string
  spotDepth: { bids: Level[]; asks: Level[] }
  perpDepth: { bids: Level[]; asks: Level[] }
}
type Balance = { asset: string; available: number; locked: number }
type Position = {
  symbol: string
  side: 'LONG' | 'SHORT'
  quantity: number
  entryPrice: number
  margin: number
  leverage: number
  liquidationPrice: number
}
type FundingPayment = { id: number; symbol: string; amount: number; rate: number; createdAt: string }
type Liquidation = { id: number; symbol: string; side: 'LONG' | 'SHORT'; quantity: number; price: number; loss: number; createdAt: string }
type Account = {
  user: { id: number; username: string; email: string }
  balances: Balance[]
  positions: Position[]
  fundingPayments: FundingPayment[]
  liquidations: Liquidation[]
  fills: AccountFill[]
}
type Order = {
  id: number
  symbol: string
  marketType: MarketType
  side: Side
  category: 'LIMIT' | 'MARKET'
  price: number | null
  volume: number
  remaining: number
  leverage: number
  createdAt: string
}
type Trade = { id: number; price: number; quantity: number; side: Side; createdAt: string }
type AccountFill = Trade & { symbol: string; marketType: MarketType; category: 'LIMIT' | 'MARKET' }
type Envelope<T> = { success: boolean; message?: string; details?: T; token?: string }
type CandleInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'
type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number }
type BinanceTicker = { lastPrice: number; priceChangePercent: number; highPrice: number; lowPrice: number; quoteVolume: number }
type BookLevel = Level & { cumulativeTotal: number }
type BinanceMarketData = {
  key: string
  ticker: BinanceTicker | null
  depth: { bids: Level[]; asks: Level[] } | null
  candles: Candle[]
  status: 'connected' | 'stale' | 'error'
  error: string
}

const API_BASE = import.meta.env.VITE_API_URL ?? ''
const BINANCE_HOSTS: Record<MarketType, string[]> = {
  SPOT: ['https://api.binance.com/api/v3', 'https://api1.binance.com/api/v3'],
  PERP: ['https://fapi.binance.com/fapi/v1', 'https://fapi1.binance.com/fapi/v1'],
}

async function binanceRequest(path: string, marketType: MarketType): Promise<unknown> {
  const errors: string[] = []
  for (const host of BINANCE_HOSTS[marketType]) {
    try {
      const response = await fetch(`${host}/${path}`, { signal: AbortSignal.timeout(8_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json() as unknown
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Network request failed')
    }
  }
  throw new Error(`Binance market data is unavailable: ${errors.join('; ')}`)
}

function recordFrom(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid Binance ${label} response`)
  }
  return value as Record<string, unknown>
}

function numberFrom(value: unknown, label: string): number {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Binance ${label}`)
  return parsed
}

function parseBinanceTicker(value: unknown): BinanceTicker {
  const ticker = recordFrom(value, 'ticker')
  return {
    lastPrice: numberFrom(ticker.lastPrice, 'last price'),
    priceChangePercent: numberFrom(ticker.priceChangePercent, '24h change'),
    highPrice: numberFrom(ticker.highPrice, '24h high'),
    lowPrice: numberFrom(ticker.lowPrice, '24h low'),
    quoteVolume: numberFrom(ticker.quoteVolume, '24h volume'),
  }
}

function parseBinanceDepth(value: unknown): { bids: Level[]; asks: Level[] } {
  const book = recordFrom(value, 'order book')
  const parseSide = (side: unknown, label: string): Level[] => {
    if (!Array.isArray(side)) throw new Error(`Invalid Binance ${label} depth`)
    return side.map((entry): Level => {
      if (!Array.isArray(entry) || entry.length < 2) throw new Error(`Invalid Binance ${label} level`)
      return { price: numberFrom(entry[0], 'depth price'), quantity: numberFrom(entry[1], 'depth quantity') }
    }).filter((level) => level.price > 0 && level.quantity > 0)
  }
  const bids = parseSide(book.bids, 'bid').sort((left, right) => right.price - left.price).slice(0, 20)
  const asks = parseSide(book.asks, 'ask').sort((left, right) => left.price - right.price).slice(0, 20)
  if (!bids.length || !asks.length) throw new Error('Binance returned an empty order book')
  return { bids, asks }
}

function parseBinanceCandles(value: unknown): Candle[] {
  if (!Array.isArray(value)) throw new Error('Invalid Binance candlestick response')
  const candles = value.map((entry): Candle => {
    if (!Array.isArray(entry) || entry.length < 6) throw new Error('Invalid Binance candlestick')
    return {
      time: numberFrom(entry[0], 'candle time'),
      open: numberFrom(entry[1], 'candle open'),
      high: numberFrom(entry[2], 'candle high'),
      low: numberFrom(entry[3], 'candle low'),
      close: numberFrom(entry[4], 'candle close'),
      volume: numberFrom(entry[5], 'candle volume'),
    }
  })
  if (!candles.length) throw new Error('Binance returned no candlesticks')
  return candles
}

function addCumulativeTotals(levels: Level[]): BookLevel[] {
  let cumulativeTotal = 0
  return levels.map((level) => {
    cumulativeTotal += level.price * level.quantity
    return { ...level, cumulativeTotal }
  })
}

async function request<T>(
  path: string,
  token?: string | null,
  init: RequestInit = {},
): Promise<{ details: T; token?: string }> {
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  const body = await response.json() as Envelope<T>
  if (!response.ok || !body.success || body.details === undefined) {
    throw new Error(body.message ?? `Request failed (${response.status})`)
  }
  return { details: body.details, token: body.token }
}

function money(value: number, digits = 2) {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('cex-token'))
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [account, setAccount] = useState<Account | null>(null)
  const [markets, setMarkets] = useState<Market[]>([])
  const [symbol, setSymbol] = useState('BTC-USDT')
  const [marketType, setMarketType] = useState<MarketType>('SPOT')
  const [candleInterval, setCandleInterval] = useState<CandleInterval>('1m')
  const [binanceMarketData, setBinanceMarketData] = useState<BinanceMarketData | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [side, setSide] = useState<Side>('BID')
  const [category, setCategory] = useState<'LIMIT' | 'MARKET'>('LIMIT')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [leverage, setLeverage] = useState('5')
  const [tab, setTab] = useState<'positions' | 'orders' | 'fills' | 'activity'>('positions')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const market = markets.find((item) => item.symbol === symbol)
  const marketDataKey = `${marketType}:${symbol}:${candleInterval}`
  const activeMarketData = binanceMarketData?.key === marketDataKey ? binanceMarketData : null
  const candles = activeMarketData?.candles ?? []
  const binanceTicker = activeMarketData?.ticker ?? null
  const binanceDepth = activeMarketData?.depth ?? null
  const marketDataStatus = activeMarketData?.status ?? 'loading'
  const marketDataError = activeMarketData?.error ?? ''
  const currentPrice = marketType === 'PERP' ? market?.perpLastPrice ?? market?.lastPrice ?? 0 : market?.lastPrice ?? 0
  const priceDigits = currentPrice > 0 && currentPrice < 1 ? 5 : currentPrice < 100 ? 4 : 2
  const quoteBalance = account?.balances.find((balance) => balance.asset === 'USDT')
  const baseAsset = market?.baseAsset ?? symbol.split('-')[0]
  const baseBalance = account?.balances.find((balance) => balance.asset === baseAsset)
  const enteredQuantity = Number(quantity)
  const enteredPrice = category === 'MARKET' ? currentPrice : Number(price || currentPrice)
  const estimatedTotal = enteredQuantity > 0 && enteredPrice > 0 ? enteredQuantity * enteredPrice : 0

  const refresh = useCallback(async () => {
    if (!token) return
    const [marketResult, accountResult, orderResult] = await Promise.all([
      request<Market[]>('/markets'),
      request<Account>('/account', token),
      request<Order[]>('/orders', token),
    ])
    setMarkets(marketResult.details)
    setAccount(accountResult.details)
    setOrders(orderResult.details)
  }, [token])

  useEffect(() => {
    if (!token) return
    let active = true
    const load = async () => {
      try {
        const [marketResult, accountResult, orderResult] = await Promise.all([
          request<Market[]>('/markets'),
          request<Account>('/account', token),
          request<Order[]>('/orders', token),
        ])
        if (!active) return
        setMarkets(marketResult.details)
        setAccount(accountResult.details)
        setOrders(orderResult.details)
        setError('')
      } catch (requestError) {
        if (!active) return
        const text = requestError instanceof Error ? requestError.message : 'Unable to load trading data'
        setError(text)
        if (text.toLowerCase().includes('token')) {
          localStorage.removeItem('cex-token')
          setToken(null)
        }
      }
    }
    void load()
    const timer = window.setInterval(load, 5_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [token])

  const marketExists = markets.some((item) => item.symbol === symbol)
  useEffect(() => {
    if (!token || !marketExists) return
    let active = true
    let inFlight = false
    const loadMarketData = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const binanceSymbol = symbol.replace('-', '')
        const query = new URLSearchParams({ symbol: binanceSymbol })
        const candleQuery = new URLSearchParams({ symbol: binanceSymbol, interval: candleInterval, limit: '100' })
        const [tickerResponse, depthResponse, candleResponse] = await Promise.all([
          binanceRequest(`ticker/24hr?${query}`, marketType),
          binanceRequest(`depth?${query}&limit=20`, marketType),
          binanceRequest(`klines?${candleQuery}`, marketType),
        ])
        if (!active) return
        setBinanceMarketData({
          key: marketDataKey,
          ticker: parseBinanceTicker(tickerResponse),
          depth: parseBinanceDepth(depthResponse),
          candles: parseBinanceCandles(candleResponse),
          status: 'connected',
          error: '',
        })
      } catch (requestError) {
        if (active) {
          const text = requestError instanceof Error ? requestError.message : 'Unable to load Binance market data'
          setBinanceMarketData((previous) => {
            const previousData = previous?.key === marketDataKey ? previous : null
            return {
              key: marketDataKey,
              ticker: previousData?.ticker ?? null,
              depth: previousData?.depth ?? null,
              candles: previousData?.candles ?? [],
              status: previousData ? 'stale' : 'error',
              error: text,
            }
          })
        }
      } finally {
        inFlight = false
      }
    }
    void loadMarketData()
    const timer = window.setInterval(loadMarketData, 15_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [candleInterval, marketDataKey, marketExists, marketType, symbol, token])

  const askRows = binanceDepth ? addCumulativeTotals(binanceDepth.asks.slice(0, 8)).reverse() : []
  const bidRows = binanceDepth ? addCumulativeTotals(binanceDepth.bids.slice(0, 8)) : []
  const maxDepthTotal = Math.max(1, ...askRows.map((level) => level.cumulativeTotal), ...bidRows.map((level) => level.cumulativeTotal))
  const bestBid = binanceDepth?.bids[0]?.price
  const bestAsk = binanceDepth?.asks[0]?.price
  const spread = bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : undefined

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const path = authMode === 'signup' ? '/signup' : '/login'
      const result = await request<{ id: number; email: string }>(path, null, {
        method: 'POST',
        body: JSON.stringify(authMode === 'signup' ? { username, email, password } : { email, password }),
      })
      if (!result.token) throw new Error('The server did not return an authentication token')
      localStorage.setItem('cex-token', result.token)
      setToken(result.token)
      setPassword('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to sign in')
    } finally {
      setBusy(false)
    }
  }

  const placeOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await request<Order>('/orders', token, {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          marketType,
          category,
          type: side,
          ...(category === 'LIMIT' ? { price: Number(price || currentPrice) } : {}),
          volume: Number(quantity),
          leverage: marketType === 'PERP' ? Number(leverage) : 1,
        }),
      })
      setMessage('Order submitted')
      setQuantity('')
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to place order')
    } finally {
      setBusy(false)
    }
  }

  const cancelOrder = async (orderId: number) => {
    setBusy(true)
    setError('')
    try {
      await request(`/orders/${orderId}`, token, { method: 'DELETE' })
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to cancel order')
    } finally {
      setBusy(false)
    }
  }

  const closePosition = async () => {
    setBusy(true)
    setError('')
    try {
      await request(`/positions/${symbol}/close`, token, { method: 'POST', body: '{}' })
      setMessage('Position closed at the latest mark price')
      await refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to close position')
    } finally {
      setBusy(false)
    }
  }

  const signOut = () => {
    localStorage.removeItem('cex-token')
    setToken(null)
    setAccount(null)
  }

  if (!token) {
    return (
      <main className="auth-shell">
        <div className="auth-brand"><span className="brand-mark">C</span> CEX <span className="brand-sub">PAPER EXCHANGE</span></div>
        <section className="auth-card">
          <div className="eyebrow">SIMULATED MARKETS · TEST FUNDS</div>
          <h1>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="muted">Trade spot and perpetual markets in a simulated environment.</p>
          <form onSubmit={authenticate} className="auth-form">
            {authMode === 'signup' && (
              <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} minLength={2} required /></label>
            )}
            <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>Password<input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={authMode === 'signup' ? 8 : 1} required /></label>
            {error && <div className="notice error">{error}</div>}
            <button className="button primary wide" disabled={busy}>{busy ? 'Please wait…' : authMode === 'login' ? 'Sign in' : 'Create account'}</button>
          </form>
          <button className="text-button" onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setError('') }}>
            {authMode === 'login' ? 'New here? Create an account' : 'Already registered? Sign in'}
          </button>
          <div className="demo-note">New accounts receive demo balances for USDT, BTC, ETH, SOL, BNB, XRP, ADA and DOGE.</div>
        </section>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">C</span><span>CEX</span><span className="brand-sub">EXCHANGE</span></div>
        <div className="topbar-market">
          <select aria-label="Market" value={symbol} onChange={(event) => { setSymbol(event.target.value); setPrice('') }}>
            {markets.map((item) => <option value={item.symbol} key={item.symbol}>{item.symbol}</option>)}
          </select>
          <div className="market-switch">
            <button className={marketType === 'SPOT' ? 'active' : ''} onClick={() => { setMarketType('SPOT'); setPrice('') }}>Spot</button>
            <button className={marketType === 'PERP' ? 'active' : ''} onClick={() => { setMarketType('PERP'); setPrice('') }}>Perp</button>
          </div>
        </div>
        <div className="topbar-right">
          <div className="connection"><i /> Live demo</div>
          <span className="user-name">{account?.user.username ?? 'Account'}</span>
          <button className="button subtle" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main className="workspace">
        <section className="market-strip panel">
          <div className="market-title"><div className="coin-icon">{baseAsset.slice(0, 1)}</div><div><h1>{symbol.replace('-', ' / ')}</h1><span>{market?.name ?? 'Loading market'}</span></div></div>
          <div className="market-stat"><span>Paper mark</span><strong>${money(currentPrice, priceDigits)}</strong></div>
          <div className="market-stat"><span>Binance 24h</span><strong className={(binanceTicker?.priceChangePercent ?? 0) >= 0 ? 'positive' : 'negative'}>{binanceTicker ? `${binanceTicker.priceChangePercent >= 0 ? '+' : ''}${binanceTicker.priceChangePercent.toFixed(2)}%` : '—'}</strong></div>
          {marketType === 'PERP' && <div className="market-stat"><span>Funding / 8h</span><strong className="positive">{((market?.fundingRate ?? 0) * 100).toFixed(4)}%</strong></div>}
          {marketType === 'PERP' && <div className="market-stat"><span>Next funding</span><strong>{market ? new Date(market.nextFundingAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</strong></div>}
          <div className="demo-pill">SIMULATED · NOT REAL FUNDS</div>
        </section>

        {(error || message) && <div className={`notice ${error ? 'error' : 'success'}`}>{error || message}<button onClick={() => { setError(''); setMessage('') }}>×</button></div>}

        <div className="trading-grid">
          <section className="chart-panel panel">
            <div className="panel-heading">
              <div><span className="eyebrow">{marketType === 'SPOT' ? 'BINANCE SPOT REFERENCE' : 'BINANCE USDⓈ-M PERPETUAL REFERENCE'}</span><h2>{symbol}</h2></div>
              <span className={`market-data-status ${marketDataStatus}`}><i />{marketDataStatus === 'connected' ? 'Binance connected' : marketDataStatus === 'loading' ? 'Connecting…' : marketDataStatus === 'stale' ? 'Data stale' : 'Data unavailable'}</span>
            </div>
            <div className="chart-summary"><strong>{binanceTicker ? `$${money(binanceTicker.lastPrice, priceDigits)}` : '—'}</strong><span>24h {binanceTicker ? `${binanceTicker.priceChangePercent >= 0 ? '+' : ''}${binanceTicker.priceChangePercent.toFixed(2)}%` : '—'}</span></div>
            <div className="chart-toolbar">
              <div className="chart-intervals">{(['1m', '5m', '15m', '1h', '4h', '1d'] as const).map((interval) => (
                <button type="button" className={candleInterval === interval ? 'selected' : ''} key={interval} onClick={() => setCandleInterval(interval)}>{interval}</button>
              ))}</div>
              <span>Public data · read only</span>
            </div>
            <PriceChart candles={candles} status={marketDataStatus} error={marketDataError} symbol={symbol} interval={candleInterval} />
            {binanceTicker && <div className="chart-footer"><span>24h High <b>${money(binanceTicker.highPrice, priceDigits)}</b></span><span>24h Low <b>${money(binanceTicker.lowPrice, priceDigits)}</b></span><span>Volume <b>{money(binanceTicker.quoteVolume, 0)} USDT</b></span></div>}
            {marketDataError && <div className="market-data-error">{marketDataError}</div>}
          </section>

          <section className="orderbook-panel panel">
            <div className="panel-heading"><div><span className="eyebrow">BINANCE REFERENCE DEPTH</span><h2>Order book</h2></div><span className="unit">Price <small>(USDT)</small></span></div>
            <div className="book-head"><span>Price (USDT)</span><span>Size ({baseAsset})</span><span>Total</span></div>
            <div className="book-side asks">{askRows.length ? askRows.map((level, index) => <BookRow level={level} side="ASK" depthPercent={level.cumulativeTotal / maxDepthTotal * 100} key={`ask-${index}-${level.price}`} />) : <div className="book-empty">{marketDataStatus === 'error' ? 'Binance depth unavailable' : 'Loading Binance depth…'}</div>}</div>
            <div className="book-price">{binanceTicker ? `$${money(binanceTicker.lastPrice, priceDigits)}` : '—'} <span>Binance ref{spread === undefined ? '' : ` · spread ${money(spread, priceDigits)}`}</span></div>
            <div className="book-side bids">{bidRows.length ? bidRows.map((level, index) => <BookRow level={level} side="BID" depthPercent={level.cumulativeTotal / maxDepthTotal * 100} key={`bid-${index}-${level.price}`} />) : <div className="book-empty">{marketDataStatus === 'error' ? 'Binance depth unavailable' : 'Loading Binance depth…'}</div>}</div>
            <div className="book-disclaimer">Reference depth only. Paper orders execute against demo liquidity.</div>
          </section>

          <section className="order-panel panel">
            <div className="panel-heading"><div><span className="eyebrow">PLACE ORDER</span><h2>{marketType === 'SPOT' ? 'Spot trading' : 'Perpetuals'}</h2></div></div>
            <form className="order-entry" onSubmit={(event) => { void placeOrder(event) }}>
              <div className="side-switch">
                <button type="button" className={side === 'BID' ? 'buy selected' : 'buy'} onClick={() => setSide('BID')}>{marketType === 'PERP' ? 'Open long' : 'Buy'} {baseAsset}</button>
                <button type="button" className={side === 'ASK' ? 'sell selected' : 'sell'} onClick={() => setSide('ASK')}>{marketType === 'PERP' ? 'Open short' : 'Sell'} {baseAsset}</button>
              </div>
              <div className="segmented">
                <button type="button" className={category === 'LIMIT' ? 'selected' : ''} onClick={() => setCategory('LIMIT')}>Limit</button>
                <button type="button" className={category === 'MARKET' ? 'selected' : ''} onClick={() => setCategory('MARKET')}>Market</button>
              </div>
              {category === 'LIMIT' && <label className="field-label">Price <span>USDT</span><div className="input-wrap"><input inputMode="decimal" type="number" min="0" step="0.00000001" value={price} placeholder={currentPrice.toString()} onChange={(event) => setPrice(event.target.value)} /></div></label>}
              <label className="field-label">Amount <span>{baseAsset}</span><div className="input-wrap"><input inputMode="decimal" type="number" min="0" step="0.00000001" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="0.00" required /></div></label>
              {marketType === 'PERP' && <label className="field-label">Leverage <span>1× – 20×</span><div className="input-wrap"><input type="number" min="1" max="20" step="1" value={leverage} onChange={(event) => setLeverage(event.target.value)} /></div></label>}
              <div className="estimate"><span>Estimated {marketType === 'PERP' ? 'initial margin' : 'total'}</span><strong>{money(marketType === 'PERP' ? estimatedTotal / Math.max(1, Number(leverage)) : estimatedTotal, 2)} USDT</strong></div>
              <button type="submit" className={`button order-submit ${side === 'BID' ? 'primary' : 'danger'}`} disabled={busy || !quantity || Number(quantity) <= 0}>
                {busy ? 'Submitting…' : `${side === 'BID' ? 'Buy' : 'Sell'} ${baseAsset}`}
              </button>
              <div className="balance-list">
                <div><span>Available USDT</span><b>{money(quoteBalance?.available ?? 0, 2)}</b></div>
                <div><span>Locked USDT</span><b>{money(quoteBalance?.locked ?? 0, 2)}</b></div>
                {marketType === 'SPOT' && <div><span>Available {baseAsset}</span><b>{money(baseBalance?.available ?? 0, 6)}</b></div>}
                {marketType === 'SPOT' && <div><span>Locked {baseAsset}</span><b>{money(baseBalance?.locked ?? 0, 6)}</b></div>}
                {marketType === 'PERP' && <div><span>Funding rate</span><b>{((market?.fundingRate ?? 0) * 100).toFixed(4)}%</b></div>}
              </div>
            </form>
          </section>
        </div>

        <section className="account-panel panel">
          <div className="tabs">
            <button className={tab === 'positions' ? 'active' : ''} onClick={() => setTab('positions')}>Positions <span>{account?.positions.length ?? 0}</span></button>
            <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>Open orders <span>{orders.length}</span></button>
            <button className={tab === 'fills' ? 'active' : ''} onClick={() => setTab('fills')}>My trades</button>
            <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>Funding & liquidations</button>
          </div>
          {tab === 'positions' && (
            <div className="table-scroll"><table><thead><tr><th>Contract</th><th>Side</th><th>Size</th><th>Entry price</th><th>Mark price</th><th>Margin</th><th>Liquidation</th><th>Unrealized PnL</th><th /></tr></thead><tbody>
              {(account?.positions ?? []).filter((position) => position.symbol === symbol).map((position) => {
                const markPrice = market?.perpLastPrice ?? position.entryPrice
                const pnl = (markPrice - position.entryPrice) * position.quantity * (position.side === 'LONG' ? 1 : -1)
                return <tr key={position.symbol}><td>{position.symbol}</td><td className={position.side === 'LONG' ? 'positive' : 'negative'}>{position.side} · {position.leverage.toFixed(1)}×</td><td>{money(position.quantity, 6)}</td><td>${money(position.entryPrice)}</td><td>${money(markPrice)}</td><td>{money(position.margin)} USDT</td><td>${money(position.liquidationPrice)}</td><td className={pnl >= 0 ? 'positive' : 'negative'}>{pnl >= 0 ? '+' : ''}{money(pnl)} USDT</td><td><button className="button small danger-outline" onClick={() => void closePosition()} disabled={busy}>Close</button></td></tr>
              })}
              {(!account?.positions.some((position) => position.symbol === symbol)) && <EmptyRow colSpan={9} text="No open positions for this contract" />}
            </tbody></table></div>
          )}
          {tab === 'orders' && (
            <div className="table-scroll"><table><thead><tr><th>Market</th><th>Type</th><th>Side</th><th>Limit price</th><th>Amount</th><th>Remaining</th><th>Leverage</th><th>Placed</th><th /></tr></thead><tbody>
              {orders.filter((order) => order.symbol === symbol).map((order) => <tr key={order.id}><td>{order.symbol} · {order.marketType}</td><td>{order.category}</td><td className={order.side === 'BID' ? 'positive' : 'negative'}>{order.side}</td><td>{order.price ? `$${money(order.price)}` : 'Market'}</td><td>{money(order.volume, 6)}</td><td>{money(order.remaining, 6)}</td><td>{order.marketType === 'PERP' ? `${order.leverage}×` : '—'}</td><td>{new Date(order.createdAt).toLocaleTimeString()}</td><td><button className="button small danger-outline" onClick={() => void cancelOrder(order.id)} disabled={busy}>Cancel</button></td></tr>)}
              {!orders.some((order) => order.symbol === symbol) && <EmptyRow colSpan={9} text="No open orders for this market" />}
            </tbody></table></div>
          )}
          {tab === 'fills' && (
            <div className="table-scroll"><table><thead><tr><th>Time</th><th>Side</th><th>Price (USDT)</th><th>Amount ({baseAsset})</th><th>Total (USDT)</th></tr></thead><tbody>
              {(account?.fills ?? []).filter((fill) => fill.symbol === symbol && fill.marketType === marketType).map((fill) => <tr key={fill.id}><td>{new Date(fill.createdAt).toLocaleTimeString()}</td><td className={fill.side === 'BID' ? 'positive' : 'negative'}>{fill.side}</td><td>${money(fill.price)}</td><td>{money(fill.quantity, 6)}</td><td>{money(fill.price * fill.quantity)}</td></tr>)}
              {!(account?.fills ?? []).some((fill) => fill.symbol === symbol && fill.marketType === marketType) && <EmptyRow colSpan={5} text="No trades for this market yet" />}
            </tbody></table></div>
          )}
          {tab === 'activity' && (
            <div className="activity-grid">
              <div><h3>Funding payments</h3><div className="table-scroll"><table><thead><tr><th>Time</th><th>Contract</th><th>Rate</th><th>Payment</th></tr></thead><tbody>
                {(account?.fundingPayments ?? []).map((payment) => <tr key={payment.id}><td>{new Date(payment.createdAt).toLocaleString()}</td><td>{payment.symbol}</td><td>{(payment.rate * 100).toFixed(4)}%</td><td className={payment.amount >= 0 ? 'positive' : 'negative'}>{payment.amount >= 0 ? '+' : ''}{money(payment.amount)} USDT</td></tr>)}
                {!account?.fundingPayments.length && <EmptyRow colSpan={4} text="No funding payments yet" />}
              </tbody></table></div></div>
              <div><h3>Liquidations</h3><div className="table-scroll"><table><thead><tr><th>Time</th><th>Contract</th><th>Side</th><th>Price</th><th>Loss</th></tr></thead><tbody>
                {(account?.liquidations ?? []).map((event) => <tr key={event.id}><td>{new Date(event.createdAt).toLocaleString()}</td><td>{event.symbol}</td><td className="negative">{event.side}</td><td>${money(event.price)}</td><td className="negative">{money(event.loss)} USDT</td></tr>)}
                {!account?.liquidations.length && <EmptyRow colSpan={5} text="No liquidations" />}
              </tbody></table></div></div>
            </div>
          )}
        </section>
        <footer className="app-footer">CEX paper exchange <span>·</span> Binance data is reference-only; orders, balances, matching and funding are simulated.</footer>
      </main>
    </div>
  )

}

function BookRow({ level, side, depthPercent }: { level: BookLevel; side: Side; depthPercent: number }) {
  const color = side === 'BID' ? 'rgba(46, 207, 145, .12)' : 'rgba(255, 104, 119, .12)'
  return <div className={`book-row ${side === 'BID' ? 'positive' : 'negative'}`} style={{ background: `linear-gradient(to left, ${color} ${depthPercent}%, transparent ${depthPercent}%)` }}><span>{money(level.price, level.price < 1 ? 5 : level.price < 100 ? 4 : 2)}</span><span>{money(level.quantity, 4)}</span><span>{money(level.cumulativeTotal, 2)}</span></div>
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return <tr><td className="empty-row" colSpan={colSpan}>{text}</td></tr>
}

function PriceChart({ candles, status, error, symbol, interval }: {
  candles: Candle[]
  status: 'loading' | 'connected' | 'stale' | 'error'
  error: string
  symbol: string
  interval: CandleInterval
}) {
  const visible = candles.slice(-72)
  const min = visible.length ? Math.min(...visible.map((candle) => candle.low)) : 0
  const max = visible.length ? Math.max(...visible.map((candle) => candle.high)) : 0
  const range = Math.max(max - min, Math.abs(max) * 0.001, 1e-8)
  const maxVolume = Math.max(...visible.map((candle) => candle.volume), 1e-8)
  const candleWidth = Math.max(0.45, 70 / Math.max(visible.length, 1))
  const y = (price: number) => 4 + ((max - price) / range) * 73
  return (
    <div className="chart-canvas">
      <div className="chart-grid"><i /><i /><i /><i /></div>
      {visible.length
        ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Binance ${symbol} ${interval} candlestick chart`}>
          {visible.map((candle, index) => {
            const x = (index / visible.length) * 100 + (50 / visible.length)
            const top = y(Math.max(candle.open, candle.close))
            const bodyHeight = Math.max(0.45, (Math.abs(candle.close - candle.open) / range) * 73)
            const volumeHeight = (candle.volume / maxVolume) * 10
            const rising = candle.close >= candle.open
            const className = rising ? 'candle-up' : 'candle-down'
            return <g className={className} key={candle.time}>
              <line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} />
              <rect x={x - candleWidth / 2} y={top} width={candleWidth} height={bodyHeight} />
              <rect className="candle-volume" x={x - candleWidth / 2} y={88 - volumeHeight} width={candleWidth} height={volumeHeight} />
            </g>
          })}
        </svg>
        : <div className="chart-empty">{status === 'error' ? error : 'Loading Binance candlesticks…'}</div>}
      {visible.length > 0 && <><span className="chart-axis top">${money(max, max < 1 ? 5 : max < 100 ? 4 : 2)}</span><span className="chart-axis bottom">${money(min, min < 1 ? 5 : min < 100 ? 4 : 2)}</span></>}
    </div>
  )
}

export default App
