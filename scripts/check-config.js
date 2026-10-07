const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local"), quiet: true });
require("dotenv").config({ quiet: true });

async function main() {
  let failed = false;
  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "REACT_APP_SUPABASE_URL", "REACT_APP_SUPABASE_ANON_KEY", "ZEROX_API_KEY", "SECRET_ENCRYPTION_KEY"]) {
    const present = Boolean(process.env[key]) && !/your_|replace_with/.test(process.env[key]);
    console.log(`${present ? "OK" : "MANQUANT"} ${key}`);
    if (!present) failed = true;
  }
  if (process.env.REACT_APP_SUPABASE_URL && process.env.REACT_APP_SUPABASE_URL.replace(/\/$/, "") !== process.env.SUPABASE_URL?.replace(/\/$/, "")) {
    console.log("ERREUR : le frontend et le backend doivent utiliser le meme projet Supabase.");
    failed = true;
  }
  const publicKey = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
  let role;
  try { role = JSON.parse(Buffer.from(publicKey.split(".")[1] || "", "base64url").toString()).role; } catch {}
  if (publicKey.startsWith("sb_secret_") || role === "service_role" || (publicKey && publicKey === process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    console.log("ERREUR : une cle serveur ne doit jamais etre utilisee dans le frontend.");
    failed = true;
  }
  const { checkStorageHealth } = require("../server/storage");
  const storage = await checkStorageHealth();
  console.log(storage.ready ? "OK Supabase : tables accessibles" : `ERREUR Supabase : ${storage.error}`);
  if (!storage.ready) failed = true;
  process.exitCode = failed ? 1 : 0;
}
main().catch(() => { console.error("Verification de configuration impossible."); process.exitCode = 1; });
