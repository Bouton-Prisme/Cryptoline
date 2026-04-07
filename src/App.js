import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

const CRYPTOS = [
  {
    symbol: "XMR",
    name: "Monero",
    price: 165.32,
    change24h: 1.8,
    change7d: 3.45,
    volatility: "Moyenne",
    category: "Privacy",
  },
  {
    symbol: "BTC",
    name: "Bitcoin",
    price: 43250.12,
    change24h: 0.9,
    change7d: 1.12,
    volatility: "Faible",
    category: "Store of value",
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    price: 2321.44,
    change24h: -0.4,
    change7d: -0.84,
    volatility: "Moyenne",
    category: "Smart contracts",
  },
  {
    symbol: "SOL",
    name: "Solana",
    price: 137.67,
    change24h: 2.7,
    change7d: 7.9,
    volatility: "Elevee",
    category: "Layer 1",
  },
];

const CHART_BASE = [
  { day: "Lun", v: 168 },
  { day: "Mar", v: 170 },
  { day: "Mer", v: 169 },
  { day: "Jeu", v: 173 },
  { day: "Ven", v: 165 },
  { day: "Sam", v: 172 },
  { day: "Dim", v: 176 },
];

const THEMES = {
  ocean: "Ocean Pulse",
  sand: "Sand Storm",
  mint: "Mint Grid",
};

