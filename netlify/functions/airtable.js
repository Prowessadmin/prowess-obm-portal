const { verifyToken, getBearerToken } = require("./_auth");

const AIRTABLE_BASE = "appaOBVteWvtxFcKr";
const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE}`;

const TBL_PM        = "tbl9I3xX3zj9b7FqX";
const TBL_MATCHING  = "tblIoFOOL5BShC3bg";
const TBL_PRIMARY   = "tbll8MKHuKiM7YciK";
const TBL_SECONDARY = "tbljqaeAndASfnyc0";
const TBL_TECH      = "tbliJ5Q4yU0m8EnsG";
const TBL_INDUSTRY  = "tbl2qU124blP8q1nv";
const TBL_SPOTLIGHT = "tbl7GmdnkpbjzqXty";

const ALLOWED_TABLES = new Set([
  TBL_PM, TBL_MATCHING, TBL_PRIMARY, TBL_SECONDARY, TBL_TECH, TBL_INDUSTRY, TBL_SPOTLIGHT,
]);

const WRITE_ALLOWED = {
  [TBL_PM]:        new Set(["PATCH"]),
  [TBL_SPOTLIGHT]: new Set(["PATCH", "POST"]),
};

const SENSITIVE_FIELDS = ["Login Code", "Login Code Expires"];

function stripSensitive(record) {
  if (record && record.fields) {
    for (const f of SENSITIVE_FIELDS) delete record.fields[f];
  }
  return record;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const key = process.env.AIRTABLE_KEY;
  const secret = process.env.AUTH_SECRET;
  if (!key || !secret) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server misconfigured" }) };
  }

  const token = getBearerToken(event);
  if (!token) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }
  const session = verifyToken(token, secret);
  if (!session) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid or expired session" }) };
  }

  try {
    let airtableMethod, airtablePath, airtableBody, queryParams;

    if (event.httpMethod === "GET") {
      const params = event.queryStringParameters || {};
      airtablePath = params.path || "";
      airtableMethod = "GET";
      const remaining = { ...params };
      delete remaining.path;
      queryParams = new URLSearchParams(remaining).toString();
    } else {
      const parsed = JSON.parse(event.body || "{}");
      airtableMethod = (parsed.method || "POST").toUpperCase();
      airtablePath = parsed.path || "";
      airtableBody = parsed.body ? JSON.stringify(parsed.body) : undefined;
      queryParams = parsed.query || "";
    }

    if (!["GET", "POST", "PATCH"].includes(airtableMethod)) {
      return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const normalizedPath = airtablePath.startsWith("/") ? airtablePath : "/" + airtablePath;
    const tableId = normalizedPath.split("/")[1] || "";
    if (!ALLOWED_TABLES.has(tableId)) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Forbidden table" }) };
    }

    if (airtableMethod !== "GET") {
      const allowed = WRITE_ALLOWED[tableId];
      if (!allowed || !allowed.has(airtableMethod)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: "Forbidden operation" }) };
      }
    }

    const url = `${AIRTABLE_URL}${normalizedPath}${queryParams ? "?" + queryParams : ""}`;

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

    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (data && typeof data === "object") {
      if (Array.isArray(data.records)) data.records = data.records.map(stripSensitive);
      else if (data.fields) stripSensitive(data);
    }

    return { statusCode: res.status, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Request failed" }) };
  }
};
