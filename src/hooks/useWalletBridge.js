import { useCallback, useEffect, useMemo, useState } from "react";

const WALLET_CONNECTORS = [
  {
    id: "walletconnect",
    label: "WalletConnect",
    description: "Mobile / QR multi-chain",
  },
  {
    id: "ledger-live",
    label: "Ledger Live",
    description: "Desktop Ledger / Bluetooth",
  },
];

const DEFAULT_BALANCES = {
  BTC: 0.42,
  ETH: 2.1,
  SOL: 35,
  USDC: 1200,
};

const DEFAULT_ACCOUNT = "0x9b6e...c74d";
const DEFAULT_NETWORK = "Ethereum";

export default function useWalletBridge({ symbols = [] } = {}) {
  const [connectorId, setConnectorId] = useState(null);
  const [status, setStatus] = useState("disconnected");
  const [account, setAccount] = useState(null);
  const [network, setNetwork] = useState(DEFAULT_NETWORK);
  const [balances, setBalances] = useState({});
  const [error, setError] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const endpoint = process.env.REACT_APP_WALLET_BRIDGE_ENDPOINT || null;

  const normalizedSymbols = useMemo(() => {
    return Array.from(new Set((symbols || []).map((symbol) => symbol?.toUpperCase()).filter(Boolean)));
  }, [symbols]);

  const normalizeBalances = useCallback(
    (payload) => {
      const next = {};
      normalizedSymbols.forEach((symbol) => {
        const value = payload?.[symbol];
        if (value === undefined || value === null) {
          next[symbol] = 0;
          return;
        }
        next[symbol] = Number(value) || 0;
      });
      if (!normalizedSymbols.includes("USDC") && payload?.USDC) {
        next.USDC = Number(payload.USDC) || 0;
      }
      return next;
    },
    [normalizedSymbols]
  );

  const mockPayload = useCallback(() => {
    const balancesPayload = { ...DEFAULT_BALANCES };
    normalizedSymbols.forEach((symbol, index) => {
      if (balancesPayload[symbol] === undefined) {
        balancesPayload[symbol] = Number((Math.sin(index + 1) + 1).toFixed(2));
      }
    });
    return {
      account: DEFAULT_ACCOUNT,
      balances: balancesPayload,
      network: DEFAULT_NETWORK,
    };
  }, [normalizedSymbols]);

  const connect = useCallback(
    async (targetConnector) => {
      if (!targetConnector) return;
      setStatus("connecting");
      setError(null);
      try {
        let payload;
        if (endpoint) {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ connector: targetConnector }),
          });
          if (!response.ok) {
            throw new Error(`Wallet bridge ${response.status}`);
          }
          payload = await response.json();
        } else {
          payload = await new Promise((resolve) => {
            setTimeout(() => resolve(mockPayload()), 600);
          });
        }
        setConnectorId(targetConnector);
        setAccount(payload.account || DEFAULT_ACCOUNT);
        setNetwork(payload.network || DEFAULT_NETWORK);
        setBalances(normalizeBalances(payload.balances || {}));
        setStatus("connected");
      } catch (err) {
        console.error("[useWalletBridge] connect error", err);
        setError(err instanceof Error ? err : new Error("Wallet bridge error"));
        setStatus("error");
      }
    },
    [endpoint, mockPayload, normalizeBalances]
  );

  const disconnect = useCallback(() => {
    setAccount(null);
    setConnectorId(null);
    setBalances({});
    setStatus("disconnected");
    setError(null);
  }, []);

  const refresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    if (status !== "connected" || !connectorId) return undefined;
    let cancelled = false;
    const reload = async () => {
      try {
        let payload;
        if (endpoint) {
          const response = await fetch(`${endpoint}?connector=${connectorId}`, {
            headers: { Accept: "application/json" },
          });
          if (!response.ok) {
            throw new Error(`Wallet bridge ${response.status}`);
          }
          payload = await response.json();
        } else {
          payload = mockPayload();
        }
        if (cancelled) return;
        setBalances(normalizeBalances(payload.balances || {}));
        setNetwork(payload.network || DEFAULT_NETWORK);
        setAccount(payload.account || account);
        setError(null);
        setStatus("connected");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error("Wallet bridge error"));
        setStatus("error");
      }
    };
    reload();
    return () => {
      cancelled = true;
    };
  }, [status, connectorId, endpoint, mockPayload, normalizeBalances, account, refreshTick]);

  return {
    connectors: WALLET_CONNECTORS,
    connectorId,
    status,
    account,
    network,
    balances,
    error,
    connect,
    disconnect,
    refresh,
  };
}
