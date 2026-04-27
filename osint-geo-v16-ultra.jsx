import { useState, useRef, useCallback, useEffect } from "react";

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ─── Standard call ─────────────────────────────────────────────
async function callClaude(messages, system, maxTokens = 1500) {
  const body = { model: "claude-sonnet-4-20250514", max_tokens: maxTokens, messages };
  if (system) body.system = system;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 150000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    clearTimeout(t);
    const d = await r.json();
    if (!r.ok) throw new Error(`API ${r.status}: ${JSON.stringify(d)}`);
    const blk = d.content?.find(b => b.type === "text");
    if (!blk) throw new Error("Empty response");
    return blk.text.trim();
  } catch (e) { clearTimeout(t); if (e.name === "AbortError") throw new Error("Timeout 150s"); throw e; }
}

// ─── Agentic call WITH web_search ──────────────────────────────
// v16: 4 rounds max (was 5), maxTokens 1800 (was 2000)
async function callClaudeWithSearch(messages, system, maxTokens = 1800, onSearch) {
  const tools = [{ type: "web_search_20250305", name: "web_search" }];
  let msgs = [...messages];
  let fullText = "";
  const searchLog = [];

  for (let round = 0; round < 4; round++) {
    const body = { model: "claude-sonnet-4-20250514", max_tokens: maxTokens, tools, messages: msgs };
    if (system) body.system = system;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 150000);
    let r, d;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: ctrl.signal,
      });
      clearTimeout(t); d = await r.json();
    } catch (e) { clearTimeout(t); if (e.name === "AbortError") throw new Error("Timeout 150s"); throw e; }
    if (!r.ok) throw new Error(`API ${r.status}: ${JSON.stringify(d)}`);

    fullText += (d.content?.filter(b => b.type === "text") || []).map(b => b.text).join("\n");
    if (d.stop_reason === "end_turn") break;
    const toolUseBlocks = d.content?.filter(b => b.type === "tool_use") || [];
    if (!toolUseBlocks.length) break;

    msgs = [...msgs, { role: "assistant", content: d.content }];
    msgs = [...msgs, { role: "user", content: toolUseBlocks.map(tu => {
      const q = tu.input?.query || "";
      if (onSearch) onSearch(q);
      searchLog.push(q);
      return { type: "tool_result", tool_use_id: tu.id, content: "" };
    })}];
  }
  return { text: fullText.trim(), searchLog };
}

// ─── XML helpers ───────────────────────────────────────────────
const tag = (src, name) => { if (!src) return ""; const m = src.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? m[1].trim() : ""; };
const num = (src, name) => { const v = parseFloat(tag(src, name)); return isNaN(v) ? null : v; };
const int = (src, name, fb = 0) => { const v = parseInt(tag(src, name)); return isNaN(v) ? fb : v; };

