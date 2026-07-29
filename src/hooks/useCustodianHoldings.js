import { useCallback, useEffect, useMemo, useState } from "react";

const DEFAULT_ENDPOINT = process.env.REACT_APP_CUSTODY_ENDPOINT || "/api/custody";

export default function useCustodianHoldings({ account, symbols = [], endpoint } = {}) {
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
    const custodyEndpoint = endpoint || DEFAULT_ENDPOINT;

    if (!custodyEndpoint) {
      setPositions([]);
      setHoldingsMap(null);
      setStatus("idle");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      setStatus((prev) => (prev === "ready" ? "refreshing" : "loading"));
      setError(null);
      try {
        const params = new URLSearchParams();
        if (account) params.append("account", account);
        if (normalizedSymbols.length) params.append("symbols", normalizedSymbols.join(","));
        const response = await fetch(`${custodyEndpoint}?${params.toString()}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Custodian API ${response.status}`);
        }
        const payload = await response.json();

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
  }, [account, endpoint, normalizedSymbols, refreshTick]);

  return {
    positions,
    holdingsMap,
    status,
    error,
    lastUpdated,
    refresh,
  };
}
