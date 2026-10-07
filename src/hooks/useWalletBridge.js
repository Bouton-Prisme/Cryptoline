import EthereumProvider from "@walletconnect/ethereum-provider";
import { ethers } from "ethers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const WALLETCONNECT_PROJECT_ID =
  process.env.REACT_APP_WALLETCONNECT_PROJECT_ID ||
  "61f8ac0e1e9025fe80daaede38878711";

const DEFAULT_CHAIN_ID = 1;
const SUPPORTED_CHAINS = [1, 137, 42161, 8453];

const CHAIN_NAMES = {
  1: "Ethereum",
  137: "Polygon",
  42161: "Arbitrum",
  8453: "Base",
};

const TOKEN_CONTRACTS = {
  1: {
    USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    BTC: { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
  },
  137: {
    USDC: { address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", decimals: 6 },
  },
  42161: {
    USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    BTC: { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8 },
  },
  8453: {
    USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  },
};

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const NATIVE_TOKEN_ADDRESSES = new Set([
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "0x0000000000000000000000000000000000000000",
]);

const ZEROX_ALLOWED_SPENDERS = new Set([
  "0x0000000000001ff3684f28c67538d4d072c22734",
]);

function normalizeAddress(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function toDecimalChainId(chainId) {
  if (!chainId) return DEFAULT_CHAIN_ID;
  if (typeof chainId === "number") return chainId;
  if (typeof chainId === "string" && chainId.startsWith("0x")) {
    return parseInt(chainId, 16);
  }
  return Number(chainId) || DEFAULT_CHAIN_ID;
}

function hasInjectedProvider() {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

async function createWalletConnectProvider() {
  const provider = await EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [DEFAULT_CHAIN_ID],
    optionalChains: SUPPORTED_CHAINS,
    showQrModal: true,
    methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData"],
    optionalMethods: [
      "eth_requestAccounts",
      "eth_accounts",
      "eth_chainId",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
    ],
    events: ["accountsChanged", "chainChanged", "disconnect"],
    optionalEvents: ["connect", "message"],
    metadata: {
      name: "CryptoLine",
      description: "CryptoLine portfolio dashboard",
      url: window.location.origin,
      icons: [`${window.location.origin}/cryptolinelogo.png`],
    },
  });

  return provider;
}

async function requestAccounts(provider, connectorId) {
  if (connectorId === "injected") {
    return provider.request({ method: "eth_requestAccounts" });
  }

  const accounts = await provider.connect();
  return Array.isArray(accounts) ? accounts : provider.accounts || [];
}

async function readBalances(provider, account, symbols) {
  if (!provider || !account) return {};

  const web3Provider = new ethers.providers.Web3Provider(provider, "any");
  const network = await web3Provider.getNetwork();
  const chainId = Number(network.chainId || DEFAULT_CHAIN_ID);
  const nextBalances = {};
  const wanted = new Set((symbols || []).map((symbol) => symbol?.toUpperCase()).filter(Boolean));

  if (wanted.has("ETH") && [1, 42161, 8453].includes(chainId)) {
    const balance = await web3Provider.getBalance(account);
    nextBalances.ETH = Number(ethers.utils.formatEther(balance));
  }

  const tokenContracts = TOKEN_CONTRACTS[chainId] || {};
  await Promise.all(
    Array.from(wanted).map(async (symbol) => {
      const token = tokenContracts[symbol];
      if (!token) {
        if (nextBalances[symbol] === undefined) nextBalances[symbol] = 0;
        return;
      }
      try {
        const contract = new ethers.Contract(token.address, ERC20_ABI, web3Provider);
        const rawBalance = await contract.balanceOf(account);
        nextBalances[symbol] = Number(ethers.utils.formatUnits(rawBalance, token.decimals));
      } catch (err) {
        console.warn(`[useWalletBridge] ${symbol} balance unavailable`, err);
        nextBalances[symbol] = 0;
      }
    }),
  );

  if (!wanted.has("USDC") && tokenContracts.USDC) {
    try {
      const contract = new ethers.Contract(tokenContracts.USDC.address, ERC20_ABI, web3Provider);
      const rawBalance = await contract.balanceOf(account);
      nextBalances.USDC = Number(ethers.utils.formatUnits(rawBalance, tokenContracts.USDC.decimals));
    } catch (err) {
      console.warn("[useWalletBridge] USDC balance unavailable", err);
    }
  }

  return nextBalances;
}

export default function useWalletBridge({ symbols = [] } = {}) {
  const [connectorId, setConnectorId] = useState(null);
  const [status, setStatus] = useState("disconnected");
  const [account, setAccount] = useState(null);
  const [network, setNetwork] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [balances, setBalances] = useState({});
  const [error, setError] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const providerRef = useRef(null);

  const normalizedSymbols = useMemo(() => {
    return Array.from(
      new Set((symbols || []).map((symbol) => symbol?.toUpperCase()).filter(Boolean)),
    );
  }, [symbols]);

  const connectors = useMemo(() => {
    const base = [
      {
        id: "walletconnect",
        label: "WalletConnect",
        description: "Mobile / QR multi-chain",
      },
      {
        id: "ledger-live",
        label: "Ledger Live",
        description: "Ledger Wallet via WalletConnect",
      },
    ];

    if (hasInjectedProvider()) {
      return [
        {
          id: "injected",
          label: window.ethereum?.isMetaMask ? "MetaMask" : "Navigateur",
          description: "Extension EVM injectee",
        },
        ...base,
      ];
    }

    return base;
  }, []);

  const loadBalances = useCallback(
    async (provider, nextAccount = account) => {
      if (!provider || !nextAccount) return;
      const nextBalances = await readBalances(provider, nextAccount, normalizedSymbols);
      setBalances(nextBalances);
    },
    [account, normalizedSymbols],
  );

  const refresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  const clearWalletState = useCallback(() => {
    providerRef.current = null;
    setAccount(null);
    setConnectorId(null);
    setNetwork(null);
    setChainId(null);
    setBalances({});
    setStatus("disconnected");
    setError(null);
  }, []);

  const disconnect = useCallback(async () => {
    try {
      const provider = providerRef.current;
      if (provider?.disconnect) {
        await provider.disconnect();
      }
    } catch (err) {
      console.warn("[useWalletBridge] disconnect warning", err);
    } finally {
      clearWalletState();
    }
  }, [clearWalletState]);

  const attachProviderEvents = useCallback(
    (provider) => {
      if (!provider?.on) return;

      provider.on("accountsChanged", (accounts) => {
        const nextAccount = accounts?.[0] || null;
        setAccount(nextAccount);
        if (nextAccount) {
          loadBalances(provider, nextAccount).catch((err) => {
            console.error("[useWalletBridge] balance refresh error", err);
            setError(err instanceof Error ? err : new Error("Balance refresh error"));
          });
        }
      });

      provider.on("chainChanged", (chainId) => {
        const nextChainId = toDecimalChainId(chainId);
        setChainId(nextChainId);
        setNetwork(CHAIN_NAMES[nextChainId] || `Chain ${nextChainId}`);
        loadBalances(provider).catch((err) => {
          console.error("[useWalletBridge] chain balance refresh error", err);
          setError(err instanceof Error ? err : new Error("Balance refresh error"));
        });
      });

      provider.on("disconnect", () => {
        clearWalletState();
      });
    },
    [clearWalletState, loadBalances],
  );

  const connect = useCallback(
    async (targetConnector) => {
      if (!targetConnector) return;
      setStatus("connecting");
      setError(null);
      try {
        const provider =
          targetConnector === "injected"
            ? window.ethereum
            : await createWalletConnectProvider();

        if (!provider) {
          throw new Error("Aucun wallet EVM detecte dans ce navigateur.");
        }

        const accounts = await requestAccounts(provider, targetConnector);
        const nextAccount = accounts?.[0];
        if (!nextAccount) {
          throw new Error("Aucun compte wallet retourne.");
        }

        providerRef.current = provider;
        attachProviderEvents(provider);

        const rawChainId =
          (await provider.request?.({ method: "eth_chainId" })) || DEFAULT_CHAIN_ID;
        const nextChainId = toDecimalChainId(rawChainId);

        setConnectorId(targetConnector);
        setAccount(nextAccount);
        setChainId(nextChainId);
        setNetwork(CHAIN_NAMES[nextChainId] || `Chain ${nextChainId}`);
        await loadBalances(provider, nextAccount).catch((err) => {
          console.error("[useWalletBridge] initial balance error", err);
          setError(err instanceof Error ? err : new Error("Balance refresh error"));
        });
        setStatus("connected");
      } catch (err) {
        console.error("[useWalletBridge] connect error", err);
        setError(err instanceof Error ? err : new Error("Wallet connection error"));
        setStatus("error");
      }
    },
    [attachProviderEvents, loadBalances],
  );

  const sendSwapQuote = useCallback(
    async (quote) => {
      const provider = providerRef.current;
      if (!provider || !account) {
        throw new Error("Wallet non connecte.");
      }

      const ensureFreshQuote = () => {
        if (!quote?.expiresAt || Date.now() >= quote.expiresAt) {
          throw new Error("Devis expire. Actualise le devis avant de signer.");
        }
      };
      ensureFreshQuote();
      const liveProvider = new ethers.providers.Web3Provider(provider, "any");
      const liveNetwork = await liveProvider.getNetwork();
      if (Number(liveNetwork.chainId) !== Number(quote.chainId)) throw new Error("Reseau du wallet incorrect.");
      const activeAccounts = await provider.request({ method: "eth_accounts" });
      if (normalizeAddress(activeAccounts?.[0]) !== normalizeAddress(account) || normalizeAddress(quote.metadata?.takerAddress) !== normalizeAddress(account)) {
        throw new Error("Le compte du wallet a change. Actualise le devis.");
      }
      const tx = quote?.transaction || quote;
      if (!tx?.to || !tx?.data) {
        throw new Error("Quote 0x incomplete: transaction manquante.");
      }
      const quoteChainId = toDecimalChainId(quote?.chainId || quote?.metadata?.chainId || chainId);
      if (chainId && quoteChainId && Number(chainId) !== Number(quoteChainId)) {
        throw new Error("Le wallet n'est pas sur le reseau attendu pour ce quote.");
      }

      const txTo = normalizeAddress(tx.to);
      if (!ZEROX_ALLOWED_SPENDERS.has(txTo)) {
        throw new Error("Transaction refusee: contrat 0x non autorise.");
      }

      const sellTokenAddress = (
        quote?.sellTokenAddress ||
        quote?.sellToken?.address ||
        quote?.metadata?.sellToken ||
        ""
      ).toLowerCase();
      const expectedSellToken = normalizeAddress(quote?.metadata?.sellTokenAddress);
      const buyTokenAddress = normalizeAddress(
        quote?.buyTokenAddress ||
          quote?.buyToken?.address ||
          quote?.metadata?.buyTokenAddress ||
          "",
      );
      const expectedBuyToken = normalizeAddress(quote?.metadata?.buyTokenAddress);
      const allowanceTarget = (
        quote?.allowanceTarget ||
        quote?.issues?.allowance?.spender ||
        ""
      ).toLowerCase();
      const sellAmount = quote?.sellAmount || quote?.metadata?.sellAmount;

      if (expectedSellToken && normalizeAddress(sellTokenAddress) !== expectedSellToken) {
        throw new Error("Transaction refusee: token vendu inattendu.");
      }
      if (expectedBuyToken && buyTokenAddress !== expectedBuyToken) {
        throw new Error("Transaction refusee: token achete inattendu.");
      }
      if (allowanceTarget && !ZEROX_ALLOWED_SPENDERS.has(allowanceTarget)) {
        throw new Error("Transaction refusee: spender non autorise.");
      }

      if (
        sellTokenAddress &&
        allowanceTarget &&
        sellAmount &&
        !NATIVE_TOKEN_ADDRESSES.has(sellTokenAddress)
      ) {
        const web3Provider = new ethers.providers.Web3Provider(provider, "any");
        const token = new ethers.Contract(sellTokenAddress, ERC20_ABI, web3Provider);
        const currentAllowance = await token.allowance(account, allowanceTarget);
        const requiredAllowance = ethers.BigNumber.from(sellAmount);
        if (currentAllowance.lt(requiredAllowance)) {
          const approve = async amount => {
            const hash = await provider.request({
              method: "eth_sendTransaction",
              params: [{ from: account, to: sellTokenAddress,
                data: token.interface.encodeFunctionData("approve", [allowanceTarget, amount]), value: "0x0" }],
            });
            const receipt = await web3Provider.waitForTransaction(hash, 1, 120000);
            if (!receipt || receipt.status !== 1) throw new Error("Approbation du token non confirmee.");
          };
          // USDT and similar tokens require clearing a nonzero allowance first.
          if (!currentAllowance.isZero()) await approve(0);
          ensureFreshQuote();
          await approve(requiredAllowance);
        }
      }

      ensureFreshQuote();
      const currentChain = await provider.request({ method: "eth_chainId" });
      const currentAccounts = await provider.request({ method: "eth_accounts" });
      if (Number(currentChain) !== Number(quote.chainId) || normalizeAddress(currentAccounts?.[0]) !== normalizeAddress(account)) {
        throw new Error("Le compte ou le reseau du wallet a change.");
      }
      const swapTx = {
        from: account,
        to: tx.to,
        data: tx.data,
        value: tx.value ? ethers.BigNumber.from(tx.value).toHexString() : "0x0",
      };

      if (tx.gas) swapTx.gas = ethers.BigNumber.from(tx.gas).toHexString();
      if (tx.gasPrice) swapTx.gasPrice = ethers.BigNumber.from(tx.gasPrice).toHexString();
      if (tx.maxFeePerGas) {
        swapTx.maxFeePerGas = ethers.BigNumber.from(tx.maxFeePerGas).toHexString();
      }
      if (tx.maxPriorityFeePerGas) {
        swapTx.maxPriorityFeePerGas = ethers.BigNumber.from(tx.maxPriorityFeePerGas).toHexString();
      }

      return provider.request({
        method: "eth_sendTransaction",
        params: [swapTx],
      });
    },
    [account, chainId],
  );

  useEffect(() => {
    if (status !== "connected" || !providerRef.current || !account) return;
    loadBalances(providerRef.current, account).catch((err) => {
      console.error("[useWalletBridge] refresh error", err);
      setError(err instanceof Error ? err : new Error("Balance refresh error"));
      setStatus("error");
    });
  }, [account, loadBalances, refreshTick, status]);

  return {
    connectors,
    connectorId,
    status,
    account,
    network,
    chainId,
    balances,
    error,
    connect,
    disconnect,
    refresh,
    sendSwapQuote,
  };
}
