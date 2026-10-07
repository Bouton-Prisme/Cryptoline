const cors = require("cors");
const dotenv = require("dotenv");
const express = require("express");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config();

const {
  deleteRecord,
  getUserIdFromAccessToken,
  insertRecord,
  isSupabaseEnabled,
  checkStorageHealth,
  listRecords,
  updateRecord,
  upsertRecord,
} = require("./storage");
const {
  getAlertWorkerStatus,
  runAlertCheck,
  startAlertWorker,
} = require("./alertWorker");
const {
  getDcaWorkerStatus,
  runDcaScheduleCheck,
  startDcaWorker,
} = require("./dcaWorker");
const {
  DEFAULT_CHAIN_ID,
  decimalToUnits,
  resolveTargetToken,
  resolveToken,
  validatePreparedQuote,
  validateQuoteRequest,
} = require("./dcaConfig");
const { fetchDcaQuote, issueQuote, verifyQuote } = require("./zeroX");
const { getResearchFeed } = require("./researchFeed");
const { getMacroSignals } = require("./macroSignals");
const { encryptSecret, redactConnection } = require("./secretVault");

const app = express();
const PORT = Number(process.env.API_PORT || process.env.PORT || 4000);

app.use(cors({ origin: (origin, callback) => {
  const allowed = (process.env.APP_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000").split(",").map(value => value.trim());
  callback(null, !origin || allowed.includes(origin));
} }));
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

function normalizeUserId(userId) {
  return typeof userId === "string" ? userId.trim() : "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProvider(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeWalletType(value) {
  const type = normalizeText(value) || "watch-only";
  const allowed = new Set(["self-custody", "exchange", "watch-only"]);
  return allowed.has(type) ? type : null;
}

function normalizeChainFamily(value) {
  const family = normalizeText(value).toLowerCase() || "evm";
  const allowed = new Set(["evm", "solana", "bitcoin", "cosmos", "tron", "other"]);
  return allowed.has(family) ? family : "other";
}

function normalizeReadOnlyPermissions(value) {
  const permissions = Array.isArray(value) ? value : ["read"];
  const normalized = Array.from(
    new Set(permissions.map((permission) => normalizeText(permission).toLowerCase()).filter(Boolean)),
  );
  const forbidden = normalized.filter((permission) => permission !== "read");
  if (forbidden.length) {
    const err = new Error("Exchange connections are read-only: trade/withdraw permissions are refused");
    err.status = 400;
    throw err;
  }
  return ["read"];
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function resolveRequestUserId(req, candidateUserId) {
  const userId = req.userId;
  if (!userId) throw Object.assign(new Error("Authentication required"), { status: 401 });
  if (candidateUserId && normalizeUserId(candidateUserId) !== userId) {
    throw Object.assign(new Error("user_id does not match authenticated session"), { status: 403 });
  }
  return userId;
}

async function assertRecordOwner(storeName, id, userId) {
  const records = await listRecords(storeName, { id, user_id: userId });
  const record = records.find(item => String(item.id) === String(id) && item.user_id === userId);
  if (!record) throw Object.assign(new Error("Record not found"), { status: 404 });
  return record;
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "cryptoline-api",
    storage: isSupabaseEnabled() ? "supabase" : "json",
    alertWorker: getAlertWorkerStatus(),
    dcaWorker: getDcaWorkerStatus(),
    time: new Date().toISOString(),
  });
});

app.get("/api/ready", asyncRoute(async (req, res) => {
  const storage = await checkStorageHealth();
  const authConfigured = Boolean(process.env.REACT_APP_SUPABASE_URL && process.env.REACT_APP_SUPABASE_ANON_KEY);
  res.status(storage.ready && authConfigured ? 200 : 503).json({
    ready: storage.ready && authConfigured, storage, authConfigured,
    dcaConfigured: Boolean(process.env.ZEROX_API_KEY),
  });
}));

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

// Every route below this boundary requires a verified Supabase session.
app.use("/api", asyncRoute(async (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "Authentication required" });
  req.userId = await getUserIdFromAccessToken(token);
  if (!req.userId) return res.status(401).json({ error: "Invalid session" });
  for (const source of [req.query, req.body || {}]) {
    for (const key of ["user_id", "userId"]) {
      if (source[key] !== undefined && source[key] !== req.userId) {
        return res.status(403).json({ error: "user_id does not match authenticated session" });
      }
    }
  }
  next();
}));

