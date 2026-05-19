const { getStore } = require("@netlify/blobs");

async function checkRateLimit({ key, max, windowSeconds }) {
  let store;
  try {
    store = getStore("rate-limit");
  } catch {
    // Blob storage unavailable — fail open so we don't break legitimate users
    return { allowed: true, remaining: max, retryAfter: 0 };
  }

  const now = Math.floor(Date.now() / 1000);

  let record;
  try {
    record = await store.get(key, { type: "json" });
  } catch {
    record = null;
  }

  if (!record || typeof record.windowStart !== "number" || record.windowStart + windowSeconds < now) {
    record = { count: 0, windowStart: now };
  }

  record.count += 1;

  try {
    await store.setJSON(key, record);
  } catch {
    return { allowed: true, remaining: Math.max(0, max - record.count), retryAfter: 0 };
  }

  if (record.count > max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, record.windowStart + windowSeconds - now),
    };
  }

  return { allowed: true, remaining: max - record.count, retryAfter: 0 };
}

function clientIp(event) {
  const h = event.headers || {};
  return (
    h["x-nf-client-connection-ip"] ||
    h["X-NF-Client-Connection-Ip"] ||
    (h["x-forwarded-for"] || "").split(",")[0].trim() ||
    "unknown"
  );
}

module.exports = { checkRateLimit, clientIp };