// ═══════════════════════════════════════════════════════════════
// MAIN ANALYSIS PIPELINE — 5 PASSES
// v16 TOKEN SAVINGS vs v15-OPT:
//   Pass 0: prompt -60% (techniques géoguessr inline supprimées)
//   Pass 1: contexte input -40% + prompt condensé
//   Pass 2: prompt -50% (calcul solaire ultra-compact)
//   Pass 3: 4 rounds / contexte -30% / maxTokens 1800
//   Pass 4: XML schema -25% (champs fusionnés/supprimés), maxTokens 1800
// Total estimé: -35% tokens vs v15-OPT
// ═══════════════════════════════════════════════════════════════
async function geoAnalysis(base64, mediaType, onLog) {
  const timer = (label) => { const s = Date.now(); return () => onLog(`  OK ${label} -- ${((Date.now()-s)/1000).toFixed(1)}s`); };

  // ──────────────────────────────────────────────────────────────
  // PASS 0 — INVENTAIRE + GÉOGUESSR (image envoyée 1 seule fois)
  // v16: prompt condensé -60%, max_tokens 2000→1800
  // Supprimé: explications des techniques GeoGuessr (le modèle les connaît)
  // ──────────────────────────────────────────────────────────────
  onLog("> ШАГ 0: Инвентаризация + GeoGuessr...");
  const d0 = timer("Pass 0+1");
  const combined01 = await callClaude([{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: `PART A — PIXEL INVENTORY (exhaustive):
GROUND: paving material+pattern+color+condition. Curb. Manhole text. Road markings. Tactile paving.
ROAD: width+lanes. Lighting style. Traffic signs (partial text). Poles: wood/concrete/metal+wires. Bus shelter brand. Bollards. CCTV.
BUILDINGS: floors+height. Facade material+color. Window style. Roof. Balconies. Era (pre-war/socialist/post-1990). All visible text.
VEGETATION: tree species. Leaf status→season.
VEHICLES: make+model+color+body. Plate format (letters visible?).
SKY: sun position+direction+elevation°. Shadow direction+ratio. Season+time.
ALL TEXT: every fragment, language, partial reads.
MICRO: post box color. Fire hydrant type. Flags. Graffiti language.

PART B — GEOGUESSR EXPERT ANALYSIS:
Apply full GeoGuessr diagnostic: pavement DNA, utility poles, road markings, street furniture brands, architecture type (Khrushchyovka/Wielka Płyta/Panelák/tenement/etc), vegetation phenology, any visible text/plates.

COUNTRY ELIMINATION (each IN/OUT + 1 reason):
N.America|UK/Ireland|France|DE/AT/CH|Benelux|Scandinavia|ES/PT|Italy|Poland|CZ/SK|HU/RO/BG|Balkans|Baltics|UA/BY/RU|Turkey|Asia|Australia|LatAm

TOP 3 COUNTRIES: [Country: X%] + 3 independent proofs each
TOP 3 CITY CANDIDATES: real city, population, 3 reasons, %
MOST DECISIVE CLUE: one sentence
BET YOUR LIFE: top country + city (commit even at 40%)` }
    ]
  }], "Forensic OSINT + GeoGuessr world expert. Exhaustive inventory. Always commit to specific answers.", 1800);
  d0();

  // Split inventory / geoguessrAnalysis
  const splitIdx = combined01.indexOf("PART B") !== -1 ? combined01.indexOf("PART B") : Math.floor(combined01.length * 0.55);
  const inventory = combined01.substring(0, splitIdx);

  // ──────────────────────────────────────────────────────────────
  // PASS 1 — DEEP REGIONAL DRILL
  // v16: contexte tronqué 50→30 lignes + prompt condensé, max_tokens 1800→1400
  // ──────────────────────────────────────────────────────────────
  onLog("> ШАГ 1: Региональный дрилл + кандидаты...");
  const d1 = timer("Pass 1");

  const combinedSummary = combined01.split('\n')
    .filter(l => l.match(/TOP|COUNTRY|CITY|DECISIVE|%|→|pavement|pole|plate|sign|brick|render|panel|linden|maple|window|balcon|kostka|herringbone|Wielka|Khrush|JCDecaux|hydrant|post.?box/i))
    .slice(0, 30).join('\n');

  const regionalDrill = await callClaude([{
    role: "user",
    content: `Forensic geolocation. Based on analysis below, identify SPECIFIC CITY and STREET.
=== KEY FINDINGS ===
${combinedSummary || combined01.substring(0, 900)}

1. LOCK COUNTRY: name+3 proofs+%.
2. REGION: terrain+vegetation zone. 2-3 matching admin regions.
3. CITY SIZE: village/small/medium/large/metro + evidence.
4. 5 CITY CANDIDATES: real cities, population, 3 reasons, %. #1="bet €1000".
5. STREET TYPE: function+traffic+setback.
6. GPS ESTIMATE: best lat/lng, uncertainty radius.

XML output:
<addr1>address 1</addr1><addr1_why>3 reasons</addr1_why>
<addr2>address 2</addr2><addr2_why>3 reasons</addr2_why>
<addr3>address 3</addr3><addr3_why>3 reasons</addr3_why>
<best_city>most likely city</best_city><best_country>country</best_country>
<gps_lat>decimal lat</gps_lat><gps_lng>decimal lng</gps_lng>
<city_size>population estimate</city_size><street_type>street function</street_type>
Then free-text analysis.`
  }], "Forensic geolocation. Real cities, real streets. XML first then analysis.", 1400);
  d1();

  // ──────────────────────────────────────────────────────────────
  // PASS 2 — SOLAR & ENVIRONMENTAL TRIANGULATION
  // v16: prompt ultra-condensé -50%, max_tokens 1200→900
  // ──────────────────────────────────────────────────────────────
  onLog("> ШАГ 2: Солнечная геометрия + фенология...");
  const d2 = timer("Pass 2");

  const solarLines = inventory.split('\n')
    .filter(l => l.match(/sun|shadow|light|sky|leaf|tree|season|month|cloud|elevation|bearing|green|yellow|bare|budding|chestnut|linden|maple|birch|plane|poplar|oak/i))
    .slice(0, 20).join('\n');

  const solarTriangulation = await callClaude([{
    role: "user",
    content: `Solar geometry + phenology from observations:
=== OBSERVATIONS ===
${solarLines || inventory.substring(0, 500)}

1. Sun bearing+elevation, shadow ratio, camera facing, time of day.
2. Latitude: at noon lat≈90°-elev+decl (summer+23.5°, equinox 0°, winter-23.5°). Show working. ±5° range.
3. Phenology: full green=Jun-Aug|bright green=Apr-May|yellow=Sep-Oct|sparse=Oct-Nov|bare=Nov-Mar|budding=Mar-Apr → month ±1.
4. Köppen zone (Cfb/Dfb/BSk/Csa) + 3 indicators.
5. Countries satisfying ALL constraints.

<sun_direction>bearing+camera</sun_direction>
<latitude_estimate>range+working</latitude_estimate>
<season_month>month ±1</season_month>
<climate_zone>Köppen+name</climate_zone>
<solar_countries>matching countries</solar_countries>`
  }], "Solar geometry expert. Show working. XML output.", 900);
  d2();

  // ──────────────────────────────────────────────────────────────
  // PASS 3 — LIVE WEB SEARCH VERIFICATION
  // v16: 4 rounds (was 5), contexte -30%, maxTokens 1800
  // ──────────────────────────────────────────────────────────────
  onLog("> ШАГ 3: Живой поиск + верификация...");
  const d3 = timer("Pass 3");
  const searchesUsed = [];

  const topCity = tag(regionalDrill, "best_city") || "";

  const mapsVerifResult = await callClaudeWithSearch([{
    role: "user",
    content: `Elite OSINT investigator. Verify geolocation via web search.

=== CANDIDATES ===
${combined01.substring(0, 400)}
=== CITY DRILL ===
${regionalDrill.substring(0, 450)}
=== SOLAR ===
${solarTriangulation.substring(0, 200)}

Do 3-4 targeted searches: architectural match, country standard, geographic check, any text/brand from image.
XML after searches:
<maps_best_city>confirmed city</maps_best_city>
<maps_best_street>street if found</maps_best_street>
<maps_lat>refined lat</maps_lat><maps_lng>refined lng</maps_lng>
<maps_conf>confidence 0-100</maps_conf>
<maps_confirmed>what confirmed</maps_confirmed>
<maps_contradicted>what contradicted</maps_contradicted>
<maps_new_candidate>new candidate if any</maps_new_candidate>
<maps_final_address>FINAL ADDRESS</maps_final_address>
<maps_reasoning>strongest evidence + verdict (2-3 sentences)</maps_reasoning>
<maps_search_quality>decisive/inconclusive?</maps_search_quality>
<maps_search1>q1—finding</maps_search1><maps_search2>q2—finding</maps_search2>
<maps_search3>q3—finding</maps_search3><maps_search4>q4—finding</maps_search4>`
  }],
  "Elite OSINT. 3-4 web searches. Decisive. XML after searches.",
  1800,
  (q) => { searchesUsed.push(q); onLog(`  >> ПОИСК: "${q}"`); });
  d3();

  const mapsVerif = mapsVerifResult.text;

  // ──────────────────────────────────────────────────────────────
  // PASS 4 — XML SYNTHESIS + ADVERSARIAL
  // v16: XML schema -25% (addr4/5 supprimés, champs fusionnés)
  //      contexte tronqué, max_tokens 2200→1800
  // ──────────────────────────────────────────────────────────────
  onLog("> ШАГ 4: Синтез XML + Adversarial + вердикт...");
  const d4 = timer("Pass 4+5");
  const finalResult = await callClaude([{
    role: "user",
    content: `Synthesize all into final geolocation. ONLY XML.

WEB (PRIORITY): ${mapsVerif.substring(0, 600)}
VISUAL: ${combined01.substring(0, 300)}
REGIONAL: ${regionalDrill.substring(0, 400)}
SOLAR: ${solarTriangulation.substring(0, 200)}

PART A:
<country>country</country><city>city</city><district>neighborhood</district>
<street_area>street or intersection</street_area>
<addr1>candidate 1</addr1><addr1_why>3 reasons</addr1_why>
<addr2>candidate 2</addr2><addr2_why>3 reasons</addr2_why>
<addr3>candidate 3</addr3><addr3_why>3 reasons</addr3_why>
<best_guess>full address</best_guess><best_conf>0-100</best_conf>
<conf_country>0-100</conf_country><conf_city>0-100</conf_city>
<conf_district>0-100</conf_district><conf_street>0-100</conf_street>
<lat>lat 6dp</lat><lng>lng 6dp</lng><precision>street|block|district|city|region</precision>
<maps_q1>query1</maps_q1><maps_q2>query2</maps_q2><maps_q3>query3</maps_q3>
<sv1>streetview pt1</sv1><sv2>streetview pt2</sv2>
<key_clue>clue 1</key_clue><key_clue2>clue 2</key_clue2><key_clue3>clue 3</key_clue3>
<text_found>all text</text_found><plate_found>plates</plate_found>
<adjacent_biz>nearby landmarks</adjacent_biz>
<eliminate1>excluded zone 1</eliminate1><eliminate2>excluded zone 2</eliminate2><eliminate3>excluded zone 3</eliminate3>
<arch_style>style</arch_style><arch_era>decade</arch_era><climate_zone>Köppen</climate_zone>
<sun_direction>bearing+camera</sun_direction><latitude_estimate>solar range</latitude_estimate>
<season_month>month</season_month><city_size>population</city_size><street_type>function</street_type>
<confidence_narrative>3 sentences: certain/uncertain/resolves</confidence_narrative>
<maps_boost>did web change confidence?</maps_boost>
<reverse_search>best reverse-image description</reverse_search>

PART B (adversarial):
<final_address>corrected address</final_address>
<strongest_clue>most indisputable clue</strongest_clue>
<alt_country1>alternative country</alt_country1><alt_country1_why>why</alt_country1_why>
<alt_country2>second alt</alt_country2><alt_country2_why>why</alt_country2_why>
<contradiction>contradictions or "consistent"</contradiction>
<missed_clue>overlooked visual clue</missed_clue>
<solar_consistency>solar vs city: consistent/inconsistent/partial</solar_consistency>
<verify1>step 1</verify1><verify2>step 2</verify2><verify3>step 3</verify3>
<final_conf>0-100</final_conf><street_conf>0-100</street_conf><city_conf_final>0-100</city_conf_final>
<osint_tip>most actionable next step</osint_tip>
<why_hard>why difficult</why_hard>
<if_i_knew>if I knew X, confidence Y%→Z%</if_i_knew>
<maps_search_quality>quality rating</maps_search_quality>`
  }], "Reply ONLY with valid XML. No markdown. Web verification takes priority.", 1800);
  d4();

  // ──────────────────────────────────────────────────────────────
  // PARSE & RETURN
  // ──────────────────────────────────────────────────────────────
  const lat = num(finalResult, "lat");
  const lng = num(finalResult, "lng");
  const svUrl = lat && lng ? `https://www.google.com/maps/@${lat},${lng},3a,75y,0h,90t/data=!3m6!1e1` : "";

  return {
    inventory, geoguessrAnalysis: combined01.substring(splitIdx),
    regionalDrill, solarTriangulation, mapsVerif, searchesUsed,
    country: tag(finalResult, "country"), city: tag(finalResult, "city"),
    district: tag(finalResult, "district"), street_area: tag(finalResult, "street_area"),
    candidates: [
      { address: tag(finalResult, "addr1"), why: tag(finalResult, "addr1_why") },
      { address: tag(finalResult, "addr2"), why: tag(finalResult, "addr2_why") },
      { address: tag(finalResult, "addr3"), why: tag(finalResult, "addr3_why") },
    ].filter(c => c.address),
    best_guess: tag(finalResult, "final_address") || tag(finalResult, "best_guess"),
    best_conf: int(finalResult, "final_conf") || int(finalResult, "best_conf"),
    conf_country: int(finalResult, "conf_country"), conf_city: int(finalResult, "city_conf_final") || int(finalResult, "conf_city"),
    conf_district: int(finalResult, "conf_district"), conf_street: int(finalResult, "street_conf") || int(finalResult, "conf_street"),
    lat, lng, svUrl,
    precision: tag(finalResult, "precision"),
    maps_queries: [tag(finalResult,"maps_q1"),tag(finalResult,"maps_q2"),tag(finalResult,"maps_q3")].filter(Boolean),
    sv_points: [tag(finalResult,"sv1"),tag(finalResult,"sv2")].filter(Boolean),
    key_clues: [tag(finalResult,"key_clue"),tag(finalResult,"key_clue2"),tag(finalResult,"key_clue3")].filter(Boolean),
    text_found: tag(finalResult, "text_found"), plate_found: tag(finalResult, "plate_found"),
    adjacent_biz: tag(finalResult, "adjacent_biz"), reverse_search: tag(finalResult, "reverse_search"),
    eliminations: [tag(finalResult,"eliminate1"),tag(finalResult,"eliminate2"),tag(finalResult,"eliminate3")].filter(Boolean),
    arch_style: tag(finalResult, "arch_style"), arch_era: tag(finalResult, "arch_era"),
    climate_zone: tag(finalResult, "climate_zone"), sun_direction: tag(finalResult, "sun_direction"),
    latitude_estimate: tag(finalResult, "latitude_estimate"), season_month: tag(finalResult, "season_month"),
    city_size: tag(finalResult, "city_size"), street_type: tag(finalResult, "street_type"),
    confidence_narrative: tag(finalResult, "confidence_narrative"), maps_boost: tag(finalResult, "maps_boost"),
    maps_best_city: tag(mapsVerif, "maps_best_city"), maps_best_street: tag(mapsVerif, "maps_best_street"),
    maps_confirmed: tag(mapsVerif, "maps_confirmed"), maps_contradicted: tag(mapsVerif, "maps_contradicted"),
    maps_new_candidate: tag(mapsVerif, "maps_new_candidate"),
    maps_searches: [tag(mapsVerif,"maps_search1"),tag(mapsVerif,"maps_search2"),tag(mapsVerif,"maps_search3"),tag(mapsVerif,"maps_search4")].filter(Boolean),
    final_address: tag(finalResult, "final_address"), strongest_clue: tag(finalResult, "strongest_clue"),
    contradiction: tag(finalResult, "contradiction"), missed_clue: tag(finalResult, "missed_clue"),
    solar_consistency: tag(finalResult, "solar_consistency"),
    maps_search_quality: tag(finalResult, "maps_search_quality"),
    alt_countries: [
      { country: tag(finalResult,"alt_country1"), why: tag(finalResult,"alt_country1_why") },
      { country: tag(finalResult,"alt_country2"), why: tag(finalResult,"alt_country2_why") },
    ].filter(c => c.country),
    osint_tip: tag(finalResult, "osint_tip"), why_hard: tag(finalResult, "why_hard"),
    if_i_knew: tag(finalResult, "if_i_knew"),
    verifications: [tag(finalResult,"verify1"),tag(finalResult,"verify2"),tag(finalResult,"verify3")].filter(Boolean),
    final_conf: int(finalResult, "final_conf"), street_conf: int(finalResult, "street_conf"),
  };
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════
const S = {
  page: { background: "#b8b8b8", fontFamily: "'Courier New', monospace", minHeight: "100vh", padding: "8px", fontSize: "12px", color: "#000080" },
  topBanner: { background: "linear-gradient(90deg,#000066,#0000aa,#000066)", color: "#ffff00", textAlign: "center", padding: "8px", fontFamily: "'Courier New', monospace", fontSize: "17px", fontWeight: "bold", border: "3px outset #fff", marginBottom: "3px", textShadow: "2px 2px #ff0000", letterSpacing: "2px" },
  subBanner: { background: "#884400", color: "#fff", textAlign: "center", padding: "3px", fontSize: "9px", fontFamily: "'Courier New', monospace", marginBottom: "6px", border: "1px solid #552200" },
  mainTable: { width: "100%", borderCollapse: "collapse", border: "2px inset #808080", background: "#fff" },
  sectionTitle: { background: "#000080", color: "#ffff00", padding: "3px 6px", fontSize: "10px", fontWeight: "bold", fontFamily: "'Courier New', monospace", borderBottom: "2px solid #ff6600", marginBottom: "4px", display: "block" },
  box:       { border: "2px inset #808080", background: "#f0f0f0", padding: "6px", marginBottom: "6px" },
  boxRed:    { border: "2px inset #808080", background: "#fff0f0", padding: "6px", marginBottom: "6px" },
  boxYellow: { border: "2px inset #808080", background: "#fffff0", padding: "6px", marginBottom: "6px" },
  boxGreen:  { border: "2px inset #808080", background: "#f0fff0", padding: "6px", marginBottom: "6px" },
  boxBlue:   { border: "2px inset #808080", background: "#e8f0ff", padding: "6px", marginBottom: "6px" },
  boxTeal:   { border: "2px solid #006666", background: "#e0ffff", padding: "6px", marginBottom: "6px" },
  boxOrange: { border: "2px solid #cc5500", background: "#fff4e0", padding: "6px", marginBottom: "6px" },
  boxPurple: { border: "2px solid #550077", background: "#f8f0ff", padding: "6px", marginBottom: "6px" },
  dropzone: { border: "3px dashed #000080", background: "#e8e8ff", padding: "20px", textAlign: "center", cursor: "pointer", marginBottom: "6px", fontFamily: "'Courier New', monospace", color: "#000080", fontSize: "11px" },
  dropzoneDrag: { border: "3px dashed #ff0000", background: "#ffeeee", padding: "20px", textAlign: "center", cursor: "pointer", marginBottom: "6px", fontFamily: "'Courier New', monospace", color: "#cc0000", fontSize: "11px" },
  btn: { background: "linear-gradient(180deg,#e0e0e0,#909090)", border: "2px outset #fff", color: "#000080", fontFamily: "'Courier New', monospace", fontWeight: "bold", fontSize: "12px", padding: "7px 20px", cursor: "pointer", width: "100%", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "1px" },
  btnDisabled: { background: "#909090", border: "2px inset #808080", color: "#505050", fontFamily: "'Courier New', monospace", fontSize: "11px", padding: "7px 20px", cursor: "not-allowed", width: "100%", marginBottom: "6px" },
  logBox: { background: "#000", color: "#00ff00", fontFamily: "'Courier New', monospace", fontSize: "10px", padding: "6px", border: "2px inset #808080", maxHeight: "200px", overflowY: "auto", marginBottom: "6px" },
  confBig: (c) => ({ fontSize: "52px", fontWeight: "bold", color: c >= 70 ? "#004400" : c >= 40 ? "#884400" : "#880000", fontFamily: "'Courier New', monospace", display: "block", textAlign: "center", textShadow: "2px 2px #ccc" }),
  link: { color: "#0000cc", fontSize: "10px", fontFamily: "'Courier New', monospace", textDecoration: "underline", display: "inline-block", marginRight: "6px", marginBottom: "2px" },
  candRow: (i) => ({ background: i === 0 ? "#fffce0" : i % 2 === 0 ? "#e8e8ff" : "#fff", borderBottom: "1px solid #ddd" }),
  separator: { height: "2px", background: "linear-gradient(90deg,#000080,#ff6600,#006600,#ff6600,#000080)", margin: "6px 0", border: "none" },
  meterBar: (v) => ({ height: "10px", width: `${v}%`, background: v >= 70 ? "#006600" : v >= 40 ? "#cc6600" : "#cc0000", display: "inline-block", border: "1px inset #808080", verticalAlign: "middle" }),
  searchTag: { background: "#006666", color: "#00ffff", fontSize: "9px", fontFamily: "'Courier New', monospace", padding: "1px 5px", display: "inline-block", marginBottom: "2px", border: "1px solid #004444" },
  svBig: { background: "#001a00", color: "#00ff44", fontFamily: "'Courier New', monospace", fontSize: "10px", padding: "8px", border: "2px inset #00aa00", marginBottom: "6px", wordBreak: "break-all" },
};

