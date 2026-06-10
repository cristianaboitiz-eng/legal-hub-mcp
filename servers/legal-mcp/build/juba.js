#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import { installTlsFallback } from "./tls-fallback.js";
// TLS estricto por defecto; fallback inseguro solo ante cert roto (ver tls-fallback.js).
const httpsAgent = installTlsFallback(axios, "juba");
export const server = new McpServer({
    name: "juba-mcp",
    version: "1.0.0"
});
// ─────────────────────────────────────────────────────────────────
// PARSER CENTRAL (Extrae toda la información de una card)
// ─────────────────────────────────────────────────────────────────
function parseSumarios(html) {
    const $ = cheerio.load(html);
    const sumarios = [];
    // Stats de la búsqueda (cuántos resultados en cada campo)
    const statsTexto = $('#cphMainContent_lnkResultadoTextoSumario').text().trim();
    const statsVoces = $('#cphMainContent_lnkResultadosVoces').text().trim();
    const statsFallo = $('#cphMainContent_lnkResultadoTextoFallo').text().trim();
    const termino = $('#lblUltimaBusqueda').text().trim();
    const stats = [
        termino ? `Búsqueda: "${termino}"` : '',
        statsTexto ? statsTexto : '',
        statsVoces ? statsVoces : '',
        statsFallo ? statsFallo : '',
    ].filter(Boolean).join(' | ');
    // FIX: JUBA usa ASP.NET WebForms con RepeaterDatosResultados.
    // El DOM real NO usa div.card — itera con IDs dinámicos tipo
    // cphMainContent_RepeaterDatosResultados_lblCantidad_0, _1, _2, ...
    // Loop numérico hasta que el primer elemento del repeater no exista.
    let cardIdx = 0;
    while (true) {
        const lblCantidad = $(`#cphMainContent_RepeaterDatosResultados_lblCantidad_${cardIdx}`);
        // Si no existe este ID, no hay más resultados
        if (lblCantidad.length === 0) break;
        const posicion = lblCantidad.text().trim();
        // Nro de sumario: buscar lnkAcumular con sufijo numérico del índice
        let nroSumario = '';
        const acumularEl = $(`[id$="lnkAcumular_${cardIdx}"], [id*="lnkAcumular"][id$="${cardIdx}"]`).first();
        if (acumularEl.length) {
            const acumId = acumularEl.attr('id') || '';
            const numMatch = acumId.match(/(\d+)$/);
            if (numMatch) nroSumario = `B${numMatch[1]}`;
        }
        // Materia: buscar en el contexto del bloque del repeater por índice
        // Usamos el contenedor padre del lblCantidad como ancla
        const rowContainer = lblCantidad.closest('tr, div, td').parent();
        let materia = '';
        // Intentar materia desde span/label con sufijo _lblMateria_N
        const lblMateria = $(`[id$="_lblMateria_${cardIdx}"], [id$="lblMateria${cardIdx}"]`).first();
        if (lblMateria.length) {
            materia = lblMateria.text().trim();
        }
        if (!materia) {
            // Fallback: buscar texto en mayúsculas dentro del bloque
            rowContainer.find('h2, h3, h4, span, strong').each((_, el) => {
                const t = $(el).text().trim();
                if (t === t.toUpperCase() && t.length > 3 && t.length < 60 && !t.match(/^\d/) && !t.match(/^(RESULTADO|BUSQUEDA)/i)) {
                    materia = t;
                    return false;
                }
            });
        }
        // Voces: span con id que termina en lblVoz_N
        const voces = $(`[id$="lblVoz_${cardIdx}"], [id$="lblVoz${cardIdx}"]`).text().trim()
            .replace(/\s*\|\s*/g, ' | ')
            .trim();
        // Texto del sumario: span con id que contiene lblTexto o lblSumario con sufijo N
        let textoSumario = '';
        const lblTexto = $(`[id*="lblTexto"][id$="_${cardIdx}"], [id*="lblSumario"][id$="_${cardIdx}"]`).first();
        if (lblTexto.length) {
            textoSumario = lblTexto.text().replace(/\s+/g, ' ').trim();
        }
        if (!textoSumario) {
            // Fallback: buscar párrafos largos en el bloque
            rowContainer.find('p, span').each((_, el) => {
                const t = $(el).text().replace(/\s+/g, ' ').trim();
                if (t.length > 80 && !t.startsWith('CC') && !t.startsWith('TC') && !t.startsWith('SC') && !t.startsWith('TT')) {
                    if (t.length > textoSumario.length)
                        textoSumario = t;
                }
            });
        }
        // Fallos relacionados: paneles del repeater con sufijo _N
        const fallos = [];
        const panelIds = [
            `cphMainContent_RepeaterDatosResultados_PanelFallosSinCoincidencia_${cardIdx}`,
            `cphMainContent_RepeaterDatosResultados_PanelFallosConCoincidencia_${cardIdx}`,
        ];
        panelIds.forEach(panelId => {
            const panel = $(`#${panelId}`);
            if (!panel.length) return;
            panel.find('p').each((_, p) => {
                const pText = $(p).text().replace(/\s+/g, ' ').trim();
                if (!pText || pText.length < 10)
                    return;
                const lines = pText.split(/\n|(?=Carátula:)|(?=Magistrados)/).map(l => l.trim()).filter(Boolean);
                const codigo = lines[0] || '';
                const caratula = lines.find(l => l.startsWith('Carátula:'))?.replace('Carátula:', '').replace(/^"|"$/g, '').trim() || '';
                const magistrados = lines.find(l => l.startsWith('Magistrados'))?.replace('Magistrados Votantes:', '').trim() || '';
                let falloId = '';
                let falloUrl = '';
                $(p).find('a[href*="idFallo"]').each((_, a) => {
                    const href = $(a).attr('href') || '';
                    const m = href.match(/idFallo=(\d+)/);
                    if (m) {
                        falloId = m[1];
                        falloUrl = href.startsWith('http') ? href : `https://juba.scba.gov.ar/${href}`;
                    }
                });
                if (codigo) {
                    fallos.push({ codigo, caratula, magistrados, id: falloId, urlTextoCompleto: falloUrl });
                }
            });
            panel.find('td.tdFilaRepeaterIdentada, td.FalloNoCoincidente, td.FalloCoincidente').each((_, td) => {
                const raw = $(td).text().replace(/\s+/g, ' ').trim();
                if (!raw || raw.length < 10)
                    return;
                const parts = raw.split(/(?=Carátula:)|(?=Magistrados Votantes:)/).map(p => p.trim()).filter(Boolean);
                const codigoRaw = parts[0] || '';
                const caratula = (parts.find(p => p.startsWith('Carátula:')) || '').replace('Carátula:', '').replace(/^[\"']|[\"']$/g, '').trim();
                const magistrados = (parts.find(p => p.startsWith('Magistrados Votantes:')) || '').replace('Magistrados Votantes:', '').trim();
                let falloId = '';
                let falloUrl = '';
                $(td).find('a[href*="idFallo"]').each((_, a) => {
                    const href = $(a).attr('href') || '';
                    const m = href.match(/idFallo=(\d+)/);
                    if (m) {
                        falloId = m[1];
                        falloUrl = href.startsWith('http') ? href : `https://juba.scba.gov.ar/${href}`;
                    }
                });
                if (codigoRaw && fallos.findIndex(f => f.codigo === codigoRaw) === -1) {
                    fallos.push({ codigo: codigoRaw, caratula, magistrados, id: falloId, urlTextoCompleto: falloUrl });
                }
            });
        });
        sumarios.push({ posicion, materia, nroSumario, voces, texto: textoSumario, fallos });
        cardIdx++;
        // Límite de seguridad: nunca más de 200 resultados por página
        if (cardIdx > 200) break;
    }
    return { sumarios, stats };
}
/** Formatea sumarios en el estilo visual de JUBA */
function formatSumarios(sumarios, stats) {
    let out = `# JUBA – Suprema Corte de Justicia de Bs. As.\n\n`;
    if (stats)
        out += `> ${stats}\n\n`;
    out += `---\n\n`;
    if (sumarios.length === 0) {
        out += `**Sin resultados.** Pruebe con términos más generales o use otra herramienta.\n`;
        return out;
    }
    sumarios.forEach((s, i) => {
        out += `## ${s.posicion || `Resultado ${i + 1}`}\n`;
        if (s.materia)
            out += `### ${s.materia}`;
        if (s.nroSumario)
            out += `  ·  \`${s.nroSumario}\``;
        out += `\n\n`;
        if (s.voces)
            out += `**Voces:** ${s.voces}\n\n`;
        if (s.texto)
            out += `${s.texto}\n\n`;
        if (s.fallos.length > 0) {
            out += `**Fallos Relacionados:**\n`;
            s.fallos.slice(0, 5).forEach(f => {
                out += `- \`${f.id || '–'}\` ${f.codigo}\n`;
                if (f.caratula)
                    out += `  Carátula: *${f.caratula}*\n`;
                if (f.magistrados)
                    out += `  Magistrados: ${f.magistrados}\n`;
                if (f.urlTextoCompleto)
                    out += `  → [Ver texto completo](${f.urlTextoCompleto})\n`;
            });
            out += `\n`;
        }
        out += `---\n\n`;
    });
    out += `\n> Para leer un fallo íntegro, usa \`obtener_sentencia\` con el ID numérico del fallo.\n`;
    return out;
}
// ─────────────────────────────────────────────────────────────────
// SCRAPERS INTERNOS
// ─────────────────────────────────────────────────────────────────
async function searchRapida(query, materia = "Todos") {
    const url = "https://juba.scba.gov.ar/Buscar.aspx";
    const resGet = await axios.get(url, {
        httpsAgent,
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "es-AR,es;q=0.9",
        }
    });
    const $ = cheerio.load(resGet.data);
    // Extraer TODAS las cookies de sesion
    const rawCookies = resGet.headers["set-cookie"] || [];
    const cookieStr = rawCookies.map(c => c.split(';')[0]).join('; ');
    const params = new URLSearchParams();
    // Campos hidden del formulario (viewstate, etc)
    $('form#form1 input[type="hidden"]').each((_, el) => {
        const name = $(el).attr('name');
        if (name) params.append(name, $(el).attr('value') || '');
    });
    // Campos visibles con sus valores por defecto
    $('form#form1 input[type="text"], form#form1 input[type="radio"]:checked, form#form1 input[type="checkbox"]:checked').each((_, el) => {
        const name = $(el).attr('name');
        if (name) params.append(name, $(el).attr('value') || '');
    });
    // Selects con su valor seleccionado
    $('form#form1 select').each((_, el) => {
        const name = $(el).attr('name');
        if (!name) return;
        const selected = $(el).find('option[selected]').attr('value') ?? $(el).find('option').first().attr('value') ?? '';
        params.set(name, selected);
    });
    // Campos de la busqueda rapida
    params.set("ctl00$cphMainContent$txtExpresionBusquedaRapida", query);
    params.set("ctl00$cphMainContent$ddlMateria", materia);
    // El boton de submit en WebForms: su name debe estar en el POST
    params.set("ctl00$cphMainContent$btnUnicaBusqueda", "Buscar");
    const resPost = await axios.post(url, params.toString(), {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": url,
            "Origin": "https://juba.scba.gov.ar",
            "Cookie": cookieStr,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "es-AR,es;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
        httpsAgent,
        maxRedirects: 5
    });
    return parseSumarios(resPost.data);
}
async function searchIntegral(opts) {
    const url = "https://juba.scba.gov.ar/Busquedas.aspx";
    const resGet = await axios.get(url, {
        httpsAgent,
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "es-AR,es;q=0.9",
        }
    });
    const $ = cheerio.load(resGet.data);
    const rawCookies = resGet.headers["set-cookie"] || [];
    const cookieStr = rawCookies.map(c => c.split(';')[0]).join('; ');
    const params = new URLSearchParams();
    $('form#form1 input[type="hidden"]').each((_, el) => {
        const name = $(el).attr('name');
        if (name)
            params.append(name, $(el).attr('value') || '');
    });
    $('form#form1 input[type="text"]').each((_, el) => {
        const name = $(el).attr('name');
        if (name)
            params.append(name, $(el).attr('value') || '');
    });
    $('form#form1 select').each((_, el) => {
        const name = $(el).attr('name');
        if (!name)
            return;
        const sel = $(el).find('option[selected]').attr('value');
        params.append(name, sel !== undefined ? sel : ($(el).find('option').first().attr('value') || ''));
    });
    params.set("ctl00$cphMainContent$TipoBusqueda", "rdbBusquedaIntegral");
    params.set("ctl00$cphMainContent$txtExpresionBusquedaIntegral", opts.termino);
    params.set("ctl00$cphMainContent$txtPrimeraCarga", "NO");
    if (opts.enVoces)
        params.set("ctl00$cphMainContent$chkVoces", "on");
    if (opts.enCaratula)
        params.set("ctl00$cphMainContent$chkCaratula", "on");
    if (opts.enSumario)
        params.set("ctl00$cphMainContent$chkTextoSumario", "on");
    if (opts.enTextoCompleto)
        params.set("ctl00$cphMainContent$chkTextoCompleto", "on");
    if (opts.enJuez)
        params.set("ctl00$cphMainContent$chklJuezVoto", "on");
    if (opts.enNroCausa)
        params.set("ctl00$cphMainContent$chkNroCausa", "on");
    if (opts.fechaDesde)
        params.set("ctl00$cphMainContent$txtFechaFalloDesde", opts.fechaDesde);
    if (opts.fechaHasta)
        params.set("ctl00$cphMainContent$txtFechaFalloHasta", opts.fechaHasta);
    if (opts.tipoVoto)
        params.set("ctl00$cphMainContent$ddlVotos", opts.tipoVoto);
    params.set("ctl00$cphMainContent$btnRealizarBusqueda", "Buscar");
    const resPost = await axios.post(url, params.toString(), {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": url,
            "Origin": "https://juba.scba.gov.ar",
            "Cookie": cookieStr,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "es-AR,es;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
        httpsAgent
    });
    return parseSumarios(resPost.data);
}
/** Extrae el texto completo y metadatos de un fallo por ID */
async function fetchJubaDocument(idFallo) {
    const url = `https://juba.scba.gov.ar/VerTextoCompleto.aspx?idFallo=${idFallo}`;
    const res = await axios.get(url, { httpsAgent });
    const $ = cheerio.load(res.data);
    const materia = $('span[id*="lblMateria"]').text().trim()
        || $('h2.materia, .panel-heading').first().text().trim();
    const tribunal = $('span[id*="lblTribunal"]').text().trim();
    const caratula = $('span[id*="lblCaratula"]').text().trim();
    const nroCausa = $('span[id*="lblNroCausa"]').text().trim();
    const fecha = $('span[id*="lblFecha"]').text().trim();
    const magistrados = $('span[id*="lblMagistrado"]').text().trim();
    const tipoFallo = $('span[id*="lblTipoFallo"]').text().trim();
    $('script, noscript, style, nav, header, footer, .nav-custom, #divtope').remove();
    const panelTexto = $('#cphMainContent_pnlTextoCompleto, #cphMainContent_UpdatePanel1').text().replace(/\s+/g, ' ').trim()
        || $('#form1').text().replace(/\s+/g, ' ').trim();
    // FIX: ID inexistente devolvia un stub HTML con todas las etiquetas vacias.
    // El stub real (verificado con id 999999) es: "VISUALIZACION DEL TEXTO
    // COMPLETO DATOS DEL FALLO Materia: Tipo de Fallo: ... Imprimir Descargar
    // TEXTO COMPLETO TEXTO COMPLETO PRIVADO" (~250 caracteres de puro chrome).
    // Se eliminan TODOS los rotulos y botones de la UI; si no hay metadatos y
    // el remanente es trivial o carece de marcadores de contenido juridico,
    // el fallo no existe.
    const hasMeta = [materia, tribunal, caratula, nroCausa, fecha, magistrados, tipoFallo]
        .some((v) => v && v.length > 0);
    const textoNeto = panelTexto
        .replace(/VISUALIZACI[ÓO]N DEL TEXTO COMPLETO|DATOS DEL FALLO|TEXTO COMPLETO( PRIVADO)?|Texto Completo/gi, ' ')
        .replace(/Materia:|Tipo de Fallo:|Tribunal Emisor:|Tribunal Origen:|Causa:|N[º°]? ?de Causa:|Nro Registro Interno:|Car[áa]tula( P[úu]blica)?:|Fecha:|Magistrados Votantes:|NNF:|Observaci[óo]n(es)?:|Sentencias Anuladas:|Alcance:|Iniciales:/gi, ' ')
        .replace(/\b(Imprimir|Descargar|Volver|Cerrar)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const tieneContenidoJuridico = /VISTOS?|CONSIDERANDO|RESUELVE|SENTENCIA|AUTOS Y VISTOS|recurso|tribunal|expediente/i.test(textoNeto);
    if (!hasMeta && (textoNeto.length < 120 || !tieneContenidoJuridico)) {
        throw new Error(`Fallo no encontrado en JUBA: el ID ${idFallo} no existe o no tiene texto completo disponible. Verifique el ID con una busqueda previa (las busquedas devuelven el ID correcto de cada fallo).`);
    }
    return {
        url,
        materia, tribunal, caratula, nroCausa, fecha, magistrados, tipoFallo,
        texto: panelTexto
    };
}
// ─────────────────────────────────────────────────────────────────
// REGISTRO DE TODAS LAS TOOLS
// ─────────────────────────────────────────────────────────────────
export function registerAllTools(server) {
    // GRUPO A: BÚSQUEDA RÁPIDA POR MATERIA (7 tools dedicadas)
    server.tool("buscar_fallos_civil_y_comercial", "Busca sumarios de jurisprudencia de la SCBA exclusivamente en el fuero CIVIL Y COMERCIAL. Ideal para: daño moral, contratos, compraventa, locación, sucesiones, familia, daños y perjuicios, seguros, concursos.", { criterio: z.string().describe("Términos de búsqueda (ej. 'daño moral', 'contratos', 'seguro automotor')") }, async (args) => {
        try {
            const { sumarios, stats } = await searchRapida(args.criterio, "Civil y Comercial");
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    server.tool("buscar_fallos_penal", "Busca sumarios de jurisprudencia de la SCBA exclusivamente en el fuero PENAL. Ideal para: homicidio, robo, hurto, estafa, prisión preventiva, excarcelación, recursos de casación penal, garantías constitucionales en el proceso penal.", { criterio: z.string().describe("Términos de búsqueda (ej. 'homicidio doloso', 'prisión preventiva', 'excarcelación')") }, async (args) => {
        try {
            const { sumarios, stats } = await searchRapida(args.criterio, "Penal");
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    server.tool("buscar_fallos_laboral", "Busca sumarios de jurisprudencia de la SCBA exclusivamente en el fuero LABORAL. Ideal para: despido, indemnización, accidentes de trabajo, ART, relación laboral, horas extras, aportes jubilatorios.", { criterio: z.string().describe("Términos de búsqueda (ej. 'despido injustificado', 'accidente de trabajo', 'ART')") }, async (args) => {
        try {
            const { sumarios, stats } = await searchRapida(args.criterio, "Laboral");
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    server.tool("buscar_fallos_contencioso_administrativo", "Busca sumarios de jurisprudencia de la SCBA exclusivamente en el fuero CONTENCIOSO ADMINISTRATIVO. Ideal para: actos administrativos, habilitación de instancia, contratos administrativos, empleo público, servicios públicos.", { criterio: z.string().describe("Términos de búsqueda (ej. 'habilitación de instancia', 'acto administrativo', 'empleo público')") }, async (args) => {
        try {
            const { sumarios, stats } = await searchRapida(args.criterio, "Contencioso administrativa");
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    server.tool("buscar_fallos_inconstitucionalidad", "Busca sumarios de jurisprudencia de la SCBA exclusivamente en la materia INCONSTITUCIONALIDAD.", { criterio: z.string().describe("Términos de búsqueda (ej. 'inconstitucionalidad de ley', 'control difuso', 'derechos fundamentales')") }, async (args) => {
        try {
            const { sumarios, stats } = await searchRapida(args.criterio, "Inconstitucionalidad");
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    server.tool("buscar_fallos_conflicto_de_poderes", "Busca sumarios de jurisprudencia de la SCBA en la materia CONFLICTO DE PODERES.", { criterio: z.string().describe("Términos de búsqueda (ej. 'división de poderes', 'autonomía municipal')") }, async (args) => {
        try {
            const { sumarios, stats } = await searchRapida(args.criterio, "Conflicto de Poderes");
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    server.tool("buscar_fallos_enjuiciamiento_magistrados", "Busca sumarios de jurisprudencia de la SCBA en la materia ENJUICIAMIENTO DE MAGISTRADOS.", { criterio: z.string().describe("Términos de búsqueda (ej. 'mal desempeño', 'destitución de magistrado')") }, async (args) => {
        try {
            const { sumarios, stats } = await searchRapida(args.criterio, "Enjuiciamiento de Magistrados");
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    // GRUPO B: BÚSQUEDA RÁPIDA GENERAL
    server.tool("buscar_jurisprudencia", "Busca sumarios de jurisprudencia en JUBA en TODOS los fueros simultáneamente.", { criterio: z.string().describe("Términos de búsqueda libre (ej. 'daño moral', 'recurso extraordinario', 'nulidad')") }, async (args) => {
        try {
            const { sumarios, stats } = await searchRapida(args.criterio, "Todos");
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    // GRUPO C: BÚSQUEDA INTEGRAL POR CAMPO ESPECÍFICO
    server.tool("buscar_por_voces_juridicas", "Busca en las VOCES JURÍDICAS indexadas de los sumarios.", { voces: z.string().describe("Voz o instituto jurídico (ej. 'DAÑO MORAL', 'PRISIÓN PREVENTIVA')") }, async (args) => {
        try {
            const { sumarios, stats } = await searchIntegral({ termino: args.voces, enVoces: true });
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    server.tool("buscar_en_texto_sumario", "Busca términos dentro del CUERPO TEXTUAL del sumario jurídico.", { termino: z.string().describe("Texto o frase del sumario") }, async (args) => {
        try {
            const { sumarios, stats } = await searchIntegral({ termino: args.termino, enSumario: true });
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    server.tool("buscar_en_texto_completo_fallo", "Busca términos dentro del TEXTO ÍNTEGRO de los fallos.", { termino: z.string().describe("Frase, artículo de ley, cita o argumento") }, async (args) => {
        try {
            const { sumarios, stats } = await searchIntegral({ termino: args.termino, enTextoCompleto: true });
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    server.tool("buscar_por_caratula", "Busca expedientes por el NOMBRE DE LAS PARTES o título de la carátula.", { caratula: z.string().describe("Nombre o parte de la carátula (ej. 'GARCIA c/ MUNICIPALIDAD')") }, async (args) => {
        try {
            const { sumarios, stats } = await searchIntegral({ termino: args.caratula, enCaratula: true });
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    server.tool("buscar_por_magistrado", "Busca todos los fallos en los que un MAGISTRADO ESPECÍFICO participó como votante.", { magistrado: z.string().describe("Apellido del juez (ej. 'KOGAN', 'GENOUD', 'SORIA')") }, async (args) => {
        try {
            const { sumarios, stats } = await searchIntegral({ termino: args.magistrado, enJuez: true });
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    // GRUPO D: BÚSQUEDAS CON FILTROS TEMPORALES
    server.tool("buscar_jurisprudencia_reciente", "Busca jurisprudencia dictada en los últimos 2 años (desde 2024).", { criterio: z.string().describe("Términos de búsqueda") }, async (args) => {
        try {
            const { sumarios, stats } = await searchIntegral({
                termino: args.criterio, enVoces: true, enSumario: true,
                fechaDesde: "01/01/2024", fechaHasta: ""
            });
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    server.tool("buscar_jurisprudencia_por_periodo", "Busca jurisprudencia dictada dentro de un RANGO DE FECHAS específico.", {
        criterio: z.string().describe("Términos de búsqueda"),
        fecha_desde: z.string().describe("Fecha de inicio en formato DD/MM/AAAA (ej. '01/01/2020')"),
        fecha_hasta: z.string().describe("Fecha de fin en formato DD/MM/AAAA (ej. '31/12/2023')")
    }, async (args) => {
        try {
            const { sumarios, stats } = await searchIntegral({
                termino: args.criterio, enVoces: true, enSumario: true,
                fechaDesde: args.fecha_desde, fechaHasta: args.fecha_hasta
            });
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    // GRUPO E: FILTROS POR TIPO DE VOTO
    server.tool("buscar_fallos_por_unanimidad", "Busca fallos decididos por UNANIMIDAD (sin disidencias — SD).", { criterio: z.string().describe("Términos de búsqueda") }, async (args) => {
        try {
            const { sumarios, stats } = await searchIntegral({ termino: args.criterio, enVoces: true, enSumario: true, tipoVoto: "SD" });
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    server.tool("buscar_fallos_por_mayoria", "Busca fallos decididos por MAYORÍA (MA).", { criterio: z.string().describe("Términos de búsqueda") }, async (args) => {
        try {
            const { sumarios, stats } = await searchIntegral({ termino: args.criterio, enVoces: true, enSumario: true, tipoVoto: "MA" });
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    server.tool("buscar_votos_en_minoria", "Busca VOTOS EN MINORÍA (MI) de la SCBA.", { criterio: z.string().describe("Términos de búsqueda") }, async (args) => {
        try {
            const { sumarios, stats } = await searchIntegral({ termino: args.criterio, enVoces: true, enSumario: true, tipoVoto: "MI" });
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    // GRUPO F: BÚSQUEDA AVANZADA COMBINADA
    server.tool("buscar_jurisprudencia_avanzada", "Búsqueda MULTI-CAMPO avanzada en JUBA. Permite combinar búsqueda en voces, sumario y texto completo, con filtros opcionales de fecha y tipo de voto.", {
        termino: z.string().describe("Términos o frases legales a buscar"),
        en_voces: z.boolean().optional().default(true).describe("Buscar en voces jurídicas"),
        en_sumario: z.boolean().optional().default(true).describe("Buscar en el texto del sumario"),
        en_texto_completo: z.boolean().optional().default(false).describe("Buscar en el texto íntegro"),
        en_caratula: z.boolean().optional().default(false).describe("Buscar en la carátula del expediente"),
        fecha_desde: z.string().optional().describe("Fecha desde (DD/MM/AAAA)"),
        fecha_hasta: z.string().optional().describe("Fecha hasta (DD/MM/AAAA)"),
        tipo_voto: z.enum(["SD", "MA", "MI", "OP"]).optional().describe("SD=Unanimidad, MA=Mayoría, MI=Minoría, OP=Opinión personal")
    }, async (args) => {
        try {
            const { sumarios, stats } = await searchIntegral({
                termino: args.termino,
                enVoces: args.en_voces,
                enSumario: args.en_sumario,
                enTextoCompleto: args.en_texto_completo,
                enCaratula: args.en_caratula,
                fechaDesde: args.fecha_desde,
                fechaHasta: args.fecha_hasta,
                tipoVoto: args.tipo_voto
            });
            return { content: [{ type: "text", text: formatSumarios(sumarios, stats) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    // GRUPO G: LECTURA DE FALLOS
    server.tool("obtener_sentencia", "Descarga el TEXTO ÍNTEGRO de una resolución judicial de la SCBA a partir de su ID numérico.", {
        id_fallo: z.string().describe("ID numérico del fallo (ej. '195364', '186193')")
    }, async (args) => {
        try {
            const r = await fetchJubaDocument(args.id_fallo);
            let out = `# Fallo Nº ${args.id_fallo} — JUBA SCBA\n\n`;
            out += `**Fuente:** ${r.url}\n\n`;
            out += `---\n\n`;
            if (r.materia)
                out += `## ${r.materia}\n\n`;
            if (r.tribunal)
                out += `**Tribunal:** ${r.tribunal}\n`;
            if (r.nroCausa)
                out += `**Nº de Causa:** ${r.nroCausa}\n`;
            if (r.tipoFallo)
                out += `**Tipo:** ${r.tipoFallo}\n`;
            if (r.fecha)
                out += `**Fecha:** ${r.fecha}\n`;
            if (r.magistrados)
                out += `**Magistrados Votantes:** ${r.magistrados}\n`;
            if (r.caratula)
                out += `**Carátula:** *${r.caratula}*\n`;
            out += `\n---\n\n`;
            out += `## Texto del Fallo\n\n`;
            out += r.texto.substring(0, 50000);
            if (r.texto.length > 50000)
                out += `\n\n*[Texto truncado a 50.000 caracteres — el fallo continúa en ${r.url}]*`;
            return { content: [{ type: "text", text: out }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    });
    // GRUPO H: INFORMACIÓN DEL SERVIDOR
    server.tool("juba_info", "Describe las capacidades, cobertura, fueros y herramientas disponibles en este servidor MCP de jurisprudencia de la SCBA.", {}, async () => {
        const out = `# JUBA MCP — Suprema Corte de Justicia de Buenos Aires

**Fuente oficial:** https://juba.scba.gov.ar/

## Cobertura
- Sumarios SCBA (definitivas e interlocutorias) desde **1984**
- Cámaras de Apelaciones desde **1990**
- Fallos in extenso Civil y Comercial SCBA desde **1986**
- Otras materias SCBA in extenso desde **1996**

## Herramientas por Grupo

### A – Por Fuero (tools dedicadas)
| Tool | Fuero |
|---|---|
| \`buscar_fallos_civil_y_comercial\` | Civil y Comercial |
| \`buscar_fallos_penal\` | Penal |
| \`buscar_fallos_laboral\` | Laboral |
| \`buscar_fallos_contencioso_administrativo\` | Contencioso Administrativa |
| \`buscar_fallos_inconstitucionalidad\` | Inconstitucionalidad |
| \`buscar_fallos_conflicto_de_poderes\` | Conflicto de Poderes |
| \`buscar_fallos_enjuiciamiento_magistrados\` | Enjuiciamiento de Magistrados |

### B – General
| Tool | Descripción |
|---|---|
| \`buscar_jurisprudencia\` | Todos los fueros |

### C – Por Campo Específico
| Tool | Campo |
|---|---|
| \`buscar_por_voces_juridicas\` | Voces indexadas |
| \`buscar_en_texto_sumario\` | Cuerpo del sumario |
| \`buscar_en_texto_completo_fallo\` | Texto íntegro del fallo |
| \`buscar_por_caratula\` | Nombre de las partes |
| \`buscar_por_magistrado\` | Juez votante |

### D – Por Período
| Tool | Descripción |
|---|---|
| \`buscar_jurisprudencia_reciente\` | Desde 2024 |
| \`buscar_jurisprudencia_por_periodo\` | Rango personalizado |

### E – Por Tipo de Voto
| Tool | Tipo |
|---|---|
| \`buscar_fallos_por_unanimidad\` | Sin disidencia (SD) |
| \`buscar_fallos_por_mayoria\` | Mayoría (MA) |
| \`buscar_votos_en_minoria\` | Minoría (MI) |

### F – Combinada
| Tool | Descripción |
|---|---|
| \`buscar_jurisprudencia_avanzada\` | Multi-campo + todos los filtros |

### G – Lectura
| Tool | Descripción |
|---|---|
| \`obtener_sentencia\` | Texto íntegro por ID |

### H – Info
| Tool | Descripción |
|---|---|
| \`juba_info\` | Esta descripción |`;
        return { content: [{ type: "text", text: out }] };
    });
}
// ─────────────────────────────────────────────────────────────────
// INICIALIZACIÓN
// ─────────────────────────────────────────────────────────────────
registerAllTools(server);
if (typeof process !== "undefined" && !process.env.VERCEL && !process.env.NEXT_RUNTIME) {
    const transport = new StdioServerTransport();
    server.connect(transport).catch((err) => {
        console.error("Server connection failed", err);
        process.exit(1);
    });
    console.error("JUBA MCP — Suprema Corte de Justicia de Bs. As. — Running via Stdio");
}
//# sourceMappingURL=juba.js.map
