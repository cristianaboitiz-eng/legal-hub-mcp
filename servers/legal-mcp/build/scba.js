import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = "https://sentencias.scba.gov.ar/RegistroElectronico";

// idRegistro: 1 = Sentencias, 2 = Resoluciones (confirmar con el sitio)
const ID_REGISTRO = { sentencias: "1", resoluciones: "2" };

const HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/html, */*",
    "Referer": "https://sentencias.scba.gov.ar/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
};

// ---------------------------------------------------------------------------
// Helpers HTML
// ---------------------------------------------------------------------------

function extraerOptions(html) {
    // Extrae { value, text } de todos los <option> del HTML
    const re = /<option\s+value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
    const items = [];
    let m;
    while ((m = re.exec(html)) !== null) {
        const value = m[1].trim();
        const text = m[2].replace(/&#xBA;/g, "º").replace(/&#xB0;/g, "°").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
        if (value && value !== "-1") items.push({ value, text });
    }
    return items;
}

function extraerFilas(html) {
    // Extrae filas de la tabla DataTable: busca arrays JSON en el script de inicializacion
    // El sitio carga los datos via AJAX al POST, la respuesta es HTML con tabla vacia
    // pero el POST de busqueda devuelve JSON con { data: [[...], ...] }
    // Intentamos parsear como JSON primero
    try {
        const parsed = JSON.parse(html);
        if (parsed && Array.isArray(parsed.data)) return parsed.data;
        if (parsed && Array.isArray(parsed)) return parsed;
    } catch { /* no es JSON */ }
    return [];
}

