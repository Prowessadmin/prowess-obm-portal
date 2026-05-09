import { useState, useEffect } from "react";

// ── Airtable config ──────────────────────────────────────────────
const AIRTABLE_BASE = "appaOBVteWvtxFcKr";
const TBL_PM_PROFILE     = "tbl9I3xX3zj9b7FqX";
const TBL_MATCHING       = "tblIoFOOL5BShC3bg";
const TBL_PRIMARY_SKILLS = "tbll8MKHuKiM7YciK";
const TBL_SECONDARY_SKILLS = "tbljqaeAndASfnyc0";
const TBL_TECH_SKILLS    = "tbliJ5Q4yU0m8EnsG";
const F_MATCH_STATUS     = "fldmcFMJQ5uPCCrsE";
const F_MATCH_SCORE      = "fldxXrk9SIv1O8I44";
const F_RATE             = "fldalR2oEciMrDMec";
const F_RATE_TEXT        = "fldJS9eWEInztKDx9";

async function airtableFetch(path, opts = {}) {
  const isGet = !opts.method || opts.method === "GET";
  let proxyUrl;
  if (isGet) {
    const [basePath, queryPart] = path.split("?");
    const proxyParams = new URLSearchParams({ path: basePath });
    if (queryPart) new URLSearchParams(queryPart).forEach((v, k) => proxyParams.append(k, v));
    proxyUrl = `/.netlify/functions/airtable?${proxyParams.toString()}`;
  } else {
    const [basePath] = path.split("?");
    proxyUrl = `/.netlify/functions/airtable?path=${encodeURIComponent(basePath)}`;
  }
  const res = await fetch(proxyUrl, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json" },
    ...(opts.body ? { body: opts.body } : {}),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Airtable error ${res.status}: ${err}`); }
  return res.json();
}

async function findOBMByEmail(email) {
  const enc = encodeURIComponent(`{emai2}="${email}"`);
  const data = await airtableFetch(`/${TBL_PM_PROFILE}?filterByFormula=${enc}&maxRecords=1`);
  return data.records?.[0] || null;
}

async function getMatchingRecords(pmRecordId) {
  const formula = `FIND("${pmRecordId}", ARRAYJOIN({PM Profile}, ","))`;
  const enc = encodeURIComponent(formula);
  const data = await airtableFetch(`/${TBL_MATCHING}?filterByFormula=${enc}&sort[0][field]=Created&sort[0][direction]=desc`);
  return data.records || [];
}

async function getSkillTable(tableId, nameField) {
  const data = await airtableFetch(`/${tableId}?maxRecords=200`);
  return (data.records || []).map(r => ({ id: r.id, name: r.fields[nameField] || "" })).filter(s => {
    if (!s.name) return false;
    if (/^[0-9a-f]{20,}$/i.test(s.name.trim())) return false;
    if (/^[0-9]+$/.test(s.name.trim())) return false;
    return true;
  });
}

async function updateOBMProfile(recordId, profile) {
  const rateNum = profile.rate !== "" && profile.rate !== null ? parseFloat(profile.rate) : null;
  const fields = {
    "Primary-Secondary Skills Algo": profile.primarySkills.map(s => s.id),
    "Secondary Skills Algo": profile.secondarySkills.map(s => s.id),
    "Technology skills Algo": profile.techSkills.map(s => s.id),
    "Availability Hours": profile.hours,
    "Notes": profile.notes,
    ...(rateNum !== null && { "Rate": rateNum }),
    ...(profile.rate && { "What is your preferred hourly rate?": String(profile.rate) }),
  };
  Object.keys(fields).forEach(k => {
    if (fields[k] === "" || fields[k] === null || fields[k] === undefined) delete fields[k];
    if (Array.isArray(fields[k]) && fields[k].length === 0) delete fields[k];
  });
  return airtableFetch(`/${TBL_PM_PROFILE}/${recordId}`, { method: "PATCH", body: JSON.stringify({ fields }) });
}

async function claudeParseResume(resumeText, primarySkills, secondarySkills, techSkills) {
  const res = await fetch("/.netlify/functions/claude-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: `You are a resume parser for Prowess Project. Extract skills from resumes and match them to provided taxonomies.
Return ONLY valid JSON. No markdown, no explanation.
Format: {"primarySkills": ["skill1"], "secondarySkills": ["skill2"], "techSkills": ["tool1"], "rate": "suggested rate if mentioned"}`,
      messages: [{
        role: "user",
        content: `Parse this resume and match skills to these exact taxonomies:
PRIMARY SKILLS TAXONOMY: ${primarySkills.map(s => s.name).join(", ")}
SECONDARY SKILLS TAXONOMY: ${secondarySkills.map(s => s.name).join(", ")}
TECH SKILLS TAXONOMY: ${techSkills.map(s => s.name).join(", ")}
Rules:
- Only return skills that exist in the taxonomy or are clearly equivalent
- For tech: skip proprietary, niche, legacy, or rarely-used software
- Match common equivalents (e.g. "G Suite" = "Google Workspace")
RESUME:
${resumeText.slice(0, 8000)}`
      }]
    })
  });
  const data = await res.json();
  const text = data.content?.[0]?.text || "{}";
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    const matchSkill = (name, options) => options.find(o => o.name.trim().toLowerCase() === name.trim().toLowerCase());
    return {
      primarySkills: (parsed.primarySkills || []).map(n => matchSkill(n, primarySkills)).filter(Boolean),
      secondarySkills: (parsed.secondarySkills || []).map(n => matchSkill(n, secondarySkills)).filter(Boolean),
      techSkills: (parsed.techSkills || []).map(n => matchSkill(n, techSkills)).filter(Boolean),
      rate: parsed.rate || "",
    };
  } catch {
    return { primarySkills: [], secondarySkills: [], techSkills: [], rate: "" };
  }
}

const COLORS = {
  bg: "#FFFFFF", surface: "#F1F2F2", card: "#FFFFFF",
  border: "#E0E1E1", accent: "#7FBFB8", accentDark: "#5EA8A1", accentLight: "#E8F4F3",
  coral: "#F15D60", coralLight: "#FEF0F0",
  text: "#1A1A1A", textMuted: "#6B6B6B", textDim: "#A0A0A0",
  white: "#FFFFFF",
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;500;600;700&family=DM+Sans:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #FFFFFF; color: #1A1A1A; font-family: 'DM Sans', Helvetica, sans-serif; min-height: 100vh; }
  .portal-wrap { min-height: 100vh; display: flex; flex-direction: column; position: relative; overflow-x: hidden; }
  .portal-wrap::before { content: ''; position: fixed; top: -120px; right: -120px; width: 480px; height: 480px; border-radius: 50%; background: radial-gradient(circle, #E8F4F3 0%, transparent 65%); pointer-events: none; z-index: 0; }
  .portal-wrap::after { content: ''; position: fixed; bottom: -140px; left: -140px; width: 420px; height: 420px; border-radius: 50%; background: radial-gradient(circle, rgba(241,93,96,0.05) 0%, transparent 65%); pointer-events: none; z-index: 0; }
  .portal-header { padding: 16px 40px; border-bottom: 1px solid #E0E1E1; display: flex; align-items: center; justify-content: space-between; background: #FFFFFF; position: relative; z-index: 10; }
  .portal-main { flex: 1; padding: 48px 40px; max-width: 860px; margin: 0 auto; width: 100%; position: relative; z-index: 1; }
  .logo { font-family: 'Raleway', sans-serif; font-size: 13px; font-weight: 700; color: #1A1A1A; letter-spacing: 0.14em; text-transform: uppercase; line-height: 1.2; }
  .logo-sub { font-family: 'DM Sans', sans-serif; font-size: 10px; color: #7FBFB8; letter-spacing: 0.2em; text-transform: uppercase; margin-top: 3px; font-weight: 500; }
  .portal-hero { background: #7FBFB8; padding: 64px 40px 56px; text-align: center; position: relative; overflow: hidden; }
  .portal-hero::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-image: radial-gradient(circle, rgba(255,255,255,0.15) 1.5px, transparent 1.5px); background-size: 24px 24px; pointer-events: none; }
  .portal-hero::after { content: ''; position: absolute; top: -80px; right: -80px; width: 320px; height: 320px; border-radius: 50%; background: rgba(255,255,255,0.06); pointer-events: none; }
  .hero-circle-left { position: absolute; bottom: -60px; left: -60px; width: 220px; height: 220px; border-radius: 50%; background: rgba(255,255,255,0.06); pointer-events: none; }
  .hero-circle-mid { position: absolute; top: 20px; left: 12%; width: 80px; height: 80px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.2); pointer-events: none; }
  .hero-title { font-family: 'Raleway', sans-serif; font-size: 32px; font-weight: 700; color: #FFFFFF; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 10px; position: relative; z-index: 1; }
  .hero-sub { font-size: 15px; color: rgba(255,255,255,0.8); font-weight: 300; letter-spacing: 0.04em; position: relative; z-index: 1; }
  .auth-wrap { max-width: 440px; margin: 0 auto; }
  .auth-title { font-family: 'Raleway', sans-serif; font-size: 28px; font-weight: 700; color: #1A1A1A; margin-bottom: 8px; }
  .auth-subtitle { color: #6B6B6B; font-size: 15px; margin-bottom: 36px; line-height: 1.6; }
  .field-group { margin-bottom: 20px; }
  .field-label { display: block; font-family: 'Raleway', sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #6B6B6B; margin-bottom: 8px; }
  .field-input { width: 100%; background: #FFFFFF; border: 1.5px solid #E0E1E1; border-radius: 6px; padding: 12px 14px; color: #1A1A1A; font-family: 'DM Sans', sans-serif; font-size: 15px; transition: border-color 0.2s, box-shadow 0.2s; outline: none; }
  .field-input:focus { border-color: #7FBFB8; box-shadow: 0 0 0 3px #E8F4F3; }
  .field-input::placeholder { color: #A0A0A0; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 24px; border-radius: 6px; font-family: 'Raleway', sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; border: none; outline: none; }
  .btn-primary { background: #7FBFB8; color: #FFFFFF; width: 100%; }
  .btn-primary:hover { background: #5EA8A1; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-ghost { background: transparent; border: 1.5px solid #E0E1E1; color: #6B6B6B; }
  .btn-ghost:hover { border-color: #7FBFB8; color: #7FBFB8; }
  .btn-sm { padding: 8px 16px; font-size: 11px; }
  .error-msg { background: #FEF0F0; border: 1px solid rgba(241,93,96,0.3); color: #F15D60; padding: 12px 16px; border-radius: 6px; font-size: 14px; margin-bottom: 16px; }
  .info-msg { background: #E8F4F3; border: 1px solid rgba(127,191,184,0.4); color: #5EA8A1; padding: 12px 16px; border-radius: 6px; font-size: 14px; margin-bottom: 16px; line-height: 1.5; }
  .profile-header { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid #E0E1E1; }
  .profile-greeting { font-family: 'Raleway', sans-serif; font-size: 26px; font-weight: 700; color: #1A1A1A; margin-bottom: 4px; }
  .profile-email { color: #6B6B6B; font-size: 14px; }
  .tab-nav { display: flex; gap: 0; margin-bottom: 28px; border-bottom: 2px solid #E0E1E1; }
  .tab-btn { padding: 12px 24px; background: transparent; border: none; border-bottom: 2px solid transparent; color: #6B6B6B; font-family: 'Raleway', sans-serif; font-size: 12px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; margin-bottom: -2px; }
  .tab-btn.active { color: #7FBFB8; border-bottom-color: #7FBFB8; }
  .tab-btn:hover:not(.active) { color: #1A1A1A; }
  .section-card { background: #FFFFFF; border: 1px solid #E0E1E1; border-radius: 8px; padding: 24px; margin-bottom: 16px; }
  .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .section-title { font-family: 'Raleway', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #6B6B6B; }
  .skill-tags { display: flex; flex-wrap: wrap; gap: 8px; }
  .skill-tag { background: #E8F4F3; border: 1px solid rgba(127,191,184,0.4); color: #1F5C58; padding: 6px 12px; border-radius: 20px; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
  .skill-tag-new { background: #7FBFB8; border: 1px solid #5EA8A1; color: #FFFFFF; padding: 6px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .skill-tag-remove { background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; font-size: 16px; line-height: 1; padding: 0; display: flex; align-items: center; }
  .skill-tag-remove:hover { color: #FFFFFF; }
  .skill-tag-remove-muted { background: none; border: none; color: #3D8A85; cursor: pointer; font-size: 16px; line-height: 1; padding: 0; display: flex; align-items: center; }
  .skill-tag-remove-muted:hover { color: #F15D60; }
  .skill-option { background: #F1F2F2; border: 1px solid #E0E1E1; color: #6B6B6B; padding: 6px 12px; border-radius: 20px; font-size: 13px; cursor: pointer; transition: all 0.15s; font-family: 'DM Sans', sans-serif; }
  .skill-option:hover { border-color: #7FBFB8; color: #7FBFB8; background: #E8F4F3; }
  .empty-state { color: #A0A0A0; font-size: 14px; font-style: italic; }
  .role-card { background: #FFFFFF; border: 1px solid #E0E1E1; border-radius: 8px; padding: 20px 24px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 16px; transition: border-color 0.2s; }
  .role-card:hover { border-color: #7FBFB8; }
  .role-name { font-family: 'Raleway', sans-serif; font-size: 15px; font-weight: 600; color: #1A1A1A; margin-bottom: 4px; }
  .role-meta { font-size: 13px; color: #6B6B6B; }
  .status-badge { padding: 5px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; font-family: 'Raleway', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; flex-shrink: 0; }
  .status-identified { background: #E8F4F3; color: #1F5C58; border: 1px solid rgba(127,191,184,0.4); }
  .status-awaiting { background: #FFF8EC; color: #8A5E1A; border: 1px solid rgba(176,125,42,0.3); }
  .status-hired { background: #E8F4F3; color: #1F5C58; border: 1px solid rgba(127,191,184,0.5); }
  .status-other { background: #F1F2F2; color: #6B6B6B; border: 1px solid #E0E1E1; }
  .upload-zone { border: 2px dashed #E0E1E1; border-radius: 8px; padding: 48px 24px; text-align: center; cursor: pointer; transition: all 0.2s; background: #F1F2F2; }
  .upload-zone:hover, .upload-zone.drag-over { border-color: #7FBFB8; background: #E8F4F3; }
  .upload-icon { font-size: 36px; margin-bottom: 14px; }
  .upload-text { color: #6B6B6B; font-size: 14px; line-height: 1.6; }
  .upload-text strong { color: #7FBFB8; }
  .spinner { width: 20px; height: 20px; border: 2px solid rgba(127,191,184,0.2); border-top-color: #7FBFB8; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .teal-bar { height: 4px; background: #7FBFB8; width: 100%; }
  .save-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #FFFFFF; border-top: 1px solid #E0E1E1; padding: 16px 40px; display: flex; align-items: center; justify-content: flex-end; gap: 12px; z-index: 100; box-shadow: 0 -4px 16px rgba(0,0,0,0.06); }
  .text-success { color: #7FBFB8; font-size: 14px; font-weight: 500; }
  .rate-input-wrap { display: flex; align-items: center; border: 1.5px solid #E0E1E1; border-radius: 6px; background: #FFFFFF; overflow: hidden; transition: border-color 0.2s, box-shadow 0.2s; }
  .rate-input-wrap:focus-within { border-color: #7FBFB8; box-shadow: 0 0 0 3px #E8F4F3; }
  .rate-prefix, .rate-suffix { padding: 12px; background: #F1F2F2; color: #6B6B6B; font-size: 15px; font-weight: 500; border: none; white-space: nowrap; user-select: none; }
  .rate-prefix { border-right: 1px solid #E0E1E1; }
  .rate-suffix { border-left: 1px solid #E0E1E1; }
  .rate-input { flex: 1; background: transparent; border: none; padding: 12px 10px; color: #1A1A1A; font-family: 'DM Sans', sans-serif; font-size: 15px; outline: none; min-width: 0; }
  .suggestion-card { background: #FFFFFF; border: 2px solid #7FBFB8; border-radius: 8px; padding: 24px; margin-bottom: 16px; }
  .suggestion-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .suggestion-title { font-family: 'Raleway', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #7FBFB8; }
  .suggestion-count { background: #7FBFB8; color: #FFFFFF; font-family: 'Raleway', sans-serif; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 10px; letter-spacing: 0.06em; }
  .action-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
  .btn-teal-outline { background: transparent; border: 1.5px solid #7FBFB8; color: #5EA8A1; padding: 10px 18px; border-radius: 6px; font-family: 'Raleway', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; }
  .btn-teal-outline:hover { background: #E8F4F3; }
  .btn-teal-solid { background: #7FBFB8; border: none; color: #FFFFFF; padding: 10px 18px; border-radius: 6px; font-family: 'Raleway', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; }
  .btn-teal-solid:hover { background: #5EA8A1; }
`;

const SKILL_CATEGORIES = {
  "Operations & Strategy": ["Project Management","Process Improvement","Strategic planning","Resource Management","Corporate Operations","Risk management","Capacity Planning","Quality Assurance","Reporting","Document Management & Compliance Tracking","Meeting Management","Technical Project Management","Business Analysis","Research ","Scheduling","Executive Assistance","Agile ","Agile","Scrum","Grant writing"],
  "Finance & Accounting": ["Accounting","Bookkeeping","Budgeting","Financial Analytics","Financial reporting/modeling","Forecasting","Invoicing","Payroll management","Procurement","Mergers & Acquisitions ","Mergers & Acquisitions","Workers Compensation","Benefits Administration"],
  "People & HR": ["Human relations","Recruiting","Talent acquisition","Onboarding","Training","Employee Relations","Performance Management","Team communications"],
  "Sales & Marketing": ["CRM management","Lead generation","Marketing automation","Digital marketing","Content creation","Social media","B2B marketing","SEO/SEM ","Copywriting","Copy writing","Branding","Account management","Customer Success","Customer service","Inside sales","Outside sales","Enterprise sales","Demand generation","Partnerships","Product marketing","Event marketing/planning","Public relations strategy","Media Planner","Help desk"],
  "Technology & Data": ["Data analytics","Data science","Database management","System/tech Implementations","AI & Automation Fluency","Web design","UIUX","Mobile app development","Front end development","Backend development","Devops","DevOps","Technical writing","Product development","Ecommerce Operations","Inventory management","Supply chain "],
  "Other": [],
};

const TECH_CATEGORIES = {
  "AI & Automation": ["ChatGPT","Claude","CoPilot","Gemini","Perplexity","Zapier","API","AWS","Azure"],
  "Project Management": ["Asana","ClickUp","Monday","Notion","Trello","Jira","Smartsheets","Podio","Airtable"],
  "CRM & Marketing": ["GoHighLevel","HighLevel","Salesforce","Pipedrive","Zendesk CRM","Hubspot","Active Campaign","Mailchimp","Marketo","Manychat","Facebook Ads","Hootsuite","Planable","Planoly","Linkedin Navigator","Click Funnel (or similar)","ClickFunnel","Leadpages","Dubsado","Honeybook","Kajabi"],
  "Finance & Accounting": ["Quickbooks Online","Quickbooks Desktop","Quickbooks Enterprise","Xero","Gusto","ADP","Double/Keeper","TaxDome","Greenhouse"],
  "Communication & Docs": ["Slack","Zoom","Google Docs","Google Sheets","Gsuite","Microsoft Office (MS 365)","Word","Excel","Sharepoint","Github","Descript (or other podcast editing)"],
  "Design & Web": ["Canva","Adobe Suites","Wordpress","WIX","Shopify","HTML, CSS"],
  "Development": [".NET","AJAX","Android ","Angular ","Blockchain","DB2","Docker","IBM i","JSON","Java ","Javascript ","Jquery","Linux ","MongoDB","MySQL","NoSQL","Node.js","PHP","PWA","Perl","PostgreSQL","Python","REST","Ruby","SOAP","Scala","Websockets","Windows","iOS","90.io"],
  "Other Tech": [],
};

function categorizeSkill(name) {
  for (const [cat, skills] of Object.entries(SKILL_CATEGORIES)) {
    if (cat === "Other") continue;
    if (skills.some(s => s.trim().toLowerCase() === name.trim().toLowerCase())) return cat;
  }
  return "Other";
}

function categorizeTech(name) {
  for (const [cat, tools] of Object.entries(TECH_CATEGORIES)) {
    if (cat === "Other Tech") continue;
    if (tools.some(t => t.trim().toLowerCase() === name.trim().toLowerCase())) return cat;
  }
  return "Other Tech";
}

function StatusBadge({ status }) {
  const map = {
    "Candidate Identified": ["status-identified", "Identified"],
    "Awaiting Response": ["status-awaiting", "Awaiting Response"],
    "response yes": ["status-identified", "Applied"],
    "Passed": ["status-identified", "Moved Forward"],
    "Hired": ["status-hired", "Placed ✓"],
    "not a match": ["status-other", "Not Moved Forward"],
    "Pending Final Assessments": ["status-awaiting", "In Review"],
    "Profile & Scoring Complete": ["status-awaiting", "Scoring Complete"],
  };
  const [cls, label] = map[status] || ["status-other", status || "Unknown"];
  return <span className={`status-badge ${cls}`}>{label}</span>;
}

// ── Resume Suggestions Review ─────────────────────────────────────
function SuggestionReview({ suggestions, currentProfile, onAddToExisting, onReplaceAll, onStartManual, onReupload }) {
  const [selected, setSelected] = useState({
    primarySkills: [...suggestions.primarySkills],
    secondarySkills: [...suggestions.secondarySkills],
    techSkills: [...suggestions.techSkills],
  });

  const toggle = (field, skill) => {
    const has = selected[field].some(s => s.id === skill.id);
    setSelected(prev => ({
      ...prev,
      [field]: has ? prev[field].filter(s => s.id !== skill.id) : [...prev[field], skill],
    }));
  };

  const totalFound = suggestions.primarySkills.length + suggestions.secondarySkills.length + suggestions.techSkills.length;
  const totalSelected = selected.primarySkills.length + selected.secondarySkills.length + selected.techSkills.length;

  const sections = [
    { key: "primarySkills", label: "Primary Skills", skills: suggestions.primarySkills },
    { key: "secondarySkills", label: "Secondary Skills", skills: suggestions.secondarySkills },
    { key: "techSkills", label: "Technology Skills", skills: suggestions.techSkills },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ background: "#E8F4F3", border: "1px solid rgba(127,191,184,0.4)", borderRadius: 8, padding: "16px 20px", marginBottom: 24 }}>
        <div style={{ fontFamily: "Raleway, sans-serif", fontWeight: 700, fontSize: 14, color: "#1F5C58", marginBottom: 4 }}>
          ✓ Claude found {totalFound} skill{totalFound !== 1 ? "s" : ""} on your resume
        </div>
        <div style={{ fontSize: 13, color: "#5EA8A1", lineHeight: 1.5 }}>
          Review what was found below. Tap any skill to deselect it. Then choose how to apply them to your profile.
        </div>
      </div>

      {/* Skill sections */}
      {sections.map(({ key, label, skills }) => (
        <div key={key} className="suggestion-card">
          <div className="suggestion-header">
            <span className="suggestion-title">{label}</span>
            <span className="suggestion-count">{skills.length} found</span>
          </div>
          {skills.length === 0 ? (
            <span className="empty-state">None found on your resume</span>
          ) : (
            <div className="skill-tags">
              {skills.map(skill => {
                const isSelected = selected[key].some(s => s.id === skill.id);
                return (
                  <button
                    key={skill.id}
                    onClick={() => toggle(key, skill)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600,
                      cursor: "pointer", border: "none", transition: "all 0.15s",
                      background: isSelected ? "#7FBFB8" : "#F1F2F2",
                      color: isSelected ? "#FFFFFF" : "#A0A0A0",
                      textDecoration: isSelected ? "none" : "line-through",
                    }}
                  >
                    {isSelected ? "✓" : "✕"} {skill.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {/* Action buttons */}
      <div style={{ background: "#FAFAFA", border: "1px solid #E0E1E1", borderRadius: 8, padding: 20, marginBottom: 16 }}>
        <div style={{ fontFamily: "Raleway, sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6B6B6B", marginBottom: 14 }}>
          How would you like to apply these {totalSelected} skill{totalSelected !== 1 ? "s" : ""}?
        </div>
        <div className="action-row">
          <button className="btn-teal-solid" onClick={() => onAddToExisting(selected)}>
            ＋ Add to my existing skills
          </button>
          <button className="btn-teal-outline" onClick={() => onReplaceAll(selected)}>
            Replace all my skills
          </button>
          <button
            onClick={onStartManual}
            style={{ background: "none", border: "none", color: "#A0A0A0", fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: "10px 4px" }}>
            Skip — edit manually instead
          </button>
        </div>
      </div>

      <button onClick={onReupload} style={{ background: "none", border: "none", color: "#A0A0A0", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
        Upload a different resume
      </button>
    </div>
  );
}

// ── Categorized skill selector ────────────────────────────────────
function SkillSelector({ label, selected, options, onChange, editing }) {
  const [search, setSearch] = useState("");
  const [expandedCat, setExpandedCat] = useState(null);
  const selectedSet = new Set(selected.map(s => s.id));
  const grouped = {};
  options.forEach(o => {
    if (selectedSet.has(o.id)) return;
    const cat = categorizeSkill(o.name);
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
            {editing && <button className="skill-tag-remove-muted" onClick={() => onChange(selected.filter(x => x.id !== s.id))}>×</button>}
          </span>
        ))}
        {!selected.length && !editing && <span className="empty-state">No {label.toLowerCase()} added yet</span>}
      </div>
      {editing && (
        <div>
          <input className="field-input" style={{ marginBottom: 16, marginTop: 8 }} placeholder={`Search ${label.toLowerCase()}...`} value={search} onChange={e => { setSearch(e.target.value); setExpandedCat(null); }} />
          {search.length > 1 ? (
            <div className="skill-tags">
              {searchResults.slice(0, 15).map(o => <button key={o.id} className="skill-option" onClick={() => { onChange([...selected, o]); setSearch(""); }}>+ {o.name}</button>)}
              {!searchResults.length && <span className="empty-state">No matches for "{search}"</span>}
            </div>
          ) : (
            <div>
              {Object.entries(grouped).filter(([, s]) => s.length > 0).map(([cat, skills]) => (
                <div key={cat} style={{ marginBottom: 12 }}>
                  <button onClick={() => setExpandedCat(expandedCat === cat ? null : cat)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", padding: "8px 0", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B6B6B" }}>{cat} ({skills.length})</span>
                    <span style={{ color: "#7FBFB8", fontSize: 18, lineHeight: 1 }}>{expandedCat === cat ? "−" : "+"}</span>
                  </button>
                  {expandedCat === cat && (
                    <div className="skill-tags" style={{ paddingTop: 8, paddingBottom: 8 }}>
                      {skills.map(o => <button key={o.id} className="skill-option" onClick={() => onChange([...selected, o])}>+ {o.name}</button>)}
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
            {editing && <button className="skill-tag-remove-muted" onClick={() => onChange(selected.filter(x => x.id !== s.id))}>×</button>}
          </span>
        ))}
        {!selected.length && !editing && <span className="empty-state">No tech skills added yet</span>}
      </div>
      {editing && (
        <div>
          <input className="field-input" style={{ marginBottom: 16, marginTop: 8 }} placeholder="Search technology..." value={search} onChange={e => { setSearch(e.target.value); setExpandedCat(null); }} />
          {search.length > 1 ? (
            <div className="skill-tags">
              {searchResults.slice(0, 15).map(o => <button key={o.id} className="skill-option" onClick={() => { onChange([...selected, o]); setSearch(""); }}>+ {o.name}</button>)}
              {!searchResults.length && <span className="empty-state">No matches for "{search}"</span>}
            </div>
          ) : (
            <div>
              {Object.entries(grouped).filter(([, t]) => t.length > 0).map(([cat, tools]) => (
                <div key={cat} style={{ marginBottom: 12 }}>
                  <button onClick={() => setExpandedCat(expandedCat === cat ? null : cat)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", padding: "8px 0", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B6B6B" }}>{cat} ({tools.length})</span>
                    <span style={{ color: "#7FBFB8", fontSize: 18, lineHeight: 1 }}>{expandedCat === cat ? "−" : "+"}</span>
                  </button>
                  {expandedCat === cat && (
                    <div className="skill-tags" style={{ paddingTop: 8, paddingBottom: 8 }}>
                      {tools.map(o => <button key={o.id} className="skill-option" onClick={() => onChange([...selected, o])}>+ {o.name}</button>)}
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

// ── Main App ──────────────────────────────────────────────────────
export default function OBMPortal() {
  const [stage, setStage] = useState("email");
  const [email, setEmail] = useState("");
  const [obm, setObm] = useState(null);
  const [matchingRoles, setMatchingRoles] = useState([]);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("profile");
  const [editing, setEditing] = useState(false);
  const [editMode, setEditMode] = useState(null); // null | "resume" | "resume-review" | "manual"
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [primaryOptions, setPrimaryOptions] = useState([]);
  const [secondaryOptions, setSecondaryOptions] = useState([]);
  const [techOptions, setTechOptions] = useState([]);
  const [profile, setProfile] = useState({ primarySkills: [], secondarySkills: [], techSkills: [], hours: [], rate: "", notes: "" });
  const [parsedSuggestions, setParsedSuggestions] = useState(null);
  const [parsing, setParsing] = useState(false);
  const hoursOptions = ["5 hours per week", "10 hours per week", "20 hours per week", "30 hours per week"];

  useEffect(() => {
    Promise.all([
      getSkillTable(TBL_PRIMARY_SKILLS, "Skill Name"),
      getSkillTable(TBL_SECONDARY_SKILLS, "Label"),
      getSkillTable(TBL_TECH_SKILLS, "Tech name"),
    ]).then(([p, s, t]) => { setPrimaryOptions(p); setSecondaryOptions(s); setTechOptions(t); })
      .catch(e => console.error("Failed to load skill taxonomy:", e));
  }, []);

  async function handleEmailSubmit() {
    setError("");
    if (!email.trim() || !email.includes("@")) { setError("Please enter a valid email address."); return; }
    setStage("loading");
    try {
      const record = await findOBMByEmail(email.toLowerCase().trim());
      if (record) {
        setObm(record);
        const roles = await getMatchingRecords(record.id);
        setMatchingRoles(roles);
        const f = record.fields;
        const primaryIds = new Set(f["Primary-Secondary Skills Algo"] || []);
        const secondaryIds = new Set(f["Secondary Skills Algo"] || []);
        const techIds = new Set(f["Technology skills Algo"] || []);
        setProfile({
          primarySkills: primaryOptions.filter(o => primaryIds.has(o.id)),
          secondarySkills: secondaryOptions.filter(o => secondaryIds.has(o.id)),
          techSkills: techOptions.filter(o => techIds.has(o.id)),
          hours: f["Availability Hours"] || [],
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
      setStage("email");
    }
  }

  async function handleResumeUpload(file) {
    if (!file) return;
    setParsing(true);
    try {
      const text = await file.text();
      const suggestions = await claudeParseResume(text, primaryOptions, secondaryOptions, techOptions);
      setParsedSuggestions(suggestions);
      setEditMode("resume-review");
    } catch (e) {
      setError("Could not parse resume. Please select your skills manually below.");
    } finally {
      setParsing(false);
    }
  }

  function handleAddToExisting(selected) {
    // Merge suggestions with existing — no duplicates
    const mergeUnique = (existing, additions) => {
      const ids = new Set(existing.map(s => s.id));
      return [...existing, ...additions.filter(s => !ids.has(s.id))];
    };
    setProfile(p => ({
      ...p,
      primarySkills: mergeUnique(p.primarySkills, selected.primarySkills),
      secondarySkills: mergeUnique(p.secondarySkills, selected.secondarySkills),
      techSkills: mergeUnique(p.techSkills, selected.techSkills),
    }));
    setParsedSuggestions(null);
    setEditMode("manual");
  }

  function handleReplaceAll(selected) {
    setProfile(p => ({
      ...p,
      primarySkills: selected.primarySkills,
      secondarySkills: selected.secondarySkills,
      techSkills: selected.techSkills,
    }));
    setParsedSuggestions(null);
    setEditMode("manual");
  }

  async function handleSaveProfile() {
    setSaving(true);
    setSaveSuccess(false);
    setError("");
    try {
      let recordId = obm?.id;
      if (!recordId) {
        const record = await findOBMByEmail(email.toLowerCase().trim());
        if (!record) { setError("Profile record not found. Please contact Prowess support."); setSaving(false); return; }
        setObm(record);
        recordId = record.id;
      }
      await updateOBMProfile(recordId, profile);
      setSaveSuccess(true);
      setEditing(false);
      setEditMode(null);
      setParsedSuggestions(null);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (e) {
      setError("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  function resetEdit() {
    setEditing(false);
    setEditMode(null);
    setParsedSuggestions(null);
    setError("");
  }

  return (
    <>
      <style>{css}</style>
      <div className="portal-wrap">
        <header className="portal-header">
          <div>
            <div className="logo">Prowess Project</div>
            <div className="logo-sub">OBM Profile Portal</div>
          </div>
          {obm && <button className="btn btn-ghost btn-sm" onClick={() => { setStage("email"); setObm(null); setEmail(""); resetEdit(); }}>Sign Out</button>}
        </header>
        <div className="teal-bar"></div>

        <main className="portal-main">

          {/* EMAIL */}
          {stage === "email" && (
            <>
              <div className="portal-hero">
                <div className="hero-circle-left"></div>
                <div className="hero-circle-mid"></div>
                <div className="hero-title">OBM Profile Portal</div>
                <div className="hero-sub">Manage your profile and track your matched opportunities</div>
              </div>
              <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 40px" }}>
                <div className="auth-wrap">
                  <h1 className="auth-title">Sign In</h1>
                  <p className="auth-subtitle">Enter the email address associated with your Prowess OBM profile.</p>
                  {error && <div className="error-msg">{error}</div>}
                  <div className="field-group">
                    <label className="field-label">Email Address</label>
                    <input className="field-input" type="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleEmailSubmit()} autoFocus />
                  </div>
                  <button className="btn btn-primary" onClick={handleEmailSubmit}>Access My Profile</button>
                </div>
              </div>
            </>
          )}

          {/* LOADING */}
          {stage === "loading" && (
            <div style={{ textAlign: "center", paddingTop: 80 }}>
              <div className="spinner" style={{ width: 40, height: 40, borderWidth: 3, margin: "0 auto 20px" }}></div>
              <p style={{ color: "#6B6B6B" }}>Loading your profile...</p>
            </div>
          )}

          {/* PROFILE */}
          {stage === "profile" && obm && (
            <div style={{ paddingBottom: editing && editMode !== null ? 80 : 0 }}>
              <div className="profile-header">
                <h1 className="profile-greeting">{obm.fields["Full Name"] || obm.fields["Name"] || email.split("@")[0]}</h1>
                <p className="profile-email">{email}</p>
              </div>
              {error && <div className="error-msg">{error}</div>}

              <div className="tab-nav">
                <button className={`tab-btn ${activeTab === "profile" ? "active" : ""}`} onClick={() => setActiveTab("profile")}>My Profile</button>
                <button className={`tab-btn ${activeTab === "roles" ? "active" : ""}`} onClick={() => setActiveTab("roles")}>My Roles {matchingRoles.length > 0 && `(${matchingRoles.length})`}</button>
              </div>

              {activeTab === "profile" && (
                <>
                  {/* Top nav buttons */}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
                    {!editing ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(true); setEditMode(null); }}>Edit Profile</button>
                    ) : editMode === null ? (
                      <button className="btn btn-ghost btn-sm" onClick={resetEdit}>Cancel</button>
                    ) : editMode === "resume-review" ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditMode("resume"); setParsedSuggestions(null); }}>← Back</button>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditMode(null)}>← Back</button>
                    )}
                  </div>

                  {/* Mode chooser */}
                  {editing && editMode === null && (
                    <div className="section-card" style={{ marginBottom: 24 }}>
                      <div className="section-header"><span className="section-title">How would you like to update your profile?</span></div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        {[
                          { mode: "resume", icon: "📄", title: "Upload Resume", desc: "Claude reads your resume and suggests skills to add" },
                          { mode: "manual", icon: "✏️", title: "Edit Manually", desc: "Browse skills by category and add or remove individually" },
                        ].map(({ mode, icon, title, desc }) => (
                          <button key={mode} onClick={() => setEditMode(mode)}
                            style={{ padding: "20px 16px", border: "1.5px solid #E0E1E1", borderRadius: 8, background: "#F1F2F2", cursor: "pointer", textAlign: "left", transition: "all 0.2s" }}
                            onMouseOver={e => { e.currentTarget.style.borderColor = "#7FBFB8"; e.currentTarget.style.background = "#E8F4F3"; }}
                            onMouseOut={e => { e.currentTarget.style.borderColor = "#E0E1E1"; e.currentTarget.style.background = "#F1F2F2"; }}>
                            <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
                            <div style={{ fontFamily: "Raleway, sans-serif", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{title}</div>
                            <div style={{ fontSize: 12, color: "#6B6B6B", lineHeight: 1.4 }}>{desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Resume upload */}
                  {editing && editMode === "resume" && (
                    <div className="section-card" style={{ marginBottom: 24 }}>
                      <div className="section-header"><span className="section-title">Upload Your Resume</span></div>
                      {parsing ? (
                        <div style={{ textAlign: "center", padding: "40px 0" }}>
                          <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3, margin: "0 auto 16px" }}></div>
                          <p style={{ color: "#6B6B6B" }}>Claude is reading your resume...</p>
                        </div>
                      ) : (
                        <label>
                          <div className="upload-zone"
                            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("drag-over"); }}
                            onDragLeave={e => e.currentTarget.classList.remove("drag-over")}
                            onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove("drag-over"); handleResumeUpload(e.dataTransfer.files[0]); }}>
                            <div className="upload-icon">📄</div>
                            <div className="upload-text"><strong>Drop your resume here</strong><br />or click to browse — PDF or text file</div>
                          </div>
                          <input type="file" accept=".pdf,.txt,.doc,.docx" style={{ display: "none" }} onChange={e => handleResumeUpload(e.target.files[0])} />
                        </label>
                      )}
                    </div>
                  )}

                  {/* Resume review */}
                  {editing && editMode === "resume-review" && parsedSuggestions && (
                    <SuggestionReview
                      suggestions={parsedSuggestions}
                      currentProfile={profile}
                      onAddToExisting={handleAddToExisting}
                      onReplaceAll={handleReplaceAll}
                      onStartManual={() => { setParsedSuggestions(null); setEditMode("manual"); }}
                      onReupload={() => { setParsedSuggestions(null); setEditMode("resume"); }}
                    />
                  )}

                  {/* Skills view — always visible, editable in manual mode */}
                  {(editMode !== "resume-review") && (
                    <>
                      <div className="section-card">
                        <div className="section-header"><span className="section-title">Primary Skills</span></div>
                        <SkillSelector label="Primary Skills" selected={profile.primarySkills} options={primaryOptions} onChange={v => setProfile(p => ({ ...p, primarySkills: v }))} editing={editing && editMode === "manual"} />
                      </div>
                      <div className="section-card">
                        <div className="section-header"><span className="section-title">Secondary Skills</span></div>
                        <SkillSelector label="Secondary Skills" selected={profile.secondarySkills} options={secondaryOptions} onChange={v => setProfile(p => ({ ...p, secondarySkills: v }))} editing={editing && editMode === "manual"} />
                      </div>
                      <div className="section-card">
                        <div className="section-header"><span className="section-title">Technology Skills</span></div>
                        <TechSelector selected={profile.techSkills} options={techOptions} onChange={v => setProfile(p => ({ ...p, techSkills: v }))} editing={editing && editMode === "manual"} />
                      </div>
                      <div className="section-card">
                        <div className="section-header"><span className="section-title">Availability</span></div>
                        {editing && editMode === "manual" ? (
                          <div className="skill-tags">
                            {hoursOptions.map(h => (
                              <button key={h} className={profile.hours.includes(h) ? "skill-tag" : "skill-option"}
                                onClick={() => setProfile(p => ({ ...p, hours: p.hours.includes(h) ? p.hours.filter(x => x !== h) : [...p.hours, h] }))}
                                style={{ cursor: "pointer", border: "none" }}>
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
                        {editing && editMode === "manual" ? (
                          <div className="field-group" style={{ marginBottom: 0 }}>
                            <label className="field-label">Preferred Hourly Rate</label>
                            <div className="rate-input-wrap">
                              <span className="rate-prefix">$</span>
                              <input className="rate-input" type="number" min="0" placeholder="65" value={profile.rate} onChange={e => setProfile(p => ({ ...p, rate: e.target.value }))} />
                              <span className="rate-suffix">/hr</span>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
                            <span style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#A0A0A0", width: 90, flexShrink: 0 }}>Rate</span>
                            <span style={{ fontSize: 14, color: profile.rate ? "#1A1A1A" : "#A0A0A0" }}>{profile.rate ? `$${profile.rate}/hr` : "Not set"}</span>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}

              {activeTab === "roles" && (
                <div>
                  {matchingRoles.length === 0 ? (
                    <div className="section-card" style={{ textAlign: "center", padding: "48px 24px" }}>
                      <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
                      <p style={{ color: "#6B6B6B", fontSize: 15 }}>No roles yet. When Prowess matches you to an opportunity, it will appear here.</p>
                    </div>
                  ) : (
                    matchingRoles.map(role => (
                      <div key={role.id} className="role-card">
                        <div>
                          <div className="role-name">{role.fields["Client Name"] || role.fields["Role Title"] || "Ops Partner Role"}</div>
                          <div className="role-meta">
                            {role.fields["Industry"] || ""}
                            {role.fields[F_MATCH_SCORE] ? ` · ${role.fields[F_MATCH_SCORE]}% match` : ""}
                            {role.createdTime ? ` · Sent ${new Date(role.createdTime).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
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

        {editing && editMode === "manual" && stage === "profile" && (
          <div className="save-bar">
            {saveSuccess && <span className="text-success">✓ Profile saved</span>}
            <button className="btn btn-ghost" onClick={resetEdit}>Cancel</button>
            <button className="btn btn-primary" style={{ width: "auto" }} onClick={handleSaveProfile} disabled={saving}>
              {saving ? <><span className="spinner"></span> Saving...</> : "Save Changes"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
