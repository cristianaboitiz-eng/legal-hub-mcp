#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import { installTlsFallback } from "./tls-fallback.js";

export const stringOrNumberOptional = z.union([z.string(), z.number()]).transform(val => String(val)).optional();

const axiosClient = axios.create();
// TLS estricto por defecto; fallback inseguro solo ante cert roto (ver tls-fallback.js).
installTlsFallback(axiosClient, "tfn");

const TFN_BASE_URL = "https://jurisprudenciatfn.mecon.gob.ar";
const API_CANDIDATES = [
    "https://api.jurisprudencia-tfn.ar",
    "https://mirror1.jurisprudencia-tfn.ar",
];
const API_TIMEOUT_MS = 10000;

let _resolvedApiBase = null;
let _resolvedAt = 0;
const RESOLVE_TTL_MS = 5 * 60 * 1000; // 5 minutos

async function resolveApiBase(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _resolvedApiBase && (now - _resolvedAt) < RESOLVE_TTL_MS) {
        return _resolvedApiBase;
    }
    for (const base of API_CANDIDATES) {
        try {
            await axiosClient.get(`${base}/searchStats`, {
                timeout: 5000,
                headers: { "Referer": "https://jurisprudenciatfn.mecon.gob.ar/" }
            });
            _resolvedApiBase = base;
            _resolvedAt = now;
            process.stderr.write(`[tfn] API activa: ${base}\n`);
            return base;
        } catch {
            process.stderr.write(`[tfn] candidato no responde: ${base}\n`);
        }
    }
    _resolvedApiBase = API_CANDIDATES[0];
    _resolvedAt = now;
    process.stderr.write(`[tfn] advertencia: ningun candidato respondio, usando ${_resolvedApiBase} como fallback\n`);
    return _resolvedApiBase;
}

// Construye un titulo util a partir de los campos disponibles
function buildTitulo(r) {
    if (r.caratula) return r.caratula;
    if (r.expediente) return r.expediente;
    if (r.dispositiva) return r.dispositiva.substring(0, 80);
    return r.fallo_id || r.registro || "Sin identificar";
}

// Formatea un resultado individual en markdown
function formatFallo(r, idx, incluirTexto = false) {
    const meta = r.metadata || {};
    const sala = r.sala || meta.sala || null;
    const vocalia = r.vocalia || meta.vocalia || null;
    const competencia = r.competencia || meta.competencia || null;
    const fecha = r.fecha || meta.fecha || null;
    const registro = r.registro || meta.registro || r.fallo_id || null;
    const expediente = r.expediente || meta.expediente || null;
    const dispositiva = r.dispositiva || meta.dispositiva || null;
    const objeto = r.objeto_texto || r.matched_texto || null;
    const doctrinas = r.doctrinas || [];

    let md = `### ${idx + 1}. ${buildTitulo({ ...r, ...meta })}\n`;
    if (registro) md += `- **ID:** \`${registro}\`\n`;
    if (expediente) md += `- **Expediente:** ${expediente}\n`;
    if (sala) md += `- **Sala:** ${sala}\n`;
    if (vocalia) md += `- **Vocalía:** ${vocalia}\n`;
    if (competencia) md += `- **Competencia:** ${competencia}\n`;
    if (fecha) md += `- **Fecha:** ${fecha}\n`;
    if (dispositiva) md += `- **Resolución:** ${dispositiva}\n`;
    if (objeto) md += `- **Objeto del fallo:** ${objeto.substring(0, 300)}${objeto.length > 300 ? "..." : ""}\n`;
    if (doctrinas.length > 0) {
        md += `- **Doctrinas (${doctrinas.length}):**\n`;
        doctrinas.slice(0, 3).forEach((d, i) => {
            const texto = typeof d === "string" ? d : d.texto || "";
            md += `  ${i + 1}. ${texto.substring(0, 200)}${texto.length > 200 ? "..." : ""}\n`;
        });
        if (doctrinas.length > 3) md += `  *(y ${doctrinas.length - 3} doctrinas más - usar obtener_resolucion_tfn para ver todas)*\n`;
    }
    if (incluirTexto && r.texto_completo) {
        md += `\n**Texto completo:**\n\`\`\`\n${r.texto_completo.substring(0, 2000)}${r.texto_completo.length > 2000 ? "\n...[truncado]" : ""}\n\`\`\`\n`;
    }
    md += `- **Ver en TFN:** [${TFN_BASE_URL}/fallo/${encodeURIComponent(registro || "")}](${TFN_BASE_URL}/fallo/${encodeURIComponent(registro || "")})\n\n`;
    return md;
}

