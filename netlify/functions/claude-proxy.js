const { verifyToken, getBearerToken } = require("./_auth");
const { checkRateLimit } = require("./_rate-limit");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authSecret = process.env.AUTH_SECRET;
  if (!apiKey || !authSecret) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server misconfigured" }) };
  }

  // Require valid session token (same scheme as airtable.js)
  const token = getBearerToken(event);
  if (!token) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }
  const session = verifyToken(token, authSecret);
  if (!session) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid or expired session" }) };
  }

  // Rate limit per session to cap cost-burn from a compromised account or runaway client
  const rl = await checkRateLimit({
    key: `claude-proxy:session:${session.recordId || session.email || "unknown"}`,
    max: 20,
    windowSeconds: 3600,
  });
  if (!rl.allowed) {
    return {
      statusCode: 429,
      headers: { ...headers, "Retry-After": String(rl.retryAfter) },
      body: JSON.stringify({ error: "Too many requests. Please try again later." }),
    };
  }

  try {
    const requestBody = JSON.parse(event.body);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers,
      body: JSON.stringify(data),
    };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Request failed" }) };
  }
};
