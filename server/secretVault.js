const crypto = require("crypto");

const KEY_SOURCE = process.env.SECRET_ENCRYPTION_KEY || "";

function getKey() {
  if (!KEY_SOURCE) return null;
  return crypto.createHash("sha256").update(KEY_SOURCE).digest();
}

function encryptSecret(value) {
  if (!value) return null;
  const key = getKey();
  if (!key) {
    const err = new Error("SECRET_ENCRYPTION_KEY is required to store exchange secrets");
    err.status = 503;
    throw err;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function redactConnection(connection) {
  if (!connection) return connection;
  const hasApiKey = Boolean(connection.encrypted_api_key);
  const hasApiSecret = Boolean(connection.encrypted_api_secret);
  const hasPassphrase = Boolean(connection.encrypted_passphrase);
  const {
    encrypted_api_key,
    encrypted_api_secret,
    encrypted_passphrase,
    ...safeConnection
  } = connection;

  return {
    ...safeConnection,
    secrets_configured: {
      apiKey: hasApiKey,
      apiSecret: hasApiSecret,
      passphrase: hasPassphrase,
    },
  };
}

module.exports = {
  encryptSecret,
  redactConnection,
};
