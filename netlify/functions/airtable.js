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
    console.log("ERROR: AIRTABLE_KEY not set");
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Airtable key not configured" }),
    };
  }

  console.log("Key preview:", key.slice(0, 6) + "..." + key.slice(-4), "| Length:", key.length);

  try {
    const params = event.queryStringParameters || {};
    const path = params.path || "";

    // Build query string from remaining params (exclude 'path')
    const remainingParams = { ...params };
    delete remainingParams.path;
    const queryString = new URLSearchParams(remainingParams).toString();

    const url = `${AIRTABLE_URL}${path}${queryString ? "?" + queryString : ""}`;
    console.log("Calling:", url);
    console.log("Method:", event.httpMethod);

    const fetchOptions = {
      method: event.httpMethod === "GET" ? "GET" : event.httpMethod,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    };

    // Only add body for non-GET requests
    if (event.body && event.httpMethod !== "GET") {
      fetchOptions.body = event.body;
    }

    const res = await fetch(url, fetchOptions);
    const text = await res.text();

    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    console.log("Status:", res.status, "| Response preview:", text.slice(0, 200));

    return { statusCode: res.status, headers, body: JSON.stringify(data) };
  } catch (err) {
    console.log("ERROR:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
