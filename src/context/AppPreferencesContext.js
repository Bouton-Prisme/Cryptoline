import { createContext, useContext, useEffect, useState } from "react";

function useStoredState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // ignore write errors (Storage disabled/private mode)
    }
  }, [key, state]);

  return [state, setState];
}

const AppPreferencesContext = createContext(null);

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

export function AppPreferencesProvider({ children }) {
  const [selected, setSelected] = useStoredState("cryptoline-selected", "BTC");
  const [holdings, setHoldings] = useStoredState("cryptoline-holdings", {
    BTC: 0.45,
    ETH: 3.5,
    XMR: 18,
    SOL: 20,
  });
  const [watchlist, setWatchlist] = useStoredState("cryptoline-watchlist", ["BTC", "ETH"]);
  const [accountSettings, setAccountSettings] = useStoredState(
    "cryptoline-account-settings",
    DEFAULT_ACCOUNT_SETTINGS,
  );

  const updateAccountSettings = (patch) => {
    setAccountSettings((current) => ({
      ...DEFAULT_ACCOUNT_SETTINGS,
      ...current,
      ...patch,
    }));
  };

  const value = {
    selected,
    setSelected,
    holdings,
    setHoldings,
    watchlist,
    setWatchlist,
    accountSettings: {
      ...DEFAULT_ACCOUNT_SETTINGS,
      ...accountSettings,
    },
    setAccountSettings,
    updateAccountSettings,
  };

  return <AppPreferencesContext.Provider value={value}>{children}</AppPreferencesContext.Provider>;
}

export function useAppPreferences() {
  const context = useContext(AppPreferencesContext);
  if (!context) {
    throw new Error("useAppPreferences must be used within AppPreferencesProvider");
  }
  return context;
}