function formatMoney(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPct(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function useStoredState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);

  return [state, setState];
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="chart-tooltip">
      <div>{label}</div>
      <strong>{formatMoney(payload[0].value)}</strong>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useStoredState("cryptoline-theme", "ocean");
  const [selected, setSelected] = useStoredState("cryptoline-selected", "BTC");
  const [holdings, setHoldings] = useStoredState("cryptoline-holdings", {
    BTC: 0.45,
    ETH: 3.5,
    XMR: 18,
    SOL: 20,
  });
  const [watchlist, setWatchlist] = useStoredState("cryptoline-watchlist", [
    "BTC",
    "ETH",
  ]);
  const [alerts, setAlerts] = useStoredState("cryptoline-alerts", [
    { id: 1, symbol: "BTC", type: "Haussier", target: 45000 },
  ]);
  const [targetInput, setTargetInput] = useState("");
  const [alertType, setAlertType] = useState("Haussier");
  const [dcaAmount, setDcaAmount] = useState(200);
  const [dcaMonths, setDcaMonths] = useState(12);

  const coin = useMemo(() => {
    return CRYPTOS.find((item) => item.symbol === selected) || CRYPTOS[0];
  }, [selected]);

  const chartData = useMemo(() => {
    const scale = coin.price / 170;
    return CHART_BASE.map((point, index) => {
      const wave = index % 2 === 0 ? 1 : -1;
      return {
        ...point,
        v: Math.round(point.v * scale + wave * coin.change24h * 2),
      };
    });
  }, [coin]);

  const totalValue = useMemo(() => {
    return CRYPTOS.reduce((sum, item) => {
      const amount = Number(holdings[item.symbol] || 0);
      return sum + amount * item.price;
    }, 0);
  }, [holdings]);

  const allocation = useMemo(() => {
    return CRYPTOS.map((item) => {
      const value = (holdings[item.symbol] || 0) * item.price;
      const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
      return {
        ...item,
        value,
        pct,
      };
    }).sort((a, b) => b.value - a.value);
  }, [holdings, totalValue]);

  const dcaProjection = useMemo(() => {
    const monthlyGrowth = (coin.change7d / 100) * 0.3;
    let invested = 0;
    let projected = 0;

    for (let month = 1; month <= dcaMonths; month += 1) {
      invested += dcaAmount;
      projected = (projected + dcaAmount) * (1 + monthlyGrowth);
    }

    return {
      invested,
      projected,
      gain: projected - invested,
    };
  }, [coin.change7d, dcaAmount, dcaMonths]);

  const sentiment = useMemo(() => {
    const bullish = CRYPTOS.filter((item) => item.change24h > 0).length;
    if (bullish >= 3) return "Marche dynamique";
    if (bullish === 2) return "Marche indecise";
    return "Marche prudente";
  }, []);

  function updateHolding(symbol, nextValue) {
    setHoldings((prev) => ({
      ...prev,
      [symbol]: Number(nextValue) || 0,
    }));
  }

  function toggleWatch(symbol) {
    setWatchlist((prev) =>
      prev.includes(symbol)
        ? prev.filter((item) => item !== symbol)
        : [...prev, symbol]
    );
  }

  function addAlert() {
    const parsed = Number(String(targetInput).replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    setAlerts((prev) => [
      {
        id: Date.now(),
        symbol: coin.symbol,
        type: alertType,
        target: parsed,
      },
      ...prev,
    ]);
    setTargetInput("");
  }

  function removeAlert(id) {
    setAlerts((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <div className="app" data-theme={theme}>
      <div className="bg-layer" />
      <main className="shell">
        <header className="topbar reveal">
          <div className="brand">
            <img src="/cryptolinelogo.png" alt="CryptoLine" />
            <div>
              <p className="eyebrow">Dashboard V2</p>
              <h1>CryptoLine Studio</h1>
            </div>
          </div>

          <div className="controls">
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="field"
            >
              {Object.entries(THEMES).map(([key, label]) => (
                <option key={key} value={key}>
                  Theme: {label}
                </option>
              ))}
            </select>

            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="field"
            >
              {CRYPTOS.map((item) => (
                <option key={item.symbol} value={item.symbol}>
                  {item.symbol} - {item.name}
                </option>
              ))}
            </select>
          </div>
        </header>

        <section className="hero-grid reveal delay-1">
          <article className="card hero-main">
            <p className="eyebrow">Actif focus</p>
            <div className="coin-head">
              <div>
                <h2>
                  {coin.name} <span>{coin.symbol}</span>
                </h2>
                <p>
                  {coin.category} | Volatilite {coin.volatility}
                </p>
              </div>
              <button
                type="button"
                className={`watch ${watchlist.includes(coin.symbol) ? "active" : ""}`}
                onClick={() => toggleWatch(coin.symbol)}
              >
                {watchlist.includes(coin.symbol) ? "Dans watchlist" : "Ajouter watchlist"}
              </button>
            </div>

            <div className="kpis">
              <div>
                <label>Prix</label>
                <strong>{formatMoney(coin.price)}</strong>
              </div>
              <div>
                <label>24h</label>
                <strong className={coin.change24h >= 0 ? "up" : "down"}>
                  {formatPct(coin.change24h)}
                </strong>
              </div>
              <div>
                <label>7j</label>
                <strong className={coin.change7d >= 0 ? "up" : "down"}>
                  {formatPct(coin.change7d)}
                </strong>
              </div>
            </div>

            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 5" stroke="rgba(255, 255, 255, 0.12)" />
                  <XAxis dataKey="day" tick={{ fontSize: 12, fill: "rgba(255,255,255,0.7)" }} />
                  <YAxis
                    tick={{ fontSize: 12, fill: "rgba(255,255,255,0.7)" }}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="v"
                    stroke="var(--line-color)"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="card stats-panel">
            <p className="eyebrow">Vue portefeuille</p>
            <h3>{formatMoney(totalValue)}</h3>
            <p className="sentiment">{sentiment}</p>

            <div className="allocation-list">
              {allocation.map((item) => (
                <div key={item.symbol}>
                  <div className="row">
                    <span>
                      {item.symbol} ({(holdings[item.symbol] || 0).toLocaleString("fr-FR")})
                    </span>
                    <span>{item.pct.toFixed(1)}%</span>
                  </div>
                  <div className="bar">
                    <div style={{ width: `${item.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="grid-2 reveal delay-2">
          <article className="card">
            <p className="eyebrow">Gestion positions</p>
            <div className="holdings-grid">
              {CRYPTOS.map((item) => (
                <label key={item.symbol}>
                  <span>{item.symbol}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={holdings[item.symbol] || 0}
                    onChange={(e) => updateHolding(item.symbol, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </article>

          <article className="card">
            <p className="eyebrow">Alertes intelligentes</p>
            <div className="alert-form">
              <select
                value={alertType}
                onChange={(e) => setAlertType(e.target.value)}
                className="field"
              >
                <option>Haussier</option>
                <option>Baissier</option>
              </select>
              <input
                className="field"
                type="number"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                placeholder="Prix cible"
              />
              <button type="button" onClick={addAlert}>
                Ajouter
              </button>
            </div>

            <div className="alerts-list">
              {alerts.length === 0 && <p className="empty">Aucune alerte definie.</p>}
              {alerts.map((alert) => (
                <div key={alert.id} className="alert-item">
                  <div>
                    <strong>
                      {alert.symbol} {alert.type}
                    </strong>
                    <p>{formatMoney(alert.target)}</p>
                  </div>
                  <button type="button" onClick={() => removeAlert(alert.id)}>
                    Supprimer
                  </button>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="grid-2 reveal delay-3">
          <article className="card">
            <p className="eyebrow">Simulateur DCA</p>
            <div className="dca-fields">
              <label>
                <span>Investissement mensuel</span>
                <input
                  type="number"
                  min="0"
                  step="50"
                  value={dcaAmount}
                  onChange={(e) => setDcaAmount(Number(e.target.value) || 0)}
                />
              </label>
              <label>
                <span>Duree (mois)</span>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={dcaMonths}
                  onChange={(e) => setDcaMonths(Number(e.target.value) || 1)}
                />
              </label>
            </div>

            <div className="dca-result">
              <p>
                Investi: <strong>{formatMoney(dcaProjection.invested)}</strong>
              </p>
              <p>
                Valeur projetee: <strong>{formatMoney(dcaProjection.projected)}</strong>
              </p>
              <p className={dcaProjection.gain >= 0 ? "up" : "down"}>
                Gain potentiel: <strong>{formatMoney(dcaProjection.gain)}</strong>
              </p>
            </div>
          </article>

          <article className="card">
            <p className="eyebrow">Watchlist rapide</p>
            <div className="watchlist-grid">
              {CRYPTOS.filter((item) => watchlist.includes(item.symbol)).map((item) => (
                <button key={item.symbol} type="button" onClick={() => setSelected(item.symbol)}>
                  <span>{item.symbol}</span>
                  <strong className={item.change24h >= 0 ? "up" : "down"}>
                    {formatPct(item.change24h)}
                  </strong>
                </button>
              ))}
              {watchlist.length === 0 && (
                <p className="empty">Ajoute des actifs dans la watchlist pour les retrouver ici.</p>
              )}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
