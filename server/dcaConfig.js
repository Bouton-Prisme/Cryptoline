const DEFAULT_CHAIN_ID = 1;
const SUPPORTED_CHAINS = [1, 137, 42161, 8453];

const TOKEN_REGISTRY = {
  1: {
    ETH: {
      symbol: "ETH",
      address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      decimals: 18,
      native: true,
    },
    USDC: {
      symbol: "USDC",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      decimals: 6,
    },
    USDT: {
      symbol: "USDT",
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      decimals: 6,
    },
    DAI: {
      symbol: "DAI",
      address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      decimals: 18,
    },
    WBTC: {
      symbol: "WBTC",
      address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      decimals: 8,
    },
  },
  137: {
    USDC: {
      symbol: "USDC",
      address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      decimals: 6,
    },
    USDT: {
      symbol: "USDT",
      address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
      decimals: 6,
    },
  },
  42161: {
    ETH: {
      symbol: "ETH",
      address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      decimals: 18,
      native: true,
    },
    USDC: {
      symbol: "USDC",
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      decimals: 6,
    },
    USDT: {
      symbol: "USDT",
      address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      decimals: 6,
    },
    WBTC: {
      symbol: "WBTC",
      address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
      decimals: 8,
    },
  },
  8453: {
    ETH: {
      symbol: "ETH",
      address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      decimals: 18,
      native: true,
    },
    USDC: {
      symbol: "USDC",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
    },
  },
};

const SYMBOL_SWAP_TOKEN = {
  BTC: "WBTC",
  ETH: "ETH",
};

const DEFAULT_ZEROX_SPENDERS = [
  "0x0000000000001ff3684f28c67538d4d072c22734",
];

function normalizeAddress(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeSymbol(symbol) {
  return typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
}

function toDecimalChainId(chainId) {
  const parsed = Number(chainId || DEFAULT_CHAIN_ID);
  return SUPPORTED_CHAINS.includes(parsed) ? parsed : null;
}

function getAllowedSpenders() {
  return new Set(DEFAULT_ZEROX_SPENDERS.map(normalizeAddress));
}

function resolveToken(token, chainId = DEFAULT_CHAIN_ID) {
  const normalizedChainId = toDecimalChainId(chainId);
  if (!normalizedChainId) return null;
  const registry = TOKEN_REGISTRY[normalizedChainId] || {};
  const symbol = normalizeSymbol(token);
  if (symbol && registry[symbol]) return registry[symbol];

  const address = normalizeAddress(token);
  if (!address) return null;
  return Object.values(registry).find((entry) => normalizeAddress(entry.address) === address) || null;
}

function resolveTargetToken(symbol, chainId = DEFAULT_CHAIN_ID) {
  const swapSymbol = SYMBOL_SWAP_TOKEN[normalizeSymbol(symbol)];
  return swapSymbol ? resolveToken(swapSymbol, chainId) : null;
}

function decimalToUnits(value, decimals) {
  const numericDecimals = Number(decimals);
  if (!Number.isInteger(numericDecimals) || numericDecimals < 0 || numericDecimals > 36) {
    throw new Error("Invalid token decimals");
  }

  const raw = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error("Invalid token amount");
  }

  const [whole, fractional = ""] = raw.split(".");
  const paddedFractional = fractional.slice(0, numericDecimals).padEnd(numericDecimals, "0");
  const units = `${whole}${paddedFractional}`.replace(/^0+(?=\d)/, "");
  return units || "0";
}

function validateQuoteRequest(raw) {
  const chainId = toDecimalChainId(raw.chainId);
  if (!chainId) {
    throw new Error("Unsupported DCA chain");
  }

  const sellToken = resolveToken(raw.sellToken, chainId);
  const buyToken = resolveToken(raw.buyToken, chainId);
  if (!sellToken || !buyToken) {
    throw new Error("Unsupported DCA token for this chain");
  }
  if (normalizeAddress(sellToken.address) === normalizeAddress(buyToken.address)) {
    throw new Error("sellToken and buyToken must be different");
  }

  const sellAmount = raw.sellAmount ? String(raw.sellAmount) : "";
  const buyAmount = raw.buyAmount ? String(raw.buyAmount) : "";
  if (!/^\d+$/.test(sellAmount) || BigInt(sellAmount) <= 0n || buyAmount) {
    throw new Error("A positive sellAmount is required; buyAmount is not supported");
  }

  const takerAddress = normalizeAddress(raw.takerAddress);
  if (!/^0x[a-f0-9]{40}$/.test(takerAddress) || /^0x0{40}$/.test(takerAddress)) {
    throw new Error("Invalid takerAddress");
  }

  const slippage = Number(raw.slippagePercentage ?? 0.003);
  if (!Number.isFinite(slippage) || slippage <= 0 || slippage > 0.05) {
    throw new Error("slippagePercentage must be between 0 and 0.05");
  }

  return {
    chainId,
    sellToken,
    buyToken,
    sellAmount,
    buyAmount,
    takerAddress,
    slippagePercentage: slippage,
  };
}

