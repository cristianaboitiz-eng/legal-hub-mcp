import { z } from "zod";
/**
 * SAIJ Filter Enums ported from Python saij_api/filters.py
 */
export var Jurisdiccion;
(function (Jurisdiccion) {
    Jurisdiccion["NACIONAL"] = "Nacional";
    Jurisdiccion["FEDERAL"] = "Federal";
    Jurisdiccion["LOCAL"] = "Local";
    Jurisdiccion["INTERNACIONAL"] = "Internacional";
})(Jurisdiccion || (Jurisdiccion = {}));
export var TribunalFederal;
(function (TribunalFederal) {
    TribunalFederal["CAMARA_FEDERAL_CASACION_PENAL"] = "CAMARA FEDERAL DE CASACION PENAL";
    TribunalFederal["CAMARA_NAC_APELAC_CONTENCIOSO_ADMINISTRATIVO_FEDERAL"] = "CAMARA NAC. APELAC. EN LO CONTENCIOSO ADMINISTRATIVO FEDERAL";
    TribunalFederal["CAMARA_NAC_APELAC_CRIMINAL_CORRECCIONAL_FEDERAL"] = "CAMARA NAC. DE APELAC. EN LO CRIMINAL Y CORRECCIONAL FEDERAL";
    TribunalFederal["CAMARA_NAC_APELACIONES_CIVIL_COMERCIAL_FEDERAL"] = "CAMARA NAC. DE APELACIONES EN LO CIVIL COMERCIAL FEDERAL";
    TribunalFederal["CORTE_SUPREMA_DE_JUSTICIA_DE_LA_NACION"] = "CORTE SUPREMA DE JUSTICIA DE LA NACION";
    TribunalFederal["CAMARA_APELACIONES_DEL_TRABAJO"] = "CAMARA DE APELACIONES DEL TRABAJO";
    TribunalFederal["CAMARA_APELACIONES_CIVIL_COMERCIAL"] = "CAMARA DE APELACIONES EN LO CIVIL Y COMERCIAL";
    TribunalFederal["CORTE_SUPREMA_DE_JUSTICIA"] = "CORTE SUPREMA DE JUSTICIA";
    TribunalFederal["SUPERIOR_TRIBUNAL_DE_JUSTICIA"] = "SUPERIOR TRIBUNAL DE JUSTICIA";
    TribunalFederal["SUPREMA_CORTE_DE_JUSTICIA"] = "SUPREMA CORTE DE JUSTICIA";
})(TribunalFederal || (TribunalFederal = {}));
export var Provincia;
(function (Provincia) {
    Provincia["BUENOS_AIRES"] = "Buenos Aires";
    Provincia["CATAMARCA"] = "Catamarca";
    Provincia["CABA"] = "Ciudad Aut\u00F3noma de Buenos Aires";
    Provincia["CHACO"] = "Chaco";
    Provincia["CHUBUT"] = "Chubut";
    Provincia["CORRIENTES"] = "Corrientes";
    Provincia["CORDOBA"] = "C\u00F3rdoba";
    Provincia["ENTRE_RIOS"] = "Entre R\u00EDos";
    Provincia["FORMOSA"] = "Formosa";
    Provincia["JUJUY"] = "Jujuy";
    Provincia["LA_PAMPA"] = "La Pampa";
    Provincia["LA_RIOJA"] = "La Rioja";
    Provincia["MENDOZA"] = "Mendoza";
    Provincia["MISIONES"] = "Misiones";
    Provincia["NEUQUEN"] = "Neuqu\u00E9n";
    Provincia["RIO_NEGRO"] = "R\u00EDo Negro";
    Provincia["SALTA"] = "Salta";
    Provincia["SANTA_CRUZ"] = "Santa Cruz";
    Provincia["SANTA_FE"] = "Santa Fe";
    Provincia["SAN_JUAN"] = "San Juan";
    Provincia["SAN_LUIS"] = "San Luis";
    Provincia["SANTIAGO_DEL_ESTERO"] = "Santiago del Estero";
    Provincia["TIERRA_DEL_FUEGO"] = "Tierra del Fuego";
    Provincia["TUCUMAN"] = "Tucum\u00E1n";
})(Provincia || (Provincia = {}));
export var Materia;
(function (Materia) {
    Materia["DERECHO_ADMINISTRATIVO"] = "Derecho administrativo";
    Materia["DERECHO_CIVIL"] = "Derecho civil";
    Materia["DERECHO_CONSTITUCIONAL"] = "Derecho constitucional";
    Materia["DERECHO_PENAL"] = "Derecho penal";
    Materia["DERECHO_PROCESAL"] = "Derecho procesal";
    Materia["DERECHO_LABORAL"] = "Derecho laboral";
    Materia["DERECHO_COMERCIAL"] = "Derecho comercial";
    Materia["DERECHO_INTERNACIONAL"] = "Derecho internacional";
    Materia["DERECHO_TRIBUTARIO_ADUANERO"] = "Derecho tributario y aduanero";
    Materia["DERECHO_SEGURIDAD_SOCIAL"] = "Seguridad social";
    Materia["CULTURA_EDUCACION"] = "Cultura y educaci\u00F3n";
    Materia["ECONOMIA_FINANZAS"] = "Econom\u00EDa y finanzas";
    Materia["DERECHOS_HUMANOS"] = "Derechos humanos";
    Materia["SALUD_PUBLICA"] = "Salud p\u00FAblica";
    Materia["RELACIONES_FAMILIA"] = "relaciones de familia";
    Materia["DERECHOS_PERSONALES"] = "derechos personales";
    Materia["PERSONA_HUMANA"] = "persona humana";
    Materia["DERECHOS_GARANTIAS_CONSTITUCIONALES"] = "derechos y garant\u00EDas constitucionales";
    Materia["ESTADO"] = "Estado";
    Materia["PODERES_DEL_ESTADO"] = "poderes del Estado";
    Materia["ETAPAS_DEL_PROCESO"] = "etapas del proceso";
    Materia["JURISDICCION_COMPETENCIA"] = "jurisdicci\u00F3n y competencia";
    Materia["ORGANIZACION_DE_LA_JUSTICIA"] = "organizaci\u00F3n de la justicia";
})(Materia || (Materia = {}));
export var TipoDocumentoJurisprudencia;
(function (TipoDocumentoJurisprudencia) {
    TipoDocumentoJurisprudencia["FALLO"] = "Fallo";
    TipoDocumentoJurisprudencia["SENTENCIA"] = "Sentencia";
    TipoDocumentoJurisprudencia["SUMARIO"] = "Sumario";
    TipoDocumentoJurisprudencia["CASACION"] = "CASACION";
    TipoDocumentoJurisprudencia["INTERLOCUTORIO"] = "INTERLOCUTORIO";
    TipoDocumentoJurisprudencia["JUICIO_POPULAR"] = "JUICIO POPULAR";
    TipoDocumentoJurisprudencia["PLENARIO"] = "PLENARIO";
})(TipoDocumentoJurisprudencia || (TipoDocumentoJurisprudencia = {}));
export var TipoNorma;
(function (TipoNorma) {
    TipoNorma["LEY"] = "Ley";
    TipoNorma["DECRETO"] = "Decreto";
    TipoNorma["DECISION"] = "Decisi\u00F3n";
    TipoNorma["RESOLUCION"] = "Resoluci\u00F3n";
    TipoNorma["DISPOSICION"] = "Disposici\u00F3n";
    TipoNorma["ACORDADA"] = "Acordada";
    TipoNorma["CODIGO"] = "C\u00F3digo";
    TipoNorma["CONSTITUCION"] = "Constituci\u00F3n";
    TipoNorma["TRATADO"] = "Tratado";
    TipoNorma["DECRETO_LEY"] = "Decreto Ley";
    TipoNorma["LEY_CONTRATO_TRABAJO"] = "Ley de Contrato de Trabajo";
    TipoNorma["TEXTO_ORDENADO_LEY"] = "Texto Ordenado Ley";
})(TipoNorma || (TipoNorma = {}));
export var EstadoVigencia;
(function (EstadoVigencia) {
    EstadoVigencia["VIGENTE_ALCANCE_GENERAL"] = "Vigente, de alcance general";
    EstadoVigencia["INDIVIDUAL_MODIFICATORIA_SIN_EFICACIA"] = "Individual, Solo Modificatoria o Sin Eficacia";
    EstadoVigencia["VETADA"] = "Vetada";
    EstadoVigencia["DEROGADA"] = "Derogada";
    EstadoVigencia["NO_VIGENTE_ABROGADA_IMPLICITAMENTE"] = "No vigente, abrogada impl\u00EDcitamente";
    EstadoVigencia["NO_VIGENTE_LEY_CADUCA"] = "No vigente, ley caduca";
    EstadoVigencia["REFUNDIDA_LEY_CADUCA"] = "Refundida, ley caduca";
})(EstadoVigencia || (EstadoVigencia = {}));
export var JurisdiccionLegislacion;
(function (JurisdiccionLegislacion) {
    JurisdiccionLegislacion["NACIONAL"] = "Nacional";
    JurisdiccionLegislacion["INTERNACIONAL"] = "Internacional";
    JurisdiccionLegislacion["LOCAL"] = "Local";
})(JurisdiccionLegislacion || (JurisdiccionLegislacion = {}));
export var Organismo;
(function (Organismo) {
    Organismo["AFIP"] = "AFIP";
    Organismo["IGJ"] = "IGJ";
    Organismo["AABE"] = "AABE";
    Organismo["PTN"] = "PTN";
    Organismo["MPF"] = "Ministerio P\u00FAblico Fiscal";
    Organismo["INADI"] = "INADI";
    Organismo["AAIP"] = "Agencia de Acceso a la Informacion Publica";
})(Organismo || (Organismo = {}));
export var DoctrinaMateria;
(function (DoctrinaMateria) {
    DoctrinaMateria["DERECHO_ADMINISTRATIVO"] = "Derecho administrativo";
    DoctrinaMateria["DERECHO_CIVIL"] = "Derecho civil";
    DoctrinaMateria["DERECHO_COMERCIAL"] = "Derecho comercial";
    DoctrinaMateria["DERECHO_CONSTITUCIONAL"] = "Derecho constitucional";
    DoctrinaMateria["DERECHO_FAMILIA"] = "Derecho civil/relaciones de familia";
    DoctrinaMateria["DERECHO_INTERNACIONAL"] = "Derecho internacional";
    DoctrinaMateria["DERECHO_LABORAL"] = "Derecho laboral";
    DoctrinaMateria["DERECHO_PENAL"] = "Derecho penal";
    DoctrinaMateria["DERECHO_PROCESAL"] = "Derecho procesal";
    DoctrinaMateria["DERECHO_SEGURIDAD_SOCIAL"] = "Seguridad social";
    DoctrinaMateria["DERECHO_TRIBUTARIO_ADUANERO"] = "Derecho tributario y aduanero";
})(DoctrinaMateria || (DoctrinaMateria = {}));
export var OrganismoDictamen;
(function (OrganismoDictamen) {
    OrganismoDictamen["PTN"] = "PTN";
    OrganismoDictamen["MPF"] = "Ministerio P\u00FAblico Fiscal";
    OrganismoDictamen["INADI"] = "INADI";
    OrganismoDictamen["AAIP"] = "AAIP";
})(OrganismoDictamen || (OrganismoDictamen = {}));
export var DocumentType;
(function (DocumentType) {
    DocumentType["JURISPRUDENCIA"] = "jurisprudencia";
    DocumentType["LEGISLACION"] = "legislacion";
    DocumentType["DOCTRINA"] = "doctrina";
    DocumentType["DICTAMEN"] = "dictamen";
    DocumentType["SUMARIO"] = "sumario";
    DocumentType["NOVEDAD"] = "novedad";
    DocumentType["UNKNOWN"] = "unknown";
})(DocumentType || (DocumentType = {}));
/**
 * Interfaces & Zod Schemas based on Python models
 */
