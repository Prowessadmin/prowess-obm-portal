const AIRTABLE_BASE = "appaOBVteWvtxFcKr";
const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE}`;

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const key = process.env.AIRTABLE_KEY;
  console.log("Key preview:", key ? `${key.slice(0,6)}...${key.slice(-4)}` : "MISSING", "| Length:", key ? key.length : 0);

  if (!key) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "AIRTABLE_KEY not configured" }) };
  }

  try {
    let airtableMethod, airtablePath, airtableBody, queryParams;

    if (event.httpMethod === "GET") {
      // GET: path and query params come from query string
      const params = event.queryStringParameters || {};
      airtablePath = params.path || "";
      airtableMethod = "GET";
      const remaining = { ...params };
      delete remaining.path;
      queryParams = new URLSearchParams(remaining).toString();
    } else {
      // POST: everything comes from JSON body
      // { method: "PATCH"|"POST"|"GET", path: "/TABLE/RECORD", body: {...}, query: "..." }
      const parsed = JSON.parse(event.body || "{}");
      airtableMethod = parsed.method || "POST";
      airtablePath = parsed.path || "";
      airtableBody = parsed.body ? JSON.stringify(parsed.body) : undefined;
      queryParams = parsed.query || "";
    }

    const url = `${AIRTABLE_URL}${airtablePath}${queryParams ? "?" + queryParams : ""}`;
    console.log("→", airtableMethod, url);

    const fetchOpts = {
      method: airtableMethod,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    };
    if (airtableBody && airtableMethod !== "GET") {
      fetchOpts.body = airtableBody;
    }

    const res = await fetch(url, fetchOpts);
    const text = await res.text();
    console.log("Status:", res.status, "| Preview:", text.slice(0, 200));

    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return { statusCode: res.status, headers, body: JSON.stringify(data) };
  } catch (err) {
    console.log("ERROR:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
