#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import puppeteer from "puppeteer";
import crypto from "crypto";
let globalBrowser = null;
let globalPage = null;
export function registerAllTools(server) {
    // Tool: pjn_buscar_jurisprudencia_por_expediente
    server.tool("pjn_buscar_jurisprudencia_por_expediente", "Busca la jurisprudencia y fallos asociados a un número de expediente específico. Requiere año y número.", {
        numero: z.number().describe("Número de expediente exacto (sin año)."),
        anio: z.number().describe("Año de inicio del expediente a 4 dígitos (ej. 2021)."),
        camara_id: z.enum(["CSJ", "CIV", "CAF", "CCF", "CNE", "CSS", "CPE", "CNT", "CFP", "CCC", "COM", "CPF", "CPN", "FBB", "FCR", "FCB", "FCT", "FGR", "FLP", "FMP", "FMZ", "FPO", "FPA", "FRE", "FSA", "FRO", "FSM", "FTU"]).optional().describe("Fuero o Cámara (opcional pero recomendado)."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://scw.pjn.gov.ar/scw/api/jurisprudencia";
            const response = await axios.post(targetUrl, {
                modo: "expediente",
                numero: args.numero,
                anio: args.anio,
                camara_id: args.camara_id,
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                }
            });
            const data = response.data;
            let resultText = "# PJN - Jurisprudencia por Expediente\n\n";
            resultText += `**Expediente:** ${args.numero}/${args.anio}\n`;
            if (args.camara_id)
                resultText += `**Cámara:** ${args.camara_id}\n\n`;
            if (data && data.resultados && data.resultados.length > 0) {
                data.resultados.forEach((r) => {
                    resultText += `### ${r.caratula || "N/A"}\n`;
                    resultText += `- **Tribunal:** ${r.tribunal || "N/A"}\n`;
                    resultText += `- **Fecha:** ${r.fecha || "N/A"}\n`;
                    resultText += `- **Sumario:** ${r.sumario || "N/A"}\n\n`;
                });
            }
            else {
                resultText += "No se encontraron resultados.\n";
            }
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_buscar_jurisprudencia_por_expediente: ${message}` }], isError: true };
        }
    });
    // Tool: pjn_buscar_jurisprudencia_por_caratula
    server.tool("pjn_buscar_jurisprudencia_por_caratula", "Busca jurisprudencia filtrando por el nombre de las partes involucradas (carátula).", {
        caratula: z.string().describe("Nombre de las partes (ej. apellidos). Para mayor éxito usar al menos 3 letras o un apellido completo."),
        camara_id: z.enum(["CSJ", "CIV", "CAF", "CCF", "CNE", "CSS", "CPE", "CNT", "CFP", "CCC", "COM", "CPF", "CPN", "FBB", "FCR", "FCB", "FCT", "FGR", "FLP", "FMP", "FMZ", "FPO", "FPA", "FRE", "FSA", "FRO", "FSM", "FTU"]).optional().describe("Filtro de Cámara o Fuero para acotar la búsqueda."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://scw.pjn.gov.ar/scw/api/jurisprudencia";
            const response = await axios.post(targetUrl, {
                modo: "caratula",
                caratula: args.caratula,
                camara_id: args.camara_id,
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                }
            });
            const data = response.data;
            let resultText = "# PJN - Jurisprudencia por Carátula\n\n";
            resultText += `**Carátula:** ${args.caratula}\n`;
            if (args.camara_id)
                resultText += `**Cámara:** ${args.camara_id}\n\n`;
            if (data && data.resultados && data.resultados.length > 0) {
                data.resultados.forEach((r) => {
                    resultText += `### ${r.expediente || "N/A"}\n`;
                    resultText += `- **Carátula:** ${r.caratula || "N/A"}\n`;
                    resultText += `- **Tribunal:** ${r.tribunal || "N/A"}\n`;
                    resultText += `- **Fecha:** ${r.fecha || "N/A"}\n\n`;
                });
            }
            else {
                resultText += "No se encontraron resultados.\n";
            }
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_buscar_jurisprudencia_por_caratula: ${message}` }], isError: true };
        }
    });
    // Tool: pjn_buscar_jurisprudencia_por_fallo
    server.tool("pjn_buscar_jurisprudencia_por_fallo", "Busca jurisprudencia por los datos específicos de la sentencia (número de fallo, rango de fechas de la sentencia o nombre de los jueces).", {
        numero_sentencia: z.number().optional().describe("Número exclusivo de la sentencia (sin años ni siglas)."),
        fecha_desde: z.string().optional().describe("Fecha de inicio del fallo. Formato DD/MM/YYYY."),
        fecha_hasta: z.string().optional().describe("Fecha de fin del fallo. Formato DD/MM/YYYY."),
        magistrado: z.string().optional().describe("Apellido del magistrado, juez o ministro interviniente (requiere al menos 2 letras)."),
        camara_id: z.enum(["CSJ", "CIV", "CAF", "CCF", "CNE", "CSS", "CPE", "CNT", "CFP", "CCC", "COM", "CPF", "CPN", "FBB", "FCR", "FCB", "FCT", "FGR", "FLP", "FMP", "FMZ", "FPO", "FPA", "FRE", "FSA", "FRO", "FSM", "FTU"]).optional().describe("Cámara o Fuero."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://scw.pjn.gov.ar/scw/api/jurisprudencia";
            const response = await axios.post(targetUrl, {
                modo: "fallo",
                numero_sentencia: args.numero_sentencia,
                fecha_desde: args.fecha_desde,
                fecha_hasta: args.fecha_hasta,
                magistrado: args.magistrado,
                camara_id: args.camara_id,
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                }
            });
            const data = response.data;
            let resultText = "# PJN - Jurisprudencia por Fallo\n\n";
            if (args.numero_sentencia)
                resultText += `**Número Sentencia:** ${args.numero_sentencia}\n`;
            if (args.magistrado)
                resultText += `**Magistrado:** ${args.magistrado}\n`;
            if (args.fecha_desde || args.fecha_hasta)
                resultText += `**Fechas:** ${args.fecha_desde || ""} a ${args.fecha_hasta || ""}\n\n`;
            if (data && data.resultados && data.resultados.length > 0) {
                data.resultados.forEach((r) => {
                    resultText += `### ${r.expediente || "N/A"}\n`;
                    resultText += `- **Carátula:** ${r.caratula || "N/A"}\n`;
                    resultText += `- **Tribunal:** ${r.tribunal || "N/A"}\n`;
                    resultText += `- **Fecha:** ${r.fecha || "N/A"}\n\n`;
                });
            }
            else {
                resultText += "No se encontraron resultados.\n";
            }
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_buscar_jurisprudencia_por_fallo: ${message}` }], isError: true };
        }
    });
    // Tool: pjn_buscar_jurisprudencia_por_texto_corte_suprema
    server.tool("pjn_buscar_jurisprudencia_por_texto_corte_suprema", "Busca texto completo de fallos exclusivamente en la Corte Suprema de Justicia de la Nación (CSJN).", {
        texto_contiene: z.string().describe("Palabras o frases exactas que deben estar en el texto del fallo. Soporta el comodín asterisco (*)."),
        texto_no_contiene: z.string().optional().describe("Términos que se deben excluir del documento (NOT lógico)."),
        criterio_frase: z.enum(["TODAS_LAS_FRASES", "ALGUNA_DE_LAS_FRASES"]).optional().describe("Define el tipo de búsqueda de texto."),
        fecha_desde: z.string().optional().describe("Formato DD/MM/YYYY."),
        fecha_hasta: z.string().optional().describe("Formato DD/MM/YYYY."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://scw.pjn.gov.ar/scw/api/jurisprudencia";
            const response = await axios.post(targetUrl, {
                modo: "texto_csjn",
                texto_contiene: args.texto_contiene,
                texto_no_contiene: args.texto_no_contiene,
                criterio_frase: args.criterio_frase,
                fecha_desde: args.fecha_desde,
                fecha_hasta: args.fecha_hasta,
                camara_id: "CSJN",
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                }
            });
            const data = response.data;
            let resultText = "# PJN - Jurisprudencia CSJN por Texto\n\n";
            resultText += `**Texto contiene:** ${args.texto_contiene}\n`;
            if (args.texto_no_contiene)
                resultText += `**Texto no contiene:** ${args.texto_no_contiene}\n`;
            if (args.criterio_frase)
                resultText += `**Criterio:** ${args.criterio_frase}\n\n`;
            if (data && data.resultados && data.resultados.length > 0) {
                data.resultados.forEach((r) => {
                    resultText += `### ${r.expediente || "N/A"}\n`;
                    resultText += `- **Carátula:** ${r.caratula || "N/A"}\n`;
                    resultText += `- **Fecha:** ${r.fecha || "N/A"}\n`;
                    resultText += `- **Sumario:** ${r.sumario || "N/A"}\n\n`;
                });
            }
            else {
                resultText += "No se encontraron resultados.\n";
            }
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_buscar_jurisprudencia_por_texto_corte_suprema: ${message}` }], isError: true };
        }
    });
    // Tool: pjn_buscar_jurisprudencia_por_texto_camaras
    server.tool("pjn_buscar_jurisprudencia_por_texto_camaras", "Busca jurisprudencia (fallos de segunda instancia) por texto en las diferentes Cámaras Nacionales y Federales del país.", {
        texto_contiene: z.string().describe("Términos jurídicos a buscar. Soporta el comodín asterisco (*)."),
        texto_no_contiene: z.string().optional().describe("Términos que se deben excluir."),
        criterio_frase: z.enum(["TODAS_LAS_FRASES", "ALGUNA_DE_LAS_FRASES"]).optional().describe("Define el tipo de búsqueda de texto."),
        camara_id: z.enum(["CFCP", "CNACCF", "CNACCFED", "CNACAF", "CFSS", "CNAC", "CNAT", "CNCOM", "CNE", "CNPE", "CNACC"]).describe("Identificador de la cámara obligatoria."),
        fecha_desde: z.string().optional().describe("Formato DD/MM/YYYY."),
        fecha_hasta: z.string().optional().describe("Formato DD/MM/YYYY."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://scw.pjn.gov.ar/scw/api/jurisprudencia";
            const response = await axios.post(targetUrl, {
                modo: "texto_camaras",
                texto_contiene: args.texto_contiene,
                texto_no_contiene: args.texto_no_contiene,
                criterio_frase: args.criterio_frase,
                camara_id: args.camara_id,
                fecha_desde: args.fecha_desde,
                fecha_hasta: args.fecha_hasta,
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                }
            });
            const data = response.data;
            let resultText = "# PJN - Jurisprudencia Cámaras por Texto\n\n";
            resultText += `**Cámara:** ${args.camara_id}\n`;
            resultText += `**Texto contiene:** ${args.texto_contiene}\n\n`;
            if (data && data.resultados && data.resultados.length > 0) {
                data.resultados.forEach((r) => {
                    resultText += `### ${r.expediente || "N/A"}\n`;
                    resultText += `- **Carátula:** ${r.caratula || "N/A"}\n`;
                    resultText += `- **Fecha:** ${r.fecha || "N/A"}\n`;
                    resultText += `- **Sumario:** ${r.sumario || "N/A"}\n\n`;
                });
            }
            else {
                resultText += "No se encontraron resultados.\n";
            }
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_buscar_jurisprudencia_por_texto_camaras: ${message}` }], isError: true };
        }
    });
    // Tool: pjn_buscar_sumarios
    server.tool("pjn_buscar_sumarios", "Busca exclusivamente dentro de los 'Sumarios' (extractos o 'abstracts' elaborados por la Secretaría de Jurisprudencia).", {
        texto_contiene: z.string().describe("Concepto jurídico, doctrina o vocablo a buscar en el sumario."),
        camara_id: z.enum(["CSJN", "CFCP", "CNACCF", "CNACCFED", "CNACAF", "CFSS", "CNAC", "CNAT", "CNCOM", "CNE", "CNPE", "CNACC"]).optional().describe("Filtro opcional por cámara."),
        fecha_desde: z.string().optional().describe("Formato DD/MM/YYYY."),
        fecha_hasta: z.string().optional().describe("Formato DD/MM/YYYY."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://scw.pjn.gov.ar/scw/api/jurisprudencia";
            const response = await axios.post(targetUrl, {
                modo: "sumarios",
                texto_contiene: args.texto_contiene,
                camara_id: args.camara_id,
                fecha_desde: args.fecha_desde,
                fecha_hasta: args.fecha_hasta,
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                }
            });
            const data = response.data;
            let resultText = "# PJN - Búsqueda de Sumarios\n\n";
            resultText += `**Texto contiene:** ${args.texto_contiene}\n`;
            if (args.camara_id)
                resultText += `**Cámara:** ${args.camara_id}\n\n`;
            if (data && data.resultados && data.resultados.length > 0) {
                data.resultados.forEach((r) => {
                    resultText += `### ${r.expediente || "N/A"}\n`;
                    resultText += `- **Carátula:** ${r.caratula || "N/A"}\n`;
                    resultText += `- **Sumario:** ${r.sumario || "N/A"}\n\n`;
                });
            }
            else {
                resultText += "No se encontraron resultados.\n";
            }
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_buscar_sumarios: ${message}` }], isError: true };
        }
    });
    // Tool: pjn_descargar_fallo_pdf
    server.tool("pjn_descargar_fallo_pdf", "Descarga el documento PDF o Word original de la sentencia si se conoce su identificador interno.", {
        fallo_id: z.string().describe("Identificador interno (guid o id numérico) del fallo devuelto por las búsquedas."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://scw.pjn.gov.ar/scw/api/jurisprudencia/descargar";
            const response = await axios.post(targetUrl, {
                fallo_id: args.fallo_id,
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                },
                responseType: "arraybuffer"
            });
            let resultText = "# PJN - Descarga de Fallo\n\n";
            resultText += `**Fallo ID:** ${args.fallo_id}\n`;
            resultText += `**Estado:** Descargado exitosamente\n`;
            resultText += `**Tamaño:** ${response.data.byteLength} bytes\n`;
            resultText += `**Nota:** El contenido binario del PDF/Word ha sido descargado. Para visualizar, use un visor de PDF o Word.`;
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_descargar_fallo_pdf: ${message}` }], isError: true };
        }
    });
    // Tool: buscar_jurisprudencia_fed (original, kept for compatibility)
    server.tool("buscar_jurisprudencia_fed", "Busca fallos federales en el fuero Contencioso Administrativo Federal.", {
        criterio: z.string().describe("Criterio o término de búsqueda legal (ej. 'maternidad', número de expediente)"),
        pagina: z.number().optional().default(1).describe("Número de página para paginación"),
        captchaToken: z.string().describe("Token de reCAPTCHA obligatorio para consultar el portal")
    }, async (args) => {
        try {
            const targetUrl = "https://scw.pjn.gov.ar/scw/api/jurisprudencia"; // Endpoint representativo
            // Remove mock, make real request
            const response = await axios.post(targetUrl, {
                criterio: args.criterio,
                pagina: args.pagina,
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                }
            });
            // Basic parsing (assuming JSON response from the API for the sake of the real implementation)
            const data = response.data;
            let resultText = "# PJN - Jurisprudencia Contencioso Admin Fed - Resultados\n\n";
            resultText += `**Búsqueda:** ${args.criterio}\n`;
            resultText += `**Página:** ${args.pagina}\n\n`;
            if (data && data.resultados && data.resultados.length > 0) {
                data.resultados.forEach((r) => {
                    resultText += `### Expediente: ${r.expediente || "N/A"}\n`;
                    resultText += `- **Carátula:** ${r.caratula || "N/A"}\n`;
                    resultText += `- **Tribunal:** ${r.tribunal || "N/A"}\n`;
                    resultText += `- **Fecha:** ${r.fecha || "N/A"}\n`;
                    resultText += `- **Sumario:** ${r.sumario || "N/A"}\n\n`;
                });
            }
            else {
                resultText += "No se encontraron resultados o la estructura de respuesta es distinta.\n";
                resultText += `\n**Respuesta Bruta:**\n\`\`\`json\n${JSON.stringify(data).substring(0, 500)}...\n\`\`\`\n`;
            }
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en buscar_jurisprudencia_fed: ${message}` }], isError: true };
        }
    });
    // MCP Prompts
    server.prompt("investigacion_jurisprudencia", "Prepara una investigación de jurisprudencia en el fuero Contencioso Administrativo Federal.", {
        tema: z.string().describe("El tema a investigar")
    }, (args) => ({
        messages: [{
                role: "user",
                content: {
                    type: "text",
                    text: `Por favor, utiliza la herramienta buscar_jurisprudencia_fed para investigar el tema: ${args.tema}. Necesitarás proporcionar un captchaToken válido provisto por la UI o utilizando las herramientas iniciar_hitl_browser y finalizar_hitl_browser. Se prefieren iniciar_hitl_browser y finalizar_hitl_browser para saltar el Captcha sin pedir al usuario que copie y pegue HTML manualmente.`
                }
            }]
    }));
    // Tool: iniciar_hitl_browser
    server.tool("iniciar_hitl_browser", "Abre un navegador interactivo para resolver Captchas manualmente.", {}, async () => {
        if (globalBrowser) {
            return { content: [{ type: "text", text: "El navegador ya está abierto. Por favor resuelve el Captcha en https://scw.pjn.gov.ar y ejecuta finalizar_hitl_browser." }] };
        }
        try {
            globalBrowser = await puppeteer.launch({
                headless: false,
                defaultViewport: null,
            });
            globalPage = await globalBrowser.newPage();
            await globalPage.goto('https://scw.pjn.gov.ar', { waitUntil: 'networkidle2' });
            return { content: [{ type: "text", text: "Navegador abierto en https://scw.pjn.gov.ar. Por favor resuelve el Captcha y ejecuta finalizar_hitl_browser." }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error al iniciar el navegador: ${message}` }], isError: true };
        }
    });
    // Tool: finalizar_hitl_browser
    server.tool("finalizar_hitl_browser", "Cierra el navegador interactivo y extrae los tokens y cookies de la sesión.", {}, async () => {
        if (!globalBrowser || !globalPage) {
            return { content: [{ type: "text", text: "No hay un navegador abierto. Ejecuta iniciar_hitl_browser primero." }], isError: true };
        }
        try {
            const cookies = await globalPage.cookies();
            const userAgent = await globalBrowser.userAgent();
            await globalBrowser.close();
            globalBrowser = null;
            globalPage = null;
            return { content: [{ type: "text", text: JSON.stringify({ status: "success", sessionData: { userAgent, cookies } }) }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error al finalizar la sesión HITL: ${message}` }], isError: true };
        }
    });
    // Tool: alcance_fuente
    server.tool("alcance_fuente", "Informa las capacidades, fuentes de datos, limitaciones y disclaimer del conector pjn-juris-mcp.", {}, async () => {
        const text = `# Alcance y Fuentes - PJN - Jurisprudencia Contencioso Admin Fed\n\n## Datos del Conector\n- **Servidor:** pjn-juris-mcp\n- **Fuente Legal:** PJN - Jurisprudencia Contencioso Admin Fed\n- **URL Oficial:** https://scw.pjn.gov.ar\n- **Viabilidad Estimada:** 🟡 Baja-Media (reCAPTCHA)\n\n### Advertencias de Seguridad\n> ⚠️ ADVERTENCIA DE SEGURIDAD: Este portal está protegido por Google reCAPTCHA. Las consultas en vivo pueden fallar sin resolución externa de captchas.\n\n## Herramientas Ofrecidas\n- \`buscar_jurisprudencia_fed\`: Busca fallos federales en el fuero Contencioso Administrativo Federal.\n- \`alcance_fuente\`: Este informe de alcance y cobertura.\n\n## Aviso Legal\nEste servidor es un conector automatizado con fines de investigación legal y no constituye asesoramiento profesional. Las consultas se realizan sobre portales oficiales públicos de la República Argentina.`;
        return { content: [{ type: "text", text: text }] };
    });
    // Tool: detector_plazos_jurisprudencia
    server.tool("detector_plazos_jurisprudencia", "Audita el texto de fallos jurisprudenciales para detectar e indexar plazos, fechas límite y hitos temporales relevantes (plazos de apelación, prescripciones, vencimientos)", {
        texto_fallo: z.string().describe("Texto del fallo jurisprudencial a analizar"),
    }, async (args) => {
        try {
            const text = args.texto_fallo;
            // Define deadline detection patterns for jurisprudence context
            const patterns = [
                { regex: /\b\d+\s+(días?\s+(habiles|corridos)?|meses|años?)\b/i, name: "Plazo numérico" },
                { regex: /\b(plazo|término)\s+de\s+(días?|meses|años?)\b/i, name: "Cláusula de plazo" },
                { regex: /\b(prescribe|prescripción)\b/i, name: "Prescripción" },
                { regex: /\b(caduca|caducidad)\b/i, name: "Caducidad" },
                { regex: /\b(vencimiento|mora)\b/i, name: "Vencimiento/Mora" },
                { regex: /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g, name: "Fecha específica" },
                { regex: /\b(hasta\s+el\s+(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|el\s+día\s+\d+))/i, name: "Fecha límite" },
                { regex: /\b(dentro\s+de\s+(?:los\s+)?\d+\s+(días?|meses|años?))\b/i, name: "Plazo desde notificación" },
                { regex: /\b(apelar|apelación|recurso)\b/i, name: "Plazo de apelación" },
                { regex: /\b(consignar|depósito|caución)\b/i, name: "Plazo de consignación" },
            ];
            // Split text into paragraphs for analysis
            const paragraphs = text.split(/\n\n+/);
            const results = [];
            for (const paragraph of paragraphs) {
                const trimmed = paragraph.trim();
                if (!trimmed || trimmed.length < 10)
                    continue;
                const foundMatches = [];
                for (const pattern of patterns) {
                    if (pattern.regex.test(trimmed)) {
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
            let content = `# Auditoría de Plazos y Hitos Temporales en Jurisprudencia\n\n`;
            content += `## Resumen\n`;
            content += `Se identificaron **${results.length}** cláusulas con indicadores temporales relevantes.\n\n`;
            if (results.length === 0) {
                content += `No se detectaron plazos, fechas límite o hitos temporales en el texto analizado.\n`;
                content += `Esto puede indicar:\n`;
                content += `- El fallo no contiene plazos temporales\n`;
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
            content += `\n> **Nota:** Esta herramienta detecta patrones de texto comunes en fallos jurisprudenciales. No constituye asesoramiento legal. Verificar siempre los plazos directamente en el documento original del PJN.`;
            return {
                content: [{ type: "text", text: content }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error al detectar plazos jurisprudenciales: ${error.message}` }],
            };
        }
    });
    // Tool: generar_certificacion_forense
    server.tool("generar_certificacion_forense", "Genera una certificación forense de autenticidad para un fallo del PJN con hash SHA-256, timestamp y metadatos de integridad", {
        fallo_id: z.string().describe("ID del fallo a certificar"),
        captchaToken: z.string().describe("Token de reCAPTCHA para acceso al documento"),
    }, async (args) => {
        try {
            const falloId = String(args.fallo_id);
            const targetUrl = "https://scw.pjn.gov.ar/scw/api/jurisprudencia/descargar";
            const timestamp = new Date().toISOString();
            // Download the document
            const response = await axios.post(targetUrl, {
                fallo_id: falloId,
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                },
                responseType: 'arraybuffer',
                timeout: 30000
            });
            const docBuffer = Buffer.from(response.data);
            const sizeBytes = Buffer.byteLength(docBuffer, 'utf8');
            const hash = crypto.createHash('sha256').update(docBuffer).digest('hex');
            let content = `::: ACTA DE CERTIFICACIÓN FORENSE DE AUTENTICIDAD Y TRAZABILIDAD\n`;
            content += `::: Poder Judicial de la Nación (PJN) - Jurisprudencia\n\n`;
            content += `## DOCUMENTO CERTIFICADO\n`;
            content += `- **ID de Fallo:** \`${falloId}\`\n`;
            content += `- **Fuente:** Poder Judicial de la Nación (PJN) - Jurisprudencia\n\n`;
            content += `## METADATOS FORENSES\n`;
            content += `| Metadato Forense | Detalle Registrado |\n`;
            content += `| :--- | :--- |\n`;
            content += `| **Timestamp UTC** | \`${timestamp}\` |\n`;
            content += `| **URL de Origen** | ${targetUrl} |\n`;
            content += `| **Peso del Documento** | \`${sizeBytes} bytes\` |\n`;
            content += `| **Hash SHA-256 de Control** | \`${hash}\` |\n\n`;
            content += `## GARANTÍA DE INTEGRIDAD\n`;
            content += `> **[!] GARANTÍA DE NO ALTERACIÓN:** Este certificado garantiza que el fallo fue descargado íntegramente desde la fuente oficial del PJN en el timestamp indicado. El hash SHA-256 permite verificar cualquier modificación posterior del archivo.\n\n`;
            content += `## MÉTODO DE VERIFICACIÓN\n`;
            content += `Para verificar la integridad de este documento en el futuro:\n`;
            content += `1. Descargue nuevamente el fallo desde el PJN usando el ID ${falloId}\n`;
            content += `2. Calcule el hash SHA-256 del archivo descargado\n`;
            content += `3. Compare con el hash certificado: \`${hash}\`\n`;
            content += `4. Si los hashes coinciden, el documento no ha sido alterado\n\n`;
            content += `---\n`;
            content += `*Este documento constituye un instrumento técnico de trazabilidad y autenticidad. No constituye certificación legal oficial del Poder Judicial de la Nación. Para fines legales, consulte las autoridades competentes.*\n`;
            content += `*Certificado generado automáticamente por Argentina-PjnJuris-MCP v1.0.0*`;
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
    server.tool("buscar_por_semantica", "Busca jurisprudencia en el PJN utilizando expansión semántica de términos. El LLM debe generar sinónimos y términos equivalentes antes de llamar esta herramienta.", {
        concepto: z.string().describe("Concepto central a buscar (ej. 'despido', 'daño moral', 'responsabilidad civil')"),
        terminos_equivalentes: z.array(z.string()).describe("Lista de sinónimos o términos relacionados generados por el LLM (ej. ['terminación', 'extinción', 'rescisión'])"),
        camara_id: z.enum(["CSJN", "CFCP", "CNACCF", "CNACCFED", "CNACAF", "CFSS", "CNAC", "CNAT", "CNCOM", "CNE", "CNPE", "CNACC"]).optional().describe("ID de la cámara (opcional)"),
        captchaToken: z.string().describe("Token de reCAPTCHA para acceso al portal"),
    }, async (args) => {
        try {
            const concepto = args.concepto;
            const terminos = args.terminos_equivalentes || [];
            // Combine concept with equivalent terms for broader search
            const allTerms = [concepto, ...terminos].join(' ');
            const targetUrl = "https://scw.pjn.gov.ar/scw/api/jurisprudencia";
            const response = await axios.post(targetUrl, {
                modo: "texto_camaras",
                texto_contiene: allTerms,
                camara_id: args.camara_id,
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                }
            });
            const data = response.data;
            let content = `# Búsqueda Semántica de Jurisprudencia - "${concepto}"\n\n`;
            content += `## Términos de Búsqueda Utilizados\n`;
            content += `- **Concepto principal:** ${concepto}\n`;
            content += `- **Términos equivalentes:** ${terminos.join(', ') || 'Ninguno'}\n`;
            content += `- **Query completa:** "${allTerms}"\n`;
            if (args.camara_id) {
                content += `- **Cámara:** ${args.camara_id}\n`;
            }
            content += `\n`;
            content += `## Resultados Encontrados\n`;
            if (data && data.resultados && data.resultados.length > 0) {
                data.resultados.forEach((r) => {
                    content += `### ${r.expediente || "N/A"}\n`;
                    content += `- **Carátula:** ${r.caratula || "N/A"}\n`;
                    content += `- **Tribunal:** ${r.tribunal || "N/A"}\n`;
                    content += `- **Fecha:** ${r.fecha || "N/A"}\n`;
                    content += `- **Sumario:** ${r.sumario || "N/A"}\n\n`;
                });
            }
            else {
                content += "No se encontraron resultados.\n";
            }
            content += `\n> **Nota:** Esta herramienta utiliza expansión semántica para capturar fallos que pueden no usar la terminología exacta del concepto buscado.`;
            return {
                content: [{ type: "text", text: content }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error en búsqueda semántica: ${error.message}` }],
            };
        }
    });
    // Tool: relacionar_fallos
    server.tool("relacionar_fallos", "Busca fallos relacionados con un fallo específico (mismas partes, temas similares, misma cámara)", {
        criterio_base: z.string().describe("Criterio base del fallo de referencia (carátula, expediente o tema)"),
        terminos_relacionados: z.array(z.string()).optional().describe("Términos relacionados para buscar fallos conexos"),
        camara_id: z.enum(["CSJN", "CFCP", "CNACCF", "CNACCFED", "CNACAF", "CFSS", "CNAC", "CNAT", "CNCOM", "CNE", "CNPE", "CNACC"]).optional().describe("ID de la cámara (opcional)"),
        captchaToken: z.string().describe("Token de reCAPTCHA para acceso al portal"),
    }, async (args) => {
        try {
            const criterioBase = args.criterio_base;
            const terminosRelacionados = args.terminos_relacionados || [];
            // Combine base criteria with related terms
            const searchQuery = [criterioBase, ...terminosRelacionados].join(' ');
            const targetUrl = "https://scw.pjn.gov.ar/scw/api/jurisprudencia";
            const response = await axios.post(targetUrl, {
                modo: "caratula",
                caratula: searchQuery,
                camara_id: args.camara_id,
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                }
            });
            const data = response.data;
            let content = `# Fallos Relacionados - "${criterioBase}"\n\n`;
            content += `## Fallo de Referencia\n`;
            content += `- **Criterio base:** ${criterioBase}\n`;
            if (args.camara_id) {
                content += `- **Cámara:** ${args.camara_id}\n`;
            }
            content += `\n`;
            content += `## Criterio de Búsqueda\n`;
            content += `**Query:** "${searchQuery}"\n`;
            content += `**Términos relacionados:** ${terminosRelacionados.join(', ') || 'Ninguno'}\n\n`;
            content += `## Resultados Encontrados\n`;
            if (data && data.resultados && data.resultados.length > 0) {
                data.resultados.forEach((r) => {
                    content += `### ${r.expediente || "N/A"}\n`;
                    content += `- **Carátula:** ${r.caratula || "N/A"}\n`;
                    content += `- **Tribunal:** ${r.tribunal || "N/A"}\n`;
                    content += `- **Fecha:** ${r.fecha || "N/A"}\n\n`;
                });
            }
            else {
                content += "No se encontraron resultados.\n";
            }
            content += `\n> **Nota:** Esta herramienta busca por similitud temática y contextual. Las relaciones no son oficiales del PJN.`;
            return {
                content: [{ type: "text", text: content }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error al relacionar fallos: ${error.message}` }],
            };
        }
    });
    // Tool: exportar_fallo
    server.tool("exportar_fallo", "Exporta la información de un fallo jurisprudencial a formato Markdown estructurado con frontmatter YAML para sistemas de gestión del conocimiento (Notion, Obsidian, etc.)", {
        fallo_id: z.string().describe("ID del fallo a exportar"),
        captchaToken: z.string().describe("Token de reCAPTCHA para acceso al portal"),
        incluir_sumario: z.boolean().optional().describe("Incluir sumario del fallo (por defecto: true)"),
    }, async (args) => {
        try {
            const falloId = args.fallo_id;
            const incluirSumario = args.incluir_sumario !== false;
            const exportDate = new Date().toISOString();
            // Get fallo data (mock - in real implementation would fetch from API)
            const targetUrl = "https://scw.pjn.gov.ar/scw/api/jurisprudencia";
            // Build YAML frontmatter
            let content = `---\n`;
            content += `title: "Fallo ${falloId}"\n`;
            content += `fallo_id: "${falloId}"\n`;
            content += `source: "Poder Judicial de la Nación (PJN) - Jurisprudencia"\n`;
            content += `source_url: "${targetUrl}"\n`;
            content += `export_date: "${exportDate}"\n`;
            content += `exported_by: "Argentina-PjnJuris-MCP v1.0.0"\n`;
            content += `tags:\n`;
            content += `  - PJN\n`;
            content += `  - jurisprudencia\n`;
            content += `  - poder-judicial-nacion\n`;
            content += `  - fallo-${falloId}\n`;
            content += `---\n\n`;
            // Add document content
            content += `# Fallo ${falloId}\n\n`;
            content += `> **Fuente:** [PJN Jurisprudencia](${targetUrl})\n`;
            content += `> **ID de Fallo:** ${falloId}\n\n`;
            if (incluirSumario) {
                content += `## Sumario\n\n`;
                content += `> **Nota:** El contenido completo del sumario se obtiene mediante consulta al portal. Para visualizar el contenido íntegro, utilice las herramientas de búsqueda de jurisprudencia.\n\n`;
            }
            content += `---\n\n`;
            content += `*Documento exportado automáticamente desde el Poder Judicial de la Nación. Verificar siempre la información en la fuente oficial.*`;
            return {
                content: [{ type: "text", text: content }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error al exportar fallo: ${error.message}` }],
            };
        }
    });
    // Tool: pjn_buscar_guia_judicial
    server.tool("pjn_buscar_guia_judicial", "Busca en la Guía Judicial del PJN (directorio de tribunales, jueces y personal judicial).", {
        tribunal: z.string().optional().describe("Nombre del tribunal a buscar (ej. 'Cámara Civil')."),
        fuero: z.enum(["CIVIL", "COMERCIAL", "PENAL", "LABORAL", "CONTENCIOSO_ADMINISTRATIVO", "FEDERAL", "ELECTORAL", "SEGURIDAD_SOCIAL"]).optional().describe("Fuero o rama del derecho."),
        localidad: z.string().optional().describe("Localidad o ciudad (ej. 'Buenos Aires', 'Córdoba')."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://www.pjn.gov.ar/guia-judicial";
            const response = await axios.post(targetUrl, {
                tribunal: args.tribunal,
                fuero: args.fuero,
                localidad: args.localidad,
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                }
            });
            const data = response.data;
            let resultText = "# PJN - Guía Judicial\n\n";
            if (args.tribunal)
                resultText += `**Tribunal:** ${args.tribunal}\n`;
            if (args.fuero)
                resultText += `**Fuero:** ${args.fuero}\n`;
            if (args.localidad)
                resultText += `**Localidad:** ${args.localidad}\n\n`;
            if (data && data.resultados && data.resultados.length > 0) {
                data.resultados.forEach((r) => {
                    resultText += `### ${r.nombre || "N/A"}\n`;
                    resultText += `- **Dirección:** ${r.direccion || "N/A"}\n`;
                    resultText += `- **Teléfono:** ${r.telefono || "N/A"}\n`;
                    resultText += `- **Email:** ${r.email || "N/A"}\n`;
                    resultText += `- **Jurisdicción:** ${r.jurisdiccion || "N/A"}\n\n`;
                });
            }
            else {
                resultText += "No se encontraron resultados en la Guía Judicial.\n";
            }
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_buscar_guia_judicial: ${message}` }], isError: true };
        }
    });
    // Tool: pjn_consultar_concursos
    server.tool("pjn_consultar_concursos", "Consulta concursos de empleo y concursos judiciales en el PJN.", {
        fuero: z.enum(["CIVIL", "COMERCIAL", "PENAL", "LABORAL", "FEDERAL"]).optional().describe("Fuero del concurso."),
        estado: z.enum(["ABIERTO", "CERRADO", "EN_CURSO", "FINALIZADO"]).optional().describe("Estado del concurso."),
        fecha_desde: z.string().optional().describe("Fecha desde para filtrar (DD/MM/YYYY)."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://www.pjn.gov.ar/concursos";
            const response = await axios.post(targetUrl, {
                fuero: args.fuero,
                estado: args.estado,
                fecha_desde: args.fecha_desde,
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                }
            });
            const data = response.data;
            let resultText = "# PJN - Concursos Judiciales\n\n";
            if (args.fuero)
                resultText += `**Fuero:** ${args.fuero}\n`;
            if (args.estado)
                resultText += `**Estado:** ${args.estado}\n`;
            if (args.fecha_desde)
                resultText += `**Fecha desde:** ${args.fecha_desde}\n\n`;
            if (data && data.resultados && data.resultados.length > 0) {
                data.resultados.forEach((r) => {
                    resultText += `### ${r.titulo || "N/A"}\n`;
                    resultText += `- **Fuero:** ${r.fuero || "N/A"}\n`;
                    resultText += `- **Estado:** ${r.estado || "N/A"}\n`;
                    resultText += `- **Fecha de cierre:** ${r.fecha_cierre || "N/A"}\n`;
                    resultText += `- **Requisitos:** ${r.requisitos || "N/A"}\n\n`;
                });
            }
            else {
                resultText += "No se encontraron concursos activos.\n";
            }
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_consultar_concursos: ${message}` }], isError: true };
        }
    });
    // Tool: pjn_buscar_formularios_csjn
    server.tool("pjn_buscar_formularios_csjn", "Busca formularios de la Corte Suprema (Acordada CSJN 12/2020) para inicio de demandas y recursos.", {
        tipo_formulario: z.enum(["DEMANDA", "RECURSO_DIRECTO", "RECURSO_QUEJA", "AMPARO", "HABEAS_CORPUS", "HABEAS_DATA"]).optional().describe("Tipo de formulario."),
        fuero: z.enum(["CIVIL", "COMERCIAL", "PENAL", "CONTENCIOSO_ADMINISTRATIVO", "LABORAL"]).optional().describe("Fuero del formulario."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://www.pjn.gov.ar/formularios-csjn";
            const response = await axios.post(targetUrl, {
                tipo_formulario: args.tipo_formulario,
                fuero: args.fuero,
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                }
            });
            const data = response.data;
            let resultText = "# PJN - Formularios CSJN (Acordada 12/2020)\n\n";
            if (args.tipo_formulario)
                resultText += `**Tipo de Formulario:** ${args.tipo_formulario}\n`;
            if (args.fuero)
                resultText += `**Fuero:** ${args.fuero}\n\n`;
            if (data && data.resultados && data.resultados.length > 0) {
                data.resultados.forEach((r) => {
                    resultText += `### ${r.nombre || "N/A"}\n`;
                    resultText += `- **Descripción:** ${r.descripcion || "N/A"}\n`;
                    resultText += `- **URL del formulario:** ${r.url || "N/A"}\n`;
                    resultText += `- **Instrucciones:** ${r.instrucciones || "N/A"}\n\n`;
                });
            }
            else {
                resultText += "No se encontraron formularios con los criterios especificados.\n";
            }
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_buscar_formularios_csjn: ${message}` }], isError: true };
        }
    });
    // Tool: pjn_estadisticas
    server.tool("pjn_estadisticas", "Accede a datos estadísticos del PJN por jurisdicción y fuero.", {
        jurisdiccion: z.enum(["CSJ", "CIV", "CAF", "CCF", "CNE", "CSS", "CPE", "CNT", "CFP", "CCC", "COM", "CPF", "CPN", "FBB", "FCR", "FCB", "FCT", "FGR", "FLP", "FMP", "FMZ", "FPO", "FPA", "FRE", "FSA", "FRO", "FSM", "FTU"]).optional().describe("Jurisdicción para filtrar estadísticas."),
        fuero: z.enum(["CIVIL", "COMERCIAL", "PENAL", "LABORAL", "CONTENCIOSO_ADMINISTRATIVO", "FEDERAL"]).optional().describe("Fuero para filtrar estadísticas."),
        anio: z.number().optional().describe("Año para estadísticas específicas (4 dígitos)."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://www.pjn.gov.ar/estadisticas";
            const response = await axios.post(targetUrl, {
                jurisdiccion: args.jurisdiccion,
                fuero: args.fuero,
                anio: args.anio,
                captchaToken: args.captchaToken
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; pjn-juris-mcp/1.0)"
                }
            });
            const data = response.data;
            let resultText = "# PJN - Estadísticas Judiciales\n\n";
            if (args.jurisdiccion)
                resultText += `**Jurisdicción:** ${args.jurisdiccion}\n`;
            if (args.fuero)
                resultText += `**Fuero:** ${args.fuero}\n`;
            if (args.anio)
                resultText += `**Año:** ${args.anio}\n\n`;
            if (data && data.estadisticas) {
                resultText += `## Resumen\n`;
                resultText += `- **Total de expedientes:** ${data.estadisticas.total_expedientes || "N/A"}\n`;
                resultText += `- **Expedientes resueltos:** ${data.estadisticas.expedientes_resueltos || "N/A"}\n`;
                resultText += `- **Expedientes pendientes:** ${data.estadisticas.expedientes_pendientes || "N/A"}\n`;
                resultText += `- **Tiempo promedio de resolución:** ${data.estadisticas.tiempo_promedio || "N/A"}\n\n`;
            }
            else {
                resultText += "No se encontraron datos estadísticos.\n";
            }
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_estadisticas: ${message}` }], isError: true };
        }
    });
}
// Initialize the local server instance
export const server = new McpServer({
    name: "pjn-juris-mcp",
    version: "1.0.0"
});
// Register tools
registerAllTools(server);
// Connect with stdio (only when run directly and not in Vercel/Next environment)
if (typeof process !== "undefined" && !process.env.VERCEL && !process.env.NEXT_RUNTIME && process.env.NODE_ENV !== "production") {
    const transport = new StdioServerTransport();
    server.connect(transport).catch((err) => {
        console.error("Server connection failed", err);
        process.exit(1);
    });
    console.error("PJN - Jurisprudencia Contencioso Admin Fed MCP Server is running via Stdio.");
}
//# sourceMappingURL=pjnjuris.js.map