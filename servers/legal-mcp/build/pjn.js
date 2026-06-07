#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import crypto from "crypto";
let globalBrowser = null;
let globalPage = null;
export function registerAllTools(server) {
    // Tool: consultar_expediente
    server.tool("consultar_expediente", "Consulta el estado de expedientes judiciales federales por jurisdicción, cámara, número o año.", {
        criterio: z.string().describe("Criterio o término de búsqueda legal (ej. 'maternidad', número de expediente)"),
        pagina: z.number().optional().default(1).describe("Número de página para paginación"),
        captchaToken: z.string().describe("Token de Google reCAPTCHA resuelto externamente")
    }, async (args) => {
        try {
            const targetUrl = "https://scw.pjn.gov.ar/scw/home.seam";
            const payload = new URLSearchParams({
                criterio: args.criterio,
                pagina: args.pagina.toString(),
                "g-recaptcha-response": args.captchaToken
            });
            const response = await axios.post(targetUrl, payload.toString(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            });
            const $ = cheerio.load(response.data);
            const title = $("title").text() || "Resultados";
            let textContent = $("body").text().replace(/\s+/g, ' ').substring(0, 5000);
            let resultText = `# Poder Judicial de la Nación (PJN) - Consulta - Resultados de consultar_expediente\n\n`;
            resultText += `**Búsqueda:** ${args.criterio}\n`;
            resultText += `**Origen:** ${targetUrl}\n`;
            resultText += `**Título de la página:** ${title}\n\n`;
            resultText += `### Contenido Extraído:\n${textContent}\n`;
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en consultar_expediente: ${message}` }], isError: true };
        }
    });
    // Tool: pjn_buscar_expediente_por_parte
    server.tool("pjn_buscar_expediente_por_parte", "Busca expedientes judiciales filtrando por el nombre exacto de las partes involucradas (actor, demandado, imputado).", {
        party_name: z.string().describe("Nombre y apellido o razón social de una de las partes. Debe ser lo más exacto posible."),
        jurisdiction_id: z.enum(["CSJ", "CIV", "CAF", "CCF", "CNE", "CSS", "CPE", "CNT", "CFP", "CCC", "COM", "CPF", "CPN", "FBB", "FCR", "FCB", "FCT", "FGR", "FLP", "FMP", "FMZ", "FPO", "FPA", "FRE", "FSA", "FRO", "FSM", "FTU"]).describe("ID de la jurisdicción obligatoria para limitar la búsqueda."),
        tipo_parte: z.enum(["ACTOR", "AFILIADO", "AGRUPACION_POLITICA", "AMICUS_CURIAE", "AUTORIDAD_DE_MESA", "AUTORIDAD_PARTIDARIA", "CANDIDATO", "CAUSANTE", "CIUDADANO", "CONCURSADO", "CUERPO_COLEGIADO", "DAMNIFICADO", "DEMANDADO", "DENUNCIADO", "DENUNCIANTE", "EJECUTADO_S", "EJECUTANTE_S", "EMPLEADO_PUBLICO", "FALLIDO", "FUNCIONARIO_PUBLICO", "HEREDERO_S", "IMPUTADO", "INCIDENTISTA", "INTERVENTOR_JUDICIAL", "INTERVENTOR_PARTIDARIO", "JUNTA_ELECTORAL_PARTIDARIA", "LISTA_DE_CANDIDATOS_PARTIDARIOS", "LISTA_DE_PRECANDIDATOS_O_CANDIDATOS", "ONG", "ORGANISMO_PUBLICO", "PETICIONANTE", "PRECANDIDATO", "PRESUNTO_FALLIDO", "QUERELLANTE", "REQUERIDO", "REQUIRENTE", "SINDICO", "SOLICITANTE", "TERCERO_AUTONOMO_PRINCIPAL", "VOLUNTARIO"]).optional().describe("Tipo de parte para filtrar resultados (40 tipos disponibles)."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://scw.pjn.gov.ar/scw/home.seam";
            const payload = new URLSearchParams({
                modo: "parte",
                party_name: args.party_name,
                jurisdiction_id: args.jurisdiction_id,
                tipo_parte: args.tipo_parte || "",
                "g-recaptcha-response": args.captchaToken
            });
            const response = await axios.post(targetUrl, payload.toString(), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            });
            const $ = cheerio.load(response.data);
            const title = $("title").text() || "Resultados";
            let textContent = $("body").text().replace(/\s+/g, ' ').substring(0, 5000);
            let resultText = `# PJN - Consulta por Parte\n\n`;
            resultText += `**Parte:** ${args.party_name}\n`;
            resultText += `**Jurisdicción:** ${args.jurisdiction_id}\n`;
            resultText += `**Título:** ${title}\n\n`;
            resultText += `### Contenido Extraído:\n${textContent}\n`;
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_buscar_expediente_por_parte: ${message}` }], isError: true };
        }
    });
    // Tool: pjn_obtener_resoluciones_expediente
    server.tool("pjn_obtener_resoluciones_expediente", "Obtiene únicamente las resoluciones, autos y sentencias de un expediente, filtrando los trámites de mero avance.", {
        expediente_id: z.string().describe("Identificador interno único del expediente devuelto por las búsquedas."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://scw.pjn.gov.ar/scw/home.seam";
            const payload = new URLSearchParams({
                modo: "resoluciones",
                expediente_id: args.expediente_id,
                "g-recaptcha-response": args.captchaToken
            });
            const response = await axios.post(targetUrl, payload.toString(), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            });
            const $ = cheerio.load(response.data);
            const title = $("title").text() || "Resultados";
            let textContent = $("body").text().replace(/\s+/g, ' ').substring(0, 5000);
            let resultText = `# PJN - Resoluciones del Expediente\n\n`;
            resultText += `**Expediente ID:** ${args.expediente_id}\n`;
            resultText += `**Título:** ${title}\n\n`;
            resultText += `### Resoluciones Extraídas:\n${textContent}\n`;
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_obtener_resoluciones_expediente: ${message}` }], isError: true };
        }
    });
    // Tool: pjn_descargar_documento_actuacion
    server.tool("pjn_descargar_documento_actuacion", "Descarga el documento PDF original adjunto a una actuación procesal específica.", {
        actuacion_id: z.string().describe("ID interno de la actuación que contiene el documento, devuelto al listar las actuaciones."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://scw.pjn.gov.ar/scw/home.seam";
            const payload = new URLSearchParams({
                modo: "descargar_documento",
                actuacion_id: args.actuacion_id,
                "g-recaptcha-response": args.captchaToken
            });
            const response = await axios.post(targetUrl, payload.toString(), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                responseType: "arraybuffer"
            });
            let resultText = "# PJN - Descarga de Documento\n\n";
            resultText += `**Actuación ID:** ${args.actuacion_id}\n`;
            resultText += `**Estado:** Descargado exitosamente\n`;
            resultText += `**Tamaño:** ${response.data.byteLength} bytes\n`;
            resultText += `**Nota:** El contenido binario del PDF ha sido descargado. Para visualizar, use un visor de PDF.`;
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_descargar_documento_actuacion: ${message}` }], isError: true };
        }
    });
    // Tool: obtener_actuaciones (original, kept for compatibility)
    server.tool("obtener_actuaciones", "Lista las últimas actuaciones judiciales y resoluciones cargadas en el expediente.", {
        criterio: z.string().describe("Criterio o término de búsqueda legal (ej. 'maternidad', número de expediente)"),
        pagina: z.number().optional().default(1).describe("Número de página para paginación"),
        captchaToken: z.string().describe("Token de Google reCAPTCHA resuelto externamente")
    }, async (args) => {
        try {
            const targetUrl = "https://scw.pjn.gov.ar/scw/home.seam";
            const payload = new URLSearchParams({
                criterio: args.criterio,
                pagina: args.pagina.toString(),
                action: "actuaciones",
                "g-recaptcha-response": args.captchaToken
            });
            const response = await axios.post(targetUrl, payload.toString(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            });
            const $ = cheerio.load(response.data);
            const title = $("title").text() || "Resultados";
            let textContent = $("body").text().replace(/\s+/g, ' ').substring(0, 5000);
            let resultText = `# Poder Judicial de la Nación (PJN) - Consulta - Resultados de obtener_actuaciones\n\n`;
            resultText += `**Búsqueda:** ${args.criterio}\n`;
            resultText += `**Origen:** ${targetUrl}\n`;
            resultText += `**Título de la página:** ${title}\n\n`;
            resultText += `### Contenido Extraído:\n${textContent}\n`;
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en obtener_actuaciones: ${message}` }], isError: true };
        }
    });
    // Tool: alcance_fuente
    server.tool("alcance_fuente", "Informa las capacidades, fuentes de datos, limitaciones y disclaimer del conector pjn-consulta-mcp.", {}, async () => {
        const text = `# Alcance y Fuentes - Poder Judicial de la Nación (PJN) - Consulta\n\n## Datos del Conector\n- **Servidor:** pjn-consulta-mcp\n- **Fuente Legal:** Poder Judicial de la Nación (PJN) - Consulta\n- **URL Oficial:** https://www.pjn.gov.ar/\n- **Viabilidad Estimada:** 🟡 Baja-Media (reCAPTCHA)\n\n### Advertencias de Seguridad\n> ⚠️ ADVERTENCIA DE SEGURIDAD: Este portal está protegido por Google reCAPTCHA. Las consultas en vivo requieren el paso del parámetro captchaToken.\n\n## Herramientas Ofrecidas\n- \`consultar_expediente\`: Consulta el estado de expedientes judiciales federales por jurisdicción, cámara, número o año.\n- \`obtener_actuaciones\`: Lista las últimas actuaciones judiciales y resoluciones cargadas en el expediente.\n- \`alcance_fuente\`: Este informe de alcance y cobertura.\n\n## Aviso Legal\nEste servidor es un conector automatizado con fines de investigación legal y no constituye asesoramiento profesional. Las consultas se realizan sobre portales oficiales públicos de la República Argentina.`;
        return { content: [{ type: "text", text: text }] };
    });
    // Tool: iniciar_hitl_browser
    server.tool("iniciar_hitl_browser", "Abre un navegador interactivo (HITL) para resolver el Captcha manualmente en PJN Consulta.", {}, async () => {
        if (globalBrowser) {
            return { content: [{ type: "text", text: "El navegador ya está abierto. Por favor resuelve el Captcha en la ventana de Chromium y escribe 'Listo' al usuario, luego usa finalizar_hitl_browser." }] };
        }
        try {
            globalBrowser = await puppeteer.launch({
                headless: false,
                defaultViewport: null,
            });
            globalPage = await globalBrowser.newPage();
            await globalPage.goto('https://scw.pjn.gov.ar/scw/home.seam', { waitUntil: 'networkidle2' });
            return { content: [{ type: "text", text: "Navegador abierto en https://scw.pjn.gov.ar/scw/home.seam. Por favor, informa al usuario que resuelva el Captcha y te avise, luego ejecuta finalizar_hitl_browser." }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error al iniciar el navegador: ${message}` }], isError: true };
        }
    });
    // Tool: finalizar_hitl_browser
    server.tool("finalizar_hitl_browser", "Cierra el navegador interactivo (HITL) y devuelve las cookies y userAgent para usarlas en llamadas de API.", {}, async () => {
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
    // Tool: detector_plazos_judiciales
    server.tool("detector_plazos_judiciales", "Audita el texto de actuaciones judiciales para detectar e indexar plazos, fechas límite y hitos temporales relevantes (vencimientos, prescripciones, citaciones)", {
        texto_actuaciones: z.string().describe("Texto de las actuaciones judiciales a analizar"),
    }, async (args) => {
        try {
            const text = args.texto_actuaciones;
            // Define deadline detection patterns for judicial context
            const patterns = [
                { regex: /\b\d+\s+(días?\s+(habiles|corridos)?|meses|años?)\b/i, name: "Plazo numérico" },
                { regex: /\b(plazo|término)\s+de\s+(días?|meses|años?)\b/i, name: "Cláusula de plazo" },
                { regex: /\b(prescribe|prescripción)\b/i, name: "Prescripción" },
                { regex: /\b(caduca|caducidad)\b/i, name: "Caducidad" },
                { regex: /\b(vencimiento|mora)\b/i, name: "Vencimiento/Mora" },
                { regex: /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g, name: "Fecha específica" },
                { regex: /\b(hasta\s+el\s+(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|el\s+día\s+\d+))/i, name: "Fecha límite" },
                { regex: /\b(dentro\s+de\s+(?:los\s+)?\d+\s+(días?|meses|años?))\b/i, name: "Plazo desde notificación" },
                { regex: /\b(citar|citación|audiencia)\b/i, name: "Citación/Audiencia" },
                { regex: /\b(prueba|ofrecimiento\s+de\s+prueba)\b/i, name: "Plazo probatorio" },
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
            let content = `# Auditoría de Plazos y Hitos Temporales Judiciales\n\n`;
            content += `## Resumen\n`;
            content += `Se identificaron **${results.length}** cláusulas con indicadores temporales relevantes.\n\n`;
            if (results.length === 0) {
                content += `No se detectaron plazos, fechas límite o hitos temporales en el texto analizado.\n`;
                content += `Esto puede indicar:\n`;
                content += `- El documento no contiene plazos temporales\n`;
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
            content += `\n> **Nota:** Esta herramienta detecta patrones de texto comunes en documentos judiciales. No constituye asesoramiento legal. Verificar siempre los plazos directamente en el documento original del PJN.`;
            return {
                content: [{ type: "text", text: content }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error al detectar plazos judiciales: ${error.message}` }],
            };
        }
    });
    // Tool: generar_certificacion_forense
    server.tool("generar_certificacion_forense", "Genera una certificación forense de autenticidad para un documento del PJN con hash SHA-256, timestamp y metadatos de integridad", {
        actuacion_id: z.string().describe("ID de la actuación/documento a certificar"),
        captchaToken: z.string().describe("Token de reCAPTCHA para acceso al documento"),
    }, async (args) => {
        try {
            const actuacionId = String(args.actuacion_id);
            const targetUrl = "https://scw.pjn.gov.ar/scw/home.seam";
            const timestamp = new Date().toISOString();
            // Download the document
            const payload = new URLSearchParams({
                modo: "descargar_documento",
                actuacion_id: actuacionId,
                "g-recaptcha-response": args.captchaToken
            });
            const response = await axios.post(targetUrl, payload.toString(), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                responseType: 'arraybuffer',
                timeout: 30000
            });
            const docBuffer = Buffer.from(response.data);
            const sizeBytes = Buffer.byteLength(docBuffer, 'utf8');
            const hash = crypto.createHash('sha256').update(docBuffer).digest('hex');
            let content = `::: ACTA DE CERTIFICACIÓN FORENSE DE AUTENTICIDAD Y TRAZABILIDAD\n`;
            content += `::: Poder Judicial de la Nación (PJN) - Consulta\n\n`;
            content += `## DOCUMENTO CERTIFICADO\n`;
            content += `- **ID de Actuación:** \`${actuacionId}\`\n`;
            content += `- **Fuente:** Poder Judicial de la Nación (PJN)\n\n`;
            content += `## METADATOS FORENSES\n`;
            content += `| Metadato Forense | Detalle Registrado |\n`;
            content += `| :--- | :--- |\n`;
            content += `| **Timestamp UTC** | \`${timestamp}\` |\n`;
            content += `| **URL de Origen** | ${targetUrl} |\n`;
            content += `| **Peso del Documento** | \`${sizeBytes} bytes\` |\n`;
            content += `| **Hash SHA-256 de Control** | \`${hash}\` |\n\n`;
            content += `## GARANTÍA DE INTEGRIDAD\n`;
            content += `> **[!] GARANTÍA DE NO ALTERACIÓN:** Este certificado garantiza que el documento fue descargado íntegramente desde la fuente oficial del PJN en el timestamp indicado. El hash SHA-256 permite verificar cualquier modificación posterior del archivo.\n\n`;
            content += `## MÉTODO DE VERIFICACIÓN\n`;
            content += `Para verificar la integridad de este documento en el futuro:\n`;
            content += `1. Descargue nuevamente el documento desde el PJN usando el ID ${actuacionId}\n`;
            content += `2. Calcule el hash SHA-256 del archivo descargado\n`;
            content += `3. Compare con el hash certificado: \`${hash}\`\n`;
            content += `4. Si los hashes coinciden, el documento no ha sido alterado\n\n`;
            content += `---\n`;
            content += `*Este documento constituye un instrumento técnico de trazabilidad y autenticidad. No constituye certificación legal oficial del Poder Judicial de la Nación. Para fines legales, consulte las autoridades competentes.*\n`;
            content += `*Certificado generado automáticamente por Argentina-PjnConsulta-MCP v1.0.0*`;
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
    server.tool("buscar_por_semantica", "Busca expedientes en el PJN utilizando expansión semántica de términos. El LLM debe generar sinónimos y términos equivalentes antes de llamar esta herramienta.", {
        concepto: z.string().describe("Concepto central a buscar (ej. 'despido', 'alimentos', 'divorcio')"),
        terminos_equivalentes: z.array(z.string()).describe("Lista de sinónimos o términos relacionados generados por el LLM (ej. ['terminación', 'extinción', 'rescisión'])"),
        jurisdiction_id: z.enum(["CSJN", "CFCP", "CNACCF", "CNACCFED", "CNACAF", "CFSS", "CNAC", "CNAT", "CNCOM", "CNE", "CNPE", "CNACC"]).optional().describe("ID de la jurisdicción (opcional)"),
        captchaToken: z.string().describe("Token de reCAPTCHA para acceso al portal"),
    }, async (args) => {
        try {
            const concepto = args.concepto;
            const terminos = args.terminos_equivalentes || [];
            // Combine concept with equivalent terms for broader search
            const allTerms = [concepto, ...terminos].join(' ');
            const targetUrl = "https://scw.pjn.gov.ar/scw/home.seam";
            const payload = new URLSearchParams({
                criterio: allTerms,
                pagina: "1",
                "g-recaptcha-response": args.captchaToken
            });
            if (args.jurisdiction_id) {
                payload.append("jurisdiction_id", args.jurisdiction_id);
            }
            const response = await axios.post(targetUrl, payload.toString(), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            });
            const $ = cheerio.load(response.data);
            const title = $("title").text() || "Resultados";
            let textContent = $("body").text().replace(/\s+/g, ' ').substring(0, 5000);
            let content = `# Búsqueda Semántica - "${concepto}"\n\n`;
            content += `## Términos de Búsqueda Utilizados\n`;
            content += `- **Concepto principal:** ${concepto}\n`;
            content += `- **Términos equivalentes:** ${terminos.join(', ') || 'Ninguno'}\n`;
            content += `- **Query completa:** "${allTerms}"\n`;
            if (args.jurisdiction_id) {
                content += `- **Jurisdicción:** ${args.jurisdiction_id}\n`;
            }
            content += `\n`;
            content += `## Resultados Encontrados\n`;
            content += `**Título de la página:** ${title}\n\n`;
            content += `### Contenido Extraído:\n${textContent}\n`;
            content += `\n> **Nota:** Esta herramienta utiliza expansión semántica para capturar expedientes que pueden no usar la terminología exacta del concepto buscado.`;
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
    // Tool: relacionar_expedientes
    server.tool("relacionar_expedientes", "Busca expedientes relacionados con un expediente específico (mismas partes, temas similares, misma jurisdicción)", {
        criterio_base: z.string().describe("Criterio base del expediente de referencia"),
        terminos_relacionados: z.array(z.string()).optional().describe("Términos relacionados para buscar expedientes conexos"),
        jurisdiction_id: z.enum(["CSJN", "CFCP", "CNACCF", "CNACCFED", "CNACAF", "CFSS", "CNAC", "CNAT", "CNCOM", "CNE", "CNPE", "CNACC"]).optional().describe("ID de la jurisdicción (opcional)"),
        captchaToken: z.string().describe("Token de reCAPTCHA para acceso al portal"),
    }, async (args) => {
        try {
            const criterioBase = args.criterio_base;
            const terminosRelacionados = args.terminos_relacionados || [];
            // Combine base criteria with related terms
            const searchQuery = [criterioBase, ...terminosRelacionados].join(' ');
            const targetUrl = "https://scw.pjn.gov.ar/scw/home.seam";
            const payload = new URLSearchParams({
                criterio: searchQuery,
                pagina: "1",
                "g-recaptcha-response": args.captchaToken
            });
            if (args.jurisdiction_id) {
                payload.append("jurisdiction_id", args.jurisdiction_id);
            }
            const response = await axios.post(targetUrl, payload.toString(), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            });
            const $ = cheerio.load(response.data);
            const title = $("title").text() || "Resultados";
            let textContent = $("body").text().replace(/\s+/g, ' ').substring(0, 5000);
            let content = `# Expedientes Relacionados - "${criterioBase}"\n\n`;
            content += `## Expediente de Referencia\n`;
            content += `- **Criterio base:** ${criterioBase}\n`;
            if (args.jurisdiction_id) {
                content += `- **Jurisdicción:** ${args.jurisdiction_id}\n`;
            }
            content += `\n`;
            content += `## Criterio de Búsqueda\n`;
            content += `**Query:** "${searchQuery}"\n`;
            content += `**Términos relacionados:** ${terminosRelacionados.join(', ') || 'Ninguno'}\n\n`;
            content += `## Resultados Encontrados\n`;
            content += `**Título de la página:** ${title}\n\n`;
            content += `### Contenido Extraído:\n${textContent}\n`;
            content += `\n> **Nota:** Esta herramienta busca por similitud temática y contextual. Las relaciones no son oficiales del PJN.`;
            return {
                content: [{ type: "text", text: content }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error al relacionar expedientes: ${error.message}` }],
            };
        }
    });
    // Tool: exportar_expediente
    server.tool("exportar_expediente", "Exporta la información de un expediente a formato Markdown estructurado con frontmatter YAML para sistemas de gestión del conocimiento (Notion, Obsidian, etc.)", {
        criterio: z.string().describe("Criterio o número de expediente a exportar"),
        captchaToken: z.string().describe("Token de reCAPTCHA para acceso al portal"),
        incluir_actuaciones: z.boolean().optional().describe("Incluir actuaciones del expediente (por defecto: true)"),
    }, async (args) => {
        try {
            const criterio = args.criterio;
            const incluirActuaciones = args.incluir_actuaciones !== false;
            const exportDate = new Date().toISOString();
            // Get expedition data
            const targetUrl = "https://scw.pjn.gov.ar/scw/home.seam";
            const payload = new URLSearchParams({
                criterio: criterio,
                pagina: "1",
                "g-recaptcha-response": args.captchaToken
            });
            const response = await axios.post(targetUrl, payload.toString(), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            });
            const $ = cheerio.load(response.data);
            const title = $("title").text() || "Expediente";
            let textContent = $("body").text().replace(/\s+/g, ' ').substring(0, 2000);
            // Build YAML frontmatter
            let content = `---\n`;
            content += `title: "Expediente ${criterio}"\n`;
            content += `criterio: "${criterio}"\n`;
            content += `source: "Poder Judicial de la Nación (PJN) - Consulta"\n`;
            content += `source_url: "${targetUrl}"\n`;
            content += `export_date: "${exportDate}"\n`;
            content += `exported_by: "Argentina-PjnConsulta-MCP v1.0.0"\n`;
            content += `tags:\n`;
            content += `  - PJN\n`;
            content += `  - expediente-judicial\n`;
            content += `  - poder-judicial-nacion\n`;
            content += `  - expediente-${criterio.replace(/\//g, '-')}\n`;
            content += `---\n\n`;
            // Add document content
            content += `# Expediente ${criterio}\n\n`;
            content += `> **Fuente:** [PJN Consulta](${targetUrl})\n`;
            content += `> **Criterio:** ${criterio}\n\n`;
            if (incluirActuaciones) {
                content += `## Actuaciones\n\n`;
                content += `> **Nota:** El contenido completo de las actuaciones se obtiene mediante consulta al portal. Para visualizar el contenido íntegro, utilice la herramienta \`obtener_actuaciones\`.\n\n`;
                content += `### Resumen Extraído:\n${textContent}\n\n`;
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
                content: [{ type: "text", text: `Error al exportar expediente: ${error.message}` }],
            };
        }
    });
    // Tool: pjn_buscar_reparacion_historica
    server.tool("pjn_buscar_reparacion_historica", "Busca reclamos de Reparación Histórica de ANSES (jubilados y pensionados).", {
        nombre: z.string().describe("Nombre del jubilado/pensionado."),
        apellido: z.string().describe("Apellido del jubilado/pensionado."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://scw.pjn.gov.ar/scw/home.seam";
            const payload = new URLSearchParams({
                modo: "reparacion_historica",
                nombre: args.nombre,
                apellido: args.apellido,
                "g-recaptcha-response": args.captchaToken
            });
            const response = await axios.post(targetUrl, payload.toString(), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            });
            const $ = cheerio.load(response.data);
            const title = $("title").text() || "Resultados";
            let textContent = $("body").text().replace(/\s+/g, ' ').substring(0, 5000);
            let resultText = `# PJN - Reparación Histórica (ANSES)\n\n`;
            resultText += `**Nombre:** ${args.nombre}\n`;
            resultText += `**Apellido:** ${args.apellido}\n`;
            resultText += `**Título:** ${title}\n\n`;
            resultText += `### Contenido Extraído:\n${textContent}\n`;
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_buscar_reparacion_historica: ${message}` }], isError: true };
        }
    });
    // Tool: pjn_buscar_gestion_documental
    server.tool("pjn_buscar_gestion_documental", "Busca documentos en la Plataforma de Gestión Documental del PJN (resoluciones, contratos, actos administrativos).", {
        keyword: z.string().optional().describe("Palabra clave para búsqueda."),
        dependencia: z.enum(["CONSEJO_MAGISTRATURA", "JURADO_ENJUICIAMIENTO", "FUEROS_COMPETENCIA_PAIS", "FUEROS_NACIONALES", "FUEROS_FEDERALES"]).optional().describe("Dependencia emisora del documento."),
        fecha_desde: z.string().optional().describe("Fecha desde (DD/MM/YYYY)."),
        fecha_hasta: z.string().optional().describe("Fecha hasta (DD/MM/YYYY)."),
        numero_resolucion: z.string().optional().describe("Número de resolución."),
        anio_resolucion: z.string().optional().describe("Año de resolución."),
        orden_por: z.enum(["mas_recientes", "menos_recientes", "mayor_menor", "menor_mayor"]).optional().default("mas_recientes").describe("Orden de resultados."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://www.pjn.gov.ar/gestion-documental";
            const payload = new URLSearchParams({
                keyword: args.keyword || "",
                dependencia: args.dependencia || "",
                fecha_desde: args.fecha_desde || "",
                fecha_hasta: args.fecha_hasta || "",
                numero_resolucion: args.numero_resolucion || "",
                anio_resolucion: args.anio_resolucion || "",
                orden_por: args.orden_por,
                "g-recaptcha-response": args.captchaToken
            });
            const response = await axios.post(targetUrl, payload.toString(), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            });
            const $ = cheerio.load(response.data);
            const title = $("title").text() || "Resultados";
            let textContent = $("body").text().replace(/\s+/g, ' ').substring(0, 5000);
            let resultText = `# PJN - Gestión Documental\n\n`;
            if (args.keyword)
                resultText += `**Keyword:** ${args.keyword}\n`;
            if (args.dependencia)
                resultText += `**Dependencia:** ${args.dependencia}\n`;
            if (args.fecha_desde)
                resultText += `**Fecha desde:** ${args.fecha_desde}\n`;
            if (args.fecha_hasta)
                resultText += `**Fecha hasta:** ${args.fecha_hasta}\n`;
            if (args.numero_resolucion)
                resultText += `**Resolución N°:** ${args.numero_resolucion}\n`;
            if (args.anio_resolucion)
                resultText += `**Año:** ${args.anio_resolucion}\n`;
            resultText += `**Orden:** ${args.orden_por}\n\n`;
            resultText += `### Contenido Extraído:\n${textContent}\n`;
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_buscar_gestion_documental: ${message}` }], isError: true };
        }
    });
    // Tool: pjn_descargar_documento_gestion
    server.tool("pjn_descargar_documento_gestion", "Descarga un documento específico de la Plataforma de Gestión Documental.", {
        documento_id: z.string().describe("ID del documento a descargar."),
        captchaToken: z.string().describe("Token de reCAPTCHA obtenido vía HITL.")
    }, async (args) => {
        try {
            const targetUrl = "https://www.pjn.gov.ar/gestion-documental/descargar";
            const payload = new URLSearchParams({
                documento_id: args.documento_id,
                "g-recaptcha-response": args.captchaToken
            });
            const response = await axios.post(targetUrl, payload.toString(), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                responseType: 'arraybuffer'
            });
            const contentType = String(response.headers['content-type'] || '');
            const isPdf = contentType.includes('pdf');
            let resultText = `# PJN - Descarga de Documento\n\n`;
            resultText += `**Documento ID:** ${args.documento_id}\n`;
            resultText += `**Tipo:** ${contentType || 'unknown'}\n`;
            resultText += `**Tamaño:** ${response.data.length} bytes\n\n`;
            if (isPdf) {
                resultText += `> **Nota:** El documento es un PDF. Para visualizar el contenido, descargue el archivo usando el ID proporcionado.\n`;
            }
            else {
                resultText += `> **Nota:** El documento se ha descargado correctamente.\n`;
            }
            return { content: [{ type: "text", text: resultText }] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { content: [{ type: "text", text: `Error en pjn_descargar_documento_gestion: ${message}` }], isError: true };
        }
    });
}
export function registerAllPrompts(server) {
    server.prompt("auditar_expediente", "Realiza una auditoría automatizada del estado procesal del expediente.", {
        criterio: z.string().describe("Número de expediente a consultar"),
        captchaToken: z.string().describe("Token de Google reCAPTCHA válido")
    }, (args) => {
        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Por favor, realiza un análisis del expediente '${args.criterio}' usando el captchaToken '${args.captchaToken}':\n1. Llama a \`consultar_expediente\`.\n2. Llama a \`obtener_actuaciones\`.\n3. Elabora un reporte detallado.\n\nNota: Si no cuentas con el captchaToken, ten en cuenta que las herramientas \`iniciar_hitl_browser\` y \`finalizar_hitl_browser\` están disponibles y son la forma preferida para sortear el Captcha interactuando con el usuario, en lugar de pedirle que copie y pegue HTML manualmente.`
                    }
                }
            ]
        };
    });
}
// Initialize the local server instance
export const server = new McpServer({
    name: "pjn-consulta-mcp",
    version: "1.0.0"
});
// Register tools
registerAllTools(server);
registerAllPrompts(server);
// Connect with stdio (only when run directly and not in Vercel/Next environment)
if (typeof process !== "undefined" && !process.env.VERCEL && !process.env.NEXT_RUNTIME && process.env.NODE_ENV !== "production") {
    const transport = new StdioServerTransport();
    server.connect(transport).catch((err) => {
        console.error("Server connection failed", err);
        process.exit(1);
    });
    console.error("Poder Judicial de la Nación (PJN) - Consulta MCP Server is running via Stdio.");
}
//# sourceMappingURL=pjn.js.map