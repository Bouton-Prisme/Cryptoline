const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT"];
const DEFAULT_CACHE_MS = 2 * 60_000;

let cache = {
  fetchedAt: 0,
  payload: null,
};

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fundingLabel(value) {
  if (!Number.isFinite(value)) return "Indisponible";
  if (value > 0.01) return "Long bias";
  if (value < -0.01) return "Short bias";
  return "Neutre";
}

function dominanceLabel(spread) {
  if (!Number.isFinite(spread)) return "Dominance indisponible";
  return spread >= 0
    ? `BTC +${spread.toFixed(1)} pts`
    : `ETH +${Math.abs(spread).toFixed(1)} pts`;
}

async function fetchJson(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${label} ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFearGreed() {
  const payload = await fetchJson("https://api.alternative.me/fng/?limit=1", "Alternative.me");
  const item = Array.isArray(payload?.data) ? payload.data[0] : null;
  return {
    score: toNumber(item?.value),
    label: item?.value_classification || "Indisponible",
    updatedAt: item?.timestamp ? new Date(Number(item.timestamp) * 1000).toISOString() : null,
    source: "Alternative.me",
  };
}

async function fetchGlobalMarket() {
  const payload = await fetchJson("https://api.coingecko.com/api/v3/global", "CoinGecko global");
  const data = payload?.data || {};
  const dominance = data.market_cap_percentage || {};
  const btcDominance = toNumber(dominance.btc);
  const ethDominance = toNumber(dominance.eth);
  const totalMarketCapUsd = toNumber(data.total_market_cap?.usd);
  const totalVolumeUsd = toNumber(data.total_volume?.usd);
  const dominanceSpread =
    Number.isFinite(btcDominance) && Number.isFinite(ethDominance)
      ? btcDominance - ethDominance
      : null;

  return {
    btcDominance,
    ethDominance,
    dominanceSpread,
    dominanceLabel: dominanceLabel(dominanceSpread),
    totalMarketCapUsd,
    totalVolumeUsd,
    source: "CoinGecko",
  };
}

async function fetchFuturesMetric(symbol) {
  const [premium, openInterest] = await Promise.allSettled([
    fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, `Binance premium ${symbol}`),
    fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`, `Binance OI ${symbol}`),
  ]);

  const premiumData = premium.status === "fulfilled" ? premium.value : {};
  const oiData = openInterest.status === "fulfilled" ? openInterest.value : {};
  const markPrice = toNumber(premiumData.markPrice);
  const fundingRate = toNumber(premiumData.lastFundingRate);
  const openInterestContracts = toNumber(oiData.openInterest);

  return {
    symbol,
    markPrice,
    fundingRatePct: Number.isFinite(fundingRate) ? fundingRate * 100 : null,
    openInterestContracts,
    openInterestUsd:
      Number.isFinite(openInterestContracts) && Number.isFinite(markPrice)
        ? openInterestContracts * markPrice
        : null,
  };
}

async function fetchFuturesAggregate() {
  const symbols = (process.env.MACRO_FUTURES_SYMBOLS || DEFAULT_SYMBOLS.join(","))
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  const results = await Promise.allSettled(symbols.map(fetchFuturesMetric));
  const metrics = results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  const validFunding = metrics
    .map((metric) => metric.fundingRatePct)
    .filter((value) => Number.isFinite(value));
  const fundingRate =
    validFunding.length > 0
      ? validFunding.reduce((sum, value) => sum + value, 0) / validFunding.length
      : null;
  const openInterest = metrics.reduce(
    (sum, metric) => sum + (Number.isFinite(metric.openInterestUsd) ? metric.openInterestUsd : 0),
    0,
  );

  return {
    fundingRate,
    fundingLabel: fundingLabel(fundingRate),
    openInterest: openInterest || null,
    symbols: metrics,
    source: "Binance Futures",
  };
}

async function getMacroSignals({ force = false } = {}) {
  const cacheMs = Number(process.env.MACRO_SIGNALS_CACHE_MS || DEFAULT_CACHE_MS);
  if (!force && cache.payload && Date.now() - cache.fetchedAt < cacheMs) {
    return {
      ...cache.payload,
      cached: true,
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
    };
  }

  const [fearGreed, globalMarket, futures] = await Promise.allSettled([
    fetchFearGreed(),
    fetchGlobalMarket(),
    fetchFuturesAggregate(),
  ]);

  const errors = [];
  const fearGreedValue = fearGreed.status === "fulfilled" ? fearGreed.value : null;
  const globalValue = globalMarket.status === "fulfilled" ? globalMarket.value : null;
  const futuresValue = futures.status === "fulfilled" ? futures.value : null;

  if (fearGreed.status === "rejected") errors.push({ source: "Alternative.me", message: fearGreed.reason.message });
  if (globalMarket.status === "rejected") errors.push({ source: "CoinGecko", message: globalMarket.reason.message });
  if (futures.status === "rejected") errors.push({ source: "Binance Futures", message: futures.reason.message });

  const payload = {
    fearGreedScore: fearGreedValue?.score ?? null,
    fearGreedLabel: fearGreedValue?.label || "Indisponible",
    fundingRate: futuresValue?.fundingRate ?? null,
    fundingLabel: futuresValue?.fundingLabel || "Indisponible",
    dominanceSpread: globalValue?.dominanceSpread ?? null,
    dominanceLabel: globalValue?.dominanceLabel || "Dominance indisponible",
    openInterest: futuresValue?.openInterest ?? null,
    btcDominance: globalValue?.btcDominance ?? null,
    ethDominance: globalValue?.ethDominance ?? null,
    totalMarketCapUsd: globalValue?.totalMarketCapUsd ?? null,
    totalVolumeUsd: globalValue?.totalVolumeUsd ?? null,
    sources: {
      fearGreed: fearGreedValue?.source || null,
      global: globalValue?.source || null,
      futures: futuresValue?.source || null,
    },
    components: {
      futures: futuresValue?.symbols || [],
    },
    errors,
  };

  cache = {
    fetchedAt: Date.now(),
    payload,
  };

  return {
    ...payload,
    cached: false,
    fetchedAt: new Date(cache.fetchedAt).toISOString(),
  };
}

module.exports = {
  getMacroSignals,
};
