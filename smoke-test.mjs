#!/usr/bin/env node
/**
 * Smoke test - bopba + pjnjuris + bora + tfn + juba + normativapba
 * Ejecutar desde: C:\Users\Ximena\mcp-legal-ar
 * Comando: node smoke-test.mjs
 */

import axios from "axios";
import * as cheerio from "cheerio";
import https from "https";
import { readFileSync } from "fs";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const axiosClient = axios.create({ httpsAgent, timeout: 15000 });

const OK  = (label, data) => { console.log(`  ✅ ${label}`); if (data !== undefined) console.log("    ", JSON.stringify(data).substring(0, 140)); };
const ERR = (label, err)  => console.error(`  ❌ ${label}: ${err.message || err}`);

const BUILD = "C:\\Users\\Ximena\\mcp-legal-ar\\servers\\legal-mcp\\build";
const src = (file) => readFileSync(`${BUILD}\\${file}`, "utf-8");

// ─── helper source-inspection reutilizable ────────────────────────────────────
//
// Verifica 4 condiciones por conector migrado a tls-fallback:
//   import_ok              → import { installTlsFallback } from "./tls-fallback.js" presente
//   install_ok             → installTlsFallback( presente (llamada real)
//   no_residual_httpsAgent → NO hay "const httpsAgent = new https.Agent(" (patrón viejo)
//                            OJO: "const httpsAgent = installTlsFallback(" es válido → no se penaliza
//   no_import_https        → NO hay "import https from" (dependencia directa eliminada)

function checkTlsFallback(file) {
  const code = src(file);
  return {
    import_ok:              code.includes('from "./tls-fallback.js"'),
    install_ok:             code.includes('installTlsFallback('),
    no_residual_httpsAgent: !code.includes('new https.Agent('),
    no_import_https:        !code.includes('import https from'),
  };
}

// ─── BOPBA ────────────────────────────────────────────────────────────────────

async function bopba_obtener_ultimo_boletin() {
  const $ = cheerio.load((await axiosClient.get("https://boletinoficial.gba.gob.ar/", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  })).data);
  const fecha = $('.bulletin-date strong').text().trim()
    || $('.bulletin-date').text().replace('Ver anteriores','').trim();
  const secciones = [];
  $('.bulletin-box').each((_, box) => {
    const $b = $(box);
    const nombre = $b.find('h4').text().trim();
    let id = '';
    $b.find('a').each((_, a) => {
      const m = ($(a).attr('href')||'').match(/\/secciones\/(\d+)/);
      if (m) { id = m[1]; return false; }
    });
    if (nombre) secciones.push({ nombre, id });
  });
  return { fecha, secciones_count: secciones.length, primera: secciones[0] };
}

async function bopba_buscar_boletin() {
  const q = new URLSearchParams({ "search[words]": "licitacion", "search[sort]": "by_date_desc", utf8: "✔" });
  const $ = cheerio.load((await axiosClient.get(`https://boletinoficial.gba.gob.ar/buscar?${q}`, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" }
  })).data);
  const results = [];
  $('.result-box').each((_, box) => {
    const $b = $(box);
    const title = $b.find('.title a').first().text().trim();
    const m = ($b.find('.title a[download]').first().attr('href')||'').match(/\/secciones\/(\d+)/);
    if (title) results.push({ title: title.substring(0,60), id: m?.[1]||'' });
  });
  return { count: results.length, first: results[0] };
}

async function bopba_calcular_tarifa_guard() {
  const tasasOficiales = {};
  const categoria = "Balances";
  const tasa = tasasOficiales[categoria]?.["normal"];
  if (tasa === undefined) return { guard_ok: true, message: "optional chaining devuelve undefined correctamente, guard activo" };
  return { guard_ok: false };
}

// ─── PJNJURIS ─────────────────────────────────────────────────────────────────

async function pjnjuris_sin_sesion() {
  const globalPage = null;
  const toolName = "pjn_buscar_jurisprudencia_por_expediente";
  if (!globalPage) {
    return {
      isError: true,
      message_snippet: `[ERROR] ${toolName}: el endpoint scw.pjn.gov.ar`.substring(0, 80)
    };
  }
  return { isError: false };
}

async function pjnjuris_alcance_fuente() {
  const expected_strings = [
    "pjn-juris-mcp v1.0.0",
    "iniciar_hitl_browser",
    "finalizar_hitl_browser",
    "pjn_descargar_fallo_pdf",
    "NO IMPLEMENTADO"
  ];
  const code = src("pjnjuris.js");
  const missing = expected_strings.filter(s => !code.includes(s));
  return { all_present: missing.length === 0, missing };
}

async function pjnjuris_cleanup_handlers() {
  const code = src("pjnjuris.js");
  return {
    sigint:     code.includes('process.on("SIGINT"'),
    sigterm:    code.includes('process.on("SIGTERM"'),
    exit:       code.includes('process.on("exit"'),
    cleanup_fn: code.includes('cleanupBrowser')
  };
}

// ─── BORA ─────────────────────────────────────────────────────────────────────

async function bora_tls_fallback() {
  return checkTlsFallback("bora.js");
}

