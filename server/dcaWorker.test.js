const { test } = require("node:test");
const assert = require("node:assert/strict");
let plans = [], executions = [], quoteCalls = 0;
require.cache[require.resolve("./storage")] = { exports: {
  listRecords: async (name, filters) => (name === "dcaPlans" ? plans : executions).filter(row => Object.entries(filters).every(([k,v]) => row[k] === v)),
  insertRecord: async (name, row) => { executions.push(row); return row; },
  updateRecord: async (name, id, patch) => { const row = (name === "dcaPlans" ? plans : executions).find(row => row.id === id); Object.assign(row, patch); return row; },
} };
require.cache[require.resolve("./zeroX")] = { exports: { fetchDcaQuote: async expected => {
  quoteCalls++;
  return { sellTokenAddress: expected.sellToken.address, buyTokenAddress: expected.buyToken.address, sellAmount: expected.sellAmount, buyAmount: "100" };
} } };
const { runDcaScheduleCheck } = require("./dcaWorker");

test("scheduled orders wait for signature and never count preparation as a submission", async () => {
  plans = [{ id: "pa", user_id: "alice", account: "0x" + "1".repeat(40), status: "scheduled", symbol: "ETH", amountPerRun: 1, frequency: "hebdo", occurrences: 1, startDate: "2020-01-01", runs_completed: 0 },
    { id: "pb", user_id: "bob", status: "scheduled", occurrences: 1, startDate: "2020-01-01" }];
  assert.equal((await runDcaScheduleCheck("alice")).preparedCount, 1);
  assert.equal(plans[0].runs_completed, 0);
  assert.equal(plans[0].status, "scheduled");
  assert.equal((await runDcaScheduleCheck("alice")).preparedCount, 0);
  assert.equal(quoteCalls, 1);
  assert.equal(executions.length, 1);
  executions[0].status = "submitted";
  assert.equal((await runDcaScheduleCheck("alice")).preparedCount, 0);
  assert.equal(plans[0].runs_completed, 1);
  assert.equal(plans[0].status, "completed");
  assert.equal(plans[1].last_prepared_execution_id, undefined);
});
