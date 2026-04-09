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
import AlertsPanel from "../components/AlertsPanel";
import WatchlistPanel from "../components/WatchlistPanel";
import { useAppPreferences } from "../context/AppPreferencesContext";
import { formatMoney, formatPct, formatCompact } from "../utils/formatters";

const THEMES = {
  ocean: "Ocean Pulse",
  sand: "Sand Storm",
  mint: "Mint Grid",
};

const NEWS_TAGS = [
  { key: "all", label: "Tous" },
  { key: "macro", label: "Macro" },
  { key: "regulation", label: "Regulation" },
  { key: "defi", label: "DeFi" },
];

const ZEROX_QUOTE_ENDPOINT =
  process.env.REACT_APP_ZEROX_QUOTE || "https://api.0x.org/swap/v1/quote";
const DCA_BASE_STABLE = process.env.REACT_APP_DCA_STABLE || "USDC";
const EXECUTIONS_ENDPOINT =
  process.env.REACT_APP_EXECUTIONS_ENDPOINT || "/api/execute-dca";
const DCA_SCHEDULE_ENDPOINT =
  process.env.REACT_APP_DCA_SCHEDULE_ENDPOINT || "/api/dca-plans";

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

export default function DashboardPage() {
  const {
    theme,
    setTheme,
    selected,
    setSelected,
    holdings,
    setHoldings,
    watchlist,
    setWatchlist,
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
  const {
    alerts,
    status: alertsStatus,
    error: alertsError,
    createAlert,
    deleteAlert,
    refresh: refreshAlerts,
  } = useAlerts();
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
  const [isSubmittingAlert, setIsSubmittingAlert] = useState(false);

  useEffect(() => {
    if (!MARKET_UNIVERSE[selected]) {
      setSelected(Object.keys(MARKET_UNIVERSE)[0]);
    }
  }, [selected, setSelected]);

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
    balances: walletBalances,
    error: walletError,
    connect: connectWallet,
    disconnect: disconnectWallet,
    refresh: refreshWallet,
  } = useWalletBridge({ symbols: trackedUniverse });
  const {
    positions: custodianPositions,
    holdingsMap: custodianHoldingsMap,
    status: custodyStatus,
    error: custodyError,
    lastUpdated: custodyLastUpdated,
    refresh: refreshCustody,
  } = useCustodianHoldings({
    account: walletAccount,
    symbols: trackedUniverse,
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
    if (!coin?.sparkline?.length) return [];
    return coin.sparkline;
  }, [coin]);

  const heroOrderBook = hasLiveCoin ? orderBooks[coin.symbol] : null;
  const isMarketLoading =
    marketStatus === "loading" || marketStatus === "refreshing";
  const errorPreview = marketError?.message
    ? `${marketError.message.split(" ").slice(0, 4).join(" ")}...`
    : null;

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

  const macroSignals = useMemo(() => {
    if (!coins.length) {
      return {
        fearGreedScore: null,
        fearGreedLabel: "Flux indisponible",
        fundingRate: null,
        fundingLabel: "Collecte en cours",
        dominanceSpread: null,
        dominanceLabel: "Dominance en calcul",
        openInterest: null,
        btcDominance: null,
        ethDominance: null,
      };
    }

    const btc = coinsMap.BTC;
    const eth = coinsMap.ETH;
    const avg24h =
      coins.reduce((sum, item) => sum + (item.change24h || 0), 0) /
      coins.length;
    const avg7d =
      coins.reduce((sum, item) => sum + (item.change7d || 0), 0) / coins.length;
    const normalizedScore = Math.max(
      15,
      Math.min(85, Math.round(55 + avg24h * 1.5)),
    );
    const fundingRate = avg7d / 700;
    const totalVolume = coins.reduce(
      (sum, item) => sum + (item.volume24h || 0),
      0,
    );
    const openInterest = totalVolume * 0.032;
    const dominanceSpread = (btc?.dominance || 0) - (eth?.dominance || 0);

    const fearGreedLabel =
      normalizedScore >= 65
        ? "Greed"
        : normalizedScore <= 35
          ? "Fear"
          : "Neutral";

    let fundingLabel = "Neutre";
    if (fundingRate > 0.002) {
      fundingLabel = "Long bias";
    } else if (fundingRate < -0.002) {
      fundingLabel = "Short bias";
    }

    const dominanceLabel =
      dominanceSpread >= 0
        ? `BTC +${dominanceSpread.toFixed(1)} pts`
        : `ETH +${Math.abs(dominanceSpread).toFixed(1)} pts`;

    return {
      fearGreedScore: normalizedScore,
      fearGreedLabel,
      fundingRate,
      fundingLabel,
      dominanceSpread,
      dominanceLabel,
      openInterest,
      btcDominance: btc?.dominance ?? null,
      ethDominance: eth?.dominance ?? null,
    };
  }, [coins, coinsMap]);

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

  const topMover24h = useMemo(() => {
    if (!coins.length) return null;
    return [...coins].sort(
      (a, b) => (b.change24h || 0) - (a.change24h || 0),
    )[0];
  }, [coins]);

  const researchFeed = useMemo(() => {
    const safePct = (value) =>
      Number.isFinite(value) ? formatPct(value) : "N/A";
    const safeMoney = (value) =>
      Number.isFinite(value)
        ? formatCompact(value, { style: "currency", currency: "USD" })
        : "N/A";
    const now = Date.now();

    const entries = [
      {
        id: "rss-macro",
        source: "MacroScope RSS",
        tag: "macro",
        title: "Macro liquidity check",
        summary: `Fear & Greed à ${
          macroSignals.fearGreedScore ?? "N/A"
        } (${macroSignals.fearGreedLabel}) et funding ${
          macroSignals.fundingLabel
        }.`,
        minutesAgo: 18,
      },
      {
        id: "twitter-defi",
        source: "CryptoTwitter",
        tag: "defi",
        title: topMover24h
          ? `${topMover24h.symbol} lead les flows DeFi`
          : "DeFi rotation",
        summary: topMover24h
          ? `${topMover24h.symbol} affiche ${safePct(
              topMover24h.change24h,
            )} avec ${safeMoney(topMover24h.volume24h)} d'activité.`
          : "Variation forte sur les tokens DeFi suivis.",
        minutesAgo: 42,
      },
      {
        id: "glassnode-oi",
        source: "Glassnode",
        tag: "macro",
        title: "Open interest agrégé",
        summary: `OI global ${
          macroSignals.openInterest
            ? formatCompact(macroSignals.openInterest, {
                style: "currency",
                currency: "USD",
              })
            : "non disponible"
        }, spread dominance ${macroSignals.dominanceLabel}.`,
        minutesAgo: 7,
      },
      {
        id: "reg-watch",
        source: "Regulation Wire",
        tag: "regulation",
        title: "Cadre régulatoire US",
        summary:
          "Rumeurs d'un cadre stablecoin revu par le Congrès; surveiller les impacts sur les flux USD.",
        minutesAgo: 65,
      },
    ];

    const relativeLabel = (minutes) => {
      if (!Number.isFinite(minutes) || minutes <= 0) return "À l'instant";
      if (minutes < 60) return `Il y a ${minutes} min`;
      const hours = Math.floor(minutes / 60);
      return hours === 1 ? "Il y a 1h" : `Il y a ${hours}h`;
    };

    return entries.map((entry, index) => ({
      ...entry,
      time: relativeLabel(entry.minutesAgo),
      publishedAt: now - entry.minutesAgo * 60 * 1000 - index * 1000,
    }));
  }, [macroSignals, topMover24h]);

  const filteredResearch = useMemo(() => {
    if (newsFilter === "all") return researchFeed;
    return researchFeed.filter((item) => item.tag === newsFilter);
  }, [newsFilter, researchFeed]);

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
    if (!meta?.swapToken) {
      setDcaQuote(null);
      setDcaQuoteError(new Error("Actif non supporte pour l'execution 0x."));
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadQuote = async () => {
      setIsFetchingQuote(true);
      setDcaQuoteError(null);
      try {
        const params = new URLSearchParams({
          sellToken: DCA_BASE_STABLE,
          buyToken: meta.swapToken,
          sellAmount: Math.round(Number(dcaAmount) * 1_000_000).toString(),
          slippagePercentage: (Number(dcaSlippage) / 100).toString(),
        });

        const response = await fetch(
          `${ZEROX_QUOTE_ENDPOINT}?${params.toString()}`,
          {
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error(`0x quote ${response.status}`);
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
  }, [dcaTargetSymbol, dcaAmount, dcaSlippage, dcaProvider]);

  const custodyTargetPosition = custodyPositionMap[dcaTargetSymbol];
  const custodyAverageCost =
    custodyTargetPosition &&
    custodyTargetPosition.amount > 0 &&
    custodyTargetPosition.costBasis
      ? custodyTargetPosition.costBasis / custodyTargetPosition.amount
      : null;

  const availableStableBalance = walletBalances[DCA_BASE_STABLE] ?? 0;
  const canExecuteDca = Boolean(walletAccount && dcaQuote && !isExecutingDca);

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
    alertSymbol && activeAlertConditions.length && !isSubmittingAlert,
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

  async function executeDcaNow() {
    if (!canExecuteDca || !dcaQuote) return;
    setDcaExecutionMessage(null);
    setIsExecutingDca(true);
    try {
      const payload = {
        account: walletAccount,
        connector: walletConnectorId,
        provider: dcaProvider,
        quote: dcaQuote,
        metadata: {
          targetSymbol: dcaTargetSymbol,
          sellToken: dcaQuote.sellTokenAddress,
          buyToken: dcaQuote.buyTokenAddress,
          sellAmount: dcaQuote.sellAmount,
          buyAmount: dcaQuote.buyAmount,
        },
      };
      if (EXECUTIONS_ENDPOINT) {
        const response = await fetch(EXECUTIONS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error(`Execution API ${response.status}`);
        }
        const result = await response.json();
        setDcaExecutionMessage(
          result?.message || "Ordre transmis au relais 0x.",
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, 900));
        setDcaExecutionMessage("Simulation: ordre 0x prepare localement.");
      }
    } catch (err) {
      console.error("[dca] execute error", err);
      setDcaExecutionMessage(
        err instanceof Error ? err.message : "Execution impossible.",
      );
    } finally {
      setIsExecutingDca(false);
    }
  }

  async function scheduleDcaPlan() {
    if (!walletAccount || !dcaPlanPreview.occurrences) return;
    setDcaScheduleMessage(null);
    setIsSchedulingDca(true);
    try {
      const payload = {
        account: walletAccount,
        provider: dcaProvider,
        symbol: dcaTargetSymbol,
        amountPerRun: dcaAmount,
        frequency: dcaFrequency,
        occurrences: dcaPlanPreview.occurrences,
        startDate: dcaStartDate,
        slippage: dcaSlippage,
      };
      if (DCA_SCHEDULE_ENDPOINT) {
        const response = await fetch(DCA_SCHEDULE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error(`Plan API ${response.status}`);
        }
        const result = await response.json();
        setDcaScheduleMessage(
          result?.message || "Plan DCA programme via le backend.",
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, 700));
        setDcaScheduleMessage("Simulation: plan DCA enregistre localement.");
      }
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

      <section className="asset-cluster reveal delay-1">
        <div className="asset-grid">
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
                  <span className="badge badge-muted">Maj REST...</span>
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
            </div>

            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 12, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 5"
                    stroke="rgba(255, 255, 255, 0.12)"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12, fill: "rgba(255,255,255,0.7)" }}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: "rgba(255,255,255,0.7)" }}
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

            <div className="orderbook">
              <div>
                <p className="eyebrow">Carnet achat (Top 5)</p>
                <div className="orderbook-rows">
                  {heroOrderBook?.bids?.length ? (
                    heroOrderBook.bids.map((level, index) => (
                      <div key={`bid-${index}`} className="orderbook-row bid">
                        <span>{formatMoney(level.price)}</span>
                        <span>{level.size.toFixed(3)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="empty">Flux intraday en attente...</p>
                  )}
                </div>
              </div>
              <div>
                <p className="eyebrow">Carnet vente (Top 5)</p>
                <div className="orderbook-rows">
                  {heroOrderBook?.asks?.length ? (
                    heroOrderBook.asks.map((level, index) => (
                      <div key={`ask-${index}`} className="orderbook-row ask">
                        <span>{formatMoney(level.price)}</span>
                        <span>{level.size.toFixed(3)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="empty">Flux intraday en attente...</p>
                  )}
                </div>
              </div>
            </div>
          </article>

          <div className="asset-side">
            <WatchlistPanel
              watchlist={watchlist}
              coins={coins}
              onSelect={setSelected}
            />
            <AlertsPanel
              alerts={alerts}
              alertsError={alertsError}
              isAlertsSyncing={isAlertsSyncing}
              refreshAlerts={refreshAlerts}
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
          </div>
        </div>
      </section>

      <section className="execution-cluster reveal delay-2">
        <div className="execution-grid">
          <div className="execution-side">
            <PortfolioCard
              totalValue={totalValue}
              sentiment={sentiment}
              allocation={allocation}
              holdings={holdings}
            />
          </div>
          <div className="execution-main">
            <article className="card execution-panel">
              <div className="execution-head">
                <div>
                  <p className="eyebrow">Gestion execution</p>
                  <h3>Wallet + Custodian</h3>
                  <p className="helper-text">
                    Connecte ton wallet (WalletConnect / Ledger Live) et importe
                    les soldes custodian pour pre-remplir les ordres.
                  </p>
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

              <div className="connector-grid">
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

              <div className="wallet-status-row">
                <div>
                  <small>Compte actif</small>
                  <strong>{walletAccount || "Non connecte"}</strong>
                </div>
                <div>
                  <small>Network</small>
                  <strong>{walletNetwork || "N/A"}</strong>
                </div>
                <div className="wallet-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={refreshWallet}
                    disabled={walletStatus !== "connected"}
                  >
                    Refresh wallet
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => refreshCustody()}
                    disabled={
                      custodyStatus === "loading" ||
                      custodyStatus === "refreshing"
                    }
                  >
                    Sync custodian
                  </button>
                </div>
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
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => handleSyncHoldingFromWallet(item.symbol)}
                      >
                        Wallet
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() =>
                          handleSyncHoldingFromCustody(item.symbol)
                        }
                      >
                        Custodian
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="wallet-sync-actions">
                <button
                  type="button"
                  onClick={() => handleBulkSync("custody")}
                  disabled={!custodianHoldingsMap}
                >
                  Importer tout (custodian)
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => handleBulkSync("wallet")}
                  disabled={!walletBalances}
                >
                  Importer tout (wallet)
                </button>
              </div>
            </article>

            <article className="card dca-panel">
              <div className="dca-head">
                <div>
                  <p className="eyebrow">Module DCA</p>
                  <h3>Execution programmee via 0x</h3>
                  <p className="helper-text">
                    Propose des ordres DCA pre-remplis en USDC et envoie les
                    transactions au relais 0x ou a ton backend.
                  </p>
                </div>
                <span className="badge badge-muted">
                  {dcaProvider.toUpperCase()}
                </span>
              </div>

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
                  <span>Montant par run (USD)</span>
                  <input
                    type="number"
                    min="10"
                    step="10"
                    value={dcaAmount}
                    onChange={(e) => setDcaAmount(Number(e.target.value) || 0)}
                  />
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
                <label>
                  <span>Date debut</span>
                  <input
                    type="date"
                    value={dcaStartDate}
                    onChange={(e) => setDcaStartDate(e.target.value)}
                  />
                </label>
              </div>

              <div className="dca-stats">
                <div>
                  <small>Stable dispo (wallet)</small>
                  <strong>
                    {availableStableBalance
                      ? `${availableStableBalance.toLocaleString("fr-FR", {
                          maximumFractionDigits: 2,
                        })} ${DCA_BASE_STABLE}`
                      : `0 ${DCA_BASE_STABLE}`}
                  </strong>
                </div>
                <div>
                  <small>Runs planifies</small>
                  <strong>{dcaPlanPreview.occurrences}</strong>
                </div>
                <div>
                  <small>Total investi</small>
                  <strong>{formatMoney(dcaPlanPreview.totalInvested)}</strong>
                </div>
                <div>
                  <small>Tokens projetes</small>
                  <strong>{dcaPlanPreview.projectedTokens.toFixed(4)}</strong>
                </div>
              </div>

              <div className="dca-quote-panel">
                <div>
                  <p className="eyebrow">Quote 0x</p>
                  {isFetchingQuote && (
                    <span className="badge badge-muted">Pricing...</span>
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
                      Obtiens un prix en renseignant ton montant et un actif
                      supporte.
                    </p>
                  )}
                  {dcaQuoteError && (
                    <p className="error-text">{dcaQuoteError.message}</p>
                  )}
                </div>

                <div className="dca-meta">
                  <p>
                    Cout moyen actuel:{" "}
                    <strong>
                      {custodyAverageCost
                        ? formatMoney(custodyAverageCost)
                        : "N/A"}{" "}
                      → apres plan:{" "}
                      {dcaTargetCoin?.price
                        ? formatMoney(dcaTargetCoin.price)
                        : "N/A"}
                    </strong>
                  </p>
                  <p>
                    Sources 0x:{" "}
                    {dcaQuoteMetrics?.sources?.length
                      ? dcaQuoteMetrics.sources
                          .map(
                            (source) =>
                              `${source.name} (${Math.round(source.proportion * 100)}%)`,
                          )
                          .join(", ")
                      : "En attente"}
                  </p>
                </div>
              </div>

              <div className="dca-actions">
                <button
                  type="button"
                  onClick={executeDcaNow}
                  disabled={!canExecuteDca}
                >
                  {isExecutingDca ? "Execution..." : "Executer via 0x"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={scheduleDcaPlan}
                  disabled={isSchedulingDca}
                >
                  {isSchedulingDca ? "Planification..." : "Programmer le plan"}
                </button>
              </div>
              {dcaExecutionMessage && (
                <p className="info-text">{dcaExecutionMessage}</p>
              )}
              {dcaScheduleMessage && (
                <p className="info-text">{dcaScheduleMessage}</p>
              )}
            </article>
          </div>
        </div>
      </section>

      <section className="intel-cluster reveal delay-3">
        <article className="card stats-panel market-context">
          <p className="eyebrow">Contexte marche</p>
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
              <span>Open interest agrégé</span>
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
              <h3>Flux RSS · Twitter · Glassnode</h3>
            </div>
            <span className="badge badge-muted">Beta</span>
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

          <div className="news-feed">
            {filteredResearch.map((item) => (
              <div key={item.id} className="news-item">
                <div className="news-item-meta">
                  <span className="news-source">{item.source}</span>
                  <span>{item.time}</span>
                </div>
                <div className="news-item-body">
                  <strong>{item.title}</strong>
                  <p>{item.summary}</p>
                </div>
                <span className={`news-tag tag-${item.tag}`}>
                  {NEWS_TAGS.find((tag) => tag.key === item.tag)?.label ||
                    item.tag}
                </span>
              </div>
            ))}
            {filteredResearch.length === 0 && (
              <p className="empty">Aucune publication pour ce tag.</p>
            )}
          </div>
        </article>
      </section>
    </>
  );
}