app.get(
  "/api/alerts",
  asyncRoute(async (req, res) => {
    const symbol = normalizeSymbol(req.query.symbol);
    const userId = await resolveRequestUserId(req, req.query.user_id || req.query.userId);
    const filters = {
      ...(symbol ? { symbol } : {}),
      ...(userId ? { user_id: userId } : {}),
    };
    const alerts = await listRecords("alerts", filters);
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
      status: "active",
      conditions,
      created_at: new Date().toISOString(),
      last_triggered_at: null,
      user_id: (await resolveRequestUserId(req, req.body.user_id || req.body.userId)) || null,
    };

    const created = await insertRecord("alerts", alert);
    res.status(201).json(created);
  }),
);

app.delete(
  "/api/alerts/:id",
  asyncRoute(async (req, res) => {
    const userId = await resolveRequestUserId(req, req.query.user_id || req.query.userId);
    await assertRecordOwner("alerts", req.params.id, userId);
    await deleteRecord("alerts", req.params.id, userId);
    res.status(204).end();
  }),
);

app.get(
  "/api/alert-events",
  asyncRoute(async (req, res) => {
    const symbol = normalizeSymbol(req.query.symbol);
    const userId = await resolveRequestUserId(req, req.query.user_id || req.query.userId);
    const filters = {
      ...(symbol ? { symbol } : {}),
      ...(userId ? { user_id: userId } : {}),
    };
    const events = await listRecords("alertEvents", filters);
    const filtered = events.filter((event) => {
      const symbolMatches = !symbol || normalizeSymbol(event.symbol) === symbol;
      const userMatches = !userId || String(event.user_id || "") === userId;
      return symbolMatches && userMatches;
    });
    res.json(filtered);
  }),
);

app.post(
  "/api/alerts/check",
  asyncRoute(async (req, res) => {
    const result = await runAlertCheck(req.userId);
    res.json(result);
  }),
);

app.get(
  "/api/wallets",
  asyncRoute(async (req, res) => {
    const userId = await resolveRequestUserId(req, req.query.user_id || req.query.userId);
    const filters = userId ? { user_id: userId } : {};
    const wallets = await listRecords("wallets", filters);
    res.json({
      wallets: wallets.filter((wallet) => !userId || wallet.user_id === userId),
    });
  }),
);

