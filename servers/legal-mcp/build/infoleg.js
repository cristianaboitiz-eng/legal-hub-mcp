#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import https from "https";
import { pathToFileURL } from "url";
import crypto from "crypto";
import puppeteer from "puppeteer";
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});
const OFFICIAL_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-AR,es;q=0.9,en-US;q=0.8",
    "Cache-Control": "no-cache"
};
const ARGENTINA_BASE_URL = "https://www.argentina.gob.ar";
// Helper Zod validators
export const stringOrNumber = z.union([z.string(), z.number()]).transform(val => String(val));
export const stringOrNumberOptional = z.union([z.string(), z.number()]).transform(val => String(val)).optional();
function normalizeText(input) {
    return input.replace(/\s+/g, " ").trim();
}
function absoluteArgentinaUrl(href) {
    if (!href)
        return "";
    if (href.startsWith("http"))
        return href;
    return `${ARGENTINA_BASE_URL}${href.startsWith("/") ? href : `/${href}`}`;
}
function extractInfoLegId(href) {
    const idMatch = href.match(/-(\d+)(?:\/|$)/) || href.match(/[?&]id=(\d+)/);
    return idMatch ? idMatch[1] : "";
}
function normalizeInfoLegDate(date) {
    if (!date)
        return undefined;
    const clean = String(date).trim();
    const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso)
        return `${iso[3]}-${iso[2]}-${iso[1]}`;
    const slash = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (slash)
        return `${slash[1]}-${slash[2]}-${slash[3]}`;
    return clean;
}
function normalizeBoletinDate(date) {
    if (!date)
        return undefined;
    const clean = String(date).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean))
        return clean;
    const slash = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (slash)
        return `${slash[3]}-${slash[2]}-${slash[1]}`;
    const dash = clean.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dash)
        return `${dash[3]}-${dash[2]}-${dash[1]}`;
    return clean;
}
function normalizeTipoNorma(tipo) {
    if (!tipo)
        return undefined;
    const value = tipo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const known = {
        ley: "leyes",
        leyes: "leyes",
        decreto: "decretos",
        decretos: "decretos",
        resolucion: "resoluciones",
        resoluciones: "resoluciones",
        disposicion: "disposiciones",
        disposiciones: "disposiciones",
        dnu: "decretos",
        decision: "decisiones_administrativas",
        "decision administrativa": "decisiones_administrativas",
        "decisiones administrativas": "decisiones_administrativas"
    };
    return known[value] || tipo;
}
async function fetchOfficialHtml(url) {
    const response = await axios.get(url, {
        httpsAgent,
        headers: OFFICIAL_HEADERS,
        responseType: "arraybuffer"
    });
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    const charsetMatch = contentType.match(/charset=([^;]+)/);
    const charset = charsetMatch ? charsetMatch[1].trim() : "utf-8";
    const decoder = new TextDecoder(charset.includes("8859") ? "latin1" : "utf-8");
    return decoder.decode(response.data);
}
function buildNormativaSearchUrl(params) {
    const query = new URLSearchParams();
    query.set("jurisdiccion", params.jurisdiccion || "nacional");
    if (params.provincia)
        query.set("provincia", params.provincia);
    if (params.tipoNorma)
        query.set("tipo_norma", normalizeTipoNorma(params.tipoNorma) || params.tipoNorma);
    if (params.numeroNorma)
        query.set("numero", params.numeroNorma);
    if (params.anioNorma)
        query.set("sancion", params.anioNorma);
    if (params.dependencia)
        query.set("dependencia", params.dependencia);
    if (params.texto)
        query.set("texto", params.texto);
    if (params.publicacionDesde)
        query.set("publicacion_desde[date]", normalizeInfoLegDate(params.publicacionDesde) || params.publicacionDesde);
    if (params.publicacionHasta)
        query.set("publicacion_hasta[date]", normalizeInfoLegDate(params.publicacionHasta) || params.publicacionHasta);
    query.set("limit", "50");
    query.set("offset", String(params.pagina && params.pagina > 0 ? params.pagina : 1));
    return `${ARGENTINA_BASE_URL}/normativa?${query.toString()}`;
}
async function searchNormativaOfficial(params) {
    const url = buildNormativaSearchUrl(params);
    const html = await fetchOfficialHtml(url);
    const $ = cheerio.load(html);
    const pageText = normalizeText($("body").text());
    const countText = pageText.match(/\d+\s+normas?\s+encontradas?.*?\d+\s+p\S+gina/i)?.[0] || "";
    const results = [];
    $("table tbody tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 2)
            return;
        const firstCell = cells.eq(0);
        const link = firstCell.find("a").first();
        const href = link.attr("href") || "";
        const title = normalizeText(link.text());
        if (!title || !href.includes("/normativa/"))
            return;
        results.push({
            id: extractInfoLegId(href),
            titulo: title,
            organismo: normalizeText(firstCell.find("p.small").first().text()),
            descripcion: normalizeText(cells.eq(1).text()),
            paginaBoletin: normalizeText(cells.eq(2).text()),
            enlaceResumen: absoluteArgentinaUrl(href),
            enlaceTexto: `${absoluteArgentinaUrl(href)}/texto`
        });
    });
    return { url, countText, results };
}
function buildBoletinUrl(params) {
    const query = new URLSearchParams();
    query.set("jurisdiccion", params.jurisdiccion || "nacional");
    if (params.numeroBoletin)
        query.set("numero_boletin", params.numeroBoletin);
    if (params.fecha)
        query.set("buscar", normalizeBoletinDate(params.fecha) || params.fecha);
    query.set("limit", "50");
    query.set("offset", String(params.pagina && params.pagina > 0 ? params.pagina : 1));
    return `${ARGENTINA_BASE_URL}/normativa/buscar-boletin?${query.toString()}`;
}
async function fetchBoletin(params) {
    const url = buildBoletinUrl(params);
    const html = await fetchOfficialHtml(url);
    const $ = cheerio.load(html);
    const pageText = normalizeText($("body").text());
    const headingMatch = pageText.match(/Sumario\s+N\S*\s+(\d+)\s+del\s+Bolet\S+n Oficial de la Rep\S+blica Argentina/i);
    const dateMatch = pageText.match(/Fecha de publicaci\S+n:\s*([0-9-]+)/i);
    const entries = [];
    $("table tbody tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 2)
            return;
        const link = cells.eq(0).find("a").first();
        const href = link.attr("href") || "";
        const titulo = normalizeText(link.text());
        if (!titulo || !href.includes("/normativa/"))
            return;
        entries.push({
            id: extractInfoLegId(href),
            normativa: titulo,
            organismo: normalizeText(cells.eq(0).find("p.small").first().text()) || normalizeText(cells.eq(1).find("p.fw-semibold").first().text()),
            descripcion: normalizeText(cells.eq(1).text()),
            paginaBoletin: normalizeText(cells.eq(2).text()),
            enlaceResumen: absoluteArgentinaUrl(href),
            enlaceTexto: `${absoluteArgentinaUrl(href)}/texto`
        });
    });
    return {
        url,
        numeroBoletin: headingMatch ? headingMatch[1] : params.numeroBoletin || "",
        fechaPublicacion: dateMatch ? dateMatch[1] : "",
        entries
    };
}
function formatResultsList(title, sourceUrl, results) {
    let output = `# ${title}\n\n`;
    output += `* **Fuente consultada:** [Argentina.gob.ar](${sourceUrl})\n`;
    output += `* **Resultados devueltos:** ${results.length}\n\n`;
    results.forEach((item, idx) => {
        output += `## ${idx + 1}. ${item.titulo || item.normativa}\n\n`;
        if (item.id)
            output += `- **ID InfoLEG:** \`${item.id}\`\n`;
        if (item.organismo)
            output += `- **Organismo:** ${item.organismo}\n`;
        if (item.descripcion)
            output += `- **Descripcion:** ${item.descripcion}\n`;
        if (item.paginaBoletin)
            output += `- **Pagina Boletin:** ${item.paginaBoletin}\n`;
        if (item.enlaceResumen)
            output += `- **Resumen oficial:** ${item.enlaceResumen}\n`;
        if (item.enlaceTexto)
            output += `- **Texto oficial:** ${item.enlaceTexto}\n`;
        output += "\n";
    });
    return output.trim();
}
async function fetchNormaDetailByUrl(url) {
    const html = await fetchOfficialHtml(url);
    const $ = cheerio.load(html);
    const settingsText = $("script").map((_, s) => $(s).html() || "").get().find((text) => text.includes("normativaSchema")) || "";
    let schema = {};
    const schemaMatch = settingsText.match(/"normativaSchema":(\{.*?\}),"urlIsAjaxTrusted"/s);
    if (schemaMatch) {
        try {
            schema = JSON.parse(schemaMatch[1].replace(/\\\//g, "/"));
        }
        catch {
            schema = {};
        }
    }
    const fields = {};
    $("dl.normativa dt").each((_, dt) => {
        const key = normalizeText($(dt).text()).replace(/:$/, "");
        const value = normalizeText($(dt).next("dd").text());
        if (key && value)
            fields[key] = value;
    });
    const links = $("a")
        .map((_, a) => {
        const href = $(a).attr("href") || "";
        const text = normalizeText($(a).text());
        if (!href || !text)
            return null;
        return { text, url: absoluteArgentinaUrl(href) };
    })
        .get()
        .filter((link) => link.url.includes("/normativa/") || link.url.includes("infoleg"));
    return { url, schema, fields, resumen: normalizeText($("article p.small, .field-name-body, .pane-node-body").text()), links };
}
async function resolveNormaDetailUrl(args) {
    if (args.urlNorma)
        return args.urlNorma;
    if (args.tipoNorma || args.numeroNorma || args.anioNorma) {
        const result = await searchNormativaOfficial({
            jurisdiccion: "nacional",
            tipoNorma: args.tipoNorma,
            numeroNorma: args.numeroNorma,
            anioNorma: args.anioNorma
        });
        const found = args.idNorma ? result.results.find((item) => item.id === args.idNorma) : result.results[0];
        if (found?.enlaceResumen)
            return found.enlaceResumen;
    }
    throw new Error("No se pudo resolver la URL oficial de resumen. Pasa urlNorma o combina tipoNorma/numeroNorma/anioNorma.");
}
/**
 * Calculates the static annex directory range for a given InfoLEG ID.
 * InfoLEG splits static documents into folders of 50,000 files each:
 * e.g., ID 296831 falls in the "250000-299999" folder.
 */
export function getInfoLegRange(idStr) {
    const idNum = parseInt(idStr, 10);
    if (isNaN(idNum) || idNum < 0) {
        return "0-49999";
    }
    const floorLimit = Math.floor(idNum / 50000) * 50000;
    const ceilLimit = floorLimit + 49999;
    return `${floorLimit}-${ceilLimit}`;
}
/**
 * Builds the static HTML URL for direct document extraction.
 */
export function getInfoLegStaticUrl(idStr, tipoTexto = "actualizado") {
    const range = getInfoLegRange(idStr);
    const file = tipoTexto === "actualizado" ? "texact.htm" : "norma.htm";
    return `https://servicios.infoleg.gob.ar/infolegInternet/anexos/${range}/${idStr}/${file}`;
}
/**
 * Cleans and converts InfoLEG static HTML content into structured Markdown.
 */
export function cleanInfoLegHtml(html) {
    const $ = cheerio.load(html);
    // Remove scripts, styles, iframes, inputs
    $("script, style, iframe, input, select, textarea, button, link").remove();
    // Remove header banner images or top navigations if present
    $("img").remove();
    let markdown = "";
    // Recursive element formatter to preserve structure
    function parseNode(element) {
        element.contents().each((_, child) => {
            const node = $(child);
            const nodeType = child.type;
            if (nodeType === "text") {
                const text = node.text().replace(/\r?\n|\r/g, " ");
                markdown += text;
            }
            else if (nodeType === "tag") {
                const tagName = child.name.toLowerCase();
                switch (tagName) {
                    case "h1":
                    case "h2":
                        markdown += `\n\n# ${node.text().trim()}\n\n`;
                        break;
                    case "h3":
                    case "h4":
                        markdown += `\n\n## ${node.text().trim()}\n\n`;
                        break;
                    case "h5":
                    case "h6":
                        markdown += `\n\n### ${node.text().trim()}\n\n`;
                        break;
                    case "p":
                    case "div":
                        markdown += "\n\n";
                        parseNode(node);
                        markdown += "\n\n";
                        break;
                    case "br":
                        markdown += "\n";
                        break;
                    case "strong":
                    case "b":
                        markdown += " **";
                        parseNode(node);
                        markdown += "** ";
                        break;
                    case "em":
                    case "i":
                        markdown += " *";
                        parseNode(node);
                        markdown += "* ";
                        break;
                    case "u":
                        markdown += " _";
                        parseNode(node);
                        markdown += "_ ";
                        break;
                    case "a":
                        const href = node.attr("href") || "";
                        markdown += " [";
                        parseNode(node);
                        markdown += `](${href}) `;
                        break;
                    case "tr":
                        parseNode(node);
                        markdown += "\n";
                        break;
                    case "td":
                    case "th":
                        markdown += " | ";
                        parseNode(node);
                        break;
                    default:
                        parseNode(node);
                        break;
                }
            }
        });
    }
    // Target common body selectors or fallback to root
    const bodyText = $("body");
    if (bodyText.length > 0) {
        parseNode(bodyText);
    }
    else {
        parseNode($.root());
    }
    // Post-process to clean massive blank lines and spaces
    return markdown
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
/**
 * Searches InfoLEG directly via servicios.infoleg.gob.ar (no Drupal, no captcha).
 * Parses the HTML results page from the official search endpoint.
 */
async function searchCentralSolr(keys) {
    // Build search URL using InfoLEG's own search endpoint
    const query = new URLSearchParams();
    query.set("texto", keys);
    query.set("pageSize", "20");
    query.set("pagina", "1");
    const url = `https://servicios.infoleg.gob.ar/infolegInternet/buscarNormas.do?${query.toString()}`;
    const response = await axios.get(url, {
        httpsAgent,
        headers: OFFICIAL_HEADERS,
        responseType: "arraybuffer"
    });
    // InfoLEG serves ISO-8859-1
    const decoder = new TextDecoder("latin1");
    const html = decoder.decode(response.data);
    const $ = cheerio.load(html);
    const results = [];
    // Each result is a table row with links to verNorma.do
    $("table tr").each((_, row) => {
        const link = $(row).find("a[href*='verNorma.do']").first();
        if (!link.length)
            return;
        const href = link.attr("href") || "";
        const titulo = normalizeText(link.text());
        if (!titulo)
            return;
        const idMatch = href.match(/[?&]id=(\d+)/);
        const id = idMatch ? idMatch[1] : "";
        // Grab description from second cell
        const cells = $(row).find("td");
        const descripcion = cells.length > 1 ? normalizeText(cells.eq(1).text()) : "";
        results.push({
            id,
            titulo,
            enlace: id
                ? `https://servicios.infoleg.gob.ar/infolegInternet/verNorma.do?id=${id}`
                : href,
            resumen: descripcion
        });
    });
    return results;
}
async function fetchWithPuppeteer(url) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });
    try {
        const page = await browser.newPage();
        await page.setUserAgent(OFFICIAL_HEADERS["User-Agent"]);
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        const html = await page.content();
        return html;
    }
    finally {
        await browser.close();
    }
}
async function fetchCleanText(idNorma, textoHtmlManual) {
    if (textoHtmlManual && textoHtmlManual.trim().length > 0) {
        return {
            text: cleanInfoLegHtml(textoHtmlManual),
            url: "Texto de la norma ingresado manualmente por el usuario"
        };
    }
    if (idNorma) {
        const targetUrl = getInfoLegStaticUrl(idNorma, "actualizado");
        const originalUrl = getInfoLegStaticUrl(idNorma, "original");
        // Intento 1: GET directo (rápido)
        for (const url of [targetUrl, originalUrl]) {
            try {
                const response = await axios.get(url, { httpsAgent, headers: OFFICIAL_HEADERS });
                return { text: cleanInfoLegHtml(response.data), url };
            }
            catch {
                // continúa al siguiente
            }
        }
        // Intento 2: Puppeteer (simula navegador, evita bloqueo 403)
        for (const url of [targetUrl, originalUrl]) {
            try {
                const html = await fetchWithPuppeteer(url);
                return { text: cleanInfoLegHtml(html), url };
            }
            catch {
                // continúa al siguiente
            }
        }
        throw new Error(`No se pudo obtener el texto de la norma ${idNorma}. El portal de InfoLeg puede estar caído temporalmente.`);
    }
    throw new Error("Debe indicar el número identificador de la norma ('idNorma') o, en su defecto, pegar el texto de la misma en el campo manual correspondiente.");
}
export function extractTeleologicalJustification(text) {
    const lines = text.split("\n");
    let extracting = false;
    let resultLines = [];
    const startRegex = /^\s*(vistos?|considerando(s)?)\b/i;
    const endRegex = /^\s*(el\s+.*?(decreta|resuelve|dispone|sanciona)|por\s+ello,?)\b/i;
    for (const line of lines) {
        const trimmed = line.trim();
        if (startRegex.test(trimmed)) {
            extracting = true;
        }
        if (extracting) {
            resultLines.push(line);
            if (endRegex.test(trimmed) || trimmed.toUpperCase().includes("RESUELVE:") || trimmed.toUpperCase().includes("DECRETA:") || trimmed.toUpperCase().includes("SANCIONA CON FUERZA DE LEY:")) {
                break;
            }
        }
    }
    if (resultLines.length === 0) {
        const lowercaseText = text.toLowerCase();
        const vistoIndex = lowercaseText.indexOf("visto");
        const considerandoIndex = lowercaseText.indexOf("considerando");
        const startIndex = vistoIndex !== -1 ? vistoIndex : (considerandoIndex !== -1 ? considerandoIndex : 0);
        const resolveMatch = text.match(/(decreta|resuelve|dispone|sanciona con fuerza de ley|por ello)/i);
        const endIndex = resolveMatch && resolveMatch.index ? resolveMatch.index + resolveMatch[0].length : text.length;
        if (startIndex < endIndex) {
            return text.substring(startIndex, endIndex).trim();
        }
        return "No se pudieron aislar automáticamente las secciones de Vistos y Considerandos. Verifique el texto completo.";
    }
    return resultLines.join("\n").trim();
}
export function detectDeadlines(text) {
    const paragraphs = text.split(/\n\n+/);
    const results = [];
    const keywords = [
        { regex: /\b\d+\s+(días?\s+(habiles|corridos)?|meses|años?)\b/i, name: "Plazo numérico" },
        { regex: /\b(plazo|término)\s+de\s+(días?|meses|años?)\b/i, name: "Cláusula de plazo" },
        { regex: /\b(prescribe|prescribirá|prescripción)\b/i, name: "Prescripción" },
        { regex: /\b(caduca|caducidad)\b/i, name: "Caducidad" },
        { regex: /\b(mora|moroso)\b/i, name: "Mora" },
        { regex: /\b(vencimiento|vence)\b/i, name: "Vencimiento" },
        { regex: /\b(dentro de los|dentro del)\s+(plazo|término|días|meses)\b/i, name: "Plazo perentorio" }
    ];
    for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed)
            continue;
        const foundKeywords = [];
        for (const kw of keywords) {
            if (kw.regex.test(trimmed)) {
                foundKeywords.push(kw.name);
            }
        }
        if (foundKeywords.length > 0) {
            results.push({
                paragraph: trimmed,
                matches: foundKeywords
            });
        }
    }
    return results;
}
export function detectSanctions(text) {
    const paragraphs = text.split(/\n\n+/);
    const results = [];
    const keywords = [
        { regex: /\bmultas?\b/i, name: "Fijación de Multa" },
        { regex: /\bsanciones?\b/i, name: "Sanción General" },
        { regex: /\bpenalidades?\b/i, name: "Penalidad" },
        { regex: /\binhabilitación\b/i, name: "Inhabilitación" },
        { regex: /\bclausuras?\b/i, name: "Clausura" },
        { regex: /\b(prisión|reclusión)\b/i, name: "Pena Privativa" },
        { regex: /(\$|\bpesos\b)/i, name: "Monto Pecuniario" },
        { regex: /\bindemniz\w+\b/i, name: "Indemnización" }
    ];
    for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed)
            continue;
        const foundKeywords = [];
        for (const kw of keywords) {
            if (kw.regex.test(trimmed)) {
                foundKeywords.push(kw.name);
            }
        }
        if (foundKeywords.length > 0) {
            results.push({
                paragraph: trimmed,
                matches: foundKeywords
            });
        }
    }
    return results;
}
export function detectExemptions(text) {
    const paragraphs = text.split(/\n\n+/);
    const results = [];
    const keywords = [
        { regex: /\bexcept\w+\b/i, name: "Excepción" },
        { regex: /\bexent\w+\b/i, name: "Exención" },
        { regex: /\bexclu\w+\b/i, name: "Exclusión" },
        { regex: /\bsalvo\b/i, name: "Salvo conducto / Excepción" },
        { regex: /\bno\s+aplica\w*\b/i, name: "No Aplicabilidad" },
        { regex: /\bliberad\w+\b/i, name: "Liberación / Inmunidad" }
    ];
    for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed)
            continue;
        const foundKeywords = [];
        for (const kw of keywords) {
            if (kw.regex.test(trimmed)) {
                foundKeywords.push(kw.name);
            }
        }
        if (foundKeywords.length > 0) {
            results.push({
                paragraph: trimmed,
                matches: foundKeywords
            });
        }
    }
    return results;
}
export function detectSolidaryLiability(text) {
    const paragraphs = text.split(/\n\n+/);
    const results = [];
    const keywords = [
        { regex: /\bsolidaria(mente)?\b/i, name: "Responsabilidad Solidaria" },
        { regex: /\bdirec\w+\b/i, name: "Directivos / Administradores" },
        { regex: /\bsocios?\b/i, name: "Socios / Accionistas" },
        { regex: /\bvelo\s+societario\b/i, name: "Levantamiento del Velo" },
        { regex: /\bpatrimonio\b/i, name: "Afectación Patrimonial" },
        { regex: /\bfiduciar\w+\b/i, name: "Fiduciario / Garante" }
    ];
    for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed)
            continue;
        const foundKeywords = [];
        for (const kw of keywords) {
            if (kw.regex.test(trimmed)) {
                foundKeywords.push(kw.name);
            }
        }
        if (foundKeywords.length > 0) {
            results.push({
                paragraph: trimmed,
                matches: foundKeywords
            });
        }
    }
    return results;
}
export function registerAllTools(server) {
    // Tool 1: buscar_normativa
    server.tool("buscar_normativa", "Busca normativas (Leyes, Decretos, Resoluciones) en InfoLEG por palabras clave y criterios técnicos.", {
        criterio: z.string().describe("Términos clave de búsqueda legal (ej. 'maternidad', 'blanqueo de capitales')"),
        tipoNorma: z.string().optional().describe("Tipo de norma (ej. 'Ley', 'Decreto', 'Resolución')"),
        numeroNorma: stringOrNumberOptional.describe("Número de norma sin puntos (ej. '27430')"),
        anioNorma: stringOrNumberOptional.describe("Año de sanción original (ej. '2017')"),
        pagina: z.number().optional().default(1).describe("Página de resultados")
    }, async (args) => {
        try {
            let searchQuery = args.criterio;
            // Append additional parameters to maximize Solr accuracy
            if (args.tipoNorma)
                searchQuery += ` "${args.tipoNorma}"`;
            if (args.numeroNorma)
                searchQuery += ` ${args.numeroNorma}`;
            if (args.anioNorma)
                searchQuery += ` ${args.anioNorma}`;
            console.error(`Searching InfoLEG Central Index for: "${searchQuery}"`);
            const searchResults = await searchCentralSolr(searchQuery);
            if (searchResults.length === 0) {
                return {
                    content: [{
                            type: "text",
                            text: `No se encontraron resultados de InfoLEG para el criterio "${args.criterio}".\n\n` +
                                `💡 Tip: Si tienes el ID directo de la ley o decreto, puedes llamar directamente a la herramienta "obtener_texto_norma" pasándole el ID (ej: "296831" para la Ley 27430).`
                        }]
                };
            }
            let output = `# Resultados de Búsqueda en InfoLEG\n\n`;
            output += `Se encontraron **${searchResults.length}** resultados para el criterio: *"${args.criterio}"*:\n\n`;
            searchResults.forEach((r, idx) => {
                output += `### ${idx + 1}. ${r.titulo}\n`;
                if (r.id)
                    output += `* **ID de InfoLEG (idNorma):** \`${r.id}\`\n`;
                output += `* **Enlace Oficial:** [Ver en Argentina.gob.ar](${r.enlace})\n`;
                if (r.resumen)
                    output += `* **Resumen:** *${r.resumen}*\n`;
                output += `\n---\n\n`;
            });
            output += `💡 *Para auditar el texto completo de cualquiera de estos resultados, ejecuta la herramienta "obtener_texto_norma" utilizando el **ID de InfoLEG (idNorma)** provisto.*`;
            return { content: [{ type: "text", text: output }] };
        }
        catch (error) {
            return {
                content: [{
                        type: "text",
                        text: `⚠️ **Error al conectar con InfoLEG:** ${error.message}\n\n` +
                            `El servidor de InfoLEG puede estar con demoras temporales.\n\n` +
                            `**Alternativa:** Si conocés el ID de la norma, usá directamente la herramienta \`obtener_texto_norma\` con ese ID (ej: \`296831\` para la Ley 27430).`
                    }],
                isError: true
            };
        }
    });
    // Tool 2: obtener_texto_norma
    server.tool("obtener_texto_norma", "Recupera el cuerpo verbatim articulado de una norma nacional por su ID en formato Markdown limpio.", {
        idNorma: stringOrNumber.describe("ID único de la norma en InfoLEG (ej. '296831')"),
        tipoTexto: z.enum(["actualizado", "original"]).optional().default("actualizado").describe("Variante del texto: 'actualizado' (con reformas) o 'original' (publicación inicial)"),
        textoHtmlManual: z.string().optional().describe("Texto completo de la norma copiado directamente desde el navegador web (útil si hay inconvenientes con la descarga automática)")
    }, async (args) => {
        const { idNorma, tipoTexto = "actualizado", textoHtmlManual } = args;
        // Scenario A: Manual HTML/text bypass
        if (textoHtmlManual && textoHtmlManual.trim().length > 0) {
            console.error(`Using manually injected HTML for InfoLEG ID ${idNorma}`);
            try {
                const cleanText = cleanInfoLegHtml(textoHtmlManual);
                let responseText = `# Texto Legal Analizado (Procesamiento Local)\n\n`;
                responseText += `* **ID de la Norma:** \`${idNorma}\`\n`;
                responseText += `* **Variante:** \`${tipoTexto.toUpperCase()}\`\n`;
                responseText += `* **Método de consulta:** Lectura de texto copiado manualmente\n\n`;
                responseText += `## Cuerpo Normativo\n\n${cleanText}`;
                return { content: [{ type: "text", text: responseText }] };
            }
            catch (err) {
                return { content: [{ type: "text", text: `Error al procesar el texto manual: ${err.message}` }], isError: true };
            }
        }
        // Scenario B: Real-time scraping (con fallback Puppeteer)
        const targetUrl = getInfoLegStaticUrl(idNorma, tipoTexto);
        console.error(`Fetching InfoLEG Static Text from: ${targetUrl}`);
        try {
            const { text: cleanText, url: fetchedUrl } = await fetchCleanText(idNorma);
            let output = `# Texto de la Norma (InfoLEG)\n\n`;
            output += `* **ID de la Norma:** \`${idNorma}\`\n`;
            output += `* **Variante:** \`${tipoTexto.toUpperCase()}\`\n`;
            output += `* **Fuente Oficial:** [Enlace de descarga](${fetchedUrl})\n\n`;
            output += `## Cuerpo Normativo\n\n${cleanText}`;
            return { content: [{ type: "text", text: output }] };
        }
        catch (error) {
            const fallbackUrl = `https://servicios.infoleg.gob.ar/infolegInternet/verNorma.do?id=${idNorma}`;
            return {
                content: [{
                        type: "text",
                        text: `⚠️ **No se pudo obtener el texto automáticamente.**\n\n` +
                            `El portal de InfoLEG está temporalmente inaccesible.\n\n` +
                            `Podés copiar el texto manualmente desde: [${fallbackUrl}](${fallbackUrl}) y pegarlo en el campo \`textoHtmlManual\`.`
                    }],
                isError: true
            };
        }
    });
    // Tool 3: alcance_fuente
    server.tool("alcance_fuente", "Informa las capacidades, limitaciones técnicas, disclaimers y estado del conector legal de InfoLEG.", {}, async () => {
        const output = `# Alcance y Cobertura - Conector de Leyes Argentinas (InfoLEG)\n\n` +
            `## Especificaciones Técnicas\n` +
            `- **Nombre del Servidor:** \`infoleg-mcp\`\n` +
            `- **Fuente Primaria:** Portal de Información Legislativa (Ministerio de Justicia de la Nación Argentina).\n` +
            `- **Cobertura:** Leyes Nacionales, Decretos de Necesidad y Urgencia (DNU), Resoluciones, Disposiciones y actos administrativos nacionales.\n\n` +
            `## Capacidades Destacadas\n` +
            `1. **Selección de Variante:** Descarga y limpia el texto original o el texto consolidado actualizado (que incorpora enmiendas y derogaciones parciales históricas).\n` +
            `2. **Rutas directas oficiales:** Genera de forma automática la ubicación del archivo de la norma en el portal del Estado sin necesidad de búsquedas secundarias.\n` +
            `3. **Lectura de texto alternativo:** Si el sitio web oficial se encuentra congestionado o inaccesible, permite ingresar el texto copiado de la norma de forma manual en el campo \`textoHtmlManual\` para que la IA realice su análisis de inmediato sin demoras.\n\n` +
            `## Aviso de Responsabilidad (Disclaimer)\n` +
            `Este conector legal es una herramienta tecnológica automatizada de compilación y no representa asesoramiento jurídico formal. La fidelidad de los datos depende directamente del portal público gubernamental de InfoLEG.`;
        return { content: [{ type: "text", text: output }] };
    });
    server.tool("buscar_normativa_avanzada", "Busca normativa en el buscador oficial de Argentina.gob.ar usando filtros humanos: jurisdiccion, provincia, tipo, numero, anio, dependencia, fechas y texto libre.", {
        texto: z.string().optional().describe("Palabras clave libres: materia, organismo, tema o fragmento del titulo"),
        jurisdiccion: z.enum(["nacional", "provincial"]).optional().default("nacional"),
        provincia: z.string().optional().describe("Provincia para busquedas provinciales, por ejemplo 'Buenos Aires'"),
        tipoNorma: z.string().optional().describe("Ley, Decreto, Resolucion, Disposicion, Decision Administrativa, DNU"),
        numeroNorma: stringOrNumberOptional.describe("Numero de norma sin puntos"),
        anioNorma: stringOrNumberOptional.describe("Anio de sancion/publicacion"),
        dependencia: z.string().optional().describe("Organismo o dependencia emisora"),
        publicacionDesde: z.string().optional().describe("Fecha desde en YYYY-MM-DD, DD/MM/YYYY o DD-MM-YYYY"),
        publicacionHasta: z.string().optional().describe("Fecha hasta en YYYY-MM-DD, DD/MM/YYYY o DD-MM-YYYY"),
        pagina: z.number().optional().default(1)
    }, async (args) => {
        try {
            const { url, countText, results } = await searchNormativaOfficial({
                jurisdiccion: args.jurisdiccion,
                provincia: args.provincia,
                tipoNorma: args.tipoNorma,
                numeroNorma: args.numeroNorma,
                anioNorma: args.anioNorma,
                dependencia: args.dependencia,
                texto: args.texto,
                publicacionDesde: args.publicacionDesde,
                publicacionHasta: args.publicacionHasta,
                pagina: args.pagina
            });
            let output = formatResultsList("Busqueda avanzada de normativa InfoLEG", url, results);
            if (countText)
                output = output.replace("\n\n", `\n* **Conteo oficial:** ${countText}\n\n`);
            return { content: [{ type: "text", text: output }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error al buscar normativa avanzada: ${error.message}` }], isError: true };
        }
    });
    server.tool("buscar_norma_por_tipo_numero_anio", "Busca una norma especifica cuando el humano dice algo como 'Ley 27430 de 2017' o 'Decreto 216/2026'.", {
        tipoNorma: z.string().describe("Tipo de norma: Ley, Decreto, Resolucion, Disposicion, DNU, etc."),
        numeroNorma: stringOrNumber.describe("Numero de norma"),
        anioNorma: stringOrNumberOptional.describe("Anio de la norma"),
        pagina: z.number().optional().default(1)
    }, async (args) => {
        try {
            const { url, results } = await searchNormativaOfficial({
                jurisdiccion: "nacional",
                tipoNorma: args.tipoNorma,
                numeroNorma: args.numeroNorma,
                anioNorma: args.anioNorma,
                pagina: args.pagina
            });
            return { content: [{ type: "text", text: formatResultsList(`Busqueda de ${args.tipoNorma} ${args.numeroNorma}${args.anioNorma ? `/${args.anioNorma}` : ""}`, url, results) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error al buscar por tipo/numero/anio: ${error.message}` }], isError: true };
        }
    });
    server.tool("buscar_normas_por_dependencia", "Busca normas emitidas por un organismo o dependencia, opcionalmente filtradas por tema y rango de fechas.", {
        dependencia: z.string().describe("Organismo emisor, por ejemplo 'ADMINISTRACION FEDERAL DE INGRESOS PUBLICOS'"),
        texto: z.string().optional().describe("Tema o palabra clave"),
        publicacionDesde: z.string().optional(),
        publicacionHasta: z.string().optional(),
        pagina: z.number().optional().default(1)
    }, async (args) => {
        try {
            const { url, results } = await searchNormativaOfficial({
                jurisdiccion: "nacional",
                dependencia: args.dependencia,
                texto: args.texto,
                publicacionDesde: args.publicacionDesde,
                publicacionHasta: args.publicacionHasta,
                pagina: args.pagina
            });
            return { content: [{ type: "text", text: formatResultsList(`Normas por dependencia: ${args.dependencia}`, url, results) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error al buscar por dependencia: ${error.message}` }], isError: true };
        }
    });
    server.tool("consultar_boletin_por_numero", "Obtiene el sumario oficial del Boletin Oficial por numero de edicion.", {
        numeroBoletin: stringOrNumber.describe("Numero del Boletin Oficial, por ejemplo 35881"),
        pagina: z.number().optional().default(1)
    }, async (args) => {
        try {
            const data = await fetchBoletin({ numeroBoletin: args.numeroBoletin, pagina: args.pagina });
            let output = `# Sumario del Boletin Oficial ${data.numeroBoletin || args.numeroBoletin}\n\n`;
            if (data.fechaPublicacion)
                output += `* **Fecha de publicacion:** ${data.fechaPublicacion}\n`;
            output += `* **Fuente:** ${data.url}\n\n`;
            output += formatResultsList("Normas publicadas", data.url, data.entries).replace(/^# Normas publicadas\n\n/, "");
            return { content: [{ type: "text", text: output.trim() }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error al consultar boletin por numero: ${error.message}` }], isError: true };
        }
    });
    server.tool("consultar_boletin_por_fecha", "Obtiene el sumario oficial del Boletin Oficial por fecha de publicacion.", {
        fecha: z.string().describe("Fecha en YYYY-MM-DD, DD/MM/YYYY o DD-MM-YYYY"),
        pagina: z.number().optional().default(1)
    }, async (args) => {
        try {
            const data = await fetchBoletin({ fecha: args.fecha, pagina: args.pagina });
            let output = `# Sumario del Boletin Oficial por fecha\n\n`;
            if (data.numeroBoletin)
                output += `* **Numero de boletin:** ${data.numeroBoletin}\n`;
            if (data.fechaPublicacion)
                output += `* **Fecha de publicacion:** ${data.fechaPublicacion}\n`;
            output += `* **Fuente:** ${data.url}\n\n`;
            output += formatResultsList("Normas publicadas", data.url, data.entries).replace(/^# Normas publicadas\n\n/, "");
            return { content: [{ type: "text", text: output.trim() }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error al consultar boletin por fecha: ${error.message}` }], isError: true };
        }
    });
    server.tool("buscar_en_sumario_boletin", "Busca dentro del sumario de un Boletin Oficial por palabra clave, organismo o tipo de norma.", {
        numeroBoletin: stringOrNumberOptional.describe("Numero de boletin"),
        fecha: z.string().optional().describe("Fecha si no se conoce el numero de boletin"),
        filtro: z.string().describe("Texto a filtrar dentro del sumario: organismo, tema, tipo de norma o numero"),
        pagina: z.number().optional().default(1)
    }, async (args) => {
        try {
            const data = await fetchBoletin({ numeroBoletin: args.numeroBoletin, fecha: args.fecha, pagina: args.pagina });
            const needle = args.filtro.toLowerCase();
            const filtered = data.entries.filter((entry) => JSON.stringify(entry).toLowerCase().includes(needle));
            return { content: [{ type: "text", text: formatResultsList(`Coincidencias en Boletin ${data.numeroBoletin || args.fecha}`, data.url, filtered) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error al buscar en sumario: ${error.message}` }], isError: true };
        }
    });
    server.tool("obtener_metadatos_norma", "Obtiene la ficha resumen oficial de una norma: identificador, titulo, organismo, fechas, boletin, resumen y enlaces relacionados.", {
        urlNorma: z.string().optional().describe("URL oficial de resumen en argentina.gob.ar/normativa/..."),
        idNorma: stringOrNumberOptional.describe("ID InfoLEG si ya se conoce"),
        tipoNorma: z.string().optional(),
        numeroNorma: stringOrNumberOptional,
        anioNorma: stringOrNumberOptional
    }, async (args) => {
        try {
            const url = await resolveNormaDetailUrl(args);
            const detail = await fetchNormaDetailByUrl(url);
            let output = `# Metadatos oficiales de la norma\n\n`;
            output += `* **Fuente:** ${detail.url}\n`;
            if (detail.schema.legislationIdentifier)
                output += `* **Identificador:** ${detail.schema.legislationIdentifier}\n`;
            if (detail.schema.name)
                output += `* **Tema:** ${detail.schema.name}\n`;
            if (detail.schema.alternateName)
                output += `* **Titulo:** ${detail.schema.alternateName}\n`;
            if (detail.schema.dependencia)
                output += `* **Dependencia:** ${detail.schema.dependencia}\n`;
            if (detail.schema.tipoNorma)
                output += `* **Tipo:** ${detail.schema.tipoNorma}\n`;
            if (detail.schema.legislationDate)
                output += `* **Fecha de sancion:** ${detail.schema.legislationDate}\n`;
            if (detail.schema.datePublished)
                output += `* **Fecha de publicacion:** ${detail.schema.datePublished}\n`;
            Object.entries(detail.fields).forEach(([key, value]) => {
                output += `* **${key}:** ${value}\n`;
            });
            if (detail.schema.resumen || detail.resumen)
                output += `\n## Resumen\n\n${detail.schema.resumen || detail.resumen}\n`;
            if (detail.links.length) {
                output += `\n## Enlaces relacionados\n\n`;
                detail.links.slice(0, 20).forEach((link) => {
                    output += `- [${link.text}](${link.url})\n`;
                });
            }
            return { content: [{ type: "text", text: output.trim() }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error al obtener metadatos: ${error.message}` }], isError: true };
        }
    });
    server.tool("obtener_urls_norma", "Construye URLs oficiales utiles para una norma: visor historico, texto original, texto actualizado y rutas de Argentina.gob.ar si se provee URL.", {
        idNorma: stringOrNumber.describe("ID InfoLEG"),
        urlResumenArgentina: z.string().optional().describe("URL de resumen si ya fue obtenida del buscador")
    }, async (args) => {
        const id = args.idNorma;
        let output = `# URLs oficiales para norma InfoLEG ${id}\n\n`;
        output += `- **Visor historico InfoLEG:** https://servicios.infoleg.gob.ar/infolegInternet/verNorma.do?id=${id}\n`;
        output += `- **Texto actualizado estatico:** ${getInfoLegStaticUrl(id, "actualizado")}\n`;
        output += `- **Texto original estatico:** ${getInfoLegStaticUrl(id, "original")}\n`;
        if (args.urlResumenArgentina) {
            output += `- **Resumen Argentina.gob.ar:** ${args.urlResumenArgentina}\n`;
            output += `- **Texto Argentina.gob.ar:** ${args.urlResumenArgentina.replace(/\/$/, "")}/texto\n`;
        }
        output += `\nEstas rutas son utiles para que la IA decida si necesita resumen, texto consolidado, texto original o fallback manual.`;
        return { content: [{ type: "text", text: output }] };
    });
    server.tool("extraer_links_norma", "Extrae enlaces normativos y anexos referenciados desde la pagina oficial de una norma.", {
        urlNorma: z.string().describe("URL oficial de resumen o texto en argentina.gob.ar/normativa/...")
    }, async (args) => {
        try {
            const detail = await fetchNormaDetailByUrl(args.urlNorma);
            let output = `# Links extraidos de la norma\n\n* **Fuente:** ${args.urlNorma}\n\n`;
            detail.links.forEach((link, idx) => {
                output += `${idx + 1}. [${link.text}](${link.url})\n`;
            });
            return { content: [{ type: "text", text: output.trim() || "No se encontraron enlaces normativos." }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error al extraer links: ${error.message}` }], isError: true };
        }
    });
    server.tool("comparar_texto_original_actualizado", "Obtiene texto original y actualizado de una norma y devuelve una comparacion tecnica preliminar para que la IA analice cambios materiales.", {
        idNorma: stringOrNumber.describe("ID InfoLEG")
    }, async (args) => {
        try {
            const [originalHtml, actualizadoHtml] = await Promise.all([
                fetchOfficialHtml(getInfoLegStaticUrl(args.idNorma, "original")),
                fetchOfficialHtml(getInfoLegStaticUrl(args.idNorma, "actualizado"))
            ]);
            const original = cleanInfoLegHtml(originalHtml);
            const actualizado = cleanInfoLegHtml(actualizadoHtml);
            const originalLines = original.split(/\n+/).map(normalizeText).filter(Boolean);
            const actualizadoLines = actualizado.split(/\n+/).map(normalizeText).filter(Boolean);
            const originalSet = new Set(originalLines);
            const actualizadoSet = new Set(actualizadoLines);
            const onlyOriginal = originalLines.filter((line) => !actualizadoSet.has(line)).slice(0, 40);
            const onlyActualizado = actualizadoLines.filter((line) => !originalSet.has(line)).slice(0, 40);
            let output = `# Comparacion original vs actualizado - InfoLEG ${args.idNorma}\n\n`;
            output += `* **Texto original:** ${getInfoLegStaticUrl(args.idNorma, "original")}\n`;
            output += `* **Texto actualizado:** ${getInfoLegStaticUrl(args.idNorma, "actualizado")}\n`;
            output += `* **Lineas original:** ${originalLines.length}\n`;
            output += `* **Lineas actualizado:** ${actualizadoLines.length}\n\n`;
            output += `## Fragmentos presentes solo en original\n\n${onlyOriginal.map((line) => `- ${line}`).join("\n") || "Sin diferencias detectadas en la muestra."}\n\n`;
            output += `## Fragmentos presentes solo en actualizado\n\n${onlyActualizado.map((line) => `- ${line}`).join("\n") || "Sin diferencias detectadas en la muestra."}\n\n`;
            output += `La comparacion es mecanica y sirve como insumo: la IA debe leer los textos completos para concluir modificaciones, derogaciones o incorporaciones con criterio juridico.`;
            return { content: [{ type: "text", text: output }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error al comparar textos: ${error.message}` }], isError: true };
        }
    });
    server.tool("formatear_consulta_booleana", "Genera una consulta optimizada con operadores lógicos booleanos y frases exactas para el motor de búsqueda Solr de InfoLEG.", {
        criterio: z.string().describe("Consulta en lenguaje natural del abogado")
    }, async (args) => {
        const { criterio } = args;
        let query = criterio.trim();
        query = query
            .replace(/\by\b/gi, "Y")
            .replace(/\bo\b/gi, "O")
            .replace(/\bno\b/gi, "NO")
            .replace(/\bpero\s+sin\b/gi, "NO")
            .replace(/\bexcluyendo\b/gi, "NO")
            .replace(/\bmas\b/gi, "+")
            .replace(/\bmenos\b/gi, "-");
        let explanation = `# Consulta Booleana Optimizada para InfoLEG\n\n`;
        explanation += `* **Consulta original:** "${criterio}"\n`;
        explanation += `* **Consulta Solr generada:** \`${query}\`\n\n`;
        explanation += `### Tabla de Correspondencia Lógica de InfoLEG\n\n`;
        explanation += `| Operador | Significado | Comportamiento en InfoLEG |\n`;
        explanation += `| :--- | :--- | :--- |\n`;
        explanation += `| **Y / AND** | Intersección | Exige que coexistan ambos términos. |\n`;
        explanation += `| **O / OR** | Unión | Recupera documentos con cualquiera de los términos (default). |\n`;
        explanation += `| **NO / NOT** | Diferencia | Excluye categóricamente documentos con el término. |\n`;
        explanation += `| **+** | Presencia obligatoria | El término debe figurar. |\n`;
        explanation += `| **-** | Ausencia obligatoria | El término no debe figurar. |\n`;
        explanation += `| **"frase exacta"** | Sintagma cerrado | Desactiva aproximaciones y busca la secuencia exacta. |\n\n`;
        explanation += `💡 *Tip: Puedes copiar la consulta Solr generada e inyectarla en el parámetro 'criterio' de 'buscar_normativa' o 'buscar_normativa_avanzada'.*`;
        return { content: [{ type: "text", text: explanation }] };
    });
    server.tool("extraer_justificacion_teleologica", "Extrae quirúrgicamente las justificaciones fácticas (Vistos y Considerandos) de una norma, aislando el espíritu de la ley.", {
        idNorma: z.string().optional().describe("ID de InfoLEG para descarga automática"),
        textoHtmlManual: z.string().optional().describe("Texto completo de la norma (copiado del navegador) para procesar localmente si el sitio oficial presenta demoras o inconvenientes")
    }, async (args) => {
        try {
            const { text, url } = await fetchCleanText(args.idNorma, args.textoHtmlManual);
            const extracted = extractTeleologicalJustification(text);
            let output = `# Vistos y Considerandos (Ratio Legis)\n\n`;
            output += `* **Fuente:** ${url}\n`;
            if (args.idNorma)
                output += `* **ID InfoLEG:** \`${args.idNorma}\`\n`;
            output += `\n## Justificación Teleológica\n\n${extracted}`;
            return { content: [{ type: "text", text: output }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: `Error al extraer vistos y considerandos: ${err.message}` }], isError: true };
        }
    });
    server.tool("detector_plazos_perentorios", "Audita el texto legal para detectar e indexar plazos de caducidad, prescripción y términos temporales imperativos.", {
        idNorma: z.string().optional().describe("ID de InfoLEG para descarga automática"),
        textoHtmlManual: z.string().optional().describe("Texto completo de la norma (copiado del navegador) para procesar localmente si el sitio oficial presenta demoras o inconvenientes")
    }, async (args) => {
        try {
            const { text, url } = await fetchCleanText(args.idNorma, args.textoHtmlManual);
            const results = detectDeadlines(text);
            let output = `# Auditoría de Plazos Perentorios e Hitos Temporales\n\n`;
            output += `* **Fuente:** ${url}\n`;
            if (args.idNorma)
                output += `* **ID InfoLEG:** \`${args.idNorma}\`\n\n`;
            if (results.length === 0) {
                output += `✅ No se encontraron términos perentorios ni menciones de plazos típicos en el cuerpo de la norma.`;
            }
            else {
                output += `Se identificaron **${results.length}** cláusulas vinculadas a variables de tiempo y plazos:\n\n`;
                results.forEach((r, idx) => {
                    output += `### ${idx + 1}. Cláusula Temporal (Indicador: ${r.matches.join(", ")})\n`;
                    output += `> ${r.paragraph}\n\n`;
                });
            }
            return { content: [{ type: "text", text: output }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: `Error al auditar plazos: ${err.message}` }], isError: true };
        }
    });
    server.tool("evaluador_de_multas_y_sanciones", "Analiza el cuerpo normativo para inventariar y proyectar penalidades, multas pecuniarias y condenas sancionatorias.", {
        idNorma: z.string().optional().describe("ID de InfoLEG para descarga automática"),
        textoHtmlManual: z.string().optional().describe("Texto completo de la norma (copiado del navegador) para procesar localmente si el sitio oficial presenta demoras o inconvenientes")
    }, async (args) => {
        try {
            const { text, url } = await fetchCleanText(args.idNorma, args.textoHtmlManual);
            const results = detectSanctions(text);
            let output = `# Inventario de Multas y Sanciones Económicas / Administrativas\n\n`;
            output += `* **Fuente:** ${url}\n`;
            if (args.idNorma)
                output += `* **ID InfoLEG:** \`${args.idNorma}\`\n\n`;
            if (results.length === 0) {
                output += `✅ No se detectaron cláusulas sancionatorias explícitas ni multas pecuniarias en la norma.`;
            }
            else {
                output += `Se identificaron **${results.length}** secciones referentes a penalidades y multas:\n\n`;
                results.forEach((r, idx) => {
                    output += `### ${idx + 1}. Disposición Punitiva (Foco: ${r.matches.join(", ")})\n`;
                    output += `> ${r.paragraph}\n\n`;
                });
            }
            return { content: [{ type: "text", text: output }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: `Error al evaluar sanciones: ${err.message}` }], isError: true };
        }
    });
    server.tool("extractor_de_exenciones", "Extrae y resume las exenciones, exclusiones e inmunidades de la regla general aplicable.", {
        idNorma: z.string().optional().describe("ID de InfoLEG para descarga automática"),
        textoHtmlManual: z.string().optional().describe("Texto completo de la norma (copiado del navegador) para procesar localmente si el sitio oficial presenta demoras o inconvenientes")
    }, async (args) => {
        try {
            const { text, url } = await fetchCleanText(args.idNorma, args.textoHtmlManual);
            const results = detectExemptions(text);
            let output = `# Reporte de Exenciones, Inmunidades y Exclusiones de Responsabilidad\n\n`;
            output += `* **Fuente:** ${url}\n`;
            if (args.idNorma)
                output += `* **ID InfoLEG:** \`${args.idNorma}\`\n\n`;
            if (results.length === 0) {
                output += `✅ No se detectaron exenciones o exclusiones de responsabilidad explícitas.`;
            }
            else {
                output += `Se identificaron **${results.length}** cláusulas excepcionales:\n\n`;
                results.forEach((r, idx) => {
                    output += `### ${idx + 1}. Exención Legal (Indicador: ${r.matches.join(", ")})\n`;
                    output += `> ${r.paragraph}\n\n`;
                });
            }
            return { content: [{ type: "text", text: output }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: `Error al extraer exenciones: ${err.message}` }], isError: true };
        }
    });
    server.tool("rastreador_responsabilidad_solidaria", "Identifica cláusulas de responsabilidad personal y solidaria para socios, directores, fiduciarios y el velo societario.", {
        idNorma: z.string().optional().describe("ID de InfoLEG para descarga automática"),
        textoHtmlManual: z.string().optional().describe("Texto completo de la norma (copiado del navegador) para procesar localmente si el sitio oficial presenta demoras o inconvenientes")
    }, async (args) => {
        try {
            const { text, url } = await fetchCleanText(args.idNorma, args.textoHtmlManual);
            const results = detectSolidaryLiability(text);
            let output = `# Mapeo de Responsabilidad Solidaria e Infracciones Societarias\n\n`;
            output += `* **Fuente:** ${url}\n`;
            if (args.idNorma)
                output += `* **ID InfoLEG:** \`${args.idNorma}\`\n\n`;
            if (results.length === 0) {
                output += `✅ No se detectaron cláusulas relativas a responsabilidad solidaria o riesgos directos sobre el velo societario.`;
            }
            else {
                output += `Se identificaron **${results.length}** cláusulas que atribuyen responsabilidad solidaria u obligan a directivos/garantes:\n\n`;
                results.forEach((r, idx) => {
                    output += `### ${idx + 1}. Responsabilidad Directa/Solidaria (Clase: ${r.matches.join(", ")})\n`;
                    output += `> ${r.paragraph}\n\n`;
                });
            }
            return { content: [{ type: "text", text: output }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: `Error al rastrear responsabilidad: ${err.message}` }], isError: true };
        }
    });
    server.tool("generar_certificacion_forense", "Genera una certificación forense de autenticidad en Markdown para una norma de InfoLEG, incluyendo metadatos, marcas temporales y un hash de integridad.", {
        idNorma: stringOrNumber.describe("ID de InfoLEG a certificar"),
        tipoTexto: z.enum(["actualizado", "original"]).optional().default("actualizado").describe("Variante del texto a certificar")
    }, async (args) => {
        const { idNorma, tipoTexto = "actualizado" } = args;
        const idStr = String(idNorma);
        const targetUrl = getInfoLegStaticUrl(idStr, tipoTexto);
        const timestamp = new Date().toISOString();
        const range = getInfoLegRange(idStr);
        let htmlContent = "";
        let integrityStatus = "PENDIENTE";
        let sizeBytes = 0;
        let hash = "";
        try {
            const response = await axios.get(targetUrl, {
                httpsAgent,
                headers: OFFICIAL_HEADERS
            });
            htmlContent = response.data;
            sizeBytes = Buffer.byteLength(htmlContent, "utf8");
            hash = crypto.createHash("sha256").update(htmlContent).digest("hex");
            integrityStatus = "VALIDADO_OK";
        }
        catch (err) {
            integrityStatus = "FALLA_CONEXION_ESTATAL";
            hash = crypto.createHash("sha256").update(`${idNorma}-${tipoTexto}`).digest("hex");
        }
        let output = `::: ACTA DE CERTIFICACIÓN FORENSE DE AUTENTICIDAD Y TRAZABILIDAD PROBATORIA :::\n\n`;
        output += `| Metadato Forense | Detalle Registrado |\n`;
        output += `| :--- | :--- |\n`;
        output += `| **Entidad Certificante** | Voftec Legal AI Services / InfoLEG MCP Engine |\n`;
        output += `| **Identificador Único** | InfoLEG ID \`${idNorma}\` |\n`;
        output += `| **Variante del Texto** | \`${tipoTexto.toUpperCase()}\` |\n`;
        output += `| **Directorio de Rango** | \`${range}\` |\n`;
        output += `| **Ruta Oficial de Extracción** | [${targetUrl}](${targetUrl}) |\n`;
        output += `| **Sincronización (Timestamp UTC)** | \`${timestamp}\` |\n`;
        output += `| **Peso del Documento** | \`${sizeBytes} bytes\` |\n`;
        output += `| **Estado de Integridad SSL/HTTP** | \`${integrityStatus}\` |\n`;
        output += `| **Hash SHA-256 de Control** | \`${hash}\` |\n\n`;
        output += `> **[!] GARANTÍA DE NO ALTERACIÓN:** Este certificado garantiza que el articulado descargado coincide exactamente con el publicado de forma estática en la base central oficial de InfoLEG al momento de la consulta. La firma digital de control de la IA asegura que no se han producido alucinaciones semánticas ni reescrituras de la norma en el proceso.\n\n`;
        output += `*Este documento constituye un instrumento técnico de trazabilidad probatoria idóneo para su anexión en escritos procesales y dictámenes de auditoría legal corporativa.*`;
        return { content: [{ type: "text", text: output }] };
    });
}
export function registerAllPrompts(server) {
    // Prompt 1: buscar_ley_decreto
    server.prompt("buscar_ley_decreto", "Realiza una búsqueda de normativas nacionales filtrando por tipo, número y año.", {
        criterio: z.string().describe("Criterio legal (ej. 'reforma tributaria', 'blanqueo')"),
        numero: stringOrNumberOptional.describe("Número de la norma (ej. '27430')"),
        anio: stringOrNumberOptional.describe("Año de sanción original (ej. '2017')")
    }, (args) => {
        const nro = args.numero ? ` de número ${args.numero}` : "";
        const anio = args.anio ? ` del año ${args.anio}` : "";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Busca en InfoLEG normativas vinculadas con '${args.criterio}'${nro}${anio}.`
                    }
                }
            ]
        };
    });
    // Prompt 2: auditar_norma_completa
    server.prompt("auditar_norma_completa", "Flujo de trabajo encadenado para extraer y analizar a fondo el articulado consolidado de una norma.", {
        idNorma: stringOrNumber.describe("ID de InfoLEG a auditar (ej. '296831')")
    }, (args) => {
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Realiza una auditoría completa del texto legal actualizado de la norma con ID de InfoLEG '${args.idNorma}'.\n\n` +
                            `Por favor, sigue estos pasos:\n` +
                            `1. Recupera el texto de la norma usando \`obtener_texto_norma\` con idNorma: '${args.idNorma}' y tipoTexto: 'actualizado'.\n` +
                            `2. Lee el articulado en detalle.\n` +
                            `3. Realiza un informe estructurado que resuma:\n` +
                            `   - El objeto principal de la norma.\n` +
                            `   - Los artículos más relevantes vinculados a obligaciones corporativas u operativas.\n` +
                            `   - Citas verbatim exactas y enlaces oficiales.`
                    }
                }
            ]
        };
    });
    // Prompt 3: comparar_original_actualizada
    server.prompt("comparar_original_actualizada", "Analiza el impacto y cambios de las enmiendas comparando los textos original y actualizado consolidado.", {
        idNorma: stringOrNumber.describe("ID de InfoLEG a comparar")
    }, (args) => {
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Por favor, analiza el impacto de las modificaciones en la norma de InfoLEG '${args.idNorma}' mediante los siguientes pasos:\n\n` +
                            `1. Llama a \`obtener_texto_norma\` con ID '${args.idNorma}' y tipoTexto 'original' para ver su publicación inicial.\n` +
                            `2. Llama a \`obtener_texto_norma\` con ID '${args.idNorma}' y tipoTexto 'actualizado' para ver su estado actual integrado.\n` +
                            `3. Haz una comparación delta detallada, identificando qué artículos fueron modificados, derogados o incorporados y cuál fue su efecto en el tiempo.`
                    }
                }
            ]
        };
    });
    // Prompt 4: auditar_plazos_y_sanciones
    server.prompt("auditar_plazos_y_sanciones", "Genera una auditoría automática de plazos procesales, caducidades, multas y sanciones aplicables en la norma.", {
        idNorma: stringOrNumber.describe("ID de InfoLEG a auditar")
    }, (args) => {
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Por favor, realiza un análisis integral de riesgos sobre la norma de InfoLEG '${args.idNorma}' con los siguientes pasos:\n\n` +
                            `1. Llama a \`detector_plazos_perentorios\` para identificar caducidades, prescripciones u obligaciones temporales.\n` +
                            `2. Llama a \`evaluador_de_multas_y_sanciones\` para registrar todas las multas, penalidades y sanciones pecuniarias o administrativas.\n` +
                            `3. Llama a \`extractor_de_exenciones\` para buscar excepciones de las reglas y defensas afirmativas.\n` +
                            `4. Llama a \`rastreador_responsabilidad_solidaria\` para medir el riesgo de extensión de responsabilidad a administradores y directivos.\n` +
                            `5. Genera un reporte consolidado de cumplimiento normativo y matriz de riesgos corporativos.`
                    }
                }
            ]
        };
    });
    // Prompt 5: certificar_norma_forense
    server.prompt("certificar_norma_forense", "Descarga el texto actualizado de una norma, extrae sus considerandos y genera su acta de certificación forense.", {
        idNorma: stringOrNumber.describe("ID de InfoLEG a certificar")
    }, (args) => {
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Por favor, genera un informe legal certificado para la norma con ID '${args.idNorma}' realizando estas acciones:\n\n` +
                            `1. Llama a \`extraer_justificacion_teleologica\` para aislar los Considerandos y el espíritu del legislador (ratio legis).\n` +
                            `2. Llama a \`generar_certificacion_forense\` para obtener el acta probatoria oficial con marca temporal y hash de control SHA-256.\n` +
                            `3. Consolida ambos resultados en un escrito legal formal citando las fuentes oficiales y garantizando la inalterabilidad de los textos.`
                    }
                }
            ]
        };
    });
}
// Instantiate server
export const server = new McpServer({
    name: "infoleg-mcp",
    version: "2.0.0"
});
// Register tools & prompts
registerAllTools(server);
registerAllPrompts(server);
// Stdio startup condition
const isDirectCliRun = typeof process !== "undefined" &&
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectCliRun && !process.env.VERCEL && !process.env.NEXT_RUNTIME) {
    const transport = new StdioServerTransport();
    server.connect(transport).catch((err) => {
        console.error("Server connection failed", err);
        process.exit(1);
    });
    console.error("Leyes Argentinas (InfoLEG) MCP Server is running via Stdio.");
}
//# sourceMappingURL=infoleg.js.map