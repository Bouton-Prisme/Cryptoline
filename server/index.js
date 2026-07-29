const cors = require("cors");
const dotenv = require("dotenv");
const express = require("express");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config();

const {
  deleteRecord,
  insertRecord,
  isSupabaseEnabled,
  listRecords,
  updateRecord,
  upsertRecord,
} = require("./storage");
const {
  getAlertWorkerStatus,
  runAlertCheck,
  startAlertWorker,
} = require("./alertWorker");
const { getResearchFeed } = require("./researchFeed");
const { getMacroSignals } = require("./macroSignals");

const app = express();
const PORT = Number(process.env.API_PORT || process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function normalizeSymbol(symbol) {
  return typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "cryptoline-api",
    storage: isSupabaseEnabled() ? "supabase" : "json",
    alertWorker: getAlertWorkerStatus(),
    time: new Date().toISOString(),
  });
});

app.get(
  "/api/research-feed",
  asyncRoute(async (req, res) => {
    const tag = String(req.query.tag || "all");
    const limit = Number(req.query.limit || 12);
    const force = req.query.force === "true";
    const feed = await getResearchFeed({ tag, limit, force });
    res.json(feed);
  }),
);

app.get(
  "/api/macro-signals",
  asyncRoute(async (req, res) => {
    const force = req.query.force === "true";
    const signals = await getMacroSignals({ force });
    res.json(signals);
  }),
);

app.get(
  "/api/alerts",
  asyncRoute(async (req, res) => {
    const symbol = normalizeSymbol(req.query.symbol);
    const alerts = await listRecords("alerts", symbol ? { symbol } : {});
    const filtered = symbol
      ? alerts.filter((alert) => normalizeSymbol(alert.symbol) === symbol)
      : alerts;
    res.json(filtered);
  }),
);

app.post(
  "/api/alerts",
  asyncRoute(async (req, res) => {
    const symbol = normalizeSymbol(req.body.symbol);
    const conditions = Array.isArray(req.body.conditions) ? req.body.conditions : [];

    if (!symbol) {
      return res.status(400).json({ error: "symbol is required" });
    }
    if (!conditions.length) {
      return res.status(400).json({ error: "conditions are required" });
    }

    const alert = {
      id: createId("alert"),
      symbol,
      label: req.body.label || `${symbol} alert`,
      note: req.body.note || null,
      channel: req.body.channel || "push",
      status: req.body.status || "active",
      conditions,
      created_at: req.body.created_at || new Date().toISOString(),
      last_triggered_at: null,
      user_id: req.body.user_id || req.body.wallet_address || null,
    };

    const created = await insertRecord("alerts", alert);
    res.status(201).json(created);
  }),
);

app.delete(
  "/api/alerts/:id",
  asyncRoute(async (req, res) => {
    await deleteRecord("alerts", req.params.id);
    res.status(204).end();
  }),
);

app.get(
  "/api/alert-events",
  asyncRoute(async (req, res) => {
    const symbol = normalizeSymbol(req.query.symbol);
    const events = await listRecords("alertEvents", symbol ? { symbol } : {});
    res.json(events);
  }),
);

app.post(
  "/api/alerts/check",
  asyncRoute(async (req, res) => {
    const result = await runAlertCheck();
    res.json(result);
  }),
);

app.get(
  "/api/custody",
  asyncRoute(async (req, res) => {
    const symbols = String(req.query.symbols || "")
      .split(",")
      .map(normalizeSymbol)
      .filter(Boolean);
    const account = String(req.query.account || "").toLowerCase();
    const filters = account ? { account } : {};
    const positions = await listRecords("custody", filters);

    const filtered = positions.filter((position) => {
      const symbolMatches = !symbols.length || symbols.includes(normalizeSymbol(position.symbol));
      const accountMatches =
        !account || String(position.account || "").toLowerCase() === account;
      return symbolMatches && accountMatches;
    });

    res.json({ positions: filtered });
  }),
);

app.get(
  "/api/dca-quote",
  asyncRoute(async (req, res) => {
    const quoteEndpoint = process.env.ZEROX_QUOTE_ENDPOINT || "https://api.0x.org/swap/v1/quote";
    const params = new URLSearchParams();
    [
      "sellToken",
      "buyToken",
      "sellAmount",
      "buyAmount",
      "slippagePercentage",
      "takerAddress",
      "chainId",
    ].forEach((key) => {
      if (req.query[key]) params.append(key, String(req.query[key]));
    });

    if (!params.get("sellToken") || !params.get("buyToken")) {
      return res.status(400).json({ error: "sellToken and buyToken are required" });
    }
    if (!params.get("sellAmount") && !params.get("buyAmount")) {
      return res.status(400).json({ error: "sellAmount or buyAmount is required" });
    }

    const headers = { Accept: "application/json" };
    if (process.env.ZEROX_API_KEY) {
      headers["0x-api-key"] = process.env.ZEROX_API_KEY;
    }

    const response = await fetch(`${quoteEndpoint}?${params.toString()}`, { headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: payload?.reason || payload?.message || `0x quote ${response.status}`,
        details: payload,
      });
    }
    res.json(payload);
  }),
);

