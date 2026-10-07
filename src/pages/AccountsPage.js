import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useAppPreferences } from "../context/AppPreferencesContext";
import { MARKET_UNIVERSE } from "../hooks/useMarketData";

const NETWORK_OPTIONS = [
  { value: "ethereum", label: "Ethereum" },
  { value: "polygon", label: "Polygon" },
  { value: "arbitrum", label: "Arbitrum" },
  { value: "base", label: "Base" },
  { value: "solana", label: "Solana" },
  { value: "bitcoin", label: "Bitcoin" },
  { value: "cosmos", label: "Cosmos" },
  { value: "tron", label: "Tron" },
];

const CHAIN_FAMILY_OPTIONS = [
  { value: "evm", label: "EVM" },
  { value: "solana", label: "Solana" },
  { value: "bitcoin", label: "Bitcoin" },
  { value: "cosmos", label: "Cosmos" },
  { value: "tron", label: "Tron" },
  { value: "other", label: "Autre" },
];

const WALLET_TYPE_OPTIONS = [
  {
    value: "self-custody",
    label: "Wallet personnel",
    helper: "Vous détenez les clés.",
  },
  {
    value: "exchange",
    label: "Exchange",
    helper: "La plateforme détient les clés.",
  },
  {
    value: "watch-only",
    label: "Watch-only",
    helper: "Lecture uniquement.",
  },
];

const WALLET_PROVIDERS = [
  "metamask",
  "ledger",
  "walletconnect",
  "rabby",
  "phantom",
  "bitcoin",
  "binance",
  "coinbase",
  "kraken",
  "okx",
  "manual",
];

const EXCHANGE_PROVIDERS = ["binance", "coinbase", "kraken", "okx"];

const RISK_OPTIONS = [
  { value: "conservative", label: "Prudent" },
  { value: "balanced", label: "Equilibre" },
  { value: "aggressive", label: "Dynamique" },
];

const USAGE_GOAL_OPTIONS = [
  {
    value: "portfolio",
    label: "Suivre mon patrimoine",
    helper: "Priorite aux wallets, soldes et allocation.",
    nextWalletName: "Portefeuille principal",
  },
  {
    value: "self-custody",
    label: "Gerer mes wallets",
    helper: "Priorite aux wallets personnels et watch-only.",
    nextWalletName: "Ledger froid",
  },
  {
    value: "market",
    label: "Surveiller le marche",
    helper: "Priorite watchlist, alertes et signaux.",
    nextWalletName: "Watch-only marche",
  },
  {
    value: "dca",
    label: "Automatiser un DCA",
    helper: "Priorite wallet signeur, stablecoin et execution.",
    nextWalletName: "Wallet DCA",
  },
];

const DEFAULT_ACCOUNT_SETTINGS = {
  profileName: "",
  email: "",
  pushEnabled: false,
  defaultWalletAddress: "",
  defaultNetwork: "ethereum",
  custodyProvider: "",
  custodyAccountId: "",
  custodyEndpoint: "",
  alertsEndpoint: "",
  supabaseUrl: "",
  supabaseAlertsTable: "alerts",
  dcaStable: "USDC",
  dcaExecutionEndpoint: "",
  dcaScheduleEndpoint: "",
  riskProfile: "balanced",
};

function Field({ label, helper, children }) {
  return (
    <label className="account-field">
      <span>{label}</span>
      {children}
      {helper && <small>{helper}</small>}
    </label>
  );
}

