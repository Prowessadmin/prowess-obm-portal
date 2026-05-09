const AIRTABLE_BASE = "appaOBVteWvtxFcKr";
const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE}`;

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const key = process.env.AIRTABLE_KEY;

  if (!key) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Airtable key not configured" }),
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const path = params.path || "";
    const remainingParams = { ...params };
    delete remainingParams.path;

    const queryString = new URLSearchParams(remainingParams).toString();
    const url = `${AIRTABLE_URL}${path}${queryString ? "?" + queryString : ""}`;

    const res = await fetch(url, {
      method: event.httpMethod === "GET" ? "GET" : event.httpMethod,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      ...(event.body && event.httpMethod !== "GET" ? { body: event.body } : {}),
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return { statusCode: res.status, headers, body: JSON.stringify(data) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
