#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pathToFileURL as _pathToFileURL } from "url";
import { ptnPost } from "./ptn-http.js";
import crypto from "crypto";
const PTN_API_URL = "https://api.ptn.gob.ar";
const PTN_WEB_URL = "https://busquedadictamenes.ptn.gob.ar";
const SERVER_VERSION = "1.3.0";
export const stringOrNumberOptional = () => (z
    .union([z.string(), z.number()])
    .transform((val) => String(val))
    .optional());
// Custom Zod validators following common pattern (Trace 8)
export const stringOrNumber = () => (z.union([z.string(), z.number()]).transform((val) => String(val)));
export const dateOptional = z
    .union([z.string(), z.number()])
    .transform((val) => normalizeDateToDDMMYYYY(val))
    .optional();
export const dateISOOptional = z
    .union([z.string(), z.number()])
    .transform((val) => normalizeDateToISO(val))
    .optional();
export const arrayOptional = z.array(z.string()).optional();
export const nonEmptyString = z.string().min(1, "El campo no puede estar vacío");
export const positiveNumber = z.number().positive("Debe ser un número positivo");
export const yearValidator = z
    .union([z.string(), z.number()])
    .transform((val) => {
    const year = Number(val);
    if (year < 1900 || year > 2100) {
        throw new Error("Año debe estar entre 1900 y 2100");
    }
    return year;
});
// Spanish month name mapping for natural language date parsing
const spanishMonthMap = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
    ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5,
    jul: 6, ago: 7, sep: 8, oct: 9, nov: 10, dic: 11
};
/**
 * Parse natural language dates following BORA pattern (Trace 5)
 * Supports: Spanish "15 de febrero de 2026", DD/MM/YYYY, ISO YYYY-MM-DD, compact YYYYMMDD
 */
export function parseNaturalDate(input) {
    const str = String(input).trim();
    if (!str)
        return null;
    // 1. Spanish format: "15 de febrero de 2026" or "15 de feb de 2026"
    const spanishRegex = /^(\d{1,2})\s+de\s+([a-z]+)\s+de(?:l)?\s+(\d{2,4})$/i;
    const matchSpanish = str.match(spanishRegex);
    if (matchSpanish) {
        const day = parseInt(matchSpanish[1], 10);
        const monthName = matchSpanish[2].toLowerCase();
        let year = parseInt(matchSpanish[3], 10);
        // Handle 2-digit years
        if (year < 100) {
            year += year < 50 ? 2000 : 1900;
        }
        const month = spanishMonthMap[monthName];
        if (month !== undefined && day >= 1 && day <= 31) {
            return new Date(year, month, day);
        }
    }
    // 2. DD/MM/YYYY format
    const ddMmYyyyRegex = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/;
    const matchDdMmYyyy = str.match(ddMmYyyyRegex);
    if (matchDdMmYyyy) {
        const day = parseInt(matchDdMmYyyy[1], 10);
        const month = parseInt(matchDdMmYyyy[2], 10) - 1;
        const year = parseInt(matchDdMmYyyy[3], 10);
        if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
            return new Date(year, month, day);
        }
    }
    // 3. ISO format YYYY-MM-DD
    const isoRegex = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/;
    const matchIso = str.match(isoRegex);
    if (matchIso) {
        const year = parseInt(matchIso[1], 10);
        const month = parseInt(matchIso[2], 10) - 1;
        const day = parseInt(matchIso[3], 10);
        if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
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
        if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
            return new Date(year, month, day);
        }
    }
    // 5. Fallback to Date.parse()
    const parsed = Date.parse(str);
    if (!isNaN(parsed)) {
        return new Date(parsed);
    }
    return null;
}
/**
 * Normalize date input to DD/MM/YYYY format (BORA pattern)
 */
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
/**
 * Normalize date input to ISO YYYY-MM-DD format
 */