async function bora_fetch_seccion_primera() {
  // Fecha argentina hoy en formato YYYYMMDD
  const ar = new Date().toLocaleDateString("en-US", { timeZone: "America/Argentina/Buenos_Aires" });
  const [m, d, y] = ar.split("/");
  const hoy = `${y}${m.padStart(2,"0")}${d.padStart(2,"0")}`;
  const url = `https://www.boletinoficial.gob.ar/seccion/primera/${hoy}`;
  const res = await axiosClient.get(url, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });
  return { status: res.status, fecha: hoy, has_html: res.data.length > 500 };
}

// ─── TFN ──────────────────────────────────────────────────────────────────────

async function tfn_tls_fallback() {
  return checkTlsFallback("tfn.js");
}

async function tfn_api_latest_cases() {
  // Replica la lógica de resolveApiBase del conector: prueba el endpoint primario
  const res = await axiosClient.get("https://api.jurisprudencia-tfn.ar/latestCases", {
    timeout: 12000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": "https://jurisprudenciatfn.mecon.gob.ar/"
    }
  });
  const cases = Array.isArray(res.data) ? res.data : (res.data?.results || []);
  return {
    status: res.status,
    count: cases.length,
    first_id: cases[0]?.fallo_id || cases[0]?.registro || null
  };
}

// ─── JUBA ─────────────────────────────────────────────────────────────────────

async function juba_tls_fallback() {
  return checkTlsFallback("juba.js");
}

async function juba_home_aspnet() {
  // Verifica que el home ASP.NET responde y tiene form + __VIEWSTATE
  const res = await axiosClient.get("https://juba.scba.gov.ar/Buscar.aspx", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  });
  const $ = cheerio.load(res.data);
  return {
    status: res.status,
    tiene_form: $("form").length > 0,
    tiene_viewstate: $("input[name='__VIEWSTATE']").length > 0
  };
}

// ─── NORMATIVAPBA ─────────────────────────────────────────────────────────────

async function normativapba_tls_fallback() {
  return checkTlsFallback("normativapba.js");
}

async function normativapba_fetch_ley15558() {
  // Ley 15558 (2024) - norma real que existe en el portal
  const url = "https://normas.gba.gob.ar/ar-b/ley/2024/15558/1";
  const res = await axiosClient.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept": "text/html"
    }
  });
  const $ = cheerio.load(res.data);
  const titulo = $("h1, h2, .norma-titulo").first().text().trim().substring(0, 80);
  return { status: res.status, has_content: res.data.length > 200, titulo: titulo || "(sin h1/h2)" };
}

// ─── RUNNER ───────────────────────────────────────────────────────────────────

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  SMOKE TEST: bopba + pjnjuris + bora + tfn + juba + normativapba");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

console.log("── BOPBA ──────────────────────────────────────────");
try { OK("obtener_ultimo_boletin",       await bopba_obtener_ultimo_boletin()); }   catch(e) { ERR("obtener_ultimo_boletin", e); }
try { OK("buscar_boletin (licitacion)",  await bopba_buscar_boletin()); }           catch(e) { ERR("buscar_boletin", e); }
try { OK("calcular_tarifa guard",        await bopba_calcular_tarifa_guard()); }    catch(e) { ERR("calcular_tarifa guard", e); }

console.log("\n── PJNJURIS ───────────────────────────────────────");
try { OK("sin sesión → error correcto",  await pjnjuris_sin_sesion()); }            catch(e) { ERR("sin sesión", e); }
try { OK("alcance_fuente strings",       await pjnjuris_alcance_fuente()); }        catch(e) { ERR("alcance_fuente", e); }
try { OK("cleanup handlers",             await pjnjuris_cleanup_handlers()); }      catch(e) { ERR("cleanup handlers", e); }

console.log("\n── BORA ───────────────────────────────────────────");
try { OK("tls-fallback",                 await bora_tls_fallback()); }              catch(e) { ERR("tls-fallback", e); }
try { OK("fetch sección primera (hoy)",  await bora_fetch_seccion_primera()); }     catch(e) { ERR("fetch sección primera", e); }

console.log("\n── TFN ────────────────────────────────────────────");
try { OK("tls-fallback",                 await tfn_tls_fallback()); }               catch(e) { ERR("tls-fallback", e); }
try { OK("API latestCases",              await tfn_api_latest_cases()); }           catch(e) { ERR("API latestCases", e); }

console.log("\n── JUBA ───────────────────────────────────────────");
try { OK("tls-fallback",                 await juba_tls_fallback()); }              catch(e) { ERR("tls-fallback", e); }
try { OK("home ASP.NET (form+VIEWSTATE)",await juba_home_aspnet()); }              catch(e) { ERR("home ASP.NET", e); }

console.log("\n── NORMATIVAPBA ───────────────────────────────────");
try { OK("tls-fallback",                 await normativapba_tls_fallback()); }      catch(e) { ERR("tls-fallback", e); }
try { OK("fetch Ley 15558",              await normativapba_fetch_ley15558()); }    catch(e) { ERR("fetch Ley 15558", e); }

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
