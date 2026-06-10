# REPORTE DE REPARACIONES - mcp-legal-ar
**Fecha:** 10/06/2026 | **Base:** REPORTE_TESTING_MCP_LEGAL_AR.md (9/6) + resumen de sesion anterior
**Archivos tocados:** `servers/legal-mcp/build/{index,infoleg,juba,bopba,ptn,bora,tfn,normativapba}.js` + `scripts/smoke-test-fixes.mjs`

> ⚠️ **Los cambios requieren reiniciar el MCP** (cerrar y reabrir Claude Desktop o recargar el conector). Los procesos en memoria siguen corriendo el codigo viejo.

---

## 1. JUBA::info - Error -32602 (CRITICA) ✅
**Causa real (no era de JUBA):** el gateway `index.js` expone `juba_info` como `juba__info` via `stripInternalPrefix` (strip destructivo), pero `callTool` reconstruia el nombre original con `slice()` y reenviaba `info` al hijo → -32602.
**Fix:** mapa `toolNameMap` (nombre expuesto → nombre original) poblado en `initialize()` y consultado en `callTool()`. Corrige de paso cualquier tool futura cuyo nombre interno empiece con el prefijo del conector.

## 2. InfoLEG 403 / ban de IP (CRITICA) ✅ workaround completo
Verificado en esta sesion desde una red distinta:
- `servicios.infoleg.gob.ar` API v2.0: **muerta de verdad** (cuerpo vacio tambien desde IP no baneada).
- `argentina.gob.ar/normativa/nacional/{id}` y `/{id}/texto`: **server-rendered con texto completo** (probado con id 296831 → Decreto-Ley 1311/56 integro, y 296846 → Ley 27.401 con sus 40 articulos). Mismo espacio de IDs que InfoLEG, host distinto al baneado.
- Los listados de busqueda y boletin de argentina.gob.ar renderizan por JS (confirmado: el HTML estatico trae solo el formulario).

**Fixes en `infoleg.js`:**
- Nuevo `fetchTextoFromArgentinaGobAr(id, tipoTexto)`: descarga el texto desde argentina.gob.ar, valida que no sea la ficha resumen ni pagina de bloqueo, extrae el cuerpo y recorta menues. Insertado como **Intento 3** de `fetchCleanText` (antes de los intentos Puppeteer contra el host baneado). Si se pidio `actualizado`, devuelve el original con **advertencia explicita** y link a `/normas-modifican` para verificar reformas.
- `obtener_texto_norma` muestra la advertencia cuando aplica.
- **Buscador ciego reparado sin conocer el endpoint JSON:** `searchNormativaOfficial` y `fetchBoletin` ahora renderizan la pagina con Puppeteer (la SPA dispara su propio XHR) cuando el HTML estatico viene vacio, y parsean el DOM resultante (tabla + fallback de anchors a `/normativa/nacional/...-{id}`). Beneficia a `buscar_normativa_avanzada`, `buscar_norma_por_tipo_numero_anio`, `buscar_normas_por_dependencia`, `consultar_boletin_por_*`, `buscar_en_sumario_boletin` y al fallback de `buscar_normativa`.
- `obtener_metadatos_norma`: con `idNorma` va directo a la ficha deterministica `argentina.gob.ar/normativa/nacional/{id}` (server-rendered), sin pasar por el buscador.
- `alcance_fuente` documenta la nueva cadena.
- `index.js`: timeout del conector infoleg subido a 90s (la cadena con Puppeteer no entraba en los 20s por defecto → habria devuelto timeout aunque el fallback funcionara).

## 3. BOPBA::detector_plazos_edictos - crash 'verbosity' (MEDIA) ✅
**Causa:** API de `pdf-parse` v2.4.5 mal usada: `new PDFParse()` sin opciones + `parser.parse(buffer)`. El constructor exige `{ data }` y el metodo es `getText()`; pdfjs recibia `undefined` y moria leyendo `.verbosity`.
**Fix:** corregido en los 3 usos de `bopba.js` (`actualizar_tasas`, `descargar_seccion`, `detector_plazos_edictos`).

## 4. BOPBA::ver_seccion - campos vacios (MEDIA) ✅
La pagina `/ver` renderiza por JS. Fix: `link_descargar` ahora se construye siempre con la convencion deterministica `/secciones/{id}/descargar` (la misma que usa `descargar_seccion`); mas selectores para el titulo; y si el HTML no aporta vista previa, se extrae la primera pagina del PDF con el parser ya reparado.

