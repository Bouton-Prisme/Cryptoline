const crypto = require("crypto");
const { validatePreparedQuote } = require("./dcaConfig");

const QUOTE_ENDPOINT = "https://api.0x.org/swap/allowance-holder/quote";
const signingKey = crypto.randomBytes(32);
const QUOTE_TTL_MS = 120000;

function signature(quote, userId, expiresAt) {
  return crypto.createHmac("sha256", signingKey)
    .update(JSON.stringify({ quote, userId, expiresAt })).digest("hex");
}

function issueQuote(quote, userId) {
  const expiresAt = Date.now() + QUOTE_TTL_MS;
  return { ...quote, proof: { expiresAt, signature: signature(quote, userId, expiresAt) } };
}

function verifyQuote(signedQuote, userId) {
  const { proof, ...quote } = signedQuote || {};
  if (!proof || !Number.isFinite(proof.expiresAt) || proof.expiresAt < Date.now()) {
    throw Object.assign(new Error("Devis expire. Actualise le devis avant de signer."), { status: 400 });
  }
  const expected = signature(quote, userId, proof.expiresAt);
  const actual = typeof proof.signature === "string" ? proof.signature : "";
  if (!/^[a-f0-9]{64}$/.test(actual) || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    throw Object.assign(new Error("Invalid quote signature"), { status: 400 });
  }
  return quote;
}

async function fetchDcaQuote(expected) {
  if (!process.env.ZEROX_API_KEY) {
    throw Object.assign(new Error("Devis indisponible : cle 0x manquante sur le serveur."), { status: 503 });
  }
  // Keep API keys restricted to the official 0x endpoint.
  if (process.env.ZEROX_QUOTE_ENDPOINT && process.env.ZEROX_QUOTE_ENDPOINT !== QUOTE_ENDPOINT) {
    throw Object.assign(new Error("Configure ZEROX_QUOTE_ENDPOINT avec l'endpoint AllowanceHolder v2."), { status: 503 });
  }
  const params = new URLSearchParams({
    chainId: String(expected.chainId),
    sellToken: expected.sellToken.address,
    buyToken: expected.buyToken.address,
    sellAmount: expected.sellAmount,
    taker: expected.takerAddress,
    slippageBps: String(Math.round(expected.slippagePercentage * 10000)),
  });
  const response = await fetch(`${QUOTE_ENDPOINT}?${params}`, {
    headers: { Accept: "application/json", "0x-api-key": process.env.ZEROX_API_KEY, "0x-version": "v2" },
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload.reason || payload.message || `0x quote ${response.status}`), { status: 502 });
  }
  return validatePreparedQuote(payload, expected);
}

module.exports = { fetchDcaQuote, issueQuote, verifyQuote };