export default function AccountsPage() {
  const {
    accountSettings,
    updateAccountSettings,
    setAccountSettings,
    holdings,
    watchlist,
  } = useAppPreferences();
  const {
    isConfigured: isAuthConfigured,
    user,
    session,
    profile,
    status: authStatus,
    profileStatus,
    error: authError,
    signInWithPassword,
    signUpWithPassword,
    signOut,
    updateProfile,
  } = useAuth();
  const userId = user?.id || null;
  const authToken = session?.access_token || null;
  const [custodyPositions, setCustodyPositions] = useState([]);
  const [custodyStatus, setCustodyStatus] = useState("idle");
  const [custodyError, setCustodyError] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [walletStatus, setWalletStatus] = useState("idle");
  const [walletError, setWalletError] = useState(null);
  const [walletDraft, setWalletDraft] = useState({
    name: "Ledger froid",
    walletType: "self-custody",
    provider: "ledger",
    address: "",
    network: "ethereum",
    chainFamily: "evm",
  });
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [exchangeConnections, setExchangeConnections] = useState([]);
  const [exchangeStatus, setExchangeStatus] = useState("idle");
  const [exchangeError, setExchangeError] = useState(null);
  const [exchangeDraft, setExchangeDraft] = useState({
    label: "Binance read-only",
    provider: "binance",
    apiKey: "",
    apiSecret: "",
    passphrase: "",
  });
  const [authMode, setAuthMode] = useState("signin");
  const [authForm, setAuthForm] = useState({
    email: "",
    password: "",
    displayName: "",
  });
  const [profileDraft, setProfileDraft] = useState({
    displayName: "",
    riskProfile: "balanced",
    defaultNetwork: "ethereum",
  });
  const [authMessage, setAuthMessage] = useState(null);
  const [isOnboardingDismissed, setIsOnboardingDismissed] = useState(() => {
    try {
      return window.localStorage.getItem("cryptoline-onboarding-dismissed") === "true";
    } catch {
      return false;
    }
  });
  const [usageGoal, setUsageGoal] = useState(() => {
    try {
      return window.localStorage.getItem("cryptoline-usage-goal") || "";
    } catch {
      return "";
    }
  });
  const [alertCount, setAlertCount] = useState(0);
  const [positionDraft, setPositionDraft] = useState({
    symbol: "BTC",
    amount: "",
    costBasis: "",
  });

  const configuredCount = useMemo(() => {
    return Object.entries(accountSettings).filter(([, value]) => {
      if (typeof value === "boolean") return value;
      return Boolean(String(value || "").trim());
    }).length;
  }, [accountSettings]);

  const holdingsCount = Object.values(holdings).filter((value) => Number(value) > 0).length;
  const walletSummary = useMemo(() => {
    const byType = wallets.reduce(
      (acc, wallet) => {
        const type = wallet.wallet_type || "watch-only";
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      },
      {
        "self-custody": 0,
        exchange: 0,
        "watch-only": 0,
      },
    );

    return {
      total: wallets.length,
      byType,
      recent: wallets.slice(0, 4),
    };
  }, [wallets]);
  const onboardingSteps = useMemo(
    () => [
      {
        key: "goal",
        label: "Objectif principal",
        detail: usageGoal
          ? USAGE_GOAL_OPTIONS.find((goal) => goal.value === usageGoal)?.label || "Objectif choisi"
          : "Choisir le parcours adapte",
        complete: Boolean(usageGoal),
        action: () => {
          document.getElementById("usage-goal")?.scrollIntoView({ behavior: "smooth" });
        },
        cta: usageGoal ? "Modifier" : "Choisir",
      },
      {
        key: "account",
        label: "Compte utilisateur",
        detail: userId ? "Session active" : "Creer ou ouvrir une session",
        complete: Boolean(userId),
        action: () => {
          setAuthMode("signup");
          window.scrollTo({ top: 0, behavior: "smooth" });
        },
        cta: userId ? "OK" : "Se connecter",
      },
      {
        key: "wallet",
        label: "Premier wallet",
        detail: walletSummary.total ? `${walletSummary.total} configure(s)` : "Ajouter un wallet",
        complete: walletSummary.total > 0,
        action: () => setIsWalletModalOpen(true),
        cta: walletSummary.total ? "Ajouter" : "Ajouter wallet",
      },
      {
        key: "balances",
        label: "Soldes importes",
        detail: holdingsCount || custodyPositions.length ? "Positions detectees" : "Importer ou saisir les soldes",
        complete: holdingsCount > 0 || custodyPositions.length > 0,
        action: () => {
          document.getElementById("custody-positions")?.scrollIntoView({ behavior: "smooth" });
        },
        cta: "Importer",
      },
      {
        key: "watchlist",
        label: "Watchlist",
        detail: watchlist.length ? `${watchlist.length} actif(s) suivi(s)` : "Suivre les actifs importants",
        complete: watchlist.length > 0,
        action: () => {
          window.location.assign("/");
        },
        cta: "Voir dashboard",
      },
      {
        key: "alerts",
        label: "Premiere alerte",
        detail: alertCount ? `${alertCount} alerte(s)` : "Creer une alerte de prix ou risque",
        complete: alertCount > 0,
        action: () => {
          window.location.assign("/");
        },
        cta: "Creer alerte",
      },
    ],
    [
      alertCount,
      custodyPositions.length,
      holdingsCount,
      usageGoal,
      userId,
      walletSummary.total,
      watchlist.length,
    ],
  );
  const onboardingCompletedCount = onboardingSteps.filter((step) => step.complete).length;
  const isOnboardingComplete = onboardingCompletedCount === onboardingSteps.length;
  const custodyEndpoint = accountSettings.custodyEndpoint || "/api/custody";
  const custodyPositionEndpoint = custodyEndpoint.endsWith("/custody")
    ? `${custodyEndpoint}/positions`
    : `${custodyEndpoint.replace(/\/$/, "")}/positions`;
  const walletsEndpoint = "/api/wallets";
  const exchangeConnectionsEndpoint = "/api/exchange-connections";
  const custodyAccount =
    accountSettings.defaultWalletAddress || accountSettings.custodyAccountId || "";
  const custodyProvider = accountSettings.custodyProvider || "Manual";
  const universeSymbols = Object.keys(MARKET_UNIVERSE);

  useEffect(() => {
    setProfileDraft({
      displayName: profile.display_name || "",
      riskProfile: profile.risk_profile || "balanced",
      defaultNetwork: profile.default_network || "ethereum",
    });
  }, [profile.default_network, profile.display_name, profile.risk_profile]);

  const updateField = (key) => (event) => {
    const value =
      event.target.type === "checkbox" ? event.target.checked : event.target.value;
    updateAccountSettings({ [key]: value });
  };

  const updateAuthField = (key) => (event) => {
    setAuthForm((current) => ({
      ...current,
      [key]: event.target.value,
    }));
  };

  const updateProfileDraft = (key) => (event) => {
    setProfileDraft((current) => ({
      ...current,
      [key]: event.target.value,
    }));
  };

  const updateWalletDraft = (key) => (event) => {
    setWalletDraft((current) => {
      const next = {
        ...current,
        [key]: event.target.value,
      };
      if (key === "walletType" && event.target.value === "exchange") {
        next.provider = EXCHANGE_PROVIDERS.includes(current.provider) ? current.provider : "binance";
        next.chainFamily = "other";
        next.network = "exchange";
      }
      if (key === "chainFamily") {
        next.network = event.target.value === "evm" ? "ethereum" : event.target.value;
      }
      return next;
    });
  };

  const updateExchangeDraft = (key) => (event) => {
    setExchangeDraft((current) => ({
      ...current,
      [key]: event.target.value,
    }));
  };

  const selectUsageGoal = (goal) => {
    setUsageGoal(goal.value);
    setWalletDraft((current) => ({
      ...current,
      name: current.name || goal.nextWalletName,
      walletType: goal.value === "market" ? "watch-only" : "self-custody",
      provider: goal.value === "market" ? "manual" : current.provider,
    }));
    try {
      window.localStorage.setItem("cryptoline-usage-goal", goal.value);
    } catch {
      // ignore storage errors
    }
  };

  const submitAuth = async (event) => {
    event.preventDefault();
    setAuthMessage(null);
    try {
      if (authMode === "signup") {
        await signUpWithPassword({
          email: authForm.email,
          password: authForm.password,
          displayName: authForm.displayName,
        });
        setAuthMessage("Compte cree. Verifie l'email si la confirmation est activee.");
      } else {
        await signInWithPassword({
          email: authForm.email,
          password: authForm.password,
        });
        setAuthMessage("Session ouverte.");
      }
      setAuthForm((current) => ({ ...current, password: "" }));
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Erreur d'authentification.");
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setAuthMessage(null);
    try {
      await updateProfile({
        display_name: profileDraft.displayName,
        risk_profile: profileDraft.riskProfile,
        default_network: profileDraft.defaultNetwork,
      });
      updateAccountSettings({
        profileName: profileDraft.displayName,
        email: user?.email || accountSettings.email,
        riskProfile: profileDraft.riskProfile,
        defaultNetwork: profileDraft.defaultNetwork,
      });
      setAuthMessage("Profil enregistre.");
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Erreur de sauvegarde profil.");
    }
  };

  const handleSignOut = async () => {
    setAuthMessage(null);
    try {
      await signOut();
      setAuthMessage("Session fermee.");
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Erreur de deconnexion.");
    }
  };

  const importCurrentWallet = () => {
    const injectedAddress = window.ethereum?.selectedAddress;
    if (!injectedAddress) return;
    updateAccountSettings({ defaultWalletAddress: injectedAddress });
  };

  const buildAuthHeaders = (extra = {}) => ({
    ...extra,
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  });

  const loadWallets = async () => {
    if (!userId) {
      setWallets([]);
      setWalletStatus("idle");
      return;
    }
    setWalletStatus((current) => (current === "ready" ? "refreshing" : "loading"));
    setWalletError(null);
    try {
      const params = new URLSearchParams({ user_id: userId });
      const response = await fetch(`${walletsEndpoint}?${params.toString()}`, {
        headers: buildAuthHeaders({ Accept: "application/json" }),
      });
      if (!response.ok) {
        throw new Error(`Wallets API ${response.status}`);
      }
      const payload = await response.json();
      setWallets(Array.isArray(payload?.wallets) ? payload.wallets : []);
      setWalletStatus("ready");
    } catch (err) {
      setWalletError(err instanceof Error ? err : new Error("Wallets API error"));
      setWalletStatus("error");
    }
  };

  const loadExchangeConnections = async () => {
    if (!userId) {
      setExchangeConnections([]);
      setExchangeStatus("idle");
      return;
    }
    setExchangeStatus((current) => (current === "ready" ? "refreshing" : "loading"));
    setExchangeError(null);
    try {
      const params = new URLSearchParams({ user_id: userId });
      const response = await fetch(`${exchangeConnectionsEndpoint}?${params.toString()}`, {
        headers: buildAuthHeaders({ Accept: "application/json" }),
      });
      if (!response.ok) {
        throw new Error(`Exchange API ${response.status}`);
      }
      const payload = await response.json();
      setExchangeConnections(Array.isArray(payload?.connections) ? payload.connections : []);
      setExchangeStatus("ready");
    } catch (err) {
      setExchangeError(err instanceof Error ? err : new Error("Exchange API error"));
      setExchangeStatus("error");
    }
  };

  const loadAlertSummary = async () => {
    if (!userId) {
      setAlertCount(0);
      return;
    }
    try {
      const params = new URLSearchParams({ user_id: userId });
      const response = await fetch(`/api/alerts?${params.toString()}`, {
        headers: buildAuthHeaders({ Accept: "application/json" }),
      });
      if (!response.ok) return;
      const payload = await response.json();
      setAlertCount(Array.isArray(payload) ? payload.length : 0);
    } catch {
      setAlertCount(0);
    }
  };

  const saveWallet = async (event) => {
    event.preventDefault();
    setWalletStatus("saving");
    setWalletError(null);
    try {
      const response = await fetch(walletsEndpoint, {
        method: "POST",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          user_id: userId,
          name: walletDraft.name,
          wallet_type: walletDraft.walletType,
          provider: walletDraft.provider,
          address: walletDraft.address,
          network: walletDraft.network,
          chain_family: walletDraft.chainFamily,
          metadata: {
            source: "accounts-page",
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`Wallets API ${response.status}`);
      }
      setWalletDraft((current) => ({
        ...current,
        name: "",
        address: "",
      }));
      await loadWallets();
      setIsWalletModalOpen(false);
    } catch (err) {
      setWalletError(err instanceof Error ? err : new Error("Wallet save error"));
      setWalletStatus("error");
    }
  };

  const deleteWallet = async (walletId) => {
    if (!walletId || !userId) return;
    setWalletStatus("deleting");
    setWalletError(null);
    try {
      const params = new URLSearchParams({ user_id: userId });
      const response = await fetch(`${walletsEndpoint}/${walletId}?${params.toString()}`, {
        method: "DELETE",
        headers: buildAuthHeaders(),
      });
      if (!response.ok && response.status !== 204) {
        throw new Error(`Wallets API ${response.status}`);
      }
      await loadWallets();
    } catch (err) {
      setWalletError(err instanceof Error ? err : new Error("Wallet delete error"));
      setWalletStatus("error");
    }
  };

  const saveExchangeConnection = async (event) => {
    event.preventDefault();
    setExchangeStatus("saving");
    setExchangeError(null);
    try {
      const response = await fetch(exchangeConnectionsEndpoint, {
        method: "POST",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          user_id: userId,
          provider: exchangeDraft.provider,
          label: exchangeDraft.label,
          permissions: ["read"],
          api_key: exchangeDraft.apiKey,
          api_secret: exchangeDraft.apiSecret,
          passphrase: exchangeDraft.passphrase,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Exchange API ${response.status}`);
      }
      setExchangeDraft((current) => ({
        ...current,
        apiKey: "",
        apiSecret: "",
        passphrase: "",
      }));
      await loadExchangeConnections();
    } catch (err) {
      setExchangeError(err instanceof Error ? err : new Error("Exchange save error"));
      setExchangeStatus("error");
    }
  };

  const loadCustodyPositions = async () => {
    if (!userId || !authToken) { setCustodyPositions([]); setCustodyStatus("idle"); setCustodyError(null); return; }
    setCustodyStatus((current) => (current === "ready" ? "refreshing" : "loading"));
    setCustodyError(null);
    try {
      const params = new URLSearchParams();
      if (custodyAccount) params.append("account", custodyAccount);
      if (userId) params.append("user_id", userId);
      const response = await fetch(`${custodyEndpoint}?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });
      if (!response.ok) {
        throw new Error(`Custodian API ${response.status}`);
      }
      const payload = await response.json();
      setCustodyPositions(Array.isArray(payload?.positions) ? payload.positions : []);
      setCustodyStatus("ready");
    } catch (err) {
      setCustodyError(err instanceof Error ? err : new Error("Custodian API error"));
      setCustodyStatus("error");
    }
  };

  useEffect(() => {
    loadCustodyPositions();
  }, [authToken, custodyAccount, custodyEndpoint, userId]);

  useEffect(() => {
    loadWallets();
    loadExchangeConnections();
    loadAlertSummary();
  }, [authToken, userId]);

  const updatePositionDraft = (key) => (event) => {
    setPositionDraft((current) => ({
      ...current,
      [key]: event.target.value,
    }));
  };

  const saveCustodyPosition = async (event) => {
    event.preventDefault();
    setCustodyStatus("saving");
    setCustodyError(null);
    try {
      const response = await fetch(custodyPositionEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          account: custodyAccount || null,
          user_id: userId,
          symbol: positionDraft.symbol,
          amount: Number(positionDraft.amount) || 0,
          cost_basis: Number(positionDraft.costBasis) || 0,
          provider: custodyProvider,
        }),
      });
      if (!response.ok) {
        throw new Error(`Custodian API ${response.status}`);
      }
      setPositionDraft((current) => ({
        ...current,
        amount: "",
        costBasis: "",
      }));
      await loadCustodyPositions();
    } catch (err) {
      setCustodyError(err instanceof Error ? err : new Error("Position save error"));
      setCustodyStatus("error");
    }
  };

  const walletTypeHelper = WALLET_TYPE_OPTIONS.find(
    (option) => option.value === walletDraft.walletType,
  )?.helper;

  const renderWalletForm = () => (
    <form className="account-form-grid three-columns" onSubmit={saveWallet}>
      <Field label="Nom">
        <input
          value={walletDraft.name}
          onChange={updateWalletDraft("name")}
          placeholder="Ledger froid"
          required
        />
      </Field>
      <Field label="Type">
        <select value={walletDraft.walletType} onChange={updateWalletDraft("walletType")}>
          {WALLET_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Provider">
        <select value={walletDraft.provider} onChange={updateWalletDraft("provider")}>
          {WALLET_PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Adresse publique"
        helper="Adresse ou identifiant public. Jamais de seed phrase ni cle privee."
      >
        <input
          value={walletDraft.address}
          onChange={updateWalletDraft("address")}
          placeholder="0x..., bc1..., sol..."
        />
      </Field>
      <Field label="Famille">
        <select value={walletDraft.chainFamily} onChange={updateWalletDraft("chainFamily")}>
          {CHAIN_FAMILY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reseau">
        <select value={walletDraft.network} onChange={updateWalletDraft("network")}>
          {NETWORK_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          <option value="exchange">Exchange</option>
          <option value="other">Autre</option>
        </select>
      </Field>
      <div className="account-submit-row">
        <button
          type="submit"
          className="primary-action"
          disabled={!userId || walletStatus === "saving"}
        >
          {walletStatus === "saving" ? "Ajout..." : "Ajouter portefeuille"}
        </button>
        <small>{walletTypeHelper}</small>
      </div>
    </form>
  );

  return (
    <div className="accounts-page">
      <section className="accounts-header">
        <div>
          <p className="eyebrow">Comptes</p>
          <h2>Settings utilisateur</h2>
          <p>
            Ces informations pilotent les alertes, la synchro custodian, les
            preferences wallet et les endpoints backend du dashboard.
          </p>
        </div>
        <div className="account-summary">
          <span className="badge badge-success">{configuredCount} champs configures</span>
          <span className="badge badge-muted">{holdingsCount} positions locales</span>
          <span className="badge badge-muted">{watchlist.length} actifs suivis</span>
        </div>
      </section>

      <section className="wallet-overview-band">
        <button
          type="button"
          className="wallet-overview-main"
          onClick={() => setIsWalletModalOpen(true)}
        >
          <span className="eyebrow">Portefeuilles</span>
          <strong>{walletSummary.total}</strong>
          <small>{walletSummary.total > 1 ? "wallets configures" : "wallet configure"}</small>
        </button>
        <div className="wallet-overview-stats">
          <div>
            <span>Self-custody</span>
            <strong>{walletSummary.byType["self-custody"]}</strong>
          </div>
          <div>
            <span>Exchange</span>
            <strong>{walletSummary.byType.exchange}</strong>
          </div>
          <div>
            <span>Watch-only</span>
            <strong>{walletSummary.byType["watch-only"]}</strong>
          </div>
        </div>
        <div className="wallet-overview-list">
          {walletSummary.recent.map((wallet) => (
            <button
              key={wallet.id}
              type="button"
              className="wallet-overview-item"
              onClick={() => setIsWalletModalOpen(true)}
            >
              <strong>{wallet.name}</strong>
              <span>{wallet.provider} - {wallet.network}</span>
            </button>
          ))}
          {walletSummary.recent.length === 0 && (
            <button
              type="button"
              className="wallet-overview-empty"
              onClick={() => setIsWalletModalOpen(true)}
            >
              Ajouter le premier wallet
            </button>
          )}
        </div>
      </section>

      {!isOnboardingDismissed && (
        <section id="usage-goal" className="card onboarding-panel">
          <div className="account-card-head">
            <div>
              <p className="eyebrow">Assistant de demarrage</p>
              <h3>{onboardingCompletedCount}/{onboardingSteps.length} etapes terminees</h3>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setIsOnboardingDismissed(true);
                try {
                  window.localStorage.setItem("cryptoline-onboarding-dismissed", "true");
                } catch {
                  // ignore storage errors
                }
              }}
            >
              Masquer
            </button>
          </div>
          <div className="usage-goal-grid">
            {USAGE_GOAL_OPTIONS.map((goal) => (
              <button
                key={goal.value}
                type="button"
                className={`usage-goal-card ${usageGoal === goal.value ? "active" : ""}`}
                onClick={() => selectUsageGoal(goal)}
              >
                <strong>{goal.label}</strong>
                <span>{goal.helper}</span>
              </button>
            ))}
          </div>
          <div className="onboarding-progress">
            <div style={{ width: `${(onboardingCompletedCount / onboardingSteps.length) * 100}%` }} />
          </div>
          <div className="onboarding-steps">
            {onboardingSteps.map((step) => (
              <button
                key={step.key}
                type="button"
                className={`onboarding-step ${step.complete ? "complete" : ""}`}
                onClick={step.action}
              >
                <span>{step.complete ? "OK" : "A faire"}</span>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
                <em>{step.cta}</em>
              </button>
            ))}
          </div>
          {isOnboardingComplete && (
            <p className="info-text">Onboarding termine. Le dashboard est pret pour un usage regulier.</p>
          )}
        </section>
      )}

      <section className="accounts-grid">
        <article className="card account-settings-card account-settings-card-wide">
          <div className="account-card-head">
            <div>
              <p className="eyebrow">Identite</p>
              <h3>Auth Supabase et profil</h3>
            </div>
            <span className={`badge ${user ? "badge-success" : "badge-muted"}`}>
              {user ? "Connecte" : authStatus === "loading" ? "Verification..." : "Invite"}
            </span>
          </div>

          {!isAuthConfigured ? (
            <p className="error-text">
              Auth Supabase non configuree. Ajoute REACT_APP_SUPABASE_URL et
              REACT_APP_SUPABASE_ANON_KEY dans .env.local.
            </p>
          ) : user ? (
            <form className="account-form-grid three-columns" onSubmit={saveProfile}>
              <Field label="Email">
                <input value={user.email || ""} disabled />
              </Field>
              <Field label="Nom du profil">
                <input
                  value={profileDraft.displayName}
                  onChange={updateProfileDraft("displayName")}
                  placeholder="Compte principal"
                />
              </Field>
              <Field label="Profil de risque">
                <select
                  value={profileDraft.riskProfile}
                  onChange={updateProfileDraft("riskProfile")}
                >
                  {RISK_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reseau par defaut">
                <select
                  value={profileDraft.defaultNetwork}
                  onChange={updateProfileDraft("defaultNetwork")}
                >
                  {NETWORK_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="account-submit-row">
                <button
                  type="submit"
                  className="primary-action"
                  disabled={profileStatus === "saving"}
                >
                  {profileStatus === "saving" ? "Sauvegarde..." : "Enregistrer profil"}
                </button>
                <button type="button" className="ghost" onClick={handleSignOut}>
                  Deconnexion
                </button>
              </div>
            </form>
          ) : (
            <form className="account-form-grid three-columns" onSubmit={submitAuth}>
              <Field label="Email">
                <input
                  type="email"
                  value={authForm.email}
                  onChange={updateAuthField("email")}
                  placeholder="trader@example.com"
                  required
                />
              </Field>
              {authMode === "signup" && (
                <Field label="Nom du profil">
                  <input
                    value={authForm.displayName}
                    onChange={updateAuthField("displayName")}
                    placeholder="Compte principal"
                  />
                </Field>
              )}
              <Field label="Mot de passe">
                <input
                  type="password"
                  minLength="6"
                  value={authForm.password}
                  onChange={updateAuthField("password")}
                  placeholder="Minimum 6 caracteres"
                  required
                />
              </Field>
              <div className="account-submit-row">
                <button
                  type="submit"
                  className="primary-action"
                  disabled={authStatus === "loading"}
                >
                  {authMode === "signup" ? "Creer le compte" : "Se connecter"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setAuthMode((mode) => (mode === "signin" ? "signup" : "signin"))}
                >
                  {authMode === "signin" ? "Creer un compte" : "J'ai deja un compte"}
                </button>
              </div>
            </form>
          )}

          {(authMessage || authError) && (
            <p className={authError ? "error-text" : "info-text"}>
              {authMessage || authError.message}
            </p>
          )}
        </article>

        <article className="card account-settings-card account-settings-card-wide">
          <div className="account-card-head">
            <div>
              <p className="eyebrow">Hub portefeuilles</p>
              <h3>Portefeuilles configurables</h3>
            </div>
            <div className="wallet-head-actions">
              <button
                type="button"
                className="primary-action"
                onClick={() => setIsWalletModalOpen(true)}
              >
                Ajouter wallet
              </button>
              <button
                type="button"
                className="ghost"
                onClick={loadWallets}
                disabled={walletStatus === "loading" || walletStatus === "refreshing"}
              >
                Synchroniser
              </button>
            </div>
          </div>

          {!userId && (
            <p className="error-text">
              Connecte-toi pour enregistrer des portefeuilles isoles par utilisateur.
            </p>
          )}

          <div className="wallet-type-strip">
            {WALLET_TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="wallet-type-chip"
                onClick={() => {
                  setWalletDraft((current) => ({ ...current, walletType: option.value }));
                  setIsWalletModalOpen(true);
                }}
              >
                <strong>{option.label}</strong>
                <span>{option.helper}</span>
              </button>
            ))}
          </div>

          {walletError && <p className="error-text">{walletError.message}</p>}

          <div className="wallet-config-grid">
            {wallets.map((wallet) => (
              <div key={wallet.id} className="wallet-config-card">
                <div>
                  <strong>{wallet.name}</strong>
                  <p>{wallet.address || wallet.provider}</p>
                </div>
                <div className="wallet-config-meta">
                  <span className="badge badge-muted">
                    {wallet.wallet_type === "self-custody"
                      ? "Cles utilisateur"
                      : wallet.wallet_type === "exchange"
                        ? "Cles plateforme"
                        : "Lecture seule"}
                  </span>
                  <span className="badge badge-muted">{wallet.chain_family}</span>
                  <span className="badge badge-muted">{wallet.network}</span>
                </div>
                <button type="button" className="ghost" onClick={() => deleteWallet(wallet.id)}>
                  Supprimer
                </button>
              </div>
            ))}
            {wallets.length === 0 && (
              <button
                type="button"
                className="empty-action"
                onClick={() => setIsWalletModalOpen(true)}
              >
                <strong>Ajouter mon premier wallet</strong>
                <span>MetaMask, Ledger, WalletConnect, Rabby, exchange ou watch-only.</span>
              </button>
            )}
          </div>
        </article>

        <article className="card account-settings-card account-settings-card-wide">
          <div className="account-card-head">
            <div>
              <p className="eyebrow">Exchanges</p>
              <h3>Connecteurs read-only</h3>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={loadExchangeConnections}
              disabled={exchangeStatus === "loading" || exchangeStatus === "refreshing"}
            >
              Synchroniser
            </button>
          </div>

          <form className="account-form-grid three-columns" onSubmit={saveExchangeConnection}>
            <Field label="Libelle">
              <input
                value={exchangeDraft.label}
                onChange={updateExchangeDraft("label")}
                placeholder="Binance principal"
                required
              />
            </Field>
            <Field label="Exchange">
              <select
                value={exchangeDraft.provider}
                onChange={updateExchangeDraft("provider")}
              >
                {EXCHANGE_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="API key"
              helper="Read-only uniquement. Pas de permission trade/withdraw."
            >
              <input
                value={exchangeDraft.apiKey}
                onChange={updateExchangeDraft("apiKey")}
                placeholder="Cle API"
              />
            </Field>
            <Field label="API secret">
              <input
                type="password"
                value={exchangeDraft.apiSecret}
                onChange={updateExchangeDraft("apiSecret")}
                placeholder="Secret API"
              />
            </Field>
            <Field label="Passphrase">
              <input
                type="password"
                value={exchangeDraft.passphrase}
                onChange={updateExchangeDraft("passphrase")}
                placeholder="OKX / Coinbase si necessaire"
              />
            </Field>
            <div className="account-submit-row">
              <button
                type="submit"
                className="primary-action"
                disabled={!userId || exchangeStatus === "saving"}
              >
                {exchangeStatus === "saving" ? "Chiffrement..." : "Enregistrer read-only"}
              </button>
              <small>Les secrets sont envoyes au serveur et chiffrés si la cle serveur existe.</small>
            </div>
          </form>

          {exchangeError && <p className="error-text">{exchangeError.message}</p>}

          <div className="wallet-config-grid">
            {exchangeConnections.map((connection) => (
              <div key={connection.id} className="wallet-config-card">
                <div>
                  <strong>{connection.label}</strong>
                  <p>{connection.provider}</p>
                </div>
                <div className="wallet-config-meta">
                  <span className="badge badge-success">read-only</span>
                  <span className="badge badge-muted">{connection.status}</span>
                  <span className="badge badge-muted">
                    {connection.secrets_configured?.apiKey ? "API key chiffree" : "Sans secret"}
                  </span>
                </div>
              </div>
            ))}
            {exchangeConnections.length === 0 && (
              <p className="empty">Aucun connecteur exchange read-only configure.</p>
            )}
          </div>
        </article>

        <article className="card account-settings-card">
          <div className="account-card-head">
            <div>
              <p className="eyebrow">Profil</p>
              <h3>Contact et preferences</h3>
            </div>
            <span className="badge badge-muted">
              {accountSettings.riskProfile || "balanced"}
            </span>
          </div>

          <div className="account-form-grid">
            <Field label="Nom du profil">
              <input
                value={accountSettings.profileName}
                onChange={updateField("profileName")}
                placeholder="Compte principal"
              />
            </Field>
            <Field
              label="Email alertes"
              helper="Utilise uniquement si le canal email est active cote backend."
            >
              <input
                type="email"
                value={accountSettings.email}
                onChange={updateField("email")}
                placeholder="trader@example.com"
              />
            </Field>
            <Field label="Profil de risque">
              <select
                value={accountSettings.riskProfile}
                onChange={updateField("riskProfile")}
              >
                {RISK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <label className="account-toggle">
              <input
                type="checkbox"
                checked={accountSettings.pushEnabled}
                onChange={updateField("pushEnabled")}
              />
              <span>
                <strong>Notifications push</strong>
                <small>Prepare le dashboard pour enregistrer un device/token push.</small>
              </span>
            </label>
          </div>
        </article>

        <article id="custody-positions" className="card account-settings-card account-settings-card-wide">
          <div className="account-card-head">
            <div>
              <p className="eyebrow">Positions custodian</p>
              <h3>Soldes persistants</h3>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={loadCustodyPositions}
              disabled={custodyStatus === "loading" || custodyStatus === "refreshing"}
            >
              Synchroniser
            </button>
          </div>

          <form className="account-form-grid three-columns" onSubmit={saveCustodyPosition}>
            <Field label="Actif">
              <select
                value={positionDraft.symbol}
                onChange={updatePositionDraft("symbol")}
              >
                {universeSymbols.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol} - {MARKET_UNIVERSE[symbol].name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantite">
              <input
                type="number"
                min="0"
                step="any"
                value={positionDraft.amount}
                onChange={updatePositionDraft("amount")}
                placeholder="0.45"
              />
            </Field>
            <Field label="Cost basis total">
              <input
                type="number"
                min="0"
                step="any"
                value={positionDraft.costBasis}
                onChange={updatePositionDraft("costBasis")}
                placeholder="28000"
              />
            </Field>
            <div className="account-submit-row">
              <button
                type="submit"
                className="primary-action"
                disabled={!userId || !authToken || custodyStatus === "saving"}
              >
                {custodyStatus === "saving" ? "Enregistrement..." : "Enregistrer position"}
              </button>
              <small>
                Lie a {custodyAccount || "aucun compte specifique"} via {custodyProvider}.
              </small>
            </div>
          </form>

          {custodyError && <p className="error-text">{custodyError.message}</p>}

          <div className="custody-positions-table">
            <div className="custody-position-row custody-position-head">
              <span>Actif</span>
              <span>Quantite</span>
              <span>Cost basis</span>
              <span>Provider</span>
            </div>
            {custodyPositions.map((position) => (
              <div
                key={position.id || `${position.symbol}-${position.account || "global"}`}
                className="custody-position-row"
              >
                <strong>{position.symbol}</strong>
                <span>
                  {(Number(position.amount) || 0).toLocaleString("fr-FR", {
                    maximumFractionDigits: 6,
                  })}
                </span>
                <span>
                  {(Number(position.cost_basis ?? position.costBasis) || 0).toLocaleString(
                    "fr-FR",
                    {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    },
                  )}
                </span>
                <span>{position.provider || "Custodian"}</span>
              </div>
            ))}
            {custodyPositions.length === 0 && (
              <button
                type="button"
                className="empty-action"
                onClick={() => document.getElementById("custody-positions")?.scrollIntoView({ behavior: "smooth" })}
              >
                <strong>Importer ou saisir mes premiers soldes</strong>
                <span>Les positions seront rattachees a ton utilisateur et au wallet selectionne ensuite.</span>
              </button>
            )}
          </div>
        </article>

        <article className="card account-settings-card">
          <div className="account-card-head">
            <div>
              <p className="eyebrow">Wallet</p>
              <h3>Adresse et reseau par defaut</h3>
            </div>
            <button type="button" className="ghost" onClick={importCurrentWallet}>
              Importer wallet navigateur
            </button>
          </div>

          <div className="account-form-grid">
            <Field
              label="Adresse wallet publique"
              helper="Adresse publique uniquement. Ne jamais saisir de seed phrase ou cle privee."
            >
              <input
                value={accountSettings.defaultWalletAddress}
                onChange={updateField("defaultWalletAddress")}
                placeholder="0x..."
              />
            </Field>
            <Field label="Reseau par defaut">
              <select
                value={accountSettings.defaultNetwork}
                onChange={updateField("defaultNetwork")}
              >
                {NETWORK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </article>

        <article className="card account-settings-card">
          <div className="account-card-head">
            <div>
              <p className="eyebrow">Custodian</p>
              <h3>Synchro portefeuille externe</h3>
            </div>
          </div>

          <div className="account-form-grid">
            <Field label="Provider">
              <input
                value={accountSettings.custodyProvider}
                onChange={updateField("custodyProvider")}
                placeholder="Binance, Coinbase, Kraken..."
              />
            </Field>
            <Field label="ID compte custodian">
              <input
                value={accountSettings.custodyAccountId}
                onChange={updateField("custodyAccountId")}
                placeholder="account_..."
              />
            </Field>
            <Field
              label="Endpoint custodian"
              helper="Le backend doit garder les cles API exchange cote serveur."
            >
              <input
                value={accountSettings.custodyEndpoint}
                onChange={updateField("custodyEndpoint")}
                placeholder="https://api.example.com/custody"
              />
            </Field>
          </div>
        </article>

        <article className="card account-settings-card">
          <div className="account-card-head">
            <div>
              <p className="eyebrow">Alertes</p>
              <h3>API et stockage</h3>
            </div>
          </div>

          <div className="account-form-grid">
            <Field label="Endpoint alertes">
              <input
                value={accountSettings.alertsEndpoint}
                onChange={updateField("alertsEndpoint")}
                placeholder="/api/alerts"
              />
            </Field>
            <Field label="Supabase URL">
              <input
                value={accountSettings.supabaseUrl}
                onChange={updateField("supabaseUrl")}
                placeholder="https://project.supabase.co"
              />
            </Field>
            <Field label="Table Supabase">
              <input
                value={accountSettings.supabaseAlertsTable}
                onChange={updateField("supabaseAlertsTable")}
                placeholder="alerts"
              />
            </Field>
          </div>
        </article>

        <article className="card account-settings-card account-settings-card-wide">
          <div className="account-card-head">
            <div>
              <p className="eyebrow">DCA</p>
              <h3>Execution et planification</h3>
            </div>
          </div>

          <div className="account-form-grid three-columns">
            <Field label="Stable de base">
              <input
                value={accountSettings.dcaStable}
                onChange={updateField("dcaStable")}
                placeholder="USDC"
              />
            </Field>
            <Field label="Endpoint execution">
              <input
                value={accountSettings.dcaExecutionEndpoint}
                onChange={updateField("dcaExecutionEndpoint")}
                placeholder="/api/execute-dca"
              />
            </Field>
            <Field label="Endpoint planning">
              <input
                value={accountSettings.dcaScheduleEndpoint}
                onChange={updateField("dcaScheduleEndpoint")}
                placeholder="/api/dca-plans"
              />
            </Field>
          </div>
        </article>
      </section>

      <section className="accounts-actions">
        <button
          type="button"
          className="ghost"
          onClick={() => setAccountSettings(DEFAULT_ACCOUNT_SETTINGS)}
        >
          Reinitialiser les settings
        </button>
      </section>

      <div className="floating-wallet-cta">
        <button
          type="button"
          className="primary-action"
          onClick={() => setIsWalletModalOpen(true)}
        >
          Ajouter wallet
        </button>
      </div>

      {isWalletModalOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsWalletModalOpen(false);
            }
          }}
        >
          <section
            className="card wallet-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-modal-title"
          >
            <div className="account-card-head">
              <div>
                <p className="eyebrow">Onboarding wallet</p>
                <h3 id="wallet-modal-title">Ajouter un portefeuille</h3>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => setIsWalletModalOpen(false)}
                aria-label="Fermer"
              >
                Fermer
              </button>
            </div>
            <div className="wallet-safety-grid">
              {WALLET_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`wallet-type-chip ${
                    walletDraft.walletType === option.value ? "active" : ""
                  }`}
                  onClick={() =>
                    setWalletDraft((current) => ({ ...current, walletType: option.value }))
                  }
                >
                  <strong>{option.label}</strong>
                  <span>{option.helper}</span>
                </button>
              ))}
            </div>
            {renderWalletForm()}
            {walletError && <p className="error-text">{walletError.message}</p>}
          </section>
        </div>
      )}
    </div>
  );
}

