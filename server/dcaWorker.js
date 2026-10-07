const { fetchDcaQuote } = require("./zeroX");
const { insertRecord, listRecords, updateRecord } = require("./storage");
const {
  DEFAULT_CHAIN_ID,
  decimalToUnits,
  getNextRunAt,
  resolveTargetToken,
  resolveToken,
  validateQuoteRequest,
} = require("./dcaConfig");

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_RETRY_MS = 30 * 60_000;

let workerState = {
  enabled: false,
  running: false,
  lastRunAt: null,
  lastError: null,
  lastPreparedCount: 0,
  timer: null,
};

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSymbol(symbol) {
  return typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getInitialRunAt(plan) {
  const startDate = String(plan.startDate || plan.start_date || "").slice(0, 10);
  if (!startDate) return new Date();
  const date = new Date(`${startDate}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function getPlanNextRunDate(plan) {
  return parseDate(plan.next_run_at || plan.nextRunAt) || getInitialRunAt(plan);
}

function isPlanDue(plan, now) {
  const status = String(plan.status || "scheduled");
  if (status !== "scheduled") return false;
  const occurrences = Number(plan.occurrences || 0);
  const runsCompleted = Number(plan.runs_completed ?? plan.runsCompleted ?? 0);
  if (!occurrences || runsCompleted >= occurrences) return false;
  const nextRunAt = getPlanNextRunDate(plan);
  return nextRunAt.getTime() <= now.getTime();
}

function buildExpectedRequest(plan) {
  const chainId = Number(plan.chainId || plan.chain_id || DEFAULT_CHAIN_ID);
  const sellToken =
    resolveToken(plan.sellToken || plan.sell_token || plan.baseStable || plan.base_stable || "USDC", chainId);
  const buyToken =
    resolveToken(plan.buyToken || plan.buy_token, chainId) ||
    resolveTargetToken(normalizeSymbol(plan.symbol), chainId);

  const amountPerRun = Number(plan.amountPerRun ?? plan.amount_per_run ?? 0);
  if (!sellToken || !buyToken || !amountPerRun || amountPerRun <= 0) {
    throw new Error("Invalid DCA plan token or amount");
  }

  return validateQuoteRequest({
    chainId,
    sellToken: sellToken.address,
    buyToken: buyToken.native ? buyToken.symbol : buyToken.address,
    sellAmount: decimalToUnits(String(amountPerRun), sellToken.decimals),
    slippagePercentage: Number(plan.slippage || 0.3) / 100,
    takerAddress: plan.account,
  });
}

async function prepareDuePlan(plan, now) {
  if (plan.last_prepared_execution_id) {
    const previous = (await listRecords("executions", { id: plan.last_prepared_execution_id, user_id: plan.user_id }))[0];
    if (!previous || previous.status === "prepared") return null;
    if (previous.status === "submitted") {
      const runNumber = Number(previous.metadata?.run_number || 0);
      const completed = runNumber >= Number(plan.occurrences);
      await updateRecord("dcaPlans", plan.id, {
        runs_completed: runNumber,
        last_run_at: previous.submitted_at || now.toISOString(),
        next_run_at: completed ? null : getNextRunAt({ frequency: plan.frequency, from: now }),
        last_prepared_execution_id: null,
        status: completed ? "completed" : "scheduled",
      });
      return null;
    }
    // Cancelled or failed signatures leave the occurrence pending for a later retry.
  }
  const runsCompleted = Number(plan.runs_completed ?? plan.runsCompleted ?? 0);
  const runNumber = runsCompleted + 1;
  const dueAt = getPlanNextRunDate(plan);
  const expected = buildExpectedRequest(plan);
  const quote = await fetchDcaQuote(expected);

  const execution = await insertRecord("executions", {
    id: createId("exec"),
    account: plan.account,
    user_id: plan.user_id || null,
    connector: null,
    provider: plan.provider || "0x",
    status: "prepared",
    quote,
    metadata: {
      plan_id: plan.id,
      run_number: runNumber,
      due_at: dueAt.toISOString(),
      requires_wallet_signature: true,
      targetSymbol: normalizeSymbol(plan.symbol),
      sellToken: quote.sellTokenAddress,
      buyToken: quote.buyTokenAddress,
      sellAmount: quote.sellAmount,
      buyAmount: quote.buyAmount,
      chainId: expected.chainId,
    },
    created_at: now.toISOString(),
    submitted_at: null,
    tx_hash: null,
    error: null,
  });

  await updateRecord("dcaPlans", plan.id, {
    last_prepared_execution_id: execution.id,
    last_error: null,
  });

  return execution;
}

async function runDcaScheduleCheck(userId) {
  if (workerState.running) return { skipped: true, reason: "already_running" };

  workerState.running = true;
  workerState.lastError = null;
  const now = new Date();

  try {
    const plans = await listRecords("dcaPlans", { status: "scheduled", ...(userId ? { user_id: userId } : {}) });
    const duePlans = plans.filter((plan) => isPlanDue(plan, now));
    let preparedCount = 0;
    const errors = [];

    for (const plan of duePlans) {
      try {
        const execution = await prepareDuePlan(plan, now);
        if (execution) preparedCount += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : "DCA worker error";
        errors.push({ planId: plan.id, error: message });
        await updateRecord("dcaPlans", plan.id, {
          last_error: message,
          next_run_at: new Date(now.getTime() + DEFAULT_RETRY_MS).toISOString(),
        }).catch((updateErr) => {
          console.error("[dca-worker] plan error update failed", updateErr);
        });
      }
    }

    workerState.lastRunAt = now.toISOString();
    workerState.lastPreparedCount = preparedCount;
    if (errors.length) {
      workerState.lastError = `${errors.length} plan(s) failed`;
    }

    return {
      checkedPlans: plans.length,
      duePlans: duePlans.length,
      preparedCount,
      errors,
    };
  } catch (err) {
    workerState.lastError = err instanceof Error ? err.message : "DCA worker error";
    throw err;
  } finally {
    workerState.running = false;
  }
}

function startDcaWorker() {
  if (workerState.timer) return;
  if (process.env.DCA_WORKER_ENABLED === "false") {
    workerState.enabled = false;
    return;
  }

  const intervalMs = Number(process.env.DCA_WORKER_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  workerState.enabled = true;
  workerState.timer = setInterval(() => {
    runDcaScheduleCheck().catch((err) => {
      console.error("[dca-worker]", err);
    });
  }, Math.max(60_000, intervalMs));

  runDcaScheduleCheck().catch((err) => {
    console.error("[dca-worker]", err);
  });
}

function getDcaWorkerStatus() {
  return {
    enabled: workerState.enabled,
    running: workerState.running,
    lastRunAt: workerState.lastRunAt,
    lastError: workerState.lastError,
    lastPreparedCount: workerState.lastPreparedCount,
  };
}

module.exports = {
  getDcaWorkerStatus,
  runDcaScheduleCheck,
  startDcaWorker,
};
