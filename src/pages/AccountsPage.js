import { useEffect, useMemo, useState } from "react";
import { useAppPreferences } from "../context/AppPreferencesContext";
import { MARKET_UNIVERSE } from "../hooks/useMarketData";

const NETWORK_OPTIONS = [
  { value: "ethereum", label: "Ethereum" },
  { value: "polygon", label: "Polygon" },
  { value: "arbitrum", label: "Arbitrum" },
  { value: "base", label: "Base" },
];

const RISK_OPTIONS = [
  { value: "conservative", label: "Prudent" },
  { value: "balanced", label: "Equilibre" },
  { value: "aggressive", label: "Dynamique" },
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
  const [custodyPositions, setCustodyPositions] = useState([]);
  const [custodyStatus, setCustodyStatus] = useState("idle");
  const [custodyError, setCustodyError] = useState(null);
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
  const custodyEndpoint = accountSettings.custodyEndpoint || "/api/custody";
  const custodyPositionEndpoint = custodyEndpoint.endsWith("/custody")
    ? `${custodyEndpoint}/positions`
    : `${custodyEndpoint.replace(/\/$/, "")}/positions`;
  const custodyAccount =
    accountSettings.defaultWalletAddress || accountSettings.custodyAccountId || "";
  const custodyProvider = accountSettings.custodyProvider || "Manual";
  const universeSymbols = Object.keys(MARKET_UNIVERSE);

  const updateField = (key) => (event) => {
    const value =
      event.target.type === "checkbox" ? event.target.checked : event.target.value;
    updateAccountSettings({ [key]: value });
  };

  const importCurrentWallet = () => {
    const injectedAddress = window.ethereum?.selectedAddress;
    if (!injectedAddress) return;
    updateAccountSettings({ defaultWalletAddress: injectedAddress });
  };

  const loadCustodyPositions = async () => {
    setCustodyStatus((current) => (current === "ready" ? "refreshing" : "loading"));
    setCustodyError(null);
    try {
      const params = new URLSearchParams();
      if (custodyAccount) params.append("account", custodyAccount);
      const response = await fetch(`${custodyEndpoint}?${params.toString()}`, {
        headers: { Accept: "application/json" },
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
  }, [custodyAccount, custodyEndpoint]);

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: custodyAccount || null,
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

      <section className="accounts-grid">
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

        <article className="card account-settings-card account-settings-card-wide">
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
                disabled={custodyStatus === "saving"}
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
              <p className="empty">Aucune position custodian enregistree.</p>
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
    </div>
  );
}
