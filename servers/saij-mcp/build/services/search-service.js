import { apiClient } from "./api-client.js";
import { FilterBuilder, PRESET_FILTERS } from "./filter-builder.js";
import { SearchResponseSchema, } from "../types/saij.js";
import { documentService } from "./document-service.js";
/**
 * SearchService provides specialized methods for searching SAIJ documents.
 * It coordinates FilterBuilder and ApiClient.
 */
export class SearchService {
    /**
     * Resolves a free-text legal citation (e.g., "Ley 24240", "Código Civil") to a document.
     */
    async resolveCitation(text) {
        // 1. Detect Law number patterns (e.g., "Ley 24.240" or "Ley 24240")
        const lawMatch = text.match(/ley\s*(\d+[\.\d+]*)/i);
        if (lawMatch) {
            const lawNumber = lawMatch[1].replace(/\./g, "");
            const results = await this.searchLegislacion({ query: lawNumber, offset: 0, pageSize: 1, view: "colapsada" });
            if (results.results.length > 0) {
                return await documentService.getFullDocument(results.results[0].uuid);
            }
        }
        // 2. Detect Code patterns
        if (text.toLowerCase().includes("codigo civil")) {
            const results = await this.searchRaw(PRESET_FILTERS.codigos, { query: "Civil", offset: 0, pageSize: 1, view: "colapsada" });
            if (results.results.length > 0) {
                return await documentService.getFullDocument(results.results[0].uuid);
            }
        }
        // 3. Fallback to general search
        return await this.searchRaw("Total", { query: text, offset: 0, pageSize: 5, view: "colapsada" });
    }
    /**
     * Search jurisprudencia with specific filters.
     */
    async searchJurisprudencia(params) {
        const filterStr = FilterBuilder.jurisprudencia({
            jurisdiccion: params.jurisdiccion,
            tribunal: params.tribunal,
            materia: params.materia,
            tipoDoc: params.tipoDoc,
            fechaDesde: params.fechaDesde,
            fechaHasta: params.fechaHasta,
        });
        return this.searchRaw(filterStr, params);
    }
    /**
     * Search legislacion with specific filters.
     */
    async searchLegislacion(params) {
        const filterStr = FilterBuilder.legislacion({
            tipoNorma: params.tipoNorma,
            jurisdiccion: params.jurisdiccion,
            estadoVigencia: params.estadoVigencia,
            organismo: params.organismo,
            tema: params.tema,
        });
        return this.searchRaw(filterStr, params);
    }
    /**
     * Search doctrina with specific filters.
     */
    async searchDoctrina(params) {
        const filterStr = FilterBuilder.doctrina({
            materia: params.materia,
            autor: params.autor,
            fechaDesde: params.fechaDesde,
            fechaHasta: params.fechaHasta,
        });
        return this.searchRaw(filterStr, params);
    }
    /**
     * Search dictamenes with specific filters.
     */
    async searchDictamenes(params) {
        const filterStr = FilterBuilder.dictamenes({
            organismo: params.organismo,
            tema: params.tema,
        });
        return this.searchRaw(filterStr, params);
    }
    /**
     * Search the digital library.
     */
    async searchBiblioteca(params) {
        return this.searchRaw(PRESET_FILTERS.biblioteca_digital || "Publicación/Biblioteca digital", params);
    }
    /**
     * Retrieves the latest legal news (novedades).
     */
    async getNovedades(limit = 10) {
        return this.searchRaw(PRESET_FILTERS.novedades || "Publicación/Novedad", {
            query: "*:*",
            pageSize: limit,
            offset: 0,
            view: "detallada",
        });
    }
    /**
     * Generic search using a raw filter string.
     */
    async searchRaw(filterStr, params) {
        const queryParams = {
            o: (params.offset || 0).toString(),
            p: (params.pageSize || 20).toString(),
            f: filterStr,
            r: params.query || "*:*",
            v: params.view || "colapsada",
        };
        const data = await apiClient.get("/busqueda", {
            params: queryParams,
        });
        return this.parseResponse(data, params.query || "*:*");
    }
    /**
     * Provides autocomplete suggestions for legal terms or topics.
     */
    async suggestTerms(term, amount = 10) {
        const data = await apiClient.get("/suggest", {
            params: {
                key: term,
                amount: amount.toString(),
                suggesterName: "suggest",
            },
        });
        try {
            const suggestions = typeof data === "string" ? JSON.parse(data) : data;
            return Array.isArray(suggestions) ? suggestions : [];
        }
        catch (e) {
            return [];
        }
    }
    /**
     * Parses the raw API response into a validated SearchResponse.
     */
    parseResponse(data, query) {
        const queryData = data.queryObjectData || {};
        const searchData = data.searchResults || {};
        const results = (searchData.documentResultList || []).map((item) => ({
            uuid: item.uuid || "",
            document_score: item.documentScore || 0.0,
            document_abstract: item.documentAbstract || null,
        }));
        const response = {
            total_results: searchData.totalSearchResults || 0,
            offset: queryData.offset || 0,
            page_size: queryData.pageSize || 20,
            results: results,
            query: query,
            expanded_query: searchData.expandedQuery || null,
        };
        return SearchResponseSchema.parse(response);
    }
}
// Export a singleton instance
export const searchService = new SearchService();
