
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const MARKET_UNIVERSE = {
  BTC: {
    name: "Bitcoin",
    coingeckoId: "bitcoin",
    binanceSymbol: "btcusdt",
    category: "Store of value",
    volatility: "Faible",
    swapToken: "WBTC",
    custodyId: "BTC",
  },
  ETH: {
    name: "Ethereum",
    coingeckoId: "ethereum",
    binanceSymbol: "ethusdt",
    category: "Smart contracts",
    volatility: "Moyenne",
    swapToken: "ETH",
    custodyId: "ETH",
  },
  SOL: {
    name: "Solana",
    coingeckoId: "solana",
    binanceSymbol: "solusdt",
    category: "Layer 1",
    volatility: "Elevee",
    swapToken: null,
    custodyId: "SOL",
  },
  XMR: {
    name: "Monero",
    coingeckoId: "monero",
    binanceSymbol: "xmrusdt",
    category: "Privacy",
    volatility: "Moyenne",
    swapToken: null,
    custodyId: "XMR",
  },
  XRP: {
    name: "XRP",
    coingeckoId: "ripple",
    binanceSymbol: "xrpusdt",
    category: "Payments",
    volatility: "Moyenne",
    swapToken: null,
    custodyId: "XRP",
  },
  ADA: {
    name: "Cardano",
    coingeckoId: "cardano",
    binanceSymbol: "adausdt",
    category: "Layer 1",
    volatility: "Moyenne",
    swapToken: null,
    custodyId: "ADA",
  },
};

const DEFAULT_SYMBOLS = Object.keys(MARKET_UNIVERSE);
const STREAM_HOST = "wss://stream.binance.com:9443";
const DEFAULT_REFRESH = 1000 * 60 * 2; // 2 minutes

function normalizeSparkline(prices) {
  if (!Array.isArray(prices) || prices.length === 0) return [];
  const hourMs = 60 * 60 * 1000;
  const startTs = Date.now() - (prices.length - 1) * hourMs;
  return prices.map((value, index) => {
    const ts = startTs + index * hourMs;
    return {
      ts,
      label: new Intl.DateTimeFormat("fr-FR", {
        weekday: "short",
        hour: "2-digit",
      }).format(ts),
      value: Number(value),
    };
  });
}

function formatBook(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, 5).map(([price, size]) => ({
    price: Number(price),
    size: Number(size),
  }));
}

function buildSymbolKey(symbols) {
  return symbols.join("|");
}