export function normalizeDateToISO(input) {
    if (!input)
        return "";
    const d = parseNaturalDate(input);
    if (!d)
        return String(input);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${yyyy}-${mm}-${dd}`;
}
export function parseDdMmYyyyToIso(date) {
    const m = date.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m)
        return null;
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}
function isoNMonthsAgo(months) {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}
export function buildSearchQuery(args) {
    const must = [];
    const page = typeof args.pagina === "number" && args.pagina > 0 ? args.pagina : 1;
    const size = typeof args.pageSize === "number" && args.pageSize > 0 ? args.pageSize : 10;
    const from = Math.max(0, (page - 1) * size);
    if (args.criterio) {
        // If soloDoctrina is true, search only in doctrine field (from research insights)
        // This avoids procedural boilerplate and focuses on core legal principles
        if (args.soloDoctrina) {
            must.push({
                query_string: {
                    query: String(args.criterio),
                    fields: ["doctrina", "sintesis"],
                    default_operator: "AND",
                },
            });
        }
        else {
            // Usar multi_match en lugar de query_string para evitar "all shards failed"
            // query_string sin fields intenta buscar en campos numéricos y falla en el índice PTN
            must.push({
                multi_match: {
                    query: String(args.criterio),
                    fields: [
                        "doctrina",
                        "sintesis",
                        "organismo",
                        "voces",
                        "numero",
                        "expediente"
                    ],
                    operator: "and",
                    type: "cross_fields"
                },
            });
        }
    }
    if (args.numero)
        must.push({ match: { numero: String(args.numero) } });
    if (args.tomo)
        must.push({ match: { tomo: String(args.tomo) } });
    if (args.paginaRef)
        must.push({ match: { pagina: String(args.paginaRef) } });
    if (args.expediente)
        must.push({ match: { expediente: String(args.expediente) } });
    const organismo = args.organismo ?? args.dependencia;
    if (organismo)
        must.push({ match: { organismo: String(organismo) } });
    const voz = args.voz ?? args.materia;
    if (voz)
        must.push({ match: { voces: String(voz) } });
    if (args.ley) {
        must.push({
            query_string: {
                query: String(args.ley),
                fields: ["leyes", "array_leyes"],
            },
        });
    }
    if (args.anio) {
        must.push({
            range: {
                fecha: {
                    gte: `${args.anio}-01-01`,
                    lte: `${args.anio}-12-31`,
                },
            },
        });
    }
    const desde = args.fechaDesde ? normalizeDateToISO(String(args.fechaDesde)) : null;
    const hasta = args.fechaHasta ? normalizeDateToISO(String(args.fechaHasta)) : null;
    if (desde || hasta) {
        const range = {};
        if (desde)
            range.gte = desde;
        if (hasta)
            range.lte = hasta;
        must.push({ range: { fecha: range } });
    }
    const query = must.length === 0
        ? { match_all: {} }
        : must.length === 1
            ? must[0]
            : { bool: { must } };
    return { size, from, query };
}
export function assertNoElasticsearchError(data, context) {
    if (!data || typeof data !== "object")
        return;
    const err = data.error;
    if (!err)
        return;
    const reason = err.reason || err.type || "consulta invalida";
    throw new Error(`PTN API (${context}): ${reason}`);
}
export async function ptnSearch(body, historico = false) {
    const data = await ptnPost(`${PTN_API_URL}/search`, body, { params: { historico } });
    assertNoElasticsearchError(data, "search");
    return data;
}
export async function ptnSearchNews(size = 10) {
    const data = await ptnPost(`${PTN_API_URL}/search_news`, {
        size,
        query: { match_all: {} },
        sort: [{ fecha: { order: "desc" } }],
    });
    assertNoElasticsearchError(data, "search_news");
    return data;
}
export async function ptnAggregate(field, size, baseQuery) {
    const body = {
        size: 0,
        query: baseQuery ?? { match_all: {} },
        aggs: {
            facet: {
                terms: { field, size: Math.min(Math.max(size, 1), 200) },
            },
        },
    };
    const data = await ptnSearch(body);
    const buckets = data.aggregations?.facet?.buckets;
    return Array.isArray(buckets) ? buckets : [];
}
export function extractTextFromHit(hit) {
    const src = hit._source || {};
    const attachments = src.attachments || [];
    const parts = attachments
        .map((a) => a.attachment?.content)
        .filter((c) => Boolean(c && c.trim()));
    return parts.join("\n\n---\n\n");
}
export function formatHitSummary(hit) {
    const src = hit._source || {};
    const id = hit._id || "";
    const sintesis = extractTextFromHit(hit).slice(0, 400).replace(/\s+/g, " ").trim();
    return {
        id,
        numero: src.numero,
        fecha: src.fecha,
        tomo: src.tomo,
        pagina: src.pagina,
        expediente: src.expediente,
        organismo: src.organismo,
        voces: src.voces,
        leyes: src.leyes || src.array_leyes,
        sintesis,
    };
}
export async function buscarDictamenes(args) {
    const body = buildSearchQuery(args);
    const data = await ptnSearch(body, Boolean(args.historico));
    const hits = data?.hits?.hits || [];
    return {
        total: data?.hits?.total?.value ?? hits.length,
        page: args.pagina ?? 1,
        pageSize: args.pageSize ?? 10,
        data: hits.map(formatHitSummary),
    };
}
export async function obtenerDictamenTexto(args) {
    const data = await ptnSearch({
        size: 1,
        query: { ids: { values: [args.idDictamen] } },
    });
    const hit = data?.hits?.hits?.[0];
    if (!hit) {
        return { id: args.idDictamen, texto: "Dictamen no encontrado.", error: "NOT_FOUND" };
    }
    const src = hit._source || {};
    return {
        id: hit._id,
        numero: src.numero,
        fecha: src.fecha,
        tomo: src.tomo,
        pagina: src.pagina,
        expediente: src.expediente,
        organismo: src.organismo,
        voces: src.voces,
        leyes: src.leyes || src.array_leyes,
        texto: extractTextFromHit(hit) || "Texto no disponible en la respuesta de la API.",
    };
}
export async function obtenerNovedades(opts = {}) {
    const size = Math.min(Math.max(opts.cantidad ?? 10, 1), 50);
    const data = await ptnSearchNews(size);
    const hits = (data?.hits?.hits || []);
    let filtered = hits;
    if (opts.organismo) {
        const needle = opts.organismo.toLowerCase();
        filtered = filtered.filter((h) => String((h._source ?? {}).organismo ?? "").toLowerCase().includes(needle));
    }
    if (opts.voz) {
        const needle = opts.voz.toLowerCase();
        filtered = filtered.filter((h) => String((h._source ?? {}).voces ?? "").toLowerCase().includes(needle));
    }
    return {
        total: data?.hits?.total?.value ?? hits.length,
        filtrados: filtered.length,
        data: filtered.map(formatHitSummary),
    };
}
function renderResultsMarkdown(title, results) {
    let md = `# ${title}\n\n`;
    md += `**Total estimado:** ${results.total}\n\n`;
    if (results.data.length === 0) {
        return md + "No se encontraron dictamenes.";
    }
    results.data.forEach((r, idx) => {
        md += `### ${idx + 1}. Dictamen ${r.numero || "N/A"}\n`;
        md += `*   **ID:** \`${r.id}\`\n`;
        if (r.fecha)
            md += `*   **Fecha:** ${r.fecha}\n`;
        if (r.tomo)
            md += `*   **Tomo/Pagina:** ${r.tomo}${r.pagina ? ` / ${r.pagina}` : ""}\n`;
        if (r.organismo)
            md += `*   **Organismo:** ${r.organismo}\n`;
        if (r.voces)
            md += `*   **Voces:** ${r.voces}\n`;
        if (r.leyes)
            md += `*   **Leyes:** ${JSON.stringify(r.leyes)}\n`;
        if (r.expediente)
            md += `*   **Expediente:** ${r.expediente}\n`;
        if (r.sintesis)
            md += `*   **Extracto:** ${r.sintesis}...\n`;
        md += `*   **Enlace:** [Ver en PTN](${PTN_WEB_URL}/dictamen/${r.id})\n\n`;
    });
    return md;
}
function errorContent(prefix, error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
        content: [{ type: "text", text: `${prefix}: ${message}` }],
        isError: true,
    };
}
export function registerAllTools(server) {
    server.tool("buscar_dictamenes", "Busqueda AVANZADA en la base oficial de la Procuracion del Tesoro de la Nacion. Aceptara texto libre y/o varios filtros combinados (organismo, voz, ley, tomo/pagina, fechas, expediente). Usar cuando ya se combinan multiples criterios; para busquedas por un solo eje preferir las tools especializadas (buscar_por_organismo / buscar_por_voz / buscar_por_ley / localizar_por_cita).", {
        criterio: z.string().optional().describe("Texto libre, frase exacta o concepto juridico"),
        numero: stringOrNumberOptional().describe("Numero del dictamen"),
        anio: stringOrNumberOptional().describe("Anio del dictamen (filtro por fecha)"),
        tomo: stringOrNumberOptional().describe("Tomo de publicacion (ej. '251')"),
        paginaRef: stringOrNumberOptional().describe("Pagina dentro del tomo (ej. '787')"),
        ley: z.string().optional().describe("Ley mencionada (ej. '24156' o 'Ley 26076')"),
        fechaDesde: z.string().optional().describe("Fecha desde (DD/MM/YYYY)"),
        fechaHasta: z.string().optional().describe("Fecha hasta (DD/MM/YYYY)"),
        materia: z.string().optional().describe("Materia o voz tematica (ej. 'designacion', 'contratacion')"),
        expediente: z.string().optional().describe("Numero de expediente"),
        dependencia: z.string().optional().describe("Organismo dependiente (AFIP, ANSES, CONICET, etc.)"),
        historico: z.boolean().optional().describe("Incluir indice historico ademas del vigente"),
        pagina: z.number().optional().default(1).describe("Pagina de resultados (10 por pagina)"),
    }, async (args) => {
        try {
            const results = await buscarDictamenes(args);
            return {
                content: [
                    {
                        type: "text",
                        text: renderResultsMarkdown("Procuracion del Tesoro de la Nacion - Resultados", results),
                    },
                ],
            };
        }
        catch (error) {
            return errorContent("Error al consultar PTN", error);
        }
    });
    // Tool: buscar_por_doctrina
    server.tool("buscar_por_doctrina", "Busca dictámenes restringiendo la búsqueda al campo 'doctrina' (resumen de principios legales) en lugar del texto completo. Evita ruido de boilerplate procedimental. Basado en insights del portal PTN (campo 'Tema / Palabras en la doctrina').", {
        criterio: z.string().describe("Concepto legal o termino a buscar en la doctrina"),
        organismo: z.string().optional().describe("Organismo opcional para acotar"),
        voz: z.string().optional().describe("Voz tematica opcional para acotar"),
        anio: stringOrNumberOptional().describe("Año opcional para acotar"),
        pagina: z.number().optional().default(1).describe("Pagina (10 por pagina)"),
    }, async (args) => {
        try {
            const results = await buscarDictamenes({
                criterio: args.criterio,
                organismo: args.organismo,
                voz: args.voz,
                anio: args.anio,
                pagina: args.pagina,
                soloDoctrina: true, // Search only in doctrine field
            });
            return {
                content: [
                    {
                        type: "text",
                        text: renderResultsMarkdown("Búsqueda en Doctrina (resumen de principios legales)", results),
                    },
                ],
            };
        }
        catch (error) {
            return errorContent("Error en búsqueda por doctrina", error);
        }
    });
    server.tool("buscar_por_organismo", "Busca dictamenes filtrando por ORGANISMO solicitante (AFIP, ANSES, CONICET, Ministerio X, etc.). Es la forma mas directa de responder 'que dictamenes hay del organismo X?'. Acepta texto opcional para acotar dentro del organismo.", {
        organismo: z.string().describe("Nombre o fragmento del organismo (ej. 'CONICET', 'Ministerio de Economia', 'AFIP')"),
        criterio: z.string().optional().describe("Texto opcional para acotar dentro del organismo"),
        anio: stringOrNumberOptional().describe("Anio del dictamen"),
        fechaDesde: z.string().optional().describe("Fecha desde (DD/MM/YYYY)"),
        fechaHasta: z.string().optional().describe("Fecha hasta (DD/MM/YYYY)"),
        pagina: z.number().optional().default(1).describe("Pagina (10 por pagina)"),
    }, async (args) => {
        try {
            const results = await buscarDictamenes({
                organismo: args.organismo,
                criterio: args.criterio,
                anio: args.anio,
                fechaDesde: args.fechaDesde,
                fechaHasta: args.fechaHasta,
                pagina: args.pagina,
            });
            return {
                content: [
                    {
                        type: "text",
                        text: renderResultsMarkdown(`Dictamenes del organismo: ${args.organismo}`, results),
                    },
                ],
            };
        }
        catch (error) {
            return errorContent("Error al buscar por organismo", error);
        }
    });
    server.tool("buscar_por_voz", "Busca dictamenes filtrando por VOZ TEMATICA / materia (ej. 'designacion transitoria', 'apoderamiento', 'contratacion', 'subsecretaria legal'). Es el filtro tematico equivalente a la columna 'Voces' del portal.", {
        voz: z.string().describe("Voz tematica o materia (ej. 'designacion', 'apoderamiento', 'contratacion')"),
        criterio: z.string().optional().describe("Texto opcional para acotar dentro de la voz"),
        organismo: z.string().optional().describe("Acotar tambien por organismo (opcional)"),
        anio: stringOrNumberOptional().describe("Anio del dictamen"),
        pagina: z.number().optional().default(1).describe("Pagina (10 por pagina)"),
    }, async (args) => {
        try {
            const results = await buscarDictamenes({
                voz: args.voz,
                criterio: args.criterio,
                organismo: args.organismo,
                anio: args.anio,
                pagina: args.pagina,
            });
            return {
                content: [
                    {
                        type: "text",
                        text: renderResultsMarkdown(`Dictamenes por voz tematica: ${args.voz}`, results),
                    },
                ],
            };
        }
        catch (error) {
            return errorContent("Error al buscar por voz", error);
        }
    });
    server.tool("buscar_por_ley", "Busca dictamenes que CITEN UNA LEY especifica. Usar cuando la pregunta es 'que dijo la PTN sobre la Ley NNNNN?'. Acepta solo el numero (ej. '24156') o el formato 'Ley 26076'.", {
        ley: z.string().describe("Numero o referencia de la ley (ej. '24156', 'Ley 26076')"),
        criterio: z.string().optional().describe("Texto adicional para acotar"),
        organismo: z.string().optional().describe("Acotar por organismo"),
        anio: stringOrNumberOptional().describe("Acotar por anio"),
        pagina: z.number().optional().default(1).describe("Pagina (10 por pagina)"),
    }, async (args) => {
        try {
            const results = await buscarDictamenes({
                ley: args.ley,
                criterio: args.criterio,
                organismo: args.organismo,
                anio: args.anio,
                pagina: args.pagina,
            });
            return {
                content: [
                    {
                        type: "text",
                        text: renderResultsMarkdown(`Dictamenes que citan la ley: ${args.ley}`, results),
                    },
                ],
            };
        }
        catch (error) {
            return errorContent("Error al buscar por ley", error);
        }
    });
    server.tool("localizar_por_cita", "Localiza un dictamen por su CITA bibliografica clasica (Tomo + Pagina, o No de dictamen + Anio). Es el equivalente al formulario de 'Busqueda Avanzada' del portal cuando el usuario ya conoce la cita (ej. 'Tomo 251 Pagina 787' o 'Dictamen 142 de 2026').", {
        tomo: stringOrNumberOptional().describe("Tomo (ej. '251', '336')"),
        paginaRef: stringOrNumberOptional().describe("Pagina dentro del tomo (ej. '787', '142')"),
        numero: stringOrNumberOptional().describe("Numero del dictamen"),
        anio: stringOrNumberOptional().describe("Anio del dictamen (acompana al numero)"),
    }, async (args) => {
        try {
            if (!args.tomo && !args.paginaRef && !args.numero && !args.anio) {
                throw new Error("Provea al menos uno: tomo, paginaRef, numero o anio.");
            }
            const results = await buscarDictamenes({
                tomo: args.tomo,
                paginaRef: args.paginaRef,
                numero: args.numero,
                anio: args.anio,
                pageSize: 5,
            });
            return {
                content: [
                    {
                        type: "text",
                        text: renderResultsMarkdown("Localizacion por cita", results),
                    },
                ],
            };
        }
        catch (error) {
            return errorContent("Error en localizacion por cita", error);
        }
    });
    // Tool: localizar_dictamen_automatico
    server.tool("localizar_dictamen_automatico", "Localiza automáticamente un dictamen con información parcial (NormativaPBA pattern: auto-resolution). Permite buscar por combinación de numero, anio, organismo, o voz y devuelve el dictamen más probable. Útil cuando el usuario no tiene el ID exacto.", {
        numero: stringOrNumberOptional().describe("Numero del dictamen (opcional)"),
        anio: stringOrNumberOptional().describe("Anio del dictamen (opcional)"),
        organismo: z.string().optional().describe("Organismo (opcional)"),
        voz: z.string().optional().describe("Voz tematica (opcional)"),
        expediente: z.string().optional().describe("Expediente (opcional)"),
        criterio: z.string().optional().describe("Criterio de texto libre (opcional)"),
    }, async (args) => {
        try {
            // Auto-resolution: at least one parameter must be provided (NormativaPBA pattern Trace 6a)
            if (!args.numero && !args.anio && !args.organismo && !args.voz && !args.expediente && !args.criterio) {
                throw new Error("Debe proporcionar al menos un criterio de búsqueda (numero, anio, organismo, voz, expediente o criterio)");
            }
            // Build search query from partial information (NormativaPBA pattern Trace 6b)
            const searchResults = await buscarDictamenes({
                numero: args.numero,
                anio: args.anio,
                organismo: args.organismo,
                voz: args.voz,
                expediente: args.expediente,
                criterio: args.criterio,
                pageSize: 10,
                pagina: 1,
            });
            let md = `# Localización Automática de Dictamen\n\n`;
            md += `**Criterios de búsqueda:**\n`;
            if (args.numero)
                md += `- Número: ${args.numero}\n`;
            if (args.anio)
                md += `- Año: ${args.anio}\n`;
            if (args.organismo)
                md += `- Organismo: ${args.organismo}\n`;
            if (args.voz)
                md += `- Voz: ${args.voz}\n`;
            if (args.expediente)
                md += `- Expediente: ${args.expediente}\n`;
            if (args.criterio)
                md += `- Criterio: ${args.criterio}\n`;
            md += `\n`;
            if (searchResults.total === 0) {
                md += `❌ No se encontraron dictámenes con los criterios proporcionados.\n`;
                md += `**Sugerencias:**\n`;
                md += `- Verifique la ortografía de los organismos y voces\n`;
                md += `- Intente con menos criterios de búsqueda\n`;
                md += `- Use \`listar_organismos\` o \`listar_voces\` para descubrir valores exactos\n`;
                return { content: [{ type: "text", text: md }] };
            }
            md += `**Total encontrado:** ${searchResults.total}\n\n`;
            // Auto-resolution: if exact match found (single result), provide direct link to text
            if (searchResults.total === 1 && searchResults.data.length === 1) {
                const match = searchResults.data[0];
                md += `✅ **Coincidencia única encontrada**\n\n`;
                md += `### Dictamen Resuelto\n`;
                md += `*   **ID:** \`${match.id}\`\n`;
                md += `*   **Número:** ${match.numero || "N/A"}\n`;
                if (match.fecha)
                    md += `*   **Fecha:** ${match.fecha}\n`;
                if (match.organismo)
                    md += `*   **Organismo:** ${match.organismo}\n`;
                if (match.voces)
                    md += `*   **Voces:** ${match.voces}\n`;
                if (match.expediente)
                    md += `*   **Expediente:** ${match.expediente}\n`;
                if (match.sintesis)
                    md += `*   **Extracto:** ${match.sintesis}...\n`;
                md += `*   **Enlace:** [Ver en PTN](${PTN_WEB_URL}/dictamen/${match.id})\n\n`;
                md += `> **Acción recomendada:** Use \`obtener_dictamen_texto\` con ID \`${match.id}\` para obtener el texto completo.\n`;
            }
            else {
                // Multiple results: show all for user to choose
                md += `⚠️ **Múltiples coincidencias encontradas**\n\n`;
                md += `Por favor revise los resultados y seleccione el dictamen correcto:\n\n`;
                searchResults.data.forEach((r, idx) => {
                    md += `### ${idx + 1}. Dictamen ${r.numero || "N/A"}\n`;
                    md += `*   **ID:** \`${r.id}\`\n`;
                    if (r.fecha)
                        md += `*   **Fecha:** ${r.fecha}\n`;
                    if (r.organismo)
                        md += `*   **Organismo:** ${r.organismo}\n`;
                    if (r.voces)
                        md += `*   **Voces:** ${r.voces}\n`;
                    if (r.expediente)
                        md += `*   **Expediente:** ${r.expediente}\n`;
                    if (r.sintesis)
                        md += `*   **Extracto:** ${r.sintesis}...\n`;
                    md += `*   **Enlace:** [Ver en PTN](${PTN_WEB_URL}/dictamen/${r.id})\n\n`;
                });
            }
            md += `> **Nota:** Esta herramienta utiliza auto-resolución (NormativaPBA pattern) para encontrar el dictamen más probable con información parcial. Verifique siempre el resultado en la fuente oficial.`;
            return {
                content: [{ type: "text", text: md }],
            };
        }
        catch (error) {
            return errorContent("Error en localización automática", error);
        }
    });
    server.tool("obtener_dictamen_texto", "Obtiene el TEXTO COMPLETO de un dictamen por su ID de Elasticsearch (_id devuelto en las busquedas). Usar despues de cualquier tool de busqueda para leer el contenido integro.", {
        idDictamen: z.string().describe("ID del dictamen (campo _id de la API)"),
    }, async (args) => {
        try {
            const detail = await obtenerDictamenTexto(args);
            if (detail.error === "NOT_FOUND") {
                return { content: [{ type: "text", text: detail.texto }], isError: true };
            }
            let md = `# Dictamen ${detail.numero || "N/A"}\n\n`;
            if (detail.fecha)
                md += `**Fecha:** ${detail.fecha}\n`;
            if (detail.tomo)
                md += `**Tomo/Pagina:** ${detail.tomo}${detail.pagina ? ` / ${detail.pagina}` : ""}\n`;
            if (detail.expediente)
                md += `**Expediente:** ${detail.expediente}\n`;
            if (detail.organismo)
                md += `**Organismo:** ${detail.organismo}\n`;
            if (detail.voces)
                md += `**Voces:** ${detail.voces}\n`;
            if (detail.leyes)
                md += `**Leyes:** ${JSON.stringify(detail.leyes)}\n`;
            md += `\n${detail.texto}\n`;
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return errorContent("Error al obtener texto", error);
        }
    });
    // Tool: obtener_facetas_completas
    server.tool("obtener_facetas_completas", "Obtiene las facetas de navegación completas (organismos y voces) con sus conteos, similar al panel lateral del portal Novedades. Útil para entender la distribución temática y por organismo de los dictámenes recientes.", {
        top: z.number().optional().default(30).describe("Cantidad de resultados por faceta (default 30, máx. 200)"),
        criterio: z.string().optional().describe("Criterio opcional para acotar las facetas a dictámenes que matcheen este texto"),
    }, async (args) => {
        try {
            const top = Math.min(Math.max(args.top || 30, 1), 200);
            const baseQuery = args.criterio
                ? {
                    query_string: {
                        query: String(args.criterio),
                        default_operator: "AND",
                    },
                }
                : { match_all: {} };
            // Get both organismos and voces facets concurrently
            const [organismos, voces] = await Promise.all([
                ptnAggregate("organismo.keyword", top, baseQuery),
                ptnAggregate("voces.keyword", top, baseQuery),
            ]);
            let md = `# Facetas de Navegación Completas\n\n`;
            if (args.criterio)
                md += `**Criterio:** ${args.criterio}\n\n`;
            md += `## Organismos (Top ${organismos.length})\n\n`;
            if (organismos.length === 0) {
                md += `No se encontraron organismos.\n\n`;
            }
            else {
                organismos.forEach((org, idx) => {
                    md += `${idx + 1}. **${org.key}** (${org.doc_count} dictámenes)\n`;
                });
            }
            md += `\n## Voces Temáticas (Top ${voces.length})\n\n`;
            if (voces.length === 0) {
                md += `No se encontraron voces temáticas.\n\n`;
            }
            else {
                voces.forEach((voz, idx) => {
                    md += `${idx + 1}. **${voz.key}** (${voz.doc_count} dictámenes)\n`;
                });
            }
            md += `\n> **Nota:** Estas facetas reflejan la distribución actual de dictámenes en la base de PTN, similar al panel lateral del portal Novedades.`;
            return {
                content: [{ type: "text", text: md }],
            };
        }
        catch (error) {
            return errorContent("Error al obtener facetas completas", error);
        }
    });
    // Tool: buscar_por_ley_enriquecido
    server.tool("buscar_por_ley_enriquecido", "Busca dictámenes que citan una ley específica y retorna información enriquecida con contexto de citación. Basado en la integración Infoleg del portal PTN que detecta referencias a leyes nacionales.", {
        ley: z.string().describe("Número de ley (ej. '26076', '19.549', '24156')"),
        organismo: z.string().optional().describe("Organismo opcional para acotar"),
        anio: stringOrNumberOptional().describe("Año opcional para acotar"),
        pagina: z.number().optional().default(1).describe("Pagina (10 por pagina)"),
    }, async (args) => {
        try {
            const results = await buscarDictamenes({
                ley: args.ley,
                organismo: args.organismo,
                anio: args.anio,
                pagina: args.pagina,
            });
            let md = `# Dictámenes que citan Ley ${args.ley}\n\n`;
            if (args.organismo)
                md += `**Organismo:** ${args.organismo}\n`;
            if (args.anio)
                md += `**Año:** ${args.anio}\n`;
            md += `**Total encontrado:** ${results.total}\n\n`;
            if (results.total === 0) {
                md += `No se encontraron dictámenes que citen esta ley.\n`;
                md += `**Sugerencias:**\n`;
                md += `- Verifique el número de ley (sin 'Ley' prefix)\n`;
                md += `- Intente con formato diferente (ej. '26076' vs '26.076')\n`;
                return { content: [{ type: "text", text: md }] };
            }
            md += `## Resultados\n\n`;
            results.data.forEach((r, idx) => {
                md += `### ${idx + 1}. Dictamen ${r.numero || "N/A"}\n`;
                md += `*   **ID:** \`${r.id}\`\n`;
                if (r.fecha)
                    md += `*   **Fecha:** ${r.fecha}\n`;
                if (r.organismo)
                    md += `*   **Organismo:** ${r.organismo}\n`;
                if (r.voces)
                    md += `*   **Voces:** ${r.voces}\n`;
                if (r.leyes && Array.isArray(r.leyes) && r.leyes.length > 0) {
                    md += `*   **Leyes citadas:** ${r.leyes.join(", ")}\n`;
                }
                if (r.sintesis)
                    md += `*   **Extracto:** ${r.sintesis}...\n`;
                md += `*   **Enlace:** [Ver en PTN](${PTN_WEB_URL}/dictamen/${r.id})\n\n`;
            });
            md += `> **Nota:** Esta herramienta se basa en la integración Infoleg del portal PTN que detecta referencias a leyes nacionales. Verifique siempre el texto completo del dictamen para el contexto exacto de la citación.`;
            return {
                content: [{ type: "text", text: md }],
            };
        }
        catch (error) {
            return errorContent("Error en búsqueda por ley enriquecida", error);
        }
    });
    server.tool("obtener_novedades", "Lista los DICTAMENES MAS RECIENTES publicados (equivalente a 'Novedades de Dictamenes' del portal). Acepta filtros opcionales por organismo o voz para acotar. Incluye facetas con conteos como el portal.", {
        cantidad: z.number().optional().default(10).describe("Cantidad a traer (max. 50)"),
        organismo: z.string().optional().describe("Filtrar las novedades por organismo (substring, case-insensitive)"),
        voz: z.string().optional().describe("Filtrar las novedades por voz tematica (substring, case-insensitive)"),
        incluir_facetas: z.boolean().optional().default(true).describe("Incluir facetas con conteos (organismos y voces)"),
    }, async (args) => {
        try {
            const results = await obtenerNovedades(args);
            let md = `# Novedades de Dictamenes - PTN\n\n`;
            md += `**Total en indice de novedades:** ${results.total}\n`;
            if (args.organismo || args.voz) {
                md += `**Filtrados:** ${results.filtrados} (filtros: ${[args.organismo && `organismo='${args.organismo}'`, args.voz && `voz='${args.voz}'`].filter(Boolean).join(", ")})\n`;
            }
            md += `\n`;
            // Add faceted counts like the portal (from research insights)
            if (args.incluir_facetas !== false) {
                const baseQuery = (args.organismo || args.voz)
                    ? {
                        query_string: {
                            query: [args.organismo, args.voz].filter(Boolean).join(" "),
                            default_operator: "AND",
                        },
                    }
                    : { match_all: {} };
                const [organismos, voces] = await Promise.all([
                    ptnAggregate("organismo.keyword", 10, baseQuery),
                    ptnAggregate("voces.keyword", 10, baseQuery),
                ]);
                md += `## Distribución por Organismo (Top 10)\n`;
                organismos.forEach((org, idx) => {
                    md += `${idx + 1}. **${org.key}** (${org.doc_count})\n`;
                });
                md += `\n## Distribución por Voz Temática (Top 10)\n`;
                voces.forEach((voz, idx) => {
                    md += `${idx + 1}. **${voz.key}** (${voz.doc_count})\n`;
                });
                md += `\n---\n\n`;
            }
            if (results.data.length === 0) {
                md += "No se encontraron novedades con esos filtros.";
                return { content: [{ type: "text", text: md }] };
            }
            md += `## Dictámenes Recientes\n\n`;
            results.data.forEach((r, idx) => {
                md += `### ${idx + 1}. Dictamen ${r.numero || "N/A"} (${r.fecha || "s/f"})\n`;
                md += `*   **ID:** \`${r.id}\`\n`;
                if (r.organismo)
                    md += `*   **Organismo:** ${r.organismo}\n`;
                if (r.voces)
                    md += `*   **Voces:** ${r.voces}\n`;
                if (r.tomo)
                    md += `*   **Tomo/Pagina:** ${r.tomo}${r.pagina ? ` / ${r.pagina}` : ""}\n`;
                if (r.sintesis)
                    md += `*   **Extracto:** ${r.sintesis}...\n`;
                md += `*   **Enlace:** [Ver en PTN](${PTN_WEB_URL}/dictamen/${r.id})\n\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return errorContent("Error al obtener novedades", error);
        }
    });
    // Tool: localizar_por_coordenadas_archivisticas
    server.tool("localizar_por_coordenadas_archivisticas", "Localiza un dictamen por sus coordenadas archivísticas exactas (Tomo + Página). Basado en el sistema de archivo físico de la PTN donde los dictámenes están encuadernados en volúmenes cronológicos. Útil para recuperar documentos con OCR deficiente.", {
        tomo: z.union([z.string(), z.number()]).transform((v) => String(v)).optional().describe("Número de tomo (ej. '251', '336')"),
        pagina: z.union([z.string(), z.number()]).transform((v) => String(v)).optional().describe("Número de página dentro del tomo (ej. '787', '149')"),
    }, async (args) => {
        try {
            if (!args.tomo || !args.pagina) {
                throw new Error("Debe proporcionar tanto tomo como página");
            }
            const results = await buscarDictamenes({
                tomo: args.tomo,
                paginaRef: args.pagina,
                pageSize: 5,
            });
            let md = `# Localización por Coordenadas Archivísticas\n\n`;
            md += `**Tomo:** ${args.tomo}\n`;
            md += `**Página:** ${args.pagina}\n`;
            md += `**Total encontrado:** ${results.total}\n\n`;
            if (results.total === 0) {
                md += `No se encontró ningún dictamen con estas coordenadas archivísticas.\n`;
                md += `**Sugerencias:**\n`;
                md += `- Verifique que el número de tomo y página sean correctos\n`;
                md += `- Los volúmenes más recientes pueden no estar aún digitalizados\n`;
                md += `- Use \`localizar_por_cita\` si tiene el número de dictamen\n`;
                return { content: [{ type: "text", text: md }] };
            }
            md += `## Resultados\n\n`;
            results.data.forEach((r, idx) => {
                md += `### ${idx + 1}. Dictamen ${r.numero || "N/A"}\n`;
                md += `*   **ID:** \`${r.id}\`\n`;
                if (r.fecha)
                    md += `*   **Fecha:** ${r.fecha}\n`;
                if (r.organismo)
                    md += `*   **Organismo:** ${r.organismo}\n`;
                if (r.voces)
                    md += `*   **Voces:** ${r.voces}\n`;
                if (r.expediente)
                    md += `*   **Expediente:** ${r.expediente}\n`;
                if (r.sintesis)
                    md += `*   **Extracto:** ${r.sintesis}...\n`;
                md += `*   **Enlace:** [Ver en PTN](${PTN_WEB_URL}/dictamen/${r.id})\n\n`;
            });
            md += `> **Nota:** Este método es útil para documentos con OCR deficiente, ya que las coordenadas físicas (Tomo/Página) son más confiables que la búsqueda de texto completo en documentos históricos escaneados.`;
            return {
                content: [{ type: "text", text: md }],
            };
        }
        catch (error) {
            return errorContent("Error en localización por coordenadas archivísticas", error);
        }
    });
    server.tool("listar_organismos", "Lista el CATALOGO de organismos presentes en la base de la PTN, con conteo de dictamenes por organismo (facets de Elasticsearch). Usar para descubrir nombres exactos antes de filtrar, o para mostrar 'que organismos figuran mas'.", {
        top: z.number().optional().default(30).describe("Cantidad de organismos a listar (max. 200)"),
        criterio: z.string().optional().describe("Opcional: restringir el conteo a dictamenes que matcheen este texto"),
    }, async (args) => {
        try {
            const baseQuery = args.criterio
                ? { query_string: { query: args.criterio, default_operator: "AND" } }
                : undefined;
            const buckets = await ptnAggregate("organismo.keyword", args.top ?? 30, baseQuery);
            let md = `# Organismos en la base PTN\n\n`;
            if (args.criterio)
                md += `**Restringido al criterio:** \`${args.criterio}\`\n\n`;
            md += `**Mostrando top ${buckets.length}.**\n\n`;
            md += `| # | Organismo | Dictamenes |\n|---|---|---|\n`;
            buckets.forEach((b, idx) => {
                md += `| ${idx + 1} | ${b.key} | ${b.doc_count} |\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return errorContent("Error al listar organismos", error);
        }
    });
    server.tool("listar_voces", "Lista el CATALOGO de voces tematicas (materias) presentes en la base PTN, con conteo de dictamenes por voz (facets de Elasticsearch). Usar para descubrir voces exactas antes de usar buscar_por_voz.", {
        top: z.number().optional().default(30).describe("Cantidad de voces a listar (max. 200)"),
        criterio: z.string().optional().describe("Opcional: restringir el conteo a dictamenes que matcheen este texto"),
    }, async (args) => {
        try {
            const baseQuery = args.criterio
                ? { query_string: { query: args.criterio, default_operator: "AND" } }
                : undefined;
            const buckets = await ptnAggregate("voces.keyword", args.top ?? 30, baseQuery);
            let md = `# Voces tematicas en la base PTN\n\n`;
            if (args.criterio)
                md += `**Restringido al criterio:** \`${args.criterio}\`\n\n`;
            md += `**Mostrando top ${buckets.length}.**\n\n`;
            md += `| # | Voz / Materia | Dictamenes |\n|---|---|---|\n`;
            buckets.forEach((b, idx) => {
                md += `| ${idx + 1} | ${b.key} | ${b.doc_count} |\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return errorContent("Error al listar voces", error);
        }
    });
    server.tool("alcance_fuente", "Informa capacidades, fuentes, limitaciones y disclaimer del conector PTN MCP.", {}, async () => {
        const text = `# Alcance y Fuentes - Procuracion del Tesoro de la Nacion (PTN)

## Datos del Conector
- **Servidor:** ptn-mcp v${SERVER_VERSION}
- **Fuente Legal:** Procuracion del Tesoro de la Nacion
- **Portal:** ${PTN_WEB_URL}
- **API:** ${PTN_API_URL} (Elasticsearch via POST /search y /search_news)

## Herramientas de busqueda
- \`buscar_dictamenes\`: busqueda avanzada combinando varios filtros
- \`buscar_por_organismo\`: shortcut por organismo (AFIP, CONICET, ministerios, etc.)
- \`buscar_por_voz\`: shortcut por voz/materia (designacion, contratacion, etc.)
- \`buscar_por_ley\`: dictamenes que citan una ley
- \`localizar_por_cita\`: lookup por Tomo + Pagina o No + Anio

## Detalle
- \`obtener_dictamen_texto\`: texto integro por ID (_id)

## Novedades y catalogo
- \`obtener_novedades\`: ultimos dictamenes publicados (con filtros opcionales)
- \`listar_organismos\`: catalogo de organismos con conteo (facets)
- \`listar_voces\`: catalogo de voces tematicas con conteo (facets)

## Metadata
- \`alcance_fuente\`: este informe

## Prompts asistidos
- \`auditar_dictamen\`: revisa un dictamen y arma reporte estructurado
- \`comparar_dictamenes\`: compara 2-3 dictamenes por sus IDs
- \`resumen_por_organismo\`: panorama de dictamenes de un organismo en N meses

## Limitaciones
- La API publica no expone endpoints administrativos sin autenticacion
- Resultados paginados de 10 items por pagina por defecto
- Las novedades cubren solo los ultimos meses (segun publicacion oficial)
- Relevancia definida por el indice oficial (no configurable desde el MCP)

## Aviso Legal
Conector automatizado con fines de investigacion. No constituye asesoramiento juridico profesional.`;
        return { content: [{ type: "text", text }] };
    });
    // Tool: detector_plazos_dictamenes
    server.tool("detector_plazos_dictamenes", "Audita el texto de dictamenes de la PTN para detectar e indexar plazos, fechas límite y hitos temporales relevantes (plazos administrativos, vencimientos, prescripciones). Enhanced with InfoLeg pattern (Trace 3) for comprehensive legal deadline detection.", {
        texto_dictamen: z.string().describe("Texto del dictamen a analizar"),
    }, async (args) => {
        try {
            const text = args.texto_dictamen;
            // FIX FALSOS NEGATIVOS:
            // 1. La regex de fechas tenia flag /g y se reutilizaba con .test()
            //    sobre varios parrafos -> lastIndex sucio salteaba matches.
            // 2. "\d+\s+(días?\s+(habiles|corridos)?|...)" exigia espacio despues
            //    de "días" aunque no hubiera calificador -> "10 días." no matcheaba.
            // 3. No cubria los formatos reales: "diez (10) días hábiles",
            //    "treinta días corridos", "contados desde la notificación",
            //    "bajo apercibimiento", "perentorio".
            // Los ~85 patrones "plazo de castigo / estadía / poder" eran relleno
            // sin correlato en dictamenes reales y generaban falsos positivos.
            const NUM_LETRAS = "(?:un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta\\s+y\\s+cinco|cuarenta|cincuenta|sesenta|noventa|ciento\\s+veinte|ciento\\s+ochenta)";
            const UNIDAD = "(?:d[ií]as?|mes(?:es)?|a[ñn]os?|horas?|semanas?)";
            const CALIF = "(?:\\s+(?:h[áa]biles?|corridos?|laborables?|administrativos?|judiciales?))?";
            const patterns = [
                // "10 días hábiles", "diez (10) días", "treinta días corridos", "10 días."
                { regex: new RegExp(`\\b(?:\\d+|${NUM_LETRAS})\\s*(?:\\(\\s*\\d+\\s*\\)\\s*)?${UNIDAD}${CALIF}`, "i"), name: "Plazo numérico" },
                // "plazo de diez días", "término máximo de 30 días", "plazo de ley"
                { regex: /\b(?:plazo|t[ée]rmino)s?\s+(?:m[áa]ximo\s+|m[íi]nimo\s+|perentorio\s+)?de\b/i, name: "Cláusula de plazo" },
                // "dentro del plazo", "dentro de los diez (10) días"
                { regex: new RegExp(`\\bdentro\\s+de(?:l\\s+(?:plazo|t[ée]rmino)|\\s+l[oa]s?\\s+(?:\\d+|${NUM_LETRAS}))`, "i"), name: "Plazo de cumplimiento" },
                // "contados desde...", "a partir de la notificación/publicación"
                { regex: /\b(?:contad[oa]s?\s+(?:desde|a\s+partir)|a\s+partir\s+de\s+(?:la\s+)?(?:notificaci[óo]n|publicaci[óo]n|recepci[óo]n|fecha))/i, name: "Cómputo de plazo" },
                { regex: /\b(?:prescrib\w+|prescripci[óo]n|prescript\w+)\b/i, name: "Prescripción" },
                { regex: /\bcaduc\w+\b/i, name: "Caducidad" },
                { regex: /\b(?:perentori[oa]s?|improrrogables?|fatal(?:es)?)\b/i, name: "Plazo perentorio" },
                { regex: /\b(?:venc\w+|expir\w+|\bmora\b)/i, name: "Vencimiento/Mora" },
                { regex: /\b(?:pr[óo]rrog\w+|prorrog\w+)\b/i, name: "Prórroga" },
                { regex: /\b(?:suspensi[óo]n|interrupci[óo]n)\s+(?:de(?:l)?\s+)?(?:plazo|t[ée]rmino|curso)/i, name: "Suspensión/Interrupción de plazo" },
                { regex: /\bbajo\s+apercibimiento\b/i, name: "Apercibimiento" },
                // Fechas: 10/03/2026, 10-3-26, "1° de marzo de 2026"
                { regex: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/, name: "Fecha específica" },
                { regex: /\b\d{1,2}[°º]?\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+\d{4})?\b/i, name: "Fecha en letras" },
                { regex: /\bhasta\s+el\s+(?:d[íi]a\s+)?\d/i, name: "Fecha límite" },
                { regex: /\b(?:antes\s+del?\b|a\s+m[áa]s\s+tardar)/i, name: "Fecha límite" },
            ];
            // Split text into paragraphs for analysis (InfoLeg pattern Trace 3c)
            const paragraphs = text.split(/\n\n+/);
            const results = [];
            for (const paragraph of paragraphs) {
                const trimmed = paragraph.trim();
                if (!trimmed || trimmed.length < 10)
                    continue;
                const foundMatches = [];
                for (const pattern of patterns) {
                    pattern.regex.lastIndex = 0; // higiene por si algun patron trae flag g
                    if (pattern.regex.test(trimmed) && !foundMatches.includes(pattern.name)) {
                        foundMatches.push(pattern.name);
                    }
                }
                if (foundMatches.length > 0) {
                    results.push({
                        paragraph: trimmed.substring(0, 500) + (trimmed.length > 500 ? '...' : ''),
                        matches: foundMatches
                    });
                }
            }
            let content = `# Auditoría de Plazos y Hitos Temporales en Dictámenes PTN\n\n`;
            content += `## Resumen\n`;
            content += `Se identificaron **${results.length}** cláusulas con indicadores temporales relevantes.\n\n`;
            if (results.length === 0) {
                content += `No se detectaron plazos, fechas límite o hitos temporales en el texto analizado.\n`;
                content += `Esto puede indicar:\n`;
                content += `- El dictamen no contiene plazos temporales\n`;
                content += `- Los plazos están expresados en formato no detectado por los patrones actuales\n`;
                content += `- El texto es muy breve o no es legible\n\n`;
            }
            else {
                content += `## Cláusulas Temporales Detectadas\n\n`;
                results.forEach((r, idx) => {
                    content += `### ${idx + 1}. Cláusula Temporal (Indicador: ${r.matches.join(', ')})\n`;
                    content += `> ${r.paragraph}\n\n`;
                });
            }
            content += `## Patrones de Búsqueda Utilizados\n`;
            patterns.forEach((p, idx) => {
                content += `${idx + 1}. **${p.name}**: ${p.regex.source}\n`;
            });
            content += `\n> **Nota:** Esta herramienta detecta patrones de texto comunes en dictámenes de la PTN (InfoLeg pattern enhanced). No constituye asesoramiento legal. Verificar siempre los plazos directamente en el documento original de la PTN.`;
            return {
                content: [{ type: "text", text: content }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error al detectar plazos en dictamen: ${error.message}` }],
            };
        }
    });
    // Tool: generar_certificacion_forense
    server.tool("generar_certificacion_forense", "Genera una certificación forense de autenticidad para un dictamen de la PTN con hash SHA-256, timestamp y metadatos de integridad", {
        idDictamen: z.string().describe("ID del dictamen a certificar"),
    }, async (args) => {
        try {
            const dictamenId = String(args.idDictamen);
            const timestamp = new Date().toISOString();
            // Get dictamen data
            const detail = await obtenerDictamenTexto({ idDictamen: dictamenId });
            if (detail.error === "NOT_FOUND") {
                return { content: [{ type: "text", text: detail.texto }], isError: true };
            }
            const textContent = detail.texto || "";
            const docBuffer = Buffer.from(textContent, 'utf8');
            const sizeBytes = Buffer.byteLength(docBuffer, 'utf8');
            const hash = crypto.createHash('sha256').update(docBuffer).digest('hex');
            let content = `::: ACTA DE CERTIFICACIÓN FORENSE DE AUTENTICIDAD Y TRAZABILIDAD\n`;
            content += `::: Procuración del Tesoro de la Nación (PTN)\n\n`;
            content += `## DOCUMENTO CERTIFICADO\n`;
            content += `- **ID de Dictamen:** \`${dictamenId}\`\n`;
            content += `- **Número:** ${detail.numero || "N/A"}\n`;
            content += `- **Fuente:** Procuración del Tesoro de la Nación (PTN)\n\n`;
            content += `## METADATOS FORENSES\n`;
            content += `| Metadato Forense | Detalle Registrado |\n`;
            content += `| :--- | :--- |\n`;
            content += `| **Timestamp UTC** | \`${timestamp}\` |\n`;
            content += `| **URL de Origen** | ${PTN_WEB_URL}/dictamen/${dictamenId} |\n`;
            content += `| **Peso del Documento** | \`${sizeBytes} bytes\` |\n`;
            content += `| **Hash SHA-256 de Control** | \`${hash}\` |\n\n`;
            content += `## GARANTÍA DE INTEGRIDAD\n`;
            content += `> **[!] GARANTÍA DE NO ALTERACIÓN:** Este certificado garantiza que el dictamen fue recuperado íntegramente desde la fuente oficial de la PTN en el timestamp indicado. El hash SHA-256 permite verificar cualquier modificación posterior del contenido.\n\n`;
            content += `## MÉTODO DE VERIFICACIÓN\n`;
            content += `Para verificar la integridad de este documento en el futuro:\n`;
            content += `1. Recupere nuevamente el dictamen desde la PTN usando el ID ${dictamenId}\n`;
            content += `2. Calcule el hash SHA-256 del contenido recuperado\n`;
            content += `3. Compare con el hash certificado: \`${hash}\`\n`;
            content += `4. Si los hashes coinciden, el documento no ha sido alterado\n\n`;
            content += `---\n`;
            content += `*Este documento constituye un instrumento técnico de trazabilidad y autenticidad. No constituye certificación legal oficial de la Procuración del Tesoro de la Nación. Para fines legales, consulte las autoridades competentes.*\n`;
            content += `*Certificado generado automáticamente por Argentina-PTN-MCP v${SERVER_VERSION}*`;
            return {
                content: [{ type: "text", text: content }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error al generar certificación forense: ${error.message}` }],
            };
        }
    });
    // Tool: buscar_por_semantica
    server.tool("buscar_por_semantica", "Busca dictamenes en la PTN utilizando expansión semántica de términos. El LLM debe generar sinónimos y términos equivalentes antes de llamar esta herramienta.", {
        concepto: z.string().describe("Concepto central a buscar (ej. 'designación', 'apoderamiento', 'contratación')"),
        terminos_equivalentes: z.array(z.string()).describe("Lista de sinónimos o términos relacionados generados por el LLM (ej. ['nombramiento', 'designación', 'cargo'])"),
        organismo: z.string().optional().describe("Acotar por organismo (opcional)"),
        anio: stringOrNumberOptional().describe("Acotar por año (opcional)"),
        pagina: z.number().optional().default(1).describe("Página (10 por página)"),
    }, async (args) => {
        try {
            const concepto = args.concepto;
            const terminos = args.terminos_equivalentes || [];
            // Combine concept with equivalent terms for broader search
            const allTerms = [concepto, ...terminos].join(' ');
            const results = await buscarDictamenes({
                criterio: allTerms,
                organismo: args.organismo,
                anio: args.anio,
                pagina: args.pagina,
            });
            let md = `# Búsqueda Semántica de Dictámenes - "${concepto}"\n\n`;
            md += `## Términos de Búsqueda Utilizados\n`;
            md += `- **Concepto principal:** ${concepto}\n`;
            md += `- **Términos equivalentes:** ${terminos.join(', ') || 'Ninguno'}\n`;
            md += `- **Query completa:** "${allTerms}"\n`;
            if (args.organismo)
                md += `- **Organismo:** ${args.organismo}\n`;
            md += `\n`;
            md += renderResultsMarkdown("Resultados de Búsqueda Semántica", results);
            md += `\n> **Nota:** Esta herramienta utiliza expansión semántica para capturar dictámenes que pueden no usar la terminología exacta del concepto buscado.`;
            return {
                content: [{ type: "text", text: md }],
            };
        }
        catch (error) {
            return errorContent("Error en búsqueda semántica", error);
        }
    });
    // Tool: relacionar_dictamenes
    server.tool("relacionar_dictamenes", "Busca dictámenes relacionados con un dictamen específico (mismo organismo, temas similares, misma voz temática)", {
        criterio_base: z.string().describe("Criterio base del dictamen de referencia (organismo, voz o tema)"),
        terminos_relacionados: z.array(z.string()).optional().describe("Términos relacionados para buscar dictámenes conexos"),
        organismo: z.string().optional().describe("Acotar por organismo (opcional)"),
        voz: z.string().optional().describe("Acotar por voz temática (opcional)"),
        pagina: z.number().optional().default(1).describe("Página (10 por página)"),
    }, async (args) => {
        try {
            const criterioBase = args.criterio_base;
            const terminosRelacionados = args.terminos_relacionados || [];
            // Combine base criteria with related terms
            const searchQuery = [criterioBase, ...terminosRelacionados].join(' ');
            const results = await buscarDictamenes({
                criterio: searchQuery,
                organismo: args.organismo,
                voz: args.voz,
                pagina: args.pagina,
            });
            let md = `# Dictámenes Relacionados - "${criterioBase}"\n\n`;
            md += `## Dictamen de Referencia\n`;
            md += `- **Criterio base:** ${criterioBase}\n`;
            if (args.organismo)
                md += `- **Organismo:** ${args.organismo}\n`;
            if (args.voz)
                md += `- **Voz temática:** ${args.voz}\n`;
            md += `\n`;
            md += `## Criterio de Búsqueda\n`;
            md += `**Query:** "${searchQuery}"\n`;
            md += `**Términos relacionados:** ${terminosRelacionados.join(', ') || 'Ninguno'}\n\n`;
            md += renderResultsMarkdown("Dictámenes Relacionados Encontrados", results);
            md += `\n> **Nota:** Esta herramienta busca por similitud temática y contextual. Las relaciones no son oficiales de la PTN.`;
            return {
                content: [{ type: "text", text: md }],
            };
        }
        catch (error) {
            return errorContent("Error al relacionar dictámenes", error);
        }
    });
    // Tool: exportar_dictamen
    server.tool("exportar_dictamen", "Exporta la información de un dictamen a formato Markdown estructurado con frontmatter YAML para sistemas de gestión del conocimiento (Notion, Obsidian, etc.)", {
        idDictamen: z.string().describe("ID del dictamen a exportar"),
        incluir_texto: z.boolean().optional().describe("Incluir texto completo del dictamen (por defecto: true)"),
    }, async (args) => {
        try {
            const dictamenId = args.idDictamen;
            const incluirTexto = args.incluir_texto !== false;
            const exportDate = new Date().toISOString();
            // Get dictamen data
            const detail = await obtenerDictamenTexto({ idDictamen: dictamenId });
            if (detail.error === "NOT_FOUND") {
                return { content: [{ type: "text", text: detail.texto }], isError: true };
            }
            // Build YAML frontmatter
            let content = `---\n`;
            content += `title: "Dictamen ${detail.numero || 'N/A'}"\n`;
            content += `dictamen_id: "${dictamenId}"\n`;
            content += `numero: "${detail.numero || 'N/A'}"\n`;
            content += `fecha: "${detail.fecha || 'N/A'}"\n`;
            content += `organismo: "${detail.organismo || 'N/A'}"\n`;
            content += `voces: "${detail.voces || 'N/A'}"\n`;
            content += `source: "Procuración del Tesoro de la Nación (PTN)"\n`;
            content += `source_url: "${PTN_WEB_URL}/dictamen/${dictamenId}"\n`;
            content += `export_date: "${exportDate}"\n`;
            content += `exported_by: "Argentina-PTN-MCP v${SERVER_VERSION}"\n`;
            content += `tags:\n`;
            content += `  - PTN\n`;
            content += `  - dictamen\n`;
            content += `  - procuracion-tesoro-nacion\n`;
            content += `  - dictamen-${dictamenId}\n`;
            if (detail.organismo)
                content += `  - organismo-${String(detail.organismo).toLowerCase().replace(/\s+/g, '-')}\n`;
            content += `---\n\n`;
            // Add document content
            content += `# Dictamen ${detail.numero || 'N/A'}\n\n`;
            content += `> **Fuente:** [PTN](${PTN_WEB_URL}/dictamen/${dictamenId})\n`;
            content += `> **ID de Dictamen:** ${dictamenId}\n`;
            if (detail.fecha)
                content += `> **Fecha:** ${detail.fecha}\n`;
            if (detail.organismo)
                content += `> **Organismo:** ${detail.organismo}\n`;
            if (detail.voces)
                content += `> **Voces:** ${detail.voces}\n`;
            if (detail.expediente)
                content += `> **Expediente:** ${detail.expediente}\n`;
            content += `\n`;
            if (incluirTexto) {
                content += `## Texto Completo\n\n`;
                content += `${detail.texto}\n\n`;
            }
            content += `---\n\n`;
            content += `*Documento exportado automáticamente desde la Procuración del Tesoro de la Nación. Verificar siempre la información en la fuente oficial.*`;
            return {
                content: [{ type: "text", text: content }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error al exportar dictamen: ${error.message}` }],
            };
        }
    });
    // Tool: obtener_resumen_multiple_organismos
    server.tool("obtener_resumen_multiple_organismos", "Obtiene un resumen concurrente de dictámenes de múltiples organismos en paralelo (BORA pattern: Promise.all aggregation). Útil para análisis comparativos entre organismos.", {
        organismos: z.array(z.string()).describe("Lista de organismos a consultar (ej. ['CONICET', 'AFIP', 'ANSES'])"),
        criterio: z.string().optional().describe("Criterio opcional para acotar la búsqueda en cada organismo"),
        anio: stringOrNumberOptional().describe("Año opcional para filtrar"),
        max_por_organismo: z.number().optional().default(5).describe("Máximo de resultados por organismo (default 5)"),
    }, async (args) => {
        try {
            const organismos = args.organismos || [];
            if (organismos.length === 0) {
                throw new Error("Debe proporcionar al menos un organismo");
            }
            // Concurrently fetch all organisms using Promise.all (BORA pattern Trace 7)
            const results = await Promise.all(organismos.map(async (org) => {
                try {
                    const searchResults = await buscarDictamenes({
                        organismo: org,
                        criterio: args.criterio,
                        anio: args.anio,
                        pageSize: args.max_por_organismo,
                        pagina: 1,
                    });
                    return {
                        organismo: org,
                        total: searchResults.total,
                        data: searchResults.data,
                        error: null,
                    };
                }
                catch (error) {
                    return {
                        organismo: org,
                        total: 0,
                        data: [],
                        error: error.message,
                    };
                }
            }));
            let md = `# Resumen Concurrente de Múltiples Organismos\n\n`;
            md += `**Organismos consultados:** ${organismos.join(', ')}\n`;
            if (args.criterio)
                md += `**Criterio:** ${args.criterio}\n`;
            if (args.anio)
                md += `**Año:** ${args.anio}\n`;
            md += `**Máximo por organismo:** ${args.max_por_organismo}\n\n`;
            const totalGlobal = results.reduce((sum, r) => sum + r.total, 0);
            md += `**Total global de dictámenes:** ${totalGlobal}\n\n`;
            results.forEach((r) => {
                md += `## ${r.organismo}\n`;
                if (r.error) {
                    md += `❌ Error: ${r.error}\n\n`;
                }
                else {
                    md += `**Total encontrado:** ${r.total}\n\n`;
                    if (r.data.length > 0) {
                        r.data.forEach((d, idx) => {
                            md += `### ${idx + 1}. Dictamen ${d.numero || "N/A"}\n`;
                            md += `*   **ID:** \`${d.id}\`\n`;
                            if (d.fecha)
                                md += `*   **Fecha:** ${d.fecha}\n`;
                            if (d.voces)
                                md += `*   **Voces:** ${d.voces}\n`;
                            if (d.sintesis)
                                md += `*   **Extracto:** ${d.sintesis}...\n`;
                            md += `*   **Enlace:** [Ver en PTN](${PTN_WEB_URL}/dictamen/${d.id})\n\n`;
                        });
                    }
                    else {
                        md += `No se encontraron dictámenes para este organismo.\n\n`;
                    }
                }
            });
            md += `> **Nota:** Esta herramienta utiliza ejecución concurrente (Promise.all) para optimizar el tiempo de respuesta al consultar múltiples organismos en paralelo.`;
            return {
                content: [{ type: "text", text: md }],
            };
        }
        catch (error) {
            return errorContent("Error en resumen múltiple organismos", error);
        }
    });
    // Tool: obtener_resumen_multiple_voces
    server.tool("obtener_resumen_multiple_voces", "Obtiene un resumen concurrente de dictámenes de múltiples voces temáticas en paralelo (BORA pattern: Promise.all aggregation). Útil para análisis comparativos entre materias.", {
        voces: z.array(z.string()).describe("Lista de voces temáticas a consultar (ej. ['designación', 'apoderamiento', 'contratación'])"),
        criterio: z.string().optional().describe("Criterio opcional para acotar la búsqueda en cada voz"),
        organismo: z.string().optional().describe("Organismo opcional para filtrar"),
        anio: stringOrNumberOptional().describe("Año opcional para filtrar"),
        max_por_voz: z.number().optional().default(5).describe("Máximo de resultados por voz (default 5)"),
    }, async (args) => {
        try {
            const voces = args.voces || [];
            if (voces.length === 0) {
                throw new Error("Debe proporcionar al menos una voz temática");
            }
            // Concurrently fetch all voices using Promise.all (BORA pattern Trace 7)
            const results = await Promise.all(voces.map(async (voz) => {
                try {
                    const searchResults = await buscarDictamenes({
                        voz: voz,
                        criterio: args.criterio,
                        organismo: args.organismo,
                        anio: args.anio,
                        pageSize: args.max_por_voz,
                        pagina: 1,
                    });
                    return {
                        voz: voz,
                        total: searchResults.total,
                        data: searchResults.data,
                        error: null,
                    };
                }
                catch (error) {
                    return {
                        voz: voz,
                        total: 0,
                        data: [],
                        error: error.message,
                    };
                }
            }));
            let md = `# Resumen Concurrente de Múltiples Voces Temáticas\n\n`;
            md += `**Voces consultadas:** ${voces.join(', ')}\n`;
            if (args.criterio)
                md += `**Criterio:** ${args.criterio}\n`;
            if (args.organismo)
                md += `**Organismo:** ${args.organismo}\n`;
            if (args.anio)
                md += `**Año:** ${args.anio}\n`;
            md += `**Máximo por voz:** ${args.max_por_voz}\n\n`;
            const totalGlobal = results.reduce((sum, r) => sum + r.total, 0);
            md += `**Total global de dictámenes:** ${totalGlobal}\n\n`;
            results.forEach((r) => {
                md += `## ${r.voz}\n`;
                if (r.error) {
                    md += `❌ Error: ${r.error}\n\n`;
                }
                else {
                    md += `**Total encontrado:** ${r.total}\n\n`;
                    if (r.data.length > 0) {
                        r.data.forEach((d, idx) => {
                            md += `### ${idx + 1}. Dictamen ${d.numero || "N/A"}\n`;
                            md += `*   **ID:** \`${d.id}\`\n`;
                            if (d.fecha)
                                md += `*   **Fecha:** ${d.fecha}\n`;
                            if (d.organismo)
                                md += `*   **Organismo:** ${d.organismo}\n`;
                            if (d.sintesis)
                                md += `*   **Extracto:** ${d.sintesis}...\n`;
                            md += `*   **Enlace:** [Ver en PTN](${PTN_WEB_URL}/dictamen/${d.id})\n\n`;
                        });
                    }
                    else {
                        md += `No se encontraron dictámenes para esta voz temática.\n\n`;
                    }
                }
            });
            md += `> **Nota:** Esta herramienta utiliza ejecución concurrente (Promise.all) para optimizar el tiempo de respuesta al consultar múltiples voces en paralelo.`;
            return {
                content: [{ type: "text", text: md }],
            };
        }
        catch (error) {
            return errorContent("Error en resumen múltiple voces", error);
        }
    });
    server.prompt("auditar_dictamen", "Recupera un dictamen y genera un reporte legal estructurado.", {
        idDictamen: z.string().describe("ID oficial del dictamen (_id)"),
        objetivo: z.string().optional().describe("Objetivo de auditoria"),
    }, (args) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Usa la tool 'obtener_dictamen_texto' del MCP ptn-mcp para recuperar el dictamen con id ${args.idDictamen}. Luego elabora un reporte estructurado con: (1) Caratula (numero, fecha, organismo, expediente), (2) Hechos relevantes, (3) Marco normativo citado, (4) Razonamiento juridico de la PTN, (5) Conclusion / parte dispositiva, (6) Voces / temas. Objetivo del analisis: ${args.objetivo ?? "auditoria general"}.`,
                },
            },
        ],
    }));
    server.prompt("comparar_dictamenes", "Compara 2 o 3 dictamenes por sus IDs y arma cuadro comparativo de criterios y resoluciones.", {
        ids: z.string().describe("IDs separados por coma (ej. 'abc,def,ghi'). Hasta 3."),
        eje: z.string().optional().describe("Eje de comparacion (ej. 'designaciones transitorias', 'apoderamiento')"),
    }, (args) => {
        const ids = args.ids
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 3);
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Usa la tool 'obtener_dictamen_texto' del MCP ptn-mcp para recuperar el texto de cada uno de estos dictamenes: ${ids.join(", ")}. Luego construi un cuadro comparativo (tabla markdown) con columnas: Dictamen, Fecha, Organismo, Hechos, Normativa, Conclusion. Despues, agrega una seccion final 'Coincidencias y divergencias' enfocada en el eje: ${args.eje ?? "criterios y conclusiones"}.`,
                    },
                },
            ],
        };
    });
    server.prompt("resumen_por_organismo", "Panorama de los dictamenes de un organismo en los ultimos N meses.", {
        organismo: z.string().describe("Nombre o fragmento del organismo (ej. 'CONICET')"),
        mesesAtras: z.string().optional().describe("Cantidad de meses hacia atras (default 12)"),
    }, (args) => {
        const months = Number(args.mesesAtras ?? 12) || 12;
        const desdeIso = isoNMonthsAgo(months);
        const [yyyy, mm, dd] = desdeIso.split("-");
        const desde = `${dd}/${mm}/${yyyy}`;
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Usa la tool 'buscar_por_organismo' del MCP ptn-mcp con organismo='${args.organismo}' y fechaDesde='${desde}', recorriendo paginas hasta cubrir todos los resultados (max 5 paginas). Luego elabora un resumen ejecutivo con: (1) Volumen total y por mes, (2) Voces tematicas mas frecuentes, (3) Tendencia / patrones observados, (4) 3-5 dictamenes destacados con su ID y motivo del destaque. Periodo: ultimos ${months} meses (desde ${desde}).`,
                    },
                },
            ],
        };
    });
}
export const server = new McpServer({
    name: "ptn-mcp",
    version: SERVER_VERSION,
});
registerAllTools(server);
if (typeof process !== "undefined" && !process.env.VERCEL && !process.env.NEXT_RUNTIME) {
    const transport = new StdioServerTransport();
    server.connect(transport).catch((error) => {
        console.error("Fatal error running PTN MCP server:", error);
        process.exit(1);
    });
    console.error(`PTN MCP Server v${SERVER_VERSION} is running via stdio`);
}
//# sourceMappingURL=ptn.js.map