#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import { installTlsFallback } from "./tls-fallback.js";
installTlsFallback(axios, "bora");
// Zod schemas with adaptive coercion
export const stringOrNumber = z.union([z.string(), z.number()]).transform(val => String(val));
export const stringOrNumberOptional = z.union([z.string(), z.number()]).transform(val => String(val)).optional();
// Helper to calculate current date in Argentina (UTC-3)
export function getArgentinaTodayString() {
    const argentinaTime = new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" });
    const localDate = new Date(argentinaTime);
    const yyyy = localDate.getFullYear();
    const mm = String(localDate.getMonth() + 1).padStart(2, '0');
    const dd = String(localDate.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}
// Date natural language parser
export function parseNaturalDate(input) {
    if (!input)
        return null;
    const str = String(input).trim();
    if (!str)
        return null;
    // 1. Spanish natural date: "15 de febrero de 2026", "15 de febrero del 2026", "5 de marzo de 2026", "1 de enero del 26"
    const spanishMonthMap = {
        enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
        julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11
    };
    const spanishRegex = /^(\d{1,2})\s+de\s+([a-z]+)\s+de(?:l)?\s+(\d{2,4})$/i;
    const matchSpanish = str.match(spanishRegex);
    if (matchSpanish) {
        const day = parseInt(matchSpanish[1], 10);
        const monthName = matchSpanish[2].toLowerCase();
        let year = parseInt(matchSpanish[3], 10);
        if (year < 100) {
            year += 2000;
        }
        const month = spanishMonthMap[monthName];
        if (month !== undefined && day >= 1 && day <= 31) {
            return new Date(year, month, day);
        }
    }
    // 2. DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    const localRegex = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/;
    const matchLocal = str.match(localRegex);
    if (matchLocal) {
        const day = parseInt(matchLocal[1], 10);
        const month = parseInt(matchLocal[2], 10) - 1;
        let year = parseInt(matchLocal[3], 10);
        if (year < 100) {
            year += 2000;
        }
        if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
            return new Date(year, month, day);
        }
    }
    // 3. ISO format: YYYY-MM-DD or YYYY/MM/DD
    const isoRegex = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/;
    const matchIso = str.match(isoRegex);
    if (matchIso) {
        const year = parseInt(matchIso[1], 10);
        const month = parseInt(matchIso[2], 10) - 1;
        const day = parseInt(matchIso[3], 10);
        if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
            return new Date(year, month, day);
        }
    }
    // 4. Compact format YYYYMMDD
    const compactRegex = /^(\d{4})(\d{2})(\d{2})$/;
    const matchCompact = str.match(compactRegex);
    if (matchCompact) {
        const year = parseInt(matchCompact[1], 10);
        const month = parseInt(matchCompact[2], 10) - 1;
        const day = parseInt(matchCompact[3], 10);
        if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
            return new Date(year, month, day);
        }
    }
    // 5. Fallback JS parsing
    const parsedTime = Date.parse(str);
    if (!isNaN(parsedTime)) {
        return new Date(parsedTime);
    }
    return null;
}
// Normalizers
export function normalizeDateToDDMMYYYY(input) {
    if (!input)
        return "";
    const d = parseNaturalDate(input);
    if (!d)
        return String(input);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}
export function normalizeDateToYYYYMMDD(input) {
    if (!input)
        return "";
    const d = parseNaturalDate(input);
    if (!d)
        return String(input);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}
/**
 * Scrapes and parses advanced search results from BORA
 */
export async function buscarAvisos(args) {
    const url = "https://www.boletinoficial.gob.ar/busquedaAvanzada/realizarBusqueda";
    // Combine criterio/texto, nroNorma, anioNorma safely to bypass BORA's broken nroNorma/anioNorma filters
    let queryText = args.criterio || "";
    // Intercept and append explicit parameters to search string
    if (args.organismo) {
        const org = args.organismo.trim();
        if (!queryText.toLowerCase().includes(org.toLowerCase())) {
            queryText = queryText ? `${queryText} "${org}"` : `"${org}"`;
        }
    }
    if (args.materia) {
        const mat = args.materia.trim();
        if (!queryText.toLowerCase().includes(mat.toLowerCase())) {
            queryText = queryText ? `${queryText} ${mat}` : mat;
        }
    }
    if (args.tipoNorma) {
        const tn = args.tipoNorma.trim();
        if (!queryText.toLowerCase().includes(tn.toLowerCase())) {
            queryText = queryText ? `${tn} ${queryText}` : tn;
        }
    }
    if (args.nroNorma) {
        if (!queryText.includes(args.nroNorma)) {
            queryText = queryText ? `${queryText} ${args.nroNorma}` : args.nroNorma;
        }
    }
    if (args.anioNorma) {
        if (!queryText.includes(args.anioNorma)) {
            queryText = queryText ? `${queryText} ${args.anioNorma}` : args.anioNorma;
        }
    }
    const searchParams = {
        busquedaRubro: false,
        hayMasResultadosBusqueda: true,
        ejecutandoLlamadaAsincronicaBusqueda: false,
        ultimaSeccion: "",
        filtroPorRubrosSeccion: false,
        filtroPorRubroBusqueda: false,
        filtroPorSeccionBusqueda: false,
        busquedaOriginal: true,
        ordenamientoSegunda: false,
        seccionesOriginales: [1, 2, 3],
        ultimoItemExterno: null,
        ultimoItemInterno: null,
        texto: queryText,
        rubros: [],
        nroNorma: "", // Set to empty to avoid BORA backend bug that filters out all results
        anioNorma: "", // Set to empty to avoid BORA backend bug that filters out all results
        denominacion: "",
        tipoContratacion: "",
        anioContratacion: "",
        nroContratacion: "",
        fechaDesde: args.fechaDesde ? normalizeDateToDDMMYYYY(args.fechaDesde) : "",
        fechaHasta: args.fechaHasta ? normalizeDateToDDMMYYYY(args.fechaHasta) : "",
        todasLasPalabras: true,
        comienzaDenominacion: true,
        seccion: args.seccion || [1, 2, 3],
        tipoBusqueda: "Avanzada",
        numeroPagina: args.pagina || 1,
        ultimoRubro: ""
    };
    const formData = new URLSearchParams();
    formData.append("params", JSON.stringify(searchParams));
    formData.append("array_volver", "[]");
    const response = await axios.post(url, formData, {
        headers: {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "es-AR,es;q=0.9,en-US;q=0.8,en;q=0.7",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Origin": "https://www.boletinoficial.gob.ar",
            "Referer": "https://www.boletinoficial.gob.ar/busquedaAvanzada/all"
        }
    });
    if (!response.data || !response.data.content) {
        throw new Error("La respuesta del Boletín Oficial no es válida.");
    }
    const html = response.data.content.html || "";
    if (!html) {
        return [];
    }
    const $ = cheerio.load(html);
    const results = [];
    $("a").each((_, element) => {
        const href = $(element).attr("href");
        if (!href)
            return;
        const match = href.match(/\/detalleAviso\/([^/]+)\/([^/]+)\/([^/?]+)/);
        if (match) {
            const seccionSlug = match[1];
            const idAviso = match[2];
            const fecha = match[3];
            const lineaAviso = $(element).find(".linea-aviso");
            if (lineaAviso.length > 0) {
                const titulo = lineaAviso.find("p.item").text().trim();
                const details = [];
                lineaAviso.find("p.item-detalle").each((_, det) => {
                    details.push($(det).text().trim());
                });
                const norma = details[0] || "";
                let fechaPublicacion = "";
                if (details[1] && details[1].toLowerCase().includes("fecha de publicacion")) {
                    fechaPublicacion = details[1].replace(/fecha de publicacion:\s*/i, "").trim();
                }
                else {
                    fechaPublicacion = details[1] || "";
                }
                const extracto = details[2] || "";
                results.push({
                    seccion: seccionSlug,
                    idAviso,
                    fecha,
                    titulo,
                    norma,
                    fechaPublicacion,
                    extracto,
                    urlDetalle: `https://www.boletinoficial.gob.ar/detalleAviso/${seccionSlug}/${idAviso}/${fecha}`,
                    urlPdf: `https://www.boletinoficial.gob.ar/pdf/aviso/${seccionSlug}/${idAviso}/${fecha}`
                });
            }
        }
    });
    return results;
}
/**
 * Scrapes and parses verbatim notice details from BORA
 */
