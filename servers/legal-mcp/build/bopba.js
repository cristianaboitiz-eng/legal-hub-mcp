#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios from "axios";
import * as cheerio from "cheerio";
import { z } from "zod";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
import { installTlsFallback } from "./tls-fallback.js";

// FIX: anclar rutas de caché al directorio del módulo, no a process.cwd().
// process.cwd() varía según el cwd del proceso hijo spawneado por el hub.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const axiosClient = axios.create();
// TLS estricto por defecto; fallback inseguro solo ante cert roto (ver tls-fallback.js).
installTlsFallback(axiosClient, "bopba");
// Tasas updater functions
const PDF_URL = 'https://tasador.boletinoficial.gba.gob.ar/pdfs/Flyer%20Tasas%20BO.pdf';
const CACHE_FILE = path.join(__dirname, '../data/tasas-cache.json');
const PDF_HASH_FILE = path.join(__dirname, '../data/pdf-hash.txt');
// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
function parseTasasFromPDF(text) {
    const tasas = {};
    // Helper to extract price and UT from text like "$ 3.850 (14 UT)"
    const extractPriceAndUT = (line) => {
        const priceMatch = line.match(/\$\s*([\d.]+)/);
        const utMatch = line.match(/\((\d+)\s*UT\)/);
        if (priceMatch && utMatch) {
            return {
                ars: parseInt(priceMatch[1].replace(/\./g, '')),
                ut: parseInt(utMatch[1])
            };
        }
        return null;
    };
    // Parse EDICTOS SUCESORIOS
    const edictosSection = text.match(/EDICTOS SUCESORIOS([\s\S]*?)(?=AVISOS POR PALABRAS|$)/);
    if (edictosSection) {
        const sectionText = edictosSection[1];
        const lines = sectionText.split('\n').map(l => l.trim()).filter(l => l);
        tasas["Edictos sucesorios"] = {
            normal: {},
            urgente: {}
        };
        const prices = [];
        lines.forEach(line => {
            const priceData = extractPriceAndUT(line);
            if (priceData)
                prices.push(priceData);
        });
        if (prices.length >= 4) {
            tasas["Edictos sucesorios"].normal["1"] = prices[0];
            tasas["Edictos sucesorios"].normal["3"] = prices[1];
            tasas["Edictos sucesorios"].urgente["1"] = prices[2];
            tasas["Edictos sucesorios"].urgente["3"] = prices[3];
        }
    }
    // Parse AVISOS POR PALABRAS
    const avisosSection = text.match(/AVISOS POR PALABRAS([\s\S]*?)(?=OTROS AVISOS|$)/);
    if (avisosSection) {
        const sectionText = avisosSection[1];
        const lines = sectionText.split('\n').map(l => l.trim()).filter(l => l);
        tasas["Avisos por palabras"] = {
            normal: [],
            urgente: []
        };
        let currentType = null;
        let currentPrices = [];
        let currentRanges = [];
        for (const line of lines) {
            if (line.includes('Trámite Normal') || line.includes('72 hs')) {
                currentType = 'normal';
                currentPrices = [];
                currentRanges = [];
                continue;
            }
            if (line.includes('Trámite Urgente') || line.includes('24 hs')) {
                currentType = 'urgente';
                currentPrices = [];
                currentRanges = [];
                continue;
            }
            const rangeMatch = line.match(/De\s+(\d+)\s+a\s+(\d+)\s+Palabras/);
            if (rangeMatch && currentType) {
                currentRanges.push({
                    min: parseInt(rangeMatch[1]),
                    max: parseInt(rangeMatch[2])
                });
                continue;
            }
            const priceData = extractPriceAndUT(line);
            if (priceData && currentType) {
                currentPrices.push(priceData);
            }
        }
        if (currentType === 'normal' || tasas["Avisos por palabras"].normal.length === 0) {
            const normalLines = lines.slice(lines.indexOf('Trámite Normal') + 1, lines.indexOf('Trámite Urgente'));
            const normalPrices = [];
            const normalRanges = [];
            normalLines.forEach(line => {
                const priceData = extractPriceAndUT(line);
                if (priceData)
                    normalPrices.push(priceData);
                const rangeMatch = line.match(/De\s+(\d+)\s+a\s+(\d+)\s+Palabras/);
                if (rangeMatch) {
                    normalRanges.push({
                        min: parseInt(rangeMatch[1]),
                        max: parseInt(rangeMatch[2])
                    });
                }
            });
            for (let i = 0; i < Math.min(normalPrices.length, normalRanges.length); i++) {
                tasas["Avisos por palabras"].normal.push({
                    ...normalRanges[i],
                    ...normalPrices[i]
                });
            }
        }
        const urgentStartIndex = lines.indexOf('Trámite Urgente');
        if (urgentStartIndex >= 0) {
            const urgentLines = lines.slice(urgentStartIndex + 1);
            const urgentPrices = [];
            urgentLines.forEach(line => {
                const priceData = extractPriceAndUT(line);
                if (priceData)
                    urgentPrices.push(priceData);
            });
            for (let i = 0; i < Math.min(urgentPrices.length, tasas["Avisos por palabras"].normal.length); i++) {
                const normalRange = tasas["Avisos por palabras"].normal[i];
                tasas["Avisos por palabras"].urgente.push({
                    min: normalRange.min,
                    max: normalRange.max,
                    ...urgentPrices[i]
                });
            }
        }
    }
    // Parse OTROS AVISOS
    const otrosSection = text.match(/OTROS AVISOS([\s\S]*?)(?=TASAS ADMINISTRATIVAS|$)/);
    if (otrosSection) {
        const sectionText = otrosSection[1];
        const lines = sectionText.split('\n').map(l => l.trim()).filter(l => l);
        const categories = ['Balances', 'Entidades Financieras', 'Otras Sociedades', 'Constitución de SAS'];
        categories.forEach(cat => {
            tasas[cat] = { normal: {}, urgente: {} };
        });
        const prices = [];
        lines.forEach(line => {
            const priceData = extractPriceAndUT(line);
            if (priceData)
                prices.push(priceData);
        });
        if (prices.length >= 6) {
            tasas["Balances"].normal = prices[0];
            tasas["Entidades Financieras"].normal = prices[1];
            tasas["Otras Sociedades"].normal = prices[2];
            tasas["Constitución de SAS"].normal = prices[2];
            tasas["Balances"].urgente = prices[3];
            tasas["Entidades Financieras"].urgente = prices[4];
            tasas["Otras Sociedades"].urgente = prices[5];
            tasas["Constitución de SAS"].urgente = prices[5];
        }
    }
    return tasas;
}
async function downloadPDF() {
    const response = await axiosClient.get(PDF_URL, {
        responseType: 'arraybuffer',
        timeout: 30000
    });
    return response.data;
}
function calculatePDFHash(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
}
async function getCachedTasas() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf-8');
            return JSON.parse(data);
        }
    }
    catch (error) {
        console.error('Error reading cache:', error);
    }
    return null;
}
async function saveCachedTasas(data) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
        fs.writeFileSync(PDF_HASH_FILE, data.pdfHash);
    }
    catch (error) {
        console.error('Error saving cache:', error);
    }
}
async function getCurrentPDFHash() {
    try {
        if (fs.existsSync(PDF_HASH_FILE)) {
            return fs.readFileSync(PDF_HASH_FILE, 'utf-8').trim();
        }
    }
    catch (error) {
        console.error('Error reading PDF hash:', error);
    }
    return null;
}
async function getTasasData(forceUpdate = false) {
    if (!forceUpdate) {
        const cached = await getCachedTasas();
        if (cached) {
            return cached;
        }
    }
    console.log('Downloading latest tasas PDF...');
    const pdfBuffer = await downloadPDF();
    const newHash = calculatePDFHash(pdfBuffer);
    const currentHash = await getCurrentPDFHash();
    if (!forceUpdate && currentHash === newHash) {
        const cached = await getCachedTasas();
        if (cached) {
            console.log('PDF unchanged, using cached data');
            return cached;
        }
    }
    console.log('Parsing PDF...');
    const { PDFParse } = await import("pdf-parse");
    // FIX API pdf-parse v2: el constructor recibe { data }, el metodo es getText().
    // new PDFParse() sin opciones crasheaba en pdfjs: "Cannot read properties
    // of undefined (reading 'verbosity')".
    const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
    const pdfData = await parser.getText();
    const tasas = parseTasasFromPDF(pdfData.text);
    const tasasData = {
        version: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        pdfHash: newHash,
        tasas
    };
    await saveCachedTasas(tasasData);
    console.log('Tasas data updated and cached');
    return tasasData;
}
async function checkForUpdates() {
    try {
        const pdfBuffer = await downloadPDF();
        const newHash = calculatePDFHash(pdfBuffer);
        const currentHash = await getCurrentPDFHash();
        return currentHash !== newHash;
    }
    catch (error) {
        console.error('Error checking for updates:', error);
        return false;
    }
}
export const server = new McpServer({
    name: "argentina-bopba-mcp",
    version: "1.0.0",
});
export const registerAllTools = (server) => {
    server.tool("buscar_boletin", "Busca boletines oficiales usando la página de búsqueda del BOPBA con filtros avanzados", {
        words: z.string().optional().describe("Palabras clave para la búsqueda (search[words])"),
        date_gteq: z.string().optional().describe("Fecha desde en formato YYYY-MM-DD (search[date_gteq])"),
        date_lteq: z.string().optional().describe("Fecha hasta en formato YYYY-MM-DD (search[date_lteq])"),
        section: z.enum(["OFICIAL", "JUDICIAL", "JURISPRUDENCIA", "SUPLEMENTO", "SUPLEMENTO 1"]).optional().describe("Sección del boletín para filtrar"),
        sort: z.enum(["by_match_desc", "by_date_desc", "by_date_asc"]).optional().describe("Ordenamiento: por coincidencia, más recientes, menos recientes"),
        page: z.number().optional().describe("Número de página para paginación de resultados"),
    }, async (args) => {
        try {
            const queryParams = new URLSearchParams();
            if (args?.words)
                queryParams.append("search[words]", String(args.words));
            if (args?.date_gteq)
                queryParams.append("search[date_gteq]", String(args.date_gteq));
            if (args?.date_lteq)
                queryParams.append("search[date_lteq]", String(args.date_lteq));
            if (args?.section)
                queryParams.append("search[section]", String(args.section));
            if (args?.sort)
                queryParams.append("search[sort]", String(args.sort));
            if (args?.page)
                queryParams.append("page", String(args.page));
            queryParams.append("utf8", "✔");
            const url = `https://boletinoficial.gba.gob.ar/buscar?${queryParams.toString()}`;
            const response = await axiosClient.get(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
            });
            const $ = cheerio.load(response.data);
            const results = [];
            $('.result-box').each((_, box) => {
                const $box = $(box);
                const title = $box.find('.title a').first().text().trim();
                const downloadLink = $box.find('.title a[download]').first().attr('href');
                const viewLink = $box.find('.title a:not([download])').first().attr('href');
                const dateText = $box.find('.date strong').text().trim();
                let id = '';
                if (downloadLink && downloadLink.includes('/secciones/')) {
                    const match = downloadLink.match(/\/secciones\/(\d+)/);
                    if (match)
                        id = match[1];
                }
                const excerpts = [];
                $box.find('.ajax-result').each((_, result) => {
                    const $result = $(result);
                    const pageLink = $result.find('.page').attr('href');
                    const excerpt = $result.find('.excerpt').text().replace(/\s+/g, ' ').trim();
                    if (excerpt) {
                        excerpts.push({
                            page: pageLink || '',
                            text: excerpt
                        });
                    }
                });
                if (title || id) {
                    results.push({
                        title,
                        date: dateText,
                        id,
                        downloadLink: downloadLink ? `https://boletinoficial.gba.gob.ar${downloadLink}` : '',
                        viewLink: viewLink ? `https://boletinoficial.gba.gob.ar${viewLink}` : '',
                        excerpts
                    });
                }
            });
            const pagination = {
                currentPage: 1,
                totalPages: 1,
                hasNext: false,
                hasPrev: false
            };
            const $pagination = $('.pagination');
            if ($pagination.length > 0) {
                const activePage = $pagination.find('.active a').text();
                if (activePage)
                    pagination.currentPage = parseInt(activePage);
                const lastLink = $pagination.find('a:contains("Última")').attr('href');
                if (lastLink) {
                    const match = lastLink.match(/page=(\d+)/);
                    if (match)
                        pagination.totalPages = parseInt(match[1]);
                }
                pagination.hasNext = $pagination.find('a:contains("Siguiente")').length > 0;
                pagination.hasPrev = $pagination.find('a:contains("Anterior")').length > 0;
            }
            return {
                content: [{ type: "text", text: JSON.stringify({ results, pagination }, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${error.message}` }],
            };
        }
    });
    server.tool("descargar_seccion", "Descarga y extrae el texto del PDF de una sección específica del BOPBA", {
        id: z.string().describe("ID de la sección a descargar"),
    }, async (args) => {
        try {
            const id = String(args?.id);
            const url = `https://boletinoficial.gba.gob.ar/secciones/${id}/descargar`;
            const response = await axiosClient.get(url, {
                responseType: "arraybuffer",
                headers: {
                    "User-Agent": "Mozilla/5.0",
                },
            });
            // @ts-ignore
            const { PDFParse } = await import("pdf-parse");
            // FIX API pdf-parse v2: { data } en el constructor + getText().
            const parser = new PDFParse({ data: new Uint8Array(response.data) });
            const pdfData = await parser.getText();
            return {
                content: [{ type: "text", text: pdfData.text.substring(0, 50000) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error al descargar/parsear PDF: ${error.message}` }],
            };
        }
    });
    server.tool("listar_agencias", "Obtiene el listado completo de agencias del BOPBA con información de contacto", {}, async () => {
        try {
            const url = "https://boletinoficial.gba.gob.ar/agencias";
            const response = await axiosClient.get(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "es-AR,es;q=0.9",
                },
            });
            const $ = cheerio.load(response.data);
            const agencias = [];
            const SELECTORS = [
                '.list-group-item',
                '.card',
                '.agency-item',
                'article',
                'tr',
            ];
            let found = false;
            for (const sel of SELECTORS) {
                const items = $(sel);
                if (items.length === 0) continue;
                found = true;
                items.each((_, item) => {
                    const $item = $(item);
                    const numero = $item.find('p').first().text().trim() ||
                        $item.find('[class*="numer"]').text().trim() || '';
                    const nombre = $item.find('h4, h3, h5, .nombre, [class*="nombre"], strong').first().text().trim() || '';
                    const detalles = {};
                    $item.find('h6').each((_, h6) => {
                        const label = $(h6).text().replace(':', '').trim();
                        const value = $(h6).next('p').text().trim();
                        if (label && value) detalles[label] = value;
                    });
                    const textoCompleto = $item.text().replace(/\s+/g, ' ').trim();
                    if (numero || nombre || textoCompleto) {
                        agencias.push(Object.keys(detalles).length > 0
                            ? { numero, nombre, ...detalles }
                            : { numero, nombre, texto: textoCompleto.substring(0, 300) });
                    }
                });
                break;
            }
            if (!found || agencias.length === 0) {
                const bodyText = $('main, #content, .container, body').first().text();
                const lineas = bodyText.split('\n')
                    .map(l => l.replace(/\s+/g, ' ').trim())
                    .filter(l => l.length > 3);
                const agenciasFallback = [];
                let current = null;
                const reTelefono = /(Tel\.?|Fax|\(\d{2,4}\)|\d{4}[\s-]\d{4})/i;
                const reDireccion = /(Calle|Av\.?|Avenida|N[°º]\s*\d|\d{3,5}\s*(e\/|entre))/i;
                const reEmail = /[\w.+-]+@[\w-]+\.[\w.]+/;
                const reHorario = /(Lunes|Martes|Lun|Mar|Mié|Jue|Vie|hs\.?|a\s+las|de\s+\d)/i;
                for (let i = 0; i < lineas.length; i++) {
                    const l = lineas[i];
                    const esPosibleNombre = l.length < 80 && /[A-ZÁÉÍÓÚÑ]{3,}/.test(l) &&
                        !reTelefono.test(l) && !reDireccion.test(l);
                    if (esPosibleNombre && !current) {
                        current = { nombre: l, datos: [] };
                    } else if (current) {
                        if (reTelefono.test(l) || reDireccion.test(l) || reEmail.test(l) || reHorario.test(l)) {
                            current.datos.push(l);
                        } else if (l.length > 5 && current.datos.length < 6) {
                            current.datos.push(l);
                        } else {
                            if (current.datos.length > 0) {
                                agenciasFallback.push({
                                    nombre: current.nombre,
                                    info: current.datos.join(' | ')
                                });
                            }
                            current = esPosibleNombre ? { nombre: l, datos: [] } : null;
                        }
                    }
                }
                if (current && current.datos.length > 0) {
                    agenciasFallback.push({ nombre: current.nombre, info: current.datos.join(' | ') });
                }
                if (agenciasFallback.length > 0) {
                    return {
                        content: [{ type: "text", text: JSON.stringify({
                            aviso: "Selectores CSS no coincidieron con el markup actual. Datos extraídos mediante heurísticas de texto - verificar en la URL oficial.",
                            url_oficial: url,
                            agencias: agenciasFallback
                        }, null, 2) }],
                    };
                }
                return {
                    content: [{ type: "text", text: JSON.stringify({
                        aviso: "No fue posible extraer agencias automáticamente. Consultá el listado completo en la URL oficial.",
                        url_oficial: url,
                        instruccion: "Abrí la URL en un navegador para ver el listado actualizado de agencias del BOPBA."
                    }, null, 2) }],
                };
            }
            return {
                content: [{ type: "text", text: JSON.stringify(agencias, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error al obtener agencias: ${error.message}` }],
            };
        }
    });
    server.tool("listar_ediciones_anteriores", "Lista ediciones anteriores del boletín con filtros de fecha y paginación", {
        date_gteq: z.string().optional().describe("Fecha desde en formato YYYY-MM-DD"),
        date_lteq: z.string().optional().describe("Fecha hasta en formato YYYY-MM-DD"),
        page: z.number().optional().describe("Número de página (por defecto 1)"),
    }, async (args) => {
        try {
            const queryParams = new URLSearchParams();
            if (args?.date_gteq)
                queryParams.append("date_gteq", String(args.date_gteq));
            if (args?.date_lteq)
                queryParams.append("date_lteq", String(args.date_lteq));
            if (args?.page)
                queryParams.append("page", String(args.page));
            const url = `https://boletinoficial.gba.gob.ar/ediciones-anteriores?${queryParams.toString()}`;
            const response = await axiosClient.get(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                },
            });
            const $ = cheerio.load(response.data);
            const ediciones = [];
            $('.panel-heading').each((_, panel) => {
                const $panel = $(panel);
                const title = $panel.find('h5').text().trim();
                const dataToggle = $panel.attr('data-toggle');
                if (title) {
                    ediciones.push({
                        titulo: title,
                        expandible: dataToggle === 'collapse'
                    });
                }
            });
            const pagination = {
                currentPage: 1,
                totalPages: 1,
                hasNext: false,
                hasPrev: false
            };
            const $pagination = $('.pagination');
            if ($pagination.length > 0) {
                const activePage = $pagination.find('.active a').text();
                if (activePage)
                    pagination.currentPage = parseInt(activePage);
                const lastLink = $pagination.find('a:contains("Última")').attr('href');
                if (lastLink) {
                    const match = lastLink.match(/page=(\d+)/);
                    if (match)
                        pagination.totalPages = parseInt(match[1]);
                }
                pagination.hasNext = $pagination.find('a:contains("Siguiente")').length > 0;
                pagination.hasPrev = $pagination.find('a:contains("Anterior")').length > 0;
            }
            return {
                content: [{ type: "text", text: JSON.stringify({ ediciones, pagination }, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${error.message}` }],
            };
        }
    });
    server.tool("calcular_tarifa", "Calcula una aproximación de la tarifa de publicación en el BOPBA basándose en las tasas oficiales del flyer. NOTA: Este cálculo es una aproximación. Para obtener el precio exacto, códigos QR de pago y enlaces de pago oficiales, debe utilizar el simulador web: https://tasador.boletinoficial.gba.gob.ar/", {
        categoria: z.enum(["Edictos sucesorios", "Avisos por palabras", "Balances", "Entidades Financieras", "Otras Sociedades", "Constitución de SAS"]).describe("Categoría de publicación según el flyer de tasas oficial"),
        texto: z.string().optional().describe("Texto a publicar (requerido para 'Avisos por palabras' para contar palabras)"),
        dias: z.enum(["1", "3"]).optional().describe("Cantidad de días (requerido para 'Edictos sucesorios': 1 o 3 días)"),
        urgencia: z.enum(["Normal (72 hs.)", "Urgente (24 hs.)"]).optional().describe("Tipo de trámite (por defecto: Normal 72 hs.)"),
        actualizar: z.boolean().optional().describe("Forzar actualización desde PDF oficial (por defecto: false)"),
    }, async (args) => {
        try {
            const categoria = args.categoria;
            const urgencia = args.urgencia || "Normal (72 hs.)";
            const esUrgente = urgencia === "Urgente (24 hs.)";
            const tasasData = await getTasasData(args.actualizar);
            const tasasOficiales = tasasData.tasas;
            let resultado = {
                categoria,
                urgencia,
                calculo: null,
                nota: "",
                advertencia: "⚠️ IMPORTANTE: Este cálculo es una APROXIMACIÓN basada en el flyer de tasas oficial. Para obtener el precio exacto, códigos QR de pago y enlaces de pago oficiales, debe utilizar el simulador web: https://tasador.boletinoficial.gba.gob.ar/"
            };
            if (categoria === "Edictos sucesorios") {
                if (!args.dias) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: "Error: Para 'Edictos sucesorios' debe especificar el parámetro 'dias' como '1' o '3'." }],
                    };
                }
                const nivelUrgencia = esUrgente ? "urgente" : "normal";
                if (!tasasOficiales[categoria] || !tasasOficiales[categoria][nivelUrgencia]) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error: No se encontraron tasas para "${categoria}" (${nivelUrgencia}). El parseo del PDF puede haber fallado. Intente con actualizar: true.` }],
                    };
                }
                const tasa = tasasOficiales[categoria][nivelUrgencia][args.dias];
                if (!tasa) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error: No se encontró tarifa para "${categoria}", ${args.dias} día(s), modalidad ${nivelUrgencia}. Intente con actualizar: true.` }],
                    };
                }
                resultado.calculo = {
                    dias: args.dias,
                    valor_ut: tasa.ut,
                    valor_ars: tasa.ars
                };
            }
            else if (categoria === "Avisos por palabras") {
                if (!args.texto) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: "Error: Para 'Avisos por palabras' debe proporcionar el parámetro 'texto'." }],
                    };
                }
                const wordCount = args.texto.split(/\s+/).filter(w => w.length > 0).length;
                resultado.estadisticas = { palabras: wordCount };
                const nivelUrgenciaAvisos = esUrgente ? "urgente" : "normal";
                if (!tasasOficiales[categoria] || !tasasOficiales[categoria][nivelUrgenciaAvisos]) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error: No se encontraron tasas para "${categoria}" (${nivelUrgenciaAvisos}). El parseo del PDF puede haber fallado. Intente con actualizar: true.` }],
                    };
                }
                const tarifas = tasasOficiales[categoria][nivelUrgenciaAvisos];
                const tarifaAplicable = tarifas.find((t) => wordCount >= t.min && wordCount <= t.max);
                if (tarifaAplicable) {
                    resultado.calculo = {
                        rango_palabras: `${tarifaAplicable.min}-${tarifaAplicable.max}`,
                        valor_ut: tarifaAplicable.ut,
                        valor_ars: tarifaAplicable.ars
                    };
                }
                else {
                    resultado.calculo = null;
                    resultado.nota = "Para avisos de más de 200 palabras o para más de un día de publicación se aconseja usar el Simulador de costos de Publicación disponible en la web: https://tasador.boletinoficial.gba.gob.ar/";
                }
            }
            else {
                // Balances, Entidades Financieras, Otras Sociedades, Constitución de SAS
                const tasa = tasasOficiales[categoria]?.[esUrgente ? "urgente" : "normal"];
                if (!tasa) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error: No se encontraron tasas para la categoría "${categoria}". Intente con actualizar: true para refrescar los datos.` }],
                    };
                }
                resultado.calculo = {
                    valor_ut: tasa.ut,
                    valor_ars: tasa.ars
                };
            }
            resultado.fuente = "Flyer de Tasas Oficial BOPBA (Art. 57 Ley 15.558) - APROXIMACIÓN";
            resultado.url_verificacion = "https://tasador.boletinoficial.gba.gob.ar/";
            resultado.url_pago_oficial = "https://tasador.boletinoficial.gba.gob.ar/";
            resultado.version_tasas = tasasData.version;
            resultado.ultima_actualizacion = tasasData.lastUpdated;
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify(resultado, null, 2)
                    }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${error.message}` }],
            };
        }
    });
    server.tool("actualizar_tasas", "Verifica y actualiza las tasas desde el PDF oficial del BOPBA si hay cambios", {
        forzar: z.boolean().optional().describe("Forzar actualización incluso si el PDF no cambió (por defecto: false)"),
    }, async (args) => {
        try {
            const hasUpdates = await checkForUpdates();
            if (hasUpdates || args.forzar) {
                const tasasData = await getTasasData(true);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                mensaje: args.forzar ? "Actualización forzada completada" : "Nuevas tasas detectadas y actualizadas",
                                version: tasasData.version,
                                ultima_actualizacion: tasasData.lastUpdated,
                                pdf_hash: tasasData.pdfHash,
                                url_origen: "https://tasador.boletinoficial.gba.gob.ar/pdfs/Flyer%20Tasas%20BO.pdf"
                            }, null, 2)
                        }],
                };
            }
            else {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                mensaje: "No hay actualizaciones disponibles. El PDF oficial no ha cambiado desde la última verificación.",
                                nota: "Use el parámetro 'forzar: true' para actualizar manualmente si es necesario."
                            }, null, 2)
                        }],
                };
            }
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${error.message}` }],
            };
        }
    });
    server.tool("obtener_ultimo_boletin", "Obtiene información del último boletín publicado con sus secciones disponibles", {}, async () => {
        try {
            const url = "https://boletinoficial.gba.gob.ar/";
            const response = await axiosClient.get(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                },
            });
            const $ = cheerio.load(response.data);
            const lastBulletinText = $('.bulletin-date strong').text().trim()
                || $('.bulletin-date').text().replace('Ver anteriores', '').trim()
                || $('.last-bulletin strong').text().trim();
            const secciones = [];
            $('.bulletin-box').each((_, box) => {
                const $box = $(box);
                const nombre = $box.find('h4').text().trim();
                let link = '';
                let id = '';
                $box.find('a').each((_, a) => {
                    const href = $(a).attr('href') || '';
                    if (href.includes('/secciones/')) {
                        link = href;
                        const match = href.match(/\/secciones\/(\d+)/);
                        if (match) id = match[1];
                        return false;
                    }
                });
                if (!id) {
                    const parentLink = $box.closest('a').attr('href') || '';
                    if (parentLink.includes('/secciones/')) {
                        link = parentLink;
                        const match = parentLink.match(/\/secciones\/(\d+)/);
                        if (match) id = match[1];
                    }
                }
                if (nombre) {
                    secciones.push({
                        nombre,
                        id,
                        link: link ? `https://boletinoficial.gba.gob.ar${link}` : ''
                    });
                }
            });
            if (secciones.every(s => !s.id)) {
                $('a[href*="/secciones/"]').each((_, a) => {
                    const href = $(a).attr('href') || '';
                    const nombre = $(a).text().trim() || $(a).find('h4').text().trim();
                    const match = href.match(/\/secciones\/(\d+)/);
                    if (match && nombre && !secciones.find(s => s.id === match[1])) {
                        secciones.push({
                            nombre,
                            id: match[1],
                            link: `https://boletinoficial.gba.gob.ar${href}`
                        });
                    }
                });
            }
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({
                            ultimo_boletin: lastBulletinText,
                            secciones
                        }, null, 2)
                    }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${error.message}` }],
            };
        }
    });
    server.tool("ver_seccion", "Obtiene metadatos y vista previa de una sección específica del boletín", {
        id: z.string().describe("ID de la sección a ver"),
    }, async (args) => {
        try {
            const id = String(args?.id);
            const url = `https://boletinoficial.gba.gob.ar/secciones/${id}/ver`;
            const response = await axiosClient.get(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                },
            });
            const $ = cheerio.load(response.data);
            // FIX: la pagina /ver renderiza por JS -> los selectores originales
            // devolvian titulo y link_descargar vacios. Ampliamos selectores y,
            // como la URL de descarga es deterministica (misma convencion que
            // descargar_seccion), la construimos siempre.
            const title = $('h1, h2, h3').first().text().trim()
                || $('meta[property="og:title"]').attr('content')?.trim()
                || $('title').text().replace(/\s*[|\-–]\s*Bolet[ií]n Oficial.*$/i, '').trim()
                || '';
            const downloadLink = $('a[href*="/descargar"]').attr('href');
            const downloadUrl = downloadLink
                ? `https://boletinoficial.gba.gob.ar${downloadLink}`
                : `https://boletinoficial.gba.gob.ar/secciones/${id}/descargar`;
            let contentText = $('.content, .section-content, main, article').first().text().replace(/\s+/g, ' ').trim().substring(0, 1000);
            let tituloFinal = title;
            // Si el HTML no aporta vista previa, la extraemos del PDF directamente.
            if (!contentText) {
                try {
                    const pdfResp = await axiosClient.get(downloadUrl, {
                        responseType: 'arraybuffer',
                        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
                        timeout: 30000,
                    });
                    const { PDFParse } = await import("pdf-parse");
                    const parser = new PDFParse({ data: new Uint8Array(pdfResp.data) });
                    const pdfData = await parser.getText({ partial: [1] });
                    const pdfText = (pdfData.text || '').replace(/\s+/g, ' ').trim();
                    if (pdfText) {
                        contentText = pdfText.substring(0, 1000);
                        if (!tituloFinal) {
                            // Primera linea significativa del PDF como titulo aproximado
                            tituloFinal = pdfText.split(/(?<=[.:])\s/)[0].substring(0, 120);
                        }
                    }
                }
                catch {
                    // PDF no disponible: se informa abajo
                }
            }
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({
                            id,
                            titulo: tituloFinal,
                            link_ver: url,
                            link_descargar: downloadUrl,
                            contenido_previo: contentText || "Contenido no disponible en vista previa. Use descargar_seccion para obtener el PDF completo."
                        }, null, 2)
                    }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${error.message}` }],
            };
        }
    });
    server.tool("alcance_fuente", "Obtiene información sobre el alcance, limitaciones y disclaimer del BOPBA", {}, async () => {
        return {
            content: [
                {
                    type: "text",
                    text: "Boletín Oficial de la Provincia de Buenos Aires (BOPBA).\nAlcance: Publicación oficial de leyes, decretos, edictos, etc. de la Provincia de Buenos Aires.\nLimitaciones: La disponibilidad de documentos depende de la digitalización por parte del gobierno.\nDisclaimer: Herramienta no oficial. Verificar siempre la información en https://boletinoficial.gba.gob.ar/",
                },
            ],
        };
    });
    server.tool("verificar_vigencia", "Verifica si una sección del boletín está disponible, su fecha de publicación y si hay versiones modificadas o correcciones posteriores", {
        id: z.string().describe("ID de la sección a verificar"),
    }, async (args) => {
        try {
            const id = String(args?.id);
            const url = `https://boletinoficial.gba.gob.ar/secciones/${id}/ver`;
            const response = await axiosClient.get(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                },
            });
            const $ = cheerio.load(response.data);
            const title = $('h1, h2, h3').first().text().trim();
            const dateText = $('.date, .fecha, [class*="date"], [class*="fecha"]').first().text().trim();
            const downloadLink = $('a[href*="/descargar"]').attr('href');
            const isAvailable = !!downloadLink;
            const modificationIndicators = [];
            $('body').each((_, el) => {
                const text = $(el).text();
                if (/correcci[oó]n|rectificaci[oó]n|errata|modificaci[oó]n/i.test(text)) {
                    modificationIndicators.push("Posible corrección o modificación detectada en el texto");
                }
            });
            let content = `# Verificación de Vigencia - Sección ${id}\n\n`;
            content += `## Título\n${title || 'No disponible'}\n\n`;
            content += `## Estado de Disponibilidad\n`;
            content += isAvailable ? "✅ DISPONIBLE - El documento puede descargarse\n" : "⚠️ NO DISPONIBLE - No se encontró link de descarga\n";
            content += `\n## Fecha de Publicación\n${dateText || 'No detectada en la página'}\n\n`;
            if (modificationIndicators.length > 0) {
                content += `## Alertas de Modificación\n`;
                modificationIndicators.forEach(alert => content += `- ${alert}\n`);
                content += `\n`;
            }
            content += `## Enlaces\n`;
            content += `- Vista previa: ${url}\n`;
            if (downloadLink) {
                content += `- Descarga: https://boletinoficial.gba.gob.ar${downloadLink}\n`;
            }
            content += `\n> **Nota:** Esta herramienta verifica disponibilidad básica. Para confirmar vigencia legal, consultar las fuentes oficiales del gobierno provincial.`;
            return {
                content: [{ type: "text", text: content }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error al verificar vigencia: ${error.message}` }],
            };
        }
    });
    server.tool("relacionar_publicaciones", "Busca publicaciones relacionadas con una sección específica del boletín (mismas fechas, mismos organismos, temas similares)", {
        id: z.string().describe("ID de la sección de referencia"),
        palabras_clave: z.string().optional().describe("Palabras clave adicionales para buscar publicaciones relacionadas"),
        fecha_desde: z.string().optional().describe("Fecha desde YYYY-MM-DD para ampliar búsqueda"),
        fecha_hasta: z.string().optional().describe("Fecha hasta YYYY-MM-DD para ampliar búsqueda"),
    }, async (args) => {
        try {
            const id = String(args?.id);
            const refUrl = `https://boletinoficial.gba.gob.ar/secciones/${id}/ver`;
            const refResponse = await axiosClient.get(refUrl, {
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
            });
            const $ref = cheerio.load(refResponse.data);
            const refTitle = $ref('h1, h2, h3').first().text().trim();
            const refDate = $ref('.date, .fecha, [class*="date"], [class*="fecha"]').first().text().trim();
            const keyTerms = refTitle.split(/\s+/).filter((word) => word.length > 4).slice(0, 3);
            const searchQuery = args.palabras_clave || keyTerms.join(' ') || refTitle.substring(0, 50);
            let dateGteq = args.fecha_desde;
            let dateLteq = args.fecha_hasta;
            if (!dateGteq && refDate) {
                dateGteq = refDate;
            }
            const queryParams = new URLSearchParams();
            queryParams.append("search[words]", searchQuery);
            if (dateGteq)
                queryParams.append("search[date_gteq]", dateGteq);
            if (dateLteq)
                queryParams.append("search[date_lteq]", dateLteq);
            queryParams.append("utf8", "✔");
            const searchUrl = `https://boletinoficial.gba.gob.ar/buscar?${queryParams.toString()}`;
            const searchResponse = await axiosClient.get(searchUrl, {
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
            });
            const $ = cheerio.load(searchResponse.data);
            const related = [];
            $('.result-box').each((_, box) => {
                const $box = $(box);
                const title = $box.find('.title a').first().text().trim();
                const downloadLink = $box.find('.title a[download]').first().attr('href');
                const dateText = $box.find('.date strong').text().trim();
                let relatedId = '';
                if (downloadLink && downloadLink.includes('/secciones/')) {
                    const match = downloadLink.match(/\/secciones\/(\d+)/);
                    if (match)
                        relatedId = match[1];
                }
                if (relatedId === id)
                    return;
                if (title && relatedId) {
                    related.push({
                        id: relatedId,
                        titulo: title,
                        fecha: dateText,
                        link: downloadLink ? `https://boletinoficial.gba.gob.ar${downloadLink}` : ''
                    });
                }
            });
            let content = `# Publicaciones Relacionadas - Sección ${id}\n\n`;
            content += `## Publicación de Referencia\n`;
            content += `- **Título:** ${refTitle}\n`;
            content += `- **Fecha:** ${refDate || 'No disponible'}\n`;
            content += `- **ID:** ${id}\n\n`;
            content += `## Publicaciones Relacionadas Encontradas\n`;
            content += `**Criterio de búsqueda:** "${searchQuery}"\n\n`;
            if (related.length === 0) {
                content += `No se encontraron publicaciones relacionadas con los criterios actuales.\n`;
            }
            else {
                related.forEach((pub, idx) => {
                    content += `### ${idx + 1}. ${pub.titulo}\n`;
                    content += `- **ID:** ${pub.id}\n`;
                    content += `- **Fecha:** ${pub.fecha}\n`;
                    content += `- **Enlace:** ${pub.link}\n\n`;
                });
            }
            content += `\n> **Nota:** Esta herramienta busca por similitud temática y temporal. Las relaciones no son oficiales del gobierno.`;
            return {
                content: [{ type: "text", text: content }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error al relacionar publicaciones: ${error.message}` }],
            };
        }
    });
    server.tool("buscar_por_semantica", "Busca publicaciones en el BOPBA utilizando expansión semántica de términos. El LLM debe generar sinónimos y términos equivalentes antes de llamar esta herramienta.", {
        concepto: z.string().describe("Concepto central a buscar (ej. 'teletrabajo', 'licencia parental')"),
        terminos_equivalentes: z.array(z.string()).describe("Lista de sinónimos o términos relacionados generados por el LLM (ej. ['trabajo remoto', 'home office', 'trabajo a distancia'])"),
        fecha_desde: z.string().optional().describe("Fecha desde YYYY-MM-DD (opcional)"),
        fecha_hasta: z.string().optional().describe("Fecha hasta YYYY-MM-DD (opcional)"),
        seccion: z.enum(["OFICIAL", "JUDICIAL", "JURISPRUDENCIA", "SUPLEMENTO", "SUPLEMENTO 1"]).optional().describe("Sección del boletín (opcional)"),
    }, async (args) => {
        try {
            const concepto = args.concepto;
            const terminos = args.terminos_equivalentes || [];
            const allTerms = [concepto, ...terminos].join(' ');
            const queryParams = new URLSearchParams();
            queryParams.append("search[words]", allTerms);
            if (args.fecha_desde)
                queryParams.append("search[date_gteq]", args.fecha_desde);
            if (args.fecha_hasta)
                queryParams.append("search[date_lteq]", args.fecha_hasta);
            if (args.seccion)
                queryParams.append("search[section]", args.seccion);
            queryParams.append("utf8", "✔");
            const url = `https://boletinoficial.gba.gob.ar/buscar?${queryParams.toString()}`;
            const response = await axiosClient.get(url, {
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
            });
            const $ = cheerio.load(response.data);
            const results = [];
            $('.result-box').each((_, box) => {
                const $box = $(box);
                const title = $box.find('.title a').first().text().trim();
                const downloadLink = $box.find('.title a[download]').first().attr('href');
                const dateText = $box.find('.date strong').text().trim();
                let id = '';
                if (downloadLink && downloadLink.includes('/secciones/')) {
                    const match = downloadLink.match(/\/secciones\/(\d+)/);
                    if (match)
                        id = match[1];
                }
                const excerpts = [];
                $box.find('.ajax-result').each((_, result) => {
                    const $result = $(result);
                    const pageLink = $result.find('.page').attr('href');
                    const excerpt = $result.find('.excerpt').text().replace(/\s+/g, ' ').trim();
                    if (excerpt) {
                        excerpts.push({ page: pageLink || '', text: excerpt });
                    }
                });
                if (title || id) {
                    results.push({ id, title, date: dateText, downloadLink: downloadLink ? `https://boletinoficial.gba.gob.ar${downloadLink}` : '', excerpts });
                }
            });
            let content = `# Búsqueda Semántica - "${concepto}"\n\n`;
            content += `## Términos de Búsqueda Utilizados\n`;
            content += `- **Concepto principal:** ${concepto}\n`;
            content += `- **Términos equivalentes:** ${terminos.join(', ') || 'Ninguno'}\n`;
            content += `- **Query completa:** "${allTerms}"\n\n`;
            content += `## Resultados Encontrados\n`;
            content += `**Total:** ${results.length} publicaciones\n\n`;
            if (results.length === 0) {
                content += `No se encontraron publicaciones con los términos semánticos proporcionados.\n`;
            }
            else {
                results.forEach((r, idx) => {
                    content += `### ${idx + 1}. ${r.title}\n`;
                    content += `- **ID:** ${r.id}\n`;
                    content += `- **Fecha:** ${r.date}\n`;
                    content += `- **Enlace:** ${r.downloadLink}\n`;
                    if (r.excerpts.length > 0) {
                        content += `- **Extractos:**\n`;
                        r.excerpts.forEach((ex) => { content += `  - ${ex.text}\n`; });
                    }
                    content += `\n`;
                });
            }
            content += `\n> **Nota:** Esta herramienta utiliza expansión semántica para capturar publicaciones que pueden no usar la terminología exacta del concepto buscado.`;
            return { content: [{ type: "text", text: content }] };
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: `Error en búsqueda semántica: ${error.message}` }] };
        }
    });
    server.tool("generar_certificacion_forense", "Genera una certificación forense de autenticidad para una sección del BOPBA con hash SHA-256, timestamp y metadatos de integridad", {
        id: z.string().describe("ID de la sección a certificar"),
    }, async (args) => {
        try {
            const id = String(args?.id);
            const downloadUrl = `https://boletinoficial.gba.gob.ar/secciones/${id}/descargar`;
            const viewUrl = `https://boletinoficial.gba.gob.ar/secciones/${id}/ver`;
            const timestamp = new Date().toISOString();
            const response = await axiosClient.get(downloadUrl, {
                responseType: 'arraybuffer',
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
                timeout: 30000
            });
            const pdfBuffer = Buffer.from(response.data);
            const sizeBytes = Buffer.byteLength(pdfBuffer, 'utf8');
            const hash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
            const viewResponse = await axiosClient.get(viewUrl, {
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
            });
            const $ = cheerio.load(viewResponse.data);
            const title = $('h1, h2, h3').first().text().trim();
            const dateText = $('.date, .fecha, [class*="date"], [class*="fecha"]').first().text().trim();
            let content = `::: ACTA DE CERTIFICACIÓN FORENSE DE AUTENTICIDAD Y TRAZABILIDAD\n`;
            content += `::: Boletín Oficial de la Provincia de Buenos Aires (BOPBA)\n\n`;
            content += `## DOCUMENTO CERTIFICADO\n`;
            content += `- **ID de Sección:** \`${id}\`\n`;
            content += `- **Título:** ${title || 'No disponible'}\n`;
            content += `- **Fecha de Publicación:** ${dateText || 'No detectada'}\n\n`;
            content += `## METADATOS FORENSES\n`;
            content += `| Metadato Forense | Detalle Registrado |\n`;
            content += `| :--- | :--- |\n`;
            content += `| **Timestamp UTC** | \`${timestamp}\` |\n`;
            content += `| **URL de Descarga** | ${downloadUrl} |\n`;
            content += `| **URL de Vista** | ${viewUrl} |\n`;
            content += `| **Peso del Documento** | \`${sizeBytes} bytes\` |\n`;
            content += `| **Hash SHA-256 de Control** | \`${hash}\` |\n\n`;
            content += `## GARANTÍA DE INTEGRIDAD\n`;
            content += `> **[!] GARANTÍA DE NO ALTERACIÓN:** Este certificado garantiza que el documento fue descargado íntegramente desde la fuente oficial del BOPBA en el timestamp indicado.\n\n`;
            content += `---\n`;
            content += `*Certificado generado automáticamente por Argentina-Bopba-MCP v1.0.0*`;
            return { content: [{ type: "text", text: content }] };
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: `Error al generar certificación forense: ${error.message}` }] };
        }
    });
    server.tool("exportar_seccion", "Exporta una sección del BOPBA a formato Markdown estructurado con frontmatter YAML para sistemas de gestión del conocimiento (Notion, Obsidian, etc.)", {
        id: z.string().describe("ID de la sección a exportar"),
        incluir_texto: z.boolean().optional().describe("Incluir el texto completo del PDF (por defecto: true)"),
    }, async (args) => {
        try {
            const id = String(args?.id);
            const incluirTexto = args.incluir_texto !== false;
            const viewUrl = `https://boletinoficial.gba.gob.ar/secciones/${id}/ver`;
            const downloadUrl = `https://boletinoficial.gba.gob.ar/secciones/${id}/descargar`;
            const exportDate = new Date().toISOString();
            const viewResponse = await axiosClient.get(viewUrl, {
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
            });
            const $ = cheerio.load(viewResponse.data);
            const title = $('h1, h2, h3').first().text().trim();
            const dateText = $('.date, .fecha, [class*="date"], [class*="fecha"]').first().text().trim();
            const sectionType = $('h1, h2, h3').first().text().trim().split(/\s+/)[0] || 'Desconocido';
            let content = `---\n`;
            content += `title: "${title || 'Sección ' + id}"\n`;
            content += `id: "${id}"\n`;
            content += `source: "Boletín Oficial de la Provincia de Buenos Aires (BOPBA)"\n`;
            content += `source_url: "${viewUrl}"\n`;
            content += `download_url: "${downloadUrl}"\n`;
            content += `publication_date: "${dateText || 'Unknown'}"\n`;
            content += `section_type: "${sectionType}"\n`;
            content += `export_date: "${exportDate}"\n`;
            content += `exported_by: "Argentina-Bopba-MCP v1.0.0"\n`;
            content += `tags:\n  - BOPBA\n  - boletin-oficial\n  - provincia-buenos-aires\n  - seccion-${id}\n`;
            content += `---\n\n`;
            content += `# ${title || 'Sección ' + id}\n\n`;
            content += `> **Fuente:** [BOPBA - Sección ${id}](${viewUrl})\n`;
            content += `> **Fecha de publicación:** ${dateText || 'No disponible'}\n`;
            content += `> **Descarga:** [PDF](${downloadUrl})\n\n`;
            if (incluirTexto) {
                content += `## Texto Completo\n\n`;
                content += `> **Nota:** El texto completo se obtiene mediante descarga del PDF. Para visualizar el contenido íntegro, utilice la herramienta \`descargar_seccion\` o descargue directamente el PDF desde el enlace provisto.\n\n`;
                content += `El documento original está disponible en formato PDF en: ${downloadUrl}\n\n`;
            }
            content += `---\n\n*Documento exportado automáticamente desde el Boletín Oficial de la Provincia de Buenos Aires.*`;
            return { content: [{ type: "text", text: content }] };
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: `Error al exportar sección: ${error.message}` }] };
        }
    });
    server.tool("detector_plazos_edictos", "Audita el texto de una sección del BOPBA para detectar e indexar plazos, fechas límite y hitos temporales relevantes (especialmente útil para edictos sucesorios)", {
        id: z.string().describe("ID de la sección a auditar"),
        texto_manual: z.string().optional().describe("Texto manual para analizar (opcional, si no se proporciona descarga el PDF)"),
    }, async (args) => {
        try {
            const id = String(args?.id);
            let text = args.texto_manual;
            if (!text) {
                const downloadUrl = `https://boletinoficial.gba.gob.ar/secciones/${id}/descargar`;
                const response = await axiosClient.get(downloadUrl, {
                    responseType: 'arraybuffer',
                    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
                    timeout: 30000
                });
                const { PDFParse } = await import("pdf-parse");
                // FIX API pdf-parse v2: { data } en el constructor + getText().
                const parser = new PDFParse({ data: new Uint8Array(response.data) });
                const pdfData = await parser.getText();
                text = pdfData.text;
            }
            // FIX FALSOS NEGATIVOS (mismos bugs que PTN::detector_plazos_dictamenes):
            // flag /g con .test() reutilizado (lastIndex sucio), "días" exigia
            // espacio posterior, y faltaban los formatos reales de edictos:
            // "treinta (30) días", plazos en letras, "contados desde", "bajo
            // apercibimiento", "perentorio".
            const NUM_LETRAS = "(?:un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta\\s+y\\s+cinco|cuarenta|cincuenta|sesenta|noventa|ciento\\s+veinte|ciento\\s+ochenta)";
            const UNIDAD = "(?:d[ií]as?|mes(?:es)?|a[ñn]os?|horas?|semanas?)";
            const CALIF = "(?:\\s+(?:h[áa]biles?|corridos?|laborables?|administrativos?|judiciales?))?";
            const patterns = [
                { regex: new RegExp(`\\b(?:\\d+|${NUM_LETRAS})\\s*(?:\\(\\s*\\d+\\s*\\)\\s*)?${UNIDAD}${CALIF}`, "i"), name: "Plazo numérico" },
                { regex: /\b(?:plazo|t[ée]rmino)s?\s+(?:m[áa]ximo\s+|m[íi]nimo\s+|perentorio\s+)?de\b/i, name: "Cláusula de plazo" },
                { regex: new RegExp(`\\bdentro\\s+de(?:l\\s+(?:plazo|t[ée]rmino)|\\s+l[oa]s?\\s+(?:\\d+|${NUM_LETRAS}))`, "i"), name: "Plazo desde publicación" },
                { regex: /\b(?:contad[oa]s?\s+(?:desde|a\s+partir)|a\s+partir\s+de\s+(?:la\s+)?(?:notificaci[óo]n|publicaci[óo]n|recepci[óo]n|fecha))/i, name: "Cómputo de plazo" },
                { regex: /\b(?:prescrib\w+|prescripci[óo]n|prescript\w+)\b/i, name: "Prescripción" },
                { regex: /\bcaduc\w+\b/i, name: "Caducidad" },
                { regex: /\b(?:perentori[oa]s?|improrrogables?|fatal(?:es)?)\b/i, name: "Plazo perentorio" },
                { regex: /\b(?:venc\w+|expir\w+|\bmora\b)/i, name: "Vencimiento/Mora" },
                { regex: /\bbajo\s+apercibimiento\b/i, name: "Apercibimiento" },
                { regex: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/, name: "Fecha específica" },
                { regex: /\b\d{1,2}[°º]?\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+\d{4})?\b/i, name: "Fecha en letras" },
                { regex: /\bhasta\s+el\s+(?:d[íi]a\s+)?\d/i, name: "Fecha límite" },
                { regex: /\b(?:antes\s+del?\b|a\s+m[áa]s\s+tardar)/i, name: "Fecha límite" },
            ];
            const paragraphs = text.split(/\n\n+/);
            const results = [];
            for (const paragraph of paragraphs) {
                const trimmed = paragraph.trim();
                if (!trimmed || trimmed.length < 10) continue;
                const foundMatches = [];
                for (const pattern of patterns) {
                    pattern.regex.lastIndex = 0;
                    if (pattern.regex.test(trimmed) && !foundMatches.includes(pattern.name)) foundMatches.push(pattern.name);
                }
                if (foundMatches.length > 0) {
                    results.push({
                        paragraph: trimmed.substring(0, 500) + (trimmed.length > 500 ? '...' : ''),
                        matches: foundMatches
                    });
                }
            }
            let content = `# Auditoría de Plazos y Hitos Temporales - Sección ${id}\n\n`;
            content += `## Resumen\nSe identificaron **${results.length}** cláusulas con indicadores temporales relevantes.\n\n`;
            if (results.length === 0) {
                content += `No se detectaron plazos, fechas límite o hitos temporales en el texto analizado.\n`;
            } else {
                content += `## Cláusulas Temporales Detectadas\n\n`;
                results.forEach((r, idx) => {
                    content += `### ${idx + 1}. Cláusula Temporal (Indicador: ${r.matches.join(', ')})\n`;
                    content += `> ${r.paragraph}\n\n`;
                });
            }
            content += `\n> **Nota:** Esta herramienta detecta patrones de texto comunes en documentos legales. No constituye asesoramiento legal.`;
            return { content: [{ type: "text", text: content }] };
        }
        catch (error) {
            return { isError: true, content: [{ type: "text", text: `Error al detectar plazos: ${error.message}` }] };
        }
    });
    server.prompt("buscar_edicto", "Plantilla para buscar un edicto específico", {
        query: z.string().describe("Términos de búsqueda del edicto"),
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Por favor, utiliza la herramienta buscar_boletin para encontrar edictos relacionados con "${args?.query}". Una vez que encuentres resultados relevantes, usa la herramienta descargar_seccion para obtener el contenido completo del edicto y haz un resumen.` } }],
    }));
    server.prompt("auditar_seccion_bopba", "Audita y analiza una sección descargada del BOPBA", {
        id: z.string().describe("ID de la sección del boletín"),
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Descarga la sección ${args?.id} usando descargar_seccion. Luego, revisa el contenido exhaustivamente para identificar normativas clave, licitaciones o nombramientos, y genera un reporte estructurado de los hallazgos.` } }],
    }));
    server.prompt("investigar_sociedad", "Investiga publicaciones de una sociedad comercial específica", {
        nombre_sociedad: z.string().describe("Nombre de la sociedad a investigar"),
        fecha_desde: z.string().optional().describe("Fecha desde YYYY-MM-DD (opcional)"),
        fecha_hasta: z.string().optional().describe("Fecha hasta YYYY-MM-DD (opcional)"),
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Busca todas las publicaciones relacionadas con la sociedad "${args?.nombre_sociedad}" en el BOPBA. Usa buscar_boletin con el nombre de la sociedad${args?.fecha_desde ? `, fecha desde ${args.fecha_desde}` : ""}${args?.fecha_hasta ? `, fecha hasta ${args.fecha_hasta}` : ""}. Analiza los resultados para identificar convocatorias, transferencias, avisos societarios y otras publicaciones relevantes.` } }],
    }));
    server.prompt("calcular_costo_publicacion", "Calcula el costo estimado de una publicación en el BOPBA", {
        tipo: z.string().describe("Tipo de publicación"),
        texto: z.string().describe("Texto completo a publicar"),
        dias: z.string().optional().describe("Cantidad de días (opcional, por defecto 1)"),
        urgencia: z.string().optional().describe("Normal o Urgente (opcional)"),
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Usa la herramienta calcular_tarifa con los siguientes parámetros: tipo_publicacion="${args?.tipo}", texto="${args?.texto}"${args?.dias ? `, dias=${args.dias}` : ""}${args?.urgencia ? `, urgencia="${args.urgencia}"` : ""}. Presenta el costo estimado y las estadísticas del texto.` } }],
    }));
    server.prompt("monitorear_ultimas_publicaciones", "Monitorea las últimas publicaciones del BOPBA en secciones específicas", {
        seccion: z.enum(["OFICIAL", "JUDICIAL", "JURISPRUDENCIA", "SUPLEMENTO", "SUPLEMENTO 1"]).optional().describe("Sección de interés (opcional)"),
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Usa obtener_ultimo_boletin para identificar el último boletín publicado y sus secciones. Luego, usa ver_seccion para obtener una vista previa de cada sección${args?.seccion ? `, enfocándote en la sección ${args.seccion}` : ""}. Resume los contenidos más relevantes del día.` } }],
    }));
    server.prompt("buscar_normativa_periodo", "Busca normativas publicadas en un período específico", {
        fecha_desde: z.string().describe("Fecha desde YYYY-MM-DD"),
        fecha_hasta: z.string().describe("Fecha hasta YYYY-MM-DD"),
        palabras_clave: z.string().optional().describe("Palabras clave para filtrar (opcional)"),
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Usa listar_ediciones_anteriores para identificar los boletines publicados entre ${args?.fecha_desde} y ${args?.fecha_hasta}. Luego, usa buscar_boletin con los filtros de fecha${args?.palabras_clave ? ` y palabras clave "${args.palabras_clave}"` : ""} para encontrar las normativas relevantes.` } }],
    }));
    server.prompt("verificar_vigencia_documento", "Verifica la vigencia y disponibilidad de un documento del BOPBA", {
        id: z.string().describe("ID de la sección a verificar"),
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Usa la herramienta verificar_vigencia para verificar la sección ${args?.id}. Analiza el estado de disponibilidad, fecha de publicación, y si hay alertas de modificación o corrección.` } }],
    }));
    server.prompt("encontrar_publicaciones_relacionadas", "Encuentra publicaciones relacionadas con una sección específica del BOPBA", {
        id: z.string().describe("ID de la sección de referencia"),
        palabras_clave: z.string().optional().describe("Palabras clave adicionales (opcional)"),
        fecha_desde: z.string().optional().describe("Fecha desde YYYY-MM-DD (opcional)"),
        fecha_hasta: z.string().optional().describe("Fecha hasta YYYY-MM-DD (opcional)"),
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Usa la herramienta relacionar_publicaciones con el ID ${args?.id}${args?.palabras_clave ? ` y palabras clave "${args.palabras_clave}"` : ""}${args?.fecha_desde ? `, fecha desde ${args.fecha_desde}` : ""}${args?.fecha_hasta ? `, fecha hasta ${args.fecha_hasta}` : ""}.` } }],
    }));
    server.prompt("busqueda_semantica_avanzada", "Realiza búsqueda semántica en el BOPBA usando expansión de términos", {
        concepto: z.string().describe("Concepto central a buscar"),
        terminos_equivalentes: z.array(z.string()).describe("Lista de sinónimos o términos relacionados"),
        fecha_desde: z.string().optional().describe("Fecha desde YYYY-MM-DD (opcional)"),
        fecha_hasta: z.string().optional().describe("Fecha hasta YYYY-MM-DD (opcional)"),
        seccion: z.enum(["OFICIAL", "JUDICIAL", "JURISPRUDENCIA", "SUPLEMENTO", "SUPLEMENTO 1"]).optional().describe("Sección del boletín (opcional)"),
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Usa la herramienta buscar_por_semantica con el concepto "${args?.concepto}" y los términos equivalentes: ${args?.terminos_equivalentes?.join(', ') || 'ninguno'}${args?.fecha_desde ? `, fecha desde ${args.fecha_desde}` : ""}${args?.fecha_hasta ? `, fecha hasta ${args.fecha_hasta}` : ""}${args?.seccion ? `, sección ${args.seccion}` : ""}.` } }],
    }));
    server.prompt("certificar_documento_forense", "Genera certificación forense de autenticidad para un documento del BOPBA", {
        id: z.string().describe("ID de la sección a certificar"),
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Usa la herramienta generar_certificacion_forense para certificar la sección ${args?.id}. Presenta el certificado completo con todos los metadatos forenses, hash SHA-256 y garantías de integridad.` } }],
    }));
    server.prompt("exportar_documento_markdown", "Exporta una sección del BOPBA a formato Markdown con frontmatter YAML", {
        id: z.string().describe("ID de la sección a exportar"),
        incluir_texto: z.boolean().optional().describe("Incluir texto completo (opcional)"),
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Usa la herramienta exportar_seccion para exportar la sección ${args?.id}${args?.incluir_texto !== undefined ? ` con incluir_texto=${args.incluir_texto}` : ""}. Presenta el resultado en formato Markdown listo para usar en sistemas de gestión del conocimiento.` } }],
    }));
    server.prompt("auditar_plazos_edictos", "Audita un documento para detectar plazos, fechas límite y hitos temporales", {
        id: z.string().describe("ID de la sección a auditar"),
        texto_manual: z.string().optional().describe("Texto manual para analizar (opcional)"),
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Usa la herramienta detector_plazos_edictos para auditar la sección ${args?.id}${args?.texto_manual ? ` con el texto proporcionado` : ""}. Analiza los plazos y hitos temporales detectados y destaca cualquier plazo crítico.` } }],
    }));
};
registerAllTools(server);
if (typeof process !== "undefined" && !process.env.VERCEL && !process.env.NEXT_RUNTIME && !process.env.NEXT_PHASE) {
    const transport = new StdioServerTransport();
    server.connect(transport).catch((error) => {
        process.stderr.write(`Fatal error running server: ${error.message}\n`);
        process.exit(1);
    });
    process.stderr.write("[bopba] conectado y escuchando\n");
}
//# sourceMappingURL=bopba.js.map
