import { useState, useEffect } from "react";

// ── Config ───────────────────────────────────────────────────────
const BASE = "appaOBVteWvtxFcKr";
const AT_URL = `https://api.airtable.com/v0/${BASE}`;

// Tables
const TBL_PM       = "tbl9I3xX3zj9b7FqX";
const TBL_MATCHING = "tblIoFOOL5BShC3bg";
const TBL_PRIMARY  = "tbll8MKHuKiM7YciK";
const TBL_SECONDARY= "tbljqaeAndASfnyc0";
const TBL_TECH     = "tbliJ5Q4yU0m8EnsG";

// PM Profile field names (as they appear in Airtable)
const F_EMAIL      = "emai2";
const F_PRIMARY    = "Primary-Secondary Skills Algo";
const F_SECONDARY  = "Secondary Skills Algo";
const F_TECH       = "Technology skills Algo";
const F_HOURS      = "Availability Hours";
const F_RATE       = "Rate";
const F_RATE_TEXT  = "What is your preferred hourly rate?";
const F_NOTES      = "Notes";

// PM Profile extra fields
const F_DISC_PRIMARY   = "fld7ONyQ5vTA5pyI0";
const F_DISC_SECONDARY = "fld8CjQJ8XpY0NmbH";
const F_VARK           = "fldV3Z9O2N8pXRUVe";
const F_PHOTO          = "fldc5TYw5ZfYlsvjy"; // Profile pic

// Matching field IDs
const F_MATCH_STATUS = "fldmcFMJQ5uPCCrsE";
const F_MATCH_SCORE  = "fldxXrk9SIv1O8I44";