// Convierte DD/MM/YYYY -> YYYY-MM-DD para la API. Devuelve null si el input es falsy o invalido.
function toISODate(ddmmyyyy) {
    if (!ddmmyyyy) return null;
    const m = String(ddmmyyyy).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return ddmmyyyy; // ya viene en otro formato, pasar tal cual
    return `${m[3]}-${m[2]}-${m[1]}`;
}

export async function buscarResoluciones(args) {
    const requestBody = {
        query: args.criterio || "",
        search_in: args.search_in || "objetos",
        tribunales: args.tribunal ? [args.tribunal] : [],
        registro: null,
        expediente: args.expediente || null,
        caratula: null,
        salas: args.sala ? [args.sala] : [],
        vocalias: args.vocalia ? [parseInt(args.vocalia)] : [],
        competencias: args.competencia ? [args.competencia] : [],
        fecha_desde: toISODate(args.fechaDesde) || null,
        fecha_hasta: toISODate(args.fechaHasta) || null,
        regulacion_honorarios: null,
        limit: args.limit || 100
    };
    try {
        const apiBase = await resolveApiBase();
        const response = await axiosClient.post(`${apiBase}/hybridSearch`, requestBody, {
            timeout: API_TIMEOUT_MS,
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://jurisprudenciatfn.mecon.gob.ar/"
            }
        });
        const results = response.data.results || [];
        // Normalizar: mezclar campos raiz con metadata
        const normalized = results.map(r => ({
            ...r,
            ...(r.metadata || {}),
            fallo_id: r.fallo_id || (r.metadata && r.metadata.fallo_id),
            registro: r.registro || (r.metadata && r.metadata.registro) || r.fallo_id,
        }));
        return { data: normalized, total: normalized.length };
    } catch (err) {
        const status = err?.response?.status;
        if (status && status >= 500) {
            process.stderr.write(`[tfn] error ${status} en buscarResoluciones - invalidando cache de API base\n`);
            resolveApiBase(true).catch(() => {});
        }
        console.error("TFN API error:", (err instanceof Error ? err.message : String(err)));
        return {
            data: [],
            total: 0,
            error: "No se pudo conectar con el sistema del TFN.",
            note: "Por favor, intente nuevamente mas tarde."
        };
    }
}

export async function obtenerResolucionTexto(args) {
    try {
        const requestBody = {
            query: "",
            search_in: "objetos",
            tribunales: [],
            registro: args.idResolucion,
            expediente: null,
            caratula: null,
            salas: [],
            vocalias: [],
            competencias: [],
            fecha_desde: null,
            fecha_hasta: null,
            regulacion_honorarios: null,
            limit: 1
        };
        const apiBase = await resolveApiBase();
        const response = await axiosClient.post(`${apiBase}/hybridSearch`, requestBody, {
            timeout: API_TIMEOUT_MS,
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://jurisprudenciatfn.mecon.gob.ar/"
            }
        });
        const results = response.data.results || [];
        if (results.length === 0) {
            return {
                id: args.idResolucion,
                texto: "No se encontro el fallo con el ID especificado.",
                error: "Fallo no encontrado"
            };
        }
        const r = results[0];
        const meta = r.metadata || {};
        return {
            id: args.idResolucion,
            sala: r.sala || meta.sala,
            vocalia: r.vocalia || meta.vocalia,
            expediente: r.expediente || meta.expediente,
            fecha: r.fecha || meta.fecha,
            registro: r.registro || meta.registro || r.fallo_id,
            competencia: r.competencia || meta.competencia,
            caratula: r.caratula || meta.caratula,
            dispositiva: r.dispositiva || meta.dispositiva,
            sumarios: r.doctrinas ? r.doctrinas.map(d => typeof d === "string" ? d : d.texto) : [],
            objeto: r.objeto_texto || r.matched_texto,
            texto_completo: r.texto_completo,
            urlFallo: `${TFN_BASE_URL}/fallo/${encodeURIComponent(r.registro || meta.registro || r.fallo_id || "")}`
        };
    } catch (err) {
        console.error("TFN detail error:", (err instanceof Error ? err.message : String(err)));
        return {
            id: args.idResolucion,
            texto: "No se pudo obtener el texto de la resolucion.",
            error: (err instanceof Error ? err.message : String(err))
        };
    }
}

