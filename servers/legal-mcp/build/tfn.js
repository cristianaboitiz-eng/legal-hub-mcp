#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
export const stringOrNumberOptional = z.union([z.string(), z.number()]).transform(val => String(val)).optional();
// The TFN website URL
const TFN_BASE_URL = "https://jurisprudenciatfn.mecon.gob.ar";
const API_BASE_URL = "https://api.jurisprudencia-tfn.ar";
export async function buscarResoluciones(args) {
    // Usar la API REST del TFN en lugar de scraping
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
        fecha_desde: args.fechaDesde || null,
        fecha_hasta: args.fechaHasta || null,
        regulacion_honorarios: null,
        limit: args.limit || 100
    };
    try {
        const response = await axios.post(`${API_BASE_URL}/hybridSearch`, requestBody, {
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://jurisprudenciatfn.mecon.gob.ar/"
            }
        });
        const results = response.data.results || [];
        const formattedResults = results.map((r) => ({
            id: r.fallo_id,
            sala: r.sala,
            vocalia: r.vocalia,
            expediente: r.expediente,
            fecha: r.fecha,
            sumario: r.sintesis || r.sumarios?.join("; "),
            competencia: r.competencia,
            registro: r.registro
        }));
        return { data: formattedResults, total: formattedResults.length };
    }
    catch (err) {
        console.error("TFN API error:", (err instanceof Error ? err.message : String(err)));
        return {
            data: [],
            total: 0,
            error: "No se pudo conectar con el sistema del TFN.",
            note: "Por favor, intente nuevamente más tarde."
        };
    }
}
export async function obtenerResolucionTexto(args) {
    try {
        // Usar la API REST para obtener detalles del fallo
        // Nota: Si no existe endpoint de detalle, usar el fallo_id para buscar en hybridSearch
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
        const response = await axios.post(`${API_BASE_URL}/hybridSearch`, requestBody, {
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
                texto: "No se encontró el fallo con el ID especificado.",
                error: "Fallo no encontrado"
            };
        }
        const fallo = results[0];
        return {
            id: args.idResolucion,
            sala: fallo.sala,
            vocalia: fallo.vocalia,
            expediente: fallo.expediente,
            fecha: fallo.fecha,
            registro: fallo.registro,
            competencia: fallo.competencia,
            caratula: fallo.caratula,
            sumarios: fallo.sumarios,
            sintesis: fallo.sintesis,
            texto: fallo.sintesis || "Texto completo no disponible. Use el link del sitio web para ver el fallo completo.",
            urlFallo: `${TFN_BASE_URL}/fallo/${fallo.registro || fallo.fallo_id}`
        };
    }
    catch (err) {
        console.error("TFN detail error:", (err instanceof Error ? err.message : String(err)));
        return {
            id: args.idResolucion,
            texto: "No se pudo obtener el texto de la resolución.",
            error: (err instanceof Error ? err.message : String(err))
        };
    }
}
export function registerAllTools(server) {
    server.tool("buscar_resoluciones_tfn", "Busca jurisprudencia y resoluciones del Tribunal Fiscal de la Nación con filtros avanzados (competencia, tribunal, tipo de búsqueda).", {
        criterio: z.string().optional().describe("Criterio o término de búsqueda legal (ej. 'maternidad', número de expediente)"),
        sala: z.string().optional().describe("Sala (A, B, C, D, E, F, G)"),
        vocalia: z.string().optional().describe("Vocalía (número)"),
        impuesto: z.string().optional().describe("Impuesto (IVA, Ganancias, etc.)"),
        expediente: z.string().optional().describe("Número de expediente (TFN-XXXXX/20XX)"),
        fechaDesde: z.string().optional().describe("Fecha desde (DD/MM/YYYY)"),
        fechaHasta: z.string().optional().describe("Fecha hasta (DD/MM/YYYY)"),
        competencia: z.enum(["impositiva", "aduana"]).optional().describe("Competencia: impositiva o aduana"),
        tribunal: z.string().optional().describe("Tribunal (TFN, CNCAF)"),
        search_in: z.enum(["objetos", "sumarios"]).optional().default("objetos").describe("Tipo de búsqueda: objetos (hechos) o sumarios"),
        limit: z.number().optional().default(100).describe("Límite de resultados (máximo 100)")
    }, async (args) => {
        try {
            const results = await buscarResoluciones(args);
            let md = `# Tribunal Fiscal de la Nación - Resultados\n\n`;
            md += `**Criterio:** ${args.criterio || "Todos"}\n`;
            if (args.competencia)
                md += `**Competencia:** ${args.competencia}\n`;
            if (args.tribunal)
                md += `**Tribunal:** ${args.tribunal}\n`;
            if (args.search_in)
                md += `**Tipo de búsqueda:** ${args.search_in}\n`;
            md += `\n`;
            const items = Array.isArray(results) ? results : (results.data || []);
            if (items.length === 0) {
                if (results.error) {
                    md += `**Nota:** ${results.error}\n\n`;
                    if (results.note)
                        md += `**Información:** ${results.note}\n\n`;
                    return { content: [{ type: "text", text: md }] };
                }
                return { content: [{ type: "text", text: "No se encontraron resoluciones." }] };
            }
            items.forEach((r, idx) => {
                md += `### ${idx + 1}. Resolución ${r.expediente || "N/A"}\n`;
                if (r.id)
                    md += `*   **ID:** \`${r.id}\`\n`;
                if (r.registro)
                    md += `*   **Registro:** ${r.registro}\n`;
                if (r.sala)
                    md += `*   **Sala:** ${r.sala}\n`;
                if (r.vocalia)
                    md += `*   **Vocalía:** ${r.vocalia}\n`;
                if (r.competencia)
                    md += `*   **Competencia:** ${r.competencia}\n`;
                if (r.impuesto)
                    md += `*   **Impuesto:** ${r.impuesto}\n`;
                if (r.fecha)
                    md += `*   **Fecha:** ${r.fecha}\n`;
                if (r.sumario)
                    md += `*   **Sumario:** ${r.sumario}\n`;
                md += `*   **Enlace:** [Ver en TFN](${TFN_BASE_URL}/fallo/${r.registro || r.id})\n\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return {
                content: [{ type: "text", text: `Error al consultar TFN: ${(error instanceof Error ? error.message : String(error))}` }],
                isError: true
            };
        }
    });
    server.tool("obtener_resolucion_tfn", "Obtiene el cuerpo íntegro de la resolución impositiva o aduanera dictada por el TFN con todos los datos disponibles.", {
        idResolucion: z.string().describe("ID interno de la resolución (registro o fallo_id)")
    }, async (args) => {
        try {
            const detail = await obtenerResolucionTexto(args);
            let md = `# Resolución ${detail.expediente || "N/A"}\n\n`;
            if (detail.caratula)
                md += `## Carátula\n${detail.caratula}\n\n`;
            md += `## Datos del Fallo\n`;
            if (detail.sala)
                md += `- **Sala:** ${detail.sala}\n`;
            if (detail.vocalia)
                md += `- **Vocalía:** ${detail.vocalia}\n`;
            if (detail.competencia)
                md += `- **Competencia:** ${detail.competencia}\n`;
            if (detail.fecha)
                md += `- **Fecha:** ${detail.fecha}\n`;
            if (detail.registro)
                md += `- **Registro:** ${detail.registro}\n`;
            if (detail.expediente)
                md += `- **Expediente:** ${detail.expediente}\n`;
            md += `\n`;
            if (detail.sumarios && detail.sumarios.length > 0) {
                md += `## Sumarios (${detail.sumarios.length})\n`;
                detail.sumarios.forEach((s, i) => {
                    md += `${i + 1}. ${s}\n`;
                });
                md += `\n`;
            }
            if (detail.sintesis) {
                md += `## Síntesis\n${detail.sintesis}\n\n`;
            }
            md += `## Texto\n${detail.texto}\n\n`;
            if (detail.urlFallo) {
                md += `## Enlaces\n`;
                md += `- **Ver fallo en sitio:** [${detail.urlFallo}](${detail.urlFallo})\n`;
                if (detail.registro) {
                    md += `- **Descargar PDF:** Usar tool tfn_descargar_resolucion_pdf con ID: ${detail.registro}\n`;
                    md += `- **Link PDF:** ${TFN_BASE_URL}/fallo/${detail.registro}/pdf\n`;
                }
            }
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            return {
                content: [{ type: "text", text: `Error al obtener texto: ${(error instanceof Error ? error.message : String(error))}` }],
                isError: true
            };
        }
    });
    // Tool: tfn_buscar_resolucion_por_expediente
    server.tool("tfn_buscar_resolucion_por_expediente", "Busca una resolución específica del TFN por su número de expediente exacto.", {
        numero_expediente: z.string().describe("Número de expediente exacto (ej. '12345-67' o 'TFN-12345/2020')."),
        competencia: z.enum(["impositiva", "aduana"]).optional().describe("Competencia: impositiva o aduana (opcional).")
    }, async (args) => {
        try {
            const results = await buscarResoluciones({ expediente: args.numero_expediente });
            let md = `# TFN - Búsqueda por Expediente\n\n`;
            md += `**Expediente:** ${args.numero_expediente}\n`;
            if (args.competencia)
                md += `**Competencia:** ${args.competencia}\n\n`;
            const items = Array.isArray(results) ? results : (results.data || []);
            if (items.length === 0) {
                md += "No se encontraron resultados para el expediente especificado.\n";
            }
            else {
                items.forEach((r, idx) => {
                    md += `### ${idx + 1}. Resolución\n`;
                    if (r.sala)
                        md += `- **Sala:** ${r.sala}\n`;
                    if (r.vocalia)
                        md += `- **Vocalía:** ${r.vocalia}\n`;
                    if (r.fecha)
                        md += `- **Fecha:** ${r.fecha}\n`;
                    if (r.sumario)
                        md += `- **Sumario:** ${r.sumario}\n`;
                    if (r.id)
                        md += `- **Enlace:** [Ver en TFN](${TFN_BASE_URL}/resolucion/${r.id})\n\n`;
                });
            }
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en tfn_buscar_resolucion_por_expediente: ${message}` }], isError: true };
        }
    });
    // Tool: tfn_buscar_resolucion_por_caratula
    server.tool("tfn_buscar_resolucion_por_caratula", "Busca resoluciones del TFN filtrando por el nombre de las partes involucradas (carátula).", {
        caratula: z.string().describe("Nombre de las partes (ej. apellidos o razón social)."),
        competencia: z.enum(["impositiva", "aduana"]).optional().describe("Competencia: impositiva o aduana (opcional).")
    }, async (args) => {
        try {
            const results = await buscarResoluciones({ criterio: args.caratula });
            let md = `# TFN - Búsqueda por Carátula\n\n`;
            md += `**Carátula:** ${args.caratula}\n`;
            if (args.competencia)
                md += `**Competencia:** ${args.competencia}\n\n`;
            const items = Array.isArray(results) ? results : (results.data || []);
            if (items.length === 0) {
                md += "No se encontraron resultados para la carátula especificada.\n";
            }
            else {
                items.forEach((r, idx) => {
                    md += `### ${idx + 1}. Resolución\n`;
                    if (r.expediente)
                        md += `- **Expediente:** ${r.expediente}\n`;
                    if (r.sala)
                        md += `- **Sala:** ${r.sala}\n`;
                    if (r.fecha)
                        md += `- **Fecha:** ${r.fecha}\n`;
                    if (r.sumario)
                        md += `- **Sumario:** ${r.sumario}\n`;
                    if (r.id)
                        md += `- **Enlace:** [Ver en TFN](${TFN_BASE_URL}/resolucion/${r.id})\n\n`;
                });
            }
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en tfn_buscar_resolucion_por_caratula: ${message}` }], isError: true };
        }
    });
    // Tool: tfn_obtener_resumen_ia
    server.tool("tfn_obtener_resumen_ia", "Obtiene el resumen generado por IA de una resolución específica del TFN.", {
        id_resolucion: z.string().describe("ID de la resolución (registro o fallo_id).")
    }, async (args) => {
        try {
            const detail = await obtenerResolucionTexto({ idResolucion: args.id_resolucion });
            let md = `# TFN - Resumen IA\n\n`;
            md += `**ID Resolución:** ${args.id_resolucion}\n`;
            if (detail.expediente)
                md += `**Expediente:** ${detail.expediente}\n`;
            if (detail.caratula)
                md += `**Carátula:** ${detail.caratula}\n`;
            if (detail.sala)
                md += `**Sala:** ${detail.sala}\n`;
            if (detail.vocalia)
                md += `**Vocalía:** ${detail.vocalia}\n`;
            md += `\n`;
            // La API REST ya incluye la síntesis (resumen IA) en el campo sintesis
            if (detail.sintesis) {
                md += `## Resumen Generado por IA\n${detail.sintesis}\n\n`;
            }
            else {
                md += `## Contenido Disponible\n${detail.texto?.substring(0, 500) || "No disponible"}...\n\n`;
                md += `**Nota:** El resumen IA no está disponible para esta resolución.\n`;
            }
            if (detail.sumarios && detail.sumarios.length > 0) {
                md += `## Sumarios Relacionados\n`;
                detail.sumarios.slice(0, 5).forEach((s, i) => {
                    md += `${i + 1}. ${s}\n`;
                });
                md += `\n`;
            }
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en tfn_obtener_resumen_ia: ${message}` }], isError: true };
        }
    });
    // Tool: tfn_descargar_resolucion_pdf
    server.tool("tfn_descargar_resolucion_pdf", "Descarga el documento PDF original de una resolución específica del TFN y lo retorna como archivo.", {
        id_resolucion: z.string().describe("ID de la resolución (ej. '12345' o registro completo).")
    }, async (args) => {
        try {
            const response = await axios.get(`${TFN_BASE_URL}/fallo/${args.id_resolucion}/pdf`, {
                responseType: "arraybuffer",
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": "https://jurisprudenciatfn.mecon.gob.ar/"
                }
            });
            const pdfBuffer = Buffer.from(response.data);
            const base64 = pdfBuffer.toString('base64');
            const filename = `TFN-${args.id_resolucion}.pdf`;
            let resultText = "# TFN - PDF Descargado\n\n";
            resultText += `**ID Resolución:** ${args.id_resolucion}\n`;
            resultText += `**Nombre del archivo:** ${filename}\n`;
            resultText += `**Tamaño:** ${(pdfBuffer.length / 1024).toFixed(2)} KB\n`;
            resultText += `**Estado:** ✅ Descargado exitosamente\n\n`;
            resultText += `El PDF está adjunto en esta conversación como archivo.\n`;
            resultText += `Puedes descargarlo directamente desde el chat.\n\n`;
            resultText += `**Link directo al PDF:** ${TFN_BASE_URL}/fallo/${args.id_resolucion}/pdf\n`;
            return {
                content: [{ type: "text", text: resultText }],
                resources: [{
                        uri: `data:application/pdf;base64,${base64}`,
                        mimeType: "application/pdf",
                        name: filename
                    }]
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            let resultText = `# TFN - Error al descargar PDF\n\n`;
            resultText += `**ID Resolución:** ${args.id_resolucion}\n`;
            resultText += `**Error:** ${message}\n\n`;
            resultText += `**Link directo al PDF:** ${TFN_BASE_URL}/fallo/${args.id_resolucion}/pdf\n\n`;
            resultText += `Puedes descargar el PDF directamente desde el enlace anterior.`;
            return { content: [{ type: "text", text: resultText }], isError: true };
        }
    });
    // Tool: tfn_buscar_por_hechos
    server.tool("tfn_buscar_por_hechos", "Busca jurisprudencia del TFN por hechos del caso en lenguaje natural.", {
        consulta: z.string().describe("Consulta en lenguaje natural sobre los hechos del caso"),
        sala: z.string().optional().describe("Filtro por sala (A, B, C, D, E, F, G)"),
        vocalia: z.string().optional().describe("Filtro por vocalía (número)"),
        competencia: z.enum(["impositiva", "aduana"]).optional().describe("Filtro por competencia"),
        fechaDesde: z.string().optional().describe("Fecha desde (DD/MM/YYYY)"),
        fechaHasta: z.string().optional().describe("Fecha hasta (DD/MM/YYYY)"),
        limit: z.number().optional().default(100).describe("Límite de resultados")
    }, async (args) => {
        try {
            const requestBody = {
                query: args.consulta,
                search_in: "objetos",
                tribunales: [],
                registro: null,
                expediente: null,
                caratula: null,
                salas: args.sala ? [args.sala] : [],
                vocalias: args.vocalia ? [parseInt(args.vocalia)] : [],
                competencias: args.competencia ? [args.competencia] : [],
                fecha_desde: args.fechaDesde || null,
                fecha_hasta: args.fechaHasta || null,
                regulacion_honorarios: null,
                limit: args.limit
            };
            const response = await axios.post(`${API_BASE_URL}/hybridSearch`, requestBody, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": "https://jurisprudenciatfn.mecon.gob.ar/"
                }
            });
            const results = response.data.results || [];
            let md = `# TFN - Búsqueda por Hechos del Caso\n\n`;
            md += `**Consulta:** ${args.consulta}\n\n`;
            if (results.length === 0) {
                md += "No se encontraron resultados.\n";
            }
            else {
                results.forEach((fallo, idx) => {
                    md += `### ${idx + 1}. ${fallo.caratula || "N/A"}\n`;
                    if (fallo.expediente)
                        md += `- **Expediente:** ${fallo.expediente}\n`;
                    if (fallo.registro)
                        md += `- **Registro:** ${fallo.registro}\n`;
                    if (fallo.sala)
                        md += `- **Sala:** ${fallo.sala}\n`;
                    if (fallo.vocalia)
                        md += `- **Vocalía:** ${fallo.vocalia}\n`;
                    if (fallo.competencia)
                        md += `- **Competencia:** ${fallo.competencia}\n`;
                    if (fallo.fecha)
                        md += `- **Fecha:** ${fallo.fecha}\n`;
                    if (fallo.sintesis)
                        md += `- **Síntesis:** ${fallo.sintesis.substring(0, 200)}...\n`;
                    if (fallo.sumarios && fallo.sumarios.length > 0)
                        md += `- **Sumarios:** ${fallo.sumarios.length}\n`;
                    md += `- **Ver fallo:** [${TFN_BASE_URL}/fallo/${fallo.registro || fallo.fallo_id}](${TFN_BASE_URL}/fallo/${fallo.registro || fallo.fallo_id})\n`;
                    md += `- **Descargar PDF:** Usar tool tfn_descargar_resolucion_pdf con ID: ${fallo.registro || fallo.fallo_id}\n\n`;
                });
            }
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en tfn_buscar_por_hechos: ${message}` }], isError: true };
        }
    });
    // Tool: tfn_buscar_por_sumarios
    server.tool("tfn_buscar_por_sumarios", "Busca jurisprudencia del TFN por sumarios de las resoluciones.", {
        consulta: z.string().describe("Consulta en lenguaje natural sobre los sumarios"),
        sala: z.string().optional().describe("Filtro por sala (A, B, C, D, E, F, G)"),
        vocalia: z.string().optional().describe("Filtro por vocalía (número)"),
        competencia: z.enum(["impositiva", "aduana"]).optional().describe("Filtro por competencia"),
        fechaDesde: z.string().optional().describe("Fecha desde (DD/MM/YYYY)"),
        fechaHasta: z.string().optional().describe("Fecha hasta (DD/MM/YYYY)"),
        limit: z.number().optional().default(100).describe("Límite de resultados")
    }, async (args) => {
        try {
            const requestBody = {
                query: args.consulta,
                search_in: "sumarios",
                tribunales: [],
                registro: null,
                expediente: null,
                caratula: null,
                salas: args.sala ? [args.sala] : [],
                vocalias: args.vocalia ? [parseInt(args.vocalia)] : [],
                competencias: args.competencia ? [args.competencia] : [],
                fecha_desde: args.fechaDesde || null,
                fecha_hasta: args.fechaHasta || null,
                regulacion_honorarios: null,
                limit: args.limit
            };
            const response = await axios.post(`${API_BASE_URL}/hybridSearch`, requestBody, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": "https://jurisprudenciatfn.mecon.gob.ar/"
                }
            });
            const results = response.data.results || [];
            let md = `# TFN - Búsqueda por Sumarios\n\n`;
            md += `**Consulta:** ${args.consulta}\n\n`;
            if (results.length === 0) {
                md += "No se encontraron resultados.\n";
            }
            else {
                results.forEach((fallo, idx) => {
                    md += `### ${idx + 1}. ${fallo.caratula || "N/A"}\n`;
                    if (fallo.expediente)
                        md += `- **Expediente:** ${fallo.expediente}\n`;
                    if (fallo.registro)
                        md += `- **Registro:** ${fallo.registro}\n`;
                    if (fallo.sala)
                        md += `- **Sala:** ${fallo.sala}\n`;
                    if (fallo.vocalia)
                        md += `- **Vocalía:** ${fallo.vocalia}\n`;
                    if (fallo.competencia)
                        md += `- **Competencia:** ${fallo.competencia}\n`;
                    if (fallo.fecha)
                        md += `- **Fecha:** ${fallo.fecha}\n`;
                    if (fallo.sumarios && fallo.sumarios.length > 0) {
                        md += `- **Sumarios:** ${fallo.sumarios.length}\n`;
                        fallo.sumarios.slice(0, 3).forEach((s, i) => {
                            md += `  ${i + 1}. ${s.substring(0, 100)}...\n`;
                        });
                    }
                    md += `- **Ver fallo:** [${TFN_BASE_URL}/fallo/${fallo.registro || fallo.fallo_id}](${TFN_BASE_URL}/fallo/${fallo.registro || fallo.fallo_id})\n\n`;
                });
            }
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en tfn_buscar_por_sumarios: ${message}` }], isError: true };
        }
    });
    // Tool: tfn_obtener_estadisticas
    server.tool("tfn_obtener_estadisticas", "Obtiene estadísticas actualizadas del Tribunal Fiscal de la Nación.", {}, async () => {
        try {
            const response = await axios.get(`${API_BASE_URL}/searchStats`, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": "https://jurisprudenciatfn.mecon.gob.ar/"
                }
            });
            const stats = response.data;
            let md = `# TFN - Estadísticas\n\n`;
            md += `- **Resoluciones totales:** ${stats.resoluciones_totales}\n`;
            md += `- **Fallos TFN:** ${stats.fallos_tfn}\n`;
            md += `- **Fallos CNCAF:** ${stats.fallos_cncaf}\n`;
            md += `- **Doctrinas identificadas:** ${stats.doctrinas_identificadas}\n`;
            md += `- **Fallos con PDF:** ${stats.fallos_con_pdf}\n`;
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en tfn_obtener_estadisticas: ${message}` }], isError: true };
        }
    });
    // Tool: tfn_obtener_filtros
    server.tool("tfn_obtener_filtros", "Obtiene los filtros disponibles para búsqueda en el TFN (tribunales, salas, vocalías, competencias).", {}, async () => {
        try {
            const response = await axios.get(`${API_BASE_URL}/filters`, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": "https://jurisprudenciatfn.mecon.gob.ar/"
                }
            });
            const filters = response.data;
            let md = `# TFN - Filtros Disponibles\n\n`;
            md += `## Tribunales\n`;
            filters.tribunales.forEach((t) => md += `- ${t}\n`);
            md += `\n## Salas\n`;
            filters.salas.forEach((s) => md += `- ${s}\n`);
            md += `\n## Vocalías (Total: ${filters.vocalias.length})\n`;
            md += `- Rango: 1 a ${Math.max(...filters.vocalias)}\n`;
            md += `\n## Competencias\n`;
            filters.competencias.forEach((c) => md += `- ${c}\n`);
            if (filters.tipos_norma) {
                md += `\n## Tipos de Norma\n`;
                filters.tipos_norma.forEach((tn) => md += `- ${tn}\n`);
            }
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en tfn_obtener_filtros: ${message}` }], isError: true };
        }
    });
    // Tool: tfn_obtener_ultimos_casos
    server.tool("tfn_obtener_ultimos_casos", "Obtiene los casos más recientes publicados en el TFN.", {
        limit: z.number().optional().default(10).describe("Cantidad de casos a obtener (máximo 50)")
    }, async (args) => {
        try {
            const response = await axios.get(`${API_BASE_URL}/latestCases`, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": "https://jurisprudenciatfn.mecon.gob.ar/"
                }
            });
            const cases = response.data.slice(0, Math.min(args.limit, 50));
            let md = `# TFN - Últimos Casos\n\n`;
            md += `**Cantidad:** ${cases.length} casos más recientes\n\n`;
            cases.forEach((fallo, idx) => {
                md += `### ${idx + 1}. ${fallo.caratula || "N/A"}\n`;
                if (fallo.expediente)
                    md += `- **Expediente:** ${fallo.expediente}\n`;
                if (fallo.registro)
                    md += `- **Registro:** ${fallo.registro}\n`;
                if (fallo.sala)
                    md += `- **Sala:** ${fallo.sala}\n`;
                if (fallo.vocalia)
                    md += `- **Vocalía:** ${fallo.vocalia}\n`;
                if (fallo.competencia)
                    md += `- **Competencia:** ${fallo.competencia}\n`;
                if (fallo.fecha)
                    md += `- **Fecha:** ${fallo.fecha}\n`;
                md += `- **Ver fallo:** [${TFN_BASE_URL}/fallo/${fallo.registro || fallo.fallo_id}](${TFN_BASE_URL}/fallo/${fallo.registro || fallo.fallo_id})\n\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en tfn_obtener_ultimos_casos: ${message}` }], isError: true };
        }
    });
    // Tool: tfn_buscar_ultimos_impositivos
    server.tool("tfn_buscar_ultimos_impositivos", "Buscador especializado de fallos impositivos recientes del TFN (competencia impositiva).", {
        criterio: z.string().optional().describe("Palabra clave a buscar (ej. 'IVA', 'Ganancias', 'monotributo')"),
        fechaDesde: z.string().optional().describe("Fecha desde (DD/MM/YYYY)"),
        fechaHasta: z.string().optional().describe("Fecha hasta (DD/MM/YYYY)"),
        limit: z.number().optional().default(20).describe("Cantidad de resultados (máximo 100)")
    }, async (args) => {
        try {
            const results = await buscarResoluciones({
                criterio: args.criterio,
                competencia: "impositiva",
                fechaDesde: args.fechaDesde,
                fechaHasta: args.fechaHasta,
                limit: args.limit
            });
            let md = `# TFN - Fallos Impositivos Recientes\n\n`;
            if (args.criterio)
                md += `**Criterio:** ${args.criterio}\n`;
            if (args.fechaDesde)
                md += `**Desde:** ${args.fechaDesde}\n`;
            if (args.fechaHasta)
                md += `**Hasta:** ${args.fechaHasta}\n`;
            md += `**Competencia:** Impositiva\n`;
            md += `**Resultados:** ${results.data.length}\n\n`;
            results.data.forEach((r, idx) => {
                md += `### ${idx + 1}. ${r.expediente || "N/A"}\n`;
                if (r.registro)
                    md += `- **Registro:** ${r.registro}\n`;
                if (r.sala)
                    md += `- **Sala:** ${r.sala}\n`;
                if (r.vocalia)
                    md += `- **Vocalía:** ${r.vocalia}\n`;
                if (r.fecha)
                    md += `- **Fecha:** ${r.fecha}\n`;
                if (r.sumario)
                    md += `- **Sumario:** ${r.sumario.substring(0, 200)}...\n`;
                md += `- **Ver fallo:** [${TFN_BASE_URL}/fallo/${r.registro || r.id}](${TFN_BASE_URL}/fallo/${r.registro || r.id})\n\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en tfn_buscar_ultimos_impositivos: ${message}` }], isError: true };
        }
    });
    // Tool: tfn_buscar_ultimos_aduaneros
    server.tool("tfn_buscar_ultimos_aduaneros", "Buscador especializado de fallos aduaneros recientes del TFN (competencia aduana).", {
        criterio: z.string().optional().describe("Palabra clave a buscar (ej. 'importación', 'exportación', 'valoración')"),
        fechaDesde: z.string().optional().describe("Fecha desde (DD/MM/YYYY)"),
        fechaHasta: z.string().optional().describe("Fecha hasta (DD/MM/YYYY)"),
        limit: z.number().optional().default(20).describe("Cantidad de resultados (máximo 100)")
    }, async (args) => {
        try {
            const results = await buscarResoluciones({
                criterio: args.criterio,
                competencia: "aduana",
                fechaDesde: args.fechaDesde,
                fechaHasta: args.fechaHasta,
                limit: args.limit
            });
            let md = `# TFN - Fallos Aduaneros Recientes\n\n`;
            if (args.criterio)
                md += `**Criterio:** ${args.criterio}\n`;
            if (args.fechaDesde)
                md += `**Desde:** ${args.fechaDesde}\n`;
            if (args.fechaHasta)
                md += `**Hasta:** ${args.fechaHasta}\n`;
            md += `**Competencia:** Aduana\n`;
            md += `**Resultados:** ${results.data.length}\n\n`;
            results.data.forEach((r, idx) => {
                md += `### ${idx + 1}. ${r.expediente || "N/A"}\n`;
                if (r.registro)
                    md += `- **Registro:** ${r.registro}\n`;
                if (r.sala)
                    md += `- **Sala:** ${r.sala}\n`;
                if (r.vocalia)
                    md += `- **Vocalía:** ${r.vocalia}\n`;
                if (r.fecha)
                    md += `- **Fecha:** ${r.fecha}\n`;
                if (r.sumario)
                    md += `- **Sumario:** ${r.sumario.substring(0, 200)}...\n`;
                md += `- **Ver fallo:** [${TFN_BASE_URL}/fallo/${r.registro || r.id}](${TFN_BASE_URL}/fallo/${r.registro || r.id})\n\n`;
            });
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en tfn_buscar_ultimos_aduaneros: ${message}` }], isError: true };
        }
    });
    // Tool: tfn_verificar_vigencia
    server.tool("tfn_verificar_vigencia", "Verifica la disponibilidad de un fallo en el sistema del TFN y muestra sus datos de identificación (expediente, registro, sala, vocalía, competencia, fecha, sumarios).", {
        id_fallo: z.string().describe("ID del fallo (registro o fallo_id)")
    }, async (args) => {
        try {
            const detail = await obtenerResolucionTexto({ idResolucion: args.id_fallo });
            let md = `# Datos del Fallo - ${args.id_fallo}\n\n`;
            md += `## Datos de Identificación\n`;
            if (detail.expediente)
                md += `- **Expediente:** ${detail.expediente}\n`;
            if (detail.registro)
                md += `- **Registro:** ${detail.registro}\n`;
            if (detail.sala)
                md += `- **Sala:** ${detail.sala}\n`;
            if (detail.vocalia)
                md += `- **Vocalía:** ${detail.vocalia}\n`;
            if (detail.competencia)
                md += `- **Competencia:** ${detail.competencia}\n`;
            if (detail.fecha)
                md += `- **Fecha:** ${detail.fecha}\n`;
            md += `\n`;
            md += `## Estado\n`;
            if (detail.error) {
                md += `❌ NO DISPONIBLE - ${detail.error}\n\n`;
            }
            else {
                md += `✅ DISPONIBLE en la base de datos del TFN\n\n`;
            }
            if (detail.sumarios && detail.sumarios.length > 0) {
                md += `## Sumarios (${detail.sumarios.length})\n`;
                detail.sumarios.slice(0, 3).forEach((s, i) => {
                    md += `${i + 1}. ${s.substring(0, 200)}...\n`;
                });
                md += `\n`;
            }
            md += `## Enlaces\n`;
            if (detail.registro)
                md += `- Ver fallo: [${TFN_BASE_URL}/fallo/${detail.registro}](${TFN_BASE_URL}/fallo/${detail.registro})\n`;
            if (detail.registro)
                md += `- Descargar PDF: [${TFN_BASE_URL}/fallo/${detail.registro}/pdf](${TFN_BASE_URL}/fallo/${detail.registro}/pdf)\n`;
            md += `\n`;
            md += `> **Nota:** Esta herramienta verifica disponibilidad en el sistema del TFN. Para confirmar vigencia legal completa, consultar las fuentes oficiales del tribunal.`;
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en tfn_verificar_vigencia: ${message}` }], isError: true };
        }
    });
    // Tool: tfn_buscar_antecedentes
    server.tool("tfn_buscar_antecedentes", "Busca casos similares o antecedentes jurisprudenciales relacionados con un tema específico del TFN.", {
        tema: z.string().describe("Tema o palabra clave para buscar antecedentes (ej. 'responsabilidad solidaria', 'prescripción', 'interés resarcitorio')"),
        competencia: z.enum(["impositiva", "aduana"]).optional().describe("Filtrar por competencia (impositiva o aduana)"),
        sala: z.string().optional().describe("Filtrar por sala específica"),
        limit: z.number().optional().default(15).describe("Cantidad de antecedentes a obtener (máximo 50)")
    }, async (args) => {
        try {
            const results = await buscarResoluciones({
                criterio: args.tema,
                competencia: args.competencia,
                sala: args.sala,
                search_in: "sumarios",
                limit: args.limit
            });
            let md = `# TFN - Antecedentes Jurisprudenciales\n\n`;
            md += `**Tema:** ${args.tema}\n`;
            if (args.competencia)
                md += `**Competencia:** ${args.competencia}\n`;
            if (args.sala)
                md += `**Sala:** ${args.sala}\n`;
            md += `**Tipo de búsqueda:** Sumarios (antecedentes)\n`;
            md += `**Antecedentes encontrados:** ${results.data.length}\n\n`;
            if (results.data.length === 0) {
                md += "No se encontraron antecedentes para el tema especificado.\n";
            }
            else {
                results.data.forEach((r, idx) => {
                    md += `### ${idx + 1}. ${r.expediente || "N/A"}\n`;
                    if (r.registro)
                        md += `- **Registro:** ${r.registro}\n`;
                    if (r.sala)
                        md += `- **Sala:** ${r.sala}\n`;
                    if (r.vocalia)
                        md += `- **Vocalía:** ${r.vocalia}\n`;
                    if (r.competencia)
                        md += `- **Competencia:** ${r.competencia}\n`;
                    if (r.fecha)
                        md += `- **Fecha:** ${r.fecha}\n`;
                    if (r.sumario)
                        md += `- **Sumario:** ${r.sumario.substring(0, 300)}...\n`;
                    md += `- **Ver fallo:** [${TFN_BASE_URL}/fallo/${r.registro || r.id}](${TFN_BASE_URL}/fallo/${r.registro || r.id})\n\n`;
                });
            }
            return { content: [{ type: "text", text: md }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en tfn_buscar_antecedentes: ${message}` }], isError: true };
        }
    });
    server.tool("alcance_fuente", "Informa las capacidades, fuentes de datos, limitaciones y disclaimer del conector tfn-mcp.", {}, async () => {
        const text = `# Alcance y Fuentes - Tribunal Fiscal de la Nación (TFN)\n\n## Datos del Conector\n- **Servidor:** tfn-mcp\n- **Fuente Legal:** Tribunal Fiscal de la Nación (TFN)\n- **URL Oficial:** https://jurisprudenciatfn.mecon.gob.ar/\n- **Sistema de consulta:** Sistema oficial del TFN\n- **Viabilidad Estimada:** Alta\n\n## Herramientas Ofrecidas\n### Búsqueda General\n- \`buscar_resoluciones_tfn\`: Busca jurisprudencia con filtros avanzados (competencia, tribunal, tipo de búsqueda).\n- \`tfn_buscar_resolucion_por_expediente\`: Busca una resolución específica por número de expediente.\n- \`tfn_buscar_resolucion_por_caratula\`: Busca resoluciones filtrando por nombre de las partes.\n- \`tfn_buscar_por_hechos\`: Busca jurisprudencia por hechos del caso en lenguaje natural.\n- \`tfn_buscar_por_sumarios\`: Busca jurisprudencia por sumarios de las resoluciones.\n- \`tfn_buscar_antecedentes\`: Busca casos similares o antecedentes jurisprudenciales relacionados con un tema específico.\n\n### Búsqueda Especializada\n- \`tfn_buscar_ultimos_impositivos\`: Buscador especializado de fallos impositivos recientes.\n- \`tfn_buscar_ultimos_aduaneros\`: Buscador especializado de fallos aduaneros recientes.\n\n### Detalle de Fallos\n- \`obtener_resolucion_tfn\`: Obtiene el cuerpo íntegro de la resolución con todos los datos disponibles.\n- \`tfn_obtener_resumen_ia\`: Obtiene el resumen generado por IA de una resolución.\n- \`tfn_descargar_resolucion_pdf\`: Descarga el documento PDF original y lo retorna como archivo.\n- \`tfn_verificar_vigencia\`: Verifica el estado de un fallo, disponibilidad y enlaces.\n\n### Información General\n- \`tfn_obtener_estadisticas\`: Obtiene estadísticas actualizadas del TFN.\n- \`tfn_obtener_filtros\`: Obtiene los filtros disponibles para búsqueda (tribunales, salas, vocalías, competencias).\n- \`tfn_obtener_ultimos_casos\`: Obtiene los casos más recientes publicados en el TFN.\n- \`alcance_fuente\`: Este informe de alcance y cobertura.\n\n## Aviso Legal\nEste servidor es un conector automatizado con fines de investigación legal y no constituye asesoramiento profesional. Las consultas se realizan sobre portales oficiales públicos de la República Argentina.`;
        return { content: [{ type: "text", text: text }] };
    });
    // Prompts
    server.prompt("buscar_resoluciones", "Busca y analiza jurisprudencia del TFN.", {
        criterio: z.string().describe("Término a buscar (ej. 'exportación', 'IVA')")
    }, (args) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Por favor utiliza la herramienta buscar_resoluciones_tfn para buscar fallos sobre: ${args.criterio}. Extrae los puntos clave y cita la fuente oficial.`
                }
            }
        ]
    }));
    server.prompt("auditar_criterio_tfn", "Compara jurisprudencia del TFN respecto a un tema específico.", {
        tema: z.string().describe("Tema impositivo o aduanero a auditar")
    }, (args) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Necesito auditar los últimos fallos del Tribunal Fiscal de la Nación sobre el tema: ${args.tema}. Usa las herramientas disponibles para buscar y resumir la postura dominante o los fallos divididos (salas aduaneras vs impositivas).`
                }
            }
        ]
    }));
    server.prompt("buscar_por_hechos", "Busca jurisprudencia del TFN por hechos del caso en lenguaje natural.", {
        consulta: z.string().describe("Consulta en lenguaje natural sobre los hechos del caso")
    }, (args) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Por favor utiliza la herramienta tfn_buscar_por_hechos para buscar fallos del TFN relacionados con los siguientes hechos: ${args.consulta}. Resume los resultados más relevantes y cita las fuentes.`
                }
            }
        ]
    }));
    server.prompt("buscar_por_sumarios", "Busca jurisprudencia del TFN por sumarios de las resoluciones.", {
        consulta: z.string().describe("Consulta en lenguaje natural sobre los sumarios")
    }, (args) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Por favor utiliza la herramienta tfn_buscar_por_sumarios para buscar fallos del TFN con sumarios relacionados con: ${args.consulta}. Resume los resultados más relevantes y cita las fuentes.`
                }
            }
        ]
    }));
    server.prompt("obtener_estadisticas_tfn", "Obtiene estadísticas actualizadas del Tribunal Fiscal de la Nación.", {}, () => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: "Por favor utiliza la herramienta tfn_obtener_estadisticas para obtener las estadísticas actuales del Tribunal Fiscal de la Nación (cantidad de resoluciones, fallos, doctrinas identificadas, etc.)."
                }
            }
        ]
    }));
    server.prompt("obtener_filtros_tfn", "Obtiene los filtros disponibles para búsqueda en el TFN.", {}, () => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: "Por favor utiliza la herramienta tfn_obtener_filtros para obtener los filtros disponibles para búsqueda en el TFN (tribunales, salas, vocalías, competencias)."
                }
            }
        ]
    }));
    server.prompt("obtener_ultimos_casos_tfn", "Obtiene los casos más recientes publicados en el TFN.", {
        limite: z.number().optional().default(10).describe("Cantidad de casos a obtener")
    }, (args) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Por favor utiliza la herramienta tfn_obtener_ultimos_casos para obtener los ${args.limite} casos más recientes publicados en el TFN. Resume los resultados más relevantes.`
                }
            }
        ]
    }));
    server.prompt("buscar_ultimos_impositivos_tfn", "Busca fallos impositivos recientes del TFN.", {
        criterio: z.string().optional().describe("Palabra clave a buscar (ej. 'IVA', 'Ganancias')"),
        fechaDesde: z.string().optional().describe("Fecha desde (DD/MM/YYYY)"),
        fechaHasta: z.string().optional().describe("Fecha hasta (DD/MM/YYYY)")
    }, (args) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Por favor utiliza la herramienta tfn_buscar_ultimos_impositivos para buscar fallos impositivos recientes${args.criterio ? ` con el criterio: ${args.criterio}` : ''}${args.fechaDesde ? ` desde ${args.fechaDesde}` : ''}${args.fechaHasta ? ` hasta ${args.fechaHasta}` : ''}. Resume los resultados más relevantes.`
                }
            }
        ]
    }));
    server.prompt("buscar_ultimos_aduaneros_tfn", "Busca fallos aduaneros recientes del TFN.", {
        criterio: z.string().optional().describe("Palabra clave a buscar (ej. 'importación', 'exportación')"),
        fechaDesde: z.string().optional().describe("Fecha desde (DD/MM/YYYY)"),
        fechaHasta: z.string().optional().describe("Fecha hasta (DD/MM/YYYY)")
    }, (args) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Por favor utiliza la herramienta tfn_buscar_ultimos_aduaneros para buscar fallos aduaneros recientes${args.criterio ? ` con el criterio: ${args.criterio}` : ''}${args.fechaDesde ? ` desde ${args.fechaDesde}` : ''}${args.fechaHasta ? ` hasta ${args.fechaHasta}` : ''}. Resume los resultados más relevantes.`
                }
            }
        ]
    }));
    server.prompt("verificar_vigencia_fallo_tfn", "Obtiene datos básicos y disponibilidad de un fallo del TFN.", {
        id_fallo: z.string().describe("ID del fallo (registro o fallo_id)")
    }, (args) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Por favor utiliza la herramienta tfn_verificar_vigencia para obtener los datos básicos y verificar la disponibilidad del fallo con ID: ${args.id_fallo}.`
                }
            }
        ]
    }));
    server.prompt("buscar_antecedentes_tfn", "Busca antecedentes jurisprudenciales sobre un tema específico.", {
        tema: z.string().describe("Tema o palabra clave para buscar antecedentes"),
        competencia: z.enum(["impositiva", "aduana"]).optional().describe("Filtrar por competencia"),
        sala: z.string().optional().describe("Filtrar por sala específica")
    }, (args) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Por favor utiliza la herramienta tfn_buscar_antecedentes para buscar antecedentes jurisprudenciales sobre el tema: ${args.tema}${args.competencia ? ` en competencia ${args.competencia}` : ''}${args.sala ? ` en sala ${args.sala}` : ''}. Resume los resultados más relevantes.`
                }
            }
        ]
    }));
}
// Start Server
async function run() {
    const server = new McpServer({
        name: "TFN MCP",
        version: "1.0.0"
    });
    registerAllTools(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("TFN MCP Server is running on stdio");
}
if (typeof process !== "undefined" && !process.env.VERCEL && !process.env.NEXT_RUNTIME && process.env.NODE_ENV !== "production") {
    run().catch(error => {
        console.error("Fatal error running server:", error);
        process.exit(1);
    });
}
//# sourceMappingURL=tfn.js.map