const { checkRateLimit, clientIp } = require("./_rate-limit");

const AIRTABLE_BASE = "appaOBVteWvtxFcKr";
const TBL_PM = "tbl9I3xX3zj9b7FqX";
const F_EMAIL = "emai2";
const FROM_EMAIL = "leah@prowessproject.com";
const FROM_NAME = "Prowess Project";

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
  const resendKey = process.env.RESEND_API_KEY;
  if (!airtableKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "AIRTABLE_KEY not configured" }) };
  if (!resendKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "RESEND_API_KEY not configured" }) };

  try {
    // Per-IP limit: stop scripted enumeration
    const ip = clientIp(event);
    const ipRL = await checkRateLimit({
      key: `send-login-code:ip:${ip}`,
      max: 10,
      windowSeconds: 60,
    });
    if (!ipRL.allowed) {
      return {
        statusCode: 429,
        headers: { ...headers, "Retry-After": String(ipRL.retryAfter) },
        body: JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }),
      };
    }

    const { email } = JSON.parse(event.body || "{}");
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Valid email required" }) };
    }
    const normalizedEmail = email.toLowerCase().trim();

    // Per-email limit: stop spam-bombing a specific inbox
    const emailRL = await checkRateLimit({
      key: `send-login-code:email:${normalizedEmail}`,
      max: 5,
      windowSeconds: 600,
    });
    if (!emailRL.allowed) {
      return {
        statusCode: 429,
        headers: { ...headers, "Retry-After": String(emailRL.retryAfter) },
        body: JSON.stringify({ error: "Too many sign-in codes requested. Please wait a few minutes." }),
      };
    }

    // 1. Look up PM Profile by email
    const filterFormula = `LOWER(TRIM({${F_EMAIL}}))="${normalizedEmail}"`;
    const lookupUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${TBL_PM}?filterByFormula=${encodeURIComponent(filterFormula)}&maxRecords=1`;
    const lookupRes = await fetch(lookupUrl, { headers: { Authorization: `Bearer ${airtableKey}` } });
    const lookupData = await lookupRes.json();
    if (!lookupRes.ok) {
      console.log("[send-login-code] Airtable lookup failed:", lookupRes.status, lookupData);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Airtable lookup failed", detail: lookupData }) };
    }
    const record = lookupData.records?.[0];
    if (!record) {
      console.log("[send-login-code] no PM Profile found for email");
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Email not found" }) };
    }
    console.log("[send-login-code] found PM Profile:", record.id);

    // 2. Generate 6-digit code + 10-minute expiry
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // 3. Write code to Airtable
    const patchUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${TBL_PM}/${record.id}`;
    const patchRes = await fetch(patchUrl, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${airtableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { "Login Code": code, "Login Code Expires": expiresAt } }),
    });
    if (!patchRes.ok) {
      const errData = await patchRes.json().catch(() => ({}));
      console.log("[send-login-code] Airtable patch failed:", patchRes.status, errData);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Failed to store code", detail: errData }) };
    }
    console.log("[send-login-code] code stored in Airtable; calling Resend...");

    // 4. Send email via Resend
    const fields = record.fields || {};
    const firstName = (fields["First Name"] || (fields["Name"] || "").split(" ")[0] || "").trim();
    const greeting = firstName ? `Hi ${firstName},` : "Hi,";

    const plainText =
`${greeting}

Your Prowess OBM Portal sign-in code is:

${code}

This code expires in 10 minutes.

If you didn't request this code, you can safely ignore this email.

— Prowess Project`;

    const html = `
<div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1A1A1A;">
  <p style="margin: 0 0 16px; font-size: 15px;">${greeting}</p>
  <p style="margin: 0 0 16px; font-size: 15px;">Your Prowess OBM Portal sign-in code is:</p>
  <div style="background: #E8F4F3; border: 1px solid rgba(127,191,184,.4); border-radius: 8px; padding: 22px; text-align: center; margin: 24px 0;">
    <div style="font-size: 32px; font-weight: 700; letter-spacing: 0.4em; color: #1F5C58; font-family: 'SFMono-Regular', Consolas, monospace;">
      ${code}
    </div>
  </div>
  <p style="margin: 0 0 8px; color: #6B6B6B; font-size: 14px;">This code expires in 10 minutes.</p>
  <p style="margin: 0 0 24px; color: #6B6B6B; font-size: 14px;">If you didn't request this code, you can safely ignore this email.</p>
  <p style="margin: 0; font-size: 13px; color: #A0A0A0;">— Prowess Project</p>
</div>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [normalizedEmail],
        subject: "Your Prowess Portal sign-in code",
        html,
        text: plainText,
      }),
    });
    const resendText = await resendRes.text();
    console.log("[send-login-code] Resend response:", resendRes.status, "body:", resendText.slice(0, 500));
    if (!resendRes.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Resend send failed", detail: resendText }) };
    }

    console.log("[send-login-code] success — code emailed to", normalizedEmail);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.log("[send-login-code] uncaught error:", err.message, err.stack);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
