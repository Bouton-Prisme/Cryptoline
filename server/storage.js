const fs = require("fs/promises");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const DATA_DIR = path.join(__dirname, "data");

const STORES = {
  wallets: {
    file: path.join(DATA_DIR, "wallets.json"),
    table: process.env.SUPABASE_WALLETS_TABLE || "wallets",
  },
  exchangeConnections: {
    file: path.join(DATA_DIR, "exchange-connections.json"),
    table: process.env.SUPABASE_EXCHANGE_CONNECTIONS_TABLE || "exchange_connections",
  },
  alerts: {
    file: path.join(DATA_DIR, "alerts.json"),
    table: process.env.SUPABASE_ALERTS_TABLE || "alerts",
  },
  custody: {
    file: path.join(DATA_DIR, "custody.json"),
    table: process.env.SUPABASE_CUSTODY_TABLE || "custody_positions",
  },
  dcaPlans: {
    file: path.join(DATA_DIR, "dca-plans.json"),
    table: process.env.SUPABASE_DCA_PLANS_TABLE || "dca_plans",
  },
  executions: {
    file: path.join(DATA_DIR, "executions.json"),
    table: process.env.SUPABASE_DCA_EXECUTIONS_TABLE || "dca_executions",
  },
  alertEvents: {
    file: path.join(DATA_DIR, "alert-events.json"),
    table: process.env.SUPABASE_ALERT_EVENTS_TABLE || "alert_events",
  },
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_DISABLED = process.env.SUPABASE_ENABLED === "false";

const supabase =
  !SUPABASE_DISABLED && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

function isSupabaseEnabled() {
  return Boolean(supabase);
}

async function ensureStore(file, fallback) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, JSON.stringify(fallback, null, 2));
  }
}

async function readJsonStore(name) {
  const file = STORES[name].file;
  await ensureStore(file, []);
  const raw = await fs.readFile(file, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeJsonStore(name, records) {
  const file = STORES[name].file;
  await ensureStore(file, []);
  await fs.writeFile(file, JSON.stringify(records, null, 2));
  return records;
}

async function listRecords(name, filters = {}) {
  if (!supabase) {
    const records = await readJsonStore(name);
    return records.filter(record => Object.entries(filters).every(([key, value]) => value === undefined || value === null || value === "" || String(record[key]) === String(value)));
  }

  let query = supabase.from(STORES[name].table).select("*");
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query = query.eq(key, value);
    }
  });
  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function insertRecord(name, record) {
  if (!supabase) {
    const records = await readJsonStore(name);
    await writeJsonStore(name, [record, ...records]);
    return record;
  }

  const { data, error } = await supabase
    .from(STORES[name].table)
    .insert(record)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function upsertRecord(name, record, conflictKey) {
  if (!supabase) {
    const records = await readJsonStore(name);
    const nextRecords = [
      record,
      ...records.filter((item) => {
        if (Array.isArray(conflictKey)) {
          return !conflictKey.every((key) => String(item[key] || "") === String(record[key] || ""));
        }
        return String(item[conflictKey] || "") !== String(record[conflictKey] || "");
      }),
    ];
    await writeJsonStore(name, nextRecords);
    return record;
  }

  if (Array.isArray(conflictKey) && conflictKey.length) {
    let query = supabase.from(STORES[name].table).select("id");
    conflictKey.forEach((key) => {
      query =
        record[key] === null || record[key] === undefined
          ? query.is(key, null)
          : query.eq(key, record[key]);
    });
    const { data: existing, error: selectError } = await query.maybeSingle();
    if (selectError) throw selectError;
    if (existing?.id) {
      return updateRecord(name, existing.id, { ...record, id: existing.id }, record.user_id);
    }
  }

  const options = conflictKey && !Array.isArray(conflictKey) ? { onConflict: conflictKey } : {};
  const { data, error } = await supabase
    .from(STORES[name].table)
    .upsert(record, options)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteRecord(name, id, userId) {
  if (!supabase) {
    const records = await readJsonStore(name);
    await writeJsonStore(
      name,
      records.filter((record) => record.id !== id || (userId && record.user_id !== userId)),
    );
    return;
  }

  let query = supabase.from(STORES[name].table).delete().eq("id", id);
  if (userId) query = query.eq("user_id", userId);
  const { error } = await query;
  if (error) throw error;
}

async function updateRecord(name, id, patch, userId) {
  if (!supabase) {
    const records = await readJsonStore(name);
    let updated = null;
    const nextRecords = records.map((record) => {
      if (record.id !== id || (userId && record.user_id !== userId)) return record;
      updated = {
        ...record,
        ...patch,
      };
      return updated;
    });
    await writeJsonStore(name, nextRecords);
    return updated;
  }

  let query = supabase.from(STORES[name].table).update(patch).eq("id", id);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

async function getUserIdFromAccessToken(accessToken) {
  if (!supabase) throw Object.assign(new Error("Supabase authentication is not configured"), { status: 503 });
  if (!accessToken) return null;
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error) {
    const unavailable = !error.status || error.status >= 500 || error.name === "AuthRetryableFetchError";
    throw Object.assign(new Error(unavailable ? "Supabase authentication is unavailable" : "Invalid or expired session"), { status: unavailable ? 503 : 401 });
  }
  return data?.user?.id || null;
}

async function checkStorageHealth() {
  if (!supabase) return { ready: false, error: "Supabase is not configured" };
  try {
    for (const table of ["profiles", ...Object.values(STORES).map(store => store.table)]) {
      const { error } = await supabase.from(table).select("id").limit(0).abortSignal(AbortSignal.timeout(5000));
      if (error) return { ready: false, error: "Supabase unavailable or schema incomplete" };
    }
    return { ready: true };
  } catch {
    return { ready: false, error: "Supabase unavailable" };
  }
}

module.exports = {
  isSupabaseEnabled,
  checkStorageHealth,
  listRecords,
  insertRecord,
  upsertRecord,
  deleteRecord,
  updateRecord,
  getUserIdFromAccessToken,
};
