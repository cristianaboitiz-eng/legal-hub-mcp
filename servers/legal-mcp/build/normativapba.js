#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import { installTlsFallback } from "./tls-fallback.js";
// TLS estricto por defecto; fallback inseguro solo ante cert roto (ver tls-fallback.js).
// Antes: agente inseguro fijo "para webs del gobierno".
const httpsAgent = installTlsFallback(axios, "normativapba");
// Initialize the MCP Server
const server = new McpServer({
    name: "normativaPBA",
    version: "1.0.0"
});
const BASE_URL = "https://normas.gba.gob.ar";
/**
 * Tool 1: Buscar Normativa
 */
server.tool("buscar_normativa", "Busca normativas de la Provincia de Buenos Aires (PBA). Traduce lenguaje natural a parámetros de búsqueda estructurados.", {
    frase_exacta: z.string().optional().describe("Frase exacta a buscar en la norma (ej. 'licencia por maternidad'). Equivalente a q[phrase]."),
    palabras_clave: z.string().optional().describe("Palabras que pueden aparecer en la norma (ej. 'licencia maternidad docente'). Equivalente a q[with_some_words]."),
    tipo_norma: z.string().optional().describe("Tipo de norma, ej. 'ley', 'decreto', 'resolucion', 'disposicion'."),
    numero: z.string().optional().describe("Número específico de la norma."),
    anio: z.string().optional().describe("Año de la norma (ej. 2011, 2024)."),
    pagina: z.number().optional().default(1).describe("Página de los resultados (para paginación).")
}, async (args) => {
    try {
        const params = new URLSearchParams();
        if (args.frase_exacta)
            params.append("q[phrase]", args.frase_exacta);
        if (args.palabras_clave)
            params.append("q[with_some_words]", args.palabras_clave);
        // FIX: q[terms][raw_type] esta roto en el sitio (verificado 10/6/26:
        // 'ley', 'Ley' y 'LEY' devuelven 0 aunque haya miles de leyes; el indice
        // no matchea ningun valor). En cambio q[terms][number] y [year] funcionan.
        // El tipo se filtra localmente por el slug del enlace (/ar-b/{tipo}/...).
        const tipoSlug = args.tipo_norma
            ? args.tipo_norma.toLowerCase()
                .normalize("NFD").replace(/[̀-ͯ]/g, "")
                .trim().replace(/[\s_]+/g, "-")
            : null;
        if (args.numero)
            params.append("q[terms][number]", args.numero);
        if (args.anio)
            params.append("q[terms][year]", args.anio);
        if (args.pagina)
            params.append("page", args.pagina.toString());
        const url = `${BASE_URL}/resultados?${params.toString()}`;
        const response = await axios.get(url, {
            httpsAgent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MCP-Connector/1.0'
            }
        });
        const $ = cheerio.load(response.data);
        // Buscar información de paginación
        let pageInfo = "";
        $('div, span, p').each((i, el) => {
            const txt = $(el).text();
            if (txt.includes('Página ') && txt.includes('resultados')) {
                pageInfo = txt.trim();
            }
        });
        if (!pageInfo)
            pageInfo = "Resultados encontrados";
        const resultados = [];
        // Seleccionar las tarjetas
        $('.card').each((i, el) => {
            const titleEl = $(el).find('a');
            const title = titleEl.text().trim();
            const link = titleEl.attr('href');
            // Extraer texto alrededor de la fecha
            let fechaText = 'No disponible';
            let textoCompletoTarjeta = $(el).text();
            const fechaMatch = textoCompletoTarjeta.match(/Fecha de publicación:\s*([\d\/]+)/);
            if (fechaMatch)
                fechaText = fechaMatch[1];
            let extracto = "";
            $(el).find('h6').each((i, h6) => {
                if ($(h6).text().trim() === 'Texto') {
                    extracto = $(h6).next('p').text().trim() || $(h6).parent().text().trim();
                }
            });
            if (!extracto) {
                extracto = $(el).text().replace(/\s+/g, ' ').substring(0, 150);
            }
            if (title && link && link.includes('/ar-b/')) {
                resultados.push({
                    titulo: title.split('\n')[0].trim(),
                    enlace: link.startsWith('http') ? link : `${BASE_URL}${link}`,
                    fecha_publicacion: fechaText,
                    fragmento: extracto.substring(0, 250) + '...'
                });
            }
        });
        let filtrados = resultados;
        if (tipoSlug) {
            filtrados = resultados.filter(r => r.enlace.includes(`/ar-b/${tipoSlug}/`));
        }
        let content = `**Búsqueda ejecutada en el origen:** ${url}\n**Estado:** ${pageInfo}\n`;
        if (tipoSlug)
            content += `**Filtro de tipo:** '${tipoSlug}' aplicado localmente sobre esta página de resultados (${filtrados.length} de ${resultados.length}). Si necesitás más, avanzá con 'pagina'.\n`;
        content += `\n`;
        if (filtrados.length === 0) {
            content += tipoSlug && resultados.length > 0
                ? `Esta página no contiene normas de tipo '${tipoSlug}'. Probá con 'pagina' siguiente o quitá el filtro de tipo.`
                : "No se encontraron normativas con los parámetros especificados. Prueba ampliando la búsqueda o usando 'palabras_clave' en lugar de 'frase_exacta'.";
        }
        else {
            filtrados.forEach((r, idx) => {
                content += `### ${idx + 1}. ${r.titulo}\n`;
                content += `- **Enlace:** ${r.enlace}\n`;
                content += `- **Publicación:** ${r.fecha_publicacion}\n`;
                content += `- **Resumen:** ${r.fragmento.replace(/\s+/g, ' ')}\n\n`;
            });
            content += `\n*Nota: Usa la herramienta 'obtener_texto_norma' con el [Enlace] para leer el cuerpo completo.*`;
        }
        return {
            content: [{ type: "text", text: content }]
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error al consultar normas.gba.gob.ar: ${error.message}` }],
            isError: true
        };
    }
});
/**
 * Tool 2: Obtener Texto de Norma
 *
 * Estrategia:
 * 1. Descarga la página de la norma (que contiene metadatos y links)
 * 2. Detecta si hay un link "Ver texto actualizado" (.html) con el articulado completo
 * 3. Si existe, lo descarga y extrae el texto real artículo por artículo
 * 4. Si no, usa el texto disponible en la página de metadatos
 */
server.tool("obtener_texto_norma", "Recupera el texto completo de una normativa de PBA. Puedes pasar la URL directa, o usar los parámetros (numero, tipo_norma, anio) para que busque la ley automáticamente.", {
    url: z.string().url().optional().describe("La URL completa de la norma. Si no la tienes, usa los otros parámetros."),
    numero: z.string().optional().describe("Número de la norma (ej. '10430')."),
    tipo_norma: z.string().optional().describe("Tipo de norma (ej. 'ley', 'decreto')."),
    anio: z.string().optional().describe("Año de la norma.")
}, async (args) => {
    try {
        let targetUrl = args.url;
        // Resolución Automática de URL
        if (!targetUrl) {
            if (!args.numero && !args.tipo_norma) {
                throw new Error("Debe proveer una 'url' o al menos un 'numero' o 'tipo_norma' para buscar la norma automáticamente.");
            }
            const params = new URLSearchParams();
            if (args.numero)
                params.append("q[terms][number]", args.numero);
            if (args.anio)
                params.append("q[terms][year]", args.anio);
            if (!args.numero && args.tipo_norma)
                params.append("q[phrase]", args.tipo_norma);
            const searchUrl = `${BASE_URL}/resultados?${params.toString()}`;
            const searchRes = await axios.get(searchUrl, { httpsAgent, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $s = cheerio.load(searchRes.data);
            let firstLink = undefined;
            if (args.tipo_norma) {
                const tipoNormaLower = args.tipo_norma.toLowerCase();
                $s('.card').each((_, el) => {
                    const title = $s(el).find('a').text().toLowerCase();
                    if (title.includes(tipoNormaLower) && !firstLink) {
                        firstLink = $s(el).find('a').attr('href');
                    }
                });
            }
            if (!firstLink) {
                firstLink = $s('.card a[href*="/ar-b/"]').first().attr('href');
            }
            if (!firstLink) {
                return { content: [{ type: "text", text: `No se pudo encontrar automáticamente la norma con los parámetros: ${JSON.stringify(args)}` }] };
            }
            targetUrl = firstLink.startsWith('http') ? firstLink : `${BASE_URL}${firstLink}`;
        }
        // PASO 1: Descargar la página de metadatos de la norma
        const metaResponse = await axios.get(targetUrl, {
            httpsAgent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MCP-Connector/1.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-AR,es;q=0.9'
            },
            timeout: 15000
        });
        const $meta = cheerio.load(metaResponse.data);
        // Extraer título
        const titulo = $meta('h1, h2, h3, h4').first().text().trim() || "Normativa";
        // Extraer metadatos clave (tipo, número, fecha, organismo, etc.)
        const metadatos = [];
        $meta('body').find('p, li, td, span, div').each((_, el) => {
            const txt = $meta(el).clone().children().remove().end().text().trim();
            if (txt.length > 5 && txt.length < 200 &&
                /fecha|número|boletín|tipo|organismo|jurisdicción|publicación|promulgación|sanción|resumen|derogad|vigente|modificad/i.test(txt)) {
                const clean = txt.replace(/\s+/g, ' ');
                if (!metadatos.includes(clean))
                    metadatos.push(clean);
            }
        });
        // PASO 2: Buscar link al documento HTML con el texto completo
        // Prioridad: "Ver texto actualizado" > "Ver texto original" (html)
        let docHtmlUrl = null;
        let docPdfUrl = null;
        $meta('a[href*="/documentos/"]').each((_, el) => {
            const href = $meta(el).attr('href') || '';
            const label = $meta(el).text().toLowerCase();
            const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
            if (href.endsWith('.html')) {
                // Prefiere "texto actualizado" sobre "fundamentos" u otros
                if (!docHtmlUrl || label.includes('actualizado') || label.includes('texto')) {
                    docHtmlUrl = fullUrl;
                }
            }
            else if (href.endsWith('.pdf') && !docPdfUrl) {
                docPdfUrl = fullUrl;
            }
        });
        // PASO 3: Si hay documento HTML, descargarlo y extraer el articulado completo
        let textoCompleto = "";
        let fuenteTexto = "";
        if (docHtmlUrl) {
            try {
                const docResponse = await axios.get(docHtmlUrl, {
                    httpsAgent,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MCP-Connector/1.0',
                        'Referer': targetUrl
                    },
                    timeout: 20000
                });
                const $doc = cheerio.load(docResponse.data);
                // Eliminar solo elementos no-textuales (scripts, estilos, navegación)
                $doc('script, style, nav').remove();
                // Intentar extraer el cuerpo principal del articulado
                const bodySelectors = ['article', 'main', '.content', '#content', 'body'];
                for (const sel of bodySelectors) {
                    const candidate = $doc(sel).text().trim();
                    if (candidate.length > 200) {
                        textoCompleto = candidate;
                        break;
                    }
                }
                // Limpieza MÍNIMA: solo reducir líneas vacías excesivas (3+ → 2)
                // NO alterar tabs, indentación ni estructura original del articulado
                textoCompleto = textoCompleto
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();
                fuenteTexto = `Fuente: ${docHtmlUrl}`;
            }
            catch (docErr) {
                textoCompleto = `⚠️ No se pudo descargar el documento HTML con el articulado completo.\nURL del documento: ${docHtmlUrl}\nError: ${docErr.message}`;
                fuenteTexto = "";
            }
        }
        else {
            // PASO 4 (fallback): Extraer texto desde la propia página de metadatos
            // SIN truncar — se entrega el texto completo tal como está en la fuente
            $meta('script, style, nav').remove();
            const mainText = $meta('.card-content, main, article, #content').text() || $meta('body').text();
            textoCompleto = mainText
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            fuenteTexto = `⚠️ No se encontró documento HTML con articulado. Se muestra texto extraído de la página de metadatos.`;
        }
        // Construir respuesta final
        let content = `# ${titulo}\n\n`;
        if (metadatos.length > 0) {
            content += `## Datos Oficiales\n${metadatos.map(m => `- ${m}`).join('\n')}\n\n`;
        }
        content += `## Documentos Disponibles\n`;
        if (docHtmlUrl)
            content += `- 📄 [Texto completo (HTML)](${docHtmlUrl})\n`;
        if (docPdfUrl)
            content += `- 📑 [Texto original (PDF)](${docPdfUrl})\n`;
        if (!docHtmlUrl && !docPdfUrl)
            content += `- *(No se detectaron documentos adjuntos)*\n`;
        content += '\n';
        content += `## Texto Íntegro de la Norma\n`;
        content += `> ⚠️ **TEXTO LITERAL** extraído de la fuente oficial sin alteraciones. No citar fragmentos que no aparezcan textualmente a continuación.\n\n`;
        if (fuenteTexto)
            content += `*${fuenteTexto}*\n\n`;
        content += textoCompleto;
        return {
            content: [{ type: "text", text: content }]
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error al obtener la norma desde ${args.url}: ${error.message}` }],
            isError: true
        };
    }
});
/**
 * Tool 3: Alcance Normativo
 * Devuelve metadatos estáticos sobre el MCP: fuentes, cobertura, tools disponibles y disclaimer.
 * Análogo a funciones de contexto y disclaimer legales.
 */
server.tool("alcance_normativo", "Informa el alcance, fuentes y cobertura de este sistema de consulta normativa de la Provincia de Buenos Aires: qué tipos de normas cubre, desde qué año, cuáles son las herramientas disponibles y el aviso legal aplicable.", {}, async () => {
    const content = `# Normativa PBA MCP — Información del Servidor

## Identificación
- **Nombre:** Argentina Normativa PBA MCP
- **Versión:** 1.0.0
- **Jurisdicción:** Provincia de Buenos Aires (AR-B), Argentina
- **Mantenedor:** Proyecto JUBA SCBA

## Fuentes de Datos
| Fuente | Autoridad | URL | Método |
|--------|-----------|-----|--------|
| Sistema de Información Normativa y Documental "Malvinas Argentinas" | Subsecretaría Legal y Técnica — Secretaría General de la Provincia de Buenos Aires | https://normas.gba.gob.ar | Scraping en tiempo real |

> ⚡ **Tiempo real:** A diferencia de otros MCPs que usan bases de datos locales, este servidor consulta \`normas.gba.gob.ar\` en tiempo real. Los datos siempre reflejan el estado actual del portal oficial.

## Cobertura
- **Tipos de norma:** Leyes, Decretos, Resoluciones, Disposiciones, Decreto-Leyes, Ordenanzas y más
- **Período:** Toda la normativa publicada en el portal (desde 1813 hasta la actualidad)
- **Idioma:** Español (Argentina)
- **Territorio:** Provincia de Buenos Aires exclusivamente (no cubre legislación nacional ni otras provincias)

## Herramientas Disponibles (4)
| Herramienta | Descripción |
|-------------|-------------|
| \`buscar_normativa\` | Busca normativas por palabras clave, tipo, número y año. Devuelve listado paginado con links. |
| \`obtener_texto_norma\` | Descarga el texto completo de una norma dada su URL. Sigue automáticamente al articulado HTML. |
| \`verificar_vigencia\` | Verifica si una norma está vigente, fue derogada o tiene modificaciones incorporadas. |
| \`alcance_normativo\` | Este tool. Fuentes, cobertura territorial y aviso legal del sistema. |

## Flujo de Uso Recomendado
1. Usar \`buscar_normativa\` para encontrar normas relevantes → obtener URLs
2. Usar \`verificar_vigencia\` con la URL para confirmar que la norma está vigente antes de citarla
3. Usar \`obtener_texto_norma\` para leer el articulado completo

## Aviso Legal
> ⚠️ **Este servidor es una herramienta de investigación, no asesoramiento legal.**
> - Verificá siempre las citas contra las fuentes oficiales en \`normas.gba.gob.ar\` antes de usarlas profesionalmente.
> - La cobertura puede ser incompleta para normativa muy antigua o publicaciones recientes no indexadas.
> - El portal oficial puede tener demoras en la incorporación de modificaciones.

## Datos de Contacto Oficial
- **Portal:** https://normas.gba.gob.ar
- **Boletín Oficial PBA:** https://www.boletinoficial.gba.gob.ar/
- **Autoridad:** Secretaría General de la Provincia de Buenos Aires`;
    return {
        content: [{ type: "text", text: content }]
    };
});
/**
 * Tool 4: Verificar Vigencia
 *
 * Estrategia de detección de vigencia (múltiples señales):
 * 1. Campo "Observaciones" de la página de metadatos (puede tener texto de derogación)
 * 2. Primer párrafo del texto de la norma (patrón "DEROGADA POR X")
 * 3. Presencia de "texto actualizado" → la norma tiene modificaciones incorporadas
 * 4. Normas relacionadas: lista de normas que la modifican o derogan
 * 5. Campo "Última actualización" → indica cuándo fue la última modificación registrada
 */
server.tool("verificar_vigencia", "Verifica si una normativa está vigente, fue derogada o tiene modificaciones incorporadas. Puedes pasar la URL directa o los datos de la norma (numero, tipo_norma, anio) para que la busque automáticamente.", {
    url: z.string().url().optional().describe("La URL completa de la norma a verificar (ej. https://normas.gba.gob.ar/ar-b/ley/2011/14828/1)"),
    numero: z.string().optional().describe("Número de la norma (ej. '10430')."),
    tipo_norma: z.string().optional().describe("Tipo de norma (ej. 'ley', 'decreto')."),
    anio: z.string().optional().describe("Año de la norma.")
}, async (args) => {
    try {
        let targetUrl = args.url;
        // Resolución Automática de URL
        if (!targetUrl) {
            if (!args.numero && !args.tipo_norma) {
                throw new Error("Debe proveer una 'url' o al menos un 'numero' o 'tipo_norma' para buscar la norma automáticamente.");
            }
            const params = new URLSearchParams();
            if (args.numero)
                params.append("q[terms][number]", args.numero);
            if (args.anio)
                params.append("q[terms][year]", args.anio);
            if (!args.numero && args.tipo_norma)
                params.append("q[phrase]", args.tipo_norma);
            const searchUrl = `${BASE_URL}/resultados?${params.toString()}`;
            const searchRes = await axios.get(searchUrl, { httpsAgent, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $s = cheerio.load(searchRes.data);
            let firstLink = undefined;
            if (args.tipo_norma) {
                const tipoNormaLower = args.tipo_norma.toLowerCase();
                $s('.card').each((_, el) => {
                    const title = $s(el).find('a').text().toLowerCase();
                    if (title.includes(tipoNormaLower) && !firstLink) {
                        firstLink = $s(el).find('a').attr('href');
                    }
                });
            }
            if (!firstLink) {
                firstLink = $s('.card a[href*="/ar-b/"]').first().attr('href');
            }
            if (!firstLink) {
                return { content: [{ type: "text", text: `No se pudo encontrar automáticamente la norma con los parámetros: ${JSON.stringify(args)}` }] };
            }
            targetUrl = firstLink.startsWith('http') ? firstLink : `${BASE_URL}${firstLink}`;
        }
        const response = await axios.get(targetUrl, {
            httpsAgent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MCP-Connector/1.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-AR,es;q=0.9'
            },
            timeout: 15000
        });
        const $ = cheerio.load(response.data);
        // ── 1. Título de la norma ─────────────────────────────────────────────
        const titulo = $('h1, h2, h3, h4').first().text().trim() || "Normativa";
        // ── 2. Metadatos de cabecera ──────────────────────────────────────────
        const pageText = $('body').text().replace(/\s+/g, ' ');
        const fechaPromulgacion = pageText.match(/Fecha de promulgaci[oó]n[:\s]+([0-9\/]+)/i)?.[1] ?? null;
        const fechaPublicacion = pageText.match(/Fecha de publicaci[oó]n[:\s]+([0-9\/]+)/i)?.[1] ?? null;
        const nroBoletin = pageText.match(/N[uú]mero de Bolet[ií]n Oficial[:\s]+([0-9]+)/i)?.[1] ?? null;
        const ultimaActualizacion = pageText.match(/[uÚ]ltima actualizaci[oó]n[:\s]+([0-9\/\s:]+)/i)?.[1]?.trim() ?? null;
        // ── 3. Observaciones (campo específico de la página) ──────────────────
        let observaciones = "";
        $('h5, h6').each((_, el) => {
            if ($(el).text().trim().toLowerCase() === 'observaciones') {
                // Capturar texto del siguiente elemento hermano
                const nextContent = $(el).nextAll().first().text().trim();
                if (nextContent)
                    observaciones = nextContent;
                // También buscar el siguiente párrafo dentro del mismo contenedor
                const parentNext = $(el).next('p, div, span').text().trim();
                if (parentNext)
                    observaciones = parentNext;
            }
        });
        // Fallback: buscar patrón de observaciones en el texto general
        const obsMatch = pageText.match(/Observaciones\s*:?\s*([^#\n]{5,200})/i);
        if (!observaciones && obsMatch)
            observaciones = obsMatch[1].trim();
        // ── 3b. Extraer campo Resumen (aquí suele estar la derogación) ────────
        let resumen = "";
        $('h5, h6').each((_, el) => {
            if ($(el).text().trim().toLowerCase() === 'resumen') {
                const nextContent = $(el).nextAll('p, div, span').first().text().trim();
                if (nextContent)
                    resumen = nextContent;
                // También probar con el siguiente nodo de texto
                const sibText = $(el).next().text().trim();
                if (!resumen && sibText)
                    resumen = sibText;
            }
        });
        // Fallback: buscar patrón de resumen en el texto general
        if (!resumen) {
            const resMatch = pageText.match(/Resumen\s+([^#]{5,300}?)(?:\s*Observaciones)/i);
            if (resMatch)
                resumen = resMatch[1].trim();
        }
        // ── 4. Señales de derogación en el texto ──────────────────────────────
        // Buscar en múltiples fuentes: Resumen, Observaciones y texto general
        // Patrones: "(DEROGADA POR LEY 8912)", "DEROGADA POR DECRETO 1234/2020",
        //           "DEROGADO POR DEC-LEY 9420/79"
        const textoParaBuscar = `${resumen} ${observaciones} ${pageText}`;
        const derogacionMatch = textoParaBuscar.match(/\(?DEROGAD[AO]\s+(?:EN\s+SU\s+TOTALIDAD\s+)?(?:POR|MEDIANTE)\s+((?:LEY|DECRETO|DEC[\.\-]?LEY|RESOLUCI[OÓ]N|DISPOSICI[OÓ]N)\s*[NnºN°\s]*[\d\/]+[A-Za-z]*)[\)\.\,\s]/i);
        const textoDerogacion = derogacionMatch?.[1]?.trim() ?? null;
        // ── 5. Documentos disponibles (señales de actualización) ──────────────
        let tieneTextoActualizado = false;
        let tieneTextoOriginal = false;
        let urlTextoActualizado = null;
        let urlPdf = null;
        $('a[href*="/documentos/"]').each((_, el) => {
            const href = $(el).attr('href') || '';
            const label = $(el).text().toLowerCase();
            const full = href.startsWith('http') ? href : `${BASE_URL}${href}`;
            if (href.endsWith('.html')) {
                if (label.includes('actualizado')) {
                    tieneTextoActualizado = true;
                    urlTextoActualizado = full;
                }
                else if (label.includes('original')) {
                    tieneTextoOriginal = true;
                }
            }
            if (href.endsWith('.pdf') && !urlPdf)
                urlPdf = full;
        });
        // ── 6. Normas relacionadas ─────────────────────────────────────────────
        const normasRelacionadas = [];
        // Buscar sección "Normas relacionadas"
        $('h5, h6, h4').each((_, el) => {
            if (/normas\s+relacionadas/i.test($(el).text())) {
                $(el).nextAll('a, li').each((__, rel) => {
                    const txt = $(rel).text().trim();
                    const href = $(rel).is('a') ? $(rel).attr('href') : $(rel).find('a').attr('href');
                    if (txt && href && href.includes('/ar-b/')) {
                        const fullHref = href.startsWith('http') ? href : `${BASE_URL}${href}`;
                        normasRelacionadas.push(`[${txt}](${fullHref})`);
                    }
                });
            }
        });
        // Fallback: links /ar-b/ en el cuerpo principal (excluir nav)
        if (normasRelacionadas.length === 0) {
            $('main a[href*="/ar-b/"], .card-content a[href*="/ar-b/"]').each((_, el) => {
                const txt = $(el).text().trim();
                const href = $(el).attr('href') || '';
                if (txt && href !== targetUrl) {
                    const full = href.startsWith('http') ? href : `${BASE_URL}${href}`;
                    normasRelacionadas.push(`[${txt}](${full})`);
                }
            });
        }
        let estado = 'indeterminado';
        const advertencias = [];
        if (textoDerogacion || /derogad[ao]/i.test(observaciones) || /derogad[ao]/i.test(resumen)) {
            estado = 'derogada';
            const normaDerog = textoDerogacion ?? 'norma no identificada';
            advertencias.push(`⛔ DEROGADA: Esta norma fue derogada por ${normaDerog}. No debe citarse como normativa vigente.`);
        }
        else if (tieneTextoActualizado) {
            estado = 'modificada';
            advertencias.push(`⚠️ MODIFICADA: Existen modificaciones incorporadas al texto original. El texto actualizado disponible refleja la versión consolidada vigente.`);
        }
        else if (tieneTextoOriginal && !tieneTextoActualizado) {
            // Solo tiene original, sin actualización → probablemente vigente sin modificaciones
            estado = 'vigente';
        }
        else if (!tieneTextoOriginal && !tieneTextoActualizado) {
            // Sin documentos → no podemos confirmar
            estado = 'indeterminado';
            advertencias.push(`ℹ️ No se detectaron documentos adjuntos para confirmar el estado de vigencia. Verificar manualmente en ${targetUrl}`);
        }
        // Si no encontramos señal de derogación explícita pero hay observaciones, agregarlas
        if (observaciones && estado !== 'derogada') {
            advertencias.push(`📋 Observaciones del portal: ${observaciones}`);
        }
        // ── 8. Construir respuesta ─────────────────────────────────────────────
        const estadoEmoji = {
            vigente: '✅ VIGENTE',
            derogada: '⛔ DEROGADA',
            modificada: '⚠️ VIGENTE CON MODIFICACIONES',
            indeterminado: '❓ INDETERMINADO'
        };
        let content = `# ${titulo}\n`;
        content += `## Estado de Vigencia: ${estadoEmoji[estado]}\n\n`;
        if (resumen) {
            content += `## Resumen Oficial\n${resumen}\n\n`;
        }
        content += `## Datos de Publicación\n`;
        if (fechaPromulgacion)
            content += `- **Promulgación:** ${fechaPromulgacion}\n`;
        if (fechaPublicacion)
            content += `- **Publicación:** ${fechaPublicacion}\n`;
        if (nroBoletin)
            content += `- **Boletín Oficial N°:** ${nroBoletin}\n`;
        if (ultimaActualizacion)
            content += `- **Última actualización en portal:** ${ultimaActualizacion}\n`;
        content += '\n';
        content += `## Documentos en el Portal\n`;
        if (urlPdf)
            content += `- 📑 [Texto original (PDF)](${urlPdf})\n`;
        if (urlTextoActualizado)
            content += `- 📄 [Texto actualizado con modificaciones (HTML)](${urlTextoActualizado})\n`;
        if (!urlPdf && !urlTextoActualizado)
            content += `- *(No se detectaron documentos adjuntos)*\n`;
        content += '\n';
        if (advertencias.length > 0) {
            content += `## Advertencias\n`;
            advertencias.forEach(a => content += `${a}\n`);
            content += '\n';
        }
        if (normasRelacionadas.length > 0) {
            content += `## Normas Relacionadas\n`;
            normasRelacionadas.slice(0, 10).forEach(n => content += `- ${n}\n`);
            if (normasRelacionadas.length > 10)
                content += `- *...y ${normasRelacionadas.length - 10} más. Ver el portal para el listado completo.*\n`;
            content += '\n';
        }
        content += `## Fuente\n- **URL verificada:** ${targetUrl}\n- **Portal oficial:** ${BASE_URL}`;
        return {
            content: [{ type: "text", text: content }]
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error al verificar vigencia de ${args.url}: ${error.message}` }],
            isError: true
        };
    }
});
/**
 * Tool 5: Obtener Artículo
 * Extrae el texto de un artículo específico de una norma.
 * Extrae articulado específico de un documento legal.
 */
server.tool("obtener_articulo", "Extrae el texto de un artículo específico de una norma (ej. '5', '5 bis'). Útil para analizar partes precisas de leyes largas sin saturar el contexto.", {
    url: z.string().url().describe("URL oficial de la norma en normas.gba.gob.ar"),
    articulo: z.string().describe("Número o identificador del artículo a extraer (ej. '1', '5 bis', '10')")
}, async (args) => {
    try {
        const metaResponse = await axios.get(args.url, {
            httpsAgent,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MCP-Connector/1.0' },
            timeout: 15000
        });
        const $meta = cheerio.load(metaResponse.data);
        let docHtmlUrl = null;
        // Buscar el documento HTML del articulado (priorizando texto actualizado)
        $meta('a[href*="/documentos/"]').each((_, el) => {
            const href = $meta(el).attr('href') || '';
            const label = $meta(el).text().toLowerCase();
            if (href.endsWith('.html')) {
                if (!docHtmlUrl || label.includes('actualizado')) {
                    docHtmlUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
                }
            }
        });
        let textoCompleto = "";
        let fuente = "";
        if (docHtmlUrl) {
            const docResponse = await axios.get(docHtmlUrl, {
                httpsAgent,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MCP-Connector/1.0', 'Referer': args.url },
                timeout: 20000
            });
            const $doc = cheerio.load(docResponse.data);
            $doc('script, style, nav').remove();
            const bodySelectors = ['article', 'main', '.content', '#content', 'body'];
            for (const sel of bodySelectors) {
                const candidate = $doc(sel).text().trim();
                if (candidate.length > 200) {
                    textoCompleto = candidate;
                    break;
                }
            }
            fuente = docHtmlUrl;
        }
        else {
            $meta('script, style, nav').remove();
            textoCompleto = ($meta('.card-content, main, article, #content').text() || $meta('body').text());
            fuente = args.url;
        }
        textoCompleto = textoCompleto.replace(/\n{3,}/g, '\n\n').trim();
        // Buscar el artículo con Regex
        const numRegexStr = args.articulo.replace(/[-\/\\^$*+?.()|\[\]{}]/g, '\\$&');
        const startRegex = new RegExp(`(?:^|\\n)\\s*(?:ART[IÍ]CULO|ART\\.?)\\s*0*${numRegexStr}(?:[°º\\.]|\\s*bis|\\s*ter)?\\s*[:\\-\\. ]`, 'i');
        const startMatch = textoCompleto.match(startRegex);
        if (!startMatch) {
            return {
                content: [{ type: "text", text: `⚠️ No se encontró el Artículo ${args.articulo} en el texto de la norma.\nEsto puede deberse a que la norma no está dividida en artículos, el artículo fue derogado y eliminado del texto, o el formato es inusual.\nSe recomienda usar 'obtener_texto_norma' para revisar el documento completo.` }]
            };
        }
        const startIndex = startMatch.index;
        const nextArtRegex = /(?:^|\n)\s*(?:ART[IÍ]CULO|ART\.?)\s*\d+(?:[°º\.]|\s*bis|\s*ter)?\s*[:\-\. ]/gi;
        nextArtRegex.lastIndex = startIndex + startMatch[0].length;
        const nextMatch = nextArtRegex.exec(textoCompleto);
        const endIndex = nextMatch ? nextMatch.index : textoCompleto.length;
        const extracto = textoCompleto.substring(startIndex, endIndex).trim();
        const titulo = $meta('h1, h2, h3, h4').first().text().trim() || "Normativa PBA";
        return {
            content: [{ type: "text", text: `# ${titulo} — Artículo ${args.articulo}\n\n> **Fuente:** ${fuente}\n> ⚠️ **TEXTO LITERAL** extraído de la fuente oficial sin alteraciones.\n\n${extracto}` }]
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error al obtener el artículo de ${args.url}: ${error.message}` }],
            isError: true
        };
    }
});
/**
 * Tool 6: Exportar Norma
 * Exporta el texto a Markdown estructurado con Frontmatter YAML.
 */
server.tool("exportar_norma", "Exporta el texto y los metadatos de una norma a formato Markdown estructurado (con Frontmatter YAML), ideal para sistemas de gestión del conocimiento (Obsidian, Notion) o guardado local.", {
    url: z.string().url().describe("La URL oficial de la norma a exportar.")
}, async (args) => {
    try {
        const metaResponse = await axios.get(args.url, {
            httpsAgent,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MCP-Connector/1.0' },
            timeout: 15000
        });
        const $meta = cheerio.load(metaResponse.data);
        const titulo = $meta('h1, h2, h3, h4').first().text().trim() || "Normativa PBA";
        const metadatos = {};
        $meta('body').find('p, li, td, span, div').each((_, el) => {
            const txt = $meta(el).clone().children().remove().end().text().trim();
            if (txt.includes(':')) {
                const parts = txt.split(':');
                if (parts.length >= 2) {
                    const key = parts[0].trim().toLowerCase().replace(/\s+/g, '_');
                    const value = parts.slice(1).join(':').trim();
                    if (key.length > 2 && key.length < 30 && value.length > 0 && value.length < 100) {
                        metadatos[key] = value;
                    }
                }
            }
        });
        let docHtmlUrl = null;
        $meta('a[href*="/documentos/"]').each((_, el) => {
            const href = $meta(el).attr('href') || '';
            const label = $meta(el).text().toLowerCase();
            if (href.endsWith('.html') && (!docHtmlUrl || label.includes('actualizado'))) {
                docHtmlUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
            }
        });
        let textoCompleto = "";
        if (docHtmlUrl) {
            const docResponse = await axios.get(docHtmlUrl, {
                httpsAgent,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MCP-Connector/1.0', 'Referer': args.url },
                timeout: 20000
            });
            const $doc = cheerio.load(docResponse.data);
            $doc('script, style, nav').remove();
            const bodySelectors = ['article', 'main', '.content', '#content', 'body'];
            for (const sel of bodySelectors) {
                const candidate = $doc(sel).text().trim();
                if (candidate.length > 200) {
                    textoCompleto = candidate;
                    break;
                }
            }
        }
        else {
            $meta('script, style, nav').remove();
            textoCompleto = ($meta('.card-content, main, article, #content').text() || $meta('body').text());
        }
        textoCompleto = textoCompleto.replace(/\n{3,}/g, '\n\n').trim();
        // Construir Markdown Estructurado
        let markdown = `---\n`;
        markdown += `titulo: "${titulo.replace(/"/g, '\\"')}"\n`;
        markdown += `url: "${args.url}"\n`;
        markdown += `fecha_exportacion: "${new Date().toISOString()}"\n`;
        for (const [key, value] of Object.entries(metadatos)) {
            markdown += `${key}: "${value.replace(/"/g, '\\"')}"\n`;
        }
        markdown += `---\n\n`;
        markdown += `# ${titulo}\n\n`;
        markdown += `> **Fuente Oficial:** [Normas PBA](${args.url})\n\n`;
        markdown += `## Texto de la Norma\n\n`;
        markdown += textoCompleto;
        return {
            content: [{ type: "text", text: markdown }]
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error al exportar la norma: ${error.message}` }],
            isError: true
        };
    }
});
/**
 * Tool 7: Relacionar Normativa
 * Devuelve todas las normas que citan, modifican o derogan a la norma solicitada.
 * AHORA AUTOMATIZADA: Si no se pasa URL, busca la ley automáticamente usando su número/año/tipo.
 */
server.tool("relacionar_normativa", "Devuelve todas las normas que citan, modifican, reglamentan o derogan a la normativa especificada. Puedes pasar la URL directa, o pasar los datos de la norma (numero, anio, tipo) para que la herramienta busque la URL automáticamente.", {
    url: z.string().url().optional().describe("La URL oficial de la norma. Si no la tienes, usa los otros parámetros."),
    numero: z.string().optional().describe("Número de la norma a investigar (ej. '10430')."),
    tipo_norma: z.string().optional().describe("Tipo de norma (ej. 'ley', 'decreto')."),
    anio: z.string().optional().describe("Año de la norma (ej. '1986').")
}, async (args) => {
    try {
        let targetUrl = args.url;
        // 1. Resolución Automática de URL si no se proveyó
        if (!targetUrl) {
            if (!args.numero && !args.tipo_norma) {
                throw new Error("Debe proveer una 'url' o al menos un 'numero' o 'tipo_norma' para buscar la norma automáticamente.");
            }
            const params = new URLSearchParams();
            if (args.numero)
                params.append("q[terms][number]", args.numero);
            if (args.anio)
                params.append("q[terms][year]", args.anio);
            // Si no tenemos numero pero tenemos tipo, usamos phrase
            if (!args.numero && args.tipo_norma)
                params.append("q[phrase]", args.tipo_norma);
            const searchUrl = `${BASE_URL}/resultados?${params.toString()}`;
            const searchRes = await axios.get(searchUrl, { httpsAgent, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $s = cheerio.load(searchRes.data);
            let firstLink = undefined;
            if (args.tipo_norma) {
                // Filtrar las tarjetas asegurando que el título coincida con el tipo_norma (ej. Ley)
                const tipoNormaLower = args.tipo_norma.toLowerCase();
                $s('.card').each((_, el) => {
                    const title = $s(el).find('a').text().toLowerCase();
                    if (title.includes(tipoNormaLower) && !firstLink) {
                        firstLink = $s(el).find('a').attr('href');
                    }
                });
            }
            // Fallback al primer resultado
            if (!firstLink) {
                firstLink = $s('.card a[href*="/ar-b/"]').first().attr('href');
            }
            if (!firstLink) {
                return { content: [{ type: "text", text: `No se pudo encontrar automáticamente la norma con los parámetros: ${JSON.stringify(args)}` }] };
            }
            targetUrl = firstLink.startsWith('http') ? firstLink : `${BASE_URL}${firstLink}`;
        }
        // 2. Extraer las relaciones de la norma objetivo
        const response = await axios.get(targetUrl, { httpsAgent, headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
        const $ = cheerio.load(response.data);
        const relaciones = [];
        // Buscar en todo el documento posibles secciones de relaciones (con mayor fidelidad y sin alterar el texto)
        $('h5, h6, h4, p, div, li').each((_, el) => {
            const text = $(el).text().trim();
            const textLower = text.toLowerCase();
            if (textLower.includes('relacionadas') || textLower.includes('modifica a') || textLower.includes('deroga') || textLower.includes('reglamenta') || textLower.includes('complementa')) {
                // Extraer los links dentro y cerca de esta etiqueta
                $(el).find('a[href*="/ar-b/"]').add($(el).nextAll('a, p, div, ul').find('a[href*="/ar-b/"]')).each((__, aEl) => {
                    const enlaceText = $(aEl).text().trim().replace(/\s+/g, ' '); // Conservar texto exacto del portal
                    const href = $(aEl).attr('href') || '';
                    if (enlaceText && href && href !== targetUrl) {
                        const fullHref = href.startsWith('http') ? href : `${BASE_URL}${href}`;
                        // Deducir tipo preservando el contexto original
                        let tipoRelacion = "Mencionada / Relacionada";
                        if (textLower.includes('modific'))
                            tipoRelacion = "Modificatoria";
                        else if (textLower.includes('deroga'))
                            tipoRelacion = "Derogatoria";
                        else if (textLower.includes('reglamenta'))
                            tipoRelacion = "Reglamentaria";
                        else if (textLower.includes('complementa'))
                            tipoRelacion = "Complementaria";
                        // Solo agregar si no existe ya para evitar duplicados ruidosos
                        if (!relaciones.find(r => r.enlace === fullHref)) {
                            relaciones.push({ tipo: tipoRelacion, titulo: enlaceText, enlace: fullHref });
                        }
                    }
                });
            }
        });
        const tituloNorma = $('h1, h2, h3, h4').first().text().trim().replace(/\s+/g, ' ') || "Normativa";
        let content = `# Árbol de Dependencia Legal\n**Norma Analizada:** [${tituloNorma}](${targetUrl})\n\n`;
        if (relaciones.length === 0) {
            content += "No se encontraron normas que citen, modifiquen o derogan a esta normativa explícitamente en el portal oficial.";
        }
        else {
            content += `> Se han recuperado **${relaciones.length} normas relacionadas** extraídas directamente del portal oficial, sin alteraciones.\n\n`;
            const agrupadas = relaciones.reduce((acc, rel) => {
                if (!acc[rel.tipo])
                    acc[rel.tipo] = [];
                acc[rel.tipo].push(rel);
                return acc;
            }, {});
            for (const [tipo, items] of Object.entries(agrupadas)) {
                content += `### ${tipo}\n`;
                items.forEach(item => {
                    content += `- [${item.titulo}](${item.enlace})\n`;
                });
                content += `\n`;
            }
        }
        return {
            content: [{ type: "text", text: content }]
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error al obtener relaciones de la norma: ${error.message}` }],
            isError: true
        };
    }
});
/**
 * Tool 8: Buscar por Semántica (Semantic Search)
 * Conserva la fidelidad de los extractos y metadatos sin truncarlos arbitrariamente.
 */
server.tool("buscar_por_semantica", "Busca normativas por significado y concepto. El LLM genera sinónimos y la herramienta recupera resultados exactos del portal, priorizando mantener los textos de resumen completos (sin alterar).", {
    concepto: z.string().describe("El concepto jurídico central (ej. 'protección a la maternidad')."),
    terminos_equivalentes: z.array(z.string()).describe("Lista de sinónimos o términos relacionados (ej. ['embarazo', 'licencia', 'gestante', 'lactancia']).")
}, async (args) => {
    try {
        const params = new URLSearchParams();
        const palabrasClave = args.terminos_equivalentes.join(' ');
        params.append("q[with_some_words]", palabrasClave);
        params.append("page", "1");
        const url = `${BASE_URL}/resultados?${params.toString()}`;
        const response = await axios.get(url, { httpsAgent, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const resultados = [];
        $('.card').each((i, el) => {
            if (i >= 15)
                return; // Permitir hasta 15 resultados para mayor contexto
            const titleEl = $(el).find('a');
            const title = titleEl.text().trim().replace(/\s+/g, ' '); // Remover saltos de línea basura, conservar texto
            const link = titleEl.attr('href');
            let fecha = 'Fecha no indicada';
            const textoTarjeta = $(el).text();
            const fechaMatch = textoTarjeta.match(/Fecha de publicación:\s*([\d\/]+)/);
            if (fechaMatch)
                fecha = fechaMatch[1];
            // Extraer texto o resumen completo, sin `.substring()` destructivos
            let extracto = "";
            $(el).find('h6').each((_, h6) => {
                if ($(h6).text().trim() === 'Texto') {
                    extracto = $(h6).next('p').text().trim() || $(h6).parent().text().trim();
                }
            });
            // Si no hay bloque 'Texto', recuperar el texto libre de la tarjeta, limpiando dobles espacios
            if (!extracto) {
                extracto = $(el).text().replace(/\s+/g, ' ').trim();
            }
            if (title && link && link.includes('/ar-b/')) {
                resultados.push({
                    titulo: title,
                    enlace: link.startsWith('http') ? link : `${BASE_URL}${link}`,
                    fecha: fecha,
                    fragmento: extracto // Fidelidad: se retorna íntegro
                });
            }
        });
        let content = `# Búsqueda Semántica: "${args.concepto}"\n`;
        content += `> **Términos de búsqueda enviados:** ${args.terminos_equivalentes.join(', ')}\n\n`;
        if (resultados.length === 0) {
            content += "No se encontraron normativas que coincidan con estos términos. Intenta con otra expansión semántica.";
        }
        else {
            resultados.forEach((r, idx) => {
                content += `### ${idx + 1}. ${r.titulo}\n`;
                content += `- **Publicación:** ${r.fecha}\n`;
                content += `- **Enlace:** ${r.enlace}\n`;
                content += `- **Texto/Contexto:** ${r.fragmento}\n\n`;
            });
        }
        return {
            content: [{ type: "text", text: content }]
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error en búsqueda semántica: ${error.message}` }],
            isError: true
        };
    }
});
/**
 * Tool 9: Mapa Normativo por Tema
 * Mejorado: Mantiene la jerarquía pero extrae resúmenes completos y fechas para no perder contexto.
 */
server.tool("mapa_normativo_tema", "Construye un árbol jerárquico completo de la normativa aplicable a un tema, preservando títulos y resúmenes sin alteraciones para máxima fidelidad jurídica.", {
    tema: z.string().describe("El tema a mapear (ej. 'teletrabajo', 'medio ambiente').")
}, async (args) => {
    try {
        const mapa = {
            'Leyes Generales': [],
            'Decretos Reglamentarios / Ejecutivos': [],
            'Resoluciones Ministeriales': [],
            'Disposiciones / Circulares': []
        };
        // FIX (verificado 10/6/26): el filtro server-side q[terms][raw_type] esta
        // ROTO en normas.gba.gob.ar: devuelve 0 con cualquier valor ('ley', 'Ley',
        // 'LEY'), aunque q[terms][number] y [year] funcionan. Estrategia nueva:
        // busqueda SIN filtro de tipo (funciona: "educación" = 10.292 hits) y
        // clasificacion local por el slug del enlace (/ar-b/{tipo}/...). Se
        // recorren hasta 4 paginas o hasta juntar 5 normas por jerarquia.
        const fetchPagina = async (modo, page) => {
            const params = new URLSearchParams();
            params.append(modo === "phrase" ? "q[phrase]" : "q[with_some_words]", args.tema);
            params.append("page", String(page));
            const url = `${BASE_URL}/resultados?${params.toString()}`;
            const response = await axios.get(url, { httpsAgent, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(response.data);
            const resultados = [];
            $('.card').each((_, el) => {
                const title = $(el).find('a').text().trim().replace(/\s+/g, ' ');
                const link = $(el).find('a').attr('href');
                let fecha = 'Sin fecha';
                const fechaMatch = $(el).text().match(/Fecha de publicación:\s*([\d\/]+)/);
                if (fechaMatch)
                    fecha = fechaMatch[1];
                if (title && link && link.includes('/ar-b/')) {
                    resultados.push({
                        titulo: title,
                        fecha: fecha,
                        enlace: link.startsWith('http') ? link : `${BASE_URL}${link}`
                    });
                }
            });
            return resultados;
        };
        const TOPE = 5;
        const clasificar = (item) => {
            const m = item.enlace.match(/\/ar-b\/([a-z-]+)\//i);
            const slug = m ? m[1].toLowerCase() : "";
            if (slug === "ley" || slug === "decreto-ley")
                return 'Leyes Generales';
            if (slug === "decreto")
                return 'Decretos Reglamentarios / Ejecutivos';
            if (slug.startsWith("resolucion"))
                return 'Resoluciones Ministeriales';
            if (slug === "disposicion" || slug.startsWith("ordenanza") || slug === "circular")
                return 'Disposiciones / Circulares';
            return null;
        };
        const llenarMapa = async (modo) => {
            Object.keys(mapa).forEach(k => { mapa[k] = []; });
            for (let page = 1; page <= 4; page++) {
                const items = await fetchPagina(modo, page);
                if (items.length === 0)
                    break;
                for (const item of items) {
                    const bucket = clasificar(item);
                    if (bucket && mapa[bucket].length < TOPE)
                        mapa[bucket].push(item);
                }
                if (Object.values(mapa).every(arr => arr.length >= TOPE))
                    break;
            }
            return Object.values(mapa).reduce((acc, arr) => acc + arr.length, 0);
        };
        let modoUsado = "frase exacta";
        let totalMapa = await llenarMapa("phrase");
        if (totalMapa === 0) {
            totalMapa = await llenarMapa("words");
            modoUsado = "palabras clave (la frase exacta no arrojó resultados)";
        }
        let content = `# Mapa Normativo: ${args.tema}\n`;
        content += `> Árbol jerárquico de normativas (textos literales, sin recortes). Modo de búsqueda: ${modoUsado}.\n\n`;
        let isEmpty = true;
        for (const [categoria, normas] of Object.entries(mapa)) {
            if (normas.length > 0) {
                isEmpty = false;
                content += `## ${categoria}\n`;
                normas.forEach(n => {
                    content += `- **${n.fecha}** | [${n.titulo}](${n.enlace})\n`;
                });
                content += `\n`;
            }
        }
        if (isEmpty) {
            content += "No se encontraron normativas para este tema. Intenta con un término más general o usa `buscar_por_semantica`.";
        }
        return {
            content: [{ type: "text", text: content }]
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error al generar el mapa normativo: ${error.message}` }],
            isError: true
        };
    }
});
// Guard de entorno identico al resto del proyecto (bora.js, tfn.js, etc.)
if (
    typeof process !== "undefined" &&
    !process.env.VERCEL &&
    !process.env.NEXT_RUNTIME
) {
    const transport = new StdioServerTransport();
    server.connect(transport).catch((err) => {
        process.stderr.write(`[normativapba] error fatal: ${err.message}\n`);
        process.exit(1);
    });
    process.stderr.write("[normativapba] conectado y escuchando\n");
}
//# sourceMappingURL=normativapba.js.map