app.post(
  "/api/wallets",
  asyncRoute(async (req, res) => {
    const userId = await resolveRequestUserId(req, req.body.user_id || req.body.userId);
    if (!userId) {
      return res.status(401).json({ error: "authenticated user is required" });
    }

    const walletType = normalizeWalletType(req.body.wallet_type || req.body.walletType);
    if (!walletType) {
      return res.status(400).json({ error: "wallet_type is invalid" });
    }

    const provider = normalizeProvider(req.body.provider);
    if (!provider) {
      return res.status(400).json({ error: "provider is required" });
    }

    const name = normalizeText(req.body.name);
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const address = normalizeText(req.body.address) || null;
    const network = normalizeText(req.body.network).toLowerCase() || "ethereum";
    const wallet = {
      id: createId("wallet"),
      user_id: userId,
      name,
      wallet_type: walletType,
      provider,
      address,
      network,
      chain_family: normalizeChainFamily(req.body.chain_family || req.body.chainFamily),
      connection_status: req.body.connection_status || req.body.connectionStatus || "manual",
      is_primary: Boolean(req.body.is_primary || req.body.isPrimary),
      metadata: req.body.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {},
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    const saved = wallet.address
      ? await upsertRecord("wallets", wallet, ["user_id", "provider", "address"])
      : await insertRecord("wallets", wallet);
    res.status(201).json(saved);
  }),
);

app.patch(
  "/api/wallets/:id",
  asyncRoute(async (req, res) => {
    const userId = await resolveRequestUserId(req, req.body.user_id || req.body.userId);
    if (!userId) {
      return res.status(401).json({ error: "authenticated user is required" });
    }
    await assertRecordOwner("wallets", req.params.id, userId);

    const patch = {
      ...(req.body.name ? { name: normalizeText(req.body.name) } : {}),
      ...(req.body.wallet_type || req.body.walletType
        ? { wallet_type: normalizeWalletType(req.body.wallet_type || req.body.walletType) }
        : {}),
      ...(req.body.provider ? { provider: normalizeProvider(req.body.provider) } : {}),
      ...(req.body.address !== undefined
        ? { address: normalizeText(req.body.address) || null }
        : {}),
      ...(req.body.network ? { network: normalizeText(req.body.network).toLowerCase() } : {}),
      ...(req.body.chain_family || req.body.chainFamily
        ? { chain_family: normalizeChainFamily(req.body.chain_family || req.body.chainFamily) }
        : {}),
      ...(req.body.connection_status || req.body.connectionStatus
        ? { connection_status: req.body.connection_status || req.body.connectionStatus }
        : {}),
      ...(req.body.is_primary !== undefined || req.body.isPrimary !== undefined
        ? { is_primary: Boolean(req.body.is_primary ?? req.body.isPrimary) }
        : {}),
      ...(req.body.metadata && typeof req.body.metadata === "object"
        ? { metadata: req.body.metadata }
        : {}),
      user_id: userId,
      updated_at: new Date().toISOString(),
    };

    if (patch.wallet_type === null) {
      return res.status(400).json({ error: "wallet_type is invalid" });
    }

    const updated = await updateRecord("wallets", req.params.id, patch, userId);
    res.json(updated || { id: req.params.id, ...patch });
  }),
);

app.delete(
  "/api/wallets/:id",
  asyncRoute(async (req, res) => {
    const userId = await resolveRequestUserId(req, req.query.user_id || req.query.userId);
    if (!userId) {
      return res.status(401).json({ error: "authenticated user is required" });
    }
    await assertRecordOwner("wallets", req.params.id, userId);
    await deleteRecord("wallets", req.params.id, userId);
    res.status(204).end();
  }),
);

app.get(
  "/api/exchange-connections",
  asyncRoute(async (req, res) => {
    const userId = await resolveRequestUserId(req, req.query.user_id || req.query.userId);
    const filters = userId ? { user_id: userId } : {};
    const connections = await listRecords("exchangeConnections", filters);
    res.json({
      connections: connections
        .filter((connection) => !userId || connection.user_id === userId)
        .map(redactConnection),
    });
  }),
);

app.post(
  "/api/exchange-connections",
  asyncRoute(async (req, res) => {
    const userId = await resolveRequestUserId(req, req.body.user_id || req.body.userId);
    if (!userId) {
      return res.status(401).json({ error: "authenticated user is required" });
    }

    const provider = normalizeProvider(req.body.provider);
    const label = normalizeText(req.body.label || req.body.name);
    if (!provider || !label) {
      return res.status(400).json({ error: "provider and label are required" });
    }

    if (req.body.wallet_id || req.body.walletId) {
      await assertRecordOwner("wallets", req.body.wallet_id || req.body.walletId, userId);
    }

    const connection = {
      id: createId("exchange"),
      user_id: userId,
      wallet_id: normalizeText(req.body.wallet_id || req.body.walletId) || null,
      provider,
      label,
      permissions: normalizeReadOnlyPermissions(req.body.permissions),
      encrypted_api_key: encryptSecret(req.body.api_key || req.body.apiKey),
      encrypted_api_secret: encryptSecret(req.body.api_secret || req.body.apiSecret),
      encrypted_passphrase: encryptSecret(req.body.passphrase),
      status: "configured",
      last_sync_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const saved = await insertRecord("exchangeConnections", connection);
    res.status(201).json(redactConnection(saved));
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
    const userId = await resolveRequestUserId(req, req.query.user_id || req.query.userId);
    const filters = {
      ...(account ? { account } : {}),
      ...(userId ? { user_id: userId } : {}),
    };
    const positions = await listRecords("custody", filters);

    const filtered = positions.filter((position) => {
      const symbolMatches = !symbols.length || symbols.includes(normalizeSymbol(position.symbol));
      const accountMatches =
        !account || String(position.account || "").toLowerCase() === account;
      const userMatches = !userId || String(position.user_id || "") === userId;
      return symbolMatches && accountMatches && userMatches;
    });

    res.json({ positions: filtered });
  }),
);

app.get(
  "/api/dca-quote",
  asyncRoute(async (req, res) => {
    let expected;
    try {
      expected = validateQuoteRequest({
        sellToken: req.query.sellToken,
        buyToken: req.query.buyToken,
        sellAmount: req.query.sellAmount,
        buyAmount: req.query.buyAmount,
        slippagePercentage: req.query.slippagePercentage,
        takerAddress: req.query.takerAddress,
        chainId: req.query.chainId || DEFAULT_CHAIN_ID,
      });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid quote request" });
    }

    const quote = await fetchDcaQuote(expected);
    res.json(issueQuote(quote, req.userId));
  }),
);

app.post(
  "/api/custody/positions",
  asyncRoute(async (req, res) => {
    const symbol = normalizeSymbol(req.body.symbol);
    if (!symbol) {
      return res.status(400).json({ error: "symbol is required" });
    }

    if (!Number.isFinite(Number(req.body.amount)) || Number(req.body.amount) < 0 ||
        !Number.isFinite(Number(req.body.cost_basis ?? req.body.costBasis ?? 0)) || Number(req.body.cost_basis ?? req.body.costBasis ?? 0) < 0) {
      return res.status(400).json({ error: "Invalid position amount or cost basis" });
    }
    const account = req.body.account ? String(req.body.account).toLowerCase() : "";
    const nextPosition = {
      id: createId("position"),
      account,
      user_id: (await resolveRequestUserId(req, req.body.user_id || req.body.userId)) || null,
      symbol,
      amount: Number(req.body.amount) || 0,
      cost_basis: Number(req.body.cost_basis ?? req.body.costBasis ?? 0),
      provider: req.body.provider || "Manual",
      updated_at: new Date().toISOString(),
    };

    const saved = await upsertRecord("custody", nextPosition, ["user_id", "account", "symbol"]);
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
    const trustedQuote = verifyQuote(req.body.quote, req.userId);
    const quoteMetadata = trustedQuote.metadata || {};
    if (String(req.body.account).toLowerCase() !== quoteMetadata.takerAddress) {
      return res.status(400).json({ error: "Quote account mismatch" });
    }
    let validatedQuote;
    try {
      const expected = validateQuoteRequest({
        sellToken:
          quoteMetadata.sellToken ||
          req.body.quote.sellTokenAddress ||
          req.body.quote.sellToken?.address,
        buyToken:
          quoteMetadata.buyToken ||
          req.body.quote.buyTokenAddress ||
          req.body.quote.buyToken?.address,
        sellAmount: quoteMetadata.sellAmount || req.body.quote.sellAmount,
        slippagePercentage: quoteMetadata.slippagePercentage || req.body.quote.slippagePercentage || 0.003,
        takerAddress: req.body.account,
        chainId: quoteMetadata.chainId || req.body.quote.chainId || DEFAULT_CHAIN_ID,
      });
      validatedQuote = validatePreparedQuote(trustedQuote, expected);
    } catch (err) {
      return res.status(400).json({
        error: err instanceof Error ? err.message : "Invalid DCA quote",
      });
    }

    const execution = {
      id: createId("exec"),
      account: req.body.account,
      user_id: (await resolveRequestUserId(req, req.body.user_id || req.body.userId)) || null,
      connector: req.body.connector || null,
      provider: req.body.provider || "0x",
      status: "prepared",
      quote: { ...validatedQuote, expiresAt: req.body.quote.proof.expiresAt },
      metadata: {
        ...(req.body.metadata || {}),
        chainId: validatedQuote.chainId,
        sellToken: validatedQuote.sellTokenAddress,
        buyToken: validatedQuote.buyTokenAddress,
        sellAmount: validatedQuote.sellAmount,
        buyAmount: validatedQuote.buyAmount,
      },
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

app.get("/api/dca-executions", asyncRoute(async (req, res) => {
  const executions = await listRecords("executions", { user_id: req.userId, status: "prepared" });
  res.json(executions.map(({ id, account, metadata, created_at }) => ({ id, account, metadata, created_at })));
}));

app.post("/api/dca-executions/:id/quote", asyncRoute(async (req, res) => {
  const execution = await assertRecordOwner("executions", req.params.id, req.userId);
  if (execution.status !== "prepared") return res.status(409).json({ error: "Execution is no longer pending" });
  const metadata = execution.metadata || {};
  const expected = validateQuoteRequest({
    chainId: metadata.chainId, sellToken: metadata.sellToken, buyToken: metadata.buyToken,
    sellAmount: metadata.sellAmount, takerAddress: execution.account,
    slippagePercentage: execution.quote?.metadata?.slippagePercentage,
  });
  const quote = await fetchDcaQuote(expected);
  await updateRecord("executions", execution.id, { quote }, req.userId);
  res.json({ ...quote, expiresAt: Date.now() + 120000 });
}));

app.patch(
  "/api/dca-executions/:id",
  asyncRoute(async (req, res) => {
    const allowedStatuses = new Set(["submitted", "failed", "cancelled"]);
    const status = req.body.status || "submitted";
    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ error: "invalid status" });
    }

    const execution = await assertRecordOwner("executions", req.params.id, req.userId);
    if (execution.status !== "prepared") return res.status(409).json({ error: "Execution is no longer pending" });
    if (status === "submitted" && !/^0x[a-fA-F0-9]{64}$/.test(req.body.tx_hash || req.body.txHash || "")) {
      return res.status(400).json({ error: "Valid transaction hash required" });
    }
    const patch = {
      status,
      user_id: req.userId,
      tx_hash: req.body.tx_hash || req.body.txHash || null,
      submitted_at: status === "submitted" ? new Date().toISOString() : null,
      error: req.body.error || null,
    };

    if (patch.user_id === undefined) {
      delete patch.user_id;
    }
    if (patch.user_id) {
      await assertRecordOwner("executions", req.params.id, patch.user_id);
    }

    const updated = await updateRecord("executions", req.params.id, patch, req.userId);
    res.json(updated || { id: req.params.id, ...patch });
  }),
);

app.post(
  "/api/dca-plans/check",
  asyncRoute(async (req, res) => {
    const result = await runDcaScheduleCheck(req.userId);
    res.json(result);
  }),
);

app.get(
  "/api/dca-plans",
  asyncRoute(async (req, res) => {
    const account = String(req.query.account || "").toLowerCase();
    const userId = await resolveRequestUserId(req, req.query.user_id || req.query.userId);
    const filters = {
      ...(account ? { account } : {}),
      ...(userId ? { user_id: userId } : {}),
    };
    const plans = await listRecords("dcaPlans", filters);
    const filtered = account
      ? plans.filter((plan) => {
          const accountMatches = String(plan.account || "").toLowerCase() === account;
          const userMatches = !userId || String(plan.user_id || "") === userId;
          return accountMatches && userMatches;
        })
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
    if (!["quotidien", "hebdo", "bimensuel", "mensuel"].includes(req.body.frequency || "hebdo") ||
        !Number.isInteger(Number(req.body.occurrences)) || Number(req.body.occurrences) < 1 || Number(req.body.occurrences) > 10000 ||
        (req.body.startDate && (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.startDate) || !Number.isFinite(Date.parse(req.body.startDate))))) {
      return res.status(400).json({ error: "Invalid DCA frequency, occurrences or start date" });
    }
    const chainId = Number(req.body.chainId || DEFAULT_CHAIN_ID);
    const sellToken = resolveToken(req.body.sellToken || req.body.baseStable || "USDC", chainId);
    const buyToken = resolveToken(req.body.buyToken, chainId) || resolveTargetToken(req.body.symbol, chainId);
    const amountPerRun = Number(req.body.amountPerRun) || 0;

    if (!sellToken || !buyToken) {
      return res.status(400).json({ error: "Unsupported DCA token for this chain" });
    }
    if (!amountPerRun || amountPerRun <= 0) {
      return res.status(400).json({ error: "amountPerRun must be greater than 0" });
    }

    try {
      validateQuoteRequest({
        chainId,
        sellToken: sellToken.address,
        buyToken: buyToken.native ? buyToken.symbol : buyToken.address,
        sellAmount: decimalToUnits(String(amountPerRun), sellToken.decimals),
        slippagePercentage: Number(req.body.slippage || 0.3) / 100,
        takerAddress: req.body.account,
      });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid DCA plan" });
    }

    const plan = {
      id: createId("plan"),
      account: req.body.account,
      user_id: (await resolveRequestUserId(req, req.body.user_id || req.body.userId)) || null,
      provider: req.body.provider || "0x",
      symbol: normalizeSymbol(req.body.symbol),
      amountPerRun,
      frequency: req.body.frequency || "hebdo",
      occurrences: Number(req.body.occurrences) || 0,
      startDate: req.body.startDate || new Date().toISOString().slice(0, 10),
      slippage: Number(req.body.slippage) || 0.3,
      chainId,
      baseStable: sellToken.symbol,
      sellToken: sellToken.address,
      buyToken: buyToken.address,
      sellTokenDecimals: sellToken.decimals,
      buyTokenDecimals: buyToken.decimals,
      runs_completed: 0,
      next_run_at: new Date(`${req.body.startDate || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`).toISOString(),
      last_run_at: null,
      last_prepared_execution_id: null,
      last_error: null,
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
    const userId = await resolveRequestUserId(req, req.query.user_id || req.query.userId);
    await assertRecordOwner("dcaPlans", req.params.id, userId);
    await deleteRecord("dcaPlans", req.params.id, userId);
    res.status(204).end();
  }),
);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  if (!err.status || err.status >= 500) console.error("[api]", err.message || "Service unavailable");
  res.status(err.status || 500).json({
    error: err.status ? err.message : "Internal server error",
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CryptoLine API listening on http://localhost:${PORT}`);
    startAlertWorker();
    startDcaWorker();
  });
}

module.exports = app;
