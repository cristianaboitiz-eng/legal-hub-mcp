#!/usr/bin/env node
// Test de la nueva via POST del buscador de normativa nacional.
// Uso: node scripts/test-busqueda-post.mjs
import path from "path";
import { fileURLToPath } from "url";

process.env.VERCEL = "1"; // evita que infoleg.js conecte stdio al importarse

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mod = path.join(ROOT, "servers", "legal-mcp", "build", "infoleg.js")
    .replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:");
const { searchNormativaOfficial } = await import(mod);

const casos = [
    { nombre: 'texto libre "locacion de obra"', params: { jurisdiccion: "nacional", texto: "locacion de obra" } },
    { nombre: "Ley 27430 con anio 2017 (debe omitir el anio y encontrarla)", params: { jurisdiccion: "nacional", tipoNorma: "Ley", numeroNorma: "27430", anioNorma: "2017" } },
    { nombre: "dependencia difusa 'Ministerio de Trabajo' + leyes desde 2020", params: { jurisdiccion: "nacional", tipoNorma: "Ley", dependencia: "Ministerio de Trabajo", publicacionDesde: "2020-01-01" } },
];

for (const caso of casos) {
    try {
        const r = await searchNormativaOfficial(caso.params);
        console.log(`\n[${caso.nombre}]`);
        console.log(`  metodo: ${r.metodo} | conteo: ${r.countText || "-"} | resultados: ${r.results.length}`);
        r.results.slice(0, 5).forEach((x, i) => console.log(`  ${i + 1}. ${x.titulo} (id ${x.id || "?"})`));
    }
    catch (e) {
        console.log(`\n[${caso.nombre}] ERROR: ${e.message.split("\n")[0]}`);
    }
}
console.log("\nListo.");
process.exit(0);
