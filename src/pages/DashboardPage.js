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

import useMarketData, { MARKET_UNIVERSE } from "../hooks/useMarketData";
import useWalletBridge from "../hooks/useWalletBridge";
import useCustodianHoldings from "../hooks/useCustodianHoldings";
import useAlerts from "../hooks/useAlerts";
import PortfolioCard from "../components/PortfolioCard";
import { rememberTransaction } from "../lib/submittedTransactions";
import DcaPendingPanel from "../components/DcaPendingPanel";
import AlertsPanel from "../components/AlertsPanel";
import WatchlistPanel from "../components/WatchlistPanel";
import { useAuth } from "../context/AuthContext";
import { useAppPreferences } from "../context/AppPreferencesContext";
import { formatMoney, formatPct, formatCompact } from "../utils/formatters";

const NEWS_TAGS = [
  { key: "all", label: "Tous" },
  { key: "macro", label: "Macro" },
  { key: "regulation", label: "Regulation" },
  { key: "defi", label: "DeFi" },
];

const ZEROX_QUOTE_ENDPOINT =
  process.env.REACT_APP_ZEROX_QUOTE || "/api/dca-quote";
const DEFAULT_DCA_BASE_STABLE = process.env.REACT_APP_DCA_STABLE || "USDC";
const DEFAULT_EXECUTIONS_ENDPOINT =
  process.env.REACT_APP_EXECUTIONS_ENDPOINT || "/api/execute-dca";
const DEFAULT_DCA_SCHEDULE_ENDPOINT =
  process.env.REACT_APP_DCA_SCHEDULE_ENDPOINT || "/api/dca-plans";
const DEFAULT_CHAIN_ID = 1;

const DCA_TOKEN_REGISTRY = {
  1: {
    ETH: {
      symbol: "ETH",
      address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      decimals: 18,
      native: true,
    },
    USDC: {
      symbol: "USDC",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      decimals: 6,
    },
    USDT: {
      symbol: "USDT",
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      decimals: 6,
    },
    DAI: {
      symbol: "DAI",
      address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      decimals: 18,
    },
    WBTC: {
      symbol: "WBTC",
      address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      decimals: 8,
    },
  },
  137: {
    USDC: {
      symbol: "USDC",
      address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      decimals: 6,
    },
    USDT: {
      symbol: "USDT",
      address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
      decimals: 6,
    },
  },
  42161: {
    ETH: {
      symbol: "ETH",
      address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      decimals: 18,
      native: true,
    },
    USDC: {
      symbol: "USDC",
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      decimals: 6,
    },
    USDT: {
      symbol: "USDT",
      address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      decimals: 6,
    },
    WBTC: {
      symbol: "WBTC",
      address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
      decimals: 8,
    },
  },
  8453: {
    ETH: {
      symbol: "ETH",
      address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      decimals: 18,
      native: true,
    },
    USDC: {
      symbol: "USDC",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
    },
  },
};

function resolveDcaToken(token, chainId = DEFAULT_CHAIN_ID) {
  const registry = DCA_TOKEN_REGISTRY[Number(chainId) || DEFAULT_CHAIN_ID] || {};
  const symbol = String(token || "").trim().toUpperCase();
  if (registry[symbol]) return registry[symbol];
  const address = String(token || "").trim().toLowerCase();
  return Object.values(registry).find((entry) => entry.address.toLowerCase() === address) || null;
}

function decimalToUnits(value, decimals) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return "0";
  const [whole, fractional = ""] = normalized.split(".");
  const paddedFractional = fractional.slice(0, decimals).padEnd(decimals, "0");
  return `${whole}${paddedFractional}`.replace(/^0+(?=\d)/, "") || "0";
}

const CHART_RANGES = {
  "24h": { days: 1, label: "24h" },
  "7j": { days: 7, label: "7 jours" },
  "30j": { days: 30, label: "30 jours" },
  "1an": { days: 365, label: "1 an" },
};

const DEFAULT_MACRO_SIGNALS = {
  fearGreedScore: null,
  fearGreedLabel: "Collecte en cours",
  fundingRate: null,
  fundingLabel: "Collecte en cours",
  dominanceSpread: null,
  dominanceLabel: "Dominance en calcul",
  openInterest: null,
  btcDominance: null,
  ethDominance: null,
  totalMarketCapUsd: null,
  totalVolumeUsd: null,
};

const CONDITION_DEFINITIONS = [
  {
    key: "price",
    label: "Prix spot",
    description: "Seuil absolu en USD.",
    unit: "USD",
    placeholder: "45000",
    operator: "gte",
    min: 0,
    step: 50,
  },
  {
    key: "drawdown",
    label: "% drawdown",
    description: "Baisse cumulative depuis le dernier plus haut.",
    unit: "%",
    placeholder: "8",
    operator: "gte",
    min: 0.1,
    step: 0.5,
  },
  {
    key: "volume",
    label: "Volume 24h",
    description: "Volume notional surveille (USD).",
    unit: "USD",
    placeholder: "25000000",
    operator: "gte",
    min: 100000,
    step: 100000,
  },
  {
    key: "funding",
    label: "Funding rate",
    description: "Taux moyen 8h (en %).",
    unit: "%",
    placeholder: "0.03",
    operator: "gte",
    min: -5,
    step: 0.01,
  },
];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="chart-tooltip">
      <div>{label}</div>
      <strong>{formatMoney(payload[0].value)}</strong>
    </div>
  );
}

