import { useState, useRef, useCallback } from "react";

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function callClaude(messages, system, maxTokens = 1500) {
  const body = { model: "claude-sonnet-4-20250514", max_tokens: maxTokens, messages };
  if (system) body.system = system;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await r.json();
    if (!r.ok) throw new Error(`Ошибка API ${r.status}: ${data?.error?.message || JSON.stringify(data)}`);
    const textBlock = data.content?.find(b => b.type === "text");
    if (!textBlock) throw new Error("Пустой ответ — " + JSON.stringify(data.content));
    return textBlock.text.trim();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("Таймаут (90 сек) — медленная сеть или слишком большое изображение");
    throw err;
  }
}

async function geoAnalysis(base64, mediaType, onLog) {
  const t = (label) => {
    const start = Date.now();
    return () => onLog(`  >>> ${label} — ${((Date.now() - start) / 1000).toFixed(1)} сек`);
  };

  onLog(">>> ШАГ 0: Микро-форензика (отражения, скрытые детали)...");
  const done0 = t("Шаг 0 завершён");
  const microDetails = await callClaude([{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: `You are the world's top OSINT micro-forensics analyst. Find every hidden, reflected, or subtle detail that could reveal the EXACT location.

TASK 1: REFLECTIONS - examine ALL reflective surfaces: windshields, glass windows, puddles, metallic surfaces, mirrors. For EACH: describe what is visible, any text legible.

TASK 2: BACKGROUND DETAILS - signs partially hidden, illuminated signs at distance, building signage, directional signs, banners, bus destination boards, parking signs.

TASK 3: HIDDEN TEXT - manholes, drain covers, utility boxes, pavement markings, regulatory notices, address numbers, electrical boxes.

TASK 4: VEHICLES - license plates (read EXACTLY), dealer stickers, taxi logos, delivery van branding, parking permits.

TASK 5: COMMERCIAL ZONE - adjacent business names, pylon signs, ZAC entrance signage, phone numbers (French: 01=Paris, 02=NW, 03=NE, 04=SE, 05=SW).

TASK 6: SKY/ATMOSPHERE - weather, time of day, light color temperature.

TASK 7: MICRO-ARCHITECTURE - pavement markings color, drain grate design, bollard colors, fire hydrant color, post box color.

List EVERY finding no matter how small.` }
    ]
  }], "You are a forensic micro-detail extractor. Be obsessively specific.", 1500);
  done0();

  onLog(">>> ШАГ 1: Полная форензическая экстракция...");
  const done1 = t("Шаг 1 завершён");
  const extraction = await callClaude([{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: `You are a world-class forensic geolocation analyst. Identify this location down to the EXACT STREET.

PRIORITY 1 - ALL VISIBLE TEXT: street name plates, business names, building numbers, traffic signs, directional signs, phone numbers, parking zones.

COMMERCIAL ZONE PROTOCOL: main anchor business + format/generation, adjacent businesses, pylon signs, parking configuration, drive-through layout, canopy details, topography, road access.

ARCHITECTURE: style, era, materials, roof type, windows.

STREET ANATOMY: surface, markings, road width, lighting style, fencing.

VEGETATION: tree species, hedge species, season indicators.

BACKGROUND: hills, water, church spires, industrial structures.

Describe everything systematically.` }
    ]
  }], "World-class forensic geolocation analyst. Commercial zone specialist.", 1500);
  done1();

  onLog(">>> ШАГ 2: Географический анализ...");
  const done2 = t("Шаг 2 завершён");
  const reasoning = await callClaude([{
    role: "user",
    content: `You are the world's best geolocation expert. Identify EXACT location.

MICRO-FORENSIC:
${microDetails}

ENVIRONMENT:
${extraction}

STEP 1 - MICRO-CLUE EXPLOITATION: plates, reflections, business names, phone prefixes.
STEP 2 - TEXT ANCHORING: every text clue cross-referenced.
STEP 3 - COUNTRY: definitive, 3 specific proofs.
STEP 4 - REGION/DEPARTMENT: specific departments named.
STEP 5 - CITY: franchise databases, adjacent businesses, 2-4 candidates with %.
STEP 6 - ZONE: ZAC name, commercial zone name.
STEP 7 - STREET: 3-5 specific addresses with street names.
STEP 8 - ELIMINATION: what is ruled out.
STEP 9 - FINAL VERDICT: specific address, ZAC, city, country.`
  }], "World's best geolocation expert. Street-level precision required.", 1400);
  done2();

  onLog(">>> ШАГ 3: Генерация адресов-кандидатов...");
  const done3 = t("Шаг 3 завершён");
  const structured = await callClaude([{
    role: "user",
    content: `Based on this analysis generate structured location data. Reply ONLY with XML tags, no markdown.

MICRO-FORENSIC:
${microDetails}

ANALYSIS:
${reasoning}

<country>country</country>
<city>specific city</city>
<district>district or ZAC name</district>
<street_area>street name or intersection</street_area>
<addr1>first candidate address</addr1>
<addr1_why>reason</addr1_why>
<addr2>second candidate</addr2>
<addr2_why>reason</addr2_why>
<addr3>third candidate</addr3>
<addr3_why>reason</addr3_why>
<addr4>fourth candidate</addr4>
<addr4_why>reason</addr4_why>
<addr5>fifth candidate</addr5>
<addr5_why>reason</addr5_why>
<best_guess>single most likely address</best_guess>
<best_conf>confidence 0-100</best_conf>
<conf_country>0-100</conf_country>
<conf_city>0-100</conf_city>
<conf_district>0-100</conf_district>
<conf_street>0-100</conf_street>
<lat>decimal latitude</lat>
<lng>decimal longitude</lng>
<precision>street|block|district|city|region</precision>
<maps_q1>specific Google Maps query</maps_q1>
<maps_q2>second query</maps_q2>
<maps_q3>third query</maps_q3>
<maps_q4>fourth query</maps_q4>
<maps_q5>fifth query</maps_q5>
<sv1>Street View address 1</sv1>
<sv2>Street View address 2</sv2>
<sv3>Street View address 3</sv3>
<key_clue>most decisive clue</key_clue>
<key_clue2>second clue</key_clue2>
<key_clue3>third clue</key_clue3>
<key_clue4>fourth clue</key_clue4>
<text_found>all text found including reflections</text_found>
<plate_found>license plates</plate_found>
<adjacent_biz>adjacent businesses</adjacent_biz>
<eliminate1>excluded zone 1</eliminate1>
<eliminate2>excluded zone 2</eliminate2>
<eliminate3>excluded zone 3</eliminate3>
<arch_style>architectural style</arch_style>
<arch_era>construction decade</arch_era>
<climate_zone>climate/vegetation</climate_zone>
<sun_direction>compass direction</sun_direction>
<reverse_search>most googleable thing to confirm</reverse_search>
<zac_name>commercial zone name</zac_name>`
  }], "Reply ONLY with XML tags. Maximum precision.", 1400);
  done3();

  onLog(">>> ШАГ 4: Финальная триангуляция и верификация...");
  const done4 = t("Шаг 4 завершён");
  const verification = await callClaude([{
    role: "user",
    content: `Finalize precision OSINT geolocation. Check contradictions. Reply ONLY with XML.

MICRO-FORENSIC:
${microDetails}

EXTRACTION:
${extraction}

REASONING:
${reasoning}

1. CONTRADICTION CHECK: does proposed location actually have this commercial zone + franchise format?
2. PLATE VERIFICATION: plate format confirms country/region?
3. REFLECTION EXPLOITATION: fully exploited?
4. ADJACENT BUSINESS: cities with BOTH businesses in same zone?
5. STRONGEST CLUE: single most location-specific detail?
6. STREET VIEW: exact coordinate to open?
7. VERIFICATION: 3 specific steps.

<final_address>most precise verifiable address</final_address>
<strongest_clue>single most decisive indicator</strongest_clue>
<contradiction>contradictions found or "none"</contradiction>
<plate_interpretation>license plate interpretation</plate_interpretation>
<reflection_exploit>what reflections revealed</reflection_exploit>
<verify1>exact step 1</verify1>
<verify2>exact step 2</verify2>
<verify3>exact step 3</verify3>
<final_conf>confidence 0-100</final_conf>
<street_conf>street confidence 0-100</street_conf>
<osint_tip>one OSINT action to confirm location</osint_tip>`
  }], "Reply ONLY with XML. Be maximally precise and critical.", 800);
  done4();

  const tag = (src, name) => {
    const m = src.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
    return m ? m[1].trim() : "";
  };
  const num = (src, name) => { const v = parseFloat(tag(src, name)); return isNaN(v) ? null : v; };
  const int = (src, name, fallback = 0) => { const v = parseInt(tag(src, name)); return isNaN(v) ? fallback : v; };

  return {
    microDetails, extraction, reasoning,
    country: tag(structured, "country"),
    city: tag(structured, "city"),
    district: tag(structured, "district"),
    street_area: tag(structured, "street_area"),
    candidates: [
      { address: tag(structured, "addr1"), why: tag(structured, "addr1_why") },
      { address: tag(structured, "addr2"), why: tag(structured, "addr2_why") },
      { address: tag(structured, "addr3"), why: tag(structured, "addr3_why") },
      { address: tag(structured, "addr4"), why: tag(structured, "addr4_why") },
      { address: tag(structured, "addr5"), why: tag(structured, "addr5_why") },
    ].filter(c => c.address),
    best_guess: tag(structured, "best_guess"),
    best_conf: int(structured, "best_conf"),
    conf_country: int(structured, "conf_country"),
    conf_city: int(structured, "conf_city"),
    conf_district: int(structured, "conf_district"),
    conf_street: int(structured, "conf_street"),
    lat: num(structured, "lat"),
    lng: num(structured, "lng"),
    precision: tag(structured, "precision"),
    maps_queries: [tag(structured,"maps_q1"),tag(structured,"maps_q2"),tag(structured,"maps_q3"),tag(structured,"maps_q4"),tag(structured,"maps_q5")].filter(Boolean),
    sv_points: [tag(structured,"sv1"),tag(structured,"sv2"),tag(structured,"sv3")].filter(Boolean),
    key_clues: [tag(structured,"key_clue"),tag(structured,"key_clue2"),tag(structured,"key_clue3"),tag(structured,"key_clue4")].filter(Boolean),
    text_found: tag(structured, "text_found"),
    plate_found: tag(structured, "plate_found"),
    adjacent_biz: tag(structured, "adjacent_biz"),
    zac_name: tag(structured, "zac_name"),
    reverse_search: tag(structured, "reverse_search"),
    eliminations: [tag(structured,"eliminate1"),tag(structured,"eliminate2"),tag(structured,"eliminate3")].filter(Boolean),
    arch_style: tag(structured, "arch_style"),
    arch_era: tag(structured, "arch_era"),
    climate_zone: tag(structured, "climate_zone"),
    sun_direction: tag(structured, "sun_direction"),
    final_address: tag(verification, "final_address"),
    strongest_clue: tag(verification, "strongest_clue"),
    contradiction: tag(verification, "contradiction"),
    plate_interpretation: tag(verification, "plate_interpretation"),
    reflection_exploit: tag(verification, "reflection_exploit"),
    osint_tip: tag(verification, "osint_tip"),
    verifications: [tag(verification,"verify1"),tag(verification,"verify2"),tag(verification,"verify3")].filter(Boolean),
    final_conf: int(verification, "final_conf"),
    street_conf: int(verification, "street_conf"),
  };
}