export const DocumentMetadataSchema = z.object({
    id_saij: z.string(),
    uuid: z.string(),
    document_type: z.nativeEnum(DocumentType).default(DocumentType.UNKNOWN),
    tribunal: z.string().optional().nullable(),
    fecha: z.string().optional().nullable(),
    caratula: z.string().optional().nullable(),
    sumario: z.string().optional().nullable(),
    numero_fallo: z.number().optional().nullable(),
    magistrates: z.string().optional().nullable(),
    fuero: z.string().optional().nullable(),
    provincia: z.string().optional().nullable(),
    tipo_fallo: z.string().optional().nullable(),
    pdf_url: z.string().optional().nullable(),
    pdf_uuid: z.string().optional().nullable(),
    pdf_filename: z.string().optional().nullable(),
    extra: z.record(z.any()).default({}),
});
export const DocumentSchema = z.object({
    metadata: DocumentMetadataSchema,
    texto_completo: z.string().optional().nullable(),
});
export const SearchResultSchema = z.object({
    uuid: z.string(),
    document_score: z.number().default(0.0),
    document_abstract: z.string().optional().nullable(),
});
export const SearchResponseSchema = z.object({
    total_results: z.number(),
    offset: z.number(),
    page_size: z.number(),
    results: z.array(SearchResultSchema).default([]),
    query: z.string().optional().nullable(),
    expanded_query: z.string().optional().nullable(),
});
export const SearchParamsSchema = z.object({
    query: z.string().optional().describe("Búsqueda por texto libre (ej: 'daños y perjuicios')"),
    offset: z.number().optional().describe("Desplazamiento para paginación"),
    pageSize: z.number().optional().describe("Cantidad de resultados por página"),
    view: z.enum(["colapsada", "detallada"]).optional().describe("Nivel de detalle de los resultados"),
});
export const JurisprudenciaSearchParamsSchema = SearchParamsSchema.extend({
    jurisdiccion: z.nativeEnum(Jurisdiccion).optional().describe("Jurisdicción: Nacional, Federal, Local, Internacional"),
    tribunal: z.string().optional().describe("Nombre del tribunal (ej: 'CORTE SUPREMA DE JUSTICIA DE LA NACION')"),
    materia: z.nativeEnum(Materia).optional().describe("Materia jurídica (ej: 'Derecho civil')"),
    tipoDoc: z.nativeEnum(TipoDocumentoJurisprudencia).optional().describe("Tipo de documento (ej: 'Fallo', 'Sumario')"),
    fechaDesde: z.string().optional().describe("Fecha inicial (YYYY-MM-DD)"),
    fechaHasta: z.string().optional().describe("Fecha final (YYYY-MM-DD)"),
});
export const LegislacionSearchParamsSchema = SearchParamsSchema.extend({
    tipoNorma: z.nativeEnum(TipoNorma).optional().describe("Tipo de norma (ej: 'Ley', 'Decreto')"),
    jurisdiccion: z.nativeEnum(JurisdiccionLegislacion).optional().describe("Jurisdicción legislativa"),
    estadoVigencia: z.nativeEnum(EstadoVigencia).optional().describe("Estado de vigencia"),
    organismo: z.nativeEnum(Organismo).optional().describe("Organismo emisor"),
    tema: z.string().optional().describe("Tema o materia legislativa"),
});
export const DoctrinaSearchParamsSchema = SearchParamsSchema.extend({
    materia: z.nativeEnum(DoctrinaMateria).optional().describe("Materia de la doctrina"),
    autor: z.string().optional().describe("Nombre del autor"),
    fechaDesde: z.string().optional().describe("Fecha inicial (YYYY-MM-DD)"),
    fechaHasta: z.string().optional().describe("Fecha final (YYYY-MM-DD)"),
});
export const DictamenesSearchParamsSchema = SearchParamsSchema.extend({
    organismo: z.nativeEnum(OrganismoDictamen).optional().describe("Organismo del dictamen (ej: 'PTN', 'MPF')"),
    tema: z.string().optional().describe("Tema del dictamen"),
});