## 5. Detectores de plazos PTN y BOPBA - falsos negativos (MEDIA) ✅
Tres bugs compartidos: (a) regex de fechas con flag `/g` reutilizada con `.test()` → `lastIndex` sucio salteaba parrafos; (b) `\d+\s+(días?\s+(habiles|corridos)?|...)` exigia espacio despues de "días" → "10 días." nunca matcheaba, y "habiles" estaba sin tilde; (c) cero cobertura de formatos forenses reales.
**Fix:** set curado de patrones que cubre "diez (10) días hábiles", plazos en letras, "dentro del plazo", "contados desde la notificación", "bajo apercibimiento", "perentorio/improrrogable/fatal", prorroga, suspension/interrupcion de plazo, fechas en letras ("1° de marzo de 2026") y "a más tardar". Se eliminaron los ~85 patrones de relleno ("plazo de castigo", "plazo de estadía") que solo generaban ruido. Dedupe de etiquetas e higiene de `lastIndex`.
Nota: el caso del reporte ("facultades delegadas") correctamente da 0 - esa frase no contiene plazo.

## 6. JUBA::obtener_sentencia - stub vacio (MEDIA) ✅
`fetchJubaDocument` valida ahora: sin ningun metadato y con texto neto trivial (sin rotulos) → error explicito "Fallo no encontrado en JUBA" con indicacion de verificar el ID por busqueda.

## 7. NormativaPBA::mapa_normativo_tema (BAJA) ✅
`q[phrase]` con una palabra daba 0. Fix: frase exacta primero y, si el mapa queda vacio, reintento automatico con `q[with_some_words]` (el parametro de `buscar_normativa`, verificado con 31k resultados). El encabezado informa el modo usado.

## 8. BORA::obtener_sumario_del_dia - truncamiento (BAJA) ✅
Paginacion real: parametros `seccion`, `pagina`, `items_por_pagina` (default 50, max 200). Informa total de avisos, pagina X de Y, rango mostrado y la llamada para la pagina siguiente. Errores por seccion se reportan aparte.

## 9. TFN::buscar_resolucion_por_expediente (BAJA) ✅
Acepta `expediente` como alias de `numero_expediente`; si faltan ambos devuelve mensaje claro en vez del -32602 criptico.

---

## BATERIA DE PRUEBAS (tras reiniciar el MCP)

1. `node scripts/smoke-test-fixes.mjs` - sintaxis + fallback argentina.gob.ar + buscador Puppeteer.
2. `juba__info` → debe devolver la ficha de capacidades (antes -32602).
3. `juba__obtener_sentencia` con id `999999` → error explicito, no stub.
4. `bopba__detector_plazos_edictos` con id de seccion vigente → sin crash 'verbosity'.
5. `bopba__ver_seccion` id vigente → `link_descargar` poblado y vista previa del PDF.
6. `ptn__detector_plazos_dictamenes` con texto: "Debera expedirse dentro de los diez (10) días hábiles contados desde la notificación, bajo apercibimiento de caducidad." → debe detectar 5+ indicadores.
7. `infoleg__obtener_texto_norma` id `296831`, tipoTexto `original` → Decreto-Ley 1311/56 via argentina.gob.ar aunque siga el ban.
8. `infoleg__buscar_normativa` "locacion de obra" → resultados via render Puppeteer.
9. `bora__obtener_sumario_del_dia` con `items_por_pagina: 30` → paginado.
10. `normativapba__mapa_normativo_tema` tema "educación" → mapa poblado (modo palabras clave).

## RONDA 2 (post-testing en vivo del 10/6)

**JUBA::obtener_sentencia (FAIL → corregido).** El stub real del id 999999 trae ~250 caracteres de chrome de UI ("VISUALIZACION DEL TEXTO COMPLETO... Imprimir Descargar...") que superaban el umbral de 100. La heuristica ahora elimina todos los rotulos y botones (lista completa capturada del stub real) y ademas exige marcadores de contenido juridico (VISTOS/CONSIDERANDO/RESUELVE/etc.) cuando no hay metadatos.