export async function obtenerDetalleAviso(args) {
    const normalizedFecha = normalizeDateToYYYYMMDD(args.fecha);
    const url = `https://www.boletinoficial.gob.ar/detalleAviso/${args.seccion}/${args.idAviso}/${normalizedFecha}`;
    const response = await axios.get(url, {
        headers: {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "es-AR,es;q=0.9,en-US;q=0.8,en;q=0.7",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
    });
    const html = response.data;
    const $ = cheerio.load(html);
    const titulo = $("#tituloDetalleAviso h1").text().trim();
    const norma = $("#tituloDetalleAviso h2").text().trim();
    const sintesis = $("#tituloDetalleAviso h6").text().trim();
    const bodyClone = $("#cuerpoDetalleAviso").clone();
    bodyClone.find("style").remove();
    bodyClone.find("script").remove();
    bodyClone.find("br").replaceWith("\n");
    bodyClone.find("p").each((_, p) => {
        $(p).append("\n\n");
    });
    const verbatimBody = bodyClone.text().replace(/\n{3,}/g, "\n\n").trim();
    return {
        titulo,
        norma,
        sintesis,
        verbatimBody,
        url
    };
}
/**
 * Scrapes and parses the daily notice index for a specific section and date
 */
export async function obtenerSumarioSeccion(args) {
    const fechaRaw = args.fecha || getArgentinaTodayString();
    const fecha = normalizeDateToYYYYMMDD(fechaRaw);
    const url = `https://www.boletinoficial.gob.ar/seccion/${args.seccion}/${fecha}`;
    const response = await axios.get(url, {
        headers: {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "es-AR,es;q=0.9,en-US;q=0.8,en;q=0.7",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
    });
    const html = response.data;
    const $ = cheerio.load(html);
    const items = [];
    let currentRubro = "General";
    const container = $("#avisosSeccionDiv");
    if (container.length > 0) {
        if (args.seccion === "cuarta") {
            container.find(".linea-aviso").each((_, el) => {
                const $el = $(el);
                const anchor = $el.find('a');
                const href = anchor.attr('href') || '';
                const title = anchor.text().trim();
                const owner = $el.find('p small').text().trim();
                const operation = $el.find('.col-icon i').attr('title') || $el.find('.col-icon i').attr('data-original-title') || 'ALTA';
                items.push({
                    rubro: "Registro de Dominios y Marcas",
                    seccion: "cuarta",
                    idAviso: title,
                    fecha: fecha,
                    titulo: title,
                    norma: `Operación: ${operation}`,
                    extracto: `Titular: ${owner}`,
                    urlDetalle: href.startsWith('http') ? href : `https:${href}`,
                    urlPdf: `https://www.boletinoficial.gob.ar/pdf/download_section/cuarta/${fecha}`
                });
            });
        }
        else {
            container.children().each((_, child) => {
                const $child = $(child);
                const rubroEl = $child.find("h5.seccion-rubro");
                if (rubroEl.length > 0) {
                    currentRubro = rubroEl.text().trim();
                }
                else {
                    const anchor = $child.find("a");
                    if (anchor.length > 0) {
                        const href = anchor.attr("href");
                        if (href) {
                            const match = href.match(/\/detalleAviso\/([^/]+)\/([^/]+)\/([^/?]+)/);
                            if (match) {
                                const seccionSlug = match[1];
                                const idAviso = match[2];
                                const fechaAviso = match[3];
                                const lineaAviso = anchor.find(".linea-aviso");
                                if (lineaAviso.length > 0) {
                                    const titulo = lineaAviso.find("p.item").text().trim();
                                    const details = [];
                                    lineaAviso.find("p.item-detalle").each((_, det) => {
                                        details.push($(det).text().trim());
                                    });
                                    const norma = details[0] || "";
                                    const extracto = details[1] || "";
                                    items.push({
                                        rubro: currentRubro,
                                        seccion: seccionSlug,
                                        idAviso,
                                        fecha: fechaAviso,
                                        titulo,
                                        norma,
                                        extracto,
                                        urlDetalle: `https://www.boletinoficial.gob.ar/detalleAviso/${seccionSlug}/${idAviso}/${fechaAviso}`,
                                        urlPdf: `https://www.boletinoficial.gob.ar/pdf/aviso/${seccionSlug}/${idAviso}/${fechaAviso}`
                                    });
                                }
                            }
                        }
                    }
                }
            });
        }
    }
    return {
        fecha,
        seccion: args.seccion,
        url,
        items
    };
}
/**
 * Searches Section 2 (Sociedades) for corporate incorporations
 */
export async function buscarNuevasSociedades(args) {
    return buscarAvisos({
        criterio: "CONSTITUCION", // standard term for corporate formation in BORA
        seccion: [2],
        fechaDesde: args.fechaDesde,
        fechaHasta: args.fechaHasta,
        pagina: args.pagina || 1
    });
}
/**
 * Searches Section 3 (Contrataciones) for public tenders
 */
export async function buscarLicitacionesPublicas(args) {
    return buscarAvisos({
        criterio: args.criterio || "licitacion",
        seccion: [3],
        fechaDesde: args.fechaDesde,
        fechaHasta: args.fechaHasta,
        pagina: args.pagina || 1
    });
}
/**
 * Scrapes BORA's homepage to get daily edition metadata, highlights, and full PDF links
 */
export async function obtenerPortada() {
    const url = "https://www.boletinoficial.gob.ar/";
    const response = await axios.get(url, {
        headers: {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "es-AR,es;q=0.9,en-US;q=0.8,en;q=0.7",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
    });
    const html = response.data;
    const $ = cheerio.load(html);
    // Extract date from scripts
    const scriptHtml = $('script').text();
    const matchYMD = scriptHtml.match(/fechaSeleccionadaYMD\s*=\s*'(\d{8})'/);
    const fechaYMD = matchYMD ? matchYMD[1] : getArgentinaTodayString();
    const matchReadable = scriptHtml.match(/fechaSeleccionada\s*=\s*'([^']+)'/);
    const fechaReadable = matchReadable ? matchReadable[1] : '';
    // Extract human readable date from the h6 under social-btns
    const textDate = $('h6').eq(1).text().trim() || fechaReadable;
    // Extract highlights/carousel
    const highlights = [];
    $('.carousel-inner .item').each((_, el) => {
        const link = $(el).find('a').attr('href') || '';
        const img = $(el).find('img').attr('src') || '';
        const text = $(el).find('a').text().trim() || '';
        if (link) {
            highlights.push({
                link,
                img: img.startsWith('data:') ? '[Base64 Image]' : img,
                text
            });
        }
    });
    // Construct PDF links
    const pdfLinks = {
        primera: `https://www.boletinoficial.gob.ar/pdf/download_section/primera/${fechaYMD}`,
        segunda: `https://www.boletinoficial.gob.ar/pdf/download_section/segunda/${fechaYMD}`,
        tercera: `https://www.boletinoficial.gob.ar/pdf/download_section/tercera/${fechaYMD}`,
        cuarta: `https://www.boletinoficial.gob.ar/pdf/download_section/cuarta/${fechaYMD}`
    };
    return {
        fechaYMD,
        fechaReadable: textDate,
        pdfLinks,
        highlights,
        url
    };
}
/**
 * Scrapes and aggregates daily summaries for all 4 sections
 */
export async function obtenerSumarioDelDia(args) {
    const fechaRaw = args.fecha || getArgentinaTodayString();
    const fecha = normalizeDateToYYYYMMDD(fechaRaw);
    const secciones = ["primera", "segunda", "tercera", "cuarta"];
    // Concurrently fetch all sections
    const results = await Promise.all(secciones.map(async (sec) => {
        try {
            const sumario = await obtenerSumarioSeccion({ seccion: sec, fecha });
            return {
                seccion: sec,
                items: sumario.items,
                url: sumario.url,
                error: null
            };
        }
        catch (error) {
            return {
                seccion: sec,
                items: [],
                url: `https://www.boletinoficial.gob.ar/seccion/${sec}/${fecha}`,
                error: error.message
            };
        }
    }));
    return {
        fecha,
        resultados: results
    };
}
export function registerAllTools(server) {
    // Tool 1: buscar_avisos
    server.tool("buscar_avisos", "Busca avisos publicados en el Boletín Oficial de la República Argentina por texto, fecha, sección, número o año.", {
        criterio: z.string().describe("Término de búsqueda legal o palabra clave (ej. 'maternidad', 'impuesto a las ganancias')"),
        seccion: z.array(z.number()).optional().describe("Secciones a buscar: 1 (Legislación y Avisos Oficiales), 2 (Sociedades y Avisos Judiciales), 3 (Contrataciones). Por defecto busca en todas [1, 2, 3]."),
        fechaDesde: stringOrNumberOptional.describe("Fecha de inicio de búsqueda en formato DD/MM/YYYY (ej. '01/01/2026')"),
        fechaHasta: stringOrNumberOptional.describe("Fecha de fin de búsqueda en formato DD/MM/YYYY (ej. '19/05/2026')"),
        nroNorma: stringOrNumberOptional.describe("Número de norma específico (ej. '27430')"),
        anioNorma: stringOrNumberOptional.describe("Año de la norma (ej. '2017')"),
        pagina: z.number().optional().default(1).describe("Número de página para resultados de paginación")
    }, async (args) => {
        try {
            const results = await buscarAvisos(args);
            if (results.length === 0) {
                return {
                    content: [{
                            type: "text",
                            text: `La búsqueda para '${args.criterio}' no arrojó resultados en el Boletín Oficial.`
                        }]
                };
            }
            let md = `# Boletín Oficial de la República Argentina - Resultados de Búsqueda\n\n`;
            md += `*   **Criterio:** \`${args.criterio}\`\n`;
            if (args.fechaDesde)
                md += `*   **Desde:** ${args.fechaDesde}\n`;
            if (args.fechaHasta)
                md += `*   **Hasta:** ${args.fechaHasta}\n`;
            md += `*   **Página:** ${args.pagina}\n`;
            md += `*   **Resultados encontrados:** ${results.length}\n\n`;
            md += `--- \n\n`;
            results.forEach((r, idx) => {
                md += `### ${idx + 1}. ${r.titulo}\n`;
                if (r.norma)
                    md += `*   **Norma:** ${r.norma}\n`;
                if (r.fechaPublicacion)
                    md += `*   **Fecha de Publicación:** ${r.fechaPublicacion}\n`;
                md += `*   **Sección:** ${r.seccion.toUpperCase()}\n`;
                md += `*   **ID Aviso:** \`${r.idAviso}\` | **Fecha ID:** \`${r.fecha}\`\n`;
                if (r.extracto)
                    md += `*   **Extracto:** *${r.extracto}*\n`;
                md += `*   **Enlace Oficial:** [Ver en BORA](${r.urlDetalle}) | [Ver PDF](${r.urlPdf})\n\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return {
                content: [{
                        type: "text",
                        text: `Error al consultar el Boletín Oficial (buscar_avisos): ${error.message}`
                    }],
                isError: true
            };
        }
    });
    // Tool 2: obtener_detalle_aviso
    server.tool("obtener_detalle_aviso", "Obtiene el texto completo verbatim y metadatos de un aviso/ley específico del Boletín Oficial usando sección, ID y fecha.", {
        seccion: z.string().describe("Sección del aviso (ej. 'primera', 'segunda', 'tercera', 'cuarta')"),
        idAviso: stringOrNumber.describe("ID único del aviso (ej. '176831')"),
        fecha: stringOrNumber.describe("Fecha del aviso en formato YYYYMMDD (ej. '20171229')")
    }, async (args) => {
        try {
            const detail = await obtenerDetalleAviso(args);
            const normalizedFecha = normalizeDateToYYYYMMDD(args.fecha);
            if (!detail.titulo && !detail.verbatimBody) {
                return {
                    content: [{
                            type: "text",
                            text: `No se pudo encontrar o parsear el detalle del aviso en ${detail.url}. Verifique los parámetros de sección, ID y fecha.`
                        }]
                };
            }
            let md = `# Boletín Oficial de la República Argentina - Detalle de Aviso\n\n`;
            md += `*   **Título:** ${detail.titulo || "N/A"}\n`;
            if (detail.norma)
                md += `*   **Norma:** ${detail.norma}\n`;
            if (detail.sintesis)
                md += `*   **Síntesis:** ${detail.sintesis}\n`;
            md += `*   **Enlace Oficial:** [Ver en BORA](${detail.url}) | [Descargar PDF](https://www.boletinoficial.gob.ar/pdf/aviso/${args.seccion}/${args.idAviso}/${normalizedFecha})\n\n`;
            md += `--- \n\n`;
            md += `## Texto Original / Verbatim:\n\n`;
            md += `${detail.verbatimBody || "*No se encontró texto en el cuerpo del aviso.*"}\n`;
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return {
                content: [{
                        type: "text",
                        text: `Error al obtener el detalle del aviso desde el Boletín Oficial (obtener_detalle_aviso): ${error.message}`
                    }],
                isError: true
            };
        }
    });
    // Tool 3: obtener_sumario_seccion
    server.tool("obtener_sumario_seccion", "Obtiene el sumario de avisos publicados en una sección específica para una fecha dada, ordenados por rubro/tema.", {
        seccion: z.string().describe("Sección a consultar: 'primera' (Legislación), 'segunda' (Sociedades), 'tercera' (Licitaciones), 'cuarta' (Marcas)"),
        fecha: stringOrNumberOptional.describe("Fecha a consultar en formato YYYYMMDD (ej. '20171229'). Si se omite, se asume la fecha de hoy en Argentina.")
    }, async (args) => {
        try {
            const sumario = await obtenerSumarioSeccion(args);
            if (sumario.items.length === 0) {
                return {
                    content: [{
                            type: "text",
                            text: `No se encontraron avisos publicados en la sección '${args.seccion}' para la fecha ${sumario.fecha}.`
                        }]
                };
            }
            // Group items by Rubro
            const grouped = {};
            sumario.items.forEach(item => {
                if (!grouped[item.rubro])
                    grouped[item.rubro] = [];
                grouped[item.rubro].push(item);
            });
            let md = `# Boletín Oficial - Sumario de la Sección ${args.seccion.toUpperCase()}\n\n`;
            md += `*   **Fecha de Edición:** ${sumario.fecha.substring(6, 8)}/${sumario.fecha.substring(4, 6)}/${sumario.fecha.substring(0, 4)}\n`;
            md += `*   **URL Oficial:** [Ver Portada en BORA](${sumario.url})\n\n`;
            md += `--- \n\n`;
            Object.keys(grouped).forEach(rubro => {
                md += `## 📂 ${rubro}\n\n`;
                grouped[rubro].forEach(item => {
                    md += `### 📄 ${item.titulo || "Aviso Oficial"}\n`;
                    if (item.norma)
                        md += `*   **Norma:** ${item.norma}\n`;
                    if (item.extracto)
                        md += `*   **Síntesis:** ${item.extracto}\n`;
                    md += `*   **Referencias:** ID \`${item.idAviso}\` | [Texto Completo](${item.urlDetalle}) | [Ver PDF](${item.urlPdf})\n\n`;
                });
                md += `--- \n\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return {
                content: [{
                        type: "text",
                        text: `Error al obtener el sumario de sección (obtener_sumario_seccion): ${error.message}`
                    }],
                isError: true
            };
        }
    });
    // Tool 4: obtener_enlace_pdf
    server.tool("obtener_enlace_pdf", "Obtiene el enlace directo de descarga oficial del archivo PDF digital firmado de un aviso.", {
        seccion: z.string().describe("Sección del aviso (ej. 'primera', 'segunda', 'tercera')"),
        idAviso: stringOrNumber.describe("ID único del aviso (ej. '176831')"),
        fecha: stringOrNumber.describe("Fecha asociada al aviso en formato YYYYMMDD (ej. '20171229')")
    }, async (args) => {
        const normalizedFecha = normalizeDateToYYYYMMDD(args.fecha);
        const pdfUrl = `https://www.boletinoficial.gob.ar/pdf/aviso/${args.seccion}/${args.idAviso}/${normalizedFecha}`;
        return {
            content: [{
                    type: "text",
                    text: `# Enlace Oficial de Descarga PDF\n\nEl PDF firmado digitalmente para el aviso con ID \`${args.idAviso}\` en la sección \`${args.seccion}\` (${normalizedFecha}) se encuentra disponible en:\n\n👉 [Descargar PDF Oficial Firmado](${pdfUrl})`
                }]
        };
    });
    // Tool 5: buscar_nuevas_sociedades
    server.tool("buscar_nuevas_sociedades", "Buscador especializado de constitución de nuevas sociedades comerciales (S.A., S.R.L., S.A.S.) en la Segunda Sección del Boletín Oficial.", {
        fechaDesde: stringOrNumberOptional.describe("Fecha de inicio de búsqueda en formato DD/MM/YYYY (ej. '01/01/2026')"),
        fechaHasta: stringOrNumberOptional.describe("Fecha de fin de búsqueda en formato DD/MM/YYYY (ej. '19/05/2026')"),
        pagina: z.number().optional().default(1).describe("Número de página para resultados de paginación")
    }, async (args) => {
        try {
            const results = await buscarNuevasSociedades(args);
            if (results.length === 0) {
                return {
                    content: [{
                            type: "text",
                            text: `No se encontraron constituciones de nuevas sociedades comerciales en la Segunda Sección para este período.`
                        }]
                };
            }
            let md = `# Constitución de Nuevas Sociedades - Boletín Oficial (Sección Segunda)\n\n`;
            if (args.fechaDesde)
                md += `*   **Desde:** ${args.fechaDesde}\n`;
            if (args.fechaHasta)
                md += `*   **Hasta:** ${args.fechaHasta}\n`;
            md += `*   **Página:** ${args.pagina}\n`;
            md += `*   **Sociedades encontradas:** ${results.length}\n\n`;
            md += `--- \n\n`;
            results.forEach((r, idx) => {
                md += `### ${idx + 1}. 🏢 ${r.titulo}\n`;
                if (r.fechaPublicacion)
                    md += `*   **Fecha de Publicación:** ${r.fechaPublicacion}\n`;
                if (r.extracto)
                    md += `*   **Extracto/Sintesis:** *${r.extracto}*\n`;
                md += `*   **Referencias:** ID \`${r.idAviso}\` | [Detalle Constitutivo](${r.urlDetalle}) | [Descargar PDF](${r.urlPdf})\n\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return {
                content: [{
                        type: "text",
                        text: `Error en buscar_nuevas_sociedades: ${error.message}`
                    }],
                isError: true
            };
        }
    });
    // Tool 6: buscar_licitaciones_publicas
    server.tool("buscar_licitaciones_publicas", "Buscador especializado en licitaciones y contrataciones públicas en la Tercera Sección del Boletín Oficial.", {
        criterio: z.string().optional().describe("Palabra clave a buscar (ej. 'obras', 'alimentos', 'tecnología'). Por defecto busca 'licitacion'."),
        fechaDesde: stringOrNumberOptional.describe("Fecha de inicio de búsqueda en formato DD/MM/YYYY (ej. '01/01/2026')"),
        fechaHasta: stringOrNumberOptional.describe("Fecha de fin de búsqueda en formato DD/MM/YYYY (ej. '19/05/2026')"),
        pagina: z.number().optional().default(1).describe("Número de página para resultados de paginación")
    }, async (args) => {
        try {
            const results = await buscarLicitacionesPublicas(args);
            if (results.length === 0) {
                return {
                    content: [{
                            type: "text",
                            text: `No se encontraron licitaciones públicas en la Tercera Sección bajo el criterio '${args.criterio || "licitacion"}'.`
                        }]
                };
            }
            let md = `# Licitaciones Públicas - Boletín Oficial (Sección Tercera)\n\n`;
            md += `*   **Criterio de búsqueda:** \`${args.criterio || "licitacion"}\`\n`;
            if (args.fechaDesde)
                md += `*   **Desde:** ${args.fechaDesde}\n`;
            if (args.fechaHasta)
                md += `*   **Hasta:** ${args.fechaHasta}\n`;
            md += `*   **Página:** ${args.pagina}\n`;
            md += `*   **Licitaciones encontradas:** ${results.length}\n\n`;
            md += `--- \n\n`;
            results.forEach((r, idx) => {
                md += `### ${idx + 1}. 🔔 ${r.titulo}\n`;
                if (r.norma)
                    md += `*   **Organismo/Norma:** ${r.norma}\n`;
                if (r.fechaPublicacion)
                    md += `*   **Fecha de Publicación:** ${r.fechaPublicacion}\n`;
                if (r.extracto)
                    md += `*   **Resumen:** *${r.extracto}*\n`;
                md += `*   **Referencias:** ID \`${r.idAviso}\` | [Pliego / Detalles](${r.urlDetalle}) | [Descargar PDF](${r.urlPdf})\n\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return {
                content: [{
                        type: "text",
                        text: `Error en buscar_licitaciones_publicas: ${error.message}`
                    }],
                isError: true
            };
        }
    });
    // Tool 7: alcance_fuente
    server.tool("alcance_fuente", "Informa las capacidades, fuentes de datos, limitaciones y disclaimer del conector bora-mcp.", {}, async () => {
        const text = `# Alcance y Fuentes - Boletín Oficial de la República Argentina

## Datos del Conector
- **Servidor:** \`bora-mcp\`
- **Fuente Legal:** Boletín Oficial de la República Argentina (BORA)
- **URL Oficial:** https://www.boletinoficial.gob.ar/
- **Nivel de Servicio:** ⚡ Tiempo real (Consultas vía HTTP POST/GET parseadas dinámicamente)

## Herramientas Soportadas
1. \`buscar_avisos\`: Realiza búsquedas avanzadas parametrizadas en la base de avisos de BORA.
2. \`obtener_detalle_aviso\`: Descarga en texto plano limpio y con rigurosa exactitud verbatim cualquier aviso publicado utilizando su ID único, sección y fecha de publicación.
3. \`obtener_sumario_seccion\`: Obtiene el índice completo (sumario) de un día en una sección específica, agrupado de forma lógica por rubro/materia.
4. \`obtener_enlace_pdf\`: Devuelve la ruta directa de descarga del archivo PDF digitalmente firmado con validez jurídica.
5. \`buscar_nuevas_sociedades\`: Buscador optimizado para constituciones de firmas comerciales (Sección Segunda).
6. \`buscar_licitaciones_publicas\`: Buscador de pliegos, compras y contrataciones estatales (Sección Tercera).
7. \`obtener_portada\`: Obtiene la portada del Boletín Oficial, incluyendo la fecha de edición, destaques/carousel y enlaces de descarga del PDF completo de cada sección.
8. \`obtener_sumario_del_dia\`: Obtiene el sumario unificado completo de las cuatro secciones del Boletín Oficial para un día dado, agrupado por rubros.
9. \`alcance_fuente\`: Muestra el alcance, detalles técnicos y aviso legal.

## Limitaciones y Notas Técnicas
- **Consumo Serverless & Cloud**: Este conector puede ejecutarse de manera local mediante transporte Stdio, o desplegarse en la nube como Vercel Serverless mediante transporte SSE.
- **Bypass de SSL**: Utiliza agentes HTTPS tolerantes a fallos criptográficos ya que el servidor del Boletín Oficial cuenta periódicamente con problemas en sus certificados de cadena de confianza.
- **Sin Estado**: Por motivos de privacidad legal y rendimiento, este conector es completamente stateless y no persiste logs de búsqueda o historiales del usuario.

## Aviso de Exención de Responsabilidad (Disclaimer)
Este servidor es un puente automatizado de información pública legal y no constituye asesoramiento jurídico profesional. Los datos son provistos de forma literal y transparente directamente de la base pública oficial.`;
        return { content: [{ type: "text", text: text }] };
    });
    // Tool 8: obtener_portada
    server.tool("obtener_portada", "Obtiene los destaques y enlaces directos de los PDFs completos de cada una de las 4 secciones del Boletín Oficial del día de hoy.", {}, async () => {
        try {
            const detail = await obtenerPortada();
            let md = `# 📰 Boletín Oficial de la República Argentina - Portada del Día\n\n`;
            md += `*   **Fecha de Edición:** ${detail.fechaReadable || "N/A"}\n`;
            md += `*   **Identificador de Edición (YMD):** \`${detail.fechaYMD}\`\n`;
            md += `*   **URL Oficial:** [Boletín Oficial de la República Argentina](${detail.url})\n\n`;
            md += `--- \n\n`;
            md += `### 📥 Descarga de Ediciones Completas en PDF\n`;
            md += `Puede descargar los archivos firmados digitalmente para cada sección de esta fecha:\n\n`;
            md += `*   **Primera Sección** (Legislación y Avisos Oficiales): [Descargar PDF](${detail.pdfLinks.primera})\n`;
            md += `*   **Segunda Sección** (Sociedades y Avisos Judiciales): [Descargar PDF](${detail.pdfLinks.segunda})\n`;
            md += `*   **Tercera Sección** (Contrataciones y Licitaciones): [Descargar PDF](${detail.pdfLinks.tercera})\n`;
            md += `*   **Cuarta Sección** (Marcas y Patentes): [Descargar PDF](${detail.pdfLinks.cuarta})\n\n`;
            md += `--- \n\n`;
            if (detail.highlights.length > 0) {
                md += `### 🌟 Destaques de la Edición\n\n`;
                detail.highlights.forEach((h, idx) => {
                    md += `${idx + 1}. **[${h.text || "Destacado Oficial"}](${h.link})**\n`;
                });
            }
            else {
                md += `*No se registraron destaques destacados en el carousel de la portada.*`;
            }
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return {
                content: [{
                        type: "text",
                        text: `Error al obtener la portada del día: ${error.message}`
                    }],
                isError: true
            };
        }
    });
    // Tool 9: obtener_sumario_del_dia
    server.tool("obtener_sumario_del_dia", "Obtiene el sumario completo y unificado de las cuatro secciones del Boletín Oficial para un día dado, agrupado por rubros. Paginado: use 'pagina' e 'items_por_pagina' para recorrer ediciones extensas.", {
        fecha: stringOrNumberOptional.describe("Fecha a consultar en formato YYYYMMDD (ej. '20171229'). Si se omite, se asume la fecha de hoy en Argentina."),
        seccion: z.string().optional().describe("Limitar a una sección ('primera', 'segunda', 'tercera', 'cuarta'). Si se omite, incluye las cuatro."),
        pagina: z.number().optional().describe("Página de resultados (por defecto 1)."),
        items_por_pagina: z.number().optional().describe("Items por página (por defecto 50, máximo 200).")
    }, async (args) => {
        try {
            const sumario = await obtenerSumarioDelDia(args);
            // FIX: la edicion completa superaba el limite de tokens (89KB+)
            // y se truncaba sin aviso. Ahora se aplana, se pagina y se informa
            // el total y la pagina siguiente.
            const pagina = Math.max(1, Number(args.pagina) || 1);
            const porPagina = Math.min(200, Math.max(1, Number(args.items_por_pagina) || 50));
            const filtroSeccion = args.seccion ? String(args.seccion).toLowerCase() : null;
            let md = `# 🏛️ Boletín Oficial - Sumario Unificado del Día\n\n`;
            const yyyymmdd = sumario.fecha;
            const formattedDate = `${yyyymmdd.substring(6, 8)}/${yyyymmdd.substring(4, 6)}/${yyyymmdd.substring(0, 4)}`;
            md += `*   **Fecha de Edición:** ${formattedDate}\n\n`;
            const resultados = filtroSeccion
                ? sumario.resultados.filter((r) => r.seccion.toLowerCase().includes(filtroSeccion))
                : sumario.resultados;
            const flat = [];
            const erroresSeccion = [];
            const urlPorSeccion = {};
            resultados.forEach((res) => {
                urlPorSeccion[res.seccion] = res.url;
                if (res.error) erroresSeccion.push({ seccion: res.seccion, error: res.error });
                res.items.forEach((item) => flat.push({ seccion: res.seccion, item }));
            });
            const totalItems = flat.length;
            if (totalItems === 0) {
                const detalleErrores = erroresSeccion.length
                    ? `\n\nErrores por sección:\n${erroresSeccion.map(e => `- ${e.seccion}: ${e.error}`).join('\n')}`
                    : '';
                return {
                    content: [{
                            type: "text",
                            text: `No se encontraron avisos${filtroSeccion ? ` en la sección "${filtroSeccion}"` : " en ninguna de las secciones"} para la fecha ${formattedDate}.${detalleErrores}`
                        }]
                };
            }
            const totalPaginas = Math.ceil(totalItems / porPagina);
            const desde = (pagina - 1) * porPagina;
            const slice = flat.slice(desde, desde + porPagina);
            md += `*   **Total de avisos:** ${totalItems}${filtroSeccion ? ` (sección ${filtroSeccion})` : ''}\n`;
            md += `*   **Página:** ${pagina} de ${totalPaginas} (mostrando ${slice.length} avisos, items ${desde + 1}-${desde + slice.length})\n`;
            if (pagina < totalPaginas) {
                md += `*   **Siguiente:** repetir la llamada con \`pagina: ${pagina + 1}\`\n`;
            }
            md += `\n--- \n\n`;
            erroresSeccion.forEach((e) => {
                md += `⚠️ *Error al cargar la sección ${e.seccion}: ${e.error}*\n\n`;
            });
            if (slice.length === 0) {
                md += `*La página solicitada está fuera de rango (total: ${totalPaginas} páginas).*\n`;
                return { content: [{ type: "text", text: md }] };
            }
            // Agrupar el slice por seccion -> rubro preservando el orden
            const porSeccion = new Map();
            slice.forEach(({ seccion, item }) => {
                if (!porSeccion.has(seccion)) porSeccion.set(seccion, new Map());
                const rubros = porSeccion.get(seccion);
                const rubro = item.rubro || 'Sin rubro';
                if (!rubros.has(rubro)) rubros.set(rubro, []);
                rubros.get(rubro).push(item);
            });
            for (const [seccion, rubros] of porSeccion) {
                md += `## 📂 SECCIÓN: ${seccion.toUpperCase()}\n`;
                if (urlPorSeccion[seccion]) md += `*URL Oficial: [Ver Sección en BORA](${urlPorSeccion[seccion]})*\n\n`;
                for (const [rubro, items] of rubros) {
                    md += `### 🗂️ Rubro: ${rubro}\n\n`;
                    items.forEach((item) => {
                        md += `*   **📄 ${item.titulo || "Aviso Oficial"}**\n`;
                        if (item.norma)
                            md += `    *   **Norma:** ${item.norma}\n`;
                        if (item.extracto)
                            md += `    *   **Síntesis:** *${item.extracto}*\n`;
                        md += `    *   **Referencias:** ID \`${item.idAviso}\` | [Texto Completo](${item.urlDetalle}) | [Ver PDF](${item.urlPdf})\n`;
                    });
                    md += `\n`;
                }
                md += `--- \n\n`;
            }
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return {
                content: [{
                        type: "text",
                        text: `Error al obtener el sumario del día: ${error.message}`
                    }],
                isError: true
            };
        }
    });
    // Tool 10: buscar_sociedades_por_tipo
    server.tool("buscar_sociedades_por_tipo", "Buscador especializado en la Segunda Sección (Sociedades) con filtros por tipo de acto societario (constitución, reforma, disolución, convocatoria) y por tipo societario (S.A., S.R.L., S.A.S., cooperativa).", {
        tipoActo: z.enum(["constitucion", "reforma", "disolucion", "convocatoria", "transformacion", "fusion", "escision", "liquidacion", "capital", "directorio"]).optional().describe("Tipo de acto societario a filtrar (ej. 'constitucion', 'reforma', 'disolucion', 'convocatoria', 'fusion', 'liquidacion', 'capital', 'directorio')"),
        tipoSocietario: z.enum(["S.A.", "S.R.L.", "S.A.S.", "cooperativa", "fundacion", "asociacion"]).optional().describe("Tipo de sociedad a buscar (ej. 'S.A.', 'S.R.L.', 'S.A.S.', 'cooperativa')"),
        razonSocial: z.string().optional().describe("Nombre o razón social de la empresa a buscar para auditorías comerciales (ej. 'Mercado Libre')"),
        fechaDesde: stringOrNumberOptional.describe("Fecha de inicio en formato DD/MM/YYYY"),
        fechaHasta: stringOrNumberOptional.describe("Fecha de fin en formato DD/MM/YYYY"),
        pagina: z.number().optional().default(1).describe("Número de página para paginación")
    }, async (args) => {
        try {
            const terminoActo = args.tipoActo || "";
            const terminoSocietario = args.tipoSocietario || "";
            const razonSocial = args.razonSocial || "";
            let criterio = "";
            if (terminoActo) {
                criterio = terminoActo;
            }
            if (terminoSocietario) {
                criterio = criterio ? `${criterio} ${terminoSocietario}` : terminoSocietario;
            }
            if (razonSocial) {
                criterio = criterio ? `${criterio} "${razonSocial}"` : `"${razonSocial}"`;
            }
            if (!criterio) {
                criterio = "sociedad"; // default fallback term
            }
            const results = await buscarAvisos({
                criterio,
                seccion: [2],
                fechaDesde: args.fechaDesde,
                fechaHasta: args.fechaHasta,
                pagina: args.pagina || 1
            });
            if (results.length === 0) {
                return { content: [{ type: "text", text: `No se encontraron avisos societarios con tipo de acto '${args.tipoActo || "todos"}', tipo '${args.tipoSocietario || "todos"}' y razón social '${args.razonSocial || "todas"}' para el período indicado.` }] };
            }
            let md = `# Registro Societario BORA - Auditoría Comercial\n\n`;
            if (args.tipoActo)
                md += `*   **Tipo de Acto:** ${args.tipoActo.toUpperCase()}\n`;
            if (args.tipoSocietario)
                md += `*   **Tipo Societario:** ${args.tipoSocietario}\n`;
            if (args.razonSocial)
                md += `*   **Razón Social:** \`${args.razonSocial}\`\n`;
            if (args.fechaDesde)
                md += `*   **Desde:** ${args.fechaDesde}\n`;
            if (args.fechaHasta)
                md += `*   **Hasta:** ${args.fechaHasta}\n`;
            md += `*   **Resultados:** ${results.length}\n\n---\n\n`;
            results.forEach((r, idx) => {
                md += `### ${idx + 1}. 🏛️ ${r.titulo}\n`;
                if (r.norma)
                    md += `*   **Norma:** ${r.norma}\n`;
                if (r.fechaPublicacion)
                    md += `*   **Fecha Publicación:** ${r.fechaPublicacion}\n`;
                if (r.extracto)
                    md += `*   **Extracto:** *${r.extracto}*\n`;
                md += `*   [Ver Detalle](${r.urlDetalle}) | [PDF](${r.urlPdf})\n\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error en buscar_sociedades_por_tipo: ${error.message}` }], isError: true };
        }
    });
    // Tool 11: buscar_norma_primera_seccion
    server.tool("buscar_norma_primera_seccion", "Búsqueda directa en la Primera Sección (Legislación y Avisos Oficiales) por número y/o año de norma (decretos, resoluciones, leyes) sin pasos intermedios.", {
        nroNorma: stringOrNumberOptional.describe("Número de la norma a buscar (ej. '27430' para Ley 27430)"),
        anioNorma: stringOrNumberOptional.describe("Año de la norma (ej. '2024')"),
        tipoNorma: z.enum(["ley", "decreto", "resolucion", "disposicion"]).optional().describe("Tipo de norma a restringir la búsqueda (ley, decreto, resolucion, disposicion)"),
        organismo: z.string().optional().describe("Organismo emisor de la norma (ej. 'AFIP', 'Ministerio de Economia')"),
        materia: z.string().optional().describe("Materia jurídica o tema legal a buscar (ej. 'impuestos', 'aduanas')"),
        criterio: z.string().optional().describe("Texto libre adicional de búsqueda"),
        fechaDesde: stringOrNumberOptional.describe("Fecha de inicio en formato DD/MM/YYYY"),
        fechaHasta: stringOrNumberOptional.describe("Fecha de fin en formato DD/MM/YYYY"),
        pagina: z.number().optional().default(1).describe("Número de página")
    }, async (args) => {
        try {
            const results = await buscarAvisos({
                criterio: args.criterio || "",
                seccion: [1],
                nroNorma: args.nroNorma,
                anioNorma: args.anioNorma,
                tipoNorma: args.tipoNorma,
                organismo: args.organismo,
                materia: args.materia,
                fechaDesde: args.fechaDesde,
                fechaHasta: args.fechaHasta,
                pagina: args.pagina || 1
            });
            if (results.length === 0) {
                return { content: [{ type: "text", text: `No se encontró la norma${args.nroNorma ? ` N° ${args.nroNorma}` : ""}${args.anioNorma ? `/año ${args.anioNorma}` : ""} con los filtros indicados en la Primera Sección.` }] };
            }
            let md = `# Primera Sección BORA - Normas y Leyes\n\n`;
            if (args.nroNorma)
                md += `*   **Número de Norma:** ${args.nroNorma}\n`;
            if (args.anioNorma)
                md += `*   **Año:** ${args.anioNorma}\n`;
            if (args.tipoNorma)
                md += `*   **Tipo de Norma:** ${args.tipoNorma.toUpperCase()}\n`;
            if (args.organismo)
                md += `*   **Organismo Emisor:** \`${args.organismo}\`\n`;
            if (args.materia)
                md += `*   **Materia / Tema:** \`${args.materia}\`\n`;
            md += `*   **Resultados:** ${results.length}\n\n---\n\n`;
            results.forEach((r, idx) => {
                md += `### ${idx + 1}. 📜 ${r.titulo}\n`;
                if (r.norma)
                    md += `*   **Norma:** ${r.norma}\n`;
                if (r.fechaPublicacion)
                    md += `*   **Fecha Publicación:** ${r.fechaPublicacion}\n`;
                if (r.extracto)
                    md += `*   **Extracto:** *${r.extracto}*\n`;
                md += `*   [Ver Texto Completo](${r.urlDetalle}) | [PDF Oficial](${r.urlPdf})\n\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error en buscar_norma_primera_seccion: ${error.message}` }], isError: true };
        }
    });
    // Tool 12: buscar_avisos_judiciales
    server.tool("buscar_avisos_judiciales", "Buscador especializado en avisos judiciales de la Segunda Sección: edictos, inhibiciones, declaratorias de herederos, procesos sucesorios y litigios.", {
        tipoAviso: z.enum(["sucesion", "edicto", "declaratoria", "inhibicion", "quiebra", "concurso", "remate"]).optional().describe("Tipo de aviso o trámite judicial a buscar (ej. 'sucesion', 'declaratoria', 'inhibicion')"),
        criterio: z.string().optional().describe("Término de búsqueda o autos / apellido a buscar (ej. 'Gomez', 'Lopez')"),
        fechaDesde: stringOrNumberOptional.describe("Fecha de inicio en formato DD/MM/YYYY"),
        fechaHasta: stringOrNumberOptional.describe("Fecha de fin en formato DD/MM/YYYY"),
        pagina: z.number().optional().default(1).describe("Número de página")
    }, async (args) => {
        try {
            const tipoAviso = args.tipoAviso || "";
            const criterioAdicional = args.criterio || "";
            let queryText = criterioAdicional;
            if (tipoAviso === "sucesion") {
                queryText = queryText ? `"sucesion" ${queryText}` : "sucesion";
            }
            else if (tipoAviso === "declaratoria") {
                queryText = queryText ? `"declaratoria de herederos" ${queryText}` : `"declaratoria de herederos"`;
            }
            else if (tipoAviso === "inhibicion") {
                queryText = queryText ? `"inhibicion general de bienes" ${queryText}` : `"inhibicion general de bienes"`;
            }
            else if (tipoAviso === "edicto") {
                queryText = queryText ? `edicto ${queryText}` : "edicto";
            }
            else if (tipoAviso === "quiebra") {
                queryText = queryText ? `quiebra ${queryText}` : "quiebra";
            }
            else if (tipoAviso === "concurso") {
                queryText = queryText ? `"concurso preventivo" ${queryText}` : `"concurso preventivo"`;
            }
            else if (tipoAviso === "remate") {
                queryText = queryText ? `remate ${queryText}` : "remate";
            }
            if (!queryText) {
                queryText = "judicial"; // fallback
            }
            const results = await buscarAvisos({
                criterio: queryText,
                seccion: [2],
                fechaDesde: args.fechaDesde,
                fechaHasta: args.fechaHasta,
                pagina: args.pagina || 1
            });
            if (results.length === 0) {
                return { content: [{ type: "text", text: `No se encontraron avisos judiciales para la búsqueda judicial '${queryText}'.` }] };
            }
            let md = `# Avisos Judiciales BORA - Segunda Sección\n\n`;
            if (args.tipoAviso)
                md += `*   **Tipo de Aviso:** ${args.tipoAviso.toUpperCase()}\n`;
            md += `*   **Búsqueda Completa:** \`${queryText}\`\n`;
            if (args.fechaDesde)
                md += `*   **Desde:** ${args.fechaDesde}\n`;
            if (args.fechaHasta)
                md += `*   **Hasta:** ${args.fechaHasta}\n`;
            md += `*   **Resultados:** ${results.length}\n\n---\n\n`;
            results.forEach((r, idx) => {
                md += `### ${idx + 1}. ⚖️ ${r.titulo}\n`;
                if (r.norma)
                    md += `*   **Referencia:** ${r.norma}\n`;
                if (r.fechaPublicacion)
                    md += `*   **Fecha Publicación:** ${r.fechaPublicacion}\n`;
                if (r.extracto)
                    md += `*   **Extracto:** *${r.extracto}*\n`;
                md += `*   [Ver Edicto Completo](${r.urlDetalle}) | [PDF](${r.urlPdf})\n\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error en buscar_avisos_judiciales: ${error.message}` }], isError: true };
        }
    });
    // Tool 13: buscar_marcas_patentes
    server.tool("buscar_marcas_patentes", "Buscador especializado en la Cuarta Sección (Marcas y Patentes): marcas comerciales, patentes de invención, modelos y diseños industriales.", {
        criterio: z.string().describe("Nombre de marca, titular o clase a buscar (ej. 'marca mixta', 'patente invencion', nombre de empresa)"),
        fechaDesde: stringOrNumberOptional.describe("Fecha de inicio en formato DD/MM/YYYY"),
        fechaHasta: stringOrNumberOptional.describe("Fecha de fin en formato DD/MM/YYYY"),
        pagina: z.number().optional().default(1).describe("Número de página")
    }, async (args) => {
        try {
            let sumario = { items: [], fecha: getArgentinaTodayString(), url: "" };
            let dateObj = new Date();
            // Loop back up to 15 days to find the most recent day with publications in the Cuarta Sección (e.g. skipping weekends/holidays)
            for (let i = 0; i < 15; i++) {
                const yyyy = dateObj.getFullYear();
                const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                const dd = String(dateObj.getDate()).padStart(2, '0');
                const fechaStr = `${yyyy}${mm}${dd}`;
                try {
                    const tempSumario = await obtenerSumarioSeccion({ seccion: "cuarta", fecha: fechaStr });
                    if (tempSumario && tempSumario.items && tempSumario.items.length > 0) {
                        sumario = tempSumario;
                        break;
                    }
                }
                catch (e) {
                    // Ignore error and try the previous day
                }
                dateObj.setDate(dateObj.getDate() - 1);
            }
            // 1. First, search for matched domains in recent NIC registrations sumario
            let matchedItems = sumario.items.filter((item) => item.titulo.toLowerCase().includes(args.criterio.toLowerCase()) ||
                (item.extracto && item.extracto.toLowerCase().includes(args.criterio.toLowerCase())));
            // 2. If no direct sumario matches are found, use BORA's advanced search targeting Section 4 notices
            if (matchedItems.length === 0) {
                try {
                    // FIX: La API de BORA solo acepta secciones [1, 2, 3].
                    // La sección 4 (marcas/NIC) no está disponible en el endpoint de búsqueda avanzada.
                    // Se busca en todas las secciones disponibles como fallback.
                    const results = await buscarAvisos({
                        criterio: args.criterio,
                        seccion: [1, 2, 3],
                        fechaDesde: args.fechaDesde,
                        fechaHasta: args.fechaHasta,
                        pagina: args.pagina || 1
                    });
                    if (results && results.length > 0) {
                        matchedItems = results.map((r) => ({
                            rubro: "Registro de Marcas y Patentes",
                            seccion: "cuarta",
                            idAviso: r.idAviso,
                            fecha: r.fecha,
                            titulo: r.titulo,
                            norma: r.norma,
                            extracto: r.extracto,
                            urlDetalle: r.urlDetalle,
                            urlPdf: r.urlPdf
                        }));
                    }
                }
                catch (searchErr) {
                    // Log search error silently and proceed
                }
            }
            if (matchedItems.length === 0) {
                return { content: [{ type: "text", text: `No se encontraron registros de marcas, patentes o dominios para '${args.criterio}' en la Cuarta Sección.` }] };
            }
            let md = `# Marcas y Patentes BORA - Cuarta Sección (Propiedad Industrial)\n\n`;
            md += `*   **Búsqueda:** ${args.criterio}\n`;
            md += `*   **Resultados:** ${matchedItems.length}\n\n---\n\n`;
            matchedItems.forEach((r, idx) => {
                md += `### ${idx + 1}. ™️ ${r.titulo}\n`;
                if (r.norma)
                    md += `*   **Referencia:** ${r.norma}\n`;
                const rFecha = r.fecha || sumario.fecha;
                const fechaFormatted = rFecha ? `${rFecha.substring(6, 8)}/${rFecha.substring(4, 6)}/${rFecha.substring(0, 4)}` : "N/A";
                md += `*   **Fecha:** ${fechaFormatted}\n`;
                if (r.extracto)
                    md += `*   **Descripción:** *${r.extracto}*\n`;
                md += `*   [Ver Detalle](${r.urlDetalle}) | [PDF](${r.urlPdf})\n\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error en buscar_marcas_patentes: ${error.message}` }], isError: true };
        }
    });
    // Tool 14: rastrear_vigencia_norma
    server.tool("rastrear_vigencia_norma", "Rastrea cronológicamente una norma en el BORA para detectar si fue modificada, reglamentada, suspendida o derogada por publicaciones posteriores.", {
        nroNorma: stringOrNumber.describe("Número de la norma a rastrear (ej. '27430')"),
        anioNorma: stringOrNumberOptional.describe("Año de la norma original (ej. '2017')"),
        fechaDesde: stringOrNumberOptional.describe("Inicio del período de rastreo en DD/MM/YYYY (ej. fecha de sanción original)"),
        fechaHasta: stringOrNumberOptional.describe("Fin del período de rastreo en DD/MM/YYYY. Si se omite, se busca hasta hoy.")
    }, async (args) => {
        try {
            // Search for the original norm and all subsequent modifications
            // Both queries use the norm number as text criterio (required by BORA API)
            const [original, modificaciones] = await Promise.all([
                buscarAvisos({ criterio: args.nroNorma, seccion: [1], nroNorma: args.nroNorma, anioNorma: args.anioNorma, pagina: 1 }),
                buscarAvisos({ criterio: args.nroNorma, seccion: [1], fechaDesde: args.fechaDesde, fechaHasta: args.fechaHasta, pagina: 1 })
            ]);
            const todos = [...original, ...modificaciones].filter((item, idx, self) => idx === self.findIndex(t => t.idAviso === item.idAviso)).sort((a, b) => a.fecha.localeCompare(b.fecha));
            if (todos.length === 0) {
                return { content: [{ type: "text", text: `No se encontró la norma N° ${args.nroNorma}${args.anioNorma ? `/${args.anioNorma}` : ""} ni referencias posteriores en el BORA.` }] };
            }
            let md = `# Rastreo de Vigencia - Norma N° ${args.nroNorma}${args.anioNorma ? `/${args.anioNorma}` : ""}\n\n`;
            md += `*   **Publicaciones encontradas en el BORA:** ${todos.length}\n`;
            md += `*   **Período consultado:** ${args.fechaDesde || "inicio"} → ${args.fechaHasta || "hoy"}\n\n`;
            md += `> ⚠️ **Nota metodológica:** Este rastreo identifica publicaciones que citan el número de norma. Para determinar derogación o vigencia definitiva, se recomienda verificar el texto de cada publicación mediante \`obtener_detalle_aviso\`.\n\n---\n\n`;
            md += `## Línea de Tiempo Cronológica\n\n`;
            todos.forEach((r, idx) => {
                const fechaFormatted = r.fecha ? `${r.fecha.substring(6, 8)}/${r.fecha.substring(4, 6)}/${r.fecha.substring(0, 4)}` : "N/A";
                // Automatic Modification/Regulation/Derogation Detection
                let statusLabel = "";
                const textToScan = `${r.titulo} ${r.norma} ${r.extracto}`.toLowerCase();
                if (textToScan.includes("deroga") || textToScan.includes("derogacion") || textToScan.includes("derógase") || textToScan.includes("abroga")) {
                    statusLabel = " 🔴 **[DEROGACIÓN POSIBLE]**";
                }
                else if (textToScan.includes("modifica") || textToScan.includes("sustituyese") || textToScan.includes("sustitúyese") || textToScan.includes("incorporase") || textToScan.includes("incorpórase") || textToScan.includes("reforma")) {
                    statusLabel = " 🟡 **[MODIFICACIÓN DETECTADA]**";
                }
                else if (textToScan.includes("reglamenta") || textToScan.includes("aprueba el reglamento") || textToScan.includes("decreto reglamentario")) {
                    statusLabel = " 🟢 **[REGLAMENTACIÓN DETECTADA]**";
                }
                else if (textToScan.includes("prorroga") || textToScan.includes("prorrógase") || textToScan.includes("extiendese") || textToScan.includes("extiéndese")) {
                    statusLabel = " 🔵 **[PRÓRROGA DETECTADA]**";
                }
                else if (textToScan.includes("suspende") || textToScan.includes("suspéndese")) {
                    statusLabel = " 🟠 **[SUSPENSIÓN DETECTADA]**";
                }
                md += `### ${idx + 1}. 📅 ${fechaFormatted} — ${r.titulo}${statusLabel}\n`;
                if (r.norma)
                    md += `*   **Tipo de Acto:** ${r.norma}\n`;
                if (r.extracto)
                    md += `*   **Extracto:** *${r.extracto}*\n`;
                md += `*   [Ver Texto Completo](${r.urlDetalle}) | [PDF Oficial](${r.urlPdf})\n\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error en rastrear_vigencia_norma: ${error.message}` }], isError: true };
        }
    });
}
// Initialize the local server instance
export const server = new McpServer({
    name: "bora-mcp",
    version: "1.0.0"
});
// Register tools
registerAllTools(server);
export function registerAllPrompts(server) {
    // Prompt 1: buscar_avisos
    server.prompt("buscar_avisos", "Búsqueda avanzada y parametrizada en todo el Boletín Oficial (Secciones Primera, Segunda y Tercera).", {
        criterio: z.string().optional().describe("Término legal o palabra clave (ej. 'impuesto cedular')"),
        fechaDesde: stringOrNumberOptional.describe("Fecha de inicio (ej. '01/01/2026')"),
        fechaHasta: stringOrNumberOptional.describe("Fecha de fin (ej. '19/05/2026')")
    }, (args) => {
        const criterio = args.criterio || "impuesto cedular";
        const desde = args.fechaDesde || "01/01/2026";
        const hasta = args.fechaHasta || "19/05/2026";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Buscá en el Boletín Oficial todas las publicaciones vinculadas a '${criterio}' en la sección de legislación y en la de sociedades, que se hayan publicado entre el ${desde} y el ${hasta}.`
                    }
                }
            ]
        };
    });
    // Prompt 2: obtener_detalle_aviso
    server.prompt("obtener_detalle_aviso", "Recupera con total fidelidad verbatim el texto completo y metadatos de una norma o aviso.", {
        seccion: z.string().optional().describe("Sección del aviso (ej. 'segunda')"),
        idAviso: stringOrNumberOptional.describe("ID único del aviso (ej. '296831')"),
        fecha: stringOrNumberOptional.describe("Fecha en lenguaje natural o formato DD/MM/YYYY o YYYYMMDD (ej. '15 de febrero de 2026')")
    }, (args) => {
        const sec = args.seccion || "segunda";
        const id = args.idAviso || "296831";
        const f = args.fecha || "15 de febrero de 2026";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Traeme el texto completo y fiel del aviso societario con ID ${id} de la ${sec} sección publicado el ${f}.`
                    }
                }
            ]
        };
    });
    // Prompt 3: obtener_sumario_seccion
    server.prompt("obtener_sumario_seccion", "Descarga el sumario jerárquico de avisos publicados en una sección específica para un día dado.", {
        seccion: z.string().optional().describe("Sección a consultar (ej. 'primera')"),
        fecha: stringOrNumberOptional.describe("Fecha en formato DD/MM/YYYY o natural (ej. '5 de marzo de 2026')")
    }, (args) => {
        const sec = args.seccion || "primera";
        const f = args.fecha || "5 de marzo de 2026";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Mostrame el sumario de la ${sec} sección (Legislación) del día ${f}.`
                    }
                }
            ]
        };
    });
    // Prompt 4: obtener_enlace_pdf
    server.prompt("obtener_enlace_pdf", "Genera el enlace directo al visor del PDF firmado digitalmente con total validez formal probatoria.", {
        seccion: z.string().optional().describe("Sección del aviso (ej. 'primera')"),
        idAviso: stringOrNumberOptional.describe("ID del aviso (ej. '176831')"),
        fecha: stringOrNumberOptional.describe("Fecha en formato DD/MM/YYYY o YYYYMMDD (ej. '29 de diciembre de 2017')")
    }, (args) => {
        const sec = args.seccion || "primera";
        const id = args.idAviso || "176831";
        const f = args.fecha || "29 de diciembre de 2017";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Dame el link para descargar el PDF oficial firmado del aviso ID ${id} de la ${sec} sección del ${f}.`
                    }
                }
            ]
        };
    });
    // Prompt 5: buscar_nuevas_sociedades
    server.prompt("buscar_nuevas_sociedades", "Buscador corporativo y comercial optimizado para constituciones de firmas en la Sección Segunda.", {
        fechaDesde: stringOrNumberOptional.describe("Fecha de inicio (ej. '01/05/2026')"),
        fechaHasta: stringOrNumberOptional.describe("Fecha de fin (ej. '15/05/2026')")
    }, (args) => {
        const desde = args.fechaDesde || "01/05/2026";
        const hasta = args.fechaHasta || "15/05/2026";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Buscá e identificá las nuevas sociedades que se hayan constituido y publicado en la segunda sección desde el ${desde} hasta el ${hasta}.`
                    }
                }
            ]
        };
    });
    // Prompt 6: buscar_licitaciones_publicas
    server.prompt("buscar_licitaciones_publicas", "Buscador de pliegos, compras, concursos y licitaciones estatales en la Sección Tercera.", {
        criterio: z.string().optional().describe("Criterio o rubro a buscar (ej. 'software')"),
        fechaDesde: stringOrNumberOptional.describe("Fecha de inicio (ej. '01/03/2026')"),
        fechaHasta: stringOrNumberOptional.describe("Fecha de fin (ej. '30/04/2026')")
    }, (args) => {
        const crit = args.criterio || "software";
        const desde = args.fechaDesde || "01/03/2026";
        const hasta = args.fechaHasta || "30/04/2026";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Buscá todas las licitaciones públicas de contratación de '${crit}' publicadas del ${desde} al ${hasta}.`
                    }
                }
            ]
        };
    });
    // Prompt 7: alcance_fuente
    server.prompt("alcance_fuente", "Herramienta de integridad técnica para informar a la IA sobre su alcance legal, disclaimer y estado del conector.", {}, () => {
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: "Antes de analizar este caso, explicame el alcance de tus fuentes de datos y tus disclaimers legales sobre el Boletín Oficial."
                    }
                }
            ]
        };
    });
    // Prompt 8: obtener_portada
    server.prompt("obtener_portada", "Descarga la portada del Boletín Oficial, destacando destaques y PDFs unificados del día de hoy.", {}, () => {
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: "¿Qué se publicó hoy en la portada del Boletín Oficial? Dame los temas destacados y los PDFs."
                    }
                }
            ]
        };
    });
    // Prompt 9: obtener_sumario_del_dia
    server.prompt("obtener_sumario_del_dia", "Scraper unificado y concurrentemente que compila e indexa las cuatro secciones del Boletín Oficial para una fecha dada.", {
        fecha: stringOrNumberOptional.describe("Fecha a consultar (ej. '15 de mayo de 2026')")
    }, (args) => {
        const f = args.fecha || "15 de mayo de 2026";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Compilame todo el sumario completo de las cuatro secciones del Boletín Oficial del día ${f}.`
                    }
                }
            ]
        };
    });
    // Prompt 10: buscar_sociedades_por_tipo
    server.prompt("buscar_sociedades_por_tipo", "Buscador avanzado en la Segunda Sección con filtros cruzados de actos y tipos societarios.", {
        tipoActo: z.string().optional().describe("Tipo de acto (ej. 'reforma')"),
        tipoSocietario: z.string().optional().describe("Tipo societario (ej. 'S.A.')"),
        fechaDesde: stringOrNumberOptional.describe("Fecha de inicio (ej. '01/04/2026')"),
        fechaHasta: stringOrNumberOptional.describe("Fecha de fin (ej. '30/04/2026')")
    }, (args) => {
        const acto = args.tipoActo || "reforma";
        const tipo = args.tipoSocietario || "S.A.";
        const desde = args.fechaDesde || "01/04/2026";
        const hasta = args.fechaHasta || "30/04/2026";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Buscá todas las reformas de estatuto de Sociedades Anónimas (S.A.) publicadas en la sección sociedades durante todo el mes de abril de 2026 (del ${desde} al ${hasta}).`
                    }
                }
            ]
        };
    });
    // Prompt 11: buscar_norma_primera_seccion
    server.prompt("buscar_norma_primera_seccion", "Búsqueda directa y ultra-precisa de decretos, leyes y resoluciones oficiales en la Primera Sección.", {
        nroNorma: stringOrNumberOptional.describe("Número de la norma (ej. '27430')"),
        anioNorma: stringOrNumberOptional.describe("Año de la norma (ej. '2017')")
    }, (args) => {
        const nro = args.nroNorma || "27430";
        const anio = args.anioNorma || "2017";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Buscá la Ley ${nro} sancionada en el año ${anio} en la primera sección de legislación.`
                    }
                }
            ]
        };
    });
    // Prompt 12: buscar_avisos_judiciales
    server.prompt("buscar_avisos_judiciales", "Buscador especializado de edictos, sucesiones, declaratorias de herederos y quiebras en la Segunda Sección.", {
        criterio: z.string().optional().describe("Causante o término (ej. 'Gomez')"),
        fechaDesde: stringOrNumberOptional.describe("Fecha de inicio (ej. '01/04/2026')"),
        fechaHasta: stringOrNumberOptional.describe("Fecha de fin (ej. '30/04/2026')")
    }, (args) => {
        const crit = args.criterio || "Gomez";
        const desde = args.fechaDesde || "01/04/2026";
        const hasta = args.fechaHasta || "30/04/2026";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Buscá edictos o avisos judiciales sucesorios a nombre de '${crit}' que se hayan publicado entre el ${desde} y el ${hasta}.`
                    }
                }
            ]
        };
    });
    // Prompt 13: buscar_marcas_patentes
    server.prompt("buscar_marcas_patentes", "Buscador especializado para la Cuarta Sección (Marcas y Patentes) que procesa actas de marcas y dominios de NIC Argentina.", {
        criterio: z.string().optional().describe("Nombre de marca o dominio a buscar (ej. 'Patagonia')"),
        fechaDesde: stringOrNumberOptional.describe("Fecha de inicio (ej. '01/04/2026')"),
        fechaHasta: stringOrNumberOptional.describe("Fecha de fin (ej. '19/05/2026')")
    }, (args) => {
        const crit = args.criterio || "Patagonia";
        const desde = args.fechaDesde || "01/04/2026";
        const hasta = args.fechaHasta || "19/05/2026";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Buscá registros de marcas o patentes bajo el nombre '${crit}' que se hayan publicado desde el ${desde} hasta el ${hasta}.`
                    }
                }
            ]
        };
    });
    // Prompt 14: rastrear_vigencia_norma
    server.prompt("rastrear_vigencia_norma", "Rastrea referencias cruzadas de una norma en el Boletín Oficial para construir una línea de tiempo de su vigencia y enmiendas.", {
        nroNorma: stringOrNumberOptional.describe("Número de norma a rastrear (ej. '27430')"),
        anioNorma: stringOrNumberOptional.describe("Año original de la norma (ej. '2017')")
    }, (args) => {
        const nro = args.nroNorma || "27430";
        const anio = args.anioNorma || "2017";
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Rastreá la vigencia histórica y enmiendas de la Ley ${nro} sancionada en ${anio}.`
                    }
                }
            ]
        };
    });
}
// Register prompts
registerAllPrompts(server);
// Connect with stdio (only when run directly and not in Vercel/Next environment)
if (typeof process !== "undefined" && !process.env.VERCEL && !process.env.NEXT_RUNTIME) {
    const transport = new StdioServerTransport();
    server.connect(transport).catch((err) => {
        console.error("Server connection failed", err);
        process.exit(1);
    });
    console.error("Boletín Oficial de la República Argentina MCP Server is running via Stdio.");
}
//# sourceMappingURL=bora.js.map