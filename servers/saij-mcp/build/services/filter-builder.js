/**
 * FilterBuilder replicates the Python FilterBuilder from saij-api.
 * It builds pipe-separated filter strings for the SAIJ API.
 */
export class FilterBuilder {
    /**
     * Build filter string for jurisprudencia.
     */
    static jurisprudencia(options) {
        const filters = ["Total"];
        if (options.tipoDoc) {
            filters.push(`Tipo de Documento/Jurisprudencia/${options.tipoDoc}`);
        }
        else {
            filters.push("Tipo de Documento/Jurisprudencia");
        }
        if (options.jurisdiccion) {
            filters.push(`Jurisdicción/${options.jurisdiccion}`);
        }
        if (options.tribunal) {
            filters.push(`Tribunal/${options.tribunal}`);
        }
        if (options.materia) {
            filters.push(`Tema/${options.materia}[3,1]`);
        }
        if (options.fechaDesde || options.fechaHasta) {
            const fechaDesde = options.fechaDesde || "*";
            // We use the same pattern as Python: Fecha/fecha_desde[20,1]
            // Note: the Python code only used fecha_parts[0] which is fecha_desde
            filters.push(`Fecha/${fechaDesde}[20,1]`);
        }
        return filters.join("|");
    }
    /**
     * Build filter string for legislacion.
     */
    static legislacion(options) {
        const filters = ["Total"];
        if (options.tipoNorma) {
            filters.push(`Tipo de Documento/Legislación/${options.tipoNorma}`);
        }
        else {
            filters.push("Tipo de Documento/Legislación");
        }
        if (options.jurisdiccion) {
            filters.push(`Jurisdicción/${options.jurisdiccion}`);
        }
        if (options.estadoVigencia) {
            filters.push(`Estado de Vigencia/${options.estadoVigencia}`);
        }
        if (options.organismo) {
            filters.push(`Organismo/${options.organismo}`);
        }
        if (options.tema) {
            filters.push(`Tema/${options.tema}[5,1]`);
        }
        return filters.join("|");
    }
    /**
     * Build filter string for doctrina.
     */
    static doctrina(options) {
        const filters = ["Total", "Tipo de Documento/Doctrina"];
        if (options.materia) {
            filters.push(`Tema/${options.materia}`);
        }
        if (options.autor) {
            filters.push(`Autor/${options.autor}`);
        }
        if (options.fechaDesde || options.fechaHasta) {
            const fechaDesde = options.fechaDesde || "*";
            filters.push(`Fecha/${fechaDesde}[20,1]`);
        }
        return filters.join("|");
    }
    /**
     * Build filter string for dictamenes.
     */
    static dictamenes(options) {
        const filters = ["Total"];
        if (options.organismo) {
            filters.push(`Tipo de Documento/Dictamen/${options.organismo}`);
        }
        else {
            filters.push("Tipo de Documento/Dictamen");
        }
        if (options.tema) {
            filters.push(`Tema/${options.tema}[5,1]`);
        }
        return filters.join("|");
    }
}
/**
 * commonly used filter combinations
 */