function validatePreparedQuote(quote, expected) {
  const tx = quote?.transaction || quote;
  if (!tx?.to || !tx?.data) {
    throw new Error("Quote transaction is incomplete");
  }

  if (quote.liquidityAvailable === false || !/^0x(?:[a-fA-F0-9]{2})+$/.test(tx.data)) {
    throw new Error("Quote has no executable liquidity");
  }
  if (!/^\d+$/.test(String(quote.buyAmount)) || BigInt(quote.buyAmount) <= 0n) {
    throw new Error("Invalid quote buy amount");
  }
  if (!/^\d+$/.test(String(tx.value ?? "0")) || BigInt(tx.value || "0") !== (expected.sellToken.native ? BigInt(expected.sellAmount) : 0n)) {
    throw new Error("Unexpected native transaction value");
  }
  const allowedSpenders = getAllowedSpenders();
  const txTo = normalizeAddress(tx.to);
  const allowanceTarget = normalizeAddress(
    quote.allowanceTarget || quote.issues?.allowance?.spender || tx.to,
  );
  if (!allowedSpenders.has(txTo)) {
    throw new Error("Quote destination is not an allowed 0x spender");
  }
  if (allowanceTarget && !allowedSpenders.has(allowanceTarget)) {
    throw new Error("Quote allowance target is not allowed");
  }

  const sellTokenAddress = normalizeAddress(
    quote.sellTokenAddress || (typeof quote.sellToken === "string" ? quote.sellToken : quote.sellToken?.address),
  );
  const buyTokenAddress = normalizeAddress(
    quote.buyTokenAddress || (typeof quote.buyToken === "string" ? quote.buyToken : quote.buyToken?.address),
  );
  if (sellTokenAddress !== normalizeAddress(expected.sellToken.address)) {
    throw new Error("Quote sell token mismatch");
  }
  if (buyTokenAddress !== normalizeAddress(expected.buyToken.address)) {
    throw new Error("Quote buy token mismatch");
  }
  if (expected.sellAmount && String(quote.sellAmount || "") !== expected.sellAmount) {
    throw new Error("Quote sell amount mismatch");
  }

  return {
    ...quote,
    sellTokenAddress: expected.sellToken.address,
    buyTokenAddress: expected.buyToken.address,
    sellTokenDecimals: expected.sellToken.decimals,
    buyTokenDecimals: expected.buyToken.decimals,
    chainId: expected.chainId,
    allowanceTarget,
    estimatedGas: tx.gas,
    price: (Number(quote.buyAmount) / 10 ** expected.buyToken.decimals) / (Number(quote.sellAmount) / 10 ** expected.sellToken.decimals),
    guaranteedPrice: (Number(quote.minBuyAmount || quote.buyAmount) / 10 ** expected.buyToken.decimals) / (Number(quote.sellAmount) / 10 ** expected.sellToken.decimals),
    sources: (quote.route?.fills || []).map(fill => ({ name: fill.source, proportion: Number(fill.proportionBps) / 10000 })),
    metadata: {
      ...(quote.metadata || {}),
      validated: true,
      chainId: expected.chainId,
      sellToken: expected.sellToken.symbol,
      buyToken: expected.buyToken.symbol,
      sellAmount: expected.sellAmount || quote.sellAmount,
      takerAddress: expected.takerAddress || null,
      slippagePercentage: expected.slippagePercentage,
    },
  };
}

function getNextRunAt({ frequency, from = new Date() }) {
  const next = new Date(from);
  switch (frequency) {
    case "quotidien":
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case "mensuel":
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case "bimensuel":
      next.setUTCDate(next.getUTCDate() + 15);
      break;
    case "hebdo":
    default:
      next.setUTCDate(next.getUTCDate() + 7);
      break;
  }
  return next.toISOString();
}

module.exports = {
  DEFAULT_CHAIN_ID,
  SUPPORTED_CHAINS,
  TOKEN_REGISTRY,
  decimalToUnits,
  getNextRunAt,
  resolveTargetToken,
  resolveToken,
  validatePreparedQuote,
  validateQuoteRequest,
};