// ── Airtable direct fetch (via Netlify proxy to keep key server-side) ──
async function atFetch(path, opts = {}) {
  const isWrite = opts.method && opts.method !== "GET";

  if (isWrite) {
    // Writes go through proxy as POST with method in body
    const [basePath] = path.split("?");
    const res = await fetch("/.netlify/functions/airtable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: opts.method,
        path: basePath,
        body: opts.body ? JSON.parse(opts.body) : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${JSON.stringify(data)}`);
    return data;
  } else {
    // Reads go through proxy as GET with path in query
    const [basePath, qp] = path.split("?");
    const params = new URLSearchParams({ path: basePath });
    if (qp) new URLSearchParams(qp).forEach((v, k) => params.append(k, v));
    const res = await fetch(`/.netlify/functions/airtable?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${JSON.stringify(data)}`);
    return data;
  }
}

// ── Airtable helpers ─────────────────────────────────────────────
async function findByEmail(email) {
  const enc = encodeURIComponent(`{${F_EMAIL}}="${email}"`);
  const d = await atFetch(`/${TBL_PM}?filterByFormula=${enc}&maxRecords=1`);
  return d.records?.[0] || null;
}

async function getMatches(pmId) {
  const f = encodeURIComponent(`FIND("${pmId}", ARRAYJOIN({PM Profile}, ","))`);
  const d = await atFetch(`/${TBL_MATCHING}?filterByFormula=${f}&sort[0][field]=Created&sort[0][direction]=desc`);
  return d.records || [];
}

async function getSkills(tableId, nameField) {
  const d = await atFetch(`/${tableId}?maxRecords=200`);
  return (d.records || [])
    .map(r => ({ id: r.id, name: (r.fields[nameField] || "").trim() }))
    .filter(s => s.name && !/^[0-9a-f]{20,}$/i.test(s.name) && !/^[0-9]+$/.test(s.name));
}

async function saveProfile(recordId, profile) {
  const rate = profile.rate !== "" ? parseFloat(profile.rate) : null;
  const fields = {
    [F_PRIMARY]:   profile.primarySkills.map(s => s.id),
    [F_SECONDARY]: profile.secondarySkills.map(s => s.id),
    [F_TECH]:      profile.techSkills.map(s => s.id),
    [F_HOURS]:     profile.hours,
    ...(rate !== null && !isNaN(rate) && { [F_RATE]: rate }),
    ...(profile.rate && { [F_RATE_TEXT]: String(profile.rate) }),
  };
  // Remove empty arrays
  Object.keys(fields).forEach(k => {
    if (Array.isArray(fields[k]) && fields[k].length === 0) delete fields[k];
  });
  return atFetch(`/${TBL_PM}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

// ── Claude resume parser ─────────────────────────────────────────
async function parseResume(text, pOpts, sOpts, tOpts) {
  const res = await fetch("/.netlify/functions/claude-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: `You are a resume skills extractor for Prowess Project OBM matching system.
Read the resume and return two things:
1. The most clearly demonstrated skills — max 5 per category (primary, secondary, tech)
2. In-demand OBM skills NOT clearly shown — worth asking about — max 3 per category

Return ONLY valid JSON — no markdown, no preamble.
Format: {
  "foundSkills": {
    "primarySkills": ["exact name from taxonomy"],
    "secondarySkills": ["exact name from taxonomy"],
    "techSkills": ["exact name from taxonomy"]
  },
  "maybeSkills": {
    "primarySkills": ["exact name from taxonomy"],
    "secondarySkills": ["exact name from taxonomy"],
    "techSkills": ["exact name from taxonomy"]
  },
  "rate": ""
}`,
      messages: [{
        role: "user",
        content: `Read this resume. Return found skills (clearly demonstrated) and maybe skills (common OBM skills not shown).

FOUND SKILLS — infer from job descriptions and responsibilities, not just explicit skill lists:
- "managed projects" → Project Management (primary)
- "oversaw budgets" → Budgeting (primary)
- "led a team" → Resource Management, Team communications (primary)
- "ran social media campaigns" → Social media, Content creation, Digital marketing (primary)
- "used QuickBooks/Xero" → that tool (tech)
- "used Slack/Zoom/Google Workspace" → those tools (tech)
- Max 5 per category. Only include if CONFIDENT.
- Skills can appear in BOTH primary and secondary if appropriate.

MAYBE SKILLS — in-demand OBM skills NOT already in foundSkills, worth asking about:
- Primary/Secondary examples: Project Management, Process Improvement, Strategic planning, CRM management, Reporting, Team communications, Scheduling, Onboarding, Customer Success, Risk management, Training, Recruiting
- Tech examples: ClickUp, Asana, GoHighLevel, Airtable, Zapier, Slack, Zoom, Quickbooks Online, Canva, Google Docs, Google Sheets — only suggest tools NOT mentioned on resume
- Max 3 per category. Choose the most in-demand for online business managers.

Copy ALL skill names EXACTLY as they appear in the taxonomies below.

PRIMARY SKILLS TAXONOMY: ${pOpts.map(s => s.name).join(" | ")}
SECONDARY SKILLS TAXONOMY: ${sOpts.map(s => s.name).join(" | ")}
TECH SKILLS TAXONOMY: ${tOpts.map(s => s.name).join(" | ")}

RESUME:
${text.slice(0, 8000)}`
      }]
    })
  });
  const data = await res.json();
  const raw = data.content?.[0]?.text || "{}";
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    const match = (name, opts) => opts.find(o => o.name.toLowerCase() === name.trim().toLowerCase());
    const mapSkills = (obj, pO, sO, tO) => ({
      primarySkills:   ((obj||{}).primarySkills   || []).map(n => match(n, pO)).filter(Boolean),
      secondarySkills: ((obj||{}).secondarySkills || []).map(n => match(n, sO)).filter(Boolean),
      techSkills:      ((obj||{}).techSkills      || []).map(n => match(n, tO)).filter(Boolean),
    });
    const found = parsed.foundSkills || parsed;
    const maybe = parsed.maybeSkills || {};
    return {
      found: mapSkills(found, pOpts, sOpts, tOpts),
      maybe: mapSkills(maybe, pOpts, sOpts, tOpts),
      rate: parsed.rate || "",
    };
  } catch {
    return { found: { primarySkills:[], secondarySkills:[], techSkills:[] }, maybe: { primarySkills:[], secondarySkills:[], techSkills:[] }, rate: "" };
  }
}


// ── PDF text extraction ──────────────────────────────────────────
async function extractText(file) {
  if (file.type === "application/pdf") {
    try {
      if (!window.pdfjsLib) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(x => x.str).join(" ") + "\n";
      }
      console.log("PDF extracted:", text.length, "chars");
      return text;
    } catch (e) {
      console.error("PDF.js failed:", e);
    }
  }
  return file.text();
}

// ── Skill categories ─────────────────────────────────────────────
const SKILL_CATS = {
  "Operations & Strategy": ["Project Management","Process Improvement","Strategic planning","Resource Management","Corporate Operations","Risk management","Capacity Planning","Quality Assurance","Reporting","Document Management & Compliance Tracking","Meeting Management","Technical Project Management","Business Analysis","Research ","Scheduling","Executive Assistance","Agile ","Agile","Scrum","Grant writing"],
  "Finance & Accounting": ["Accounting","Bookkeeping","Budgeting","Financial Analytics","Financial reporting/modeling","Forecasting","Invoicing","Payroll management","Procurement","Mergers & Acquisitions ","Mergers & Acquisitions","Workers Compensation","Benefits Administration"],
  "People & HR": ["Human relations","Recruiting","Talent acquisition","Onboarding","Training","Employee Relations","Performance Management","Team communications"],
  "Sales & Marketing": ["CRM management","Lead generation","Marketing automation","Digital marketing","Content creation","Social media","B2B marketing","SEO/SEM ","Copywriting","Copy writing","Branding","Account management","Customer Success","Customer service","Inside sales","Outside sales","Enterprise sales","Demand generation","Partnerships","Product marketing","Event marketing/planning","Public relations strategy","Media Planner","Help desk"],
  "Technology & Data": ["Data analytics","Data science","Database management","System/tech Implementations","AI & Automation Fluency","Web design","UIUX","Mobile app development","Front end development","Backend development","Devops","DevOps","Technical writing","Product development","Ecommerce Operations","Inventory management","Supply chain "],
  "Other": [],
};
const TECH_CATS = {
  "AI & Automation": ["ChatGPT","Claude","CoPilot","Gemini","Perplexity","Zapier","API","AWS","Azure"],
  "Project Management": ["Asana","ClickUp","Monday","Notion","Trello","Jira","Smartsheets","Podio","Airtable"],
  "CRM & Marketing": ["GoHighLevel","HighLevel","Salesforce","Pipedrive","Zendesk CRM","Hubspot","Active Campaign","Mailchimp","Marketo","Manychat","Facebook Ads","Hootsuite","Planable","Planoly","Linkedin Navigator","Click Funnel (or similar)","ClickFunnel","Leadpages","Dubsado","Honeybook","Kajabi"],
  "Finance & Accounting": ["Quickbooks Online","Quickbooks Desktop","Quickbooks Enterprise","Xero","Gusto","ADP","Double/Keeper","TaxDome","Greenhouse"],
  "Communication & Docs": ["Slack","Zoom","Google Docs","Google Sheets","Gsuite","Microsoft Office (MS 365)","Word","Excel","Sharepoint","Github","Descript (or other podcast editing)"],
  "Design & Web": ["Canva","Adobe Suites","Wordpress","WIX","Shopify","HTML, CSS"],
  "Development": [".NET","AJAX","Android ","Angular ","Blockchain","DB2","Docker","IBM i","JSON","Java ","Javascript ","Jquery","Linux ","MongoDB","MySQL","NoSQL","Node.js","PHP","PWA","Perl","PostgreSQL","Python","REST","Ruby","SOAP","Scala","Websockets","Windows","iOS","90.io"],
  "Other Tech": [],
};
const catOf = (name, map) => {
  for (const [cat, list] of Object.entries(map)) {
    if (cat.startsWith("Other")) continue;
    if (list.some(s => s.trim().toLowerCase() === name.trim().toLowerCase())) return cat;
  }
  return Object.keys(map).at(-1);
};

// ── CSS ──────────────────────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=Raleway:wght@400;600;700&family=DM+Sans:wght@300;400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#fff;color:#1A1A1A;font-family:'DM Sans',sans-serif;min-height:100vh}
.wrap{min-height:100vh;display:flex;flex-direction:column}
.wrap::before{content:'';position:fixed;top:-120px;right:-120px;width:480px;height:480px;border-radius:50%;background:radial-gradient(circle,#E8F4F3 0%,transparent 65%);pointer-events:none;z-index:0}
.hdr{padding:16px 40px;border-bottom:1px solid #E0E1E1;display:flex;align-items:center;justify-content:space-between;background:#fff;position:relative;z-index:10}
.logo{font-family:'Raleway',sans-serif;font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
.logo-sub{font-size:10px;color:#7FBFB8;letter-spacing:.2em;text-transform:uppercase;margin-top:3px}
.teal-bar{height:4px;background:#7FBFB8}
.main{flex:1;padding:48px 40px;max-width:860px;margin:0 auto;width:100%;position:relative;z-index:1}
.hero{background:#7FBFB8;padding:64px 40px 56px;text-align:center;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background-image:radial-gradient(circle,rgba(255,255,255,.15) 1.5px,transparent 1.5px);background-size:24px 24px;pointer-events:none}
.hero-title{font-family:'Raleway',sans-serif;font-size:32px;font-weight:700;color:#fff;letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px;position:relative;z-index:1}
.hero-sub{font-size:15px;color:rgba(255,255,255,.8);font-weight:300;position:relative;z-index:1}
.auth{max-width:440px;margin:48px auto 0}
.auth-title{font-family:'Raleway',sans-serif;font-size:28px;font-weight:700;margin-bottom:8px}
.auth-sub{color:#6B6B6B;font-size:15px;margin-bottom:36px;line-height:1.6}
.fl{font-family:'Raleway',sans-serif;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#6B6B6B;margin-bottom:8px;display:block}
.fi{width:100%;background:#fff;border:1.5px solid #E0E1E1;border-radius:6px;padding:12px 14px;font-family:'DM Sans',sans-serif;font-size:15px;outline:none;transition:border-color .2s,box-shadow .2s}
.fi:focus{border-color:#7FBFB8;box-shadow:0 0 0 3px #E8F4F3}
.fi::placeholder{color:#A0A0A0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 24px;border-radius:6px;font-family:'Raleway',sans-serif;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;border:none;outline:none;transition:all .2s}
.btn-p{background:#7FBFB8;color:#fff;width:100%}
.btn-p:hover{background:#5EA8A1}
.btn-p:disabled{opacity:.5;cursor:not-allowed}
.btn-g{background:transparent;border:1.5px solid #E0E1E1;color:#6B6B6B}
.btn-g:hover{border-color:#7FBFB8;color:#7FBFB8}
.btn-sm{padding:8px 16px;font-size:11px}
.err{background:#FEF0F0;border:1px solid rgba(241,93,96,.3);color:#F15D60;padding:12px 16px;border-radius:6px;font-size:14px;margin-bottom:16px}
.info{background:#E8F4F3;border:1px solid rgba(127,191,184,.4);color:#5EA8A1;padding:12px 16px;border-radius:6px;font-size:14px;margin-bottom:16px;line-height:1.5}
.warn{background:#FFF8EC;border:1px solid rgba(176,125,42,.3);color:#8A5E1A;padding:16px 20px;border-radius:8px;margin-bottom:20px}
.warn strong{display:block;font-weight:700;margin-bottom:6px;font-size:14px}
.warn p{font-size:13px;line-height:1.6}
.ph{margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid #E0E1E1}
.pg{font-family:'Raleway',sans-serif;font-size:26px;font-weight:700;margin-bottom:4px}
.pe{color:#6B6B6B;font-size:14px}
.tabs{display:flex;margin-bottom:28px;border-bottom:2px solid #E0E1E1}
.tab{padding:12px 24px;background:transparent;border:none;border-bottom:2px solid transparent;color:#6B6B6B;font-family:'Raleway',sans-serif;font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;margin-bottom:-2px;transition:all .2s}
.tab.on{color:#7FBFB8;border-bottom-color:#7FBFB8}
.card{background:#fff;border:1px solid #E0E1E1;border-radius:8px;padding:24px;margin-bottom:16px}
.card.ed{border-color:#7FBFB8;background:#FAFFFE}
.ch{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.ct{font-family:'Raleway',sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6B6B6B}
.ct.on{color:#5EA8A1}
.tags{display:flex;flex-wrap:wrap;gap:8px}
.tag{background:#E8F4F3;border:1px solid rgba(127,191,184,.4);color:#1F5C58;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:4px}
.tag-e{background:#7FBFB8;border:1px solid #5EA8A1;color:#fff;padding:6px 10px 6px 14px;border-radius:20px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}
.del{background:rgba(0,0,0,.2);border:none;color:#fff;cursor:pointer;font-size:13px;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s}
.del:hover{background:rgba(241,93,96,.8)}
.opt{background:#fff;border:1.5px solid #C8C9CA;color:#4A4A4A;padding:6px 12px;border-radius:20px;font-size:13px;cursor:pointer;transition:all .15s;font-family:'DM Sans',sans-serif}
.opt:hover{border-color:#7FBFB8;color:#1F5C58;background:#E8F4F3}
.sug{background:#7FBFB8;border:1px solid #5EA8A1;color:#fff;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all .15s}
.sug.off{background:#F1F2F2;border-color:#C8C9CA;color:#A0A0A0;text-decoration:line-through}
.empty{color:#A0A0A0;font-size:14px;font-style:italic}
.div-lbl{font-size:11px;font-family:'Raleway',sans-serif;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#A0A0A0;margin:16px 0 10px;display:flex;align-items:center;gap:8px}
.div-lbl::before,.div-lbl::after{content:'';flex:1;height:1px;background:#E0E1E1}
.legend{display:flex;gap:16px;align-items:center;margin-bottom:12px;padding:10px 14px;background:#F8FFFE;border:1px solid rgba(127,191,184,.2);border-radius:6px}
.li{display:flex;align-items:center;gap:6px;font-size:12px;color:#6B6B6B}
.dot-t{width:10px;height:10px;border-radius:50%;background:#7FBFB8;flex-shrink:0}
.dot-g{width:10px;height:10px;border-radius:50%;background:#C8C9CA;flex-shrink:0}
.upload-zone{border:2px dashed #E0E1E1;border-radius:8px;padding:48px 24px;text-align:center;cursor:pointer;transition:all .2s;background:#F1F2F2}
.upload-zone:hover,.upload-zone.over{border-color:#7FBFB8;background:#E8F4F3}
.upload-icon{font-size:36px;margin-bottom:14px}
.upload-txt{color:#6B6B6B;font-size:14px;line-height:1.6}
.upload-txt strong{color:#7FBFB8}
.spin{width:20px;height:20px;border:2px solid rgba(127,191,184,.2);border-top-color:#7FBFB8;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.save-bar{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #E0E1E1;padding:16px 40px;display:flex;align-items:center;justify-content:flex-end;gap:12px;z-index:100;box-shadow:0 -4px 16px rgba(0,0,0,.06)}
.ok{color:#7FBFB8;font-size:14px;font-weight:500}
.rate-wrap{display:flex;align-items:center;border:1.5px solid #E0E1E1;border-radius:6px;background:#fff;overflow:hidden}
.rate-wrap:focus-within{border-color:#7FBFB8;box-shadow:0 0 0 3px #E8F4F3}
.rate-fix{padding:12px;background:#F1F2F2;color:#6B6B6B;font-size:15px;font-weight:500;border:none;white-space:nowrap;user-select:none}
.rate-l{border-right:1px solid #E0E1E1}
.rate-r{border-left:1px solid #E0E1E1}
.rate-in{flex:1;background:transparent;border:none;padding:12px 10px;font-family:'DM Sans',sans-serif;font-size:15px;outline:none;min-width:0}
.role-card{background:#fff;border:1px solid #E0E1E1;border-radius:8px;padding:20px 24px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:16px;transition:border-color .2s}
.role-card:hover{border-color:#7FBFB8}
.rn{font-family:'Raleway',sans-serif;font-size:15px;font-weight:600;margin-bottom:4px}
.rm{font-size:13px;color:#6B6B6B}
.badge{padding:5px 12px;border-radius:20px;font-size:11px;font-weight:600;font-family:'Raleway',sans-serif;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;flex-shrink:0}
.b-id{background:#E8F4F3;color:#1F5C58;border:1px solid rgba(127,191,184,.4)}
.b-w{background:#FFF8EC;color:#8A5E1A;border:1px solid rgba(176,125,42,.3)}
.b-h{background:#E8F4F3;color:#1F5C58;border:1px solid rgba(127,191,184,.5)}
.b-o{background:#F1F2F2;color:#6B6B6B;border:1px solid #E0E1E1}
.sug-card{background:#fff;border:2px solid #7FBFB8;border-radius:8px;padding:24px;margin-bottom:16px}
.sug-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.sug-lbl{font-family:'Raleway',sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#5EA8A1}
.sug-cnt{background:#7FBFB8;color:#fff;font-family:'Raleway',sans-serif;font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px}
.act-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}
.btn-ts{background:#7FBFB8;border:none;color:#fff;padding:10px 18px;border-radius:6px;font-family:'Raleway',sans-serif;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .2s}
.btn-ts:hover{background:#5EA8A1}
.btn-to{background:transparent;border:1.5px solid #7FBFB8;color:#5EA8A1;padding:10px 18px;border-radius:6px;font-family:'Raleway',sans-serif;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .2s}
.btn-to:hover{background:#E8F4F3}
.mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.mode-btn{padding:20px 16px;border:1.5px solid #E0E1E1;border-radius:8px;background:#F1F2F2;cursor:pointer;text-align:left;transition:all .2s}
.mode-btn:hover{border-color:#7FBFB8;background:#E8F4F3}
.mode-icon{font-size:24px;margin-bottom:8px}
.mode-title{font-family:'Raleway',sans-serif;font-weight:600;font-size:13px;margin-bottom:4px}
.mode-desc{font-size:12px;color:#6B6B6B;line-height:1.4}
`;

// ── Status badge ─────────────────────────────────────────────────
function Badge({ s }) {
  const map = {
    "Candidate Identified": ["b-id","Identified"],
    "Awaiting Response":    ["b-w","Awaiting Response"],
    "response yes":         ["b-id","Applied"],
    "Passed":               ["b-id","Moved Forward"],
    "Hired":                ["b-h","Placed ✓"],
    "not a match":          ["b-o","Not Moved Forward"],
    "Pending Final Assessments": ["b-w","In Review"],
    "Profile & Scoring Complete": ["b-w","Scoring Complete"],
  };
  const [cls, lbl] = map[s] || ["b-o", s || "Unknown"];
  return <span className={`badge ${cls}`}>{lbl}</span>;
}

// ── Suggestion review screen (two-step) ──────────────────────────
function SugReview({ sug, step, onStepChange, onAdd, onReplace, onManual, onReupload }) {
  const found = sug.found || { primarySkills:[], secondarySkills:[], techSkills:[] };
  const maybe = sug.maybe || { primarySkills:[], secondarySkills:[], techSkills:[] };

  // Step 1 state — toggle found skills
  const [selFound, setSelFound] = useState({
    primarySkills:   [...found.primarySkills],
    secondarySkills: [...found.secondarySkills],
    techSkills:      [...found.techSkills],
  });

  // Step 2 state — yes/no for maybe skills
  // Each skill starts as null (unanswered), true (yes), false (no)
  const allMaybe = [...maybe.primarySkills, ...maybe.secondarySkills, ...maybe.techSkills];
  const [maybeAnswers, setMaybeAnswers] = useState(() => {
    const init = {};
    allMaybe.forEach(sk => { init[sk.id] = null; });
    return init;
  });

  const toggleFound = (f, sk) => {
    const has = selFound[f].some(x => x.id === sk.id);
    setSelFound(p => ({ ...p, [f]: has ? p[f].filter(x => x.id !== sk.id) : [...p[f], sk] }));
  };

  const totalFound = found.primarySkills.length + found.secondarySkills.length + found.techSkills.length;
  const totalSelFound = selFound.primarySkills.length + selFound.secondarySkills.length + selFound.techSkills.length;

  // Merge found + yes-answered maybe skills
  function buildFinalSelection() {
    const yesSkills = allMaybe.filter(sk => maybeAnswers[sk.id] === true);
    // Figure out which taxonomy each yes skill belongs to
    const yesPrimary   = maybe.primarySkills.filter(sk => maybeAnswers[sk.id] === true);
    const yesSecondary = maybe.secondarySkills.filter(sk => maybeAnswers[sk.id] === true);
    const yesTech      = maybe.techSkills.filter(sk => maybeAnswers[sk.id] === true);
    const merge = (a, b) => { const ids = new Set(a.map(x => x.id)); return [...a, ...b.filter(x => !ids.has(x.id))]; };
    return {
      primarySkills:   merge(selFound.primarySkills, yesPrimary),
      secondarySkills: merge(selFound.secondarySkills, yesSecondary),
      techSkills:      merge(selFound.techSkills, yesTech),
    };
  }

  // ── STEP 1: Found skills ──
  if (step === "found") {
    if (totalFound === 0) return (
      <div>
        <div className="warn">
          <strong>No matching skills found</strong>
          <p>Claude couldn't identify skills from this file that match our taxonomy. This can happen if the resume uses different terminology, or the file couldn't be read correctly. Try editing manually or uploading a different file.</p>
        </div>
        <div className="act-row">
          <button className="btn-ts" onClick={onManual}>Edit My Skills Manually</button>
          <button className="btn-to" onClick={onReupload}>Try a Different File</button>
        </div>
      </div>
    );

    return (
      <div>
        <div className="info" style={{marginBottom:24}}>
          <strong style={{fontFamily:"Raleway,sans-serif",display:"block",marginBottom:4}}>
            ✓ Claude found {totalFound} skill{totalFound!==1?"s":""} on your resume
          </strong>
          These are the skills most clearly shown on your resume. Tap any to deselect it.
        </div>

        {[["primarySkills","Primary Skills"],["secondarySkills","Secondary Skills"],["techSkills","Technology Skills"]].map(([key,lbl]) => (
          <div key={key} className="sug-card">
            <div className="sug-hdr">
              <span className="sug-lbl">{lbl}</span>
              <span className="sug-cnt">{found[key].length} found</span>
            </div>
            {found[key].length === 0
              ? <span className="empty">None clearly identified from your resume</span>
              : <div className="tags">
                  {found[key].map(sk => {
                    const on = selFound[key].some(x => x.id === sk.id);
                    return <button key={sk.id} className={`sug${on?"":" off"}`} onClick={() => toggleFound(key, sk)}>{on?"✓":"✕"} {sk.name}</button>;
                  })}
                </div>
            }
          </div>
        ))}

        <div className="card" style={{marginBottom:16}}>
          <div style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:12,letterSpacing:".1em",textTransform:"uppercase",color:"#6B6B6B",marginBottom:14}}>
            {totalSelFound} skill{totalSelFound!==1?"s":""} selected
          </div>
          <div className="act-row">
            {allMaybe.length > 0
              ? <button className="btn-ts" onClick={() => onStepChange("maybe")}>Next — Review more skills →</button>
              : <button className="btn-ts" onClick={() => onAdd(selFound)}>＋ Add to my existing skills</button>
            }
            <button onClick={onManual} style={{background:"none",border:"none",color:"#A0A0A0",fontSize:12,cursor:"pointer",textDecoration:"underline",padding:"10px 4px"}}>Skip — edit manually</button>
          </div>
        </div>
        <button onClick={onReupload} style={{background:"none",border:"none",color:"#A0A0A0",fontSize:12,cursor:"pointer",textDecoration:"underline"}}>Upload a different file</button>
      </div>
    );
  }

  // ── STEP 2: Maybe skills (yes/no cards) ──
  if (step === "maybe") {
    const unanswered = allMaybe.filter(sk => maybeAnswers[sk.id] === null).length;

    return (
      <div>
        <div className="info" style={{marginBottom:24}}>
          <strong style={{fontFamily:"Raleway,sans-serif",display:"block",marginBottom:4}}>
            Do you also have these skills?
          </strong>
          These are in-demand OBM skills that weren't clearly shown on your resume. Answer yes or no for each — it only takes a moment.
        </div>

        {[
            { key: "primarySkills", label: "Primary Skills", items: maybe.primarySkills },
            { key: "secondarySkills", label: "Secondary Skills", items: maybe.secondarySkills },
            { key: "techSkills", label: "Technology Skills", items: maybe.techSkills },
          ].filter(g => g.items.length > 0).map(({ key, label, items }) => (
            <div key={key} style={{marginBottom:20}}>
              <div style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:11,letterSpacing:".12em",textTransform:"uppercase",color:"#5EA8A1",marginBottom:10}}>
                {label}
              </div>
              {items.map(sk => (
                <div key={sk.id} style={{
                  border: maybeAnswers[sk.id] === true ? "2px solid #7FBFB8" : "1px solid #E0E1E1",
                  borderRadius: 8, padding: "14px 18px", marginBottom: 10,
                  background: maybeAnswers[sk.id] === true ? "#E8F4F3" : maybeAnswers[sk.id] === false ? "#FAFAFA" : "#FFFFFF",
                  transition: "all 0.2s",
                }}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16}}>
                    <div>
                      <div style={{fontFamily:"Raleway,sans-serif",fontWeight:600,fontSize:14,color:maybeAnswers[sk.id]===false?"#A0A0A0":"#1A1A1A",marginBottom:2}}>
                        {sk.name}
                      </div>
                      <div style={{fontSize:12,color:"#6B6B6B"}}>Do you have experience with this?</div>
                    </div>
                    <div style={{display:"flex",gap:8,flexShrink:0}}>
                      <button onClick={() => setMaybeAnswers(p => ({...p,[sk.id]:true}))} style={{padding:"8px 16px",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer",border:"none",transition:"all 0.15s",background:maybeAnswers[sk.id]===true?"#7FBFB8":"#F1F2F2",color:maybeAnswers[sk.id]===true?"#FFFFFF":"#6B6B6B"}}>✓ Yes</button>
                      <button onClick={() => setMaybeAnswers(p => ({...p,[sk.id]:false}))} style={{padding:"8px 16px",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer",border:"none",transition:"all 0.15s",background:"#F1F2F2",color:maybeAnswers[sk.id]===false?"#F15D60":"#6B6B6B",textDecoration:maybeAnswers[sk.id]===false?"line-through":"none"}}>✕ No</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}

        <div className="card" style={{marginBottom:16,marginTop:8}}>
          <div style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:12,letterSpacing:".1em",textTransform:"uppercase",color:"#6B6B6B",marginBottom:14}}>
            Apply your selections:
          </div>
          <div className="act-row">
            <button className="btn-ts" onClick={() => onAdd(buildFinalSelection())}>＋ Add all selected to my profile</button>
            <button onClick={() => onStepChange("found")} style={{background:"none",border:"none",color:"#A0A0A0",fontSize:12,cursor:"pointer",textDecoration:"underline",padding:"10px 4px"}}>← Back to found skills</button>
          </div>
        </div>
        <button onClick={onManual} style={{background:"none",border:"none",color:"#A0A0A0",fontSize:12,cursor:"pointer",textDecoration:"underline"}}>Skip — edit manually instead</button>
      </div>
    );
  }

  return null;
}

// ── Categorized skill picker ─────────────────────────────────────
function SkillPicker({ label, selected, options, onChange, editing, catMap }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(null);
  const ids = new Set(selected.map(s => s.id));
  const grouped = {};
  options.forEach(o => {
    if (ids.has(o.id)) return;
    const c = catOf(o.name, catMap);
    if (!grouped[c]) grouped[c] = [];
    grouped[c].push(o);
  });
  const results = search.length > 1
    ? options.filter(o => !ids.has(o.id) && o.name.toLowerCase().includes(search.toLowerCase()))
    : [];

  return (
    <div>
      {editing
        ? selected.length > 0 && <div className="tags" style={{marginBottom:16}}>{selected.map(s => (
            <span key={s.id} className="tag-e">{s.name}<button className="del" onClick={() => onChange(selected.filter(x => x.id !== s.id))}>✕</button></span>
          ))}</div>
        : <div className="tags">{selected.map(s => <span key={s.id} className="tag">{s.name}</span>)}
            {!selected.length && <span className="empty">No {label.toLowerCase()} added yet</span>}</div>
      }
      {editing && (
        <div>
          {selected.length > 0 && <div className="div-lbl">Add more</div>}
          <input className="fi" style={{marginBottom:12}} placeholder={`Search ${label.toLowerCase()}...`} value={search} onChange={e => { setSearch(e.target.value); setOpen(null); }} />
          {search.length > 1
            ? <div className="tags">{results.slice(0,15).map(o => <button key={o.id} className="opt" onClick={() => { onChange([...selected, o]); setSearch(""); }}>+ {o.name}</button>)}
                {!results.length && <span className="empty">No matches for "{search}"</span>}</div>
            : <div>{Object.entries(grouped).filter(([,v]) => v.length).map(([cat, items]) => (
                <div key={cat} style={{marginBottom:8}}>
                  <button onClick={() => setOpen(open===cat?null:cat)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",background:"none",border:"none",padding:"8px 0",cursor:"pointer",textAlign:"left"}}>
                    <span style={{fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#6B6B6B"}}>{cat} ({items.length})</span>
                    <span style={{color:"#7FBFB8",fontSize:18,lineHeight:1}}>{open===cat?"−":"+"}</span>
                  </button>
                  {open===cat && <div className="tags" style={{paddingTop:6,paddingBottom:10}}>{items.map(o => <button key={o.id} className="opt" onClick={() => onChange([...selected, o])}>+ {o.name}</button>)}</div>}
                  <div style={{borderBottom:"1px solid #E0E1E1"}}></div>
                </div>
              ))}</div>
          }
        </div>
      )}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────
export default function App() {
  const [stage, setStage]   = useState("email");
  const [email, setEmail]   = useState("");
  const [obm, setObm]       = useState(null);
  const [roles, setRoles]   = useState([]);
  const [err, setErr]       = useState("");
  const [tab, setTab]       = useState("profile");
  const [editing, setEditing] = useState(false);
  const [eMode, setEMode]   = useState(null); // null|"resume"|"review"|"manual"
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [pOpts, setPOpts]   = useState([]);
  const [sOpts, setSOpts]   = useState([]);
  const [tOpts, setTOpts]   = useState([]);
  const [profile, setProfile] = useState({ primarySkills:[], secondarySkills:[], techSkills:[], hours:[], rate:"", notes:"", discPrimary:null, discSecondary:null, vark:null, photoUrl:null });
  const [sug, setSug]       = useState(null);
  const [sugStep, setSugStep] = useState("found"); // "found" | "maybe"
  const [parsing, setParsing] = useState(false);
  const hours = ["5 hours per week","10 hours per week","20 hours per week","30 hours per week"];

  async function login() {
    setErr("");
    if (!email.includes("@")) { setErr("Please enter a valid email."); return; }
    setStage("loading");
    try {
      // Load taxonomy fresh every login
      const [p, s, t, rec] = await Promise.all([
        getSkills(TBL_PRIMARY, "Skill Name"),
        getSkills(TBL_SECONDARY, "Label"),
        getSkills(TBL_TECH, "Tech name"),
        findByEmail(email.toLowerCase().trim()),
      ]);
      setPOpts(p); setSOpts(s); setTOpts(t);
      if (!rec) { setErr("No profile found for that email. Contact Prowess support."); setStage("email"); return; }
      setObm(rec);
      const m = await getMatches(rec.id);
      setRoles(m);
      const f = rec.fields;
      const pIds = new Set(f[F_PRIMARY]   || []);
      const sIds = new Set(f[F_SECONDARY] || []);
      const tIds = new Set(f[F_TECH]      || []);
      console.log("Primary IDs:", [...pIds], "| Options:", p.length);
      console.log("Secondary IDs:", [...sIds], "| Options:", s.length);
      console.log("Tech IDs:", [...tIds], "| Options:", t.length);
      const selName = v => v?.name || v || null;
      setProfile({
        primarySkills:   p.filter(o => pIds.has(o.id)),
        secondarySkills: s.filter(o => sIds.has(o.id)),
        techSkills:      t.filter(o => tIds.has(o.id)),
        hours: f[F_HOURS] || [],
        rate:  f[F_RATE] != null ? String(f[F_RATE]) : "",
        notes: f[F_NOTES] || "",
        discPrimary:   selName(f[F_DISC_PRIMARY]),
        discSecondary: selName(f[F_DISC_SECONDARY]),
        vark:          selName(f[F_VARK]),
        photoUrl:      f[F_PHOTO]?.[0]?.url || null,
      });
      setStage("profile");
    } catch(e) {
      console.error(e);
      setErr("Something went wrong: " + e.message);
      setStage("email");
    }
  }

  async function upload(file) {
    if (!file) return;
    setParsing(true); setErr("");
    try {
      const text = await extractText(file);
      if (text.length < 50) { setErr("Couldn't read this file — try a .txt or .docx version."); setParsing(false); return; }
      const result = await parseResume(text, pOpts, sOpts, tOpts);
      setSug(result);
      setSugStep("found"); // "found" | "maybe"
      setEMode("review");
    } catch(e) {
      setErr("Resume parse failed: " + e.message);
    } finally {
      setParsing(false);
    }
  }

  function addToExisting(sel) {
    const merge = (a, b) => { const ids = new Set(a.map(x => x.id)); return [...a, ...b.filter(x => !ids.has(x.id))]; };
    setProfile(p => ({ ...p, primarySkills: merge(p.primarySkills, sel.primarySkills), secondarySkills: merge(p.secondarySkills, sel.secondarySkills), techSkills: merge(p.techSkills, sel.techSkills) }));
    setSug(null); setSugStep("found"); setEMode("manual");
  }

  function replaceAll(sel) {
    setProfile(p => ({ ...p, primarySkills: sel.primarySkills, secondarySkills: sel.secondarySkills, techSkills: sel.techSkills }));
    setSug(null); setSugStep("found"); setEMode("manual");
  }

  async function save() {
    setSaving(true); setSaved(false); setErr("");
    try {
      await saveProfile(obm.id, profile);
      setSaved(true); setEditing(false); setEMode(null); setSug(null);
      setTimeout(() => setSaved(false), 4000);
    } catch(e) {
      setErr("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  function reset() { setEditing(false); setEMode(null); setSug(null); setErr(""); }

  const ed = editing && eMode === "manual";

  return (
    <>
      <style>{css}</style>
      <div className="wrap">
        <header className="hdr">
          <div><div className="logo">Prowess Project</div><div className="logo-sub">OBM Profile Portal</div></div>
          {obm && <button className="btn btn-g btn-sm" onClick={() => { setStage("email"); setObm(null); setEmail(""); reset(); }}>Sign Out</button>}
        </header>
        <div className="teal-bar"></div>
        <main className="main">

          {/* EMAIL */}
          {stage === "email" && <>
            <div className="hero"><div className="hero-title">OBM Profile Portal</div><div className="hero-sub">Manage your profile and track your matched opportunities</div></div>
            <div className="auth">
              <h1 className="auth-title">Sign In</h1>
              <p className="auth-sub">Enter the email associated with your Prowess OBM profile.</p>
              {err && <div className="err">{err}</div>}
              <div style={{marginBottom:20}}><label className="fl">Email Address</label><input className="fi" type="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key==="Enter"&&login()} autoFocus /></div>
              <button className="btn btn-p" onClick={login}>Access My Profile</button>
            </div>
          </>}

          {/* LOADING */}
          {stage === "loading" && <div style={{textAlign:"center",paddingTop:80}}><div className="spin" style={{width:40,height:40,borderWidth:3,margin:"0 auto 20px"}}></div><p style={{color:"#6B6B6B"}}>Loading your profile...</p></div>}

          {/* PROFILE */}
          {stage === "profile" && obm && <div style={{paddingBottom: ed ? 80 : 0}}>
            <div className="ph"><h1 className="pg">{obm.fields["Full Name"]||obm.fields["Name"]||email.split("@")[0]}</h1><p className="pe">{email}</p></div>
            {err && <div className="err">{err}</div>}

            <div className="tabs">
              <button className={`tab ${tab==="profile"?"on":""}`} onClick={() => setTab("profile")}>My Profile</button>
              <button className={`tab ${tab==="roles"?"on":""}`} onClick={() => setTab("roles")}>My Roles {roles.length>0&&`(${roles.length})`}</button>
            </div>

            {tab === "profile" && <>

              {/* Profile summary bar — avatar + DISC + VARK */}
              <div style={{display:"flex",alignItems:"center",gap:20,padding:"20px 24px",background:"#FAFFFE",border:"1px solid rgba(127,191,184,.3)",borderRadius:10,marginBottom:24}}>
                {/* Avatar */}
                <div style={{flexShrink:0}}>
                  {profile.photoUrl
                    ? <img src={profile.photoUrl} alt="" style={{width:64,height:64,borderRadius:"50%",objectFit:"cover",border:"2px solid #7FBFB8"}} />
                    : <div style={{width:64,height:64,borderRadius:"50%",background:"#7FBFB8",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:"#fff",fontFamily:"Raleway,sans-serif",fontWeight:700}}>
                        {(obm.fields["Full Name"]||obm.fields["Name"]||email).charAt(0).toUpperCase()}
                      </div>
                  }
                </div>
                {/* Info */}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:16,color:"#1A1A1A",marginBottom:6}}>
                    {obm.fields["Full Name"]||obm.fields["Name"]||email.split("@")[0]}
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                    {profile.discPrimary && (
                      <span style={{background:"#E8F4F3",border:"1px solid rgba(127,191,184,.4)",color:"#1F5C58",padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:600}}>
                        DISC: {profile.discPrimary}{profile.discSecondary ? ` / ${profile.discSecondary}` : ""}
                      </span>
                    )}
                    {profile.vark && (
                      <span style={{background:"#F1F2F2",border:"1px solid #C8C9CA",color:"#4A4A4A",padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:600}}>
                        VARK: {profile.vark}
                      </span>
                    )}
                    {!profile.discPrimary && !profile.vark && (
                      <span style={{fontSize:12,color:"#A0A0A0",fontStyle:"italic"}}>Assessment data not yet available</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Top button */}
              <div style={{display:"flex",justifyContent:"flex-end",marginBottom:16}}>
                {!editing
                  ? <button className="btn btn-g btn-sm" onClick={() => { setEditing(true); setEMode(null); }}>Edit Profile</button>
                  : eMode===null ? <button className="btn btn-g btn-sm" onClick={reset}>Cancel</button>
                  : eMode==="review" ? <button className="btn btn-g btn-sm" onClick={() => { setEMode("resume"); setSug(null); }}>← Back</button>
                  : <button className="btn btn-g btn-sm" onClick={() => setEMode(null)}>← Back</button>
                }
              </div>

              {/* Mode chooser */}
              {editing && eMode===null && <div className="card" style={{marginBottom:24}}>
                <div className="ch"><span className="ct">How would you like to update your profile?</span></div>
                <div className="mode-grid">
                  {[["resume","📄","Upload Resume","Claude reads your resume and suggests skills to add"],
                    ["manual","✏️","Edit Manually","Browse by category, add or remove skills individually"]
                  ].map(([m,ic,ti,de]) => (
                    <button key={m} className="mode-btn" onClick={() => setEMode(m)}>
                      <div className="mode-icon">{ic}</div>
                      <div className="mode-title">{ti}</div>
                      <div className="mode-desc">{de}</div>
                    </button>
                  ))}
                </div>
              </div>}

              {/* Resume upload */}
              {editing && eMode==="resume" && <div className="card" style={{marginBottom:24}}>
                <div className="ch"><span className="ct">Upload Your Resume</span></div>
                {parsing
                  ? <div style={{textAlign:"center",padding:"40px 0"}}><div className="spin" style={{width:32,height:32,borderWidth:3,margin:"0 auto 16px"}}></div><p style={{color:"#6B6B6B"}}>Claude is reading your resume...</p></div>
                  : <label>
                      <div className="upload-zone" onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("over"); }} onDragLeave={e => e.currentTarget.classList.remove("over")} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove("over"); upload(e.dataTransfer.files[0]); }}>
                        <div className="upload-icon">📄</div>
                        <div className="upload-txt"><strong>Drop your resume here</strong><br/>or click to browse — PDF, Word, or text file</div>
                      </div>
                      <input type="file" accept=".pdf,.txt,.doc,.docx" style={{display:"none"}} onChange={e => upload(e.target.files[0])} />
                    </label>
                }
              </div>}

              {/* Suggestion review */}
              {editing && eMode==="review" && sug && <SugReview sug={sug} step={sugStep} onStepChange={setSugStep} onAdd={addToExisting} onReplace={replaceAll} onManual={() => { setSug(null); setSugStep("found"); setEMode("manual"); }} onReupload={() => { setSug(null); setSugStep("found"); setEMode("resume"); }} />}

              {/* Edit legend */}
              {ed && <div className="legend"><div className="li"><div className="dot-t"></div> Your current skills (tap ✕ to remove)</div><div className="li"><div className="dot-g"></div> Available to add</div></div>}

              {/* Skills sections — hide during review */}
              {eMode !== "review" && <>
                <div className={`card ${ed?"ed":""}`}>
                  <div className="ch"><span className={`ct ${ed?"on":""}`}>Primary Skills</span></div>
                  <SkillPicker label="Primary Skills" selected={profile.primarySkills} options={pOpts} onChange={v => setProfile(p => ({...p, primarySkills:v}))} editing={ed} catMap={SKILL_CATS} />
                </div>
                <div className={`card ${ed?"ed":""}`}>
                  <div className="ch"><span className={`ct ${ed?"on":""}`}>Secondary Skills</span></div>
                  <SkillPicker label="Secondary Skills" selected={profile.secondarySkills} options={sOpts} onChange={v => setProfile(p => ({...p, secondarySkills:v}))} editing={ed} catMap={SKILL_CATS} />
                </div>
                <div className={`card ${ed?"ed":""}`}>
                  <div className="ch"><span className={`ct ${ed?"on":""}`}>Technology Skills</span></div>
                  <SkillPicker label="Technology Skills" selected={profile.techSkills} options={tOpts} onChange={v => setProfile(p => ({...p, techSkills:v}))} editing={ed} catMap={TECH_CATS} />
                </div>
                <div className={`card ${ed?"ed":""}`}>
                  <div className="ch"><span className={`ct ${ed?"on":""}`}>Availability</span></div>
                  {ed
                    ? <div className="tags">{hours.map(h => (
                        <button key={h} className={profile.hours.includes(h)?"tag-e":"opt"} onClick={() => setProfile(p => ({...p, hours: p.hours.includes(h) ? p.hours.filter(x=>x!==h) : [...p.hours,h]}))} style={{cursor:"pointer",border: profile.hours.includes(h)?"none":undefined}}>
                          {profile.hours.includes(h) ? <><span>✓ {h}</span><button className="del" onClick={e => { e.stopPropagation(); setProfile(p => ({...p, hours: p.hours.filter(x=>x!==h)})); }}>✕</button></> : `+ ${h}`}
                        </button>
                      ))}</div>
                    : <div className="tags">{profile.hours.length ? profile.hours.map(h => <span key={h} className="tag">{h}</span>) : <span className="empty">Not set</span>}</div>
                  }
                </div>
                <div className={`card ${ed?"ed":""}`}>
                  <div className="ch"><span className={`ct ${ed?"on":""}`}>Details</span></div>
                  {ed
                    ? <div style={{marginBottom:0}}>
                        <label className="fl">Preferred Hourly Rate</label>
                        <div className="rate-wrap"><span className="rate-fix rate-l">$</span><input className="rate-in" type="number" min="0" placeholder="65" value={profile.rate} onChange={e => setProfile(p => ({...p, rate:e.target.value}))} /><span className="rate-fix rate-r">/hr</span></div>
                      </div>
                    : <div style={{display:"flex",gap:16,alignItems:"baseline"}}><span style={{fontSize:12,textTransform:"uppercase",letterSpacing:".08em",color:"#A0A0A0",width:90,flexShrink:0}}>Rate</span><span style={{fontSize:14,color:profile.rate?"#1A1A1A":"#A0A0A0"}}>{profile.rate?`$${profile.rate}/hr`:"Not set"}</span></div>
                  }
                </div>
              </>}
            </>}

            {tab === "roles" && <div>
              {!roles.length
                ? <div className="card" style={{textAlign:"center",padding:"48px 24px"}}><div style={{fontSize:32,marginBottom:12}}>🔍</div><p style={{color:"#6B6B6B",fontSize:15}}>No roles yet. When Prowess matches you to an opportunity, it will appear here.</p></div>
                : roles.map(r => (
                    <div key={r.id} className="role-card">
                      <div>
                        <div className="rn">{r.fields["Client Name"]||r.fields["Role Title"]||"Ops Partner Role"}</div>
                        <div className="rm">{r.fields["Industry"]||""}{r.fields[F_MATCH_SCORE]?` · ${r.fields[F_MATCH_SCORE]}% match`:""}{r.createdTime?` · Sent ${new Date(r.createdTime).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`:""}</div>
                      </div>
                      <Badge s={r.fields[F_MATCH_STATUS]} />
                    </div>
                  ))
              }
            </div>}
          </div>}
        </main>

        {ed && <div className="save-bar">
          {saved && <span className="ok">✓ Profile saved</span>}
          <button className="btn btn-g" onClick={reset}>Cancel</button>
          <button className="btn btn-p" style={{width:"auto"}} onClick={save} disabled={saving}>
            {saving ? <><span className="spin"></span> Saving...</> : "Save Changes"}
          </button>
        </div>}
      </div>
    </>
  );
}
