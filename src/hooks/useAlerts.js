import { useCallback, useEffect, useMemo, useState } from "react";

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

function createClientId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function useAlerts({ symbol, endpoint: endpointOverride, userId, authToken } = {}) {
  const [alerts, setAlerts] = useState([]);
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const endpoint = endpointOverride || FALLBACK_ENDPOINT;

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
    if (authToken) base.Authorization = `Bearer ${authToken}`;
    return base;
  }, [authToken]);

  const buildListUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (symbol) {
      params.append("symbol", symbol);
    }
    if (userId) {
      params.append("user_id", userId);
    }
    const query = params.toString();
    return query ? `${endpoint}?${query}` : endpoint;
  }, [endpoint, symbol, userId]);

  const refresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  const fetchAlerts = useCallback(async (signal) => {
    if (!authToken || !userId) { setAlerts([]); setStatus("idle"); setError(null); return; }
    setStatus((prev) => (prev === "ready" ? "refreshing" : "loading"));
    setError(null);
    try {
      const response = await fetch(buildListUrl(), {
        headers, signal,
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
      if (signal?.aborted) return;
      setAlerts(normalized);
      setStatus("ready");
    } catch (err) {
      if (signal?.aborted) return;
      console.error("[useAlerts] fetch error", err);
      setError(err instanceof Error ? err : new Error("Alerts API error"));
      setStatus("error");
    }
  }, [buildListUrl, headers, authToken, userId]);

  const fetchEvents = useCallback(async (signal) => {
    if (!authToken || !userId) { setEvents([]); return; }
    try {
      const eventUrl = symbol
        ? `${eventsEndpoint}?${new URLSearchParams({
            symbol,
            ...(userId ? { user_id: userId } : {}),
          }).toString()}`
        : userId
          ? `${eventsEndpoint}?${new URLSearchParams({ user_id: userId }).toString()}`
        : eventsEndpoint;
      const response = await fetch(eventUrl, {
        signal,
        headers: {
          Accept: "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });
      if (!response.ok && response.status !== 204) {
        throw new Error(`Alert events API ${response.status}`);
      }
      const payload = response.status === 204 ? [] : await response.json();
      if (!signal?.aborted) setEvents(Array.isArray(payload) ? payload : []);
    } catch (err) {
      if (!signal?.aborted) console.error("[useAlerts] events fetch error", err);
    }
  }, [eventsEndpoint, symbol, userId, authToken]);

  useEffect(() => {
    const controller = new AbortController();
    setAlerts([]); setEvents([]);
    fetchAlerts(controller.signal);
    fetchEvents(controller.signal);
    return () => controller.abort();
  }, [fetchAlerts, fetchEvents, refreshTick]);

  const createAlert = useCallback(
    async (payload) => {
      const body = {
        id: payload.id || createClientId("alert"),
        ...payload,
        user_id: payload.user_id || userId || null,
        created_at: new Date().toISOString(),
      };
      try {
        const response = await fetch(endpoint, {
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
    [endpoint, headers, refresh, userId]
  );

  const deleteAlert = useCallback(
    async (id) => {
      if (!id) return;
      try {
        const deleteUrl = `${endpoint}/${encodeURIComponent(id)}`;
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
    [endpoint, headers]
  );

  const runCheck = useCallback(async () => {
    const response = await fetch("/api/alerts/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    });
    if (!response.ok) {
      throw new Error(`Alert worker ${response.status}`);
    }
    const result = await response.json();
    refresh();
    return result;
  }, [refresh, authToken]);

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
