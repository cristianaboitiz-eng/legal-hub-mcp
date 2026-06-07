import { documentService } from "./document-service.js";
/**
 * GraphService navigates the relationships between legal documents.
 */
export class GraphService {
    /**
     * Identifies related documents from document metadata 'extra' fields.
     */
    async getRelatedDocuments(guid) {
        const metadata = await documentService.getDocumentMetadata(guid);
        const extra = metadata.extra || {};
        const relationships = [];
        // 1. Normativa Citada (Common in Legislacion and Jurisprudencia)
        if (extra["normativa-citada"]) {
            const norms = Array.isArray(extra["normativa-citada"]) ? extra["normativa-citada"] : [extra["normativa-citada"]];
            norms.forEach((norm) => {
                relationships.push({
                    type: "Normativa Citada",
                    description: typeof norm === "string" ? norm : norm.titulo || norm.nombre || "Norma sin título",
                    guid: norm.uuid,
                    id_saij: norm["id-infojus"],
                });
            });
        }
        // 2. Fallos Relacionados
        if (extra["fallos-relacionados"]) {
            const fallos = Array.isArray(extra["fallos-relacionados"]) ? extra["fallos-relacionados"] : [extra["fallos-relacionados"]];
            fallos.forEach((fallo) => {
                relationships.push({
                    type: "Fallo Relacionado",
                    description: fallo.caratula || fallo.titulo || "Fallo relacionado",
                    guid: fallo.uuid,
                    id_saij: fallo["id-infojus"],
                });
            });
        }
        // 3. Doctrina Relacionada
        if (extra["doctrina-relacionada"]) {
            const docs = Array.isArray(extra["doctrina-relacionada"]) ? extra["doctrina-relacionada"] : [extra["doctrina-relacionada"]];
            docs.forEach((doc) => {
                relationships.push({
                    type: "Doctrina Relacionada",
                    description: doc.titulo || "Artículo de doctrina",
                    guid: doc.uuid,
                    id_saij: doc["id-infojus"],
                });
            });
        }
        // 4. Sumarios Relacionados
        if (extra["sumarios-relacionados"]) {
            const sumarios = Array.isArray(extra["sumarios-relacionados"]) ? extra["sumarios-relacionados"] : [extra["sumarios-relacionados"]];
            sumarios.forEach((s) => {
                relationships.push({
                    type: "Sumario Relacionado",
                    description: s.sumario || "Resumen relacionado",
                    guid: s.uuid,
                    id_saij: s["id-infojus"],
                });
            });
        }
        return relationships;
    }
}
export const graphService = new GraphService();