// ============================================================
// UI — СТИЛЬ РУССКОГО ФОРУМА 2003 ГОДА
// ============================================================

const S = {
  page: {
    background: "#c0c0c0",
    fontFamily: "'Comic Sans MS', 'Times New Roman', serif",
    minHeight: "100vh",
    padding: "8px",
    fontSize: "13px",
    color: "#000080",
  },
  topBanner: {
    background: "linear-gradient(90deg, #000080, #0000cc, #000080)",
    color: "#ffff00",
    textAlign: "center",
    padding: "6px",
    fontFamily: "'Comic Sans MS', cursive",
    fontSize: "20px",
    fontWeight: "bold",
    border: "3px outset #ffffff",
    marginBottom: "4px",
    textShadow: "2px 2px #ff0000",
    letterSpacing: "2px",
  },
  subBanner: {
    background: "#ff6600",
    color: "#ffffff",
    textAlign: "center",
    padding: "3px",
    fontSize: "11px",
    fontFamily: "Arial, sans-serif",
    marginBottom: "6px",
    border: "1px solid #cc4400",
  },
  mainTable: {
    width: "100%",
    borderCollapse: "collapse",
    border: "2px inset #808080",
    background: "#ffffff",
  },
  headerCell: {
    background: "#000080",
    color: "#ffffff",
    padding: "4px 8px",
    fontSize: "12px",
    fontWeight: "bold",
    fontFamily: "Arial, sans-serif",
    border: "1px solid #0000cc",
  },
  sectionTitle: {
    background: "#000080",
    color: "#ffff00",
    padding: "3px 6px",
    fontSize: "11px",
    fontWeight: "bold",
    fontFamily: "Arial, sans-serif",
    borderBottom: "2px solid #ff6600",
    marginBottom: "4px",
    display: "block",
  },
  box: {
    border: "2px inset #808080",
    background: "#f0f0f0",
    padding: "6px",
    marginBottom: "6px",
  },
  boxRed: {
    border: "2px inset #808080",
    background: "#fff0f0",
    padding: "6px",
    marginBottom: "6px",
  },
  boxYellow: {
    border: "2px inset #808080",
    background: "#fffff0",
    padding: "6px",
    marginBottom: "6px",
  },
  boxGreen: {
    border: "2px inset #808080",
    background: "#f0fff0",
    padding: "6px",
    marginBottom: "6px",
  },
  dropzone: {
    border: "3px dashed #000080",
    background: "#e8e8ff",
    padding: "20px",
    textAlign: "center",
    cursor: "pointer",
    marginBottom: "6px",
    fontFamily: "'Comic Sans MS', cursive",
    color: "#000080",
    fontSize: "13px",
  },
  dropzoneDrag: {
    border: "3px dashed #ff0000",
    background: "#ffeeee",
    padding: "20px",
    textAlign: "center",
    cursor: "pointer",
    marginBottom: "6px",
  },
  btn: {
    background: "linear-gradient(180deg, #e0e0e0 0%, #a0a0a0 100%)",
    border: "2px outset #ffffff",
    color: "#000080",
    fontFamily: "'Comic Sans MS', cursive",
    fontWeight: "bold",
    fontSize: "14px",
    padding: "6px 20px",
    cursor: "pointer",
    width: "100%",
    marginBottom: "6px",
    textTransform: "uppercase",
  },
  btnDisabled: {
    background: "#a0a0a0",
    border: "2px inset #808080",
    color: "#606060",
    fontFamily: "Arial, sans-serif",
    fontSize: "13px",
    padding: "6px 20px",
    cursor: "not-allowed",
    width: "100%",
    marginBottom: "6px",
  },
  logBox: {
    background: "#000000",
    color: "#00ff00",
    fontFamily: "'Courier New', monospace",
    fontSize: "11px",
    padding: "6px",
    border: "2px inset #808080",
    maxHeight: "150px",
    overflowY: "auto",
    marginBottom: "6px",
  },
  confBig: (conf) => ({
    fontSize: "48px",
    fontWeight: "bold",
    color: conf >= 75 ? "#006600" : conf >= 45 ? "#ff6600" : "#cc0000",
    fontFamily: "'Comic Sans MS', cursive",
    textAlign: "center",
    textShadow: "2px 2px #cccccc",
    display: "block",
  }),
  link: {
    color: "#0000cc",
    fontSize: "11px",
    fontFamily: "Arial, sans-serif",
    textDecoration: "underline",
    display: "inline-block",
    marginRight: "8px",
    marginBottom: "2px",
  },
  candRow: (i) => ({
    background: i % 2 === 0 ? "#e8e8ff" : "#ffffff",
    borderBottom: "1px solid #c0c0c0",
    padding: "4px 6px",
  }),
  separator: {
    height: "2px",
    background: "linear-gradient(90deg, #000080, #ff6600, #000080)",
    margin: "6px 0",
    border: "none",
  },
  meterBar: (val) => ({
    height: "12px",
    width: `${val}%`,
    background: val >= 75 ? "#006600" : val >= 45 ? "#ff6600" : "#cc0000",
    display: "inline-block",
    border: "1px inset #808080",
    verticalAlign: "middle",
  }),
  blinkStyle: {
    animation: "russBlink 1s step-start infinite",
  },
  errorBox: {
    border: "2px solid #cc0000",
    background: "#ffcccc",
    padding: "8px",
    color: "#cc0000",
    fontFamily: "Arial, sans-serif",
    fontSize: "12px",
    marginBottom: "6px",
  },
};