app.post(
  "/api/custody/positions",
  asyncRoute(async (req, res) => {
    const symbol = normalizeSymbol(req.body.symbol);
    if (!symbol) {
      return res.status(400).json({ error: "symbol is required" });
    }

    const account = req.body.account ? String(req.body.account).toLowerCase() : "";
    const nextPosition = {
      id: req.body.id || createId("position"),
      account,
      symbol,
      amount: Number(req.body.amount) || 0,
      cost_basis: Number(req.body.cost_basis ?? req.body.costBasis ?? 0),
      provider: req.body.provider || "Manual",
      updated_at: new Date().toISOString(),
    };

    const saved = await upsertRecord("custody", nextPosition, ["account", "symbol"]);
    res.status(201).json(saved);
  }),
);

app.post(
  "/api/execute-dca",
  asyncRoute(async (req, res) => {
    if (!req.body.account) {
      return res.status(400).json({ error: "account is required" });
    }
    if (!req.body.quote) {
      return res.status(400).json({ error: "quote is required" });
    }
    const tx = req.body.quote.transaction || req.body.quote;
    if (!tx.to || !tx.data) {
      return res.status(400).json({ error: "quote transaction is incomplete" });
    }

    const execution = {
      id: createId("exec"),
      account: req.body.account,
      connector: req.body.connector || null,
      provider: req.body.provider || "0x",
      status: "prepared",
      quote: req.body.quote,
      metadata: req.body.metadata || {},
      created_at: new Date().toISOString(),
      submitted_at: null,
      tx_hash: null,
    };

    const saved = await insertRecord("executions", execution);
    res.status(201).json({
      ...saved,
      message: "Ordre DCA prepare par le backend. Signature wallet requise avant execution reelle.",
    });
  }),
);

app.patch(
  "/api/dca-executions/:id",
  asyncRoute(async (req, res) => {
    const allowedStatuses = new Set(["prepared", "submitted", "failed", "cancelled"]);
    const status = req.body.status || "submitted";
    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ error: "invalid status" });
    }

    const patch = {
      status,
      tx_hash: req.body.tx_hash || req.body.txHash || null,
      submitted_at: status === "submitted" ? new Date().toISOString() : null,
      error: req.body.error || null,
    };

    const updated = await updateRecord("executions", req.params.id, patch);
    res.json(updated || { id: req.params.id, ...patch });
  }),
);

app.get(
  "/api/dca-plans",
  asyncRoute(async (req, res) => {
    const account = String(req.query.account || "").toLowerCase();
    const plans = await listRecords("dcaPlans", account ? { account } : {});
    const filtered = account
      ? plans.filter((plan) => String(plan.account || "").toLowerCase() === account)
      : plans;
    res.json(filtered);
  }),
);

app.post(
  "/api/dca-plans",
  asyncRoute(async (req, res) => {
    if (!req.body.account) {
      return res.status(400).json({ error: "account is required" });
    }
    if (!req.body.symbol) {
      return res.status(400).json({ error: "symbol is required" });
    }

    const plan = {
      id: createId("plan"),
      account: req.body.account,
      provider: req.body.provider || "0x",
      symbol: normalizeSymbol(req.body.symbol),
      amountPerRun: Number(req.body.amountPerRun) || 0,
      frequency: req.body.frequency || "hebdo",
      occurrences: Number(req.body.occurrences) || 0,
      startDate: req.body.startDate || new Date().toISOString().slice(0, 10),
      slippage: Number(req.body.slippage) || 0.3,
      status: "scheduled",
      created_at: new Date().toISOString(),
    };

    const saved = await insertRecord("dcaPlans", plan);
    res.status(201).json({
      ...saved,
      message: "Plan DCA enregistre par le backend.",
    });
  }),
);

app.delete(
  "/api/dca-plans/:id",
  asyncRoute(async (req, res) => {
    await deleteRecord("dcaPlans", req.params.id);
    res.status(204).end();
  }),
);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  console.error("[api]", err);
  res.status(500).json({ error: "Internal server error" });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CryptoLine API listening on http://localhost:${PORT}`);
    startAlertWorker();
  });
}

module.exports = app;
