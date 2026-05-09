import { useState, useEffect } from "react";

const AIRTABLE_BASE = "appaOBVteWvtxFcKr";
const TBL_PM_PROFILE     = "tbl9I3xX3zj9b7FqX";
const TBL_MATCHING       = "tblIoFOOL5BShC3bg";
const TBL_PRIMARY_SKILLS = "tbll8MKHuKiM7YciK";
const TBL_SECONDARY_SKILLS = "tbljqaeAndASfnyc0";
const TBL_TECH_SKILLS    = "tbliJ5Q4yU0m8EnsG";
const F_MATCH_STATUS     = "fldmcFMJQ5uPCCrsE";
const F_MATCH_SCORE      = "fldxXrk9SIv1O8I44";

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

// ── Extract text from file (handles PDF via PDF.js) ───────────────
async function extractTextFromFile(file) {
  if (file.type === "application/pdf") {
    try {
      // Load PDF.js from CDN
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(" ") + "\n";
      }
      return text;
    } catch (e) {
      console.error("PDF extraction failed:", e);
      // Fall back to reading as text
      return await file.text();
    }
  }
  return await file.text();
}

async function claudeParseResume(resumeText, primarySkills, secondarySkills, techSkills) {
  const res = await fetch("/.netlify/functions/claude-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: `You are a resume skills extractor for Prowess Project OBM matching system.
Your job is to read a resume and identify which skills from our taxonomy this person has demonstrated.
Return ONLY valid JSON. No markdown, no explanation, no preamble.
Format: {"primarySkills": ["exact skill name from taxonomy"], "secondarySkills": ["exact skill name from taxonomy"], "techSkills": ["exact tool name from taxonomy"], "rate": "hourly rate if mentioned or empty string"}`,
      messages: [{
        role: "user",
        content: `Read this resume carefully and identify ALL skills this person has demonstrated that match our taxonomy.

IMPORTANT RULES:
- Infer skills from job descriptions, responsibilities, and accomplishments — not just explicit skill lists
- Someone who "managed a team" has "Resource Management" and "Team communications"
- Someone who "oversaw budgets" has "Budgeting" and possibly "Financial reporting/modeling"
- Someone who "managed projects" has "Project Management"
- Someone who "improved processes" has "Process Improvement"
- Someone who "developed strategy" has "Strategic planning"
- Someone who "handled recruiting" has "Recruiting" and "Talent acquisition"
- Someone who "ran social media" has "Social media" and "Content creation"
- Someone who "managed clients" has "Account management" and "Customer Success"
- Someone who "used QuickBooks" or any accounting software has that tool listed
- Be VERY GENEROUS — include a skill if there is any reasonable evidence they have done it
- Return exact skill names as they appear in the taxonomy — copy them exactly including capitalization and spaces
- A skill CAN appear in both primary and secondary lists
- For tech: include every tool mentioned anywhere in the resume

PRIMARY SKILLS TAXONOMY — copy names exactly as shown:
${primarySkills.map(s => s.name).join(" | ")}

SECONDARY SKILLS TAXONOMY — copy names exactly as shown:
${secondarySkills.map(s => s.name).join(" | ")}

TECH SKILLS TAXONOMY — copy names exactly as shown:
${techSkills.map(s => s.name).join(" | ")}

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
      primarySkills: (parsed.primarySkills || []).map(n => matchSkill(n, primarySkills)).filter(Boolean),
      secondarySkills: (parsed.secondarySkills || []).map(n => matchSkill(n, secondarySkills)).filter(Boolean),
      techSkills: (parsed.techSkills || []).map(n => matchSkill(n, techSkills)).filter(Boolean),
      rate: parsed.rate || "",
    };
  } catch {
    return { primarySkills: [], secondarySkills: [], techSkills: [], rate: "" };
  }
}

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
  .section-card.editing-active { border-color: #7FBFB8; background: #FAFFFE; }
  .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .section-title { font-family: 'Raleway', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #6B6B6B; }
  .section-title.active { color: #5EA8A1; }
  .skill-tags { display: flex; flex-wrap: wrap; gap: 8px; }

  /* VIEW MODE — current skills (teal, readable) */
  .skill-tag { background: #E8F4F3; border: 1px solid rgba(127,191,184,0.4); color: #1F5C58; padding: 6px 12px; border-radius: 20px; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 4px; }

  /* EDIT MODE — current skills (solid teal, with visible X) */
  .skill-tag-edit { background: #7FBFB8; border: 1px solid #5EA8A1; color: #FFFFFF; padding: 6px 10px 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .skill-tag-delete { background: rgba(0,0,0,0.2); border: none; color: #FFFFFF; cursor: pointer; font-size: 14px; line-height: 1; padding: 2px 4px; border-radius: 50%; display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; transition: background 0.15s; flex-shrink: 0; }
  .skill-tag-delete:hover { background: rgba(241,93,96,0.8); }

  /* EDIT MODE — available options (gray outline, + prefix) */
  .skill-option { background: #FFFFFF; border: 1.5px solid #C8C9CA; color: #4A4A4A; padding: 6px 12px; border-radius: 20px; font-size: 13px; cursor: pointer; transition: all 0.15s; font-family: 'DM Sans', sans-serif; }
  .skill-option:hover { border-color: #7FBFB8; color: #1F5C58; background: #E8F4F3; }

  /* SUGGESTION MODE — found skills */
  .skill-suggested { background: #7FBFB8; border: 1px solid #5EA8A1; color: #FFFFFF; padding: 6px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.15s; }
  .skill-suggested.deselected { background: #F1F2F2; border-color: #C8C9CA; color: #A0A0A0; text-decoration: line-through; }

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
  .rate-input::placeholder { color: #A0A0A0; }
  .suggestion-card { background: #FFFFFF; border: 2px solid #7FBFB8; border-radius: 8px; padding: 24px; margin-bottom: 16px; }
  .suggestion-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .suggestion-label { font-family: 'Raleway', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #5EA8A1; }
  .suggestion-count { background: #7FBFB8; color: #FFFFFF; font-family: 'Raleway', sans-serif; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 10px; }
  .action-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
  .btn-teal-solid { background: #7FBFB8; border: none; color: #FFFFFF; padding: 10px 18px; border-radius: 6px; font-family: 'Raleway', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; }
  .btn-teal-solid:hover { background: #5EA8A1; }
  .btn-teal-outline { background: transparent; border: 1.5px solid #7FBFB8; color: #5EA8A1; padding: 10px 18px; border-radius: 6px; font-family: 'Raleway', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; }
  .btn-teal-outline:hover { background: #E8F4F3; }
  .edit-legend { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; padding: 10px 14px; background: #F8FFFE; border: 1px solid rgba(127,191,184,0.2); border-radius: 6px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #6B6B6B; }
  .legend-dot-teal { width: 10px; height: 10px; border-radius: 50%; background: #7FBFB8; flex-shrink: 0; }
  .legend-dot-gray { width: 10px; height: 10px; border-radius: 50%; background: #C8C9CA; flex-shrink: 0; }
  .divider-label { font-size: 11px; font-family: 'Raleway', sans-serif; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #A0A0A0; margin: 16px 0 10px; display: flex; align-items: center; gap: 8px; }
  .divider-label::before, .divider-label::after { content: ''; flex: 1; height: 1px; background: #E0E1E1; }
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

// ── Resume Suggestion Review ──────────────────────────────────────
function SuggestionReview({ suggestions, onAddToExisting, onReplaceAll, onStartManual, onReupload }) {
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

  // No skills found
  if (totalFound === 0) {
    return (
      <div>
        <div style={{ background: "#FFF8EC", border: "1px solid rgba(176,125,42,0.3)", borderRadius: 8, padding: "20px 24px", marginBottom: 24 }}>
          <div style={{ fontFamily: "Raleway, sans-serif", fontWeight: 700, fontSize: 14, color: "#8A5E1A", marginBottom: 6 }}>
            No matching skills found
          </div>
          <div style={{ fontSize: 13, color: "#8A5E1A", lineHeight: 1.6 }}>
            Claude couldn't identify skills from this file that match our taxonomy. This can happen if the resume uses different terminology, or if the file couldn't be read correctly. Try editing manually or uploading a different file.
          </div>
        </div>
        <div className="action-row">
          <button className="btn-teal-solid" onClick={onStartManual}>Edit My Skills Manually</button>
          <button className="btn-teal-outline" onClick={onReupload}>Try a Different File</button>
        </div>
      </div>
    );
  }

  const sections = [
    { key: "primarySkills", label: "Primary Skills" },
    { key: "secondarySkills", label: "Secondary Skills" },
    { key: "techSkills", label: "Technology Skills" },
  ];

  return (
    <div>
      <div style={{ background: "#E8F4F3", border: "1px solid rgba(127,191,184,0.4)", borderRadius: 8, padding: "16px 20px", marginBottom: 24 }}>
        <div style={{ fontFamily: "Raleway, sans-serif", fontWeight: 700, fontSize: 14, color: "#1F5C58", marginBottom: 4 }}>
          ✓ Claude found {totalFound} skill{totalFound !== 1 ? "s" : ""} on your resume
        </div>
        <div style={{ fontSize: 13, color: "#5EA8A1", lineHeight: 1.5 }}>
          Tap any skill to deselect it. Then choose how to apply them.
        </div>
      </div>

      {sections.map(({ key, label }) => (
        <div key={key} className="suggestion-card">
          <div className="suggestion-header">
            <span className="suggestion-label">{label}</span>
            <span className="suggestion-count">{suggestions[key].length} found</span>
          </div>
          {suggestions[key].length === 0 ? (
            <span className="empty-state">None found on your resume</span>
          ) : (
            <div className="skill-tags">
              {suggestions[key].map(skill => {
                const isSelected = selected[key].some(s => s.id === skill.id);
                return (
                  <button key={skill.id} onClick={() => toggle(key, skill)}
                    className={isSelected ? "skill-suggested" : "skill-suggested deselected"}>
                    {isSelected ? "✓" : "✕"} {skill.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}

      <div style={{ background: "#FAFAFA", border: "1px solid #E0E1E1", borderRadius: 8, padding: 20, marginBottom: 16 }}>
        <div style={{ fontFamily: "Raleway, sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6B6B6B", marginBottom: 14 }}>
          Apply {totalSelected} selected skill{totalSelected !== 1 ? "s" : ""}:
        </div>
        <div className="action-row">
          <button className="btn-teal-solid" onClick={() => onAddToExisting(selected)}>＋ Add to my existing skills</button>
          <button className="btn-teal-outline" onClick={() => onReplaceAll(selected)}>Replace all my skills</button>
          <button onClick={onStartManual} style={{ background: "none", border: "none", color: "#A0A0A0", fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: "10px 4px" }}>
            Skip — edit manually
          </button>
        </div>
      </div>
      <button onClick={onReupload} style={{ background: "none", border: "none", color: "#A0A0A0", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
        Upload a different file
      </button>
    </div>
  );
}

// ── Skill selector with clear visual distinction ──────────────────
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
      {/* Current skills */}
      {editing && selected.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="skill-tags">
            {selected.map(s => (
              <span key={s.id} className="skill-tag-edit">
                {s.name}
                <button className="skill-tag-delete" onClick={() => onChange(selected.filter(x => x.id !== s.id))} title="Remove">✕</button>
              </span>
            ))}
          </div>
        </div>
      )}
      {!editing && (
        <div className="skill-tags" style={{ marginBottom: selected.length ? 0 : 0 }}>
          {selected.map(s => <span key={s.id} className="skill-tag">{s.name}</span>)}
          {!selected.length && <span className="empty-state">No {label.toLowerCase()} added yet</span>}
        </div>
      )}

      {editing && (
        <div>
          {selected.length > 0 && <div className="divider-label">Add more</div>}
          <input className="field-input" style={{ marginBottom: 12 }} placeholder={`Search ${label.toLowerCase()}...`} value={search} onChange={e => { setSearch(e.target.value); setExpandedCat(null); }} />
          {search.length > 1 ? (
            <div className="skill-tags">
              {searchResults.slice(0, 15).map(o => <button key={o.id} className="skill-option" onClick={() => { onChange([...selected, o]); setSearch(""); }}>+ {o.name}</button>)}
              {!searchResults.length && <span className="empty-state">No matches for "{search}"</span>}
            </div>
          ) : (
            <div>
              {Object.entries(grouped).filter(([, s]) => s.length > 0).map(([cat, skills]) => (
                <div key={cat} style={{ marginBottom: 8 }}>
                  <button onClick={() => setExpandedCat(expandedCat === cat ? null : cat)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", padding: "8px 0", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6B6B6B" }}>{cat} ({skills.length})</span>
                    <span style={{ color: "#7FBFB8", fontSize: 18, lineHeight: 1 }}>{expandedCat === cat ? "−" : "+"}</span>
                  </button>
                  {expandedCat === cat && (
                    <div className="skill-tags" style={{ paddingTop: 6, paddingBottom: 10 }}>
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
      {editing && selected.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="skill-tags">
            {selected.map(s => (
              <span key={s.id} className="skill-tag-edit">
                {s.name}
                <button className="skill-tag-delete" onClick={() => onChange(selected.filter(x => x.id !== s.id))} title="Remove">✕</button>
              </span>
            ))}
          </div>
        </div>
      )}
      {!editing && (
        <div className="skill-tags">
          {selected.map(s => <span key={s.id} className="skill-tag">{s.name}</span>)}
          {!selected.length && <span className="empty-state">No tech skills added yet</span>}
        </div>
      )}
      {editing && (
        <div>
          {selected.length > 0 && <div className="divider-label">Add more</div>}
          <input className="field-input" style={{ marginBottom: 12 }} placeholder="Search technology..." value={search} onChange={e => { setSearch(e.target.value); setExpandedCat(null); }} />
          {search.length > 1 ? (
            <div className="skill-tags">
              {searchResults.slice(0, 15).map(o => <button key={o.id} className="skill-option" onClick={() => { onChange([...selected, o]); setSearch(""); }}>+ {o.name}</button>)}
              {!searchResults.length && <span className="empty-state">No matches for "{search}"</span>}
            </div>
          ) : (
            <div>
              {Object.entries(grouped).filter(([, t]) => t.length > 0).map(([cat, tools]) => (
                <div key={cat} style={{ marginBottom: 8 }}>
                  <button onClick={() => setExpandedCat(expandedCat === cat ? null : cat)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", padding: "8px 0", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6B6B6B" }}>{cat} ({tools.length})</span>
                    <span style={{ color: "#7FBFB8", fontSize: 18, lineHeight: 1 }}>{expandedCat === cat ? "−" : "+"}</span>
                  </button>
                  {expandedCat === cat && (
                    <div className="skill-tags" style={{ paddingTop: 6, paddingBottom: 10 }}>
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
  const [editMode, setEditMode] = useState(null);
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
        // Load fresh taxonomy on login so deleted options don't show
        const [pOpts, sOpts, tOpts] = await Promise.all([
          getSkillTable(TBL_PRIMARY_SKILLS, "Skill Name"),
          getSkillTable(TBL_SECONDARY_SKILLS, "Label"),
          getSkillTable(TBL_TECH_SKILLS, "Tech name"),
        ]);
        setPrimaryOptions(pOpts);
        setSecondaryOptions(sOpts);
        setTechOptions(tOpts);
        setProfile({
          primarySkills: pOpts.filter(o => primaryIds.has(o.id)),
          secondarySkills: sOpts.filter(o => secondaryIds.has(o.id)),
          techSkills: tOpts.filter(o => techIds.has(o.id)),
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
    setError("");
    try {
      const text = await extractTextFromFile(file);
      console.log("Extracted text length:", text.length, "First 200 chars:", text.slice(0, 200));
      if (text.length < 50) {
        setError("Couldn't read this file. Please try a .txt or .docx version of your resume.");
        setParsing(false);
        return;
      }
      const suggestions = await claudeParseResume(text, primaryOptions, secondaryOptions, techOptions);
      setParsedSuggestions(suggestions);
      setEditMode("resume-review");
    } catch (e) {
      console.error("Resume upload error:", e);
      setError("Could not parse resume: " + e.message);
    } finally {
      setParsing(false);
    }
  }

  function handleAddToExisting(selected) {
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

  function resetEdit() { setEditing(false); setEditMode(null); setParsedSuggestions(null); setError(""); }

  const isEditing = editing && editMode === "manual";

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

          {stage === "loading" && (
            <div style={{ textAlign: "center", paddingTop: 80 }}>
              <div className="spinner" style={{ width: 40, height: 40, borderWidth: 3, margin: "0 auto 20px" }}></div>
              <p style={{ color: "#6B6B6B" }}>Loading your profile...</p>
            </div>
          )}

          {stage === "profile" && obm && (
            <div style={{ paddingBottom: isEditing ? 80 : 0 }}>
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
                          { mode: "manual", icon: "✏️", title: "Edit Manually", desc: "Browse by category, add or remove skills individually" },
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
                            <div className="upload-text"><strong>Drop your resume here</strong><br />or click to browse — PDF, Word, or text file</div>
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

                  {/* Edit legend */}
                  {isEditing && (
                    <div className="edit-legend">
                      <div className="legend-item"><div className="legend-dot-teal"></div> Your current skills (tap ✕ to remove)</div>
                      <div className="legend-item"><div className="legend-dot-gray"></div> Available to add</div>
                    </div>
                  )}

                  {/* Skills — only show when not in resume review */}
                  {editMode !== "resume-review" && (
                    <>
                      <div className={`section-card ${isEditing ? "editing-active" : ""}`}>
                        <div className="section-header">
                          <span className={`section-title ${isEditing ? "active" : ""}`}>Primary Skills</span>
                        </div>
                        <SkillSelector label="Primary Skills" selected={profile.primarySkills} options={primaryOptions} onChange={v => setProfile(p => ({ ...p, primarySkills: v }))} editing={isEditing} />
                      </div>

                      <div className={`section-card ${isEditing ? "editing-active" : ""}`}>
                        <div className="section-header">
                          <span className={`section-title ${isEditing ? "active" : ""}`}>Secondary Skills</span>
                        </div>
                        <SkillSelector label="Secondary Skills" selected={profile.secondarySkills} options={secondaryOptions} onChange={v => setProfile(p => ({ ...p, secondarySkills: v }))} editing={isEditing} />
                      </div>

                      <div className={`section-card ${isEditing ? "editing-active" : ""}`}>
                        <div className="section-header">
                          <span className={`section-title ${isEditing ? "active" : ""}`}>Technology Skills</span>
                        </div>
                        <TechSelector selected={profile.techSkills} options={techOptions} onChange={v => setProfile(p => ({ ...p, techSkills: v }))} editing={isEditing} />
                      </div>

                      <div className={`section-card ${isEditing ? "editing-active" : ""}`}>
                        <div className="section-header"><span className={`section-title ${isEditing ? "active" : ""}`}>Availability</span></div>
                        {isEditing ? (
                          <div className="skill-tags">
                            {hoursOptions.map(h => (
                              <button key={h}
                                className={profile.hours.includes(h) ? "skill-tag-edit" : "skill-option"}
                                onClick={() => setProfile(p => ({ ...p, hours: p.hours.includes(h) ? p.hours.filter(x => x !== h) : [...p.hours, h] }))}
                                style={{ cursor: "pointer", border: profile.hours.includes(h) ? "none" : undefined }}>
                                {profile.hours.includes(h) ? <><span>✓</span>{h}<button className="skill-tag-delete" onClick={e => { e.stopPropagation(); setProfile(p => ({ ...p, hours: p.hours.filter(x => x !== h) })); }}>✕</button></> : `+ ${h}`}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="skill-tags">
                            {profile.hours.length ? profile.hours.map(h => <span key={h} className="skill-tag">{h}</span>) : <span className="empty-state">Not set</span>}
                          </div>
                        )}
                      </div>

                      <div className={`section-card ${isEditing ? "editing-active" : ""}`}>
                        <div className="section-header"><span className={`section-title ${isEditing ? "active" : ""}`}>Details</span></div>
                        {isEditing ? (
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

        {isEditing && (
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
