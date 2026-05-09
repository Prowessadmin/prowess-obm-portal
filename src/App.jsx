import { useState, useEffect, useCallback } from "react";

// ── Airtable config ──────────────────────────────────────────────
const AIRTABLE_BASE = "appaOBVteWvtxFcKr";
const AIRTABLE_API  = "/.netlify/functions/claude-proxy";

// Table IDs
const TBL_PM_PROFILE   = "tbl9I3xX3zj9b7FqX";
const TBL_MATCHING     = "tblIoFOOL5BShC3bg";
const TBL_PRIMARY_SKILLS = "tbll8MKHuKiM7YciK";
const TBL_SECONDARY_SKILLS = "tbljqaeAndASfnyc0";
const TBL_TECH_SKILLS  = "tbliJ5Q4yU0m8EnsG";

// PM Profile field IDs
const F_EMAIL          = "emai2"; // note: typo in Airtable field name
const F_PRIMARY_SKILLS = "fldU4e9Efu8S5fi6X";
const F_SECONDARY_SKILLS = "fldSmCDx8XqYdEE0d";
const F_TECH_SKILLS    = "fldj2aolPghiYMGyT";
const F_HOURS          = "fldNsLxlToKG6cIpI";
const F_DISC_PRIMARY   = "fld7ONyQ5vTA5pyI0";
const F_NOTES          = "fldEaUNCQgqPsArID";
const F_CERTS          = "fldxD9YWAkY5ZuDRz";
const F_RATE           = "fldalR2oEciMrDMec"; // currency field — write as number
const F_RATE_TEXT      = "fldJS9eWEInztKDx9"; // "What is your preferred hourly rate?" — text

// Matching field IDs  
const F_MATCH_PM       = "fldPYpAtezNNoZIAd";
const F_MATCH_STATUS   = "fldmcFMJQ5uPCCrsE";
const F_MATCH_BUSDEV   = "flda8QSllZiwsHV7k";
const F_MATCH_SCORE    = "fldxXrk9SIv1O8I44";
const F_PLACEMENT_NOTE_STATUS = "fldpXXkmBjvPzuMN7";


// ── Airtable helpers ─────────────────────────────────────────────
async function airtableFetch(path, opts = {}) {
  // Route through Netlify function proxy — keeps API key server-side
  // Path format: /TABLE_ID or /TABLE_ID/RECORD_ID
  // Query params stay in path string as-is

  const isGet = !opts.method || opts.method === "GET";

  let proxyUrl;
  if (isGet) {
    // For GET: pass path and query params through ?path= parameter
    const [basePath, queryPart] = path.split("?");
    const proxyParams = new URLSearchParams({ path: basePath });
    if (queryPart) {
      // Append existing query params
      new URLSearchParams(queryPart).forEach((v, k) => proxyParams.append(k, v));
    }
    proxyUrl = `/.netlify/functions/airtable?${proxyParams.toString()}`;
  } else {
    // For PATCH/POST: pass path only, body in request
    const [basePath] = path.split("?");
    proxyUrl = `/.netlify/functions/airtable?path=${encodeURIComponent(basePath)}`;
  }

  const res = await fetch(proxyUrl, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json" },
    ...(opts.body ? { body: opts.body } : {}),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable error ${res.status}: ${err}`);
  }
  return res.json();
}

async function findOBMByEmail(email) {
  const enc = encodeURIComponent(`{emai2}="${email}"`);
  const data = await airtableFetch(
    `/${TBL_PM_PROFILE}?filterByFormula=${enc}&maxRecords=1`
  );
  return data.records?.[0] || null;
}

async function getMatchingRecords(pmRecordId) {
  // Use FIND to search for the record ID in the linked field
  const formula = `FIND("${pmRecordId}", ARRAYJOIN({PM Profile}, ","))`;
  const enc = encodeURIComponent(formula);
  const data = await airtableFetch(
    `/${TBL_MATCHING}?filterByFormula=${enc}&sort[0][field]=Created&sort[0][direction]=desc`
  );
  return data.records || [];
}

async function getSkillTable(tableId, nameField) {
  const data = await airtableFetch(`/${tableId}?maxRecords=200`);
  return (data.records || []).map(r => ({
    id: r.id,
    name: r.fields[nameField] || "",
  })).filter(s => {
    if (!s.name) return false;
    // Filter out Webflow hex IDs (24-char hex strings)
    if (/^[0-9a-f]{20,}$/i.test(s.name.trim())) return false;
    // Filter out names that are just numbers
    if (/^[0-9]+$/.test(s.name.trim())) return false;
    return true;
  });
}

// ── Claude API call ──────────────────────────────────────────────
async function claudeParseResume(resumeText, primarySkills, secondarySkills, techSkills) {
  const res = await fetch("/.netlify/functions/claude-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: `You are a resume parser for Prowess Project. Extract skills from resumes and match them to provided taxonomies. 
Return ONLY valid JSON. No markdown, no explanation.
Format: {"primarySkills": ["skill1"], "secondarySkills": ["skill2"], "techSkills": ["tool1"], "education": "degree info", "industries": ["industry1"], "rate": "suggested rate if mentioned"}`,
      messages: [{
        role: "user",
        content: `Parse this resume and match skills to these exact taxonomies:
PRIMARY SKILLS TAXONOMY: ${primarySkills.map(s => s.name).join(", ")}
SECONDARY SKILLS TAXONOMY: ${secondarySkills.map(s => s.name).join(", ")}
TECH SKILLS TAXONOMY: ${techSkills.map(s => s.name).join(", ")}
Rules:
- Only return skills that exist in the taxonomy OR are clearly equivalent to a taxonomy item
- For tech: skip proprietary, niche, legacy, or rarely-used software
- Match common equivalents (e.g. "G Suite" = "Google Workspace")
- Education: extract highest degree + field
- Industries: extract industries they have worked in
RESUME:
${resumeText.slice(0, 8000)}`
      }]
    })
  });
  const data = await res.json();
  const text = data.content?.[0]?.text || "{}";
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    const matchSkill = (name, options) => 
      options.find(o => o.name.trim().toLowerCase() === name.trim().toLowerCase());
    return {
      primarySkills: (parsed.primarySkills || [])
        .map(name => matchSkill(name, primarySkills))
        .filter(Boolean),
      secondarySkills: (parsed.secondarySkills || [])
        .map(name => matchSkill(name, secondarySkills))
        .filter(Boolean),
      techSkills: (parsed.techSkills || [])
        .map(name => matchSkill(name, techSkills))
        .filter(Boolean),
      rate: parsed.rate || "",
    };
  } catch {
    return { primarySkills: [], secondarySkills: [], techSkills: [], rate: "" };
  }
}
  const data = await res.json();
  const text = data.content?.[0]?.text || "{}";
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    
    // Map skill names back to option objects with IDs
    const matchSkill = (name, options) => 
      options.find(o => o.name.trim().toLowerCase() === name.trim().toLowerCase());
    
    return {
      primarySkills: (parsed.primarySkills || [])
        .map(name => matchSkill(name, primarySkills))
        .filter(Boolean),
      secondarySkills: (parsed.secondarySkills || [])
        .map(name => matchSkill(name, secondarySkills))
        .filter(Boolean),
      techSkills: (parsed.techSkills || [])
        .map(name => matchSkill(name, techSkills))
        .filter(Boolean),
      rate: parsed.rate || "",
    };
  }catch {
    return { primarySkills: [], secondarySkills: [], techSkills: [], rate: "" };
  }


// ── Airtable write-back ──────────────────────────────────────────
async function updateOBMProfile(recordId, profile) {
  // Parse rate — input is type number so value is already clean
  const rateNum = profile.rate !== "" && profile.rate !== null
    ? parseFloat(profile.rate)
    : null;

  const fields = {
    "Primary-Secondary Skills Algo": profile.primarySkills.map(s => s.id),
    "Secondary Skills Algo": profile.secondarySkills.map(s => s.id),
    "Technology skills Algo": profile.techSkills.map(s => s.id),
    "Availability Hours": profile.hours,
    "Notes": profile.notes,
    ...(rateNum !== null && { "Rate": rateNum }),
    ...(profile.rate && { "What is your preferred hourly rate?": String(profile.rate) }),
  };

  // Remove empty values to avoid overwriting with blanks
  Object.keys(fields).forEach(k => {
    if (fields[k] === "" || fields[k] === null || fields[k] === undefined) {
      delete fields[k];
    }
    if (Array.isArray(fields[k]) && fields[k].length === 0) {
      delete fields[k];
    }
  });

  return airtableFetch(`/${TBL_PM_PROFILE}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  }).catch(e => {
    console.error("updateOBMProfile error:", e);
    throw e;
  });
}

