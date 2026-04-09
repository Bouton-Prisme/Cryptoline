import { useCallback, useEffect, useMemo, useState } from "react";

const DEFAULT_ENDPOINT = process.env.REACT_APP_CUSTODY_ENDPOINT || null;

export default function useCustodianHoldings({ account, symbols = [] } = {}) {
  const [positions, setPositions] = useState([]);
  const [holdingsMap, setHoldingsMap] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const normalizedSymbols = useMemo(() => {
    return Array.from(new Set((symbols || []).map((symbol) => symbol?.toUpperCase()).filter(Boolean)));
  }, [symbols]);

  const refresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    if (!account && !DEFAULT_ENDPOINT) {
      setPositions([]);
      setHoldingsMap(null);
      setStatus("idle");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      if (!account && DEFAULT_ENDPOINT) return;
      setStatus((prev) => (prev === "ready" ? "refreshing" : "loading"));
      setError(null);
      try {
        let payload;
        if (DEFAULT_ENDPOINT) {
          const params = new URLSearchParams();
          if (account) params.append("account", account);
          if (normalizedSymbols.length) params.append("symbols", normalizedSymbols.join(","));
          const response = await fetch(`${DEFAULT_ENDPOINT}?${params.toString()}`, {
            headers: { Accept: "application/json" },
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`Custodian API ${response.status}`);
          }
          payload = await response.json();
        } else {
          payload = {
            positions: normalizedSymbols.map((symbol, index) => ({
              symbol,
              amount: Math.max(0, Number((Math.cos(index + 1) + 1).toFixed(3))),
              cost_basis: Math.max(100, (index + 1) * 4500),
              provider: "Sandbox Custodian",
              updated_at: new Date(Date.now() - index * 60000).toISOString(),
            })),
          };
        }

        if (cancelled) return;

        const rawPositions = Array.isArray(payload?.positions)
          ? payload.positions
          : Array.isArray(payload)
            ? payload
            : [];

        const sanitized = rawPositions
          .map((position) => {
            const symbol = position.symbol?.toUpperCase();
            if (!symbol) return null;
            return {
              symbol,
              amount: Number(position.amount) || 0,
              costBasis: Number(position.cost_basis ?? position.costBasis ?? 0),
              provider: position.provider || "Custodian",
              lastSync: position.updated_at || position.updatedAt || new Date().toISOString(),
            };
          })
          .filter(Boolean);

        const holdings = sanitized.reduce((acc, position) => {
          acc[position.symbol] = position.amount;
          return acc;
        }, {});

        setPositions(sanitized);
        setHoldingsMap(holdings);
        setLastUpdated(new Date());
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[useCustodianHoldings] fetch error", err);
        setError(err instanceof Error ? err : new Error("Custodian API error"));
        setStatus("error");
      }
    };

    load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [account, normalizedSymbols, refreshTick]);

  return {
    positions,
    holdingsMap,
    status,
    error,
    lastUpdated,
    refresh,
  };
}
