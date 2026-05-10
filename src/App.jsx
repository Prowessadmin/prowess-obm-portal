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
const TBL_INDUSTRY = "tbl2qU124blP8q1nv"; // Industry knowledge — linked from "Industry knowledge 2" on PM Profile
const TBL_SPOTLIGHT = "tbl7GmdnkpbjzqXty"; // OBM Spotlight Form

// Application response form (Airtable shared form) — supports prefill_<FieldName>
const APPLY_FORM_BASE = "https://airtable.com/appaOBVteWvtxFcKr/shrKBK20co7xggD5E";

function buildApplyUrl({ roleName, email }) {
  // Shotgun the prefill across likely field names. Use encodeURIComponent so spaces
  // become %20 (Airtable's prefill parser doesn't accept + as a space in field names).
  const parts = [];
  const enc = (k, v) => `prefill_${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
  if (roleName) {
    ["Name of Role", "Role", "Client Name", "Client", "Role Title", "Role Name", "Position"].forEach(k => {
      parts.push(enc(k, roleName));
    });
  }
  if (email) {
    ["Email", "OBM Email", "PM Email", "Your Email"].forEach(k => {
      parts.push(enc(k, email));
    });
  }
  return `${APPLY_FORM_BASE}?${parts.join("&")}`;
}

// Cloudinary unsigned upload (avatars)
const CLOUDINARY_CLOUD = "diwso2edi";
const CLOUDINARY_PRESET = "prowess_obm_avatars";

// Assessment options (Airtable singleSelect — must match exactly)
const DISC_OPTIONS = ["Dominant", "Inspirational", "Steadiness", "Conscientious", "Level"];
const VARK_OPTIONS = ["Visual", "Auditory", "Read/Write", "Kinesthetic", "Multimodal"];

// Achievement badges
const BADGES = [
  { id: "headshot",  emoji: "📸", name: "Looking Sharp",    desc: "Upload a profile photo" },
  { id: "pioneer",   emoji: "🌱", name: "Profile Pioneer",  desc: "Set city, rate, and pick at least 3 primary skills" },
  { id: "industry",  emoji: "🏢", name: "Industry Insider", desc: "Add 3 or more industries" },
  { id: "tech",      emoji: "🛠️", name: "Tech Stack Pro",   desc: "Add 5 or more tech skills" },
  { id: "story",     emoji: "📖", name: "Storyteller",      desc: "Fill in Who You Are and Greatest Achievement on your Spotlight" },
  { id: "spotlight", emoji: "✨", name: "Spotlight Star",   desc: "Complete every Spotlight field" },
];

function spotlightAllFilled(spotlight) {
  if (!spotlight?.fields) return false;
  return SPOT_FIELDS.every(f => {
    const v = spotlight.fields[f.key];
    return v && String(v).trim();
  });
}

function earnedBadgeIds(profile, spotlight) {
  const sf = spotlight?.fields || {};
  return new Set([
    profile.photoUrl ? "headshot" : null,
    (profile.city && profile.rate && profile.primarySkills.length >= 3) ? "pioneer" : null,
    profile.industries.length >= 3 ? "industry" : null,
    profile.techSkills.length >= 5 ? "tech" : null,
    (sf["Who you are"]?.trim() && sf["Greatest personal achievement"]?.trim()) ? "story" : null,
    spotlightAllFilled(spotlight) ? "spotlight" : null,
  ].filter(Boolean));
}

function computeProfileStrength(profile, spotlight) {
  const checks = [
    { id: "photo",         done: !!profile.photoUrl,                                                 action: "Add a profile photo",                              section: "photo" },
    { id: "name",          done: !!(profile.firstName && profile.lastName),                          action: "Add your first and last name",                     section: "info" },
    { id: "location",      done: !!(profile.city && profile.state),                                  action: "Set your city and state",                          section: "info" },
    { id: "rate",          done: !!profile.rate,                                                     action: "Set your hourly rate",                             section: "info" },
    { id: "disc_vark",     done: !!(profile.discPrimary && profile.vark),                            action: "Add your DISC and VARK assessments",               section: "info" },
    { id: "primarySkills", done: profile.primarySkills.length   >= 3,                                action: "Pick at least 3 primary skills",                   section: "skills" },
    { id: "secondarySkills", done: profile.secondarySkills.length >= 3,                              action: "Pick at least 3 secondary skills",                 section: "skills" },
    { id: "techSkills",    done: profile.techSkills.length      >= 3,                                action: "Pick at least 3 tech skills",                      section: "skills" },
    { id: "industries",    done: profile.industries.length      >= 2,                                action: "Add 2 or more industries",                         section: "skills" },
    { id: "facts",         done: !!profile.facts,                                                    action: "Share a little about yourself in Facts & Hobbies", section: "info" },
    { id: "spotlight",     done: spotlightAllFilled(spotlight),                                      action: "Finish your Spotlight ✨",                          section: "spotlight" },
  ];
  const earned = checks.filter(c => c.done).length;
  const pct = Math.round((earned / checks.length) * 100);
  const tier =
    pct >= 86 ? { label: "All-Star",  color: "#F59E0B", message: "Your profile is fully built. When a matching role lands, Prowess's algorithm has everything it needs to put you in the top picks." } :
    pct >= 61 ? { label: "Excellent", color: "#7FBFB8", message: "Strong profile. A few more details will sharpen your match odds when roles come in." } :
    pct >= 31 ? { label: "Strong",    color: "#5EA8A1", message: "You're well underway — keep building so the matching algorithm has more to work with." } :
                { label: "Beginner",  color: "#A0A0A0", message: "Just getting started — add the basics so Prowess's algorithm can match you to roles as they come in." };
  const nextSteps = checks.filter(c => !c.done).slice(0, 3);
  return { pct, tier, checks, nextSteps };
}

// Spotlight cards — grouped fields with helper text
const SPOT_CARDS = [
  {
    title: "Moniker",
    fields: [
      { key: "Branding nickname", label: "Moniker", multiline: false,
        helper: 'Give yourself a nickname or fun title. Examples: "Lead whisperer" or "Operations wrangler."' },
    ],
  },
  {
    title: "Top Skills",
    fields: [
      { key: "Skill 1", label: "Top Skill 1", multiline: false,
        helper: "Your #1 area of Online Business Management strength. Examples: Automation, CRM implementation, Demand generation" },
      { key: "Skill 2", label: "Top Skill 2", multiline: false,
        helper: "Your second strongest area" },
      { key: "skill 3", label: "Top Skill 3", multiline: false,
        helper: "Your third strongest area" },
    ],
  },
  {
    title: "Success Metric",
    fields: [
      { key: "Please list a success metric for your acheivements", label: "Success Metric", multiline: true,
        helper: 'In 2–3 sentences (40 words or less). Format: I (result) for (who) over (time period) by (tactic). Example: "I doubled revenue for my marketing client over 12 months by reengaging stale contacts."' },
    ],
  },
  {
    title: "Greatest Achievement",
    fields: [
      { key: "Greatest personal achievement", label: "Greatest Achievement", multiline: true,
        helper: "In one sentence — share an achievement (personal or professional) that demonstrates your talent, grit, or specialties." },
    ],
  },
  {
    title: "What Success Looks Like",
    fields: [
      { key: "What success looks like", label: "What Success Looks Like", multiline: false,
        helper: 'Finish this sentence: "Here\'s what success looks like working with me..."' },
    ],
  },
  {
    title: "Industries & Niche",
    fields: [
      { key: "Industries or Niche", label: "Industries & Niche", multiline: false,
        helper: "Your dream client industries or business types. Example: Social justice, Interior Design, Wellness Coach" },
    ],
  },
  {
    title: "Who You Are",
    fields: [
      { key: "Who you are", label: "Who You Are", multiline: true,
        helper: "Hobbies, traits, achievements — whatever you'd want a future client to know about the whole you." },
    ],
  },
  {
    title: "Favorite Tech Tools",
    fields: [
      { key: "Favorite tech tools", label: "Favorite Tech Tools", multiline: false,
        helper: "The tools you love working with most" },
    ],
  },
  {
    title: "Testimonial",
    fields: [
      { key: "Testimonial", label: "Testimonial", multiline: true,
        helper: "A testimonial from someone who understands your operations, project management, or technical skills." },
    ],
  },
];

// Flat list for save / progress / draft init
const SPOT_FIELDS = SPOT_CARDS.flatMap(c => c.fields);

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
const F_CITY           = "fldNUlNQFKbH3AkUE"; // City2
const F_STATE          = "fldzqRGsZwi2ghuAK"; // State2
const F_FACTS          = "fldvAcP6bqXnFwcQJ"; // Facts & Hobbies
const F_INDUSTRY       = "fldhg7qjs9AVwp4wu"; // Industry knowledge 2 (multipleRecordLinks → Industry knowledge)

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
  // Pull response-yes + awaiting-response rows server-side, then detect the linkage field by
  // scanning every array field for our pmId (the link field's name varies in Airtable).
  const formula = `OR(
    LOWER(TRIM({Application status})) = "response yes",
    LOWER(TRIM({Application status})) = "awaiting response"
  )`;
  const f = encodeURIComponent(formula);
  const d = await atFetch(`/${TBL_MATCHING}?filterByFormula=${f}&sort[0][field]=Created&sort[0][direction]=desc&maxRecords=200`);
  const all = d.records || [];
  const isLinked = (r) => {
    for (const v of Object.values(r.fields || {})) {
      if (Array.isArray(v) && v.includes(pmId)) return true;
    }
    return false;
  };
  const linked = all.filter(isLinked);
  const statusOf = r => String(r.fields["Application status"] || "").trim().toLowerCase();
  return {
    responseYes: linked.filter(r => statusOf(r) === "response yes"),
    awaiting:    linked.filter(r => statusOf(r) === "awaiting response"),
  };
}

async function getSpotlight(email) {
  const enc = encodeURIComponent(`LOWER({email})="${email.toLowerCase()}"`);
  const d = await atFetch(`/${TBL_SPOTLIGHT}?filterByFormula=${enc}&maxRecords=1`);
  return d.records?.[0] || null;
}

async function saveSpotlight(recordId, fields, email) {
  if (recordId) {
    return atFetch(`/${TBL_SPOTLIGHT}/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    });
  }
  return atFetch(`/${TBL_SPOTLIGHT}`, {
    method: "POST",
    body: JSON.stringify({ fields: { email, ...fields } }),
  });
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
    ...(profile.firstName !== undefined && { "First Name": profile.firstName }),
    ...(profile.lastName  !== undefined && { "Last Name":  profile.lastName }),
    ...(profile.city  !== undefined && { [F_CITY]:  profile.city }),
    ...(profile.state !== undefined && { [F_STATE]: profile.state }),
    ...(profile.facts !== undefined && { [F_FACTS]: profile.facts }),
    ...(profile.discPrimary   !== undefined && { "Primary Disc Trait":   profile.discPrimary   || null }),
    ...(profile.discSecondary !== undefined && { "Secondary Disc Trait": profile.discSecondary || null }),
    ...(profile.vark          !== undefined && { "Vark Style":           profile.vark          || null }),
    ...(profile.industries !== undefined && { "Industry knowledge 2": profile.industries.map(i => i.id) }),
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

