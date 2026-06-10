#!/usr/bin/env node
// Smoke test de los fixes del 10/06/2026.
// Uso (desde la raiz del repo):  node scripts/smoke-test-fixes.mjs
// Requiere red. El test 4 usa Puppeteer (descarga Chrome si no esta).
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

process.env.VERCEL = "1"; // evita que infoleg.js conecte stdio al importarse

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "servers", "legal-mcp", "build");
const files = ["index.js", "infoleg.js", "juba.js", "bopba.js", "ptn.js", "bora.js", "tfn.js", "normativapba.js"];

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✅ ${name}`); };
const bad = (name, e) => { fail++; console.log(`  ❌ ${name}: ${e}`); };

console.log("1. Sintaxis (node --check)");
for (const f of files) {
    const r = spawnSync(process.execPath, ["--check", path.join(BUILD, f)], { encoding: "utf8" });
    r.status === 0 ? ok(f) : bad(f, r.stderr.trim());
}

console.log("2. Helpers de InfoLEG");
const { getInfoLegRange, fetchTextoFromArgentinaGobAr, searchNormativaOfficial } =
    await import(path.join(BUILD, "infoleg.js").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:"));

getInfoLegRange("296831") === "295000-299999"
    ? ok("getInfoLegRange(296831) -> 295000-299999")
    : bad("getInfoLegRange", getInfoLegRange("296831"));

console.log("3. Fallback argentina.gob.ar (texto por ID, sin tocar servicios.infoleg)");
try {
    const r1 = await fetchTextoFromArgentinaGobAr("296831", "original");
    /INSTITUTO ANTARTICO/i.test(r1.text) && r1.text.length > 1000
        ? ok(`Decreto-Ley 1311/56 (id 296831): ${r1.text.length} caracteres`)
        : bad("296831", `texto inesperado (${r1.text.slice(0, 120)})`);
} catch (e) { bad("296831", e.message); }
try {
    const r2 = await fetchTextoFromArgentinaGobAr("296846", "actualizado");
    /responsabilidad penal/i.test(r2.text) && r2.advertencia
        ? ok("Ley 27.401 (id 296846) con advertencia de texto original")
        : bad("296846", "falta texto o advertencia");
} catch (e) { bad("296846", e.message); }

console.log("4. Buscador renderizado con Puppeteer (puede tardar ~30-60s)");
try {
    const s = await searchNormativaOfficial({ jurisdiccion: "nacional", texto: "locacion de obra" });
    s.results.length > 0
        ? ok(`"locacion de obra": ${s.results.length} resultados via ${s.metodo}`)
        : bad("busqueda", `0 resultados (metodo: ${s.metodo}) - revisar selector de espera o parametros de la SPA`);
} catch (e) { bad("busqueda", e.message); }

console.log(`\nResultado: ${pass} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
