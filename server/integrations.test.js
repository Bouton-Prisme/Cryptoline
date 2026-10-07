const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseMarketMessage } = require("../src/lib/marketStream");
const { validateQuoteRequest, validatePreparedQuote } = require("./dcaConfig");
const { fetchDcaQuote, issueQuote, verifyQuote } = require("./zeroX");

const taker = "0x" + "1".repeat(40);
const request = { chainId: 1, sellToken: "USDC", buyToken: "ETH", sellAmount: "1000000", takerAddress: taker };
const expected = validateQuoteRequest(request);
const holder = "0x0000000000001ff3684f28c67538d4d072c22734";
const quote = { liquidityAvailable: true, sellToken: expected.sellToken.address, buyToken: expected.buyToken.address, sellAmount: "1000000", buyAmount: "400000000000000", minBuyAmount: "390000000000000", issues: { allowance: { spender: holder } }, transaction: { to: holder, data: "0x1234", value: "0", gas: "180000" } };

test("Binance miniTicker uses open price for percentage and quote volume", () => {
  const result = parseMarketMessage({ stream: "btcusdt@miniTicker", data: { s: "BTCUSDT", c: "110", o: "100", v: "3", q: "330" } }, { BTCUSDT: "BTC" });
  assert.equal(result.price, 110);
  assert.equal(result.change24h, 10);
  assert.equal(result.volume24h, 330);
});
test("Binance depth identifies the pair even without data.s", () => {
  const result = parseMarketMessage({ stream: "btcusdt@depth5@100ms", data: { bids: [["100", "2"]], asks: [["101", "3"]], lastUpdateId: 4 } }, { BTCUSDT: "BTC" });
  assert.equal(result.symbol, "BTC");
  assert.deepEqual(result.bids, [{ price: 100, size: 2 }]);
  assert.equal(parseMarketMessage({ stream: "other@depth5", data: {} }, { BTCUSDT: "BTC" }), null);
});
test("DCA rejects zero amounts, unsupported networks, missing takers and excessive slippage", () => {
  for (const patch of [{ sellAmount: "0" }, { buyAmount: "1" }, { chainId: 56 }, { takerAddress: "" }, { slippagePercentage: 0 }, { slippagePercentage: 0.1 }]) assert.throws(() => validateQuoteRequest({ ...request, ...patch }));
});
test("DCA normalizes v2 quotes and rejects wrong tokens, spenders and native transfers", () => {
  assert.equal(validatePreparedQuote(quote, expected).sellTokenAddress, expected.sellToken.address);
  for (const patch of [
    { sellToken: taker }, { buyToken: taker }, { sellAmount: "2000000" }, { buyAmount: "0" },
    { liquidityAvailable: false }, { transaction: { ...quote.transaction, to: taker } },
    { transaction: { ...quote.transaction, value: "1" } }, { transaction: { ...quote.transaction, data: "garbage" } },
    { issues: { allowance: { spender: taker } } },
  ]) assert.throws(() => validatePreparedQuote({ ...quote, ...patch }, expected));
});
test("issued quotes cannot be modified, reused by another user or used after expiry", () => {
  const signed = issueQuote(quote, "alice");
  assert.deepEqual(verifyQuote(signed, "alice"), quote);
  assert.throws(() => verifyQuote(signed, "bob"));
  assert.throws(() => verifyQuote({ ...signed, sellAmount: "2" }, "alice"));
  assert.throws(() => verifyQuote({ ...signed, proof: { ...signed.proof, expiresAt: 1 } }, "alice"));
});
test("0x requests use v2 headers and AllowanceHolder query fields", async () => {
  const oldFetch = global.fetch, oldKey = process.env.ZEROX_API_KEY, oldEndpoint = process.env.ZEROX_QUOTE_ENDPOINT;
  process.env.ZEROX_API_KEY = "test-key";
  delete process.env.ZEROX_QUOTE_ENDPOINT;
  try {
    global.fetch = async (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, "/swap/allowance-holder/quote");
      assert.equal(parsed.searchParams.get("taker"), taker);
      assert.equal(parsed.searchParams.get("slippageBps"), "30");
      assert.equal(parsed.searchParams.get("buyToken"), expected.buyToken.address);
      assert.equal(options.headers["0x-version"], "v2");
      return { ok: true, json: async () => quote };
    };
    assert.equal((await fetchDcaQuote(expected)).buyAmount, quote.buyAmount);
    delete process.env.ZEROX_API_KEY;
    await assert.rejects(fetchDcaQuote(expected), { status: 503 });
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ZEROX_API_KEY; else process.env.ZEROX_API_KEY = oldKey;
    if (oldEndpoint === undefined) delete process.env.ZEROX_QUOTE_ENDPOINT; else process.env.ZEROX_QUOTE_ENDPOINT = oldEndpoint;
  }
});