function extraerTextoDocumento(html) {
    // Extrae texto de .card-body del HTML del modal
    const re = /<[^>]+class="[^"]*card-body[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const partes = [];
    let m;
    while ((m = re.exec(html)) !== null) {
        // Limpiar tags HTML
        const texto = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (texto) partes.push(texto);
    }
    if (partes.length) return partes.join("\n");
    // Fallback: limpiar todo el HTML
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function limpiarNombre(texto) {
    return texto.replace(/[<>:"/\\|?*]/g, "").trim().slice(0, 150);
}

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------

async function listarTiposRegistro() {
    return [
        { valor: "sentencias", etiqueta: "Sentencias" },
        { valor: "resoluciones", etiqueta: "Resoluciones" },
    ];
}

async function listarOrganismos(tipo = "sentencias") {
    if (!ID_REGISTRO[tipo]) throw new Error("tipo_registro debe ser 'sentencias' o 'resoluciones'");
    const idRegistro = ID_REGISTRO[tipo];
    const url = `${BASE_URL}/OrganismosDeUnRegistro?idRegistro=${idRegistro}&null=`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status} al obtener organismos`);
    const html = await res.text();
    const options = extraerOptions(html);
    return options.map((o) => ({ id: o.value, nombre: o.text }));
}

async function buscarDocumentos({
    organismo,
    fecha_desde,
    fecha_hasta,
    texto_busqueda,
    tipo_registro = "sentencias",
    max_paginas = 3,
    max_documentos = 20,
}) {
    const reFecha = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!reFecha.test(fecha_desde)) return { error: `Fecha desde invalida: '${fecha_desde}'. Use DD/MM/AAAA` };
    if (!reFecha.test(fecha_hasta)) return { error: `Fecha hasta invalida: '${fecha_hasta}'. Use DD/MM/AAAA` };
    if (!ID_REGISTRO[tipo_registro]) return { error: "tipo_registro debe ser 'sentencias' o 'resoluciones'" };

    // Resolver idOrganismo: puede venir como nombre o como id numerico
    let idOrganismo = organismo;
    let nombreOrganismo = organismo;
    if (isNaN(Number(organismo))) {
        // Es un nombre - buscar el id
        const lista = await listarOrganismos(tipo_registro);
        const encontrado = lista.find(
            (o) => o.nombre.toLowerCase().trim() === organismo.toLowerCase().trim()
        );
        if (!encontrado) return { error: `Organismo no encontrado: '${organismo}'. Usa listar_organismos para ver los disponibles.` };
        idOrganismo = encontrado.id;
        nombreOrganismo = encontrado.nombre;
    }

    const body = {
        fDesde: fecha_desde,
        fHasta: fecha_hasta,
        texoIncluido: texto_busqueda,
        idOrganismo: String(idOrganismo),
        idRegistro: ID_REGISTRO[tipo_registro],
        nombreOrganismo: nombreOrganismo,
        registro: tipo_registro === "sentencias" ? "REGISTRO DE SENTENCIAS" : "REGISTRO DE RESOLUCIONES",
    };

    const res = await fetch(`${BASE_URL}/BuscarRegistrosPorFechaYOrganismo`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(body),
    });
    if (!res.ok) return { error: `HTTP ${res.status} al buscar documentos` };

    const texto = await res.text();
    const filas = extraerFilas(texto);

    if (!filas.length) {
        return {
            total_encontrados: 0,
            tipo_registro,
            organismo: nombreOrganismo,
            documentos: [],
            errores: [],
            nota: "Sin resultados para los criterios indicados.",
        };
    }

    const documentos = [];
    const errores = [];
    const limite = Math.min(filas.length, max_documentos);

    for (let i = 0; i < limite; i++) {
        const fila = filas[i];
        try {
            // fila[0] = id, fila[1] = nroRegistro (objeto {display}), fila[2] = fecha, fila[3] = nroExp, fila[4] = caratula
            const id = Array.isArray(fila) ? fila[0] : fila.id;
            const nroReg = Array.isArray(fila) ? (fila[1]?.display ?? fila[1]) : fila.nroReg;
            const fecha = Array.isArray(fila) ? (fila[2]?.display ?? fila[2]) : fila.fecha;
            const nroExp = Array.isArray(fila) ? (fila[3]?.display ?? fila[3]) : fila.nroExp;
            const caratula = Array.isArray(fila) ? fila[4] : fila.caratula;

            // Obtener texto completo
            const resDoc = await fetch(`${BASE_URL}/ObtenerRegistroVisualizar/`, {
                method: "POST",
                headers: HEADERS,
                body: JSON.stringify({ idCodigoAcceso: id }),
            });

            let contenido = "";
            if (resDoc.ok) {
                const htmlDoc = await resDoc.text();
                contenido = extraerTextoDocumento(htmlDoc);
            } else {
                errores.push(`Doc ${i + 1}: HTTP ${resDoc.status}`);
            }

            documentos.push({
                titulo: limpiarNombre(String(caratula || `doc_${i + 1}`)),
                nro_registro: String(nroReg || ""),
                fecha: String(fecha || ""),
                nro_expediente: String(nroExp || ""),
                caratula: String(caratula || ""),
                contenido,
            });
        } catch (e) {
            errores.push(`Doc ${i + 1}: ${String(e).slice(0, 120)}`);
        }
    }

    return {
        total_encontrados: documentos.length,
        total_en_servidor: filas.length,
        tipo_registro,
        organismo: nombreOrganismo,
        documentos,
        errores,
    };
}

async function guardarDocumentosEnDisco({ documentos, organismo, tipo_registro = "sentencias", carpeta_base = "sentencias judiciales" }) {
    const fs = await import("fs");
    const path = await import("path");
    const nombreOrg = organismo.replace(/[<>:"/\\|?*]/g, "").trim();
    const rutaDestino = path.join(carpeta_base, tipo_registro, nombreOrg);
    fs.mkdirSync(rutaDestino, { recursive: true });

    const guardados = [];
    const errores = [];

    for (const doc of documentos) {
        try {
            const nombre = (doc.titulo || "sin_titulo").replace(/[<>:"/\\|?*]/g, "").trim().slice(0, 150);
            const ruta = path.join(rutaDestino, `${nombre}.txt`);
            fs.writeFileSync(ruta, doc.contenido || "", "utf-8");
            guardados.push(ruta);
        } catch (e) {
            errores.push(String(e).slice(0, 120));
        }
    }

    return { carpeta: rutaDestino, archivos_guardados: guardados, total: guardados.length, errores };
}

// ---------------------------------------------------------------------------
// Servidor MCP
// ---------------------------------------------------------------------------

const TOOLS = [
    {
        name: "listar_tipos_registro",
        description: "Devuelve los tipos de registro disponibles en la SCBA: Sentencias y Resoluciones.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "listar_organismos",
        description: "Devuelve la lista de organismos judiciales disponibles en sentencias.scba.gov.ar para el tipo de registro indicado. Llamar antes de buscar_documentos para obtener los nombres y IDs exactos.",
        inputSchema: {
            type: "object",
            properties: {
                tipo_registro: { type: "string", enum: ["sentencias", "resoluciones"], description: "Default: sentencias." },
            },
        },
    },
    {
        name: "buscar_documentos",
        description: "Busca sentencias o resoluciones en la SCBA y devuelve el texto completo de cada documento.",
        inputSchema: {
            type: "object",
            required: ["organismo", "fecha_desde", "fecha_hasta", "texto_busqueda"],
            properties: {
                organismo: { type: "string", description: "Nombre exacto o ID numerico del organismo (usar listar_organismos)." },
                fecha_desde: { type: "string", description: "Fecha inicio DD/MM/AAAA." },
                fecha_hasta: { type: "string", description: "Fecha fin DD/MM/AAAA." },
                texto_busqueda: { type: "string", description: "Palabras clave a buscar en el texto." },
                tipo_registro: { type: "string", enum: ["sentencias", "resoluciones"], description: "Default: sentencias." },
                max_paginas: { type: "number", description: "Paginas maximas a recorrer. Default: 3." },
                max_documentos: { type: "number", description: "Documentos maximos a retornar. Default: 20." },
            },
        },
    },
    {
        name: "guardar_documentos_en_disco",
        description: "Guarda los documentos obtenidos con buscar_documentos en archivos .txt en disco.",
        inputSchema: {
            type: "object",
            required: ["documentos", "organismo"],
            properties: {
                documentos: { type: "array", description: "Lista de documentos (resultado de buscar_documentos)." },
                organismo: { type: "string" },
                tipo_registro: { type: "string", enum: ["sentencias", "resoluciones"] },
                carpeta_base: { type: "string", description: "Carpeta raiz de salida. Default: 'sentencias judiciales'." },
            },
        },
    },
];

async function callTool(name, args) {
    switch (name) {
        case "listar_tipos_registro": return listarTiposRegistro();
        case "listar_organismos": return listarOrganismos(args.tipo_registro ?? "sentencias");
        case "buscar_documentos": return buscarDocumentos(args);
        case "guardar_documentos_en_disco": return guardarDocumentosEnDisco(args);
        default: throw new Error(`Tool desconocida: ${name}`);
    }
}

async function main() {
    const server = new Server(
        { name: "scba-mcp", version: "2.0.0" },
        { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
        })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args = {} } = request.params;
        try {
            const result = await callTool(name, args);
            return {
                content: [{
                    type: "text",
                    text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
                }],
            };
        } catch (e) {
            return {
                content: [{ type: "text", text: `Error: ${e.message}` }],
                isError: true,
            };
        }
    });

    process.on("SIGINT", () => process.exit(0));
    process.on("SIGTERM", () => process.exit(0));

    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write("[scba] conectado y escuchando\n");
}

main().catch((e) => {
    process.stderr.write(`[scba] error fatal: ${e.message}\n`);
    process.exit(1);
});