function Div() { return <hr style={S.separator} />; }
function ST({ children, color }) { return <div style={{ ...S.sectionTitle, background: color || "#000080" }}>{children}</div>; }
function Meter({ label, value }) {
  const c = value >= 70 ? "#004400" : value >= 40 ? "#884400" : "#880000";
  return (
    <div style={{ marginBottom: "3px", fontFamily: "'Courier New', monospace", fontSize: "10px" }}>
      <span style={{ display: "inline-block", width: "180px", color: "#000080" }}>{label}</span>
      <span style={S.meterBar(value)} />
      <span style={{ color: c, fontWeight: "bold", marginLeft: "4px", fontFamily: "'Courier New', monospace", fontSize: "11px" }}>{value}%</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function GeoFinderV16Ultra() {
  const [image, setImage] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("idle");
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const fileRef = useRef();
  const logRef = useRef();
  const addLog = useCallback((msg) => setLogs(prev => [...prev, msg]), []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);

  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const base64 = await toBase64(file);
    setImage({ url, base64, mediaType: file.type, name: file.name });
    setResult(null); setError(""); setStatus("idle"); setLogs([]);
  }, []);

  const onDrop = useCallback((e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }, [handleFile]);

  const run = useCallback(async () => {
    if (!image) return;
    setStatus("analyzing"); setResult(null); setError(""); setLogs([]);
    try {
      const data = await geoAnalysis(image.base64, image.mediaType, addLog);
      setResult(data); setStatus("done");
    } catch (err) { setError(err.message || "Unknown error"); setStatus("error"); }
  }, [image, addLog]);

  const precLabel = { street: "УЛИЦА", block: "КВАРТАЛ", district: "РАЙОН", city: "ГОРОД", region: "РЕГИОН" };

  const passes = [
    ["ШАГ 0: ИНВЕНТАРЬ+ГЕОГЕСС", "пиксели + эксперт", "#003366"],
    ["ШАГ 1: РЕГИОН", "список городов", "#550055"],
    ["ШАГ 2: СОЛНЦЕ", "геометрия+фенология", "#884400"],
    ["ШАГ 3: ВЕБ-ПОИСК", "живая верификация", "#006666"],
    ["ШАГ 4: СИНТЕЗ+ADVERSARIAL", "XML + вердикт", "#880000"],
  ];

  return (
    <div style={S.page}>
      <style>{`
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        a:visited{color:#660066}
        details summary{cursor:pointer;font-family:'Courier New',monospace;font-size:10px;color:#000080}
        details summary:hover{background:#d0d0ff}
      `}</style>

      <div style={S.topBanner}>[ ГЕОЛОКАТОР ОСИНТ v16-ULTRA ] :: Определение местоположения по фотографии</div>
      <div style={S.subBanner}>
        :: Форум разведчиков :: Версия 16-ULTRA :: 5 проходов :: ВЕБ-ПОИСК ВЖИВУЮ :: Powered by Claude AI :: ~65% меньше токенов vs v15 ::
      </div>

      <table style={S.mainTable}><tbody><tr>

        {/* LEFT PANEL */}
        <td style={{ width: "255px", padding: "6px", verticalAlign: "top", borderRight: "2px solid #808080", background: "#f0f0f0" }}>
          <div style={S.sectionTitle}>[ ЗАГРУЗКА ИЗОБРАЖЕНИЯ ]</div>
          <div
            style={dragging ? S.dropzoneDrag : S.dropzone}
            onClick={() => fileRef.current?.click()}
            onDrop={onDrop}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
          >
            {image ? (
              <>
                <img src={image.url} alt="цель" style={{ maxWidth: "100%", maxHeight: "140px", border: "2px inset #808080" }} />
                <div style={{ fontFamily: "'Courier New'", fontSize: "9px", color: "#006600", marginTop: "3px" }}>
                  цель OK ЗАГРУЖЕНО<br />{image.name}
                </div>
              </>
            ) : (
              <div>
                <div style={{ fontFamily: "'Courier New'", fontSize: "13px", marginBottom: "6px", color: "#000080" }}>[ ПЕРЕТАЩИТЕ ФОТО СЮДА ]</div>
                <div style={{ fontFamily: "'Courier New'", fontSize: "9px", color: "#666" }}>или нажмите для выбора файла</div>
                <div style={{ fontFamily: "'Courier New'", fontSize: "9px", color: "#aaa", marginTop: "4px" }}>JPG / PNG / WEBP</div>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />

          {image && (
            <div onClick={() => { setImage(null); setResult(null); setError(""); setLogs([]); }}
              style={{ fontFamily: "'Courier New'", fontSize: "9px", color: "#cc0000", cursor: "pointer", textDecoration: "underline", marginBottom: "4px" }}>
              [ удалить ]
            </div>
          )}

          <button style={status === "analyzing" ? S.btnDisabled : S.btn} disabled={!image || status === "analyzing"} onClick={run}>
            {status === "analyzing" ? ">> АНАЛИЗ ИДЁТ... <<" : ">>> НАЧАТЬ АНАЛИЗ <<<"}
          </button>

          <div style={S.sectionTitle}>[ КОНВЕЙЕР АНАЛИЗА ]</div>
          {passes.map(([name, desc, col]) => {
            const keyword = name.split(": ")[1]?.slice(0, 4) || name.slice(0, 4);
            const done = logs.some(l => l.startsWith("  OK") && l.toLowerCase().includes(keyword.toLowerCase()));
            const active = logs.length > 0 && logs[logs.length - 1]?.toLowerCase().includes(keyword.toLowerCase());
            return (
              <div key={name} style={{ fontFamily: "'Courier New'", fontSize: "9px", padding: "2px 4px", marginBottom: "1px", background: done ? "#e0ffe0" : active ? "#ffffe0" : "#eee", border: "1px solid " + (done ? "#006600" : active ? "#cc6600" : "#ccc") }}>
                <span style={{ color: col, fontWeight: "bold" }}>{name}</span>{done ? " [OK]" : active ? " [...]" : " [ ]"}
                <br /><span style={{ color: "#888" }}>{desc}</span>
              </div>
            );
          })}

          {logs.length > 0 && (
            <>
              <div style={{ ...S.sectionTitle, marginTop: "6px" }}>[ ЛОГ ОПЕРАЦИИ ]</div>
              <div ref={logRef} style={S.logBox}>
                {logs.map((l, i) => (
                  <div key={i} style={{ color: l.startsWith("  >> ПОИСК") ? "#00ffff" : l.startsWith("  OK") ? "#aaffaa" : l.startsWith("> ШАГ") ? "#ffff00" : "#00ff00" }}>
                    {l}
                  </div>
                ))}
              </div>
            </>
          )}

          {error && (
            <div style={{ background: "#fff0f0", border: "2px inset #cc0000", padding: "6px", fontFamily: "'Courier New'", fontSize: "10px", color: "#cc0000" }}>
              !! ОШИБКА: {error}
            </div>
          )}

          <div style={{ fontFamily: "'Courier New'", fontSize: "8px", color: "#888", marginTop: "10px", borderTop: "1px solid #ccc", paddingTop: "4px" }}>
            GEOFINDER OSINT v16-ULTRA<br />
            5 passes :: web search<br />
            (c) 2003 razvedka.ru
          </div>
        </td>

        {/* RIGHT PANEL */}
        <td style={{ padding: "8px", verticalAlign: "top", background: "#fff" }}>

          {status === "idle" && !result && (
            <div style={{ padding: "20px", fontFamily: "'Courier New'", color: "#888", fontSize: "11px" }}>
              <div style={{ color: "#000080", fontWeight: "bold", marginBottom: "8px" }}>
                :::::::::::::::::::::::::::::::::<br />
                :: ГЕОЛОКАТОР ОСИНТ v16-ULTRA ::<br />
                :::::::::::::::::::::::::::::::::
              </div>
              <div style={{ color: "#444", lineHeight: "1.8" }}>
                &gt; Загрузите фотографию слева<br />
                &gt; Нажмите НАЧАТЬ АНАЛИЗ<br />
                &gt; Система выполнит 5 проходов<br />
                &gt; Живой поиск в интернете<br />
                &gt; Результат: GPS координаты<br />
              </div>
              <div style={{ background: "#fffff0", border: "1px solid #cc9900", padding: "6px", marginTop: "8px", fontSize: "9px", color: "#664400" }}>
                v16-ULTRA vs v15-OPT:<br />
                - Pass 0: prompt -60% (techniques inline supprimées)<br />
                - Pass 1: contexte -40%, max_tokens 1400<br />
                - Pass 2: prompt -50%, max_tokens 900<br />
                - Pass 3: 4 rounds (était 5), contexte -30%<br />
                - Pass 4: XML -25%, max_tokens 1800<br />
                - Total: ~-35% tokens vs v15-OPT (~-65% vs v15)<br />
                - addr4/5 supprimés (peu utiles), addr1-3 conservés
              </div>
              <div style={{ marginTop: "12px", color: "#aaa", fontSize: "9px" }}>
                Powered by Claude Vision + Web Search<br />
                Форум разведчиков :: razvedka.ru/osint
              </div>
            </div>
          )}

          {status === "analyzing" && (
            <div style={{ padding: "20px", fontFamily: "'Courier New'" }}>
              <div style={{ color: "#000080", fontWeight: "bold", marginBottom: "8px", animation: "blink 1.2s infinite" }}>
                &gt;&gt;&gt; АНАЛИЗ ЗАПУЩЕН... &lt;&lt;&lt;
              </div>
              <div style={{ color: "#444", fontSize: "10px", lineHeight: "1.8" }}>
                &gt; 5-проходная система активна<br />
                &gt; Живой поиск в интернете<br />
                &gt; Ожидайте результат...<br />
              </div>
              <div style={{ color: "#884400", fontSize: "10px", marginTop: "8px" }}>
                {logs.length > 0 ? logs[logs.length - 1] : "&gt; Инициализация..."}
              </div>
            </div>
          )}

          {result && (
            <>
              {/* MAIN RESULT */}
              <div style={{ background: "linear-gradient(180deg,#000066,#000088)", color: "#ffff00", padding: "10px", marginBottom: "6px", textAlign: "center", fontFamily: "'Courier New'", border: "2px outset #fff" }}>
                <div style={{ fontSize: "9px", color: "#aaaaff", marginBottom: "4px" }}>[ РЕЗУЛЬТАТ ГЕОЛОКАЦИИ ]</div>
                <div style={{ fontSize: "16px", fontWeight: "bold", color: "#ffff00", marginBottom: "2px" }}>
                  {result.best_guess || `${result.city}, ${result.country}`}
                </div>
                {result.district && <div style={{ fontSize: "10px", color: "#aaffaa" }}>{result.district}</div>}
                {result.street_area && <div style={{ fontSize: "9px", color: "#ffcc88" }}>{result.street_area}</div>}
              </div>

              {/* CONFIDENCE */}
              <div style={S.boxBlue}>
                <ST color="#000066">[ УРОВЕНЬ УВЕРЕННОСТИ ]</ST>
                <div style={{ textAlign: "center", marginBottom: "8px" }}>
                  <span style={S.confBig(result.final_conf || result.best_conf)}>{result.final_conf || result.best_conf}%</span>
                  {result.precision && (
                    <span style={{ background: "#000080", color: "#ffff00", padding: "2px 8px", fontFamily: "'Courier New'", fontSize: "10px", fontWeight: "bold" }}>
                      ТОЧНОСТЬ: {precLabel[result.precision] || result.precision?.toUpperCase()}
                    </span>
                  )}
                </div>
                <Meter label="СТРАНА" value={result.conf_country} />
                <Meter label="ГОРОД" value={result.conf_city} />
                <Meter label="РАЙОН" value={result.conf_district} />
                <Meter label="УЛИЦА" value={result.conf_street} />
                {result.confidence_narrative && (
                  <div style={{ marginTop: "4px", fontFamily: "'Courier New'", fontSize: "9px", color: "#333", lineHeight: "1.4", borderTop: "1px solid #ccc", paddingTop: "4px" }}>
                    {result.confidence_narrative}
                  </div>
                )}
              </div>

              {/* GPS */}
              {result.lat && result.lng && (
                <div style={S.svBig}>
                  <div style={{ color: "#00ff44", marginBottom: "3px", fontSize: "11px", fontWeight: "bold" }}>GPS: {result.lat}, {result.lng}</div>
                  <a href={result.svUrl} target="_blank" rel="noreferrer" style={{ color: "#00ffff", fontSize: "10px" }}>[StreetView]</a>
                  <a href={`https://www.google.com/maps?q=${result.lat},${result.lng}`} target="_blank" rel="noreferrer" style={{ color: "#00ffff", fontSize: "10px", marginLeft: "8px" }}>[Maps]</a>
                  <a href={`https://www.bing.com/maps?cp=${result.lat}~${result.lng}&lvl=17`} target="_blank" rel="noreferrer" style={{ color: "#00ffff", fontSize: "10px", marginLeft: "8px" }}>[Bing]</a>
                  <a href={`https://yandex.ru/maps/?ll=${result.lng},${result.lat}&z=17`} target="_blank" rel="noreferrer" style={{ color: "#00ffff", fontSize: "10px", marginLeft: "8px" }}>[Яндекс]</a>
                </div>
              )}

              {/* WEB SEARCH RESULTS */}
              {(result.maps_best_city || result.maps_confirmed) && (
                <div style={S.boxTeal}>
                  <ST color="#005566">[ ВЕБ-ВЕРИФИКАЦИЯ ]</ST>
                  {result.maps_best_city && <div style={{ fontFamily: "'Courier New'", fontSize: "10px", marginBottom: "3px" }}><b style={{ color: "#005566" }}>Подтверждённый город:</b> {result.maps_best_city}</div>}
                  {result.maps_best_street && <div style={{ fontFamily: "'Courier New'", fontSize: "10px", marginBottom: "3px" }}><b style={{ color: "#005566" }}>Улица:</b> {result.maps_best_street}</div>}
                  {result.maps_confirmed && <div style={{ fontFamily: "'Courier New'", fontSize: "10px", color: "#004400", marginBottom: "3px" }}>✓ {result.maps_confirmed}</div>}
                  {result.maps_contradicted && <div style={{ fontFamily: "'Courier New'", fontSize: "10px", color: "#880000", marginBottom: "3px" }}>✗ {result.maps_contradicted}</div>}
                  {result.maps_new_candidate && <div style={{ fontFamily: "'Courier New'", fontSize: "10px", color: "#884400", marginBottom: "3px" }}>! {result.maps_new_candidate}</div>}
                  {result.maps_boost && <div style={{ fontFamily: "'Courier New'", fontSize: "9px", color: "#555", borderTop: "1px solid #aadddd", paddingTop: "3px", marginTop: "3px" }}>{result.maps_boost}</div>}
                  {result.maps_searches.length > 0 && (
                    <div style={{ marginTop: "4px" }}>
                      {result.maps_searches.map((s, i) => <div key={i} style={S.searchTag}>{s}</div>)}
                    </div>
                  )}
                </div>
              )}

              {/* CANDIDATES */}
              {result.candidates.length > 0 && (
                <div style={S.box}>
                  <ST color="#440044">[ КАНДИДАТЫ ]</ST>
                  <table style={{ width: "100%", fontFamily: "'Courier New'", fontSize: "10px", borderCollapse: "collapse" }}>
                    <tbody>
                      {result.candidates.map((c, i) => (
                        <tr key={i} style={S.candRow(i)}>
                          <td style={{ padding: "3px 6px 3px 0", color: "#000080", fontWeight: "bold", width: "18px", verticalAlign: "top" }}>[{i+1}]</td>
                          <td style={{ padding: "3px 6px 3px 0", color: "#000080", fontWeight: "bold", verticalAlign: "top", width: "35%" }}>{c.address}</td>
                          <td style={{ padding: "3px 0", color: "#555" }}>{c.why}</td>
                          <td style={{ padding: "3px 0 3px 4px", verticalAlign: "top" }}>
                            <a href={`https://www.google.com/maps/search/${encodeURIComponent(c.address)}`} target="_blank" rel="noreferrer" style={S.link}>[→]</a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <Div />

              {/* INFO ROW */}
              <div style={{ display: "flex", gap: "6px", marginBottom: "6px", flexWrap: "wrap" }}>
                {[
                  ["СТРАНА", result.country],
                  ["ГОРОД", result.city],
                  ["РАЙОН", result.district],
                  ["ЭРА", result.arch_era],
                  ["КЛИМАТ", result.climate_zone],
                  ["МЕСЯЦ", result.season_month],
                ].filter(([,v]) => v).map(([k, v]) => (
                  <div key={k} style={{ background: "#000080", color: "#ffff00", padding: "2px 6px", fontFamily: "'Courier New'", fontSize: "9px" }}>
                    {k}: <b>{v}</b>
                  </div>
                ))}
              </div>

              {/* METADATA TABLE */}
              {[result.text_found, result.plate_found, result.adjacent_biz, result.arch_style, result.city_size, result.street_type, result.sun_direction, result.latitude_estimate, result.reverse_search].some(Boolean) && (
                <div style={S.box}>
                  <ST color="#003366">[ МЕТАДАННЫЕ ]</ST>
                  <table style={{ fontFamily: "'Courier New'", fontSize: "10px", width: "100%" }}>
                    <tbody>
                      {[
                        ["ТЕКСТ", result.text_found],
                        ["НОМЕРА", result.plate_found],
                        ["БИЗНЕС", result.adjacent_biz],
                        ["АРХИТЕКТУРА", result.arch_style],
                        ["НАСЕЛЕНИЕ", result.city_size],
                        ["ТИП УЛИЦЫ", result.street_type],
                        ["СОЛНЦЕ", result.sun_direction],
                        ["ШИРОТА", result.latitude_estimate],
                        ["REVERSE", result.reverse_search],
                      ].filter(([,v]) => v).map(([k, v]) => (
                        <tr key={k}>
                          <td style={{ padding: "2px 6px 2px 0", color: "#000080", fontWeight: "bold", width: "110px", verticalAlign: "top" }}>{k}:</td>
                          <td style={{ padding: "2px 0", color: "#333" }}>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.solar_consistency && (
                <div style={{ ...S.box, borderColor: result.solar_consistency.toLowerCase().includes("inconsistent") ? "#cc6600" : "#006600" }}>
                  <ST color={result.solar_consistency.toLowerCase().includes("inconsistent") ? "#884400" : "#004400"}>[ ПРОВЕРКА СОЛНЕЧНОЙ ГЕОМЕТРИИ ]</ST>
                  <div style={{ fontFamily: "'Courier New'", fontSize: "10px" }}>{result.solar_consistency}</div>
                </div>
              )}

              {result.alt_countries.length > 0 && (
                <div style={S.boxPurple}>
                  <ST color="#550055">[ АЛЬТЕРНАТИВНЫЕ КАНДИДАТЫ ]</ST>
                  {result.alt_countries.map((a, i) => (
                    <div key={i} style={{ marginBottom: "4px", fontFamily: "'Courier New'", fontSize: "10px" }}>
                      <b style={{ color: "#550055" }}>{a.country}</b>: {a.why}
                    </div>
                  ))}
                </div>
              )}

              {result.key_clues.length > 0 && (
                <div style={S.box}>
                  <ST color="#664400">[ РЕШАЮЩИЕ УЛИКИ ]</ST>
                  <table style={{ fontFamily: "'Courier New'", fontSize: "10px", width: "100%" }}>
                    <tbody>
                      {result.key_clues.map((clue, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #ddd" }}>
                          <td style={{ padding: "3px 6px 3px 0", color: "#ff6600", fontWeight: "bold", width: "20px" }}>[{i+1}]</td>
                          <td style={{ padding: "3px 0", color: "#333", lineHeight: "1.4" }}>{clue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.strongest_clue && (
                    <div style={{ marginTop: "5px", background: "#fffff0", border: "1px solid #ffcc00", padding: "4px 6px", fontSize: "10px", color: "#664400", fontFamily: "'Courier New'" }}>
                      &gt;&gt; ГЛАВНАЯ УЛИКА: {result.strongest_clue}
                    </div>
                  )}
                  {result.missed_clue && (
                    <div style={{ marginTop: "3px", background: "#fff0ff", border: "1px solid #aa00aa", padding: "4px 6px", fontSize: "10px", color: "#550055", fontFamily: "'Courier New'" }}>
                      &gt;&gt; ПРОПУЩЕНО (adversarial): {result.missed_clue}
                    </div>
                  )}
                </div>
              )}

              {result.if_i_knew && (
                <div style={S.boxYellow}>
                  <ST color="#664400">[ ЧТО РЕШИТ НЕОПРЕДЕЛЁННОСТЬ ]</ST>
                  <div style={{ fontFamily: "'Courier New'", fontSize: "10px", color: "#444", lineHeight: "1.5" }}>{result.if_i_knew}</div>
                </div>
              )}

              {result.why_hard && (
                <div style={{ ...S.box, borderColor: "#666" }}>
                  <ST color="#444">[ ПОЧЕМУ ЭТО СЛОЖНО ]</ST>
                  <div style={{ fontFamily: "'Courier New'", fontSize: "10px", color: "#444", lineHeight: "1.5" }}>{result.why_hard}</div>
                </div>
              )}

              {result.maps_queries.length > 0 && (
                <div style={S.box}>
                  <ST color="#440066">[ ЗАПРОСЫ GOOGLE MAPS ]</ST>
                  {result.maps_queries.map((q, i) => (
                    <div key={i} style={{ marginBottom: "2px" }}>
                      <a href={`https://www.google.com/maps/search/${encodeURIComponent(q)}`} target="_blank" rel="noreferrer" style={{ fontFamily: "'Courier New'", fontSize: "10px", color: "#0000cc" }}>
                        [{i+1}] {q} &gt;&gt;
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {result.sv_points.length > 0 && (
                <div style={S.box}>
                  <ST color="#004466">[ ТОЧКИ STREET VIEW ]</ST>
                  {result.sv_points.map((sv, i) => (
                    <div key={i} style={{ marginBottom: "2px" }}>
                      <a href={`https://www.google.com/maps/search/${encodeURIComponent(sv)}`} target="_blank" rel="noreferrer" style={{ fontFamily: "'Courier New'", fontSize: "10px", color: "#0000cc" }}>
                        &gt;&gt; {sv} &gt;&gt;
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {result.verifications.length > 0 && (
                <div style={S.boxYellow}>
                  <ST color="#664400">[ ШАГИ ВЕРИФИКАЦИИ ]</ST>
                  <ol style={{ fontFamily: "'Courier New'", fontSize: "10px", paddingLeft: "18px", color: "#333" }}>
                    {result.verifications.map((v, i) => <li key={i} style={{ marginBottom: "4px", lineHeight: "1.5" }}>{v}</li>)}
                  </ol>
                </div>
              )}

              {result.osint_tip && (
                <div style={S.boxOrange}>
                  <ST color="#cc4400">[ НЕМЕДЛЕННОЕ ДЕЙСТВИЕ OSINT ]</ST>
                  <b style={{ fontFamily: "'Courier New'", fontSize: "11px", color: "#880000" }}>{result.osint_tip}</b><br />
                  <a href={`https://www.google.com/search?q=${encodeURIComponent(result.osint_tip)}`} target="_blank" rel="noreferrer" style={S.link}>[Поиск]</a>
                  <a href={`https://www.google.com/maps/search/${encodeURIComponent(result.osint_tip)}`} target="_blank" rel="noreferrer" style={S.link}>[Maps]</a>
                </div>
              )}

              {result.eliminations.length > 0 && (
                <div style={S.boxRed}>
                  <ST color="#660000">[ ИСКЛЮЧЁННЫЕ ЗОНЫ ]</ST>
                  {result.eliminations.map((e, i) => (
                    <div key={i} style={{ fontFamily: "'Courier New'", fontSize: "10px", color: "#cc0000", marginBottom: "2px" }}>[-] {e}</div>
                  ))}
                </div>
              )}

              {result.contradiction && !["consistent","none"].includes(result.contradiction?.toLowerCase()) && (
                <div style={{ ...S.box, background: "#fff0e0", borderColor: "#ff6600" }}>
                  <ST color="#884400">[ ПРОТИВОРЕЧИЯ ]</ST>
                  <div style={{ fontFamily: "'Courier New'", fontSize: "10px", color: "#884400", lineHeight: "1.5" }}>{result.contradiction}</div>
                </div>
              )}

              {result.maps_search_quality && (
                <div style={S.box}>
                  <ST color="#006666">[ ОЦЕНКА КАЧЕСТВА ПОИСКА ]</ST>
                  <div style={{ fontFamily: "'Courier New'", fontSize: "10px", color: "#333", lineHeight: "1.5" }}>{result.maps_search_quality}</div>
                </div>
              )}

              <Div />

              {[
                ["ШАГ 0 -- Инвентаризация + GeoGuessr", combined01, "#003300", "#f0fff0"],
                ["ШАГ 1 -- Региональный дрилл", result.regionalDrill, "#440066", "#fff0ff"],
                ["ШАГ 2 -- Солнечная геометрия", result.solarTriangulation, "#664400", "#fffff0"],
                ["ШАГ 3 -- Веб-поиск (полный отчёт)", result.mapsVerif, "#005555", "#e0ffff"],
              ].map(([label, content, color, bg]) => content ? (
                <details key={label} style={{ marginBottom: "4px" }}>
                  <summary style={{ background: "#e0e0e0", border: "1px outset #fff", padding: "3px 6px", fontFamily: "'Courier New'", fontSize: "10px", fontWeight: "bold", color }}>
                    [+] {label}
                  </summary>
                  <div style={{ background: bg, border: "1px inset #808080", padding: "8px", fontFamily: "'Courier New'", fontSize: "9px", color: "#333", whiteSpace: "pre-wrap", maxHeight: "300px", overflowY: "auto", lineHeight: "1.4" }}>
                    {content}
                  </div>
                </details>
              ) : null)}
            </>
          )}
        </td>
      </tr></tbody></table>

      <div style={{ textAlign: "center", fontFamily: "'Courier New'", fontSize: "9px", color: "#666", marginTop: "6px", borderTop: "2px solid #000080", paddingTop: "4px" }}>
        GEOFINDER OSINT v16-ULTRA :: 5 ПРОХОДОВ :: ПИКСЕЛИ+ГЕОГЕСС * РЕГИОН * СОЛНЦЕ * ВЕБ-ПОИСК * СИНТЕЗ+ADVERSARIAL<br />
        <span style={{ color: "#884400" }}>:: razvedka.ru/osint :: ~65% меньше токенов vs v15, ~35% vs v15-OPT :: 100% функций ::</span>
      </div>
    </div>
  );
}