export function useMarketData({
  symbols = DEFAULT_SYMBOLS,
  refreshInterval = DEFAULT_REFRESH,
} = {}) {
  const [snapshot, setSnapshot] = useState([]);
  const [orderBooks, setOrderBooks] = useState({});
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [streamStatus, setStreamStatus] = useState("idle");
  const [refreshTick, setRefreshTick] = useState(0);
  const wsRef = useRef(null);

  const trackedSymbols = useMemo(() => {
    const sanitized = (symbols || [])
      .map((symbol) => symbol?.toUpperCase())
      .filter((symbol) => Boolean(symbol) && MARKET_UNIVERSE[symbol]);
    if (sanitized.length === 0) {
      return DEFAULT_SYMBOLS;
    }
    return Array.from(new Set(sanitized));
  }, [symbols]);

  const trackedKey = useMemo(() => buildSymbolKey(trackedSymbols), [trackedSymbols]);

  const refresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    if (!trackedSymbols.length) return undefined;
    let cancelled = false;

    const load = async () => {
      setStatus((prev) => (prev === "ready" ? "refreshing" : "loading"));
      setError(null);
      try {
        const ids = trackedSymbols
          .map((symbol) => MARKET_UNIVERSE[symbol]?.coingeckoId)
          .filter(Boolean);

        if (!ids.length) {
          throw new Error("Aucun actif valide pour CoinGecko.");
        }

        const params = new URLSearchParams({
          vs_currency: "usd",
          ids: ids.join(","),
          sparkline: "true",
          price_change_percentage: "24h,7d",
        });

        const response = await fetch(`https://api.coingecko.com/api/v3/coins/markets?${params.toString()}`, {
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(`CoinGecko ${response.status} - ${response.statusText}`);
        }

        const payload = await response.json();
        if (cancelled) return;

        const totalMarketCap = payload.reduce((sum, item) => sum + (item.market_cap || 0), 0);

        const nextSnapshot = trackedSymbols
          .map((symbol) => {
            const apiEntry = payload.find((item) => item.symbol.toUpperCase() === symbol);
            if (!apiEntry) return null;
            const meta = MARKET_UNIVERSE[symbol] || {};
            return {
              symbol,
              name: apiEntry.name || meta.name || symbol,
              price: apiEntry.current_price ?? 0,
              change24h:
                apiEntry.price_change_percentage_24h_in_currency ??
                apiEntry.price_change_percentage_24h ??
                0,
              change7d:
                apiEntry.price_change_percentage_7d_in_currency ??
                apiEntry.price_change_percentage_7d ??
                0,
              volume24h: apiEntry.total_volume ?? 0,
              marketCap: apiEntry.market_cap ?? 0,
              dominance: totalMarketCap ? ((apiEntry.market_cap || 0) / totalMarketCap) * 100 : 0,
              sparkline: normalizeSparkline(apiEntry.sparkline_in_7d?.price),
              category: meta.category || "N/A",
              volatility: meta.volatility || "N/A",
            };
          })
          .filter(Boolean);

        setSnapshot(nextSnapshot);
        setLastUpdated(Date.now());
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[useMarketData] REST fetch error", err);
        setError(err instanceof Error ? err : new Error("Market data fetch failed"));
        setStatus("error");
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [trackedKey, trackedSymbols, refreshTick]);

  useEffect(() => {
    if (!refreshInterval) return undefined;
    const timer = setInterval(() => {
      refresh();
    }, refreshInterval);
    return () => clearInterval(timer);
  }, [refreshInterval, refresh]);

  useEffect(() => {
    if (!trackedSymbols.length) return undefined;
    const pairs = trackedSymbols
      .map((symbol) => MARKET_UNIVERSE[symbol]?.binanceSymbol)
      .filter(Boolean);

    if (!pairs.length) return undefined;
    if (typeof WebSocket === "undefined") return undefined;

    const streams = pairs.flatMap((pair) => [`${pair}@miniTicker`, `${pair}@depth5@100ms`]);
    const url = `${STREAM_HOST}/stream?streams=${streams.join("/")}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    let closed = false;

    const pairToSymbol = trackedSymbols.reduce((acc, symbol) => {
      const pair = MARKET_UNIVERSE[symbol]?.binanceSymbol;
      if (pair) {
        acc[pair.toUpperCase()] = symbol;
      }
      return acc;
    }, {});

    ws.onopen = () => {
      if (closed) return;
      setStreamStatus("connected");
    };

    ws.onerror = () => {
      if (closed) return;
      setStreamStatus("error");
    };

    ws.onclose = () => {
      if (closed) return;
      setStreamStatus("closed");
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload?.stream || !payload?.data) return;
        const pair = payload.data.s?.toUpperCase();
        const symbol = pair ? pairToSymbol[pair] : undefined;
        if (!symbol) return;

        if (payload.stream.includes("@miniticker")) {
          const lastPrice = Number(payload.data.c);
          const changePct = Number(payload.data.P);
          const volume = Number(payload.data.v);
          setSnapshot((prev) =>
            prev.map((coin) =>
              coin.symbol === symbol
                ? {
                    ...coin,
                    price: Number.isFinite(lastPrice) ? lastPrice : coin.price,
                    change24h: Number.isFinite(changePct) ? changePct : coin.change24h,
                    volume24h: Number.isFinite(volume) ? volume : coin.volume24h,
                  }
                : coin
            )
          );
        } else if (payload.stream.includes("@depth5")) {
          setOrderBooks((prev) => ({
            ...prev,
            [symbol]: {
              bids: formatBook(payload.data.bids),
              asks: formatBook(payload.data.asks),
              lastUpdateId: payload.data.lastUpdateId,
            },
          }));
        }
      } catch (err) {
        console.error("[useMarketData] WS parse error", err);
      }
    };

    return () => {
      closed = true;
      setStreamStatus("closed");
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      } else {
        ws.close();
      }
    };
  }, [trackedKey, trackedSymbols]);

  const coinsMap = useMemo(() => {
    return snapshot.reduce((acc, item) => {
      acc[item.symbol] = item;
      return acc;
    }, {});
  }, [snapshot]);

  return {
    coins: snapshot,
    coinsMap,
    orderBooks,
    status,
    error,
    lastUpdated,
    streamStatus,
    refresh,
    universe: trackedSymbols,
  };
}

export default useMarketData;
