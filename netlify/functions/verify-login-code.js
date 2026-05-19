const { signToken } = require("./_auth");
const { checkRateLimit } = require("./_rate-limit");

const AIRTABLE_BASE = "appaOBVteWvtxFcKr";
const TBL_PM = "tbl9I3xX3zj9b7FqX";
const F_EMAIL = "emai2";
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const airtableKey = process.env.AIRTABLE_KEY;
  const authSecret = process.env.AUTH_SECRET;
  if (!airtableKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "AIRTABLE_KEY not configured" }) };
  if (!authSecret) return { statusCode: 500, headers, body: JSON.stringify({ error: "AUTH_SECRET not configured" }) };

  try {
    const { email, code } = JSON.parse(event.body || "{}");
    if (!email || !code) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and code required" }) };
    }
    const normalizedEmail = String(email).toLowerCase().trim();
    const enteredCode = String(code).trim();

    // Anti-brute-force: limit verify attempts per email
    const rl = await checkRateLimit({
      key: `verify-login-code:email:${normalizedEmail}`,
      max: 10,
      windowSeconds: 600,
    });
    if (!rl.allowed) {
      return {
        statusCode: 429,
        headers: { ...headers, "Retry-After": String(rl.retryAfter) },
        body: JSON.stringify({ error: "Too many attempts. Please wait a few minutes and try again." }),
      };
    }

    // 1. Look up PM Profile
    const filterFormula = `LOWER(TRIM({${F_EMAIL}}))="${normalizedEmail}"`;
    const lookupUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${TBL_PM}?filterByFormula=${encodeURIComponent(filterFormula)}&maxRecords=1`;
    const lookupRes = await fetch(lookupUrl, { headers: { Authorization: `Bearer ${airtableKey}` } });
    const lookupData = await lookupRes.json();
    if (!lookupRes.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Airtable lookup failed" }) };
    }
    const record = lookupData.records?.[0];
    if (!record) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Email not found" }) };
    }

    const storedCode = record.fields["Login Code"];
    const expiresAt = record.fields["Login Code Expires"];
    if (!storedCode || !expiresAt) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "No active code — please request a new one." }) };
    }
    if (new Date(expiresAt).getTime() < Date.now()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "That code has expired — please request a new one." }) };
    }
    if (String(storedCode).trim() !== enteredCode) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Incorrect code. Double-check the email and try again." }) };
    }

    // 2. Clear the code (one-time use)
    const patchUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${TBL_PM}/${record.id}`;
    await fetch(patchUrl, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${airtableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { "Login Code": "", "Login Code Expires": null } }),
    });

    // 3. Issue a signed session token
    const token = signToken({
      recordId: record.id,
      email: normalizedEmail,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    }, authSecret);

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