// ── Load linked skills for existing OBM ─────────────────────────
function loadLinkedSkills(record, primaryOptions, secondaryOptions, techOptions) {
  const f = record.fields;
  const primaryIds = new Set(f[F_PRIMARY_SKILLS] || []);
  const secondaryIds = new Set(f[F_SECONDARY_SKILLS] || []);
  const techIds = new Set(f[F_TECH_SKILLS] || []);

  return {
    primarySkills: primaryOptions.filter(o => primaryIds.has(o.id)),
    secondarySkills: secondaryOptions.filter(o => secondaryIds.has(o.id)),
    techSkills: techOptions.filter(o => techIds.has(o.id)),
  };
}

// ── GHL webhook for verification code ───────────────────────────
// Set VITE_GHL_WEBHOOK_URL in Netlify env vars to enable real sending
// GHL workflow: webhook received → send email with code field
async function sendVerificationCode(email, code) {
  // Demo mode — code shown on screen
  // In production on Netlify: set VITE_GHL_WEBHOOK_URL env var
  // and replace this with: const webhookUrl = import.meta.env.VITE_GHL_WEBHOOK_URL;
  const webhookUrl = window.__GHL_WEBHOOK_URL__ || "https://services.leadconnectorhq.com/hooks/Gj5Q3lzUUIgpZ7ifPO7I/webhook-trigger/24f7ccf6-343d-4282-8285-4525d806ae97";

  if (!webhookUrl) {
    console.log(`[Demo] Code for ${email}: ${code}`);
    return { demo: true };
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        code,
        message: `Your Prowess Partner Portal verification code is: ${code}. This code expires in 10 minutes.`,
        source: "prowess-obm-portal",
      }),
    });
    return { sent: true };
  } catch (e) {
    console.error("GHL webhook failed:", e);
    return { demo: true };
  }
}

