#!/usr/bin/env node
// Captura automatizada del XHR del buscador de argentina.gob.ar/normativa.
// Navega, completa el formulario, dispara la busqueda y registra todas las
// peticiones de red relevantes (XHR/fetch/document), como un DevTools.
// Uso: node scripts/capturar-xhr-normativa.mjs
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "servers", "legal-mcp", "package.json"));
const puppeteer = require("puppeteer");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const IGNORAR = /\.(png|jpe?g|gif|svg|woff2?|ttf|css|ico)(\?|$)|googletagmanager|google-analytics|gstatic|doubleclick|hotjar|facebook/i;

const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"]
});
const page = await browser.newPage();
await page.setUserAgent(UA);
await page.setExtraHTTPHeaders({ "Accept-Language": "es-AR,es;q=0.9" });

const capturas = [];
page.on("response", async (resp) => {
    const req = resp.request();
    const url = req.url();
    const tipo = req.resourceType();
    if (IGNORAR.test(url)) return;
    if (!["xhr", "fetch", "document", "script"].includes(tipo)) return;
    let preview = "";
    if (tipo === "xhr" || tipo === "fetch") {
        try { preview = (await resp.text()).replace(/\s+/g, " ").slice(0, 220); } catch { }
    }
    capturas.push({ tipo, metodo: req.method(), status: resp.status(), url, preview });
});

console.log("1. Cargando https://www.argentina.gob.ar/normativa ...");
await page.goto("https://www.argentina.gob.ar/normativa", { waitUntil: "networkidle2", timeout: 60000 });

console.log("2. Buscando el campo de texto del formulario...");
const selectorTexto = await page.evaluate(() => {
    const candidatos = Array.from(document.querySelectorAll("input[type='text'], input[type='search'], input:not([type])"));
    const visible = candidatos.find(i => i.offsetParent !== null && !/bolet[ií]n|numero_boletin/i.test(i.name + i.id + i.placeholder));
    if (!visible) return null;
    if (visible.id) return `#${visible.id}`;
    if (visible.name) return `input[name="${visible.name}"]`;
    return null;
});
console.log(`   Campo detectado: ${selectorTexto || "NO ENCONTRADO (intento generico)"}`);

const sel = selectorTexto || "input[type='text']";
await page.click(sel).catch(() => {});
await page.type(sel, "locacion de obra", { delay: 30 }).catch(e => console.log(`   No pude tipear: ${e.message}`));

console.log("3. Disparando la busqueda...");
const marcaAntes = capturas.length;
const clickeado = await page.evaluate(() => {
    const botones = Array.from(document.querySelectorAll("button, input[type='submit'], a.btn"));
    const buscar = botones.find(b => /buscar/i.test(b.textContent || b.value || ""));
    if (buscar) { buscar.click(); return true; }
    const form = document.querySelector("form");
    if (form) { form.submit(); return true; }
    return false;
});
if (!clickeado) {
    console.log("   No encontre boton Buscar; pruebo con Enter.");
    await page.keyboard.press("Enter");
}
await new Promise(r => setTimeout(r, 12000));

console.log("\n4. Estado final:");
console.log(`   URL final: ${page.url()}`);
const anchors = await page.$$eval("a[href*='/normativa/nacional/']", as => as.length).catch(() => 0);
console.log(`   Anchors a /normativa/nacional/: ${anchors}`);

console.log("\n5. PETICIONES CAPTURADAS (las posteriores al click son las que importan):");
capturas.forEach((c, i) => {
    const marca = i >= marcaAntes ? ">>> " : "    ";
    console.log(`${marca}[${c.tipo}] ${c.metodo} ${c.status} ${c.url}`);
    if (c.preview) console.log(`${marca}     cuerpo: ${c.preview}`);
});

await browser.close();
console.log("\nListo. Pegame TODA la salida, especialmente las lineas marcadas con >>>.");