// ── Sage resume parser ─────────────────────────────────────────
async function parseResume(text, pOpts, sOpts, tOpts, indOpts) {
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
  "industries": ["exact name from taxonomy"],
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

INDUSTRY TAXONOMY (copy names exactly): ${indOpts.map(o => o.name).join(" | ")}
For industries: extract all industries this person has worked in based on their job history. Only include industries from the taxonomy above.

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
    // Map industry names against known options → full {id, name} objects
    const foundIndustries = (parsed.industries || [])
      .map(n => indOpts.find(o => o.name.toLowerCase() === n.trim().toLowerCase()))
      .filter(Boolean);
    return {
      found: mapSkills(found, pOpts, sOpts, tOpts),
      maybe: mapSkills(maybe, pOpts, sOpts, tOpts),
      industries: foundIndustries,
      rate: parsed.rate || "",
    };
  } catch {
    return { found: { primarySkills:[], secondarySkills:[], techSkills:[] }, maybe: { primarySkills:[], secondarySkills:[], techSkills:[] }, industries: [], rate: "" };
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

// ── Cloudinary upload widget (dynamic load) ──────────────────────
// ── Confetti (lazy from CDN, only when a badge unlocks) ─────────
async function loadConfetti() {
  if (window.confetti) return window.confetti;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return window.confetti;
}

async function fireBadgeConfetti() {
  try {
    const confetti = await loadConfetti();
    if (!confetti) return;
    const colors = ["#7FBFB8", "#5EA8A1", "#F59E0B", "#FCD34D", "#fff"];
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.55 }, colors });
    setTimeout(() => confetti({ particleCount: 60, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors }), 220);
    setTimeout(() => confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors }), 220);
  } catch (e) {
    // Silently swallow — celebration is decorative
    console.warn("confetti failed:", e);
  }
}

