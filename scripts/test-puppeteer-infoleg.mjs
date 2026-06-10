#!/usr/bin/env node
// Test aislado: ¿pasa Puppeteer el WAF de servicios.infoleg.gob.ar?
// Y de paso: ¿auto-ejecuta la SPA de argentina.gob.ar la busqueda desde la URL?
// Uso (desde la raiz del repo): node scripts/test-puppeteer-infoleg.mjs
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "servers", "legal-mcp", "package.json"));
const puppeteer = require("puppeteer");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"]
});

async function probar(nombre, url, evaluar) {
    const page = await browser.newPage();
    try {
        await page.setUserAgent(UA);
        await page.setExtraHTTPHeaders({ "Accept-Language": "es-AR,es;q=0.9" });
        const resp = await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
        const status = resp ? resp.status() : "sin respuesta";
        const extra = await evaluar(page);
        console.log(`\n[${nombre}]`);
        console.log(`  URL: ${url}`);
        console.log(`  HTTP: ${status}`);
        console.log(`  ${extra}`);
    }
    catch (e) {
        console.log(`\n[${nombre}] ERROR: ${e.message}`);
    }
    finally {
        await page.close();
    }
}

// 1. Buscador clasico de InfoLEG (el que daba 403 a axios)
await probar(
    "servicios.infoleg buscarNormas.do",
    "https://servicios.infoleg.gob.ar/infolegInternet/buscarNormas.do?texto=%22locacion+de+obra%22&pageSize=20&pagina=1",
    async (page) => {
        const html = await page.content();
        const forbidden = /forbidden|don't have permission/i.test(html.replace(/<[^>]*>/g, " ").slice(0, 600));
        const links = await page.$$eval("a[href*='verNorma.do']", as => as.length).catch(() => 0);
        const total = (await page.evaluate(() => document.body.innerText).catch(() => ""))
            .match(/\d[\d.]*\s+resultados?/i)?.[0] || "no detectado";
        return forbidden
            ? "RESULTADO: pagina Forbidden (WAF sigue bloqueando a Puppeteer)"
            : `RESULTADO: OK - ${links} links a verNorma.do | total informado: ${total}`;
    }
);

// 2. SPA de argentina.gob.ar: ¿auto-ejecuta la busqueda desde los parametros de URL?
await probar(
    "argentina.gob.ar /normativa?texto=...",
    "https://www.argentina.gob.ar/normativa?jurisdiccion=nacional&texto=locacion+de+obra&limit=50&offset=1",
    async (page) => {
        await page.waitForSelector("table tbody tr a[href*='/normativa/']", { timeout: 20000 }).catch(() => {});
        const filas = await page.$$eval("table tbody tr", trs => trs.length).catch(() => 0);
        const anchors = await page.$$eval("a[href*='/normativa/nacional/']", as => as
            .map(a => a.getAttribute("href"))
            .filter(h => /-\d+\/?$/.test(h) && !/\/norma-\d+\/?$/.test(h)).length).catch(() => 0);
        return `RESULTADO: ${filas} filas de tabla | ${anchors} anchors de resultado (sin destacados)`;
    }
);

await browser.close();
console.log("\nListo. Pegame la salida completa.");
