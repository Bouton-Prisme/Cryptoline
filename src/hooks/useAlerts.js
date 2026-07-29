import { useCallback, useEffect, useMemo, useState } from "react";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const SUPABASE_TABLE = process.env.REACT_APP_SUPABASE_ALERTS_TABLE || "alerts";
const FALLBACK_ENDPOINT = process.env.REACT_APP_ALERTS_ENDPOINT || "/api/alerts";

function parseConditions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeRecord(record) {
  if (!record) return record;
  return {
    ...record,
    conditions: parseConditions(record.conditions),
  };
}

export default function useAlerts({ symbol, endpoint: endpointOverride } = {}) {
  const [alerts, setAlerts] = useState([]);
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const isSupabaseReady = Boolean(SUPABASE_URL && SUPABASE_KEY);

  const endpoint = useMemo(() => {
    if (endpointOverride) return endpointOverride;
    return isSupabaseReady ? `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}` : FALLBACK_ENDPOINT;
  }, [endpointOverride, isSupabaseReady]);

  const eventsEndpoint = useMemo(() => {
    if (endpointOverride?.includes("/api/alerts")) {
      return endpointOverride.replace("/api/alerts", "/api/alert-events");
    }
    return "/api/alert-events";
  }, [endpointOverride]);

  const headers = useMemo(() => {
    const base = {
      "Content-Type": "application/json",
    };
    if (isSupabaseReady) {
      base.apikey = SUPABASE_KEY;
      base.Authorization = `Bearer ${SUPABASE_KEY}`;
      base.Prefer = "return=representation";
    }
    return base;
  }, [isSupabaseReady]);

  const buildListUrl = useCallback(() => {
    if (isSupabaseReady) {
      const params = new URLSearchParams({ select: "*" });
      if (symbol) {
        params.append("symbol", `eq.${symbol}`);
      }
      return `${endpoint}?${params.toString()}`;
    }
    if (symbol) {
      const params = new URLSearchParams({ symbol });
      return `${endpoint}?${params.toString()}`;
    }
    return endpoint;
  }, [endpoint, isSupabaseReady, symbol]);

  const refresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  const fetchAlerts = useCallback(async () => {
    setStatus((prev) => (prev === "ready" ? "refreshing" : "loading"));
    setError(null);
    try {
      const response = await fetch(buildListUrl(), {
        headers,
      });
      if (!response.ok && response.status !== 204) {
        throw new Error(`Alerts API ${response.status}`);
      }
      const payload = response.status === 204 ? [] : await response.json();
      const normalized = Array.isArray(payload)
        ? payload.map(normalizeRecord)
        : Array.isArray(payload?.data)
          ? payload.data.map(normalizeRecord)
          : [];
      setAlerts(normalized);
      setStatus("ready");
    } catch (err) {
      console.error("[useAlerts] fetch error", err);
      setError(err instanceof Error ? err : new Error("Alerts API error"));
      setStatus("error");
    }
  }, [buildListUrl, headers]);

  const fetchEvents = useCallback(async () => {
    try {
      const eventUrl = symbol
        ? `${eventsEndpoint}?${new URLSearchParams({ symbol }).toString()}`
        : eventsEndpoint;
      const response = await fetch(eventUrl, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok && response.status !== 204) {
        throw new Error(`Alert events API ${response.status}`);
      }
      const payload = response.status === 204 ? [] : await response.json();
      setEvents(Array.isArray(payload) ? payload : []);
    } catch (err) {
      console.error("[useAlerts] events fetch error", err);
    }
  }, [eventsEndpoint, symbol]);

  useEffect(() => {
    fetchAlerts();
    fetchEvents();
  }, [fetchAlerts, fetchEvents, refreshTick]);

  const createAlert = useCallback(
    async (payload) => {
      const body = {
        ...payload,
        created_at: new Date().toISOString(),
      };
      try {
        const response = await fetch(endpoint + (isSupabaseReady ? "" : ""), {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!response.ok && response.status !== 204) {
          throw new Error(`Alerts API ${response.status}`);
        }
        const result = response.status === 204 ? null : await response.json();
        let created = null;
        if (Array.isArray(result)) {
          created = normalizeRecord(result[0]);
        } else if (Array.isArray(result?.data)) {
          created = normalizeRecord(result.data[0]);
        } else if (result) {
          created = normalizeRecord(result);
        }
        if (created) {
          setAlerts((prev) => [created, ...prev]);
        } else {
          refresh();
        }
        return created;
      } catch (err) {
        console.error("[useAlerts] create error", err);
        throw err instanceof Error ? err : new Error("Impossible de creer l'alerte");
      }
    },
    [endpoint, headers, isSupabaseReady, refresh]
  );

  const deleteAlert = useCallback(
    async (id) => {
      if (!id) return;
      try {
        const deleteUrl = isSupabaseReady ? `${endpoint}?id=eq.${id}` : `${endpoint}/${id}`;
        const response = await fetch(deleteUrl, {
          method: "DELETE",
          headers,
        });
        if (!response.ok && response.status !== 204) {
          throw new Error(`Alerts API ${response.status}`);
        }
        setAlerts((prev) => prev.filter((item) => item.id !== id));
      } catch (err) {
        console.error("[useAlerts] delete error", err);
        throw err instanceof Error ? err : new Error("Suppression impossible");
      }
    },
    [endpoint, headers, isSupabaseReady]
  );

  const runCheck = useCallback(async () => {
    const response = await fetch("/api/alerts/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Alert worker ${response.status}`);
    }
    const result = await response.json();
    refresh();
    return result;
  }, [refresh]);

  return {
    alerts,
    events,
    status,
    error,
    refresh,
    createAlert,
    deleteAlert,
    runCheck,
  };
}