export function registerAllTools(server) {

    server.tool("buscar_resoluciones_tfn",
        "Busca jurisprudencia y resoluciones del Tribunal Fiscal de la Nacion con filtros avanzados (competencia, tribunal, tipo de busqueda).",
        {
            criterio: z.string().optional().describe("Criterio o termino de busqueda legal (ej. 'responsabilidad solidaria', 'prescripcion')"),
            sala: z.string().optional().describe("Sala (A, B, C, D, E, F, G)"),
            vocalia: z.string().optional().describe("Vocalia (numero)"),
            expediente: z.string().optional().describe("Numero de expediente"),
            fechaDesde: z.string().optional().describe("Fecha desde (DD/MM/YYYY)"),
            fechaHasta: z.string().optional().describe("Fecha hasta (DD/MM/YYYY)"),
            competencia: z.enum(["impositiva", "aduana"]).optional().describe("Competencia: impositiva o aduana"),
            tribunal: z.string().optional().describe("Tribunal (TFN, CNCAF)"),
            search_in: z.enum(["objetos", "sumarios"]).optional().default("objetos").describe("Tipo de busqueda: objetos (hechos) o sumarios"),
            limit: z.number().optional().default(100).describe("Limite de resultados (maximo 100)")
        },
        async (args) => {
            try {
                const results = await buscarResoluciones(args);
                let md = `# Tribunal Fiscal de la Nacion - Resultados\n\n`;
                md += `**Criterio:** ${args.criterio || "Todos"}\n`;
                if (args.competencia) md += `**Competencia:** ${args.competencia}\n`;
                if (args.tribunal) md += `**Tribunal:** ${args.tribunal}\n`;
                if (args.search_in) md += `**Tipo de busqueda:** ${args.search_in}\n`;
                md += `\n`;
                const items = results.data || [];
                if (items.length === 0) {
                    if (results.error) {
                        md += `**Error:** ${results.error}\n\n`;
                        if (results.note) md += `**Info:** ${results.note}\n\n`;
                        return { content: [{ type: "text", text: md }] };
                    }
                    return { content: [{ type: "text", text: "No se encontraron resoluciones." }] };
                }
                md += `**Resultados:** ${items.length}\n\n`;
                items.forEach((r, idx) => { md += formatFallo(r, idx, false); });
                return { content: [{ type: "text", text: md }] };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error al consultar TFN: ${(error instanceof Error ? error.message : String(error))}` }],
                    isError: true
                };
            }
        }
    );

    server.tool("obtener_resolucion_tfn",
        "Obtiene el texto completo y todos los datos de una resolucion del TFN por su ID.",
        {
            idResolucion: z.string().describe("ID interno de la resolucion (campo registro o fallo_id, ej: INLEG-2023-122808728-APN-VOCVI#TFN)")
        },
        async (args) => {
            try {
                const detail = await obtenerResolucionTexto(args);
                let md = `# Resolucion TFN\n\n`;
                md += `## Identificacion\n`;
                if (detail.expediente) md += `- **Expediente:** ${detail.expediente}\n`;
                if (detail.registro) md += `- **Registro:** \`${detail.registro}\`\n`;
                if (detail.sala) md += `- **Sala:** ${detail.sala}\n`;
                if (detail.vocalia) md += `- **Vocalía:** ${detail.vocalia}\n`;
                if (detail.competencia) md += `- **Competencia:** ${detail.competencia}\n`;
                if (detail.fecha) md += `- **Fecha:** ${detail.fecha}\n`;
                if (detail.dispositiva) md += `- **Resolucion:** ${detail.dispositiva}\n`;
                md += `\n`;
                if (detail.objeto) {
                    md += `## Objeto del fallo\n${detail.objeto}\n\n`;
                }
                if (detail.sumarios && detail.sumarios.length > 0) {
                    md += `## Doctrinas (${detail.sumarios.length})\n`;
                    detail.sumarios.forEach((s, i) => { md += `${i + 1}. ${s}\n`; });
                    md += `\n`;
                }
                if (detail.texto_completo) {
                    md += `## Texto completo\n${detail.texto_completo}\n\n`;
                }
                if (detail.urlFallo) {
                    md += `## Enlace\n- [Ver en sitio oficial](${detail.urlFallo})\n`;
                }
                return { content: [{ type: "text", text: md }] };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error al obtener texto: ${(error instanceof Error ? error.message : String(error))}` }],
                    isError: true
                };
            }
        }
    );

    server.tool("buscar_resolucion_por_expediente",
        "Busca una resolucion especifica del TFN por su numero de expediente exacto.",
        {
            numero_expediente: z.string().optional().describe("Numero de expediente (ej. '12345-67' o 'TFN-12345/2020')."),
            expediente: z.string().optional().describe("Alias de numero_expediente (aceptado por compatibilidad)."),
            competencia: z.enum(["impositiva", "aduana"]).optional().describe("Competencia (opcional).")
        },
        async (args) => {
            try {
                // FIX: el esquema solo aceptaba numero_expediente y quien llamaba
                // con "expediente" recibia un -32602 criptico. Se acepta el alias
                // y se valida en runtime con mensaje explicito.
                const nroExpediente = args.numero_expediente || args.expediente;
                if (!nroExpediente) {
                    return {
                        content: [{ type: "text", text: "Falta el numero de expediente. Use el parametro 'numero_expediente' (ej. '12345-67' o 'TFN-12345/2020')." }],
                        isError: true
                    };
                }
                const results = await buscarResoluciones({ expediente: nroExpediente, competencia: args.competencia });
                let md = `# TFN - Busqueda por Expediente\n\n**Expediente:** ${nroExpediente}\n`;
                if (args.competencia) md += `**Competencia:** ${args.competencia}\n`;
                md += `\n`;
                const items = results.data || [];
                if (items.length === 0) {
                    md += "No se encontraron resultados para el expediente especificado.\n";
                } else {
                    items.forEach((r, idx) => { md += formatFallo(r, idx, false); });
                }
                return { content: [{ type: "text", text: md }] };
            } catch (error) {
                return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
            }
        }
    );

    server.tool("buscar_resolucion_por_caratula",
        "Busca resoluciones del TFN filtrando por el nombre de las partes involucradas.",
        {
            caratula: z.string().describe("Nombre de las partes o razon social."),
            competencia: z.enum(["impositiva", "aduana"]).optional().describe("Competencia (opcional).")
        },
        async (args) => {
            try {
                const results = await buscarResoluciones({ criterio: args.caratula, competencia: args.competencia });
                let md = `# TFN - Busqueda por Caratula/Partes\n\n**Busqueda:** ${args.caratula}\n`;
                if (args.competencia) md += `**Competencia:** ${args.competencia}\n`;
                md += `\n`;
                const items = results.data || [];
                if (items.length === 0) {
                    md += "No se encontraron resultados.\n";
                } else {
                    items.forEach((r, idx) => { md += formatFallo(r, idx, false); });
                }
                return { content: [{ type: "text", text: md }] };
            } catch (error) {
                return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
            }
        }
    );

    server.tool("obtener_resumen_ia",
        "Obtiene el objeto, doctrinas y texto completo de una resolucion especifica del TFN.",
        {
            id_resolucion: z.string().describe("ID de la resolucion (campo registro o fallo_id).")
        },
        async (args) => {
            try {
                const detail = await obtenerResolucionTexto({ idResolucion: args.id_resolucion });
                let md = `# TFN - Detalle completo\n\n`;
                md += `**ID:** \`${args.id_resolucion}\`\n`;
                if (detail.expediente) md += `**Expediente:** ${detail.expediente}\n`;
                if (detail.sala) md += `**Sala:** ${detail.sala}\n`;
                if (detail.vocalia) md += `**Vocalía:** ${detail.vocalia}\n`;
                if (detail.fecha) md += `**Fecha:** ${detail.fecha}\n`;
                if (detail.dispositiva) md += `**Resolucion:** ${detail.dispositiva}\n`;
                md += `\n`;
                if (detail.objeto) {
                    md += `## Objeto del fallo\n${detail.objeto}\n\n`;
                }
                if (detail.sumarios && detail.sumarios.length > 0) {
                    md += `## Doctrinas\n`;
                    detail.sumarios.forEach((s, i) => { md += `${i + 1}. ${s}\n`; });
                    md += `\n`;
                }
                if (detail.texto_completo) {
                    md += `## Texto completo\n${detail.texto_completo}\n\n`;
                }
                if (detail.urlFallo) {
                    md += `## Enlace\n[Ver en TFN](${detail.urlFallo})\n`;
                }
                return { content: [{ type: "text", text: md }] };
            } catch (error) {
                return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
            }
        }
    );

    server.tool("descargar_resolucion_pdf",
        "Descarga el PDF de una resolucion del TFN por su ID.",
        {
            id_resolucion: z.string().describe("ID de la resolucion (registro o fallo_id).")
        },
        async (args) => {
            try {
                const url = `${TFN_BASE_URL}/fallo/${encodeURIComponent(args.id_resolucion)}/pdf`;
                const response = await axiosClient.get(url, {
                    responseType: "arraybuffer",
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Referer": "https://jurisprudenciatfn.mecon.gob.ar/"
                    }
                });
                const pdfBuffer = Buffer.from(response.data);
                const base64 = pdfBuffer.toString("base64");
                const filename = `TFN-${args.id_resolucion.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
                let resultText = `# TFN - PDF descargado\n\n`;
                resultText += `**ID:** ${args.id_resolucion}\n`;
                resultText += `**Archivo:** ${filename}\n`;
                resultText += `**Tamaño:** ${(pdfBuffer.length / 1024).toFixed(2)} KB\n`;
                resultText += `**Link directo:** ${url}\n`;
                return {
                    content: [{ type: "text", text: resultText }],
                    resources: [{ uri: `data:application/pdf;base64,${base64}`, mimeType: "application/pdf", name: filename }]
                };
            } catch (error) {
                const url = `${TFN_BASE_URL}/fallo/${encodeURIComponent(args.id_resolucion)}/pdf`;
                return {
                    content: [{ type: "text", text: `No se pudo descargar el PDF.\n\nLink directo: ${url}` }],
                    isError: true
                };
            }
        }
    );

    server.tool("buscar_por_hechos",
        "Busca jurisprudencia del TFN por hechos del caso en lenguaje natural.",
        {
            consulta: z.string().describe("Consulta en lenguaje natural sobre los hechos del caso"),
            sala: z.string().optional().describe("Filtro por sala (A-G)"),
            vocalia: z.string().optional().describe("Filtro por vocalia"),
            competencia: z.enum(["impositiva", "aduana"]).optional(),
            fechaDesde: z.string().optional().describe("Fecha desde (DD/MM/YYYY)"),
            fechaHasta: z.string().optional().describe("Fecha hasta (DD/MM/YYYY)"),
            limit: z.number().optional().default(100)
        },
        async (args) => {
            try {
                const results = await buscarResoluciones({
                    criterio: args.consulta,
                    search_in: "objetos",
                    sala: args.sala,
                    vocalia: args.vocalia,
                    competencia: args.competencia,
                    fechaDesde: args.fechaDesde,
                    fechaHasta: args.fechaHasta,
                    limit: args.limit
                });
                let md = `# TFN - Busqueda por hechos\n\n**Consulta:** ${args.consulta}\n**Resultados:** ${results.data.length}\n\n`;
                if (results.data.length === 0) {
                    md += "No se encontraron resultados.\n";
                } else {
                    results.data.forEach((r, idx) => { md += formatFallo(r, idx, false); });
                }
                return { content: [{ type: "text", text: md }] };
            } catch (error) {
                return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
            }
        }
    );

    server.tool("buscar_por_sumarios",
        "Busca jurisprudencia del TFN por sumarios/doctrinas de las resoluciones.",
        {
            consulta: z.string().describe("Consulta sobre los sumarios o doctrinas"),
            sala: z.string().optional(),
            vocalia: z.string().optional(),
            competencia: z.enum(["impositiva", "aduana"]).optional(),
            fechaDesde: z.string().optional(),
            fechaHasta: z.string().optional(),
            limit: z.number().optional().default(100)
        },
        async (args) => {
            try {
                const results = await buscarResoluciones({
                    criterio: args.consulta,
                    search_in: "sumarios",
                    sala: args.sala,
                    vocalia: args.vocalia,
                    competencia: args.competencia,
                    fechaDesde: args.fechaDesde,
                    fechaHasta: args.fechaHasta,
                    limit: args.limit
                });
                let md = `# TFN - Busqueda por sumarios\n\n**Consulta:** ${args.consulta}\n**Resultados:** ${results.data.length}\n\n`;
                if (results.data.length === 0) {
                    md += "No se encontraron resultados.\n";
                } else {
                    results.data.forEach((r, idx) => { md += formatFallo(r, idx, false); });
                }
                return { content: [{ type: "text", text: md }] };
            } catch (error) {
                return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
            }
        }
    );

    server.tool("obtener_filtros",
        "Obtiene los filtros disponibles para busqueda en el TFN (tribunales, salas, vocalias, competencias).",
        {},
        async () => {
            try {
                const apiBase = await resolveApiBase();
                const response = await axiosClient.get(`${apiBase}/filters`, {
                    timeout: API_TIMEOUT_MS,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Referer": "https://jurisprudenciatfn.mecon.gob.ar/"
                    }
                });
                const filters = response.data;
                let md = `# TFN - Filtros disponibles\n\n`;
                if (filters.tribunales) { md += `## Tribunales\n`; filters.tribunales.forEach(t => md += `- ${t}\n`); md += `\n`; }
                if (filters.salas) { md += `## Salas\n`; filters.salas.forEach(s => md += `- ${s}\n`); md += `\n`; }
                if (filters.vocalias) { md += `## Vocalias\n- Rango: 1 a ${Math.max(...filters.vocalias)}\n\n`; }
                if (filters.competencias) { md += `## Competencias\n`; filters.competencias.forEach(c => md += `- ${c}\n`); md += `\n`; }
                return { content: [{ type: "text", text: md }] };
            } catch (error) {
                return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
            }
        }
    );

    server.tool("obtener_ultimos_casos",
        "Obtiene los casos mas recientes publicados en el TFN.",
        {
            limit: z.number().optional().default(10).describe("Cantidad de casos (maximo 50)")
        },
        async (args) => {
            try {
                const apiBase = await resolveApiBase();
                const response = await axiosClient.get(`${apiBase}/latestCases`, {
                    timeout: API_TIMEOUT_MS,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Referer": "https://jurisprudenciatfn.mecon.gob.ar/"
                    }
                });
                const cases = (response.data.results || response.data || []).slice(0, Math.min(args.limit, 50));
                let md = `# TFN - Ultimos casos\n\n**Cantidad:** ${cases.length}\n\n`;
                cases.forEach((r, idx) => { md += formatFallo(r, idx, false); });
                return { content: [{ type: "text", text: md }] };
            } catch (error) {
                return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
            }
        }
    );

    server.tool("buscar_ultimos_impositivos",
        "Busca fallos impositivos recientes del TFN.",
        {
            criterio: z.string().optional().describe("Palabra clave (ej. 'IVA', 'Ganancias')"),
            fechaDesde: z.string().optional(),
            fechaHasta: z.string().optional(),
            limit: z.number().optional().default(20)
        },
        async (args) => {
            try {
                const results = await buscarResoluciones({ criterio: args.criterio, competencia: "impositiva", fechaDesde: args.fechaDesde, fechaHasta: args.fechaHasta, limit: args.limit });
                let md = `# TFN - Fallos impositivos recientes\n\n`;
                if (args.criterio) md += `**Criterio:** ${args.criterio}\n`;
                md += `**Competencia:** Impositiva\n**Resultados:** ${results.data.length}\n\n`;
                results.data.forEach((r, idx) => { md += formatFallo(r, idx, false); });
                return { content: [{ type: "text", text: md }] };
            } catch (error) {
                return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
            }
        }
    );

    server.tool("buscar_ultimos_aduaneros",
        "Busca fallos aduaneros recientes del TFN.",
        {
            criterio: z.string().optional().describe("Palabra clave (ej. 'importacion', 'valoracion aduanera')"),
            fechaDesde: z.string().optional(),
            fechaHasta: z.string().optional(),
            limit: z.number().optional().default(20)
        },
        async (args) => {
            try {
                const results = await buscarResoluciones({ criterio: args.criterio, competencia: "aduana", fechaDesde: args.fechaDesde, fechaHasta: args.fechaHasta, limit: args.limit });
                let md = `# TFN - Fallos aduaneros recientes\n\n`;
                if (args.criterio) md += `**Criterio:** ${args.criterio}\n`;
                md += `**Competencia:** Aduana\n**Resultados:** ${results.data.length}\n\n`;
                results.data.forEach((r, idx) => { md += formatFallo(r, idx, false); });
                return { content: [{ type: "text", text: md }] };
            } catch (error) {
                return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
            }
        }
    );

    server.tool("verificar_vigencia",
        "Verifica la disponibilidad y datos de un fallo en el sistema del TFN.",
        {
            id_fallo: z.string().describe("ID del fallo (registro o fallo_id)")
        },
        async (args) => {
            try {
                const detail = await obtenerResolucionTexto({ idResolucion: args.id_fallo });
                let md = `# TFN - Verificacion de fallo\n\n**ID:** \`${args.id_fallo}\`\n\n`;
                if (detail.error) {
                    md += `**Estado:** NO DISPONIBLE - ${detail.error}\n`;
                } else {
                    md += `**Estado:** DISPONIBLE\n\n`;
                    md += `## Datos\n`;
                    if (detail.expediente) md += `- **Expediente:** ${detail.expediente}\n`;
                    if (detail.registro) md += `- **Registro:** \`${detail.registro}\`\n`;
                    if (detail.sala) md += `- **Sala:** ${detail.sala}\n`;
                    if (detail.vocalia) md += `- **Vocalía:** ${detail.vocalia}\n`;
                    if (detail.competencia) md += `- **Competencia:** ${detail.competencia}\n`;
                    if (detail.fecha) md += `- **Fecha:** ${detail.fecha}\n`;
                    if (detail.dispositiva) md += `- **Resolucion:** ${detail.dispositiva}\n`;
                    if (detail.urlFallo) md += `\n[Ver en TFN](${detail.urlFallo})\n`;
                }
                return { content: [{ type: "text", text: md }] };
            } catch (error) {
                return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
            }
        }
    );

    server.tool("buscar_antecedentes",
        "Busca antecedentes jurisprudenciales sobre un tema especifico del TFN.",
        {
            tema: z.string().describe("Tema o doctrina a buscar (ej. 'responsabilidad solidaria', 'prescripcion', 'interes resarcitorio')"),
            competencia: z.enum(["impositiva", "aduana"]).optional(),
            sala: z.string().optional(),
            limit: z.number().optional().default(15)
        },
        async (args) => {
            try {
                const results = await buscarResoluciones({ criterio: args.tema, competencia: args.competencia, sala: args.sala, search_in: "sumarios", limit: args.limit });
                let md = `# TFN - Antecedentes jurisprudenciales\n\n**Tema:** ${args.tema}\n`;
                if (args.competencia) md += `**Competencia:** ${args.competencia}\n`;
                if (args.sala) md += `**Sala:** ${args.sala}\n`;
                md += `**Resultados:** ${results.data.length}\n\n`;
                if (results.data.length === 0) {
                    md += "No se encontraron antecedentes.\n";
                } else {
                    results.data.forEach((r, idx) => { md += formatFallo(r, idx, false); });
                }
                return { content: [{ type: "text", text: md }] };
            } catch (error) {
                return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
            }
        }
    );

    server.tool("alcance_fuente",
        "Informa las capacidades, fuentes de datos y limitaciones del conector TFN.",
        {},
        async () => {
            const text = [
                "# Alcance - Tribunal Fiscal de la Nacion (TFN)",
                "",
                "- **Fuente:** Sistema oficial del TFN (jurisprudenciatfn.mecon.gob.ar)",
                "- **Contenido disponible:** texto completo de fallos, doctrinas, objeto, dispositiva, sala, vocalía, competencia, fecha",
                "- **Nota:** el campo 'caratula' no es provisto por la API; los fallos se identifican por su ID de registro (formato INLEG-...#TFN)",
                "- **Búsqueda:** hibrida (semantica + lexica) sobre objetos o sumarios",
                "- **Cobertura:** TFN e instancias vinculadas (CNCAF)",
                "",
                "Este conector es automatizado con fines de investigacion legal y no constituye asesoramiento profesional."
            ].join("\n");
            return { content: [{ type: "text", text: text }] };
        }
    );

    // Prompts
    server.prompt("buscar_resoluciones", "Busca y analiza jurisprudencia del TFN.", {
        criterio: z.string().describe("Termino a buscar")
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Usa buscar_resoluciones_tfn para buscar fallos sobre: ${args.criterio}. Extrae los puntos clave y cita la fuente.` } }]
    }));

    server.prompt("buscar_por_hechos", "Busca jurisprudencia del TFN por hechos del caso.", {
        consulta: z.string().describe("Consulta en lenguaje natural")
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Usa tfn_buscar_por_hechos para buscar fallos del TFN relacionados con: ${args.consulta}. Resume los mas relevantes.` } }]
    }));

    server.prompt("buscar_antecedentes_tfn", "Busca antecedentes jurisprudenciales sobre un tema.", {
        tema: z.string().describe("Tema o doctrina"),
        competencia: z.enum(["impositiva", "aduana"]).optional(),
        sala: z.string().optional()
    }, (args) => ({
        messages: [{ role: "user", content: { type: "text", text: `Usa tfn_buscar_antecedentes para buscar antecedentes sobre: ${args.tema}${args.competencia ? ` (competencia ${args.competencia})` : ""}${args.sala ? ` sala ${args.sala}` : ""}. Resume los mas relevantes.` } }]
    }));
}

async function run() {
    const server = new McpServer({ name: "TFN MCP", version: "1.0.0" });
    registerAllTools(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("TFN MCP Server is running on stdio");
}

if (typeof process !== "undefined" && !process.env.VERCEL && !process.env.NEXT_RUNTIME) {
    run().catch(error => { console.error("Fatal error running server:", error); process.exit(1); });
}
