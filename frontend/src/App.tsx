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

const API_BASE = import.meta.env.VITE_API_URL ?? ''

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
  const [depth, setDepth] = useState<{ bids: Level[]; asks: Level[] }>({ bids: [], asks: [] })
  const [trades, setTrades] = useState<Trade[]>([])
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
  const currentDepth = marketType === 'SPOT' ? market?.spotDepth : market?.perpDepth
  const currentPrice = marketType === 'PERP' ? market?.perpLastPrice ?? market?.lastPrice ?? 0 : market?.lastPrice ?? 0
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
    const loadMarketData = async () => {
      try {
        const query = `?marketType=${marketType}`
        const [bookResult, tradeResult] = await Promise.all([
          request<{ bids: Level[]; asks: Level[] }>(`/markets/${symbol}/depth${query}`, token),
          request<Trade[]>(`/markets/${symbol}/trades${query}`, token),
        ])
        if (active) {
          setDepth(bookResult.details)
          setTrades(tradeResult.details)
        }
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load market data')
      }
    }
    void loadMarketData()
    const timer = window.setInterval(loadMarketData, 3_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [marketExists, marketType, symbol, token])

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
          <div className="demo-note">New accounts receive demo USDT, BTC and ETH balances.</div>
        </section>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">C</span><span>CEX</span><span className="brand-sub">EXCHANGE</span></div>
        <div className="topbar-market">
          <select aria-label="Market" value={symbol} onChange={(event) => { setSymbol(event.target.value); setPrice(''); setDepth({ bids: [], asks: [] }); setTrades([]) }}>
            {markets.map((item) => <option value={item.symbol} key={item.symbol}>{item.symbol}</option>)}
          </select>
          <div className="market-switch">
            <button className={marketType === 'SPOT' ? 'active' : ''} onClick={() => { setMarketType('SPOT'); setPrice(''); setDepth({ bids: [], asks: [] }); setTrades([]) }}>Spot</button>
            <button className={marketType === 'PERP' ? 'active' : ''} onClick={() => { setMarketType('PERP'); setPrice(''); setDepth({ bids: [], asks: [] }); setTrades([]) }}>Perp</button>
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
          <div className="market-stat"><span>Last price</span><strong>${money(currentPrice, 2)}</strong></div>
          {marketType === 'PERP' && <div className="market-stat"><span>Funding / 8h</span><strong className="positive">{((market?.fundingRate ?? 0) * 100).toFixed(4)}%</strong></div>}
          {marketType === 'PERP' && <div className="market-stat"><span>Next funding</span><strong>{market ? new Date(market.nextFundingAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</strong></div>}
          <div className="demo-pill">SIMULATED · NOT REAL FUNDS</div>
        </section>

        {(error || message) && <div className={`notice ${error ? 'error' : 'success'}`}>{error || message}<button onClick={() => { setError(''); setMessage('') }}>×</button></div>}

        <div className="trading-grid">
          <section className="chart-panel panel">
            <div className="panel-heading"><div><span className="eyebrow">{marketType === 'SPOT' ? 'SPOT MARKET' : 'PERPETUAL CONTRACT'}</span><h2>{symbol}</h2></div><span className="chart-caption">Last traded price · USDT</span></div>
            <div className="chart-summary"><strong>${money(currentPrice, 2)}</strong><span>Price updates when orders match</span></div>
            <PriceChart trades={trades} fallbackPrice={currentPrice} />
          </section>

          <section className="orderbook-panel panel">
            <div className="panel-heading"><div><span className="eyebrow">MARKET DEPTH</span><h2>Order book</h2></div><span className="unit">Price <small>(USDT)</small></span></div>
            <div className="book-head"><span>Price (USDT)</span><span>Size ({baseAsset})</span><span>Total</span></div>
            <div className="book-side asks">{(depth.asks.length ? depth.asks : currentDepth?.asks ?? []).slice(0, 8).reverse().map((level, index) => <BookRow level={level} side="ASK" key={`ask-${index}-${level.price}`} />)}</div>
            <div className="book-price">${money(currentPrice, 2)} <span>Last price</span></div>
            <div className="book-side bids">{(depth.bids.length ? depth.bids : currentDepth?.bids ?? []).slice(0, 8).map((level, index) => <BookRow level={level} side="BID" key={`bid-${index}-${level.price}`} />)}</div>
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
        <footer className="app-footer">CEX paper exchange <span>·</span> Simulated balances, synthetic liquidity and funding. Not connected to a real exchange.</footer>
      </main>
    </div>
  )

}

function BookRow({ level, side }: { level: Level; side: Side }) {
  return <div className={`book-row ${side === 'BID' ? 'positive' : 'negative'}`}><span>{money(level.price, 2)}</span><span>{money(level.quantity, 4)}</span><span>{money(level.price * level.quantity, 2)}</span></div>
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return <tr><td className="empty-row" colSpan={colSpan}>{text}</td></tr>
}

function PriceChart({ trades, fallbackPrice }: { trades: Trade[]; fallbackPrice: number }) {
  const points = trades.slice(0, 30).reverse()
  const values = points.map((trade) => trade.price)
  const min = Math.min(...values, fallbackPrice * 0.999)
  const max = Math.max(...values, fallbackPrice * 1.001)
  const range = Math.max(max - min, 1)
  const coordinates = points.map((trade, index) => {
    const x = points.length < 2 ? 0 : (index / (points.length - 1)) * 100
    const y = 100 - ((trade.price - min) / range) * 88 - 6
    return `${x},${y}`
  }).join(' ')
  return (
    <div className="chart-canvas">
      <div className="chart-grid"><i /><i /><i /><i /></div>
      {points.length > 1
        ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Recent trade prices"><polyline points={coordinates} /></svg>
        : <div className="chart-empty">Price history will appear after trades match</div>}
      <span className="chart-axis top">${money(max, 0)}</span>
      <span className="chart-axis bottom">${money(min, 0)}</span>
    </div>
  )
}

export default App
