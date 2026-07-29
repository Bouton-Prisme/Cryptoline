const { insertRecord, listRecords, updateRecord } = require("./storage");

const MARKET_UNIVERSE = {
  BTC: { coingeckoId: "bitcoin", binanceFuturesSymbol: "BTCUSDT" },
  ETH: { coingeckoId: "ethereum", binanceFuturesSymbol: "ETHUSDT" },
  SOL: { coingeckoId: "solana", binanceFuturesSymbol: "SOLUSDT" },
  XMR: { coingeckoId: "monero", binanceFuturesSymbol: null },
  XRP: { coingeckoId: "ripple", binanceFuturesSymbol: "XRPUSDT" },
  ADA: { coingeckoId: "cardano", binanceFuturesSymbol: "ADAUSDT" },
};

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_COOLDOWN_MS = 15 * 60_000;

let workerState = {
  enabled: false,
  running: false,
  lastRunAt: null,
  lastError: null,
  lastTriggeredCount: 0,
  timer: null,
};

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSymbol(symbol) {
  return typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
}

function parseConditions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function compareValues(actual, condition) {
  const expected = Number(condition.value);
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;

  switch (condition.operator) {
    case "lte":
    case "lt":
      return actual <= expected;
    case "eq":
      return actual === expected;
    case "gte":
    case "gt":
    default:
      return actual >= expected;
  }
}

function canTrigger(alert, nowMs) {
  const cooldownMs = Number(process.env.ALERT_WORKER_COOLDOWN_MS || DEFAULT_COOLDOWN_MS);
  const lastTriggeredAt = alert.last_triggered_at || alert.lastTriggeredAt;
  if (!lastTriggeredAt) return true;
  const lastMs = Date.parse(lastTriggeredAt);
  return !Number.isFinite(lastMs) || nowMs - lastMs >= cooldownMs;
}

async function fetchMarketSnapshot(symbols) {
  const supportedSymbols = symbols.filter((symbol) => MARKET_UNIVERSE[symbol]?.coingeckoId);
  if (!supportedSymbols.length) return {};

  const ids = supportedSymbols.map((symbol) => MARKET_UNIVERSE[symbol].coingeckoId);
  const params = new URLSearchParams({
    vs_currency: "usd",
    ids: ids.join(","),
    price_change_percentage: "24h",
  });
  const response = await fetch(`https://api.coingecko.com/api/v3/coins/markets?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`CoinGecko ${response.status}`);
  }

  const payload = await response.json();
  return supportedSymbols.reduce((acc, symbol) => {
    const item = payload.find((entry) => entry.id === MARKET_UNIVERSE[symbol].coingeckoId);
    if (!item) return acc;
    const price = Number(item.current_price);
    const high24h = Number(item.high_24h);
    const drawdown = Number.isFinite(price) && Number.isFinite(high24h) && high24h > 0
      ? ((high24h - price) / high24h) * 100
      : null;
    acc[symbol] = {
      price,
      drawdown,
      volume: Number(item.total_volume),
      funding: null,
      source: "coingecko",
    };
    return acc;
  }, {});
}

async function fetchFundingRates(symbols) {
  const pairs = symbols
    .map((symbol) => [symbol, MARKET_UNIVERSE[symbol]?.binanceFuturesSymbol])
    .filter(([, pair]) => Boolean(pair));

  const results = await Promise.allSettled(
    pairs.map(async ([symbol, pair]) => {
      const response = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${pair}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Binance funding ${response.status}`);
      const payload = await response.json();
      return [symbol, Number(payload.lastFundingRate) * 100];
    }),
  );

  return results.reduce((acc, result) => {
    if (result.status === "fulfilled") {
      const [symbol, funding] = result.value;
      acc[symbol] = Number.isFinite(funding) ? funding : null;
    }
    return acc;
  }, {});
}

function evaluateAlert(alert, metrics) {
  const conditions = parseConditions(alert.conditions);
  if (!conditions.length) return [];

  return conditions.filter((condition) => {
    const key = condition.type;
    const actual = metrics[key];
    return compareValues(actual, condition);
  });
}

async function dispatchWebhook(event) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return { delivered: false, reason: "webhook_not_configured" };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    throw new Error(`Alert webhook ${response.status}`);
  }
  return { delivered: true };
}

async function dispatchNotification(alert, event) {
  const deliveries = {
    in_app: true,
    webhook: false,
    email: false,
    push: false,
  };

  if (alert.channel === "webhook" || process.env.ALERT_WEBHOOK_URL) {
    const result = await dispatchWebhook(event);
    deliveries.webhook = result.delivered;
  }

  return deliveries;
}

async function runAlertCheck() {
  if (workerState.running) return { skipped: true, reason: "already_running" };

  workerState.running = true;
  workerState.lastError = null;

  try {
    const now = new Date();
    const alerts = (await listRecords("alerts", { status: "active" })).filter((alert) => {
      return String(alert.status || "active") === "active" && canTrigger(alert, now.getTime());
    });
    const symbols = Array.from(new Set(alerts.map((alert) => normalizeSymbol(alert.symbol)).filter(Boolean)));
    const marketSnapshot = await fetchMarketSnapshot(symbols);
    const fundingRates = await fetchFundingRates(symbols);
    Object.entries(fundingRates).forEach(([symbol, funding]) => {
      if (marketSnapshot[symbol]) {
        marketSnapshot[symbol].funding = funding;
      }
    });

    let triggeredCount = 0;
    for (const alert of alerts) {
      const symbol = normalizeSymbol(alert.symbol);
      const metrics = marketSnapshot[symbol];
      if (!metrics) continue;

      const matchedConditions = evaluateAlert(alert, metrics);
      if (!matchedConditions.length) continue;

      const event = {
        id: createId("evt"),
        alert_id: alert.id,
        symbol,
        label: alert.label || `${symbol} alert`,
        channel: alert.channel || "push",
        conditions: matchedConditions,
        metrics,
        status: "triggered",
        created_at: now.toISOString(),
      };

      const deliveries = await dispatchNotification(alert, event);
      const savedEvent = await insertRecord("alertEvents", {
        ...event,
        deliveries,
      });
      await updateRecord("alerts", alert.id, {
        last_triggered_at: now.toISOString(),
      });
      triggeredCount += savedEvent ? 1 : 0;
    }

    workerState.lastRunAt = now.toISOString();
    workerState.lastTriggeredCount = triggeredCount;
    return {
      checkedAlerts: alerts.length,
      triggeredCount,
    };
  } catch (err) {
    workerState.lastError = err instanceof Error ? err.message : "Alert worker error";
    throw err;
  } finally {
    workerState.running = false;
  }
}

function startAlertWorker() {
  if (workerState.timer) return;
  if (process.env.ALERT_WORKER_ENABLED === "false") {
    workerState.enabled = false;
    return;
  }

  const intervalMs = Number(process.env.ALERT_WORKER_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  workerState.enabled = true;
  workerState.timer = setInterval(() => {
    runAlertCheck().catch((err) => {
      console.error("[alert-worker]", err);
    });
  }, Math.max(10_000, intervalMs));
}

function getAlertWorkerStatus() {
  return {
    enabled: workerState.enabled,
    running: workerState.running,
    lastRunAt: workerState.lastRunAt,
    lastError: workerState.lastError,
    lastTriggeredCount: workerState.lastTriggeredCount,
  };
}

module.exports = {
  getAlertWorkerStatus,
  runAlertCheck,
  startAlertWorker,
};
