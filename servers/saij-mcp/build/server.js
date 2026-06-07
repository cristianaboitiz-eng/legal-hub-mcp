import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import { searchService } from "./services/search-service.js";
import { documentService } from "./services/document-service.js";
import { graphService } from "./services/graph-service.js";
import { JurisprudenciaSearchParamsSchema, LegislacionSearchParamsSchema, DoctrinaSearchParamsSchema, DictamenesSearchParamsSchema, SearchParamsSchema, } from "./types/saij.js";
const GetDocumentSchema = z.object({
    guid: z.string().describe("GUID del documento (ej: '12345678-90ab-cdef-1234-567890abcdef')"),
});
const GetDocumentSectionSchema = z.object({
    guid: z.string().describe("GUID del documento"),
    article_number: z.string().optional().describe("Número de artículo específico (ej: '4')"),
    section_title: z.string().optional().describe("Título de la sección o palabra clave para búsqueda semántica"),
});
const ResolveCitationSchema = z.object({
    citation_text: z.string().describe("Texto de la cita jurídica (ej: 'Ley 24.240', 'Código Civil')"),
});
const SuggestTermsSchema = z.object({
    term: z.string().describe("Término o palabra clave para autocompletar"),
    limit: z.number().optional().default(10).describe("Cantidad máxima de sugerencias"),
});
const GetNovedadesSchema = z.object({
    limit: z.number().optional().default(10).describe("Cantidad de novedades a recuperar"),
});
export class SaijMcpServer {
    server;
    constructor() {
        this.server = new Server({
            name: "saij-mcp",
            version: "1.0.0",
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupHandlers();
    }
    setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "saij_search_jurisprudencia",
                        description: "Busca fallos y sentencias de jurisprudencia en el SAIJ.",
                        inputSchema: zodToJsonSchema(JurisprudenciaSearchParamsSchema),
                    },
                    {
                        name: "saij_search_legislacion",
                        description: "Busca leyes, decretos y otras normas legislativas en el SAIJ.",
                        inputSchema: zodToJsonSchema(LegislacionSearchParamsSchema),
                    },
                    {
                        name: "saij_search_doctrina",
                        description: "Busca artículos de doctrina jurídica en el SAIJ.",
                        inputSchema: zodToJsonSchema(DoctrinaSearchParamsSchema),
                    },
                    {
                        name: "saij_search_dictamenes",
                        description: "Busca dictámenes de organismos públicos (PTN, MPF, etc.) en el SAIJ.",
                        inputSchema: zodToJsonSchema(DictamenesSearchParamsSchema),
                    },
                    {
                        name: "saij_search_biblioteca",
                        description: "Busca en la Biblioteca Digital del SAIJ (patrimonio histórico, antecedentes, etc.).",
                        inputSchema: zodToJsonSchema(SearchParamsSchema),
                    },
                    {
                        name: "saij_get_document",
                        description: "Obtiene el texto completo y los metadatos de un documento específico por su GUID.",
                        inputSchema: zodToJsonSchema(GetDocumentSchema),
                    },
                    {
                        name: "saij_get_related_documents",
                        description: "Obtiene documentos relacionados (normativa citada, fallos relacionados, etc.) para un documento dado.",
                        inputSchema: zodToJsonSchema(GetDocumentSchema),
                    },
                    {
                        name: "saij_get_document_section",
                        description: "Extrae una sección o artículo específico de un documento extenso para ahorrar tokens.",
                        inputSchema: zodToJsonSchema(GetDocumentSectionSchema),
                    },
                    {
                        name: "saij_resolve_citation",
                        description: "Resuelve una cita jurídica en texto libre y devuelve el documento o artículo correspondiente.",
                        inputSchema: zodToJsonSchema(ResolveCitationSchema),
                    },
                    {
                        name: "saij_suggest_terms",
                        description: "Proporciona sugerencias de autocompletado para términos o temas jurídicos.",
                        inputSchema: zodToJsonSchema(SuggestTermsSchema),
                    },
                    {
                        name: "saij_get_novedades",
                        description: "Recupera las últimas novedades jurídicas publicadas en el SAIJ.",
                        inputSchema: zodToJsonSchema(GetNovedadesSchema),
                    },
                ],
            };
        });
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                switch (name) {
                    case "saij_search_jurisprudencia": {
                        const params = JurisprudenciaSearchParamsSchema.parse(args);
                        const results = await searchService.searchJurisprudencia(params);
                        return {
                            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
                        };
                    }
                    case "saij_search_legislacion": {
                        const params = LegislacionSearchParamsSchema.parse(args);
                        const results = await searchService.searchLegislacion(params);
                        return {
                            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
                        };
                    }
                    case "saij_search_doctrina": {
                        const params = DoctrinaSearchParamsSchema.parse(args);
                        const results = await searchService.searchDoctrina(params);
                        return {
                            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
                        };
                    }
                    case "saij_search_dictamenes": {
                        const params = DictamenesSearchParamsSchema.parse(args);
                        const results = await searchService.searchDictamenes(params);
                        return {
                            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
                        };
                    }
                    case "saij_search_biblioteca": {
                        const params = SearchParamsSchema.parse(args);
                        const results = await searchService.searchBiblioteca(params);
                        return {
                            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
                        };
                    }
                    case "saij_get_document": {
                        const { guid } = GetDocumentSchema.parse(args);
                        const document = await documentService.getFullDocument(guid);
                        return {
                            content: [{ type: "text", text: JSON.stringify(document, null, 2) }],
                        };
                    }
                    case "saij_get_related_documents": {
                        const { guid } = GetDocumentSchema.parse(args);
                        const relations = await graphService.getRelatedDocuments(guid);
                        return {
                            content: [{ type: "text", text: JSON.stringify(relations, null, 2) }],
                        };
                    }
                    case "saij_get_document_section": {
                        const { guid, article_number, section_title } = GetDocumentSectionSchema.parse(args);
                        const section = await documentService.getDocumentSection(guid, {
                            articleNumber: article_number,
                            sectionTitle: section_title,
                        });
                        return {
                            content: [{ type: "text", text: JSON.stringify(section, null, 2) }],
                        };
                    }
                    case "saij_resolve_citation": {
                        const { citation_text } = ResolveCitationSchema.parse(args);
                        const result = await searchService.resolveCitation(citation_text);
                        return {
                            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                        };
                    }
                    case "saij_suggest_terms": {
                        const { term, limit } = SuggestTermsSchema.parse(args);
                        const suggestions = await searchService.suggestTerms(term, limit);
                        return {
                            content: [{ type: "text", text: JSON.stringify(suggestions, null, 2) }],
                        };
                    }
                    case "saij_get_novedades": {
                        const { limit } = GetNovedadesSchema.parse(args);
                        const news = await searchService.getNovedades(limit);
                        return {
                            content: [{ type: "text", text: JSON.stringify(news, null, 2) }],
                        };
                    }
                    default:
                        throw new Error(`Tool not found: ${name}`);
                }
            }
            catch (error) {
                if (error instanceof z.ZodError) {
                    throw new Error(`Invalid arguments for ${name}: ${error.errors.map(e => e.message).join(", ")}`);
                }
                throw error;
            }
        });
    }
    get instance() {
        return this.server;
    }
}
