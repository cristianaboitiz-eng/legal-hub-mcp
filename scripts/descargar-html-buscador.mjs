#!/usr/bin/env node
// Descarga el HTML CRUDO (con scripts inline) de las paginas del buscador
// de normativa para analisis local del form action y Drupal.settings.
// Uso: node scripts/descargar-html-buscador.mjs
import { createRequire } from "module";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "servers", "legal-mcp", "package.json"));
const axios = require("axios");

const DEST = path.join(ROOT, "scripts", "_capturas");
mkdirSync(DEST, { recursive: true });

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-AR,es;q=0.9"
};

const paginas = [
    ["normativa_form.html", "https://www.argentina.gob.ar/normativa"],
    ["normativa_con_params.html", "https://www.argentina.gob.ar/normativa?jurisdiccion=nacional&texto=locacion+de+obra&limit=50&offset=1"],
    ["normativa_resultados.html", "https://www.argentina.gob.ar/normativa/resultados?jurisdiccion=nacional&texto=locacion+de+obra"],
];

for (const [nombre, url] of paginas) {
    try {
        const r = await axios.get(url, { timeout: 30000, responseType: "text", headers: HEADERS, maxRedirects: 5 });
        writeFileSync(path.join(DEST, nombre), r.data, "utf8");
        console.log(`OK  ${nombre} (${r.data.length} bytes)`);
    }
    catch (e) {
        console.log(`FAIL ${nombre}: ${e.message}`);
    }
}
console.log("\nListo. Avisame y los analizo del disco.");
