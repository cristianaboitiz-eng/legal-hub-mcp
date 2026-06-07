import { apiClient } from "./api-client.js";
import { DocumentMetadataSchema, DocumentType, } from "../types/saij.js";
import pdf from "pdf-parse";
import { createWorker } from "tesseract.js";
import { CONFIG } from "../config.js";
/**
 * DocumentService handles fetching full document content and metadata.
 * It implements specialized extraction logic for different document types.
 */
export class DocumentService {
    /**
     * Fetches document metadata by GUID.
     */
    async getDocumentMetadata(guid) {
        const response = await apiClient.get(`/view-document?guid=${guid}`);
        if (!response || !response.data) {
            throw new Error(`Document not found: ${guid}`);
        }
        try {
            const docData = JSON.parse(response.data);
            const doc = docData.document || {};
            const content = doc.content || {};
            return this.parseMetadata(content, guid);
        }
        catch (error) {
            throw new Error(`Failed to parse document metadata for ${guid}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Fetches full document content including text extraction from various sources.
     */
    async getFullDocument(guid) {
        const metadata = await this.getDocumentMetadata(guid);
        const result = {
            metadata,
            texto_completo: null,
        };
        // Get raw data for full content access
        const response = await apiClient.get(`/view-document?guid=${guid}`);
        const docData = JSON.parse(response.data);
        const content = docData.document?.content || {};
        switch (metadata.document_type) {
            case DocumentType.JURISPRUDENCIA:
                // Try to get text from API JSON first
                let texto = content.texto;
                if (texto && texto.length > 100) {
                    result.texto_completo = texto;
                }
                else if (metadata.pdf_url) {
                    // Fallback to PDF parsing
                    try {
                        const pdfBuffer = await apiClient.get(metadata.pdf_url.replace(CONFIG.BASE_URL, ""), {
                            responseType: "arraybuffer",
                        });
                        const pdfData = await pdf(pdfBuffer);
                        if (pdfData.text && pdfData.text.trim().length > 100) {
                            result.texto_completo = pdfData.text;
                        }
                        else {
                            // OCR Fallback for scanned PDFs
                            console.error(`PDF for ${guid} seems to be a scanned image. Starting OCR...`);
                            const worker = await createWorker("spa");
                            const { data: { text } } = await worker.recognize(pdfBuffer);
                            await worker.terminate();
                            if (text && text.length > 50) {
                                result.texto_completo = `[EXTRACTED VIA OCR]\n${text}`;
                            }
                        }
                    }
                    catch (error) {
                        console.error(`Failed to parse PDF or perform OCR for ${guid}:`, error);
                    }
                }
                break;
            case DocumentType.LEGISLACION:
                // Concatenate articles from extra.articulo
                const articulos = content.articulo;
                if (Array.isArray(articulos)) {
                    result.texto_completo = articulos
                        .map((art) => {
                        const num = art["numero-articulo"] || "";
                        const text = art["texto-articulo"] || "";
                        return `Artículo ${num}\n${text}`;
                    })
                        .join("\n\n");
                }
                else if (articulos && typeof articulos === "object") {
                    const num = articulos["numero-articulo"] || "";
                    const text = articulos["texto-articulo"] || "";
                    result.texto_completo = `Artículo ${num}\n${text}`;
                }
                break;
            case DocumentType.SUMARIO:
                // Clean [[p]] tags from texto field
                let sumarioTexto = content.texto || content.sumario;
                if (sumarioTexto) {
                    result.texto_completo = sumarioTexto.replace(/\[\[p\]\]/g, "\n");
                }
                break;
            default:
                // Default to any available text field
                result.texto_completo = content.texto || content.sumario || content["texto-completo"] || null;
        }
        return result;
    }
    /**
     * Retrieves a specific section or article from a large document.
     */
    async getDocumentSection(guid, options) {
        const metadata = await this.getDocumentMetadata(guid);
        const response = await apiClient.get(`/view-document?guid=${guid}`);
        const docData = JSON.parse(response.data);
        const content = docData.document?.content || {};
        let sectionText = null;
        if (metadata.document_type === DocumentType.LEGISLACION) {
            const articulos = content.articulo;
            if (Array.isArray(articulos)) {
                if (options.articleNumber) {
                    const art = articulos.find((a) => String(a["numero-articulo"]) === options.articleNumber);
                    if (art) {
                        sectionText = `Artículo ${art["numero-articulo"]}\n${art["texto-articulo"]}`;
                    }
                }
                else if (options.sectionTitle) {
                    const matched = articulos.filter((a) => (a["texto-articulo"] || "").toLowerCase().includes(options.sectionTitle.toLowerCase()));
                    if (matched.length > 0) {
                        sectionText = matched
                            .map((a) => `Artículo ${a["numero-articulo"]}\n${a["texto-articulo"]}`)
                            .join("\n\n");
                    }
                }
            }
        }
        return { metadata, section_text: sectionText };
    }
    /**
     * Internal parser for document metadata, matching Python logic.
     */
    parseMetadata(content, guid) {
        const id_saij = content["id-infojus"] || "";
        const docType = this.inferDocumentType(content);
        const textoDoc = content["texto-doc"] || {};
        const pdfUuid = textoDoc.uuid;
        const pdfFilename = textoDoc["file-name"];
        let pdfUrl = null;
        if (pdfUuid && pdfFilename) {
            pdfUrl = `${CONFIG.BASE_URL}/descarga-archivo?guid=${pdfUuid}&name=${encodeURIComponent(pdfFilename)}`;
        }
        const standardFields = new Set([
            "id-infojus", "tribunal", "fecha", "actor", "sobre",
            "magistrados", "numero-fallo", "provincia", "tipo-fallo",
            "texto-doc", "sumario", "numero-norma", "numero-doctrina",
            "numero-dictamen", "titulo", "titulo-norma", "texto", "articulo"
        ]);
        const extra = {};
        for (const key in content) {
            if (!standardFields.has(key)) {
                extra[key] = content[key];
            }
        }
        const metadata = {
            id_saij,
            uuid: guid,
            document_type: docType,
            tribunal: content.tribunal,
            fecha: content.fecha,
            caratula: this.buildCaratula(content),
            sumario: content.sumario,
            magistrates: content.magistrados,
            numero_fallo: content["numero-fallo"],
            fuero: this.inferFuero(content.tribunal || ""),
            provincia: content.provincia,
            tipo_fallo: content["tipo-fallo"],
            pdf_url: pdfUrl,
            pdf_uuid: pdfUuid,
            pdf_filename: pdfFilename,
            extra,
        };
        return DocumentMetadataSchema.parse(metadata);
    }
    inferDocumentType(content) {
        if (content["texto-doc"])
            return DocumentType.JURISPRUDENCIA;
        if (content["numero-norma"])
            return DocumentType.LEGISLACION;
        if (content["numero-doctrina"])
            return DocumentType.DOCTRINA;
        if (content["numero-dictamen"])
            return DocumentType.DICTAMEN;
        if (content.sumario)
            return DocumentType.SUMARIO;
        return DocumentType.UNKNOWN;
    }
    buildCaratula(content) {
        const actor = content.actor || "S/C";
        const sobre = content.sobre || "S/D";
        if (actor === "S/C" && sobre === "S/D") {
            return content.titulo || content["titulo-norma"] || null;
        }
        return `${actor} s/ ${sobre}`;
    }
    inferFuero(tribunal) {
        if (!tribunal)
            return null;
        const upper = tribunal.toUpperCase();
        if (upper.includes("CORTE SUPREMA") || upper.includes("CSJN"))
            return "csjn";
        if (upper.includes("CASACION PENAL"))
            return "casacion_penal_federal";
        if (upper.includes("CONTENCIOSO ADMINISTRATIVO"))
            return "contencioso_administrativo_federal";
        if (upper.includes("CRIMINAL Y CORRECCIONAL FEDERAL"))
            return "criminal_federal";
        if (upper.includes("CRIMINAL Y CORRECCIONAL"))
            return "criminal_nacional";
        if (upper.includes("CIVIL"))
            return "civil";
        if (upper.includes("COMERCIAL"))
            return "comercial";
        if (upper.includes("TRABAJO") || upper.includes("LABORAL"))
            return "laboral";
        if (upper.includes("PENAL"))
            return "penal";
        return null;
    }
}
// Export a singleton instance
export const documentService = new DocumentService();