async function loadCloudinaryWidget() {
  if (window.cloudinary) return;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://upload-widget.cloudinary.com/global/all.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

function openCloudinaryAvatarWidget(onSuccess, onError) {
  return window.cloudinary.openUploadWidget({
    cloudName: CLOUDINARY_CLOUD,
    uploadPreset: CLOUDINARY_PRESET,
    unsigned: true,
    sources: ["local", "camera", "url"],
    multiple: false,
    maxFiles: 1,
    styles: {
      palette: {
        window: "#FFFFFF", windowBorder: "#E0E1E1", tabIcon: "#7FBFB8",
        menuIcons: "#5EA8A1", link: "#5EA8A1", action: "#7FBFB8",
        inactiveTabIcon: "#A0A0A0", error: "#F15D60",
        inProgress: "#7FBFB8", complete: "#7FBFB8", sourceBg: "#FAFFFE",
      },
    },
  }, (err, result) => {
    if (err) { onError?.(err); return; }
    if (result?.event === "success") onSuccess(result.info.secure_url);
  });
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
.opt{background:#fff;border:1.5px dashed #7FBFB8;color:#5EA8A1;padding:6px 12px;border-radius:20px;font-size:13px;cursor:pointer;transition:all .15s;font-family:'DM Sans',sans-serif;font-weight:500;display:inline-flex;align-items:center;gap:5px}
.opt::before{content:"+";font-weight:700;color:#7FBFB8;font-size:14px;line-height:1}
.opt:hover{border-style:solid;background:#E8F4F3;color:#1F5C58;transform:translateY(-1px);box-shadow:0 2px 6px rgba(127,191,184,.25)}
.opt:hover::before{color:#5EA8A1}
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
.parse-track{height:6px;background:#F1F2F2;border-radius:999px;overflow:hidden;margin-bottom:18px}
.parse-bar{height:100%;width:0;background:linear-gradient(90deg,#7FBFB8,#5EA8A1);border-radius:999px;animation:parse-grow 4s cubic-bezier(.2,.8,.4,1) forwards}
.parse-bar.done{width:100% !important;animation:none;transition:width .4s ease-out}
@keyframes parse-grow{to{width:90%}}
.parse-msg{color:#6B6B6B;font-size:14px;font-weight:500;margin:0;min-height:22px;transition:opacity .25s}
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
.welcome-hero{background:linear-gradient(135deg,#7FBFB8 0%,#5EA8A1 100%);padding:48px 40px;border-radius:12px;margin-bottom:28px;position:relative;overflow:hidden}
.welcome-hero::before{content:'';position:absolute;top:-60px;right:-60px;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,.1);pointer-events:none}
.welcome-hero::after{content:'';position:absolute;bottom:-40px;left:-40px;width:140px;height:140px;border-radius:50%;background:rgba(255,255,255,.08);pointer-events:none}
.welcome-title{font-family:'Raleway',sans-serif;font-size:26px;font-weight:700;color:#fff;margin-bottom:8px;position:relative;z-index:1}
.welcome-sub{font-size:15px;color:rgba(255,255,255,.85);line-height:1.6;position:relative;z-index:1}
.welcome-card{background:#fff;border:1px solid #E0E1E1;border-radius:10px;padding:24px;margin-bottom:16px}
.step-row{display:flex;align-items:flex-start;gap:16px;padding:16px 0;border-bottom:1px solid #F1F2F2}
.step-row:last-child{border-bottom:none;padding-bottom:0}
.step-num{width:32px;height:32px;border-radius:50%;background:#7FBFB8;color:#fff;font-family:'Raleway',sans-serif;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.step-body{}
.step-title{font-family:'Raleway',sans-serif;font-weight:700;font-size:14px;color:#1A1A1A;margin-bottom:3px}
.step-desc{font-size:13px;color:#6B6B6B;line-height:1.5}

/* ── Badge celebration ── */
.celebration-overlay{position:fixed;inset:0;background:rgba(26,26,26,.45);display:flex;align-items:center;justify-content:center;z-index:1000;padding:24px;animation:fade-in .2s ease-out}
.celebration-card{background:#fff;border-radius:16px;padding:36px 32px 28px;max-width:420px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.25);animation:pop-in .35s cubic-bezier(.18,.89,.32,1.28);position:relative}
.celebration-emoji{font-size:64px;line-height:1;margin-bottom:14px;display:inline-block;animation:badge-bounce .6s ease-out}
.celebration-tag{font-family:'Raleway',sans-serif;font-weight:700;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#5EA8A1;margin-bottom:8px}
.celebration-name{font-family:'Raleway',sans-serif;font-weight:700;font-size:24px;color:#1A1A1A;margin-bottom:10px}
.celebration-desc{font-size:14px;color:#6B6B6B;line-height:1.55;margin-bottom:22px}
@keyframes fade-in{from{opacity:0}to{opacity:1}}
@keyframes pop-in{0%{transform:scale(.7);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes badge-bounce{0%{transform:scale(0) rotate(-15deg)}60%{transform:scale(1.15) rotate(8deg)}100%{transform:scale(1) rotate(0)}}

/* ── Mobile (≤640px) ── */
@media (max-width: 640px) {
  .hdr{padding:14px 18px}
  .main{padding:24px 18px}
  .hero{padding:36px 22px 32px}
  .hero-title{font-size:24px;letter-spacing:.04em}
  .hero-sub{font-size:13px}
  .auth{margin:24px auto 0}
  .auth-title{font-size:24px}
  .auth-sub{font-size:14px;margin-bottom:24px}
  .pg{font-size:22px}
  .pe{font-size:13px}
  .ph{margin-bottom:22px;padding-bottom:18px}
  .welcome-hero{padding:28px 22px;border-radius:10px;margin-bottom:18px}
  .welcome-title{font-size:20px}
  .welcome-sub{font-size:14px}
  .welcome-card{padding:18px}
  .card{padding:18px}
  .save-bar{padding:12px 18px;flex-wrap:wrap;gap:8px}
  .save-bar .btn{flex:1;min-width:0}
  .tabs{overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;scrollbar-width:none}
  .tabs::-webkit-scrollbar{display:none}
  .tab{padding:10px 16px;white-space:nowrap;flex-shrink:0;font-size:11px}
  .mode-grid{grid-template-columns:1fr !important}
  .legend{flex-wrap:wrap;gap:8px}
  .upload-zone{padding:32px 16px}
  .role-card{flex-direction:column;align-items:flex-start;gap:10px}
  /* Force inline 2-col grids in profile/details to single column on phones */
  .stack-mobile,
  div[style*="grid-template-columns:1fr 1fr"]{grid-template-columns:1fr !important}
  /* Tap targets */
  .btn,.btn-ts,.btn-to{min-height:44px}
  /* Ensure inputs are at least 16px so iOS doesn't zoom */
  .fi,.rate-in{font-size:16px}
}
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
const SKILL_DESCRIPTIONS = {
  "Project Management": "Planning and overseeing projects from start to finish",
  "Process Improvement": "Documenting and optimizing how a business operates",
  "CRM management": "Managing client pipelines and contact systems",
  "Strategic planning": "Setting goals and building roadmaps for a business",
  "Risk management": "Identifying and mitigating business risks",
  "Customer Success": "Onboarding and retaining clients post-sale",
  "Reporting": "Building dashboards and reporting on business metrics",
  "Recruiting": "Sourcing, screening, and hiring team members",
  "Training": "Creating and delivering training programs for teams",
  "Performance Management": "Setting goals and reviewing team performance",
  "Financial Analytics": "Analyzing financial data to guide business decisions",
  "Quality Assurance": "Testing and ensuring standards are met consistently",
  "Account management": "Managing and growing relationships with existing clients",
  "Scheduling": "Coordinating calendars, meetings, and team availability",
  "Onboarding": "Setting up systems and processes for new clients or team members",
  "Team communications": "Keeping teams aligned and informed across projects",
  "Resource Management": "Allocating people, time, and budget across projects",
  "Budgeting": "Building and managing financial budgets",
  "Financial reporting/modeling": "Creating financial reports and projections",
  "Digital marketing": "Running online marketing campaigns across channels",
  "Social media": "Managing brand presence across social platforms",
  "Content creation": "Writing and producing content for marketing",
  "Data analytics": "Analyzing data to surface insights and inform decisions",
  "System/tech Implementations": "Rolling out new tools and technology for a business",
  "Slack": "Team messaging and async communication platform",
  "Google Docs": "Cloud-based document creation and collaboration",
  "Google Sheets": "Cloud-based spreadsheet and data management",
  "Canva": "Visual design tool for marketing and brand assets",
  "Quickbooks Online": "Cloud-based accounting and financial management",
  "Asana": "Project and task management platform",
  "ClickUp": "All-in-one project management and productivity platform",
  "GoHighLevel": "CRM, marketing automation, and client management platform",
  "Airtable": "Flexible database and project tracking platform",
  "Zapier": "No-code automation tool connecting apps and workflows",
  "Salesforce": "Enterprise CRM and sales management platform",
  "Hubspot": "CRM, marketing, and sales platform",
};

function ParsingProgress({ complete }) {
  const messages = [
    "Reading your resume...",
    "Identifying your experience...",
    "Matching skills to our taxonomy...",
    "Finding your industry background...",
    "Almost done...",
  ];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (complete) return;
    const t = setInterval(() => {
      setIdx(i => Math.min(i + 1, messages.length - 1));
    }, 1500);
    return () => clearInterval(t);
  }, [complete]);
  return (
    <div style={{padding:"32px 8px",textAlign:"center"}}>
      <div className="parse-track">
        <div className={`parse-bar${complete?" done":""}`} />
      </div>
      <p className="parse-msg">{complete ? "Done — let's review what we found." : messages[idx]}</p>
    </div>
  );
}

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
  const industries = sug.industries || [];

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
          <p>Prowess Scout couldn't identify skills from this file that match our taxonomy. This can happen if the resume uses different terminology, or the file couldn't be read correctly. Try editing manually or uploading a different file.</p>
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
            Here's what Prowess Scout found
          </strong>
          ✓ Prowess Scout found {totalFound} skill{totalFound!==1?"s":""} on your resume.
        </div>
        <div style={{background:"#F8F8F8",border:"1px solid #E0E1E1",color:"#4A4A4A",padding:"14px 16px",borderRadius:8,fontSize:14,lineHeight:1.55,marginBottom:20}}>
          These are the skills Prowess Scout identified from your resume. They're already selected — tap any skill to remove it if it doesn't apply. You'll have a chance to add more too.
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

        <div className="sug-card">
          <div className="sug-hdr">
            <span className="sug-lbl">Industry Experience</span>
            <span className="sug-cnt">{industries.length} found</span>
          </div>
          {industries.length === 0
            ? <span className="empty">None clearly identified from your resume</span>
            : <div className="tags">
                {industries.map(ind => <span key={ind.id} className="tag">{ind.name}</span>)}
              </div>
          }
        </div>

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
        <div style={{textAlign:"center",fontSize:12,color:"#5EA8A1",fontStyle:"italic",marginBottom:14}}>
          Don't worry about getting it perfect — you can always edit your profile later.
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
            Prowess Scout has a few questions for you
          </strong>
          These are high-demand skills for online business managers that weren't clearly on your resume. Answer honestly — this helps Prowess Scout match you to the right clients.
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
                      <div style={{fontSize:12,color:"#6B6B6B",lineHeight:1.4}}>{SKILL_DESCRIPTIONS[sk.name] || "Common in operations management work"}</div>
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
            ? <div className="tags">{results.slice(0,15).map(o => <button key={o.id} className="opt" onClick={() => { onChange([...selected, o]); setSearch(""); }}>{o.name}</button>)}
                {!results.length && <span className="empty">No matches for "{search}"</span>}</div>
            : <div>{Object.entries(grouped).filter(([,v]) => v.length).map(([cat, items]) => (
                <div key={cat} style={{marginBottom:8}}>
                  <button onClick={() => setOpen(open===cat?null:cat)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",background:"none",border:"none",padding:"8px 0",cursor:"pointer",textAlign:"left"}}>
                    <span style={{fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#6B6B6B"}}>{cat} ({items.length})</span>
                    <span style={{color:"#7FBFB8",fontSize:18,lineHeight:1}}>{open===cat?"−":"+"}</span>
                  </button>
                  {open===cat && <div className="tags" style={{paddingTop:6,paddingBottom:10}}>{items.map(o => <button key={o.id} className="opt" onClick={() => onChange([...selected, o])}>{o.name}</button>)}</div>}
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
  const [stage, setStage]   = useState("email"); // email | code-entry | loading | profile | welcome
  const [code, setCode]     = useState("");
  const [codeError, setCodeError] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Auto-login from saved session on first mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("prowess-session");
      if (!raw) {
        console.log("[auto-login] no session in localStorage — showing email screen");
        return;
      }
      const session = JSON.parse(raw);
      if (!session?.email || !session?.expiresAt) {
        console.log("[auto-login] malformed session, clearing");
        localStorage.removeItem("prowess-session");
        return;
      }
      if (new Date(session.expiresAt) <= new Date()) {
        console.log("[auto-login] session expired at", session.expiresAt, "— clearing");
        localStorage.removeItem("prowess-session");
        return;
      }
      console.log("[auto-login] valid session for", session.email, "— skipping login flow");
      loadProfile(session.email);
    } catch (e) {
      console.log("[auto-login] error:", e.message);
      try { localStorage.removeItem("prowess-session"); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [email, setEmail]   = useState("");
  const [obm, setObm]       = useState(null);
  const [roles, setRoles]   = useState([]);
  const [awaitingRoles, setAwaitingRoles] = useState([]);
  const [err, setErr]       = useState("");
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab]       = useState("profile");
  const [eMode, setEMode]   = useState(null); // null | "resume" | "review"
  const [editingCard, setEditingCard] = useState(null); // null | "skills" | "industries" | "availability" | "details"
  const [editSnapshot, setEditSnapshot] = useState(null); // profile snapshot for cancel revert
  const [cardSaving, setCardSaving] = useState(false);
  const [cardSavedAt, setCardSavedAt] = useState(null); // id of last saved card for "✓ Saved" pulse
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [pOpts, setPOpts]   = useState([]);
  const [sOpts, setSOpts]   = useState([]);
  const [tOpts, setTOpts]   = useState([]);
  const [indOpts, setIndOpts] = useState([]); // industry options
  const [profile, setProfile] = useState({ primarySkills:[], secondarySkills:[], techSkills:[], hours:[], rate:"", notes:"", discPrimary:null, discSecondary:null, vark:null, photoUrl:null, firstName:"", lastName:"", city:"", state:"", facts:"", industries:[] });
  const [sug, setSug]       = useState(null);
  const [sugStep, setSugStep] = useState("found"); // "found" | "maybe"
  const [parsing, setParsing] = useState(false);
  const [parseComplete, setParseComplete] = useState(false);
  const [onboardStep, setOnboardStep] = useState(1); // welcome onboarding: 1..4
  const [onboardSaving, setOnboardSaving] = useState(false);
  const [spotlight, setSpotlight] = useState(null); // { id, fields } | null
  const [spotlightLoaded, setSpotlightLoaded] = useState(false);
  const [spotlightLoading, setSpotlightLoading] = useState(false);
  const [spotlightEditing, setSpotlightEditing] = useState(false);
  const [spotlightSaving, setSpotlightSaving] = useState(false);
  const [spotlightSaved, setSpotlightSaved] = useState(false);
  const [spotlightDraft, setSpotlightDraft] = useState({});
  const [photoUploading, setPhotoUploading] = useState(false);
  const [newRolesCount, setNewRolesCount] = useState(0);
  const [showBadgeInfo, setShowBadgeInfo] = useState(false);
  const [selectedBadgeId, setSelectedBadgeId] = useState(null);
  const [earnedSnapshot, setEarnedSnapshot] = useState(null); // null = not yet captured (suppress first-load celebration)
  const [celebrationQueue, setCelebrationQueue] = useState([]); // badge ids to celebrate, in order
  const celebratingBadge = celebrationQueue[0] || null;

  // Detect newly-earned badges and queue celebrations
  // Wait for stage to settle on profile/welcome — during "loading" we get many
  // intermediate state updates that would each look like fresh "new" badges.
  useEffect(() => {
    if (!obm) return;
    if (stage !== "profile" && stage !== "welcome") return;
    const earned = earnedBadgeIds(profile, spotlight);
    if (earnedSnapshot === null) {
      // First stable snapshot after login — record without celebrating
      setEarnedSnapshot(earned);
      return;
    }
    const newlyEarned = [...earned].filter(id => !earnedSnapshot.has(id));
    if (newlyEarned.length) {
      setCelebrationQueue(q => [...q, ...newlyEarned]);
    }
    if (earned.size !== earnedSnapshot.size || newlyEarned.length || [...earnedSnapshot].some(id => !earned.has(id))) {
      setEarnedSnapshot(earned);
    }
  }, [profile, spotlight, obm, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fire confetti each time a celebration becomes active
  useEffect(() => {
    if (celebratingBadge) fireBadgeConfetti();
  }, [celebratingBadge]);

  async function uploadPhoto() {
    if (!obm) return;
    setErr("");
    try {
      await loadCloudinaryWidget();
    } catch (e) {
      setErr("Couldn't load the upload widget — check your connection.");
      return;
    }
    openCloudinaryAvatarWidget(
      async (secureUrl) => {
        setPhotoUploading(true);
        // Optimistic local update
        setProfile(p => ({...p, photoUrl: secureUrl}));
        try {
          await atFetch(`/${TBL_PM}/${obm.id}`, {
            method: "PATCH",
            body: JSON.stringify({ fields: { "Profile pic": [{ url: secureUrl }] } }),
          });
        } catch (e) {
          setErr("Photo saved to Cloudinary but Airtable update failed: " + e.message);
        } finally {
          setPhotoUploading(false);
        }
      },
      (e) => {
        console.error("Cloudinary error (full):", e);
        const detail =
          e?.statusText ||
          e?.message ||
          e?.status?.message ||
          (typeof e === "string" ? e : null) ||
          (() => { try { return JSON.stringify(e); } catch { return "unknown"; } })();
        setErr(`Photo upload failed: ${detail}. Check the browser console for full details, and verify the Cloudinary preset "${CLOUDINARY_PRESET}" is set to Unsigned.`);
      }
    );
  }

  // Lazy-load spotlight when user clicks the tab
  useEffect(() => {
    if (tab !== "spotlight" || spotlightLoaded || !obm) return;
    (async () => {
      setSpotlightLoading(true);
      try {
        const rec = await getSpotlight(email);
        setSpotlight(rec);
      } catch (e) {
        console.error("Spotlight load failed:", e);
        setErr("Couldn't load your Spotlight: " + e.message);
      } finally {
        setSpotlightLoading(false);
        setSpotlightLoaded(true);
      }
    })();
  }, [tab, spotlightLoaded, obm, email]);
  const hours = ["5 hours per week","10 hours per week","20 hours per week","30 hours per week"];

  async function saveOnboardStep() {
    setOnboardSaving(true);
    try {
      await saveProfile(obm.id, profile);
    } catch (e) {
      console.error("Onboarding save failed:", e);
    } finally {
      setOnboardSaving(false);
    }
  }

  async function requestCode() {
    setErr(""); setNotFound(false); setCodeError("");
    if (!email.includes("@")) { setErr("Please enter a valid email."); return; }
    setSendingCode(true);
    try {
      const res = await fetch("/.netlify/functions/send-login-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.toLowerCase().trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) { setErr(data.error || "Couldn't send the code. Please try again."); return; }
      setCode("");
      setStage("code-entry");
      setResendCooldown(30);
      const t = setInterval(() => {
        setResendCooldown(s => {
          if (s <= 1) { clearInterval(t); return 0; }
          return s - 1;
        });
      }, 1000);
    } catch (e) {
      setErr("Couldn't reach the server: " + e.message);
    } finally {
      setSendingCode(false);
    }
  }

  async function verifyAndLogin() {
    setCodeError("");
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setCodeError("Enter the 6-digit code from your email.");
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch("/.netlify/functions/verify-login-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.toLowerCase().trim(), code: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCodeError(data.error || "Invalid code.");
        return;
      }
      await loadProfile();
    } catch (e) {
      setCodeError("Couldn't verify: " + e.message);
    } finally {
      setVerifying(false);
    }
  }

  async function loadProfile(emailArg) {
    const e = (emailArg || email).toLowerCase().trim();
    if (emailArg) setEmail(emailArg);
    setErr("");
    setStage("loading");
    try {
      // Persist a 30-day session
      try {
        localStorage.setItem("prowess-session", JSON.stringify({
          email: e,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }));
      } catch {}

      // Load taxonomy fresh every login
      const [p, s, t, indRec, rec] = await Promise.all([
        getSkills(TBL_PRIMARY, "Skill Name"),
        getSkills(TBL_SECONDARY, "Label"),
        getSkills(TBL_TECH, "Tech name"),
        // Load industry options from Industry knowledge table
        atFetch(`/${TBL_INDUSTRY}?fields%5B%5D=Industry%20name&maxRecords=200`).then(d =>
          (d.records || [])
            .map(r => ({ id: r.id, name: (r.fields["Industry name"] || "").trim() }))
            .filter(o => o.name)
            .sort((a, b) => a.name.localeCompare(b.name))
        ),
        findByEmail(e),
      ]);
      setPOpts(p); setSOpts(s); setTOpts(t); setIndOpts(indRec);
      if (!rec) {
        try { localStorage.removeItem("prowess-session"); } catch {}
        setNotFound(true); setStage("email"); return;
      }
      setObm(rec);
      const [matchResult, spot] = await Promise.all([
        getMatches(rec.id),
        getSpotlight(e).catch(() => null),
      ]);
      const m = matchResult.responseYes;
      setRoles(m);
      setAwaitingRoles(matchResult.awaiting);
      setSpotlight(spot);
      setSpotlightLoaded(true);
      // "New since last visit" tracking via localStorage
      const lastVisitKey = `prowess-last-visit-${e}`;
      const lastVisitISO = localStorage.getItem(lastVisitKey);
      const lastVisit = lastVisitISO ? new Date(lastVisitISO) : null;
      const newCount = lastVisit ? m.filter(r => r.createdTime && new Date(r.createdTime) > lastVisit).length : 0;
      setNewRolesCount(newCount);
      localStorage.setItem(lastVisitKey, new Date().toISOString());
      const f = rec.fields;
      const pIds = new Set(f[F_PRIMARY]   || []);
      const sIds = new Set(f[F_SECONDARY] || []);
      const tIds = new Set(f[F_TECH]      || []);
      const iIds = new Set(f["Industry knowledge 2"] || f[F_INDUSTRY] || []);
      const selName = v => v?.name || v || null;
      // Airtable proxy returns fields by NAME not ID
      // Use both field names and IDs as fallback
      setProfile({
        primarySkills:   p.filter(o => pIds.has(o.id)),
        secondarySkills: s.filter(o => sIds.has(o.id)),
        techSkills:      t.filter(o => tIds.has(o.id)),
        hours: f[F_HOURS] || f["Availability Hours"] || [],
        rate:  (f[F_RATE] ?? f["Rate"]) != null ? String(f[F_RATE] ?? f["Rate"]) : "",
        notes: f[F_NOTES] || f["Notes"] || "",
        discPrimary:   selName(f["Primary Disc Trait"]   || f[F_DISC_PRIMARY]),
        discSecondary: selName(f["Secondary Disc Trait"] || f[F_DISC_SECONDARY]),
        vark:          selName(f["Vark Style"]           || f[F_VARK]),
        photoUrl:      (f["Profile pic"] || f[F_PHOTO])?.[0]?.url || null,
        firstName:     f["First Name"]    || "",
        lastName:      f["Last Name"]     || "",
        city:          f["City2"]          || f[F_CITY]  || "",
        state:         f["State2"]         || f[F_STATE] || "",
        facts:         f["Facts & Hobbies"]|| f[F_FACTS] || "",
        industries:    indRec.filter(o => iIds.has(o.id)),
      });
      // First-time user if no skills at all
      const hasSkills = 
        p.some(o => pIds.has(o.id)) ||
        s.some(o => sIds.has(o.id)) ||
        t.some(o => tIds.has(o.id));
      setStage(hasSkills ? "profile" : "welcome");
    } catch(err) {
      console.error(err);
      setErr("Something went wrong: " + err.message);
      setStage("email");
    }
  }

  async function upload(file) {
    if (!file) return;
    setParsing(true); setParseComplete(false); setErr("");
    try {
      const text = await extractText(file);
      if (text.length < 50) { setErr("Couldn't read this file — try a .txt or .docx version."); setParsing(false); return; }
      const result = await parseResume(text, pOpts, sOpts, tOpts, indOpts);
      setParseComplete(true);
      await new Promise(r => setTimeout(r, 500));
      setSug(result);
      setSugStep("found"); // "found" | "maybe"
      setEMode("review");
    } catch(e) {
      setErr("Resume parse failed: " + e.message);
    } finally {
      setParsing(false);
      setParseComplete(false);
    }
  }

  async function addToExisting(sel) {
    const merge = (a, b) => { const ids = new Set(a.map(x => x.id)); return [...a, ...b.filter(x => !ids.has(x.id))]; };
    const next = {
      ...profile,
      primarySkills:   merge(profile.primarySkills, sel.primarySkills),
      secondarySkills: merge(profile.secondarySkills, sel.secondarySkills),
      techSkills:      merge(profile.techSkills, sel.techSkills),
      industries:      merge(profile.industries, sug.industries || []),
    };
    setProfile(next);
    setSug(null); setSugStep("found"); setEMode(null);
    setSaving(true);
    try {
      await saveProfile(obm.id, next);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      setErr("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function replaceAll(sel) {
    const next = {
      ...profile,
      primarySkills:   sel.primarySkills,
      secondarySkills: sel.secondarySkills,
      techSkills:      sel.techSkills,
      industries:      sug.industries || [],
    };
    setProfile(next);
    setSug(null); setSugStep("found"); setEMode(null);
    setSaving(true);
    try {
      await saveProfile(obm.id, next);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      setErr("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  // Inline-edit helpers — one card edits at a time
  function startCardEdit(cardId) {
    setEditSnapshot(profile);
    setEditingCard(cardId);
    setErr("");
  }

  function cancelCardEdit() {
    if (editSnapshot) setProfile(editSnapshot);
    setEditingCard(null);
    setEditSnapshot(null);
  }

  async function saveCard() {
    setCardSaving(true); setErr("");
    try {
      await saveProfile(obm.id, profile);
      const id = editingCard;
      setEditingCard(null);
      setEditSnapshot(null);
      setCardSavedAt(id);
      setTimeout(() => setCardSavedAt(p => (p === id ? null : p)), 2500);
    } catch (e) {
      setErr("Save failed: " + e.message);
    } finally {
      setCardSaving(false);
    }
  }

  function reset() { setEMode(null); setSug(null); setErr(""); cancelCardEdit(); }

  // Inline edit/save/cancel button block for each editable card header
  const cardActions = (id) => {
    if (editingCard === id) {
      return (
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-g btn-sm" onClick={cancelCardEdit} disabled={cardSaving}>Cancel</button>
          <button className="btn btn-p btn-sm" onClick={saveCard} disabled={cardSaving} style={{padding:"8px 18px"}}>
            {cardSaving ? <><span className="spin"></span> Saving</> : "Save"}
          </button>
        </div>
      );
    }
    if (editingCard !== null) return null;
    return (
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {cardSavedAt === id && <span style={{color:"#5EA8A1",fontSize:12,fontWeight:600,fontFamily:"Raleway,sans-serif"}}>✓ Saved</span>}
        <button className="btn btn-g btn-sm" onClick={() => startCardEdit(id)}>✏️ Edit</button>
      </div>
    );
  };
  const isEditing = (id) => editingCard === id;

  // Display name helpers — prefer First + Last, then formula Name, then email
  const f = obm?.fields || {};
  const fullName = [profile.firstName || f["First Name"], profile.lastName || f["Last Name"]].filter(Boolean).join(" ");
  const displayName = fullName || f["Name"] || (email ? email.split("@")[0] : "");
  const avatarInitial = ((profile.firstName || f["First Name"] || f["Name"] || email || "?").trim().charAt(0) || "?").toUpperCase();

  return (
    <>
      <style>{css}</style>
      <div className="wrap">
        <header className="hdr">
          <div><div className="logo">Prowess Project</div><div className="logo-sub">OBM Profile Portal</div></div>
          {obm && <button className="btn btn-g btn-sm" onClick={() => {
            try { localStorage.removeItem("prowess-session"); } catch {}
            setStage("email"); setObm(null); setEmail(""); setCode(""); setCodeError(""); setNotFound(false);
            setEarnedSnapshot(null); setCelebrationQueue([]);
            reset();
          }}>Sign Out</button>}
        </header>
        <div className="teal-bar"></div>
        <main className="main">

          {/* EMAIL */}
          {stage === "email" && <>
            <div className="hero"><div className="hero-title">OBM Profile Portal</div><div className="hero-sub">Manage your profile and track your matched opportunities</div></div>
            <div className="auth">
              <h1 className="auth-title">Sign In</h1>
              <p className="auth-sub">Enter your email and we'll send you a 6-digit code to sign in.</p>
              {err && <div className="err">{err}</div>}
              {notFound && (
                <div className="warn" style={{marginBottom:20}}>
                  <strong>We couldn't find a profile for that email</strong>
                  <p>Use the same email you sign in with for <strong>OBM University</strong> — that's the one Prowess has on file. Check for typos and try again.</p>
                </div>
              )}
              <div style={{marginBottom:20}}><label className="fl">Email Address</label><input className="fi" type="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key==="Enter"&&!sendingCode&&requestCode()} autoFocus /></div>
              <button className="btn btn-p" onClick={requestCode} disabled={sendingCode}>
                {sendingCode ? <><span className="spin"></span> Sending code...</> : "Email Me a Sign-In Code"}
              </button>
              {notFound && (() => {
                const subject = "Interested in joining Prowess Project";
                const body = `Hi Leah,\n\nI tried to sign in to the OBM Portal with ${email} but I'm not in the system yet. I'd love to learn more about joining the Prowess Project talent pool as an Online Business Manager.\n\nThanks!`;
                const mailto = `mailto:leah@prowessproject.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                return (
                  <div style={{marginTop:28,padding:"22px 24px",background:"#FAFFFE",border:"1px solid rgba(127,191,184,.35)",borderRadius:10}}>
                    <div style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:15,color:"#1A1A1A",marginBottom:6}}>
                      Not a Prowess member yet?
                    </div>
                    <p style={{fontSize:13,color:"#6B6B6B",lineHeight:1.6,marginBottom:14}}>
                      If you're not part of the Prowess talent pool yet but want to learn more about becoming an Online Business Manager with us, send Leah a quick note.
                    </p>
                    <a href={mailto} className="btn btn-p" style={{textDecoration:"none",width:"auto",display:"inline-flex"}}>
                      📧 Email leah@prowessproject.com
                    </a>
                  </div>
                );
              })()}
            </div>
          </>}

          {/* CODE ENTRY */}
          {stage === "code-entry" && <>
            <div className="hero"><div className="hero-title">Check Your Email</div><div className="hero-sub">We sent a 6-digit code to {email}</div></div>
            <div className="auth">
              <h1 className="auth-title">Enter Your Code</h1>
              <p className="auth-sub">The code expires in 10 minutes. Check your spam folder if you don't see it.</p>
              {codeError && <div className="err">{codeError}</div>}
              <div style={{marginBottom:20}}>
                <label className="fl">6-Digit Code</label>
                <input
                  className="fi"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={e => e.key === "Enter" && !verifying && verifyAndLogin()}
                  autoFocus
                  style={{fontSize:22,letterSpacing:".4em",textAlign:"center",fontFamily:"ui-monospace,Menlo,Consolas,monospace"}}
                />
              </div>
              <button className="btn btn-p" onClick={verifyAndLogin} disabled={verifying || code.length !== 6}>
                {verifying ? <><span className="spin"></span> Verifying...</> : "Verify & Sign In"}
              </button>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:18,fontSize:13}}>
                <button
                  type="button"
                  onClick={() => { setStage("email"); setCode(""); setCodeError(""); }}
                  style={{background:"none",border:"none",padding:0,cursor:"pointer",color:"#6B6B6B",textDecoration:"underline"}}
                >
                  ← Use a different email
                </button>
                <button
                  type="button"
                  onClick={requestCode}
                  disabled={resendCooldown > 0 || sendingCode}
                  style={{background:"none",border:"none",padding:0,cursor: resendCooldown > 0 || sendingCode ? "not-allowed" : "pointer",color:resendCooldown > 0 || sendingCode ? "#A0A0A0" : "#5EA8A1",fontWeight:600,textDecoration:resendCooldown > 0 ? "none" : "underline"}}
                >
                  {sendingCode ? "Sending..." : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                </button>
              </div>
            </div>
          </>}

          {/* LOADING */}
          {stage === "loading" && <div style={{textAlign:"center",paddingTop:80}}><div className="spin" style={{width:40,height:40,borderWidth:3,margin:"0 auto 20px"}}></div><p style={{color:"#6B6B6B"}}>Loading your profile...</p></div>}

          {/* WELCOME — first time, no skills yet */}
          {stage === "welcome" && obm && (
            <div>
              {/* Personalized hero */}
              <div className="welcome-hero">
                <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20,position:"relative",zIndex:1}}>
                  <button
                    type="button"
                    onClick={uploadPhoto}
                    disabled={photoUploading}
                    title={profile.photoUrl ? "Change photo" : "Add a photo"}
                    style={{position:"relative",background:"none",border:"none",padding:0,cursor:photoUploading?"wait":"pointer",borderRadius:"50%"}}
                  >
                    {profile.photoUrl
                      ? <img src={profile.photoUrl} alt="" style={{width:56,height:56,borderRadius:"50%",objectFit:"cover",border:"2px solid rgba(255,255,255,.6)",display:"block"}} />
                      : <div style={{width:56,height:56,borderRadius:"50%",background:"rgba(255,255,255,.25)",border:"2px solid rgba(255,255,255,.5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,color:"#fff",fontFamily:"Raleway,sans-serif",fontWeight:700}}>
                          {avatarInitial}
                        </div>
                    }
                    <div style={{position:"absolute",bottom:-2,right:-2,width:22,height:22,borderRadius:"50%",background:"#fff",border:"2px solid #7FBFB8",display:"flex",alignItems:"center",justifyContent:"center",color:"#5EA8A1",fontSize:10,boxShadow:"0 1px 3px rgba(0,0,0,.18)"}}>
                      {photoUploading ? <span className="spin" style={{width:9,height:9,borderWidth:2}}></span> : "📷"}
                    </div>
                  </button>
                  <div>
                    <div style={{fontSize:13,color:"rgba(255,255,255,.75)",marginBottom:2}}>Welcome to Prowess</div>
                    <div style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:20,color:"#fff"}}>
                      {displayName}
                    </div>
                  </div>
                </div>
                <div className="welcome-title">Let's build your profile.</div>
                <div className="welcome-sub">
                  Your profile is how Prowess matches you to the right client opportunities. It takes about 3 minutes — and the best part is Prowess Scout, powered by Claude, does most of the work.
                </div>
              </div>

              {/* Onboarding step card */}
              <div className="welcome-card" style={{marginBottom:16}}>
                {/* Progress */}
                <div style={{marginBottom:24}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <span style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:11,letterSpacing:".12em",textTransform:"uppercase",color:"#5EA8A1"}}>
                      Step {onboardStep} of 4
                    </span>
                  </div>
                  <div style={{height:6,background:"#F1F2F2",borderRadius:999,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${(onboardStep/4)*100}%`,background:"linear-gradient(90deg,#7FBFB8,#5EA8A1)",borderRadius:999,transition:"width .3s ease-out"}} />
                  </div>
                </div>

                {/* Step 1: Location */}
                {onboardStep === 1 && (
                  <div>
                    <div style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:20,marginBottom:6,color:"#1A1A1A"}}>Where are you based?</div>
                    <div style={{fontSize:13,color:"#6B6B6B",lineHeight:1.55,marginBottom:20}}>
                      This helps Prowess match you to clients in your region or time zone.
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
                      <div>
                        <label className="fl">City</label>
                        <input className="fi" placeholder="Austin" value={profile.city} onChange={e => setProfile(p => ({...p, city:e.target.value}))} autoFocus />
                      </div>
                      <div>
                        <label className="fl">State</label>
                        <input className="fi" placeholder="Texas" value={profile.state} onChange={e => setProfile(p => ({...p, state:e.target.value}))} />
                      </div>
                    </div>
                    <button className="btn btn-p" disabled={onboardSaving} onClick={async () => { await saveOnboardStep(); setOnboardStep(2); }}>
                      {onboardSaving ? <><span className="spin"></span> Saving...</> : "Next →"}
                    </button>
                  </div>
                )}

                {/* Step 2: Target rate */}
                {onboardStep === 2 && (
                  <div>
                    <div style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:20,marginBottom:6,color:"#1A1A1A"}}>What's your target hourly rate?</div>
                    <div style={{fontSize:13,color:"#6B6B6B",lineHeight:1.55,marginBottom:20}}>
                      Don't worry about getting this perfect — you can always update it later. Most OBMs start between $50–$85/hr.
                    </div>
                    <div style={{marginBottom:20}}>
                      <label className="fl">Preferred Hourly Rate</label>
                      <div className="rate-wrap">
                        <span className="rate-fix rate-l">$</span>
                        <input className="rate-in" type="number" min="0" placeholder="65" value={profile.rate} onChange={e => setProfile(p => ({...p, rate:e.target.value}))} autoFocus />
                        <span className="rate-fix rate-r">/hr</span>
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:16}}>
                      <button className="btn btn-p" style={{width:"auto",flex:1}} disabled={onboardSaving} onClick={async () => { await saveOnboardStep(); setOnboardStep(3); }}>
                        {onboardSaving ? <><span className="spin"></span> Saving...</> : "Next →"}
                      </button>
                      <button onClick={() => setOnboardStep(3)} style={{background:"none",border:"none",color:"#A0A0A0",fontSize:13,cursor:"pointer",textDecoration:"underline"}}>
                        Skip for now
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 3: Facts & hobbies */}
                {onboardStep === 3 && (
                  <div>
                    <div style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:20,marginBottom:6,color:"#1A1A1A"}}>Tell us a little about yourself</div>
                    <div style={{fontSize:13,color:"#6B6B6B",lineHeight:1.55,marginBottom:20}}>
                      This shows on your candidate card. Clients love knowing who they're working with beyond a resume.
                    </div>
                    <div style={{marginBottom:20}}>
                      <label className="fl">Facts &amp; Hobbies</label>
                      <textarea className="fi" placeholder="Share your background, interests, or anything that makes you you..." value={profile.facts} onChange={e => setProfile(p => ({...p, facts:e.target.value}))} style={{minHeight:120,resize:"vertical",lineHeight:1.6}} autoFocus />
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:16}}>
                      <button className="btn btn-p" style={{width:"auto",flex:1}} disabled={onboardSaving} onClick={async () => { await saveOnboardStep(); setOnboardStep(4); }}>
                        {onboardSaving ? <><span className="spin"></span> Saving...</> : "Next →"}
                      </button>
                      <button onClick={() => setOnboardStep(4)} style={{background:"none",border:"none",color:"#A0A0A0",fontSize:13,cursor:"pointer",textDecoration:"underline"}}>
                        Skip for now
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 4: Skills CTA */}
                {onboardStep === 4 && (
                  <div>
                    <div style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:20,marginBottom:6,color:"#1A1A1A"}}>Now let's build your skills</div>
                    <div style={{fontSize:13,color:"#6B6B6B",lineHeight:1.55,marginBottom:20}}>
                      Prowess Scout can read your resume and map your experience to our OBM skill taxonomy — or you can browse and add skills manually.
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                      <button className="btn btn-p" style={{fontSize:13}} onClick={() => {
                        setEMode("resume");
                        setStage("profile");
                      }}>
                        📄 Let Prowess Scout Read My Resume
                      </button>
                      <button className="btn btn-g" style={{fontSize:13}} onClick={() => {
                        setStage("profile");
                        setTimeout(() => startCardEdit("primary"), 0);
                      }}>
                        ✏️ Add Skills Manually
                      </button>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <button onClick={() => setStage("profile")} style={{background:"none",border:"none",color:"#A0A0A0",fontSize:12,cursor:"pointer",textDecoration:"underline"}}>
                        Skip for now — I'll do this later
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Back link */}
              {onboardStep > 1 && (
                <div style={{textAlign:"center",marginBottom:8}}>
                  <button onClick={() => setOnboardStep(s => s - 1)} style={{background:"none",border:"none",color:"#A0A0A0",fontSize:12,cursor:"pointer",textDecoration:"underline"}}>
                    ← Back
                  </button>
                </div>
              )}

              {/* What to expect — keep as reassurance */}
              <div className="welcome-card" style={{marginBottom:24,background:"#E8F4F3",borderColor:"rgba(127,191,184,.4)"}}>
                <div style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:11,letterSpacing:".12em",textTransform:"uppercase",color:"#5EA8A1",marginBottom:14}}>
                  What to expect
                </div>
                <ul style={{margin:0,padding:0,listStyle:"none",fontSize:14,lineHeight:1.6,color:"#1F5C58"}}>
                  {[
                    "This takes about 3 minutes.",
                    "Prowess Scout will read your resume and match your experience to our skill taxonomy — you'll review everything before anything is saved.",
                    "Nothing is permanent — you can always edit your profile after.",
                    "Your profile is only visible to the Prowess team — never to clients until you're matched.",
                  ].map((line,i) => (
                    <li key={i} style={{paddingLeft:24,position:"relative",marginBottom:10}}>
                      <span style={{position:"absolute",left:0,top:0,color:"#7FBFB8",fontWeight:700,fontSize:15}}>✓</span>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* PROFILE */}
          {stage === "profile" && obm && <div>
            {err && <div className="err">{err}</div>}

            {/* HERO CARD — greeting + avatar + strength + badges + actions */}
            {(() => {
              const h = new Date().getHours();
              const tod = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
              const first = (profile.firstName || displayName || "").trim().split(" ")[0];
              const greeting = first ? `Good ${tod}, ${first} 👋` : `Welcome back 👋`;
              const s = computeProfileStrength(profile, spotlight);
              const earned = earnedBadgeIds(profile, spotlight);
              const next = s.nextSteps[0];
              return (
                <div style={{background:"#fff",border:"1px solid #E0E1E1",borderRadius:12,padding:"22px 24px",marginBottom:20}}>
                  {/* Row 1: avatar + greeting + actions */}
                  <div style={{display:"flex",gap:18,alignItems:"flex-start",flexWrap:"wrap",marginBottom:18}}>
                    {/* Avatar — click to upload */}
                    <button
                      type="button"
                      onClick={uploadPhoto}
                      disabled={photoUploading}
                      title={profile.photoUrl ? "Change photo" : "Add a photo"}
                      style={{flexShrink:0,position:"relative",background:"none",border:"none",padding:0,cursor:photoUploading?"wait":"pointer",borderRadius:"50%"}}
                    >
                      {profile.photoUrl
                        ? <img src={profile.photoUrl} alt="" style={{width:72,height:72,borderRadius:"50%",objectFit:"cover",border:"2px solid #7FBFB8",display:"block"}} />
                        : <div style={{width:72,height:72,borderRadius:"50%",background:"#7FBFB8",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,color:"#fff",fontFamily:"Raleway,sans-serif",fontWeight:700,border:"2px dashed rgba(255,255,255,.6)"}}>{avatarInitial}</div>
                      }
                      <div style={{position:"absolute",bottom:-2,right:-2,width:26,height:26,borderRadius:"50%",background:"#7FBFB8",border:"2px solid #fff",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:12,boxShadow:"0 1px 3px rgba(0,0,0,.15)"}}>
                        {photoUploading ? <span className="spin" style={{width:11,height:11,borderWidth:2}}></span> : "📷"}
                      </div>
                    </button>
                    {/* Greeting + status */}
                    <div style={{flex:1,minWidth:0}}>
                      <h1 className="pg" style={{marginBottom:4}}>{greeting}</h1>
                      {newRolesCount > 0 && (
                        <div style={{fontSize:14,color:"#5EA8A1",fontWeight:600,marginBottom:4}}>
                          {newRolesCount} new role match{newRolesCount === 1 ? "" : "es"} since your last visit.
                        </div>
                      )}
                      <div style={{fontSize:13,color:"#6B6B6B",display:"flex",flexWrap:"wrap",gap:"4px 12px",alignItems:"center"}}>
                        <span>{email}</span>
                        {(profile.city || profile.state) && <span>📍 {[profile.city, profile.state].filter(Boolean).join(", ")}</span>}
                        {profile.discPrimary && <span style={{color:"#1F5C58",fontWeight:600}}>DISC: {profile.discPrimary}{profile.discSecondary ? ` / ${profile.discSecondary}` : ""}</span>}
                        {profile.vark && <span style={{color:"#4A4A4A",fontWeight:600}}>VARK: {profile.vark}</span>}
                      </div>
                      {!profile.photoUrl && (
                        <div style={{fontSize:12,color:"#5EA8A1",marginTop:8,fontStyle:"italic"}}>
                          Tap your photo to add a headshot — your candidate card looks more personal with a face.
                        </div>
                      )}
                    </div>
                    {/* Action chips */}
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-start"}}>
                      <button
                        type="button"
                        className="btn btn-g btn-sm"
                        onClick={() => { reset(); setEMode("resume"); setTab("profile"); }}
                      >📄 Update Resume</button>
                    </div>
                  </div>

                  {/* Row 2: Profile Strength */}
                  <div style={{borderTop:"1px solid #F1F2F2",paddingTop:16,marginBottom:14}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{background:s.tier.color,color:"#fff",fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:11,letterSpacing:".08em",textTransform:"uppercase",padding:"4px 12px",borderRadius:20}}>
                          {s.tier.label}
                        </span>
                        <span style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:15,color:"#1A1A1A"}}>
                          Profile Strength · {s.pct}%
                        </span>
                      </div>
                      <span style={{fontSize:12,color:"#6B6B6B"}}>{s.checks.filter(c => c.done).length} of {s.checks.length}</span>
                    </div>
                    <div style={{height:8,background:"#F1F2F2",borderRadius:999,overflow:"hidden",marginBottom:10}}>
                      <div style={{height:"100%",width:`${s.pct}%`,background:s.tier.color,borderRadius:999,transition:"width .3s ease-out"}} />
                    </div>
                    <div style={{fontSize:13,color:"#4A4A4A",lineHeight:1.5,marginBottom: next ? 10 : 0}}>{s.tier.message}</div>
                    {next && (
                      <button
                        type="button"
                        onClick={() => {
                          setTab("profile");
                          if (next.section === "photo")     { uploadPhoto(); return; }
                          if (next.section === "spotlight") { setTab("spotlight"); return; }
                          if (next.section === "info" || next.section === "details") { startCardEdit("details"); return; }
                          // skills
                          startCardEdit("skills");
                        }}
                        style={{display:"flex",alignItems:"center",gap:8,width:"100%",textAlign:"left",background:"#F8FFFE",border:"1px solid rgba(127,191,184,.3)",borderRadius:8,padding:"10px 14px",cursor:"pointer",fontSize:14,color:"#1A1A1A"}}
                      >
                        <span style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:10,letterSpacing:".12em",textTransform:"uppercase",color:"#5EA8A1"}}>Next</span>
                        <span style={{flex:1}}>{next.action}</span>
                        <span style={{color:"#A0A0A0"}}>→</span>
                      </button>
                    )}
                  </div>

                  {/* Row 3: Badges */}
                  <div style={{borderTop:"1px solid #F1F2F2",paddingTop:14}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                      <div style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:11,letterSpacing:".12em",textTransform:"uppercase",color:"#A0A0A0"}}>
                        🏆 Achievements · {earned.size} of {BADGES.length}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowBadgeInfo(b => !b)}
                        style={{background:"none",border:"none",padding:0,cursor:"pointer",fontSize:11,color:"#5EA8A1",fontFamily:"Raleway,sans-serif",fontWeight:600,letterSpacing:".04em",textDecoration:"underline"}}
                      >
                        {showBadgeInfo ? "Hide details" : "About these badges"}
                      </button>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {BADGES.map(b => {
                        const on = earned.has(b.id);
                        const active = selectedBadgeId === b.id;
                        return (
                          <button
                            key={b.id}
                            type="button"
                            title={b.desc}
                            onClick={() => setSelectedBadgeId(active ? null : b.id)}
                            style={{
                              display:"inline-flex",alignItems:"center",gap:6,
                              padding:"4px 10px 4px 6px",borderRadius:20,
                              background: on ? "#E8F4F3" : "#F8F8F8",
                              border: `1px solid ${active ? "#5EA8A1" : (on ? "rgba(127,191,184,.5)" : "#E0E1E1")}`,
                              boxShadow: active ? "0 0 0 2px rgba(127,191,184,.25)" : "none",
                              opacity: on ? 1 : 0.7,
                              cursor:"pointer",fontFamily:"inherit",transition:"all .15s",
                            }}
                          >
                            <span style={{fontSize:14,filter: on ? "none" : "grayscale(80%)",lineHeight:1}}>{b.emoji}</span>
                            <span style={{fontSize:11,fontWeight:600,fontFamily:"Raleway,sans-serif",color: on ? "#1F5C58" : "#6B6B6B"}}>{b.name}</span>
                          </button>
                        );
                      })}
                    </div>
                    {selectedBadgeId && (() => {
                      const b = BADGES.find(x => x.id === selectedBadgeId);
                      if (!b) return null;
                      const on = earned.has(b.id);
                      return (
                        <div style={{marginTop:10,padding:"10px 14px",background:"#FAFFFE",border:"1px solid rgba(127,191,184,.3)",borderRadius:8,display:"flex",gap:10,alignItems:"flex-start",fontSize:13,lineHeight:1.5}}>
                          <span style={{fontSize:16,flexShrink:0,filter:on?"none":"grayscale(80%)"}}>{b.emoji}</span>
                          <div style={{flex:1,minWidth:0}}>
                            <div>
                              <strong style={{fontFamily:"Raleway,sans-serif",color:"#1A1A1A"}}>{b.name}</strong>
                              <span style={{color:on?"#5EA8A1":"#A0A0A0",fontWeight:600,marginLeft:8,fontSize:11,textTransform:"uppercase",letterSpacing:".06em"}}>{on ? "✓ Earned" : "Locked"}</span>
                            </div>
                            <div style={{color:"#6B6B6B",marginTop:2}}>{b.desc}</div>
                          </div>
                          <button type="button" onClick={() => setSelectedBadgeId(null)} aria-label="Close" style={{background:"none",border:"none",padding:"2px 6px",cursor:"pointer",color:"#A0A0A0",fontSize:16,lineHeight:1}}>×</button>
                        </div>
                      );
                    })()}
                    {showBadgeInfo && (
                      <div style={{marginTop:12,padding:"12px 14px",background:"#FAFAFA",border:"1px solid #E0E1E1",borderRadius:8}}>
                        <div style={{display:"grid",gap:8}}>
                          {BADGES.map(b => {
                            const on = earned.has(b.id);
                            return (
                              <div key={b.id} style={{display:"flex",gap:10,alignItems:"flex-start",fontSize:13,lineHeight:1.5}}>
                                <span style={{fontSize:16,filter:on?"none":"grayscale(80%)",opacity:on?1:0.5,flexShrink:0}}>{b.emoji}</span>
                                <div>
                                  <strong style={{fontFamily:"Raleway,sans-serif",color:"#1A1A1A"}}>{b.name}</strong>
                                  <span style={{color:on?"#5EA8A1":"#A0A0A0",fontWeight:600,marginLeft:8,fontSize:11,textTransform:"uppercase",letterSpacing:".06em"}}>{on ? "✓ Earned" : "Locked"}</span>
                                  <div style={{color:"#6B6B6B",marginTop:2}}>{b.desc}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}


            <div className="tabs">
              <button className={`tab ${tab==="profile"?"on":""}`} onClick={() => setTab("profile")}>My Profile</button>
              <button className={`tab ${tab==="roles"?"on":""}`} onClick={() => setTab("roles")}>
                My Roles
                {awaitingRoles.length > 0 && (
                  <span title={`${awaitingRoles.length} role${awaitingRoles.length===1?"":"s"} awaiting your response`} style={{marginLeft:6,display:"inline-flex",alignItems:"center",gap:3,background:"#F59E0B",color:"#fff",fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:10,letterSpacing:".04em"}}>
                    ⭐ {awaitingRoles.length}
                  </span>
                )}
                {awaitingRoles.length === 0 && roles.length > 0 && ` (${roles.length})`}
              </button>
              <button className={`tab ${tab==="spotlight"?"on":""}`} onClick={() => setTab("spotlight")}>My Spotlight ✨</button>
            </div>

            {tab === "profile" && <>

              {/* Resume upload */}
              {eMode==="resume" && <div className="card" style={{marginBottom:24}}>
                <div className="ch">
                  <span className="ct">Let Prowess Scout Read Your Resume</span>
                  <button className="btn btn-g btn-sm" onClick={() => setEMode(null)}>Cancel</button>
                </div>
                {parsing
                  ? <ParsingProgress complete={parseComplete} />
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
              {eMode==="review" && sug && <SugReview sug={sug} step={sugStep} onStepChange={setSugStep} onAdd={addToExisting} onReplace={replaceAll} onManual={() => { setSug(null); setSugStep("found"); setEMode(null); }} onReupload={() => { setSug(null); setSugStep("found"); setEMode("resume"); }} />}

              {/* Skills + Industries + Availability + Details cards — only when not in resume/review */}
              {!eMode && <>
                <div className={`card ${isEditing("primary")?"ed":""}`}>
                  <div className="ch"><span className={`ct ${isEditing("primary")?"on":""}`}>Primary Skills</span>{cardActions("primary")}</div>
                  <SkillPicker label="Primary Skills" selected={profile.primarySkills} options={pOpts} onChange={v => setProfile(p => ({...p, primarySkills:v}))} editing={isEditing("primary")} catMap={SKILL_CATS} />
                </div>
                <div className={`card ${isEditing("secondary")?"ed":""}`}>
                  <div className="ch"><span className={`ct ${isEditing("secondary")?"on":""}`}>Secondary Skills</span>{cardActions("secondary")}</div>
                  <SkillPicker label="Secondary Skills" selected={profile.secondarySkills} options={sOpts} onChange={v => setProfile(p => ({...p, secondarySkills:v}))} editing={isEditing("secondary")} catMap={SKILL_CATS} />
                </div>
                <div className={`card ${isEditing("tech")?"ed":""}`}>
                  <div className="ch"><span className={`ct ${isEditing("tech")?"on":""}`}>Technology Skills</span>{cardActions("tech")}</div>
                  <SkillPicker label="Technology Skills" selected={profile.techSkills} options={tOpts} onChange={v => setProfile(p => ({...p, techSkills:v}))} editing={isEditing("tech")} catMap={TECH_CATS} />
                </div>
                <div className={`card ${isEditing("industries")?"ed":""}`}>
                  <div className="ch"><span className={`ct ${isEditing("industries")?"on":""}`}>Industry Experience</span>{cardActions("industries")}</div>
                  {isEditing("industries") ? (
                    <div>
                      <div className="tags" style={{marginBottom: profile.industries.length ? 12 : 0}}>
                        {profile.industries.map(ind => (
                          <span key={ind.id} className="tag-e">
                            {ind.name}
                            <button className="del" onClick={() => setProfile(p => ({...p, industries: p.industries.filter(x => x.id !== ind.id)}))}>✕</button>
                          </span>
                        ))}
                      </div>
                      {profile.industries.length > 0 && <div className="div-lbl">Add more</div>}
                      <div className="tags">
                        {indOpts
                          .filter(o => !profile.industries.some(i => i.id === o.id))
                          .map(o => (
                            <button key={o.id} className="opt"
                              onClick={() => setProfile(p => ({...p, industries: [...p.industries, o]}))}>
                              {o.name}
                            </button>
                          ))
                        }
                      </div>
                    </div>
                  ) : (
                    <div className="tags">
                      {profile.industries.length
                        ? profile.industries.map(ind => <span key={ind.id} className="tag">{ind.name}</span>)
                        : <span className="empty">No industry experience added yet</span>
                      }
                    </div>
                  )}
                </div>

                <div className={`card ${isEditing("availability")?"ed":""}`}>
                  <div className="ch"><span className={`ct ${isEditing("availability")?"on":""}`}>Availability</span>{cardActions("availability")}</div>
                  {isEditing("availability")
                    ? <div className="tags">{hours.map(h => (
                        <button key={h} className={profile.hours.includes(h)?"tag-e":"opt"} onClick={() => setProfile(p => ({...p, hours: p.hours.includes(h) ? p.hours.filter(x=>x!==h) : [...p.hours,h]}))} style={{cursor:"pointer",border: profile.hours.includes(h)?"none":undefined}}>
                          {profile.hours.includes(h) ? <><span>✓ {h}</span><button className="del" onClick={e => { e.stopPropagation(); setProfile(p => ({...p, hours: p.hours.filter(x=>x!==h)})); }}>✕</button></> : `+ ${h}`}
                        </button>
                      ))}</div>
                    : <div className="tags">{profile.hours.length ? profile.hours.map(h => <span key={h} className="tag">{h}</span>) : <span className="empty">Not set</span>}</div>
                  }
                </div>
                <div className={`card ${isEditing("details")?"ed":""}`}>
                  <div className="ch"><span className={`ct ${isEditing("details")?"on":""}`}>Details</span>{cardActions("details")}</div>
                  {isEditing("details") ? (
                    <div style={{display:"grid",gap:16}}>
                      {/* Profile photo */}
                      <div>
                        <label className="fl">Profile Photo</label>
                        <div style={{display:"flex",alignItems:"center",gap:14}}>
                          {profile.photoUrl
                            ? <img src={profile.photoUrl} alt="" style={{width:72,height:72,borderRadius:"50%",objectFit:"cover",border:"2px solid #7FBFB8",display:"block"}} />
                            : <div style={{width:72,height:72,borderRadius:"50%",background:"#7FBFB8",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,color:"#fff",fontFamily:"Raleway,sans-serif",fontWeight:700}}>{avatarInitial}</div>
                          }
                          <button type="button" className="btn btn-g btn-sm" disabled={photoUploading} onClick={uploadPhoto}>
                            {photoUploading ? <><span className="spin"></span> Uploading...</> : (profile.photoUrl ? "Change Photo" : "Upload Photo")}
                          </button>
                        </div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                        <div>
                          <label className="fl">First Name</label>
                          <input className="fi" placeholder="Leah" value={profile.firstName} onChange={e => setProfile(p => ({...p,firstName:e.target.value}))} />
                        </div>
                        <div>
                          <label className="fl">Last Name</label>
                          <input className="fi" placeholder="Herde" value={profile.lastName} onChange={e => setProfile(p => ({...p,lastName:e.target.value}))} />
                        </div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                        <div>
                          <label className="fl">City</label>
                          <input className="fi" placeholder="Austin" value={profile.city} onChange={e => setProfile(p => ({...p,city:e.target.value}))} />
                        </div>
                        <div>
                          <label className="fl">State</label>
                          <input className="fi" placeholder="Texas" value={profile.state} onChange={e => setProfile(p => ({...p,state:e.target.value}))} />
                        </div>
                      </div>
                      <div>
                        <label className="fl">Preferred Hourly Rate</label>
                        <div className="rate-wrap"><span className="rate-fix rate-l">$</span><input className="rate-in" type="number" min="0" placeholder="65" value={profile.rate} onChange={e => setProfile(p => ({...p,rate:e.target.value}))} /><span className="rate-fix rate-r">/hr</span></div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                        <div>
                          <label className="fl">DISC — Primary</label>
                          <select className="fi" value={profile.discPrimary || ""} onChange={e => setProfile(p => ({...p,discPrimary:e.target.value || null}))}>
                            <option value="">Not set</option>
                            {DISC_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="fl">DISC — Secondary</label>
                          <select className="fi" value={profile.discSecondary || ""} onChange={e => setProfile(p => ({...p,discSecondary:e.target.value || null}))}>
                            <option value="">Not set</option>
                            {DISC_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="fl">VARK Learning Style</label>
                        <select className="fi" value={profile.vark || ""} onChange={e => setProfile(p => ({...p,vark:e.target.value || null}))}>
                          <option value="">Not set</option>
                          {VARK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="fl">Facts &amp; Hobbies</label>
                        <textarea className="fi" placeholder="Share a little about yourself..." value={profile.facts} onChange={e => setProfile(p => ({...p,facts:e.target.value}))} style={{minHeight:100,resize:"vertical",lineHeight:1.6}} />
                      </div>
                    </div>
                  ) : (
                    <div style={{display:"grid",gap:14}}>
                      {[
                        ["Name", [profile.firstName, profile.lastName].filter(Boolean).join(" ")],
                        ["Location", [profile.city, profile.state].filter(Boolean).join(", ")],
                        ["Rate",     profile.rate ? `$${profile.rate}/hr` : ""],
                        ["DISC", [profile.discPrimary, profile.discSecondary].filter(Boolean).join(" / ")],
                        ["VARK Learning Style", profile.vark],
                        ["Facts & Hobbies", profile.facts],
                      ].map(([lbl, val]) => val ? (
                        <div key={lbl}>
                          <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:".08em",color:"#A0A0A0",marginBottom:4,fontFamily:"Raleway,sans-serif",fontWeight:600}}>{lbl}</div>
                          <div style={{fontSize:14,color:"#1A1A1A",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{val}</div>
                        </div>
                      ) : null)}
                      {!profile.firstName && !profile.lastName && !profile.city && !profile.rate && !profile.facts && !profile.discPrimary && !profile.vark && <span className="empty">No details added yet</span>}
                    </div>
                  )}
                </div>
              </>}
            </>}

            {tab === "roles" && <div>
              <div className="info" style={{marginBottom:20,fontSize:14,lineHeight:1.55}}>
                <strong style={{fontFamily:"Raleway,sans-serif",display:"block",marginBottom:4}}>How matching works</strong>
                When a new role comes in, Prowess's algorithm scores every OBM and emails the top picks. The roles you've been picked for show up here — you don't need to apply or chase.
              </div>

              {awaitingRoles.length > 0 && (
                <div style={{background:"#FFF8EC",border:"1px solid rgba(245,158,11,.4)",borderRadius:10,padding:"18px 22px",marginBottom:24}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                    <span style={{fontSize:18}}>⭐</span>
                    <span style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:14,color:"#8A5E1A",letterSpacing:".04em",textTransform:"uppercase"}}>
                      Awaiting your response · {awaitingRoles.length}
                    </span>
                  </div>

                  <p style={{fontSize:14,color:"#1A1A1A",lineHeight:1.55,marginBottom:14}}>
                    Prowess emailed you about {awaitingRoles.length === 1 ? "this role" : "these roles"}. Tap <strong>Apply</strong> to respond directly here, or reply to the email — either way works.
                  </p>
                  <div style={{display:"grid",gap:10}}>
                    {awaitingRoles.map(r => {
                      const f = r.fields;
                      const jobUrl = f["Job board link"];
                      const roleName = f["Organization Name"] || f["Name"] || f["Company"] || f["Client Name"] || f["Role Title"] || "";
                      const applyUrl = buildApplyUrl({ roleName, email });
                      return (
                        <div key={r.id} style={{background:"#fff",border:"1px solid rgba(245,158,11,.35)",borderRadius:8,padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
                          <div style={{flex:"1 1 240px",minWidth:0}}>
                            <div className="rn">{roleName || "Ops Partner Role"}</div>
                            <div className="rm">{f["Industry"]||""}{f[F_MATCH_SCORE]?` · ${f[F_MATCH_SCORE]}% match`:""}{r.createdTime?` · Sent ${new Date(r.createdTime).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`:""}</div>
                            {jobUrl && (
                              <a href={jobUrl} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,marginTop:6,fontSize:13,color:"#5EA8A1",fontWeight:600,textDecoration:"none"}}>
                                View Job Posting →
                              </a>
                            )}
                          </div>
                          <a
                            href={applyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{display:"inline-flex",alignItems:"center",gap:6,background:"#F59E0B",color:"#fff",padding:"10px 18px",borderRadius:8,fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",textDecoration:"none",whiteSpace:"nowrap",boxShadow:"0 1px 3px rgba(245,158,11,.3)"}}
                          >
                            Apply →
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {!roles.length && !awaitingRoles.length
                ? <div className="card" style={{textAlign:"center",padding:"48px 24px"}}><div style={{fontSize:32,marginBottom:12}}>🔍</div><p style={{color:"#6B6B6B",fontSize:15,lineHeight:1.6,maxWidth:440,margin:"0 auto"}}>No matches yet. The stronger your profile, the more often you'll be in the top picks Prowess emails when a role lands.</p></div>
                : roles.map(r => {
                    const f = r.fields;
                    const candSel = f["Candidate selection"];
                    const feedback = f["Feedback form Client"];
                    const jobUrl = f["Job board link"];
                    const FEEDBACK_TRIGGER = ["Applied Not selected", "Feedback form Client"];
                    const showFeedback = candSel && FEEDBACK_TRIGGER.includes(candSel) && feedback && String(feedback).trim();
                    const statusLabel = candSel || f["Application status"] || f[F_MATCH_STATUS];
                    return (
                      <div key={r.id} style={{marginBottom:12}}>
                        <div className="role-card" style={showFeedback ? {marginBottom:0,borderRadius:"8px 8px 0 0",borderBottom:"none"} : {marginBottom:0}}>
                          <div>
                            <div className="rn">{f["Organization Name"]||f["Name"]||f["Company"]||f["Client Name"]||f["Role Title"]||"Ops Partner Role"}</div>
                            <div className="rm">{f["Industry"]||""}{f[F_MATCH_SCORE]?` · ${f[F_MATCH_SCORE]}% match`:""}{r.createdTime?` · Sent ${new Date(r.createdTime).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`:""}</div>
                            {jobUrl && (
                              <a href={jobUrl} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,marginTop:6,fontSize:13,color:"#5EA8A1",fontWeight:600,textDecoration:"none"}}>
                                View Job Posting →
                              </a>
                            )}
                          </div>
                          <Badge s={statusLabel} />
                        </div>
                        {showFeedback && (
                          <div style={{background:"#FFF8EC",border:"1px solid rgba(176,125,42,.3)",borderTop:"none",borderRadius:"0 0 8px 8px",padding:"16px 24px"}}>
                            <div style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:11,letterSpacing:".12em",textTransform:"uppercase",color:"#8A5E1A",marginBottom:8}}>
                              Client Feedback
                            </div>
                            <div style={{fontSize:14,color:"#1A1A1A",lineHeight:1.6,whiteSpace:"pre-wrap"}}>
                              {feedback}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
              }
            </div>}

            {tab === "spotlight" && (() => {
              const spotFields = spotlight?.fields || {};
              const filled = SPOT_FIELDS.filter(f => (spotlight ? spotFields[f.key] : false) && String(spotFields[f.key]).trim()).length;
              const pct = Math.round((filled / SPOT_FIELDS.length) * 100);
              const tier = pct > 70 ? "high" : pct >= 40 ? "mid" : "low";
              const tierColor = tier === "high" ? "#7FBFB8" : tier === "mid" ? "#F59E0B" : "#C8C9CA";
              const tierMessage =
                tier === "high" ? "Looking great! Your candidate card will speak for itself when Prowess introduces you." :
                tier === "mid"  ? "Good start — a few more details will make your candidate card pop." :
                                  "The more you share, the more your candidate card has to say when Prowess sends it.";
              return (
                <div style={{paddingBottom: spotlightEditing ? 80 : 0}}>
                  <div className="info" style={{marginBottom:20,fontSize:15,lineHeight:1.6}}>
                    Your Spotlight profile is how Prowess introduces you to clients. Be specific, be real, and be you — clients choose OBMs they connect with, not just ones with the right skills.
                  </div>

                  {spotlightLoading && !spotlightLoaded && (
                    <div style={{textAlign:"center",padding:"40px 0"}}>
                      <div className="spin" style={{width:32,height:32,borderWidth:3,margin:"0 auto 14px"}}></div>
                      <p style={{color:"#6B6B6B",fontSize:14}}>Loading your Spotlight...</p>
                    </div>
                  )}

                  {spotlightLoaded && !spotlightEditing && !spotlight && (
                    <div className="card" style={{textAlign:"center",padding:"40px 24px"}}>
                      <div style={{fontSize:32,marginBottom:12}}>✨</div>
                      <p style={{color:"#1A1A1A",fontSize:15,fontWeight:600,fontFamily:"Raleway,sans-serif",marginBottom:8}}>
                        Your Spotlight isn't set up yet
                      </p>
                      <p style={{color:"#6B6B6B",fontSize:14,lineHeight:1.6,marginBottom:20,maxWidth:440,margin:"0 auto 20px"}}>
                        Your spotlight profile hasn't been set up yet. Fill this in to help Prowess tell your story to clients.
                      </p>
                      <button className="btn btn-p" style={{width:"auto"}} onClick={() => {
                        const blank = {};
                        SPOT_FIELDS.forEach(s => { blank[s.key] = ""; });
                        setSpotlightDraft(blank);
                        setSpotlightEditing(true);
                      }}>
                        Create My Spotlight
                      </button>
                    </div>
                  )}

                  {spotlightLoaded && !spotlightEditing && spotlight && (
                    <div>
                      {/* Completion bar */}
                      <div style={{background:"#FAFFFE",border:"1px solid rgba(127,191,184,.3)",borderRadius:10,padding:"18px 22px",marginBottom:20}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                          <span style={{fontFamily:"Raleway,sans-serif",fontWeight:700,fontSize:15,color:"#1A1A1A"}}>
                            Your spotlight is {pct}% complete
                          </span>
                          <span style={{fontSize:14,color:"#6B6B6B"}}>{filled} of {SPOT_FIELDS.length} fields</span>
                        </div>
                        <div style={{height:8,background:"#F1F2F2",borderRadius:999,overflow:"hidden",marginBottom:12}}>
                          <div style={{height:"100%",width:`${pct}%`,background:tierColor,borderRadius:999,transition:"width .3s ease-out"}} />
                        </div>
                        <div style={{fontSize:14,color:"#6B6B6B",lineHeight:1.55}}>{tierMessage}</div>
                      </div>

                      <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",marginBottom:12,gap:12}}>
                        {spotlightSaved && <span className="ok">✓ Spotlight saved</span>}
                        <button className="btn btn-g btn-sm" onClick={() => {
                          const draft = {};
                          SPOT_FIELDS.forEach(s => { draft[s.key] = spotFields[s.key] || ""; });
                          setSpotlightDraft(draft);
                          setSpotlightEditing(true);
                        }}>Edit Spotlight</button>
                      </div>

                      {SPOT_CARDS.map(card => (
                        <div key={card.title} className="card">
                          <div className="ch"><span className="ct" style={{fontSize:13}}>{card.title}</span></div>
                          <div style={{display:"grid",gap:16}}>
                            {card.fields.map(fld => {
                              const val = spotFields[fld.key];
                              return (
                                <div key={fld.key}>
                                  {card.fields.length > 1 && (
                                    <div style={{fontSize:12,textTransform:"uppercase",letterSpacing:".08em",color:"#A0A0A0",marginBottom:5,fontFamily:"Raleway,sans-serif",fontWeight:600}}>{fld.label}</div>
                                  )}
                                  {val && String(val).trim()
                                    ? <div style={{fontSize:16,color:"#1A1A1A",lineHeight:1.65,whiteSpace:"pre-wrap"}}>{val}</div>
                                    : <div style={{fontSize:15,color:"#A0A0A0",fontStyle:"italic"}}>Not added yet</div>
                                  }
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {spotlightEditing && (
                    <div>
                      {SPOT_CARDS.map(card => (
                        <div key={card.title} className="card ed">
                          <div className="ch"><span className="ct on" style={{fontSize:13}}>{card.title}</span></div>
                          <div style={{display:"grid",gap:22}}>
                            {card.fields.map(fld => (
                              <div key={fld.key}>
                                {card.fields.length > 1 && <label className="fl" style={{fontSize:13}}>{fld.label}</label>}
                                {fld.helper && <div style={{fontSize:14,color:"#6B6B6B",marginBottom:10,lineHeight:1.55}}>{fld.helper}</div>}
                                {fld.multiline
                                  ? <textarea className="fi" value={spotlightDraft[fld.key] || ""} onChange={e => setSpotlightDraft(d => ({...d, [fld.key]: e.target.value}))} style={{minHeight:100,resize:"vertical",lineHeight:1.6,fontSize:16}} />
                                  : <input className="fi" value={spotlightDraft[fld.key] || ""} onChange={e => setSpotlightDraft(d => ({...d, [fld.key]: e.target.value}))} style={{fontSize:16}} />
                                }
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>}
        </main>

        {/* Profile-wide save toast (resume merge / mass actions) */}
        {saved && !spotlightEditing && (
          <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"#1A1A1A",color:"#fff",padding:"10px 20px",borderRadius:24,fontSize:14,fontWeight:600,fontFamily:"Raleway,sans-serif",boxShadow:"0 8px 24px rgba(0,0,0,.18)",zIndex:99}}>
            ✓ Profile saved
          </div>
        )}

        {spotlightEditing && <div className="save-bar">
          <button className="btn btn-g" onClick={() => setSpotlightEditing(false)}>Cancel</button>
          <button className="btn btn-p" style={{width:"auto"}} disabled={spotlightSaving} onClick={async () => {
            setSpotlightSaving(true); setErr("");
            try {
              const fields = {};
              SPOT_FIELDS.forEach(s => { fields[s.key] = spotlightDraft[s.key] || ""; });
              const saved = await saveSpotlight(spotlight?.id, fields, email);
              setSpotlight(saved);
              setSpotlightEditing(false);
              setSpotlightSaved(true);
              setTimeout(() => setSpotlightSaved(false), 4000);
            } catch (e) {
              setErr("Spotlight save failed: " + e.message);
            } finally {
              setSpotlightSaving(false);
            }
          }}>
            {spotlightSaving ? <><span className="spin"></span> Saving...</> : "Save Spotlight"}
          </button>
        </div>}

        {/* Badge celebration overlay */}
        {celebratingBadge && (() => {
          const b = BADGES.find(x => x.id === celebratingBadge);
          if (!b) return null;
          const queueRemaining = celebrationQueue.length - 1;
          const dismiss = () => setCelebrationQueue(q => q.slice(1));
          return (
            <div className="celebration-overlay" onClick={dismiss} role="dialog" aria-modal="true">
              <div className="celebration-card" onClick={e => e.stopPropagation()}>
                <div className="celebration-emoji">{b.emoji}</div>
                <div className="celebration-tag">Achievement Unlocked</div>
                <div className="celebration-name">{b.name}</div>
                <div className="celebration-desc">{b.desc}</div>
                <button className="btn btn-p" style={{width:"auto",padding:"12px 32px"}} onClick={dismiss}>
                  {queueRemaining > 0 ? `Next (${queueRemaining} more)` : "Got it"}
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </>
  );
}