function normalizeMarketChart(prices, range) {
  if (!Array.isArray(prices)) return [];

  const dateFormatter =
    range === "24h"
      ? new Intl.DateTimeFormat("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : range === "7j"
        ? new Intl.DateTimeFormat("fr-FR", {
            weekday: "short",
            day: "2-digit",
          })
        : new Intl.DateTimeFormat("fr-FR", {
            day: "2-digit",
            month: "short",
          });

  return prices
    .map(([ts, value]) => ({
      ts,
      label: dateFormatter.format(ts),
      value: Number(value),
    }))
    .filter((point) => Number.isFinite(point.ts) && Number.isFinite(point.value));
}

export default function DashboardPage() {
  const { session, user } = useAuth();
  const userId = user?.id || null;
  const authToken = session?.access_token || null;
  const {
    selected,
    setSelected,
    holdings,
    setHoldings,
    watchlist,
    setWatchlist,
    accountSettings,
  } = useAppPreferences();
  const [dcaAmount, setDcaAmount] = useState(200);
  const [dcaMonths, setDcaMonths] = useState(12);
  const [dcaFrequency, setDcaFrequency] = useState("hebdo");
  const [dcaSlippage, setDcaSlippage] = useState(0.3);
  const [dcaTargetSymbol, setDcaTargetSymbol] = useState("BTC");
  const [dcaSymbolTouched, setDcaSymbolTouched] = useState(false);
  const [dcaProvider, setDcaProvider] = useState("0x");
  const [dcaStartDate, setDcaStartDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [dcaQuote, setDcaQuote] = useState(null);
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
  const [dcaQuoteError, setDcaQuoteError] = useState(null);
  const [isExecutingDca, setIsExecutingDca] = useState(false);
  const [isSchedulingDca, setIsSchedulingDca] = useState(false);
  const [dcaExecutionMessage, setDcaExecutionMessage] = useState(null);
  const [dcaScheduleMessage, setDcaScheduleMessage] = useState(null);
  const [newsFilter, setNewsFilter] = useState("all");
  const [researchFeed, setResearchFeed] = useState([]);
  const [researchStatus, setResearchStatus] = useState("idle");
  const [researchError, setResearchError] = useState(null);
  const [researchMeta, setResearchMeta] = useState(null);
  const [macroSignals, setMacroSignals] = useState(DEFAULT_MACRO_SIGNALS);
  const [macroStatus, setMacroStatus] = useState("idle");
  const [macroError, setMacroError] = useState(null);
  const [macroMeta, setMacroMeta] = useState(null);
  const [chartRange, setChartRange] = useState("24h");
  const [rangeChartData, setRangeChartData] = useState([]);
  const [rangeChartStatus, setRangeChartStatus] = useState("idle");
  const [rangeChartError, setRangeChartError] = useState(null);
  const {
    alerts,
    events: alertEvents,
    status: alertsStatus,
    error: alertsError,
    createAlert,
    deleteAlert,
    refresh: refreshAlerts,
    runCheck: runAlertCheck,
  } = useAlerts({
    endpoint: accountSettings.alertsEndpoint || undefined,
    userId,
    authToken,
  });
  const [alertSymbol, setAlertSymbol] = useState("BTC");
  const [alertName, setAlertName] = useState("");
  const [alertNote, setAlertNote] = useState("");
  const [alertChannel, setAlertChannel] = useState("push");
  const [conditionState, setConditionState] = useState({
    price: { enabled: true, value: "", touched: false },
    drawdown: { enabled: false, value: 8, touched: false },
    volume: { enabled: false, value: 25000000, touched: false },
    funding: { enabled: false, value: 0.03, touched: false },
  });
  const [quoteRefreshTick, setQuoteRefreshTick] = useState(0);
  const [isSubmittingAlert, setIsSubmittingAlert] = useState(false);
  const [walletSaveStatus, setWalletSaveStatus] = useState("idle");
  const [walletSaveMessage, setWalletSaveMessage] = useState(null);

  useEffect(() => {
    if (!MARKET_UNIVERSE[selected]) {
      setSelected(Object.keys(MARKET_UNIVERSE)[0]);
    }
  }, [selected, setSelected]);

  useEffect(() => {
    const controller = new AbortController();

    const loadResearchFeed = async () => {
      setResearchStatus((current) => (current === "ready" ? "refreshing" : "loading"));
      setResearchError(null);
      try {
        const params = new URLSearchParams({
          tag: newsFilter,
          limit: "12",
        });
        const response = await fetch(`/api/research-feed?${params.toString()}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Research API ${response.status}`);
        }
        const payload = await response.json();
        setResearchFeed(Array.isArray(payload?.items) ? payload.items : []);
        setResearchMeta({
          cached: Boolean(payload?.cached),
          fetchedAt: payload?.fetchedAt || null,
          errors: Array.isArray(payload?.errors) ? payload.errors : [],
        });
        setResearchStatus("ready");
      } catch (err) {
        if (err?.name === "AbortError") return;
        console.error("[research] feed error", err);
        setResearchFeed([]);
        setResearchMeta(null);
        setResearchError(err instanceof Error ? err : new Error("Research feed error"));
        setResearchStatus("error");
      }
    };

    loadResearchFeed();

    return () => controller.abort();
  }, [newsFilter]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadMacroSignals = async () => {
      setMacroStatus((current) => (current === "ready" ? "refreshing" : "loading"));
      setMacroError(null);
      try {
        const response = await fetch("/api/macro-signals", {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Macro API ${response.status}`);
        }
        const payload = await response.json();
        if (cancelled) return;
        setMacroSignals({
          ...DEFAULT_MACRO_SIGNALS,
          ...payload,
        });
        setMacroMeta({
          cached: Boolean(payload?.cached),
          fetchedAt: payload?.fetchedAt || null,
          errors: Array.isArray(payload?.errors) ? payload.errors : [],
        });
        setMacroStatus("ready");
      } catch (err) {
        if (err?.name === "AbortError") return;
        console.error("[macro] signals error", err);
        setMacroSignals(DEFAULT_MACRO_SIGNALS);
        setMacroMeta(null);
        setMacroError(err instanceof Error ? err : new Error("Macro signals error"));
        setMacroStatus("error");
      }
    };

    loadMacroSignals();
    const timer = setInterval(loadMacroSignals, 120_000);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  const trackedUniverse = useMemo(() => {
    const base = new Set(Object.keys(MARKET_UNIVERSE));
    const addSymbol = (symbol) => {
      if (!symbol) return;
      const upper = symbol.toUpperCase();
      if (MARKET_UNIVERSE[upper]) {
        base.add(upper);
      }
    };
    watchlist.forEach(addSymbol);
    addSymbol(selected);
    return Array.from(base);
  }, [watchlist, selected]);

  const {
    connectors: walletConnectors,
    connectorId: walletConnectorId,
    status: walletStatus,
    account: walletAccount,
    network: walletNetwork,
    chainId: walletChainId,
    balances: walletBalances,
    error: walletError,
    connect: connectWallet,
    disconnect: disconnectWallet,
    refresh: refreshWallet,
    sendSwapQuote,
  } = useWalletBridge({ symbols: trackedUniverse });
  const custodyAccount =
    walletAccount ||
    accountSettings.defaultWalletAddress ||
    accountSettings.custodyAccountId ||
    "";
  const custodyEndpoint = accountSettings.custodyEndpoint || undefined;
  const dcaBaseStable =
    accountSettings.dcaStable || DEFAULT_DCA_BASE_STABLE;
  const executionsEndpoint =
    accountSettings.dcaExecutionEndpoint || DEFAULT_EXECUTIONS_ENDPOINT;
  const dcaScheduleEndpoint =
    accountSettings.dcaScheduleEndpoint || DEFAULT_DCA_SCHEDULE_ENDPOINT;
  const dcaChainId = Number(walletChainId || DEFAULT_CHAIN_ID);
  const dcaSellToken = resolveDcaToken(dcaBaseStable, dcaChainId);

  const {
    positions: custodianPositions,
    holdingsMap: custodianHoldingsMap,
    status: custodyStatus,
    error: custodyError,
    lastUpdated: custodyLastUpdated,
    refresh: refreshCustody,
  } = useCustodianHoldings({
    account: custodyAccount,
    symbols: trackedUniverse,
    endpoint: custodyEndpoint,
    userId,
    authToken,
  });

  const {
    coins,
    coinsMap,
    orderBooks,
    status: marketStatus,
    streamStatus,
    error: marketError,
    refresh: refreshMarket,
  } = useMarketData({ symbols: trackedUniverse });

  const { coin, hasLiveCoin } = useMemo(() => {
    const liveCoin = coinsMap[selected] || coins[0];
    if (liveCoin) {
      return { coin: liveCoin, hasLiveCoin: true };
    }
    const fallbackSymbol = MARKET_UNIVERSE[selected]
      ? selected
      : Object.keys(MARKET_UNIVERSE)[0];
    const fallbackMeta = MARKET_UNIVERSE[fallbackSymbol] || {};
    return {
      hasLiveCoin: false,
      coin: {
        symbol: fallbackSymbol,
        name: fallbackMeta.name || fallbackSymbol,
        price: 0,
        change24h: 0,
        change7d: 0,
        volume24h: 0,
        dominance: 0,
        sparkline: [],
        category: fallbackMeta.category || "N/A",
        volatility: fallbackMeta.volatility || "N/A",
      },
    };
  }, [coins, coinsMap, selected]);

  useEffect(() => {
    const coingeckoId = MARKET_UNIVERSE[coin?.symbol]?.coingeckoId;
    const rangeConfig = CHART_RANGES[chartRange];
    if (!coingeckoId || !rangeConfig) {
      setRangeChartData([]);
      return undefined;
    }

    const controller = new AbortController();

    const loadRangeChart = async () => {
      setRangeChartStatus("loading");
      setRangeChartError(null);
      try {
        const params = new URLSearchParams({
          vs_currency: "usd",
          days: String(rangeConfig.days),
        });
        const response = await fetch(
          `https://api.coingecko.com/api/v3/coins/${coingeckoId}/market_chart?${params.toString()}`,
          {
            headers: { Accept: "application/json", Authorization: `Bearer ${authToken}` },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`CoinGecko ${response.status} - ${response.statusText}`);
        }

        const payload = await response.json();
        setRangeChartData(normalizeMarketChart(payload.prices, chartRange));
        setRangeChartStatus("ready");
      } catch (err) {
        if (err?.name === "AbortError") return;
        console.error("[DashboardPage] chart range fetch error", err);
        setRangeChartData([]);
        setRangeChartError(err instanceof Error ? err : new Error("Chart range fetch failed"));
        setRangeChartStatus("error");
      }
    };

    loadRangeChart();

    return () => controller.abort();
  }, [coin?.symbol, chartRange]);

  useEffect(() => {
    if (!coins.length) return;
    if (!coinsMap[selected]) {
      setSelected(coins[0].symbol);
    }
  }, [coins, coinsMap, selected, setSelected]);

  useEffect(() => {
    if (dcaSymbolTouched) return;
    if (selected) {
      setDcaTargetSymbol(selected);
    }
  }, [selected, dcaSymbolTouched]);

  useEffect(() => {
    setAlertSymbol(selected);
  }, [selected]);

  useEffect(() => {
    if (!coin?.price || alertSymbol !== coin.symbol) return;
    setConditionState((prev) => {
      const currentValue = Number(prev.price?.value);
      const nextValue = Number(coin.price.toFixed(2));
      if (prev.price?.touched || currentValue === nextValue) {
        return prev;
      }
      return {
        ...prev,
        price: {
          ...prev.price,
          value: nextValue,
        },
      };
    });
  }, [coin, alertSymbol]);

  useEffect(() => {
    if (!custodianHoldingsMap) return;
    setHoldings((prev) => ({
      ...prev,
      ...custodianHoldingsMap,
    }));
  }, [custodianHoldingsMap, setHoldings]);

  const selectionUniverse = useMemo(() => {
    if (coins.length) return coins;
    return trackedUniverse.map((symbol) => ({
      symbol,
      name: MARKET_UNIVERSE[symbol]?.name || symbol,
    }));
  }, [coins, trackedUniverse]);

  const chartData = useMemo(() => {
    if (rangeChartData.length) return rangeChartData;
    if (!coin?.sparkline?.length) return [];
    if (chartRange === "24h") return coin.sparkline.slice(-24);
    if (chartRange === "7j") return coin.sparkline;
    return [];
  }, [chartRange, coin, rangeChartData]);

  const heroOrderBook = hasLiveCoin ? orderBooks[coin.symbol] : null;
  const hasOrderBookData =
    Boolean(heroOrderBook?.bids?.length) && Boolean(heroOrderBook?.asks?.length);
  const isMarketLoading =
    marketStatus === "loading" || marketStatus === "refreshing";
  const errorPreview = marketError?.message
    ? `${marketError.message.split(" ").slice(0, 4).join(" ")}...`
    : null;
  const chartRangeLabel = CHART_RANGES[chartRange]?.label || chartRange;

  const streamIndicator = useMemo(() => {
    switch (streamStatus) {
      case "connected":
        return { label: "Flux temps reel", className: "badge-success" };
      case "error":
        return { label: "Flux instable", className: "badge-danger" };
      case "closed":
        return { label: "Flux en pause", className: "badge-muted" };
      default:
        return { label: "Connexion flux...", className: "badge-muted" };
    }
  }, [streamStatus]);

  const totalValue = useMemo(() => {
    if (!coins.length) return 0;
    return coins.reduce((sum, item) => {
      const amount = Number(holdings[item.symbol] || 0);
      return sum + amount * item.price;
    }, 0);
  }, [coins, holdings]);

  const allocation = useMemo(() => {
    if (!coins.length) return [];
    return coins
      .map((item) => {
        const value = (Number(holdings[item.symbol]) || 0) * item.price;
        const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
        return {
          ...item,
          value,
          pct,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [coins, holdings, totalValue]);

  const sentiment = useMemo(() => {
    if (!coins.length) return "Chargement marche...";
    const bullish = coins.filter((item) => item.change24h > 0).length;
    if (bullish / coins.length >= 0.75) return "Marche dynamique";
    if (bullish / coins.length >= 0.5) return "Marche indecise";
    return "Marche prudente";
  }, [coins]);

  const sectorHeatmap = useMemo(() => {
    if (!coins.length) return [];
    const buckets = coins.reduce((acc, item) => {
      const key = item.category || "Divers";
      if (!acc[key]) {
        acc[key] = { change: 0, count: 0, volume: 0 };
      }
      acc[key].change += item.change24h || 0;
      acc[key].count += 1;
      acc[key].volume += item.volume24h || 0;
      return acc;
    }, {});

    return Object.entries(buckets)
      .map(([category, stats]) => ({
        category,
        avgChange: stats.count ? stats.change / stats.count : 0,
        weight: stats.volume,
      }))
      .sort((a, b) => b.weight - a.weight);
  }, [coins]);

  const primaryHeatmapWeight =
    sectorHeatmap.length && sectorHeatmap[0].weight
      ? sectorHeatmap[0].weight
      : 1;

  const filteredResearch = useMemo(() => {
    return researchFeed;
  }, [researchFeed]);

  const custodyPositionMap = useMemo(() => {
    return custodianPositions.reduce((acc, position) => {
      acc[position.symbol] = position;
      return acc;
    }, {});
  }, [custodianPositions]);

  const walletHoldingsList = useMemo(() => {
    return selectionUniverse.map((item) => {
      const walletAmount = walletBalances[item.symbol] ?? 0;
      const custodyAmount = holdings[item.symbol] ?? 0;
      const livePrice = coinsMap[item.symbol]?.price ?? 0;
      const totalValue = livePrice * custodyAmount;
      return {
        symbol: item.symbol,
        walletAmount,
        custodyAmount,
        totalValue,
        price: livePrice,
        provider: custodyPositionMap[item.symbol]?.provider || "Custodian",
      };
    });
  }, [
    selectionUniverse,
    walletBalances,
    holdings,
    coinsMap,
    custodyPositionMap,
  ]);

  const dcaTargetCoin = useMemo(() => {
    return (
      coinsMap[dcaTargetSymbol] ||
      coins.find((item) => item.symbol === dcaTargetSymbol) ||
      coin
    );
  }, [coins, coinsMap, coin, dcaTargetSymbol]);

  const dcaBuyToken = useMemo(() => {
    const meta = MARKET_UNIVERSE[dcaTargetSymbol];
    return meta?.swapToken ? resolveDcaToken(meta.swapToken, dcaChainId) : null;
  }, [dcaTargetSymbol, dcaChainId]);

  const dcaPlanPreview = useMemo(() => {
    if (!dcaAmount || dcaAmount <= 0) {
      return { occurrences: 0, totalInvested: 0, projectedTokens: 0 };
    }
    const runsPerMonth =
      dcaFrequency === "quotidien"
        ? 30
        : dcaFrequency === "hebdo"
          ? 4
          : dcaFrequency === "mensuel"
            ? 1
            : 2;
    const occurrences = Math.max(1, Math.round(dcaMonths * runsPerMonth));
    const totalInvested = occurrences * dcaAmount;
    const price = dcaTargetCoin?.price || coin?.price || 0;
    const projectedTokens = price > 0 ? totalInvested / price : 0;
    return { occurrences, totalInvested, projectedTokens };
  }, [dcaAmount, dcaMonths, dcaFrequency, dcaTargetCoin, coin]);

  const dcaQuoteMetrics = useMemo(() => {
    if (!dcaQuote) return null;
    const buyDecimals = Number(dcaQuote.buyTokenDecimals ?? 18);
    const sellDecimals = Number(dcaQuote.sellTokenDecimals ?? 6);
    const buyAmountTokens = Number(dcaQuote.buyAmount) / 10 ** buyDecimals;
    const sellAmountUnits = Number(dcaQuote.sellAmount) / 10 ** sellDecimals;
    const sources = Array.isArray(dcaQuote.sources)
      ? dcaQuote.sources.filter((source) => Number(source.proportion) > 0)
      : [];
    return {
      buyAmountTokens,
      sellAmountUnits,
      price: Number(dcaQuote.price),
      guaranteedPrice: Number(dcaQuote.guaranteedPrice),
      estimatedGas: dcaQuote.estimatedGas,
      sources,
    };
  }, [dcaQuote]);

  useEffect(() => {
    if (
      !authToken || !walletAccount ||
      !dcaTargetSymbol ||
      !dcaAmount ||
      dcaAmount <= 0 ||
      dcaProvider !== "0x"
    ) {
      setDcaQuote(null);
      setDcaQuoteError(dcaProvider === "0x" ? null : null);
      return undefined;
    }

    const meta = MARKET_UNIVERSE[dcaTargetSymbol];
    if (!meta?.swapToken || !dcaBuyToken || !dcaSellToken) {
      setDcaQuote(null);
      setDcaQuoteError(new Error("Paire ou reseau non supporte pour l'execution 0x."));
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadQuote = async () => {
      setIsFetchingQuote(true);
      setDcaQuoteError(null);
      try {
        const params = new URLSearchParams({
          sellToken: dcaSellToken.address,
          buyToken: dcaBuyToken.native ? dcaBuyToken.symbol : dcaBuyToken.address,
          sellAmount: decimalToUnits(dcaAmount, dcaSellToken.decimals),
          slippagePercentage: (Number(dcaSlippage) / 100).toString(),
          chainId: String(dcaChainId),
        });
        if (walletAccount) params.append("takerAddress", walletAccount);

        const response = await fetch(
          `${ZEROX_QUOTE_ENDPOINT}?${params.toString()}`,
          {
            headers: { Accept: "application/json", Authorization: `Bearer ${authToken}` },
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}));
          const message = failure.error || (
            response.status === 404
              ? "Aucune route 0x disponible pour cet actif ou ce montant. Essaie un autre actif, augmente le montant ou desactive 0x."
              : `Quote 0x indisponible (${response.status}). Reessaie plus tard ou verifie la paire selectionnee.`);
          throw new Error(message);
        }
        const payload = await response.json();
        if (cancelled) return;
        setDcaQuote(payload);
      } catch (err) {
        if (cancelled) return;
        console.error("[dca] quote error", err);
        setDcaQuote(null);
        setDcaQuoteError(
          err instanceof Error ? err : new Error("0x quote error"),
        );
      } finally {
        if (!cancelled) {
          setIsFetchingQuote(false);
        }
      }
    };

    loadQuote();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dcaTargetSymbol, dcaAmount, dcaSlippage, dcaProvider, dcaBuyToken, dcaSellToken, walletAccount, dcaChainId, authToken, quoteRefreshTick]);

  const custodyTargetPosition = custodyPositionMap[dcaTargetSymbol];
  const custodyAverageCost =
    custodyTargetPosition &&
    custodyTargetPosition.amount > 0 &&
    custodyTargetPosition.costBasis
      ? custodyTargetPosition.costBasis / custodyTargetPosition.amount
      : null;

  const availableStableBalance = walletBalances[dcaBaseStable] ?? 0;
  const canExecuteDca = Boolean(
    userId && authToken &&
    walletAccount && dcaQuote && dcaSellToken && dcaBuyToken && !isExecutingDca,
  );
  const canScheduleDca = Boolean(
    userId && authToken &&
    walletAccount &&
      dcaPlanPreview.occurrences &&
      dcaSellToken &&
      dcaBuyToken &&
      !isSchedulingDca,
  );

  const activeAlertConditions = useMemo(() => {
    return CONDITION_DEFINITIONS.map((definition) => {
      const state = conditionState[definition.key];
      if (!state?.enabled) return null;
      if (
        state.value === "" ||
        state.value === null ||
        state.value === undefined
      ) {
        return null;
      }
      const rawValue = Number(state.value);
      if (!Number.isFinite(rawValue)) return null;
      if (definition.min !== undefined && rawValue < definition.min)
        return null;
      return {
        type: definition.key,
        operator: definition.operator,
        value: rawValue,
        unit: definition.unit,
      };
    }).filter(Boolean);
  }, [conditionState]);

  const canSubmitAlert = Boolean(
    userId && authToken && alertSymbol && activeAlertConditions.length && !isSubmittingAlert,
  );
  const isAlertsSyncing =
    alertsStatus === "loading" || alertsStatus === "refreshing";

  function toggleCondition(key) {
    setConditionState((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || { enabled: false, value: "", touched: false }),
        enabled: !prev[key]?.enabled,
      },
    }));
  }

  function updateConditionValue(key, nextValue) {
    setConditionState((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || { enabled: false, value: "", touched: false }),
        value: nextValue,
        touched: true,
      },
    }));
  }

  function formatConditionPreview(condition) {
    if (!condition) return "";
    const value = Number(condition.value);
    switch (condition.type) {
      case "price":
        return `Prix ${condition.operator === "lte" ? "≤" : "≥"} ${formatMoney(value)}`;
      case "drawdown":
        return `Drawdown ≥ ${value.toFixed(1)}%`;
      case "volume":
        return `Volume ≥ ${formatCompact(value, { style: "currency", currency: "USD" })}`;
      case "funding":
        return `Funding ≥ ${value.toFixed(3)}%`;
      default:
        return `${condition.type} ${condition.operator} ${value}`;
    }
  }

  async function handleCreateAlert() {
    if (!canSubmitAlert) return;
    const payload = {
      symbol: alertSymbol,
      label: alertName || `${alertSymbol} multi-signal`,
      note: alertNote || null,
      channel: alertChannel,
      status: "active",
      conditions: activeAlertConditions,
      user_id: userId,
    };
    try {
      setIsSubmittingAlert(true);
      await createAlert(payload);
      setAlertName("");
      setAlertNote("");
      setConditionState((prev) => {
        const next = { ...prev };
        CONDITION_DEFINITIONS.forEach((definition) => {
          const current = prev[definition.key] || { value: "", touched: false };
          next[definition.key] = {
            ...current,
            touched: false,
            enabled: definition.key === "price",
          };
        });
        return next;
      });
    } catch (err) {
      console.error("[alerts] creation error", err);
    } finally {
      setIsSubmittingAlert(false);
    }
  }

  async function handleDeleteAlert(id) {
    try {
      await deleteAlert(id);
    } catch (err) {
      console.error("[alerts] delete error", err);
    }
  }

  async function handleRunAlertCheck() {
    try {
      await runAlertCheck();
    } catch (err) {
      console.error("[alerts] worker check error", err);
    }
  }

  async function saveConnectedWalletToHub() {
    if (!walletAccount || !userId) return;
    setWalletSaveStatus("saving");
    setWalletSaveMessage(null);
    try {
      const providerLabel =
        walletConnectors.find((connector) => connector.id === walletConnectorId)?.label ||
        walletConnectorId ||
        "wallet";
      const response = await fetch("/api/wallets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          user_id: userId,
          name: `${providerLabel} ${walletNetwork || "EVM"}`,
          wallet_type: "self-custody",
          provider: walletConnectorId || "walletconnect",
          address: walletAccount,
          network: String(walletNetwork || "ethereum").toLowerCase(),
          chain_family: "evm",
          connection_status: "connected",
          metadata: {
            source: "dashboard-connected-wallet",
            chainId: walletChainId,
          },
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Wallet API ${response.status}`);
      }
      setWalletSaveMessage("Wallet enregistre dans le hub.");
      setWalletSaveStatus("ready");
    } catch (err) {
      setWalletSaveMessage(err instanceof Error ? err.message : "Enregistrement impossible.");
      setWalletSaveStatus("error");
    }
  }

  async function executeDcaNow() {
    if (!canExecuteDca || !dcaQuote) return;
    setDcaExecutionMessage(null);
    setIsExecutingDca(true);
    let submittedHash = null;
    try {
      if (!sendSwapQuote) {
        throw new Error("Wallet incompatible avec l'execution de transaction.");
      }
      const payload = {
        account: walletAccount,
        user_id: userId,
        connector: walletConnectorId,
        provider: dcaProvider,
        quote: dcaQuote,
        metadata: {
          targetSymbol: dcaTargetSymbol,
          sellToken: dcaQuote.sellTokenAddress,
          sellTokenAddress: dcaQuote.sellTokenAddress,
          buyToken: dcaQuote.buyTokenAddress,
          buyTokenAddress: dcaQuote.buyTokenAddress,
          sellAmount: dcaQuote.sellAmount,
          buyAmount: dcaQuote.buyAmount,
          chainId: dcaChainId,
        },
      };

      const response = await fetch(executionsEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Execution API ${response.status}`);
      }
      const prepared = await response.json();
      setDcaExecutionMessage("Ordre prepare. Signature wallet requise...");

      const txHash = await sendSwapQuote(prepared.quote);
      submittedHash = txHash;
      rememberTransaction(prepared.id, txHash);
      setDcaQuote(null);

      if (prepared?.id) {
        const statusResponse = await fetch(`/api/dca-executions/${prepared.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({
            status: "submitted",
            tx_hash: txHash,
            user_id: userId,
          }),
        });
        if (!statusResponse.ok) throw new Error("Statut non synchronise.");
      }

      setDcaExecutionMessage(`Transaction envoyee: ${txHash}`);
      refreshWallet();
    } catch (err) {
      console.error("[dca] execute error", err);
      setDcaExecutionMessage(
        submittedHash ? `Transaction envoyee : ${submittedHash}. Statut non synchronise ; ne la renvoie pas.` : (err instanceof Error ? err.message : "Execution impossible."),
      );
    } finally {
      setIsExecutingDca(false);
    }
  }

  async function scheduleDcaPlan() {
    if (!canScheduleDca) return;
    setDcaScheduleMessage(null);
    setIsSchedulingDca(true);
    try {
      const payload = {
        account: walletAccount,
        user_id: userId,
        provider: dcaProvider,
        symbol: dcaTargetSymbol,
        amountPerRun: dcaAmount,
        frequency: dcaFrequency,
        occurrences: dcaPlanPreview.occurrences,
        startDate: dcaStartDate,
        slippage: dcaSlippage,
        chainId: dcaChainId,
        baseStable: dcaSellToken?.symbol || dcaBaseStable,
        sellToken: dcaSellToken?.address,
        buyToken: dcaBuyToken?.address,
      };
      const response = await fetch(dcaScheduleEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Plan API ${response.status}`);
      }
      const result = await response.json();
      setDcaScheduleMessage(
        result?.message || "Plan DCA programme via le backend.",
      );
    } catch (err) {
      console.error("[dca] schedule error", err);
      setDcaScheduleMessage(
        err instanceof Error ? err.message : "Planification impossible.",
      );
    } finally {
      setIsSchedulingDca(false);
    }
  }

  function handleSyncHoldingFromWallet(symbol) {
    if (!walletBalances || walletBalances[symbol] === undefined) return;
    updateHolding(symbol, walletBalances[symbol]);
  }

  function handleSyncHoldingFromCustody(symbol) {
    if (!custodianHoldingsMap || custodianHoldingsMap[symbol] === undefined)
      return;
    updateHolding(symbol, custodianHoldingsMap[symbol]);
  }

  function handleBulkSync(source = "custody") {
    if (source === "wallet" && walletBalances) {
      Object.entries(walletBalances).forEach(([symbol, value]) => {
        if (MARKET_UNIVERSE[symbol]) {
          updateHolding(symbol, value);
        }
      });
      return;
    }
    if (source === "custody" && custodianHoldingsMap) {
      Object.entries(custodianHoldingsMap).forEach(([symbol, value]) => {
        updateHolding(symbol, value);
      });
    }
  }

  function updateHolding(rawSymbol, nextValue) {
    const symbol = rawSymbol.toUpperCase();
    setHoldings((prev) => ({
      ...prev,
      [symbol]: Number(nextValue) || 0,
    }));
  }

  function toggleWatch(rawSymbol) {
    const symbol = rawSymbol.toUpperCase();
    if (!MARKET_UNIVERSE[symbol]) return;
    setWatchlist((prev) =>
      prev.includes(symbol)
        ? prev.filter((item) => item !== symbol)
        : [...prev, symbol],
    );
  }

  return (
    <>
      <header className="topbar reveal">
        <div className="brand">
          <div>
            <h1>Studio</h1>
          </div>
        </div>

        <div className="controls">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value.toUpperCase())}
            className="field"
          >
            {selectionUniverse.map((item) => (
              <option key={item.symbol} value={item.symbol}>
                {item.symbol} - {item.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="dashboard-grid reveal delay-1">
        <div className="dashboard-main">
          <section className="asset-cluster">
            <article className="card hero-main">
              <div className="hero-line">
                <div className="coin-title">
                  <p className="eyebrow">Actif focus</p>
                  <h2>
                    {coin.name} <span>{coin.symbol}</span>
                  </h2>
                </div>
                <strong className="hero-price">{formatMoney(coin.price)}</strong>
                <strong
                  className={`hero-change ${coin.change24h >= 0 ? "up" : "down"}`}
                >
                  {formatPct(coin.change24h)}
                </strong>
                <button
                  type="button"
                  className={`watch ${watchlist.includes(coin.symbol) ? "active" : ""}`}
                  onClick={() => toggleWatch(coin.symbol)}
                >
                  {watchlist.includes(coin.symbol)
                    ? "Dans watchlist"
                    : "Ajouter watchlist"}
                </button>
              </div>

              <div className="live-controls">
                <div className="badges">
                  <span className={`badge ${streamIndicator.className}`}>
                    {streamIndicator.label}
                  </span>
                  {isMarketLoading && (
                    <span className="badge badge-muted">Mise a jour...</span>
                  )}
                  {errorPreview && (
                    <span
                      className="badge badge-danger"
                      title={marketError?.message}
                    >
                      API: {errorPreview}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="ghost"
                  onClick={refreshMarket}
                  disabled={isMarketLoading}
                >
                  Sync
                </button>
              </div>

              <div className="metric-grid">
                <div>
                  <label>7 jours</label>
                  <strong className={coin.change7d >= 0 ? "up" : "down"}>
                    {formatPct(coin.change7d)}
                  </strong>
                </div>
                <div>
                  <label>Volume 24h</label>
                  <strong>
                    {formatCompact(coin.volume24h, {
                      style: "currency",
                      currency: "USD",
                    })}
                  </strong>
                </div>
                <div>
                  <label>Dominance</label>
                  <strong>{formatPct(coin.dominance)}</strong>
                </div>
                <div>
                  <label>Profil</label>
                  <strong>{coin.volatility}</strong>
                </div>
              </div>

              <div className="chart-head">
                <div>
                  <h3>Évolution du prix</h3>
                  <p>{coin.category} / survoler le graphique pour le detail</p>
                </div>
                <div className="badges">
                  <span className="badge badge-muted">{chartRangeLabel}</span>
                  {rangeChartStatus === "loading" && (
                    <span className="badge badge-muted">Chargement...</span>
                  )}
                  {rangeChartError && (
                    <span
                      className="badge badge-danger"
                      title={rangeChartError.message}
                    >
                      Graphique indisponible
                    </span>
                  )}
                </div>
                <div className="period-tabs" aria-label="Periode du graphique">
                  {["24h", "7j", "30j", "1an"].map((range) => (
                    <button
                      key={range}
                      type="button"
                      className={chartRange === range ? "active" : ""}
                      onClick={() => setChartRange(range)}
                    >
                      {range}
                    </button>
                  ))}
                </div>
              </div>

              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{ top: 12, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 5"
                      stroke="rgba(255, 255, 255, 0.10)"
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 12, fill: "rgba(238,245,241,0.72)" }}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: "rgba(238,245,241,0.72)" }}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="var(--line-color)"
                      strokeWidth={3}
                      dot={false}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {hasOrderBookData && (
                <div className="orderbook">
                  <div>
                    <p className="eyebrow">Carnet achat</p>
                    <div className="orderbook-rows">
                      {heroOrderBook.bids.map((level, index) => (
                        <div key={`bid-${index}`} className="orderbook-row bid">
                          <span>{formatMoney(level.price)}</span>
                          <span>{level.size.toFixed(3)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="eyebrow">Carnet vente</p>
                    <div className="orderbook-rows">
                      {heroOrderBook.asks.map((level, index) => (
                        <div key={`ask-${index}`} className="orderbook-row ask">
                          <span>{formatMoney(level.price)}</span>
                          <span>{level.size.toFixed(3)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </article>

          </section>

          <section className="execution-cluster reveal delay-2">
            <article className="card execution-panel">
              <div className="execution-head">
                <div>
                  <p className="eyebrow">Wallet / Custodian</p>
                  <h3>Connexion et synchronisation</h3>
                </div>
                <div className="wallet-badges">
                  <span
                    className={`badge ${
                      walletStatus === "connected"
                        ? "badge-success"
                        : walletStatus === "error"
                          ? "badge-danger"
                          : "badge-muted"
                    }`}
                  >
                    Wallet: {walletStatus}
                  </span>
                  <span
                    className={`badge ${
                      custodyStatus === "ready"
                        ? "badge-success"
                        : custodyStatus === "error"
                          ? "badge-danger"
                          : "badge-muted"
                    }`}
                  >
                    Custodian: {custodyStatus}
                  </span>
                </div>
              </div>

              <div className="wallet-primary-row">
                <div>
                  <small>Compte actif</small>
                  <strong>{walletAccount || "Non connecte"}</strong>
                  <p>{walletNetwork || "Reseau non detecte"}</p>
                </div>
                {walletStatus === "connected" ? (
                  <div className="wallet-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={saveConnectedWalletToHub}
                      disabled={!userId || walletSaveStatus === "saving"}
                    >
                      {walletSaveStatus === "saving" ? "Enregistrement..." : "Enregistrer ce wallet"}
                    </button>
                    <button
                      type="button"
                      className="primary-action"
                      onClick={() => {
                        refreshWallet();
                        refreshCustody();
                      }}
                      disabled={
                        custodyStatus === "loading" ||
                        custodyStatus === "refreshing"
                      }
                    >
                      Synchroniser
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="primary-action"
                    onClick={() => connectWallet(walletConnectors[0]?.id)}
                    disabled={!walletConnectors[0] || walletStatus === "connecting"}
                  >
                    Connecter un wallet
                  </button>
                )}
              </div>
              {walletError && (
                <p className="error-text">Wallet: {walletError.message}</p>
              )}
              {custodyError && (
                <p className="error-text">Custodian: {custodyError.message}</p>
              )}
              {custodyLastUpdated && (
                <p className="helper-text small">
                  Derniere synchro custodian:{" "}
                  {custodyLastUpdated.toLocaleString("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "2-digit",
                    month: "short",
                  })}
                </p>
              )}
              {walletSaveMessage && (
                <p className={walletSaveStatus === "error" ? "error-text" : "info-text"}>
                  {walletSaveMessage}
                </p>
              )}

              <details className="technical-details">
                <summary>Connecteurs disponibles</summary>
                <div className="connector-grid compact">
                  {walletConnectors.map((connector) => (
                    <button
                      key={connector.id}
                      type="button"
                      className={`connector-card ${
                        walletConnectorId === connector.id ? "active" : ""
                      }`}
                      onClick={() => connectWallet(connector.id)}
                      disabled={
                        walletStatus === "connecting" &&
                        walletConnectorId === connector.id
                      }
                    >
                      <strong>{connector.label}</strong>
                      <p>{connector.description}</p>
                    </button>
                  ))}
                  {walletStatus === "connected" && (
                    <button
                      type="button"
                      className="connector-card ghost"
                      onClick={disconnectWallet}
                    >
                      Deconnecter
                    </button>
                  )}
                </div>
              </details>

              <div className="wallet-holdings-grid">
                <div className="wallet-row wallet-row-head">
                  <span>Actif</span>
                  <span>Wallet</span>
                  <span>Custodian</span>
                  <span>Valeur</span>
                  <span>Actions</span>
                </div>
                {walletHoldingsList.map((item) => (
                  <div key={item.symbol} className="wallet-row">
                    <strong>{item.symbol}</strong>
                    <span>
                      {(item.walletAmount || 0).toLocaleString("fr-FR", {
                        maximumFractionDigits: 4,
                      })}
                    </span>
                    <span>
                      {(item.custodyAmount || 0).toLocaleString("fr-FR", {
                        maximumFractionDigits: 4,
                      })}
                    </span>
                    <span>{formatMoney(item.totalValue || 0)}</span>
                    <div className="row-actions">
                      <select
                        className="action-menu"
                        defaultValue=""
                        onChange={(event) => {
                          if (event.target.value === "wallet") {
                            handleSyncHoldingFromWallet(item.symbol);
                          }
                          if (event.target.value === "custody") {
                            handleSyncHoldingFromCustody(item.symbol);
                          }
                          event.target.value = "";
                        }}
                      >
                        <option value="">Action</option>
                        <option value="wallet">Depuis wallet</option>
                        <option value="custody">Depuis custodian</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="wallet-sync-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    handleBulkSync("custody");
                    handleBulkSync("wallet");
                  }}
                  disabled={!custodianHoldingsMap && !walletBalances}
                >
                  Importer tous les soldes disponibles
                </button>
              </div>
            </article>

            <article className="card dca-panel">
              <div className="dca-head">
                <div>
                  <p className="eyebrow">DCA</p>
                  <h3>Plan d’investissement programme</h3>
                </div>
                <span className="badge badge-muted">
                  {dcaProvider.toUpperCase()}
                </span>
              </div>

              <div className="dca-section">
                <h4>Configuration</h4>
                <div className="dca-fields advanced">
                  <label>
                    <span>Actif cible</span>
                    <select
                      value={dcaTargetSymbol}
                      onChange={(e) => {
                        setDcaSymbolTouched(true);
                        setDcaTargetSymbol(e.target.value);
                      }}
                    >
                      {selectionUniverse.map((item) => (
                        <option key={item.symbol} value={item.symbol}>
                          {item.symbol} - {item.name || item.symbol}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Montant par run</span>
                    <input
                      type="number"
                      min="10"
                      step="10"
                      value={dcaAmount}
                      onChange={(e) => setDcaAmount(Number(e.target.value) || 0)}
                    />
                  </label>
                  <label>
                    <span>Frequence</span>
                    <select
                      value={dcaFrequency}
                      onChange={(e) => setDcaFrequency(e.target.value)}
                    >
                      <option value="quotidien">Quotidien</option>
                      <option value="hebdo">Hebdomadaire</option>
                      <option value="bimensuel">Bi-mensuel</option>
                      <option value="mensuel">Mensuel</option>
                    </select>
                  </label>
                  <label>
                    <span>Duree (mois)</span>
                    <input
                      type="number"
                      min="1"
                      max="36"
                      value={dcaMonths}
                      onChange={(e) => setDcaMonths(Number(e.target.value) || 1)}
                    />
                  </label>
                  <label>
                    <span>Date debut</span>
                    <input
                      type="date"
                      value={dcaStartDate}
                      onChange={(e) => setDcaStartDate(e.target.value)}
                    />
                  </label>
                </div>

                <details className="technical-details">
                  <summary>Options avancees</summary>
                  <label className="field-block">
                    <span>Slippage (%)</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0.05"
                      value={dcaSlippage}
                      onChange={(e) =>
                        setDcaSlippage(Number(e.target.value) || 0)
                      }
                    />
                  </label>
                </details>
              </div>

              <div className="dca-summary">
                <strong>
                  {dcaAmount.toLocaleString("fr-FR", {
                    maximumFractionDigits: 2,
                  })}{" "}
                  {dcaBaseStable} par {dcaFrequency} pendant {dcaMonths} mois
                </strong>
                <p>
                  Montant total estime :{" "}
                  <span>{formatMoney(dcaPlanPreview.totalInvested)}</span>
                </p>
                <div className="dca-stats">
                  <div>
                    <small>Stable dispo</small>
                    <strong>
                      {availableStableBalance
                        ? `${availableStableBalance.toLocaleString("fr-FR", {
                            maximumFractionDigits: 2,
                          })} ${dcaBaseStable}`
                        : `0 ${dcaBaseStable}`}
                    </strong>
                  </div>
                  <div>
                    <small>Runs planifies</small>
                    <strong>{dcaPlanPreview.occurrences}</strong>
                  </div>
                  <div>
                    <small>Tokens projetes</small>
                    <strong>{dcaPlanPreview.projectedTokens.toFixed(4)}</strong>
                  </div>
                </div>
              </div>

              <div className="dca-section execution">
                <h4>Execution</h4>
                {!authToken && <p className="helper-text">Connecte ton compte dans Comptes pour utiliser le DCA.</p>}
                <button type="button" className="ghost" disabled={!authToken || !walletAccount || isFetchingQuote || isExecutingDca}
                  onClick={() => setQuoteRefreshTick(tick => tick + 1)}>Actualiser le devis</button>
                <div>
                  {isFetchingQuote && (
                    <span className="badge badge-muted">Recherche du prix...</span>
                  )}
                  {dcaQuoteMetrics && (
                    <div className="quote-grid">
                      <div>
                        <small>Prix</small>
                        <strong>
                          {dcaQuoteMetrics.price?.toFixed(5) || "--"}
                        </strong>
                      </div>
                      <div>
                        <small>Garantis</small>
                        <strong>
                          {dcaQuoteMetrics.guaranteedPrice?.toFixed(5) || "--"}
                        </strong>
                      </div>
                      <div>
                        <small>Token achetes</small>
                        <strong>
                          {dcaQuoteMetrics.buyAmountTokens?.toFixed(4)}
                        </strong>
                      </div>
                      <div>
                        <small>Gas estime</small>
                        <strong>{dcaQuoteMetrics.estimatedGas || "--"}</strong>
                      </div>
                    </div>
                  )}
                  {!dcaQuoteMetrics && !dcaQuoteError && (
                    <p className="helper-text">
                      Le prix 0x se met a jour avec l'actif, le montant et le wallet connecte.
                    </p>
                  )}
                  {dcaQuoteError && (
                    <p className="error-text">{dcaQuoteError.message}</p>
                  )}
                </div>
                <div className="dca-actions">
                  <div>
                    <button
                      type="button"
                      className="primary-action"
                      onClick={executeDcaNow}
                      disabled={!canExecuteDca}
                    >
                      {isExecutingDca ? "Execution..." : "Executer maintenant"}
                    </button>
                    <small>Prepare l'ordre puis ouvre la signature dans le wallet.</small>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="ghost"
                      onClick={scheduleDcaPlan}
                      disabled={!canScheduleDca}
                    >
                      {isSchedulingDca ? "Planification..." : "Programmer le plan"}
                    </button>
                    <small>Enregistre le calendrier pour les prochains runs.</small>
                  </div>
                </div>
                {dcaExecutionMessage && (
                  <p className="info-text">{dcaExecutionMessage}</p>
                )}
                <DcaPendingPanel authToken={authToken} walletAccount={walletAccount} sendSwapQuote={sendSwapQuote}
                  refreshWallet={refreshWallet} refreshTick={dcaScheduleMessage} />
                {dcaScheduleMessage && (
                  <p className="info-text">{dcaScheduleMessage}</p>
                )}
              </div>
            </article>
          </section>

          <section className="intel-cluster reveal delay-3">
            <article className="card stats-panel market-context">
              <div className="heatmap-head">
                <p className="eyebrow">Contexte marche</p>
                <span className={`badge ${macroStatus === "error" ? "badge-danger" : "badge-muted"}`}>
                  {macroStatus === "loading" || macroStatus === "refreshing"
                    ? "Sync macro..."
                    : macroMeta?.cached
                      ? "Cache API"
                      : "API live"}
                </span>
              </div>
              {macroError && (
                <p className="error-text">Macro: {macroError.message}</p>
              )}
              {macroMeta?.errors?.length > 0 && (
                <p className="helper-text">
                  {macroMeta.errors.length} source(s) macro indisponible(s).
                </p>
              )}
              <div className="macro-grid">
                <div className="macro-item">
                  <span>Fear &amp; Greed</span>
                  <strong>
                    {macroSignals.fearGreedScore !== null
                      ? macroSignals.fearGreedScore
                      : "--"}
                  </strong>
                  <p>{macroSignals.fearGreedLabel}</p>
                </div>
                <div className="macro-item">
                  <span>Funding rates</span>
                  <strong>
                    {Number.isFinite(macroSignals.fundingRate)
                      ? formatPct(macroSignals.fundingRate)
                      : "--"}
                  </strong>
                  <p>{macroSignals.fundingLabel}</p>
                </div>
                <div className="macro-item">
                  <span>Dominance BTC / ETH</span>
                  <strong>
                    {Number.isFinite(macroSignals.btcDominance) &&
                    Number.isFinite(macroSignals.ethDominance)
                      ? `${macroSignals.btcDominance.toFixed(1)}% / ${macroSignals.ethDominance.toFixed(1)}%`
                      : "--"}
                  </strong>
                  <p>{macroSignals.dominanceLabel}</p>
                </div>
                <div className="macro-item">
                  <span>Open interest agrege</span>
                  <strong>
                    {Number.isFinite(macroSignals.openInterest)
                      ? formatCompact(macroSignals.openInterest, {
                          style: "currency",
                          currency: "USD",
                        })
                      : "--"}
                  </strong>
                  <p>
                    Par rapport a{" "}
                    {totalValue
                      ? formatMoney(totalValue)
                      : "un portefeuille neutre"}
                  </p>
                </div>
              </div>

              <div className="heatmap-head">
                <p className="eyebrow">Heatmap sectorielle</p>
                <small>Variation moyenne 24h</small>
              </div>
              <div className="sector-heatmap">
                {sectorHeatmap.length ? (
                  sectorHeatmap.map((sector) => (
                    <div
                      key={sector.category}
                      className={`heatmap-chip ${sector.avgChange >= 0 ? "up" : "down"}`}
                      style={{
                        opacity:
                          sector.weight && primaryHeatmapWeight
                            ? Math.max(
                                0.55,
                                (sector.weight / primaryHeatmapWeight) * 0.45 +
                                  0.55,
                              )
                            : 0.75,
                      }}
                    >
                      <span>{sector.category}</span>
                      <strong>{formatPct(sector.avgChange)}</strong>
                    </div>
                  ))
                ) : (
                  <p className="empty">Heatmap en cours...</p>
                )}
              </div>
            </article>

            <article className="card news-panel">
              <div className="news-panel-head">
                <div>
                  <p className="eyebrow">News &amp; Research</p>
                  <h3>Flux RSS crypto</h3>
                </div>
                <span className={`badge ${researchStatus === "error" ? "badge-danger" : "badge-muted"}`}>
                  {researchStatus === "loading" || researchStatus === "refreshing"
                    ? "Sync..."
                    : researchMeta?.cached
                      ? "Cache RSS"
                      : "RSS live"}
                </span>
              </div>

              <div className="news-tags">
                {NEWS_TAGS.map((tag) => (
                  <button
                    key={tag.key}
                    type="button"
                    className={`tag-pill ${newsFilter === tag.key ? "active" : ""}`}
                    onClick={() => setNewsFilter(tag.key)}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>

              {researchError && (
                <p className="error-text">Research: {researchError.message}</p>
              )}
              {researchMeta?.errors?.length > 0 && (
                <p className="helper-text">
                  {researchMeta.errors.length} source(s) RSS indisponible(s).
                </p>
              )}

              <div className="news-feed">
                {filteredResearch.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="news-item"
                    onClick={() => {
                      if (item.url) {
                        window.open(item.url, "_blank", "noopener,noreferrer");
                      }
                    }}
                  >
                    <div className="news-item-body">
                      <strong>{item.title}</strong>
                      <p>{item.summary}</p>
                    </div>
                    <div className="news-item-meta">
                      <span className="news-source">{item.source}</span>
                      <span>{item.time}</span>
                      <span className={`news-tag tag-${item.tag}`}>
                        {NEWS_TAGS.find((tag) => tag.key === item.tag)?.label ||
                          item.tag}
                      </span>
                    </div>
                  </button>
                ))}
                {filteredResearch.length === 0 && (
                  <p className="empty">
                    {researchStatus === "loading"
                      ? "Chargement des flux RSS..."
                      : "Aucune publication pour ce tag."}
                  </p>
                )}
              </div>
            </article>
          </section>
        </div>

        <aside className="dashboard-side">
          <WatchlistPanel
              watchlist={watchlist}
              coins={coins}
              onSelect={setSelected}
            />
          <AlertsPanel
              alerts={alerts}
              alertEvents={alertEvents}
              alertsError={alertsError}
              isAlertsSyncing={isAlertsSyncing}
              refreshAlerts={refreshAlerts}
              runAlertCheck={handleRunAlertCheck}
              alertName={alertName}
              setAlertName={setAlertName}
              alertSymbol={alertSymbol}
              setAlertSymbol={setAlertSymbol}
              selectionUniverse={selectionUniverse}
              alertNote={alertNote}
              setAlertNote={setAlertNote}
              alertChannel={alertChannel}
              setAlertChannel={setAlertChannel}
              conditionDefinitions={CONDITION_DEFINITIONS}
              conditionState={conditionState}
              toggleCondition={toggleCondition}
              updateConditionValue={updateConditionValue}
              canSubmitAlert={canSubmitAlert}
              isSubmittingAlert={isSubmittingAlert}
              handleCreateAlert={handleCreateAlert}
              handleDeleteAlert={handleDeleteAlert}
              formatConditionPreview={formatConditionPreview}
            />
          <PortfolioCard
              totalValue={totalValue}
              sentiment={sentiment}
              allocation={allocation}
              holdings={holdings}
          />
        </aside>
      </div>

    </>
  );
}