export const PRESET_FILTERS = {
    // JURISPRUDENCIA
    csjn: "Total|Tipo de Documento/Jurisprudencia|Tribunal/CORTE SUPREMA DE JUSTICIA DE LA NACION",
    jurisprudencia_nacional: "Total|Tipo de Documento/Jurisprudencia|Jurisdicción/Nacional",
    jurisprudencia_federal: "Total|Tipo de Documento/Jurisprudencia|Jurisdicción/Federal",
    jurisprudencia_provincial: "Total|Tipo de Documento/Jurisprudencia|Jurisdicción/Local",
    jurisprudencia_internacional: "Total|Tipo de Documento/Jurisprudencia|Jurisdicción/Internacional",
    jurisprudencia_constitucional: "Total|Tipo de Documento/Jurisprudencia|Tema/Derecho constitucional[3,1]",
    jurisprudencia_civil: "Total|Tipo de Documento/Jurisprudencia|Tema/Derecho civil[3,1]",
    jurisprudencia_laboral: "Total|Tipo de Documento/Jurisprudencia|Tema/Derecho laboral[3,1]",
    jurisprudencia_penal: "Total|Tipo de Documento/Jurisprudencia|Tema/Derecho penal[3,1]",
    jurisprudencia_comercial: "Total|Tipo de Documento/Jurisprudencia|Tema/Derecho comercial[3,1]",
    jurisprudencia_administrativo: "Total|Tipo de Documento/Jurisprudencia|Tema/Derecho administrativo[3,1]",
    jurisprudencia_procesal: "Total|Tipo de Documento/Jurisprudencia|Tema/Derecho procesal[3,1]",
    tribunal_etica: "Total|Tipo de Documento/Jurisprudencia|Tribunal/TRIBUNAL DE CONDUCTA",
    // LEGISLACION
    constituciones: "Total|Tipo de Documento/Legislación/Ley/Constitución|Estado de Vigencia/Vigente, de alcance general",
    codigos: "Total|Tipo de Documento/Legislación/Ley/Código|Estado de Vigencia/Vigente, de alcance general",
    tratados: "Total|Tipo de Documento/Legislación/Ley/Tratado",
    leyes_nacionales_vigentes: "Total|Tipo de Documento/Legislación/Ley|Jurisdicción/Nacional|Estado de Vigencia/Vigente, de alcance general",
    leyes_provinciales_vigentes: "Total|Tipo de Documento/Legislación/Ley|Jurisdicción/Local|Estado de Vigencia/Vigente, de alcance general",
    leyes_vetadas: "Total|Tipo de Documento/Legislación/Ley|Jurisdicción/Nacional|Estado de Vigencia/Vetada",
    decretos_nacionales_vigentes: "Total|Tipo de Documento/Legislación/Decreto|Jurisdicción/Nacional|Estado de Vigencia/Vigente, de alcance general",
    dnu: "Total|Tipo de Documento/Legislación/Decreto|Jurisdicción/Nacional",
    normativa_comunitaria: "Total|Tipo de Documento/Legislación",
    resoluciones_afip: "Total|Organismo/AFIP",
    resoluciones_igj: "Total|Organismo/IGJ",
    resoluciones_aabe: "Total|Organismo/AABE",
    // DOCTRINA
    doctrina_general: "Total|Tipo de Documento/Doctrina",
    doctrina_administrativo: "Total|Tipo de Documento/Doctrina|Tema/Derecho administrativo[3,1]",
    doctrina_civil: "Total|Tipo de Documento/Doctrina|Tema/Derecho civil[3,1]",
    doctrina_comercial: "Total|Tipo de Documento/Doctrina|Tema/Derecho comercial[3,1]",
    doctrina_constitucional: "Total|Tipo de Documento/Doctrina|Tema/Derecho constitucional[3,1]",
    doctrina_familia: "Total|Tipo de Documento/Doctrina|Tema/Derecho civil/relaciones de familia[2,1]",
    doctrina_internacional: "Total|Tipo de Documento/Doctrina|Tema/Derecho internacional[3,1]",
    doctrina_laboral: "Total|Tipo de Documento/Doctrina|Tema/Derecho laboral[3,1]",
    doctrina_penal: "Total|Tipo de Documento/Doctrina|Tema/Derecho penal[3,1]",
    doctrina_procesal: "Total|Tipo de Documento/Doctrina|Tema/Derecho procesal[3,1]",
    doctrina_seguridad_social: "Total|Tipo de Documento/Doctrina|Tema/Seguridad social[3,1]",
    doctrina_tributario: "Total|Tipo de Documento/Doctrina|Tema/Derecho tributario y aduanero[3,1]",
    // DICTAMENES
    dictamenes_mpf: "Total|Tipo de Documento/Dictamen/Ministerio Público Fiscal",
    dictamenes_ptn: "Total|Tipo de Documento/Dictamen/PTN",
    dictamenes_inadi: "Total|Tipo de Documento/Dictamen/INADI",
    dictamenes_aaip: "Total|Tipo de Documento/Dictamen/AAIP",
    // NOVEDADES
    novedades: "Total|Publicación/Novedad",
    // BIBLIOTECA
    biblioteca_digital: "Total|Publicación/Biblioteca digital",
};