// ── One-time code generation ─────────────────────────────────────
function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// ── Prowess Brand Colors ─────────────────────────────────────────
const COLORS = {
  bg: "#FFFFFF",
  surface: "#F1F2F2",
  card: "#FFFFFF",
  border: "#E0E1E1",
  borderDark: "#C8C9CA",
  accent: "#7FBFB8",        // Prowess teal
  accentDark: "#5EA8A1",    // darker teal for hover
  accentLight: "#E8F4F3",   // very light teal for backgrounds
  coral: "#F15D60",         // Prowess coral
  coralLight: "#FEF0F0",    // light coral for warnings
  text: "#1A1A1A",
  textMuted: "#6B6B6B",
  textDim: "#A0A0A0",
  success: "#5EA8A1",
  warning: "#F15D60",
  white: "#FFFFFF",
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;500;600;700&family=DM+Sans:wght@300;400;500&display=swap');
  
  * { box-sizing: border-box; margin: 0; padding: 0; }
  
  body {
    background: ${COLORS.bg};
    color: ${COLORS.text};
    font-family: 'DM Sans', Helvetica, sans-serif;
    min-height: 100vh;
  }

  .portal-wrap {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow-x: hidden;
  }

  /* Decorative background circles */
  .portal-wrap::before {
    content: '';
    position: fixed;
    top: -120px;
    right: -120px;
    width: 480px;
    height: 480px;
    border-radius: 50%;
    background: radial-gradient(circle, ${COLORS.accentLight} 0%, transparent 65%);
    pointer-events: none;
    z-index: 0;
  }

  .portal-wrap::after {
    content: '';
    position: fixed;
    bottom: -140px;
    left: -140px;
    width: 420px;
    height: 420px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(241,93,96,0.05) 0%, transparent 65%);
    pointer-events: none;
    z-index: 0;
  }

  .portal-header {
    padding: 16px 40px;
    border-bottom: 1px solid ${COLORS.border};
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: ${COLORS.white};
    position: relative;
    z-index: 10;
  }

  .portal-main {
    flex: 1;
    padding: 48px 40px;
    max-width: 860px;
    margin: 0 auto;
    width: 100%;
    position: relative;
    z-index: 1;
  }

  .logo-wrap {
    display: flex;
    align-items: center;
    gap: 14px;
  }



  .logo {
    font-family: 'Raleway', sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: ${COLORS.text};
    letter-spacing: 0.14em;
    text-transform: uppercase;
    line-height: 1.2;
  }

  .logo-sub {
    font-family: 'DM Sans', sans-serif;
    font-size: 10px;
    color: ${COLORS.accent};
    letter-spacing: 0.2em;
    text-transform: uppercase;
    margin-top: 3px;
    font-weight: 500;
  }

  .portal-hero {
    background: ${COLORS.accent};
    padding: 64px 40px 56px;
    text-align: center;
    position: relative;
    overflow: hidden;
  }

  /* Decorative dot grid */
  .portal-hero::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background-image: radial-gradient(circle, rgba(255,255,255,0.15) 1.5px, transparent 1.5px);
    background-size: 24px 24px;
    pointer-events: none;
  }

  /* Large decorative circles */
  .portal-hero::after {
    content: '';
    position: absolute;
    top: -80px;
    right: -80px;
    width: 320px;
    height: 320px;
    border-radius: 50%;
    background: rgba(255,255,255,0.06);
    pointer-events: none;
  }

  .hero-circle-left {
    position: absolute;
    bottom: -60px;
    left: -60px;
    width: 220px;
    height: 220px;
    border-radius: 50%;
    background: rgba(255,255,255,0.06);
    pointer-events: none;
  }

  .hero-circle-mid {
    position: absolute;
    top: 20px;
    left: 12%;
    width: 80px;
    height: 80px;
    border-radius: 50%;
    border: 1.5px solid rgba(255,255,255,0.2);
    pointer-events: none;
  }

  .hero-logo {
    display: none;
  }

  .hero-diamond {
    width: 60px;
    height: 60px;
    background: rgba(255,255,255,0.2);
    border: 2px solid rgba(255,255,255,0.55);
    transform: rotate(45deg);
    margin: 0 auto 28px;
    position: relative;
    z-index: 1;
    border-radius: 4px;
  }

  .hero-diamond::before {
    content: '';
    position: absolute;
    inset: 7px;
    border: 1.5px solid rgba(255,255,255,0.45);
    border-radius: 2px;
  }

  .hero-diamond-wrap {
    width: 90px;
    height: 90px;
    margin: 0 auto 24px;
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .hero-title {
    font-family: 'Raleway', sans-serif;
    font-size: 32px;
    font-weight: 700;
    color: ${COLORS.white};
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 10px;
    position: relative;
    z-index: 1;
  }

  .hero-sub {
    font-size: 15px;
    color: rgba(255,255,255,0.8);
    font-weight: 300;
    letter-spacing: 0.04em;
    position: relative;
    z-index: 1;
  }

  .portal-main {
    flex: 1;
    padding: 48px 40px;
    max-width: 860px;
    margin: 0 auto;
    width: 100%;
  }

  .auth-wrap {
    max-width: 440px;
    margin: 0 auto;
  }

  .auth-title {
    font-family: 'Raleway', sans-serif;
    font-size: 28px;
    font-weight: 700;
    color: ${COLORS.text};
    margin-bottom: 8px;
    letter-spacing: 0.02em;
  }

  .auth-subtitle {
    color: ${COLORS.textMuted};
    font-size: 15px;
    margin-bottom: 36px;
    line-height: 1.6;
  }

  .field-group {
    margin-bottom: 20px;
  }

  .field-label {
    display: block;
    font-family: 'Raleway', sans-serif;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${COLORS.textMuted};
    margin-bottom: 8px;
  }

  .field-input {
    width: 100%;
    background: ${COLORS.white};
    border: 1.5px solid ${COLORS.border};
    border-radius: 6px;
    padding: 12px 14px;
    color: ${COLORS.text};
    font-family: 'DM Sans', sans-serif;
    font-size: 15px;
    transition: border-color 0.2s, box-shadow 0.2s;
    outline: none;
  }

  .field-input:focus {
    border-color: ${COLORS.accent};
    box-shadow: 0 0 0 3px ${COLORS.accentLight};
  }

  .field-input::placeholder {
    color: ${COLORS.textDim};
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 13px 24px;
    border-radius: 6px;
    font-family: 'Raleway', sans-serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
    outline: none;
  }

  .btn-primary {
    background: ${COLORS.accent};
    color: ${COLORS.white};
    width: 100%;
  }

  .btn-primary:hover { background: ${COLORS.accentDark}; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-coral {
    background: ${COLORS.coral};
    color: ${COLORS.white};
    width: 100%;
  }

  .btn-coral:hover { background: #D94A4D; }

  .btn-ghost {
    background: transparent;
    border: 1.5px solid ${COLORS.border};
    color: ${COLORS.textMuted};
  }

  .btn-ghost:hover { border-color: ${COLORS.accent}; color: ${COLORS.accent}; }

  .btn-sm {
    padding: 8px 16px;
    font-size: 11px;
  }

  .error-msg {
    background: ${COLORS.coralLight};
    border: 1px solid rgba(241, 93, 96, 0.3);
    color: ${COLORS.coral};
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 14px;
    margin-bottom: 16px;
  }

  .info-msg {
    background: ${COLORS.accentLight};
    border: 1px solid rgba(127, 191, 184, 0.4);
    color: ${COLORS.accentDark};
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 14px;
    margin-bottom: 16px;
    line-height: 1.5;
  }

  .profile-header {
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid ${COLORS.border};
  }

  .profile-greeting {
    font-family: 'Raleway', sans-serif;
    font-size: 26px;
    font-weight: 700;
    color: ${COLORS.text};
    margin-bottom: 4px;
    letter-spacing: 0.02em;
  }

  .profile-email {
    color: ${COLORS.textMuted};
    font-size: 14px;
  }

  .tab-nav {
    display: flex;
    gap: 0;
    margin-bottom: 28px;
    border-bottom: 2px solid ${COLORS.border};
  }

  .tab-btn {
    padding: 12px 24px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: ${COLORS.textMuted};
    font-family: 'Raleway', sans-serif;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.2s;
    margin-bottom: -2px;
  }

  .tab-btn.active {
    color: ${COLORS.accent};
    border-bottom-color: ${COLORS.accent};
  }

  .tab-btn:hover:not(.active) { color: ${COLORS.text}; }

  .section-card {
    background: ${COLORS.white};
    border: 1px solid ${COLORS.border};
    border-radius: 8px;
    padding: 24px;
    margin-bottom: 16px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .section-title {
    font-family: 'Raleway', sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${COLORS.textMuted};
  }

  .skill-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .skill-tag {
    background: ${COLORS.accentLight};
    border: 1px solid rgba(127, 191, 184, 0.4);
    color: #1F5C58;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .skill-tag-remove {
    background: none;
    border: none;
    color: #3D8A85;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0;
    display: flex;
    align-items: center;
    transition: color 0.15s;
  }

  .skill-tag-remove:hover { color: ${COLORS.coral}; }

  .skill-option {
    background: ${COLORS.surface};
    border: 1px solid ${COLORS.border};
    color: ${COLORS.textMuted};
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
    font-family: 'DM Sans', sans-serif;
  }

  .skill-option:hover {
    border-color: ${COLORS.accent};
    color: ${COLORS.accent};
    background: ${COLORS.accentLight};
  }

  .empty-state {
    color: ${COLORS.textDim};
    font-size: 14px;
    font-style: italic;
  }

  .role-card {
    background: ${COLORS.white};
    border: 1px solid ${COLORS.border};
    border-radius: 8px;
    padding: 20px 24px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    transition: border-color 0.2s;
  }

  .role-card:hover { border-color: ${COLORS.accent}; }

  .role-name {
    font-family: 'Raleway', sans-serif;
    font-size: 15px;
    font-weight: 600;
    color: ${COLORS.text};
    margin-bottom: 4px;
    letter-spacing: 0.01em;
  }

  .role-meta {
    font-size: 13px;
    color: ${COLORS.textMuted};
  }

  .status-badge {
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    font-family: 'Raleway', sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .status-identified { background: ${COLORS.accentLight}; color: #1F5C58; border: 1px solid rgba(127,191,184,0.4); }
  .status-awaiting { background: #FFF8EC; color: #8A5E1A; border: 1px solid rgba(176,125,42,0.3); }
  .status-passed { background: ${COLORS.accentLight}; color: #1F5C58; border: 1px solid rgba(127,191,184,0.4); }
  .status-hired { background: ${COLORS.accentLight}; color: #1F5C58; border: 1px solid rgba(127,191,184,0.5); }
  .status-other { background: ${COLORS.surface}; color: ${COLORS.textMuted}; border: 1px solid ${COLORS.border}; }

  .upload-zone {
    border: 2px dashed ${COLORS.border};
    border-radius: 8px;
    padding: 48px 24px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    background: ${COLORS.surface};
  }

  .upload-zone:hover, .upload-zone.drag-over {
    border-color: ${COLORS.accent};
    background: ${COLORS.accentLight};
  }

  .upload-icon { font-size: 36px; margin-bottom: 14px; }

  .upload-text { 
    color: ${COLORS.textMuted}; 
    font-size: 14px; 
    line-height: 1.6; 
  }

  .upload-text strong { color: ${COLORS.accent}; }

  .spinner {
    width: 20px; height: 20px;
    border: 2px solid rgba(127,191,184,0.2);
    border-top-color: ${COLORS.accent};
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    display: inline-block;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .divider {
    border: none;
    border-top: 1px solid ${COLORS.border};
    margin: 24px 0;
  }

  .config-notice {
    background: ${COLORS.accentLight};
    border: 1px solid rgba(127,191,184,0.3);
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 28px;
    font-size: 13px;
    color: ${COLORS.textMuted};
    line-height: 1.6;
  }

  .config-notice strong { 
    color: ${COLORS.accentDark}; 
    display: block; 
    margin-bottom: 6px; 
    font-family: 'Raleway', sans-serif;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .save-bar {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    background: ${COLORS.white};
    border-top: 1px solid ${COLORS.border};
    padding: 16px 40px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    z-index: 100;
    box-shadow: 0 -4px 16px rgba(0,0,0,0.06);
  }

  .text-success { color: ${COLORS.accent}; font-size: 14px; font-weight: 500; }

  .teal-bar {
    height: 4px;
    background: ${COLORS.accent};
    width: 100%;
  }

  .coral-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: ${COLORS.coral};
    display: inline-block;
    margin-right: 6px;
  }

  .rate-input-wrap {
    display: flex;
    align-items: center;
    border: 1.5px solid ${COLORS.border};
    border-radius: 6px;
    background: ${COLORS.white};
    overflow: hidden;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .rate-input-wrap:focus-within {
    border-color: ${COLORS.accent};
    box-shadow: 0 0 0 3px ${COLORS.accentLight};
  }

  .rate-prefix, .rate-suffix {
    padding: 12px 12px;
    background: ${COLORS.surface};
    color: ${COLORS.textMuted};
    font-family: 'DM Sans', sans-serif;
    font-size: 15px;
    font-weight: 500;
    border: none;
    white-space: nowrap;
    user-select: none;
  }

  .rate-prefix {
    border-right: 1px solid ${COLORS.border};
  }

  .rate-suffix {
    border-left: 1px solid ${COLORS.border};
  }

  .rate-input {
    flex: 1;
    background: transparent;
    border: none;
    padding: 12px 10px;
    color: ${COLORS.text};
    font-family: 'DM Sans', sans-serif;
    font-size: 15px;
    outline: none;
    min-width: 0;
  }

  .rate-input::placeholder {
    color: ${COLORS.textDim};
  }
`;



// ── Skill categories for organized display ───────────────────────
const SKILL_CATEGORIES = {
  "Operations & Strategy": [
    "Project Management","Process Improvement","Strategic planning","Resource Management",
    "Corporate Operations","Risk management","Capacity Planning","Quality Assurance",
    "Reporting","Document Management & Compliance Tracking","Meeting Management",
    "Technical Project Management","Business Analysis","Research ","Scheduling",
    "Executive Assistance","Agile ","Agile","Scrum","Grant writing"
  ],
  "Finance & Accounting": [
    "Accounting","Bookkeeping","Budgeting","Financial Analytics","Financial reporting/modeling",
    "Forecasting","Invoicing","Payroll management","Procurement","Mergers & Acquisitions ",
    "Mergers & Acquisitions","Workers Compensation","Benefits Administration"
  ],
  "People & HR": [
    "Human relations","Recruiting","Talent acquisition","Onboarding","Training",
    "Employee Relations","Performance Management","Team communications"
  ],
  "Sales & Marketing": [
    "CRM management","Lead generation","Marketing automation","Digital marketing",
    "Content creation","Social media","B2B marketing","SEO/SEM ","Copywriting",
    "Copy writing","Branding","Account management","Customer Success","Customer service",
    "Inside sales","Outside sales","Enterprise sales","Demand generation","Partnerships",
    "Product marketing","Event marketing/planning","Public relations strategy",
    "Media Planner","Help desk"
  ],
  "Technology & Data": [
    "Data analytics","Data science","Database management","System/tech Implementations",
    "AI & Automation Fluency","Web design","UIUX","Mobile app development",
    "Front end development","Backend development","Devops","DevOps","Technical writing",
    "Product development","Ecommerce Operations","Inventory management","Supply chain "
  ],
  "Other": []
};

const TECH_CATEGORIES = {
  "AI & Automation": [
    "ChatGPT","Claude","CoPilot","Gemini","Perplexity","Zapier","API","AWS","Azure"
  ],
  "Project Management": [
    "Asana","ClickUp","Monday","Notion","Trello","Jira","Smartsheets","Podio","Airtable"
  ],
  "CRM & Marketing": [
    "GoHighLevel","HighLevel","Salesforce","Pipedrive","Zendesk CRM","Hubspot",
    "Active Campaign","Mailchimp","Marketo","Manychat","Facebook Ads","Hootsuite",
    "Planable","Planoly","Linkedin Navigator","Click Funnel (or similar)","ClickFunnel",
    "Leadpages","Dubsado","Honeybook","Kajabi"
  ],
  "Finance & Accounting": [
    "Quickbooks Online","Quickbooks Desktop","Quickbooks Enterprise","Xero",
    "Gusto","ADP","Double/Keeper","TaxDome","Greenhouse"
  ],
  "Communication & Docs": [
    "Slack","Zoom","Google Docs","Google Sheets","Gsuite","Microsoft Office (MS 365)",
    "Word","Excel","Sharepoint","Github","Descript (or other podcast editing)"
  ],
  "Design & Web": [
    "Canva","Adobe Suites","Wordpress","WIX","Shopify","HTML, CSS","UIUX"
  ],
  "Development": [
    ".NET","AJAX","Android ","Angular ","Blockchain","DB2","Docker","IBM i","JSON",
    "Java ","Javascript ","Jquery","Linux ","MongoDB","MySQL","NoSQL","Node.js",
    "PHP","PWA","Perl","PostgreSQL","Python","REST","Ruby","SOAP","Scala",
    "Websockets","Windows","iOS","90.io"
  ],
  "Other Tech": []
};

function categorizeTech(techName) {
  for (const [cat, tools] of Object.entries(TECH_CATEGORIES)) {
    if (cat === "Other Tech") continue;
    if (tools.some(t => t.trim().toLowerCase() === techName.trim().toLowerCase())) return cat;
  }
  return "Other Tech";
}

function categorizeSkill(skillName) {
  for (const [cat, skills] of Object.entries(SKILL_CATEGORIES)) {
    if (cat === "Other") continue;
    if (skills.some(s => s.trim().toLowerCase() === skillName.trim().toLowerCase())) return cat;
  }
  return "Other";
}

// ── Tech skill selector (categorized) ───────────────────────────
function TechSelector({ selected, options, onChange, editing }) {
  const [search, setSearch] = useState("");
  const [expandedCat, setExpandedCat] = useState(null);
  const selectedSet = new Set(selected.map(s => s.id));

  const grouped = {};
  options.forEach(o => {
    if (selectedSet.has(o.id)) return;
    const cat = categorizeTech(o.name);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(o);
  });

  const searchResults = search.length > 1
    ? options.filter(o => !selectedSet.has(o.id) && o.name.toLowerCase().includes(search.toLowerCase()))
    : [];

  return (
    <div>
      <div className="skill-tags" style={{ marginBottom: selected.length ? 16 : 0 }}>
        {selected.map(s => (
          <span key={s.id} className="skill-tag">
            {s.name}
            {editing && (
              <button className="skill-tag-remove" onClick={() => onChange(selected.filter(x => x.id !== s.id))}>×</button>
            )}
          </span>
        ))}
        {!selected.length && !editing && <span className="empty-state">No tech skills added yet</span>}
      </div>
      {editing && (
        <div>
          <input
            className="field-input"
            style={{ marginBottom: 16, marginTop: 8 }}
            placeholder="Search technology..."
            value={search}
            onChange={e => { setSearch(e.target.value); setExpandedCat(null); }}
          />
          {search.length > 1 ? (
            <div className="skill-tags">
              {searchResults.slice(0, 15).map(o => (
                <button key={o.id} className="skill-option"
                  onClick={() => { onChange([...selected, o]); setSearch(""); }}>
                  + {o.name}
                </button>
              ))}
              {!searchResults.length && <span className="empty-state">No matches for "{search}"</span>}
            </div>
          ) : (
            <div>
              {Object.entries(grouped).filter(([,tools]) => tools.length > 0).map(([cat, tools]) => (
                <div key={cat} style={{ marginBottom: 12 }}>
                  <button
                    onClick={() => setExpandedCat(expandedCat === cat ? null : cat)}
                    style={{
                      display:"flex", alignItems:"center", justifyContent:"space-between",
                      width:"100%", background:"none", border:"none",
                      padding:"8px 0", cursor:"pointer", textAlign:"left"
                    }}
                  >
                    <span style={{ fontSize:12, fontWeight:600, letterSpacing:"0.08em",
                      textTransform:"uppercase", color:"#6B6B6B" }}>
                      {cat} ({tools.length})
                    </span>
                    <span style={{ color:"#7FBFB8", fontSize:18, lineHeight:1 }}>
                      {expandedCat === cat ? "−" : "+"}
                    </span>
                  </button>
                  {expandedCat === cat && (
                    <div className="skill-tags" style={{ paddingTop:8, paddingBottom:8 }}>
                      {tools.map(o => (
                        <button key={o.id} className="skill-option"
                          onClick={() => onChange([...selected, o])}>
                          + {o.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ borderBottom:"1px solid #E0E1E1" }}></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Status badge ─────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    "Candidate Identified": ["status-identified", "Identified"],
    "Awaiting Response": ["status-awaiting", "Awaiting Response"],
    "response yes": ["status-identified", "Applied"],
    "Passed": ["status-passed", "Moved Forward"],
    "Hired": ["status-hired", "Placed ✓"],
    "not a match": ["status-other", "Not Moved Forward"],
    "Pending Final Assessments": ["status-awaiting", "In Review"],
    "Profile & Scoring Complete": ["status-awaiting", "Scoring Complete"],
  };
  const [cls, label] = map[status] || ["status-other", status || "Unknown"];
  return <span className={`status-badge ${cls}`}>{label}</span>;
}

// ── Categorized skill selector ───────────────────────────────────
function SkillSelector({ label, selected, options, onChange, editing }) {
  const [search, setSearch] = useState("");
  const [expandedCat, setExpandedCat] = useState(null);
  const selectedSet = new Set(selected.map(s => s.id));

  // Group options by category
  const grouped = {};
  options.forEach(o => {
    if (selectedSet.has(o.id)) return;
    const cat = categorizeSkill(o.name);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(o);
  });

  // Search filters across all categories
  const searchResults = search.length > 1
    ? options.filter(o => !selectedSet.has(o.id) && o.name.toLowerCase().includes(search.toLowerCase()))
    : [];

  return (
    <div>
      {/* Selected tags */}
      <div className="skill-tags" style={{ marginBottom: selected.length ? 16 : 0 }}>
        {selected.map(s => (
          <span key={s.id} className="skill-tag">
            {s.name}
            {editing && (
              <button className="skill-tag-remove" onClick={() => onChange(selected.filter(x => x.id !== s.id))}>×</button>
            )}
          </span>
        ))}
        {!selected.length && !editing && (
          <span className="empty-state">No {label.toLowerCase()} added yet</span>
        )}
      </div>

      {editing && (
        <div>
          {/* Search */}
          <input
            className="field-input"
            style={{ marginBottom: 16, marginTop: 8 }}
            placeholder={`Search ${label.toLowerCase()}...`}
            value={search}
            onChange={e => { setSearch(e.target.value); setExpandedCat(null); }}
          />

          {/* Search results */}
          {search.length > 1 ? (
            <div className="skill-tags">
              {searchResults.slice(0, 15).map(o => (
                <button key={o.id} className="skill-option"
                  onClick={() => { onChange([...selected, o]); setSearch(""); }}>
                  + {o.name}
                </button>
              ))}
              {!searchResults.length && <span className="empty-state">No matches for "{search}"</span>}
            </div>
          ) : (
            /* Category browsing */
            <div>
              {Object.entries(grouped).filter(([,skills]) => skills.length > 0).map(([cat, skills]) => (
                <div key={cat} style={{ marginBottom: 12 }}>
                  <button
                    onClick={() => setExpandedCat(expandedCat === cat ? null : cat)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      width: "100%", background: "none", border: "none",
                      padding: "8px 0", cursor: "pointer", textAlign: "left"
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em",
                      textTransform: "uppercase", color: "#6B6B6B" }}>
                      {cat} ({skills.length})
                    </span>
                    <span style={{ color: "#7FBFB8", fontSize: 18, lineHeight: 1 }}>
                      {expandedCat === cat ? "−" : "+"}
                    </span>
                  </button>
                  {expandedCat === cat && (
                    <div className="skill-tags" style={{ paddingTop: 8, paddingBottom: 8 }}>
                      {skills.map(o => (
                        <button key={o.id} className="skill-option"
                          onClick={() => { onChange([...selected, o]); }}>
                          + {o.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ borderBottom: "1px solid #E0E1E1" }}></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────
export default function OBMPortal() {
  // Initialize Airtable key from env var (Netlify) or window variable (dev)
  useEffect(() => {
    if (!window.__AIRTABLE_KEY__) {
      // In Netlify this is set via VITE_AIRTABLE_KEY env var
      // For local dev: set window.__AIRTABLE_KEY__ in index.html or .env
      const envKey = typeof __AIRTABLE_KEY__ !== "undefined" ? __AIRTABLE_KEY__ : null;
      if (envKey) window.__AIRTABLE_KEY__ = envKey;
    }
  }, []);

  const [stage, setStage] = useState("email"); // email | code | loading | profile | new-profile
  const [email, setEmail] = useState("");
  const [obm, setObm] = useState(null);
  const [matchingRoles, setMatchingRoles] = useState([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [activeTab, setActiveTab] = useState("profile");
  const [editing, setEditing] = useState(false);
  const [editMode, setEditMode] = useState(null); // null | "resume" | "manual"
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Skill taxonomy
  const [primaryOptions, setPrimaryOptions] = useState([]);
  const [secondaryOptions, setSecondaryOptions] = useState([]);
  const [techOptions, setTechOptions] = useState([]);

  // Profile state (editable)
  const [profile, setProfile] = useState({
    primarySkills: [],
    secondarySkills: [],
    techSkills: [],
    hours: [],
    education: "",
    rate: "",
    notes: "",
  });

  // New profile / resume flow
  const [resumeText, setResumeText] = useState("");
  const [resumeFile, setResumeFile] = useState(null);

  const [parsedSuggestions, setParsedSuggestions] = useState(null);
  const [parsing, setParsing] = useState(false);

  const hoursOptions = ["5 hours per week", "10 hours per week", "20 hours per week", "30 hours per week"];

  // Load skill taxonomies on mount
  useEffect(() => {
    Promise.all([
      getSkillTable(TBL_PRIMARY_SKILLS, "Skill Name"),
      getSkillTable(TBL_SECONDARY_SKILLS, "Label"),
      getSkillTable(TBL_TECH_SKILLS, "Tech name"),
    ]).then(([p, s, t]) => {
      setPrimaryOptions(p);
      setSecondaryOptions(s);
      setTechOptions(t);
    }).catch(e => console.error("Failed to load skill taxonomy:", e));
  }, []);

  // Handle email submit — email-only auth
  async function handleEmailSubmit() {
    setError("");
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setStage("loading");
    try {
      const record = await findOBMByEmail(email.toLowerCase().trim());
      if (record) {
        setObm(record);
        const roles = await getMatchingRecords(record.id);
        setMatchingRoles(roles);
        const f = record.fields;
        let pOpts = primaryOptions;
        let sOpts = secondaryOptions;
        let tOpts = techOptions;
        if (!pOpts.length) {
          [pOpts, sOpts, tOpts] = await Promise.all([
            getSkillTable(TBL_PRIMARY_SKILLS, "Skill Name"),
            getSkillTable(TBL_SECONDARY_SKILLS, "Label"),
            getSkillTable(TBL_TECH_SKILLS, "Tech name"),
          ]);
          setPrimaryOptions(pOpts);
          setSecondaryOptions(sOpts);
          setTechOptions(tOpts);
        }
        // Airtable returns fields by name when fetching records
        // Use field names as they appear in Airtable
        const primaryIds = new Set(f["Primary-Secondary Skills Algo"] || []);
        const secondaryIds = new Set(f["Secondary Skills Algo"] || []);
        const techIds = new Set(f["Technology skills Algo"] || []);

        setProfile({
          primarySkills: pOpts.filter(o => primaryIds.has(o.id)),
          secondarySkills: sOpts.filter(o => secondaryIds.has(o.id)),
          techSkills: tOpts.filter(o => techIds.has(o.id)),
          hours: f["Availability Hours"] || [],
          education: f["Education"] || f["Certifications"] || "",
          rate: f["Rate"] ?? "",
          notes: f["Notes"] || "",
        });
        setStage("profile");
      } else {
        setError("We couldn't find a profile matching that email. Please check and try again, or contact Prowess support.");
        setStage("email");
      }
    } catch (e) {
      setError("Something went wrong. Please try again.");
      console.error(e);
      setStage("email");
    }
  }


  // Handle resume upload
  async function handleResumeUpload(file) {
  if (!file) return;
  setResumeFile(file);
  const text = await file.text();
  setResumeText(text);
  setParsing(true);
  try {
    const suggestions = await claudeParseResume(text, primaryOptions, secondaryOptions, techOptions);
    // Apply suggestions to profile for review — don't save yet
    setProfile(p => ({
      ...p,
      primarySkills: suggestions.primarySkills,
      secondarySkills: suggestions.secondarySkills,
      techSkills: suggestions.techSkills,
      rate: suggestions.rate || p.rate,
    }));
    setParsedSuggestions(suggestions);
  } catch (e) {
    setError("Could not parse resume. Please select your skills manually below.");
  } finally {
    setParsing(false);
  }
}

  // Handle save profile — works for both new and existing OBMs
  async function handleSaveProfile() {
    setSaving(true);
    setSaveSuccess(false);
    setError("");
    try {
      let recordId = obm?.id;
      if (!recordId) {
        const record = await findOBMByEmail(email.toLowerCase().trim());
        if (!record) {
          setError("Profile record not found. Please contact Prowess support.");
          setSaving(false);
          return;
        }
        setObm(record);
        recordId = record.id;
      }
      await updateOBMProfile(recordId, profile);
      setSaveSuccess(true);
      setEditing(false);
      setEditMode(null);
      if (stage === "new-profile") setStage("profile");
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (e) {
      console.error("Save failed:", e);
      setError("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <>
      <style>{css}</style>
      <div className="portal-wrap">
        {/* Header */}
        <header className="portal-header">
          <div className="logo-wrap">
            
            <div>
              <div className="logo">Prowess Project</div>
              <div className="logo-sub">OBM Profile Portal</div>
            </div>
          </div>
          {obm && (
            <button className="btn btn-ghost btn-sm" onClick={() => {
              setStage("email"); setObm(null); setEmail(""); setCodeInput(""); setInfo(""); setError("");
            }}>Sign Out</button>
          )}
        </header>

        {/* Teal accent bar */}
        <div className="teal-bar"></div>

        <main className="portal-main">

          {/* ── EMAIL STAGE ── */}
          {stage === "email" && (
            <>
              <div className="portal-hero">
                <div className="hero-circle-left"></div>
                <div className="hero-circle-mid"></div>
                
                <div className="hero-title">OBM Profile Portal</div>
                <div className="hero-sub">Manage your profile and track your matched opportunities</div>
              </div>
              <div style={{maxWidth: 860, margin: "0 auto", padding: "48px 40px"}}>
                <div className="auth-wrap">
                  <h1 className="auth-title">Sign In</h1>
                  <p className="auth-subtitle">Enter the email address associated with your Prowess OBM profile to access your dashboard.</p>
                  {error && <div className="error-msg">{error}</div>}
                  <div className="field-group">
                    <label className="field-label">Email Address</label>
                    <input
                      className="field-input"
                      type="email"
                      placeholder="you@email.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleEmailSubmit()}
                      autoFocus
                    />
                  </div>
                  <button className="btn btn-primary" onClick={handleEmailSubmit}>
                    Access My Profile
                  </button>
                </div>
              </div>
            </>
          )}


          {/* ── LOADING ── */}
          {stage === "loading" && (
            <div className="auth-wrap" style={{textAlign: "center", paddingTop: 80}}>
              <div className="spinner" style={{width: 40, height: 40, borderWidth: 3, margin: "0 auto 20px"}}></div>
              <p style={{color: COLORS.textMuted}}>Loading your profile...</p>
            </div>
          )}

          {/* ── NEW PROFILE FLOW ── */}
          {stage === "new-profile" && (
            <div>
              <div className="profile-header">
                <h1 className="profile-greeting">Let's build your profile.</h1>
                <p className="profile-email">We'll use your resume to get started, then you can refine everything.</p>
              </div>

              {error && <div className="error-msg">{error}</div>}

              {!parsedSuggestions && (
                <div className="section-card">
                  <div className="section-header">
                    <span className="section-title">Upload Your Resume</span>
                  </div>
                  {parsing ? (
                    <div style={{textAlign: "center", padding: "40px 0"}}>
                      <div className="spinner" style={{width: 32, height: 32, borderWidth: 3, margin: "0 auto 16px"}}></div>
                      <p style={{color: COLORS.textMuted}}>Claude is reading your resume and matching your skills...</p>
                    </div>
                  ) : (
                    <label>
                      <div
                        className="upload-zone"
                        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("drag-over"); }}
                        onDragLeave={e => e.currentTarget.classList.remove("drag-over")}
                        onDrop={e => {
                          e.preventDefault();
                          e.currentTarget.classList.remove("drag-over");
                          handleResumeUpload(e.dataTransfer.files[0]);
                        }}
                      >
                        <div className="upload-icon">📄</div>
                        <div className="upload-text">
                          <strong>Drop your resume here</strong><br/>
                          or click to browse — PDF or text file
                        </div>
                      </div>
                      <input type="file" accept=".pdf,.txt,.doc,.docx" style={{display:"none"}} onChange={e => handleResumeUpload(e.target.files[0])} />
                    </label>
                  )}
                </div>
              )}

              {parsedSuggestions && (
                <>
                  <div className="info-msg">
                    ✓ Resume parsed. Review what we found and add anything we missed.
                  </div>

                  <div className="section-card">
                    <div className="section-header"><span className="section-title">Primary Skills</span></div>
                    <SkillSelector
                      label="Primary Skills"
                      selected={profile.primarySkills}
                      options={primaryOptions}
                      onChange={v => setProfile(p => ({...p, primarySkills: v}))}
                      editing={true}
                    />
                  </div>

                  <div className="section-card">
                    <div className="section-header"><span className="section-title">Secondary Skills</span></div>
                    <SkillSelector
                      label="Secondary Skills"
                      selected={profile.secondarySkills}
                      options={secondaryOptions}
                      onChange={v => setProfile(p => ({...p, secondarySkills: v}))}
                      editing={true}
                    />
                  </div>

                  <div className="section-card">
                    <div className="section-header"><span className="section-title">Technology Skills</span></div>
                    <SkillSelector
                      label="Tech Skills"
                      selected={profile.techSkills}
                      options={techOptions}
                      onChange={v => setProfile(p => ({...p, techSkills: v}))}
                      editing={true}
                    />
                  </div>

                  <div className="section-card">
                    <div className="section-header"><span className="section-title">Availability</span></div>
                    <div className="skill-tags">
                      {hoursOptions.map(h => (
                        <button
                          key={h}
                          className={profile.hours.includes(h) ? "skill-tag" : "skill-option"}
                          onClick={() => setProfile(p => ({
                            ...p,
                            hours: p.hours.includes(h)
                              ? p.hours.filter(x => x !== h)
                              : [...p.hours, h]
                          }))}
                          style={{cursor:"pointer", border:"none"}}
                        >
                          {profile.hours.includes(h) ? "✓ " : "+ "}{h}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="section-card">
                    <div className="section-header"><span className="section-title">Additional Details</span></div>
                    <div className="field-group">
                      <label className="field-label">Preferred Hourly Rate</label>
                      <div className="rate-input-wrap">
                        <span className="rate-prefix">$</span>
                        <input
                          className="rate-input"
                          type="number"
                          min="0"
                          placeholder="65"
                          value={profile.rate}
                          onChange={e => setProfile(p => ({...p, rate: e.target.value}))}
                        />
                        <span className="rate-suffix">/hr</span>
                      </div>
                    </div>
                    <div className="field-group" style={{marginBottom:0}}>
                      <label className="field-label">Education</label>
                      <input className="field-input" placeholder="Degree, field of study" value={profile.education} onChange={e => setProfile(p => ({...p, education: e.target.value}))} />
                    </div>
                  </div>

                  <button className="btn btn-primary" onClick={handleSaveProfile} disabled={saving} style={{marginBottom: 80}}>
                    {saving ? <><span className="spinner"></span> Saving...</> : "Save My Profile"}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── EXISTING PROFILE ── */}
          {stage === "profile" && obm && (
            <div style={{paddingBottom: editing ? 80 : 0}}>
              <div className="profile-header">
                <h1 className="profile-greeting">
                  {obm.fields["Full Name"] || obm.fields["Name"] || email.split("@")[0]}
                </h1>
                <p className="profile-email">{email}</p>
              </div>

              {error && <div className="error-msg">{error}</div>}

              <div className="tab-nav">
                <button className={`tab-btn ${activeTab === "profile" ? "active" : ""}`} onClick={() => setActiveTab("profile")}>My Profile</button>
                <button className={`tab-btn ${activeTab === "roles" ? "active" : ""}`} onClick={() => setActiveTab("roles")}>
                  My Roles {matchingRoles.length > 0 && `(${matchingRoles.length})`}
                </button>
              </div>

              {/* Profile Tab */}
              {activeTab === "profile" && (
                <>
                  <div style={{display:"flex", justifyContent:"flex-end", marginBottom: 16}}>
                    {!editing ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(true); setEditMode(null); }}>Edit Profile</button>
                    ) : editMode === null ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setEditMode(null); setParsedSuggestions(null); }}>Cancel</button>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditMode(null)}>← Back</button>
                    )}
                  </div>

                  {/* Edit mode chooser */}
                  {editing && editMode === null && (
                    <div className="section-card" style={{marginBottom: 24}}>
                      <div className="section-header"><span className="section-title">How would you like to update your skills?</span></div>
                      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12}}>
                        <button
                          onClick={() => setEditMode("resume")}
                          style={{
                            padding:"20px 16px", border:"1.5px solid #E0E1E1", borderRadius:8,
                            background:"#F1F2F2", cursor:"pointer", textAlign:"left",
                            transition:"all 0.2s"
                          }}
                          onMouseOver={e => { e.currentTarget.style.borderColor="#7FBFB8"; e.currentTarget.style.background="#E8F4F3"; }}
                          onMouseOut={e => { e.currentTarget.style.borderColor="#E0E1E1"; e.currentTarget.style.background="#F1F2F2"; }}
                        >
                          <div style={{fontSize:24, marginBottom:8}}>📄</div>
                          <div style={{fontFamily:"Raleway, sans-serif", fontWeight:600, fontSize:13, marginBottom:4}}>Upload Resume</div>
                          <div style={{fontSize:12, color:"#6B6B6B", lineHeight:1.4}}>Claude reads your resume and suggests skills automatically</div>
                        </button>
                        <button
                          onClick={() => setEditMode("manual")}
                          style={{
                            padding:"20px 16px", border:"1.5px solid #E0E1E1", borderRadius:8,
                            background:"#F1F2F2", cursor:"pointer", textAlign:"left",
                            transition:"all 0.2s"
                          }}
                          onMouseOver={e => { e.currentTarget.style.borderColor="#7FBFB8"; e.currentTarget.style.background="#E8F4F3"; }}
                          onMouseOut={e => { e.currentTarget.style.borderColor="#E0E1E1"; e.currentTarget.style.background="#F1F2F2"; }}
                        >
                          <div style={{fontSize:24, marginBottom:8}}>✏️</div>
                          <div style={{fontFamily:"Raleway, sans-serif", fontWeight:600, fontSize:13, marginBottom:4}}>Edit Manually</div>
                          <div style={{fontSize:12, color:"#6B6B6B", lineHeight:1.4}}>Browse skills by category and add or remove individually</div>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Resume upload mode */}
                  {editing && editMode === "resume" && !parsedSuggestions && (
                    <div className="section-card" style={{marginBottom: 24}}>
                      <div className="section-header"><span className="section-title">Upload Your Resume</span></div>
                      {parsing ? (
                        <div style={{textAlign:"center", padding:"40px 0"}}>
                          <div className="spinner" style={{width:32, height:32, borderWidth:3, margin:"0 auto 16px"}}></div>
                          <p style={{color:"#6B6B6B"}}>Claude is reading your resume...</p>
                        </div>
                      ) : (
                        <label>
                          <div className="upload-zone"
                            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("drag-over"); }}
                            onDragLeave={e => e.currentTarget.classList.remove("drag-over")}
                            onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove("drag-over"); handleResumeUpload(e.dataTransfer.files[0]); }}
                          >
                            <div className="upload-icon">📄</div>
                            <div className="upload-text"><strong>Drop your resume here</strong><br/>or click to browse — PDF or text file</div>
                          </div>
                          <input type="file" accept=".pdf,.txt,.doc,.docx" style={{display:"none"}} onChange={e => handleResumeUpload(e.target.files[0])} />
                        </label>
                      )}
                    </div>
                  )}

                  {/* After resume parsed — show confirmation */}
                  {editing && editMode === "resume" && parsedSuggestions && (
                    <div className="info-msg" style={{marginBottom:16}}>
                      ✓ Resume parsed. Review and confirm your skills below, then save.
                      <button onClick={() => setParsedSuggestions(null)} style={{marginLeft:12, background:"none", border:"none", color:"#5EA8A1", cursor:"pointer", fontSize:13, textDecoration:"underline"}}>Re-upload</button>
                    </div>
                  )}

                  {/* Skills — show always in view, only editable in manual/resume mode */}
                  <div className="section-card">
                    <div className="section-header"><span className="section-title">Primary Skills</span></div>
                    <SkillSelector label="Primary Skills" selected={profile.primarySkills} options={primaryOptions} onChange={v => setProfile(p => ({...p, primarySkills: v}))} editing={editing && (editMode === "manual" || (editMode === "resume" && !!parsedSuggestions))} />
                  </div>

                  <div className="section-card">
                    <div className="section-header"><span className="section-title">Secondary Skills</span></div>
                    <SkillSelector label="Secondary Skills" selected={profile.secondarySkills} options={secondaryOptions} onChange={v => setProfile(p => ({...p, secondarySkills: v}))} editing={editing && (editMode === "manual" || (editMode === "resume" && !!parsedSuggestions))} />
                  </div>

                  <div className="section-card">
                    <div className="section-header"><span className="section-title">Technology Skills</span></div>
                    <TechSelector selected={profile.techSkills} options={techOptions} onChange={v => setProfile(p => ({...p, techSkills: v}))} editing={editing && (editMode === "manual" || (editMode === "resume" && !!parsedSuggestions))} />
                  </div>

                  <div className="section-card">
                    <div className="section-header"><span className="section-title">Availability</span></div>
                    {(editing && editMode === "manual") ? (
                      <div className="skill-tags">
                        {hoursOptions.map(h => (
                          <button key={h} className={profile.hours.includes(h) ? "skill-tag" : "skill-option"}
                            onClick={() => setProfile(p => ({...p, hours: p.hours.includes(h) ? p.hours.filter(x => x !== h) : [...p.hours, h]}))}
                            style={{cursor:"pointer", border:"none"}}>
                            {profile.hours.includes(h) ? "✓ " : "+ "}{h}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="skill-tags">
                        {profile.hours.length ? profile.hours.map(h => <span key={h} className="skill-tag">{h}</span>) : <span className="empty-state">Not set</span>}
                      </div>
                    )}
                  </div>

                  <div className="section-card">
                    <div className="section-header"><span className="section-title">Details</span></div>
                    {(editing && editMode === "manual") ? (
                      <>
                        <div className="field-group">
                          <label className="field-label">Preferred Hourly Rate</label>
                          <div className="rate-input-wrap">
                            <span className="rate-prefix">$</span>
                            <input
                              className="rate-input"
                              type="number"
                              min="0"
                              placeholder="65"
                              value={profile.rate}
                              onChange={e => setProfile(p => ({...p, rate: e.target.value}))}
                            />
                            <span className="rate-suffix">/hr</span>
                          </div>
                        </div>
                        <div className="field-group" style={{marginBottom:0}}>
                          <label className="field-label">Education</label>
                          <input className="field-input" value={profile.education} onChange={e => setProfile(p => ({...p, education: e.target.value}))} />
                        </div>
                      </>
                    ) : (
                      <div style={{display:"grid", gap: 12}}>
                        {[
                          ["Rate", profile.rate ? `$${profile.rate}/hr` : ""],
                          ["Education", profile.education],
                        ].map(([label, val]) => (
                          <div key={label} style={{display:"flex", gap: 16, alignItems:"baseline"}}>
                            <span style={{fontSize:12, textTransform:"uppercase", letterSpacing:"0.08em", color: COLORS.textDim, width: 90, flexShrink:0}}>{label}</span>
                            <span style={{fontSize:14, color: val ? COLORS.text : COLORS.textDim}}>{val || "Not set"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Roles Tab */}
              {activeTab === "roles" && (
                <div>
                  {matchingRoles.length === 0 ? (
                    <div className="section-card" style={{textAlign:"center", padding: "48px 24px"}}>
                      <div style={{fontSize: 32, marginBottom: 12}}>🔍</div>
                      <p style={{color: COLORS.textMuted, fontSize: 15}}>No roles yet. When Prowess matches you to an opportunity, it will appear here.</p>
                    </div>
                  ) : (
                    matchingRoles.map(role => (
                      <div key={role.id} className="role-card">
                        <div>
                          <div className="role-name">
                            {role.fields["Client Name"] || role.fields["Role Title"] || "Ops Partner Role"}
                          </div>
                          <div className="role-meta">
                            {role.fields["Industry"] || ""}
                            {role.fields[F_MATCH_SCORE] ? ` · ${role.fields[F_MATCH_SCORE]}% match` : ""}
                            {role.createdTime ? ` · Sent ${new Date(role.createdTime).toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric"})}` : ""}
                          </div>
                        </div>
                        <StatusBadge status={role.fields[F_MATCH_STATUS]} />
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </main>

        {/* Save bar */}
        {editing && editMode !== null && stage === "profile" && (
          <div className="save-bar">
            {saveSuccess && <span className="text-success">✓ Profile saved</span>}
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-primary" style={{width:"auto"}} onClick={handleSaveProfile} disabled={saving}>
              {saving ? <><span className="spinner"></span> Saving...</> : "Save Changes"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
