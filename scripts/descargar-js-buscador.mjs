#!/usr/bin/env node
// Descarga los JS del buscador de argentina.gob.ar para analisis local.
// Uso: node scripts/descargar-js-buscador.mjs
import { createRequire } from "module";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "servers", "legal-mcp", "package.json"));
const axios = require("axios");

const DEST = path.join(ROOT, "scripts", "_capturas");
mkdirSync(DEST, { recursive: true });

const archivos = [
    ["infoleg_normativa.js", "https://www.argentina.gob.ar/profiles/argentinagobar/modules/argentinagobar/argentinagobar_infoleg/js/infoleg_normativa.js"],
    ["solr_search.js", "https://www.argentina.gob.ar/profiles/argentinagobar/modules/argentinagobar/argentinagobar_search/js/solr_search.js"],
    ["toogle_blocks.js", "https://www.argentina.gob.ar/profiles/argentinagobar/modules/argentinagobar/argentinagobar_infoleg/js/toogle_blocks.js"],
];

for (const [nombre, url] of archivos) {
    try {
        const r = await axios.get(url, {
            timeout: 30000,
            responseType: "text",
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
        });
        const destino = path.join(DEST, nombre);
        writeFileSync(destino, r.data, "utf8");
        console.log(`OK  ${nombre} (${r.data.length} bytes) -> ${destino}`);
    }
    catch (e) {
        console.log(`FAIL ${nombre}: ${e.message}`);
    }
}
console.log("\nListo. Avisame cuando termine (no hace falta pegar nada, los leo del disco).");
