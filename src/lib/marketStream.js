// Combined depth streams identify their symbol in `stream`, not in `data.s`.
function parseMarketMessage(payload, pairToSymbol) {
  if (!payload?.stream || !payload.data) return null;
  const stream = payload.stream.toLowerCase();
  const pair = String(payload.data.s || stream.split("@")[0]).toUpperCase();
  const symbol = pairToSymbol[pair];
  if (!symbol) return null;
  if (stream.includes("@miniticker")) {
    const price = Number(payload.data.c);
    const open = Number(payload.data.o);
    const volume = Number(payload.data.q); // Quote currency volume, consistent with the USD snapshot.
    if (!Number.isFinite(price) || price <= 0) return null;
    return { type: "ticker", symbol, price,
      change24h: open > 0 ? ((price - open) / open) * 100 : null,
      volume24h: Number.isFinite(volume) && volume >= 0 ? volume : null };
  }
  if (stream.includes("@depth5")) {
    const levels = entries => (Array.isArray(entries) ? entries : []).slice(0, 5)
      .map(([price, size]) => ({ price: Number(price), size: Number(size) }))
      .filter(level => Number.isFinite(level.price) && Number.isFinite(level.size));
    return { type: "depth", symbol, bids: levels(payload.data.bids), asks: levels(payload.data.asks), lastUpdateId: payload.data.lastUpdateId };
  }
  return null;
}

module.exports = { parseMarketMessage };