function Blink({ children }) {
  return <span style={{ animation: "russBlink 1s step-start infinite" }}>{children}</span>;
}

function Divider() {
  return <hr style={S.separator} />;
}

function SectionTitle({ children, color }) {
  return (
    <div style={{ ...S.sectionTitle, background: color || "#000080" }}>
      {children}
    </div>
  );
}

function Meter({ label, value }) {
  const color = value >= 75 ? "#006600" : value >= 45 ? "#ff6600" : "#cc0000";
  return (
    <div style={{ marginBottom: "3px", fontFamily: "Arial, sans-serif", fontSize: "11px" }}>
      <span style={{ display: "inline-block", width: "160px", color: "#000080" }}>{label}:</span>
      <span style={S.meterBar(value)} />
      <span style={{ color, fontWeight: "bold", marginLeft: "4px" }}>{value}%</span>
    </div>
  );
}

export default function GeoFinderRusskiy() {
  const [image, setImage] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("idle");
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const fileRef = useRef();
  const addLog = useCallback((msg) => setLogs(prev => [...prev, msg]), []);

  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const base64 = await toBase64(file);
    setImage({ url, base64, mediaType: file.type, name: file.name });
    setResult(null); setError(""); setStatus("idle"); setLogs([]);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const run = useCallback(async () => {
    if (!image) return;
    setStatus("analyzing"); setResult(null); setError(""); setLogs([]);
    try {
      const data = await geoAnalysis(image.base64, image.mediaType, addLog);
      setResult(data);
      setStatus("done");
    } catch (err) {
      setError(err.message || "Неизвестная ошибка");
      setStatus("error");
    }
  }, [image, addLog]);

  const precLabel = { street: "УЛИЦА ТОЧНАЯ", block: "КВАРТАЛ", district: "РАЙОН", city: "ГОРОД", region: "РЕГИОН" };

  return (
    <div style={S.page}>
      <style>{`
        @keyframes russBlink { 0%,100%{visibility:visible} 50%{visibility:hidden} }
        a:visited { color: #800080; }
        details summary { cursor: pointer; color: #000080; font-family: Arial, sans-serif; font-size: 11px; }
      `}</style>

      {/* TOP BANNER */}
      <div style={S.topBanner}>
        [ ГЕОЛОКАТОР ОСИНТ v10 ]
      </div>
      <div style={S.subBanner}>
        :: Определение местоположения по фотографии :: Форум разведчиков :: Версия 10.0 :: Работает на Claude AI ::
      </div>

      {/* MAIN LAYOUT */}
      <table style={S.mainTable}>
        <tbody>
          <tr>
            {/* LEFT PANEL */}
            <td style={{ width: "320px", verticalAlign: "top", padding: "6px", borderRight: "2px inset #808080" }}>

              <SectionTitle>[ ЗАГРУЗКА ИЗОБРАЖЕНИЯ ]</SectionTitle>

              <div
                style={dragging ? S.dropzoneDrag : S.dropzone}
                onDrop={onDrop}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onClick={() => !image && fileRef.current.click()}
              >
                {!image ? (
                  <>
                    <div style={{ fontSize: "32px" }}>[DIR]</div>
                    <div><b>Перетащи файл сюда</b></div>
                    <div style={{ fontSize: "11px", color: "#666666" }}>или нажми чтобы выбрать</div>
                    <div style={{ fontSize: "11px", color: "#666666" }}>JPG · PNG · WebP</div>
                  </>
                ) : (
                  <div style={{ textAlign: "left" }}>
                    <img src={image.url} alt="цель" style={{ width: "80px", height: "80px", objectFit: "cover", border: "2px inset #808080", float: "left", marginRight: "8px" }} />
                    <div style={{ fontFamily: "Arial, sans-serif", fontSize: "11px" }}>
                      <span style={{ background: "#006600", color: "#ffffff", padding: "1px 4px", fontSize: "10px" }}>OK ЗАГРУЖЕНО</span><br />
                      <span style={{ color: "#000000", fontSize: "11px" }}>{image.name}</span><br />
                      <span
                        onClick={(e) => { e.stopPropagation(); setImage(null); setResult(null); setStatus("idle"); setLogs([]); }}
                        style={{ color: "#cc0000", cursor: "pointer", textDecoration: "underline", fontSize: "11px" }}
                      >[ удалить ]</span>
                    </div>
                    <div style={{ clear: "both" }} />
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />

              {image && (
                <button
                  style={status === "analyzing" ? S.btnDisabled : S.btn}
                  onClick={run}
                  disabled={status === "analyzing"}
                >
                  {status === "analyzing" ? "... АНАЛИЗИРУЮ ..." : ">>> НАЧАТЬ АНАЛИЗ <<<"}
                </button>
              )}

              {/* LIVE LOGS */}
              {logs.length > 0 && (
                <>
                  <SectionTitle color="#004400">[ ЛОГ ОПЕРАЦИИ ]</SectionTitle>
                  <div style={S.logBox}>
                    {logs.map((l, i) => (
                      <div key={i} style={{ color: i === logs.length - 1 && status === "analyzing" ? "#00ff00" : "#00aa00" }}>
                        {i === logs.length - 1 && status === "analyzing" ? <Blink>█</Blink> : ">"} {l}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ERROR */}
              {error && (
                <div style={S.errorBox}>
                  <b>!!! ОШИБКА !!!</b><br />
                  {error}
                </div>
              )}

              {/* IMAGE PREVIEW AFTER RESULT */}
              {result && image && (
                <>
                  <SectionTitle>[ АНАЛИЗИРУЕМОЕ ФОТО ]</SectionTitle>
                  <img src={image.url} alt="цель" style={{ width: "100%", border: "2px inset #808080", display: "block" }} />
                </>
              )}

              <Divider />
              <div style={{ fontFamily: "Arial, sans-serif", fontSize: "10px", color: "#808080", textAlign: "center" }}>
                GeolocationForum.ru © 2003-2026<br />
                Всего запросов: <b>???</b> | Онлайн: <b>???</b><br />
                <span style={{ color: "#ff6600" }}>** Лучший сайт рунета 2004 **</span>
              </div>
            </td>

            {/* RIGHT PANEL — RESULTS */}
            <td style={{ verticalAlign: "top", padding: "6px" }}>

              {!result && status === "idle" && (
                <div style={{ textAlign: "center", padding: "40px", color: "#808080", fontFamily: "'Comic Sans MS', cursive" }}>
                  <div style={{ fontSize: "32px", fontFamily: "monospace", color: "#000080" }}>[?]</div>
                  <div style={{ fontSize: "16px", color: "#000080" }}>Загрузите фотографию и нажмите кнопку анализа</div>
                  <div style={{ fontSize: "11px", marginTop: "8px" }}>Система определит местоположение по 5 проходам анализа</div>
                  <Divider />
                  <div style={{ fontSize: "10px", fontFamily: "Arial, sans-serif", color: "#808080" }}>
                    Powered by Claude AI · Микро-форензика · Анализ отражений · Определение номеров<br />
                    Архитектурный анализ · Коммерческие зоны · Геолокация улиц
                  </div>
                </div>
              )}

              {result && (
                <>
                  {/* CONFIDENCE SCORE */}
                  <div style={{ ...S.box, textAlign: "center", borderColor: "#000080" }}>
                    <SectionTitle>[ УВЕРЕННОСТЬ СИСТЕМЫ ]</SectionTitle>
                    <span style={S.confBig(result.final_conf || result.best_conf)}>
                      {result.final_conf || result.best_conf}%
                    </span>
                    {result.precision && (
                      <div style={{ fontFamily: "Arial, sans-serif", fontSize: "12px", color: "#000080", marginTop: "2px" }}>
                        Точность: <b style={{ color: "#ff6600" }}>{precLabel[result.precision] || result.precision.toUpperCase()}</b>
                      </div>
                    )}
                    <div style={{ fontFamily: "'Comic Sans MS', cursive", fontSize: "14px", color: "#006600", marginTop: "4px", fontWeight: "bold" }}>
                      {result.best_guess}
                    </div>
                  </div>

                  <Divider />

                  {/* PRIORITY ADDRESS */}
                  {result.final_address && (
                    <div style={S.boxYellow}>
                      <SectionTitle color="#cc6600">[ >> ПРИОРИТЕТНЫЙ АДРЕС — ПРОВЕРИТЬ ПЕРВЫМ ]</SectionTitle>
                      <b style={{ fontFamily: "'Comic Sans MS', cursive", fontSize: "14px", color: "#cc0000" }}>
                        {result.final_address}
                      </b>
                      <br />
                      <a href={`https://www.google.com/maps/search/${encodeURIComponent(result.final_address)}`}
                        target="_blank" rel="noreferrer" style={S.link}>
                        [Google Maps]
                      </a>
                      {result.lat && result.lng && (
                        <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${result.lat},${result.lng}`}
                          target="_blank" rel="noreferrer" style={S.link}>
                          [Street View]
                        </a>
                      )}
                      {result.lat && result.lng && (
                        <a href={`https://www.google.com/maps/@${result.lat},${result.lng},17z`}
                          target="_blank" rel="noreferrer" style={S.link}>
                          [Спутник]
                        </a>
                      )}
                    </div>
                  )}

                  {/* CANDIDATES TABLE */}
                  {result.candidates.length > 0 && (
                    <div style={S.box}>
                      <SectionTitle color="#006600">[ АДРЕСА-КАНДИДАТЫ ({result.candidates.length} шт.) ]</SectionTitle>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Arial, sans-serif", fontSize: "11px" }}>
                        <thead>
                          <tr style={{ background: "#000080", color: "#ffffff" }}>
                            <td style={{ padding: "2px 4px", width: "24px" }}>#</td>
                            <td style={{ padding: "2px 4px" }}>Адрес</td>
                            <td style={{ padding: "2px 4px" }}>Обоснование</td>
                            <td style={{ padding: "2px 4px", width: "80px" }}>Ссылки</td>
                          </tr>
                        </thead>
                        <tbody>
                          {result.candidates.map((c, i) => (
                            <tr key={i} style={S.candRow(i)}>
                              <td style={{ padding: "3px 4px", fontWeight: "bold", color: ["#cc0000","#ff6600","#000080"][i] || "#000080" }}>{i + 1}</td>
                              <td style={{ padding: "3px 4px", fontWeight: "bold", color: "#000080" }}>{c.address}</td>
                              <td style={{ padding: "3px 4px", color: "#333333", fontSize: "10px" }}>{c.why}</td>
                              <td style={{ padding: "3px 4px" }}>
                                <a href={`https://www.google.com/maps/search/${encodeURIComponent(c.address)}`}
                                  target="_blank" rel="noreferrer" style={{ ...S.link, fontSize: "10px" }}>[Maps]</a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* CONFIDENCE METERS */}
                  <div style={S.box}>
                    <SectionTitle>[ ТОЧНОСТЬ ПО УРОВНЯМ ]</SectionTitle>
                    {result.conf_country > 0 && <Meter label={`Страна: ${result.country || "?"}`} value={result.conf_country} />}
                    {result.conf_city > 0 && <Meter label={`Город: ${result.city || "?"}`} value={result.conf_city} />}
                    {result.conf_district > 0 && <Meter label={`Район: ${result.district || "?"}`} value={result.conf_district} />}
                    {(result.conf_street > 0 || result.street_conf > 0) && <Meter label={`Улица: ${result.street_area || "?"}`} value={result.conf_street || result.street_conf} />}
                  </div>

                  {/* LOCATION DATA */}
                  <div style={S.box}>
                    <SectionTitle>[ ДАННЫЕ МЕСТОПОЛОЖЕНИЯ ]</SectionTitle>
                    <table style={{ fontFamily: "Arial, sans-serif", fontSize: "11px", borderCollapse: "collapse" }}>
                      <tbody>
                        {[
                          ["Страна", result.country],
                          ["Город", result.city],
                          ["Район / Зона", result.district],
                          ["Улица / Зона", result.street_area],
                          ["Архитектура", result.arch_style],
                          ["Эпоха", result.arch_era],
                          ["Климат", result.climate_zone],
                          ["Ориентация солнца", result.sun_direction],
                        ].map(([k, v]) => v ? (
                          <tr key={k}>
                            <td style={{ padding: "2px 8px 2px 0", color: "#000080", fontWeight: "bold", whiteSpace: "nowrap" }}>{k}:</td>
                            <td style={{ padding: "2px 0", color: "#333333" }}>{v}</td>
                          </tr>
                        ) : null)}
                      </tbody>
                    </table>
                    {result.lat && result.lng && (
                      <div style={{ marginTop: "4px", fontFamily: "monospace", fontSize: "11px", color: "#006600" }}>
                        GPS: {result.lat.toFixed(5)}, {result.lng.toFixed(5)}
                      </div>
                    )}
                  </div>

                  {/* TEXT FOUND */}
                  {result.text_found && (
                    <div style={S.boxGreen}>
                      <SectionTitle color="#004400">[ ТЕКСТ ОБНАРУЖЕН НА ИЗОБРАЖЕНИИ ]</SectionTitle>
                      <div style={{ fontFamily: "monospace", fontSize: "11px", color: "#004400", lineHeight: "1.5" }}>
                        {result.text_found}
                      </div>
                      {result.reverse_search && (
                        <a href={`https://www.google.com/search?q=${encodeURIComponent(result.reverse_search)}`}
                          target="_blank" rel="noreferrer" style={S.link}>
                          [Гугл: {result.reverse_search}]
                        </a>
                      )}
                    </div>
                  )}

                  {/* PLATES */}
                  {result.plate_found && (
                    <div style={S.boxRed}>
                      <SectionTitle color="#660000">[ ## НОМЕРНЫЕ ЗНАКИ ]</SectionTitle>
                      <b style={{ fontFamily: "monospace", fontSize: "15px", color: "#cc0000", letterSpacing: "3px" }}>{result.plate_found}</b>
                      {result.plate_interpretation && (
                        <div style={{ fontFamily: "Arial, sans-serif", fontSize: "11px", color: "#333333", marginTop: "4px" }}>{result.plate_interpretation}</div>
                      )}
                      <br />
                      <a href={`https://www.google.com/search?q=${encodeURIComponent(result.plate_found + " immatriculation")}`}
                        target="_blank" rel="noreferrer" style={S.link}>
                        [Поиск по номеру]
                      </a>
                    </div>
                  )}

                  {/* ADJACENT BIZ */}
                  {result.adjacent_biz && (
                    <div style={S.box}>
                      <SectionTitle color="#004466">[ ## СОСЕДНИЕ ЗАВЕДЕНИЯ ]</SectionTitle>
                      <div style={{ fontFamily: "monospace", fontSize: "12px", color: "#004466" }}>{result.adjacent_biz}</div>
                      <a href={`https://www.google.com/maps/search/${encodeURIComponent(result.adjacent_biz)}`}
                        target="_blank" rel="noreferrer" style={S.link}>
                        [Найти на картах]
                      </a>
                    </div>
                  )}

                  {/* ZAC */}
                  {result.zac_name && (
                    <div style={S.box}>
                      <SectionTitle color="#004466">[ ## ТОРГОВАЯ ЗОНА ]</SectionTitle>
                      <b style={{ fontFamily: "monospace", fontSize: "13px", color: "#004466" }}>{result.zac_name}</b>
                      <br />
                      <a href={`https://www.google.com/maps/search/${encodeURIComponent(result.zac_name)}`}
                        target="_blank" rel="noreferrer" style={S.link}>[Карты]</a>
                    </div>
                  )}

                  {/* REFLECTIONS */}
                  {result.reflection_exploit && (
                    <div style={S.box}>
                      <SectionTitle color="#440044">[ ## АНАЛИЗ ОТРАЖЕНИЙ ]</SectionTitle>
                      <div style={{ fontFamily: "Arial, sans-serif", fontSize: "11px", color: "#440044" }}>{result.reflection_exploit}</div>
                    </div>
                  )}

                  {/* OSINT TIP */}
                  {result.osint_tip && (
                    <div style={{ ...S.box, borderColor: "#cc0000", background: "#fff8f8" }}>
                      <SectionTitle color="#cc0000">[ !! НЕМЕДЛЕННОЕ ДЕЙСТВИЕ ОСИНТ ]</SectionTitle>
                      <b style={{ fontFamily: "'Comic Sans MS', cursive", fontSize: "12px", color: "#cc0000" }}>{result.osint_tip}</b>
                      <br />
                      <a href={`https://www.google.com/search?q=${encodeURIComponent(result.osint_tip)}`}
                        target="_blank" rel="noreferrer" style={S.link}>
                        [Выполнить поиск]
                      </a>
                    </div>
                  )}

                  {/* KEY CLUES */}
                  {result.key_clues.length > 0 && (
                    <div style={S.box}>
                      <SectionTitle color="#664400">[ РЕШАЮЩИЕ УЛИКИ ]</SectionTitle>
                      <table style={{ fontFamily: "Arial, sans-serif", fontSize: "11px", width: "100%" }}>
                        <tbody>
                          {result.key_clues.map((clue, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid #c0c0c0" }}>
                              <td style={{ padding: "3px 6px 3px 0", color: "#ff6600", fontWeight: "bold", width: "20px" }}>[*]</td>
                              <td style={{ padding: "3px 0", color: "#333333" }}>{clue}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {result.strongest_clue && (
                        <div style={{ marginTop: "6px", background: "#fffff0", border: "1px solid #ffcc00", padding: "4px 6px", fontSize: "11px", color: "#664400", fontFamily: "Arial, sans-serif" }}>
                          >> ГЛАВНАЯ УЛИКА: {result.strongest_clue}
                        </div>
                      )}
                    </div>
                  )}

                  {/* MAPS QUERIES */}
                  {result.maps_queries.length > 0 && (
                    <div style={S.box}>
                      <SectionTitle color="#440066">[ ЗАПРОСЫ GOOGLE MAPS ]</SectionTitle>
                      {result.maps_queries.map((q, i) => (
                        <div key={i} style={{ marginBottom: "2px" }}>
                          <a href={`https://www.google.com/maps/search/${encodeURIComponent(q)}`}
                            target="_blank" rel="noreferrer" style={{ fontFamily: "monospace", fontSize: "11px", color: "#0000cc" }}>
                            [{i + 1}] {q} ↗
                          </a>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* STREET VIEW */}
                  {result.sv_points.length > 0 && (
                    <div style={S.box}>
                      <SectionTitle color="#004466">[ ТОЧКИ STREET VIEW ]</SectionTitle>
                      {result.sv_points.map((sv, i) => (
                        <div key={i} style={{ marginBottom: "2px" }}>
                          <a href={`https://www.google.com/maps/search/${encodeURIComponent(sv)}`}
                            target="_blank" rel="noreferrer" style={{ fontFamily: "monospace", fontSize: "11px", color: "#0000cc" }}>
                            >> {sv} ↗
                          </a>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* VERIFICATION STEPS */}
                  {result.verifications.length > 0 && (
                    <div style={S.boxYellow}>
                      <SectionTitle color="#664400">[ ШАГИ ВЕРИФИКАЦИИ ]</SectionTitle>
                      <ol style={{ fontFamily: "Arial, sans-serif", fontSize: "11px", paddingLeft: "18px", color: "#333333" }}>
                        {result.verifications.map((v, i) => (
                          <li key={i} style={{ marginBottom: "4px", lineHeight: "1.5" }}>{v}</li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* ELIMINATIONS */}
                  {result.eliminations.length > 0 && (
                    <div style={S.boxRed}>
                      <SectionTitle color="#660000">[ ИСКЛЮЧЁННЫЕ ЗОНЫ ]</SectionTitle>
                      {result.eliminations.map((e, i) => (
                        <div key={i} style={{ fontFamily: "Arial, sans-serif", fontSize: "11px", color: "#cc0000", marginBottom: "2px" }}>-- {e}</div>
                      ))}
                    </div>
                  )}

                  {/* CONTRADICTION */}
                  {result.contradiction && result.contradiction !== "none" && (
                    <div style={{ ...S.box, background: "#fff0e0", borderColor: "#ff6600" }}>
                      <SectionTitle color="#884400">[ !! ПРОТИВОРЕЧИЯ ]</SectionTitle>
                      <div style={{ fontFamily: "Arial, sans-serif", fontSize: "11px", color: "#884400" }}>{result.contradiction}</div>
                    </div>
                  )}

                  <Divider />

                  {/* RAW DATA TOGGLES */}
                  <details style={{ marginBottom: "4px" }}>
                    <summary style={{ background: "#e0e0e0", border: "1px outset #ffffff", padding: "3px 6px", fontFamily: "Arial, sans-serif", fontSize: "11px", fontWeight: "bold", color: "#000080" }}>
                      [+] Показать: Полный географический анализ
                    </summary>
                    <div style={{ background: "#f8f8f8", border: "1px inset #808080", padding: "8px", fontFamily: "monospace", fontSize: "10px", color: "#333333", whiteSpace: "pre-wrap", maxHeight: "250px", overflowY: "auto" }}>
                      {result.reasoning}
                    </div>
                  </details>

                  <details style={{ marginBottom: "4px" }}>
                    <summary style={{ background: "#e0e0e0", border: "1px outset #ffffff", padding: "3px 6px", fontFamily: "Arial, sans-serif", fontSize: "11px", fontWeight: "bold", color: "#000080" }}>
                      [+] Показать: Визуальная экстракция
                    </summary>
                    <div style={{ background: "#f8f8f8", border: "1px inset #808080", padding: "8px", fontFamily: "monospace", fontSize: "10px", color: "#333333", whiteSpace: "pre-wrap", maxHeight: "250px", overflowY: "auto" }}>
                      {result.extraction}
                    </div>
                  </details>

                  <details style={{ marginBottom: "4px" }}>
                    <summary style={{ background: "#e0e0e0", border: "1px outset #ffffff", padding: "3px 6px", fontFamily: "Arial, sans-serif", fontSize: "11px", fontWeight: "bold", color: "#660066" }}>
                      [+] Показать: Микро-форензика (отражения, номера, скрытые детали)
                    </summary>
                    <div style={{ background: "#f0f0ff", border: "1px inset #808080", padding: "8px", fontFamily: "monospace", fontSize: "10px", color: "#440044", whiteSpace: "pre-wrap", maxHeight: "250px", overflowY: "auto" }}>
                      {result.microDetails}
                    </div>
                  </details>
                </>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {/* FOOTER */}
      <div style={{ textAlign: "center", fontFamily: "Arial, sans-serif", fontSize: "10px", color: "#808080", marginTop: "6px", borderTop: "2px solid #000080", paddingTop: "4px" }}>
        GEOFINDER OSINT v10 :: 5-PASS CLAUDE VISION :: МИКРО-ФОРЕНЗИКА + ЗАК + НОМЕРА<br />
        <span style={{ color: "#ff0000" }}>Сайт оптимизирован для Internet Explorer 6.0 при разрешении 800x600</span>
      </div>
    </div>
  );
}