**InfoLEG::buscar_normativa resultados irrelevantes (PARCIAL → corregido).** Los 3 "resultados" eran los destacados de "novedades normativas" de la landing de argentina.gob.ar (slug /norma-{id}): el parametro texto se ignora en el HTML estatico y el escaneo de anchors los levantaba como si fueran resultados, bloqueando el fallback Puppeteer. Ahora el HTML estatico solo se acepta si trae la tabla de resultados real; el escaneo de anchors corre unicamente sobre la pagina renderizada y excluye el patron /norma-{id} de los destacados.

**NormativaPBA::mapa_normativo_tema (FAIL → corregido).** Diagnostico en vivo contra normas.gba.gob.ar: el filtro server-side q[terms][raw_type] esta roto en el sitio (0 resultados con 'ley', 'Ley' y 'LEY'; el campo existe porque filtra, pero ningun valor del indice matchea), mientras q[terms][number] y [year] funcionan (verificado: number=14744 → Ley 14744). Fix: busqueda sin filtro de tipo + clasificacion local por el slug del enlace (/ar-b/ley/, /ar-b/decreto/, etc.), recorriendo hasta 4 paginas o 5 normas por jerarquia. El mismo fix se aplico a buscar_normativa (su parametro tipo_norma arrastraba el bug y filtra ahora localmente, con nota en la salida).

**Re-test tras nuevo reinicio del MCP:**
- `juba__obtener_sentencia` id 999999 → "Fallo no encontrado en JUBA".
- `infoleg__buscar_normativa` "locacion de obra" → o resultados pertinentes via Puppeteer, o error/0 honesto (nunca mas novedades ajenas). Si da 0: capturar el XHR real del buscador con DevTools (F12 → Network → buscar en la pagina) y pasarme la URL.
- `normativapba__mapa_normativo_tema` tema "educación" → mapa con leyes/decretos/resoluciones/disposiciones.
- `normativapba__buscar_normativa` palabras_clave "educación" + tipo_norma "ley" → solo leyes.

## RONDA 3 (re-test del 10/6, tarde)

Resultado del re-test: JUBA ✅, NormativaPBA mapa ✅, NormativaPBA buscar con tipo ✅. InfoLEG buscar_normativa seguia reportando el 403 del WAF.

**Causa raiz encontrada: Puppeteer no esta instalado.** Figura en `servers/legal-mcp/package.json` (`"puppeteer": "^25.1.0"`) pero `node_modules/puppeteer` no existe en ningun nivel del repo. TODOS los fallbacks de render JS (incluidos los de la sesion anterior) venian fallando en silencio con ERR_MODULE_NOT_FOUND; el unico error visible quedaba siendo el 403 del Solr.

Fixes de codigo: el import de Puppeteer ahora lanza un error explicito con la solucion; `searchNormativaOfficial` y `fetchBoletin` propagan la causa del render fallido en vez de devolver un falso "0 resultados"; `buscar_normativa` reporta el error del fallback junto al del Solr.

**Accion requerida (una sola vez):**
```
cd C:\Users\Ximena\mcp-legal-ar\servers\legal-mcp
npm install
```
(Descarga Chrome para Puppeteer, ~150-200 MB; puede tardar varios minutos.) Luego reiniciar Claude Desktop y re-probar `infoleg__buscar_normativa` "locacion de obra". Si con Puppeteer instalado da 0 o irrelevantes, la SPA no auto-ejecuta la busqueda desde la URL: capturar el XHR real con DevTools (F12 → Network → buscar en la pagina) y pasar la URL del request.

## PENDIENTES / RIESGOS CONOCIDOS
- **No verificado en vivo:** que la SPA de argentina.gob.ar auto-ejecute la busqueda al cargar la URL con parametros bajo Puppeteer (el sandbox de esta sesion no podia correr node ni navegador). Si el test 8 da 0 resultados, el siguiente paso es capturar el XHR real con DevTools (pestaña Network al buscar) y pegarme la URL del request.
- El "texto actualizado" consolidado sigue dependiendo de `texact.htm` en servicios.infoleg (host baneado para tu IP): mientras dure el ban, las consultas `actualizado` devuelven el original con advertencia.
- El ban del WAF sigue vigente: moderar frecuencia de requests cuando expire.
- `juba__info` se expone con ese nombre por el strip de prefijo del gateway; el hijo la registra como `juba_info`. Con el fix del mapa ambas rutas resuelven bien.
