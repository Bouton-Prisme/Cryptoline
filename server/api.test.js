const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const rows = {
  alerts: [{ id: "a", user_id: "alice", symbol: "BTC" }, { id: "b", user_id: "bob", symbol: "BTC" }],
  wallets: [{ id: "wa", user_id: "alice" }, { id: "wb", user_id: "bob" }],
  executions: [{ id: "eb", user_id: "bob" }],
  dcaPlans: [{ id: "pb", user_id: "bob" }],
};
const mutations = [];
const checks = [];
// No real database, account, webhook or trade is used by these HTTP regression tests.
require.cache[require.resolve("./storage")] = { exports: {
  isSupabaseEnabled: () => true,
  checkStorageHealth: async () => ({ ready: false, error: "unavailable" }),
  getUserIdFromAccessToken: async token => {
    if (token !== "alice-session") throw Object.assign(new Error("Invalid session"), { status: 401 });
    return "alice";
  },
  listRecords: async (name, filters = {}) => (rows[name] || []).filter(row => Object.entries(filters).every(([k,v]) => row[k] === v)),
  deleteRecord: async (...args) => mutations.push(args),
  updateRecord: async (...args) => { mutations.push(args); return { id: args[1], ...args[2] }; },
  insertRecord: async (name, row) => { mutations.push([name, row]); return row; },
  upsertRecord: async (name, row) => { mutations.push([name, row]); return row; },
} };
for (const [file, run, status, start] of [
  ["./alertWorker", "runAlertCheck", "getAlertWorkerStatus", "startAlertWorker"],
  ["./dcaWorker", "runDcaScheduleCheck", "getDcaWorkerStatus", "startDcaWorker"],
]) require.cache[require.resolve(file)] = { exports: {
  [run]: async userId => { checks.push(userId); return { checked: true }; }, [status]: () => ({}), [start]: () => {},
} };

let server, base;
before(async () => {
  const app = require("./index");
  server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));
function request(path, method = "GET", body, token = "alice-session") {
  return fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test("all private routes reject anonymous callers before reading or writing", async () => {
  for (const [path, method] of [
    ["/api/alerts", "GET"], ["/api/alerts", "POST"], ["/api/alerts/a", "DELETE"],
    ["/api/alert-events", "GET"], ["/api/alerts/check", "POST"],
    ["/api/wallets", "GET"], ["/api/wallets", "POST"], ["/api/wallets/wa", "PATCH"], ["/api/wallets/wa", "DELETE"],
    ["/api/exchange-connections", "GET"], ["/api/exchange-connections", "POST"],
    ["/api/custody", "GET"], ["/api/custody/positions", "POST"],
    ["/api/dca-executions", "GET"], ["/api/dca-executions/eb/quote", "POST"],
    ["/api/dca-quote", "GET"], ["/api/execute-dca", "POST"], ["/api/dca-executions/eb", "PATCH"],
    ["/api/dca-plans", "GET"], ["/api/dca-plans", "POST"], ["/api/dca-plans/pb", "DELETE"], ["/api/dca-plans/check", "POST"],
  ]) assert.equal((await request(path, method, undefined, "")).status, 401, `${method} ${path}`);
  assert.equal(mutations.length, 0);
});

test("invalid tokens and forged identities are rejected", async () => {
  assert.equal((await request("/api/wallets", "GET", undefined, "invalid")).status, 401);
  assert.equal((await request("/api/alerts?user_id=bob")).status, 403);
  assert.equal((await request("/api/wallets", "POST", { userId: "bob" })).status, 403);
});

test("lists only return the authenticated owner's data", async () => {
  const response = await request("/api/alerts");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map(row => row.id), ["a"]);
});

test("other users' records cannot be modified even when user_id is omitted", async () => {
  const count = mutations.length;
  for (const [path, method, body] of [
    ["/api/alerts/b", "DELETE"], ["/api/wallets/wb", "PATCH", { name: "changed" }],
    ["/api/wallets/wb", "DELETE"], ["/api/dca-plans/pb", "DELETE"],
    ["/api/dca-executions/eb", "PATCH", { status: "cancelled" }],
    ["/api/dca-executions/eb/quote", "POST"],
    ["/api/wallets/missing", "PATCH", { name: "changed" }],
  ]) assert.equal((await request(path, method, body)).status, 404, path);
  assert.equal(mutations.length, count);
});

test("own deletes are scoped at the storage layer", async () => {
  assert.equal((await request("/api/alerts/a", "DELETE")).status, 204);
  assert.deepEqual(mutations.at(-1), ["alerts", "a", "alice"]);
});

test("clients cannot choose the primary key of a wallet", async () => {
  const response = await request("/api/wallets", "POST", { id: "wb", name: "Wallet", provider: "manual" });
  assert.equal(response.status, 201);
  const wallet = await response.json();
  assert.notEqual(wallet.id, "wb");
  assert.equal(wallet.user_id, "alice");
});

test("manual worker checks are limited to the authenticated user", async () => {
  for (const path of ["/api/alerts/check", "/api/dca-plans/check"]) assert.equal((await request(path, "POST")).status, 200);
  assert.deepEqual(checks, ["alice", "alice"]);
});

test("readiness fails when storage is unavailable", async () => {
  assert.equal((await request("/api/health", "GET", undefined, "")).status, 200);
  assert.equal((await request("/api/ready", "GET", undefined, "")).status, 503);
});

test("untrusted DCA transaction payloads cannot be prepared", async () => {
  const response = await request("/api/execute-dca", "POST", { account: "0x" + "1".repeat(40), quote: { transaction: { to: "0x" + "2".repeat(40), data: "0x1234" } } });
  assert.equal(response.status, 400);
});

test("a server-issued v2 quote can be prepared for its owner", async () => {
  const { issueQuote } = require("./zeroX");
  const { validatePreparedQuote, validateQuoteRequest } = require("./dcaConfig");
  const account = "0x" + "1".repeat(40);
  const expected = validateQuoteRequest({ sellToken: "USDC", buyToken: "ETH", sellAmount: "1000000", takerAddress: account, chainId: 1 });
  const holder = "0x0000000000001ff3684f28c67538d4d072c22734";
  const quote = issueQuote(validatePreparedQuote({ sellToken: expected.sellToken.address, buyToken: expected.buyToken.address, sellAmount: "1000000", buyAmount: "1000", transaction: { to: holder, data: "0x1234", value: "0" } }, expected), "alice");
  const response = await request("/api/execute-dca", "POST", { account, quote });
  assert.equal(response.status, 201, await response.clone().text());
  const execution = await response.json();
  assert.equal(execution.status, "prepared");
  assert.equal(execution.quote.metadata.takerAddress, account);
  assert.ok(execution.quote.expiresAt > Date.now());
  assert.equal((await request("/api/execute-dca", "POST", { account: "0x" + "2".repeat(40), quote })).status, 400);
});
