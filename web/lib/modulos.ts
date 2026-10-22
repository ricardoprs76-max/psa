import type { Rol } from "./sesion";

/**
 * Descripción de cada módulo de datos. Las pantallas de lista, formulario y exportación se generan a partir
 * de aquí, así que agregar un campo a un módulo es agregar una línea.
 */
export type TipoCampo = "texto" | "parrafo" | "numero" | "entero" | "moneda" | "fecha" | "si_no" | "opcion" | "ref";

export type Campo = {
  n: string;                        // columna
  e: string;                        // etiqueta
  t: TipoCampo;
  req?: boolean;
  lista?: boolean;                  // se muestra en la tabla
  ops?: [valor: string, etiqueta: string][];
  ref?: { tabla: string; etiqueta: string };   // etiqueta = expresión SQL sobre la tabla referida
  ayuda?: string;
  ancho?: boolean;                  // ocupa toda la fila del formulario
  soloLectura?: boolean;            // calculado por la base
};

export type Hija = { modulo: string; fk: string; titulo: string };

export type Modulo = {
  tabla: string;
  titulo: string;
  singular: string;
  grupo: "Gestión" | "Territorio" | "Catálogos" | "Expedientes" | "interno";
  pk?: string;                      // por defecto "id"
  campos: Campo[];
  buscar: string[];                 // columnas de texto donde busca el cuadro de búsqueda
  orden: string;
  editan: Rol[];
  ven: Rol[];
  borradoLogico?: boolean;
  hijas?: Hija[];                   // listas que se editan dentro de la ficha
  nombre: string;                   // expresión SQL para nombrar un registro
};

const OFICINA: Rol[] = ["administrador", "coordinador", "financiero", "consulta"];
const COORD: Rol[] = ["administrador", "coordinador"];
const o = (...v: string[]): [string, string][] => v.map((x) => [x.split("|")[0], x.split("|")[1] ?? x.split("|")[0]]);

const TENENCIA = o("propietario|Propietario", "poseedor|Poseedor", "ocupante|Ocupante");
const MODALIDAD = o("hidrico|Hídrico", "biodiversidad|Biodiversidad", "carbono|Carbono", "otros|Otros");

export const MODULOS: Record<string, Modulo> = {
  convenios: {
    tabla: "convenios", titulo: "Convenios", singular: "convenio", grupo: "Gestión", nombre: "numero",
    buscar: ["numero", "entidad_contratante", "operador", "objeto"], orden: "numero desc", editan: COORD, ven: OFICINA, borradoLogico: true,
    campos: [
      { n: "numero", e: "Número", t: "texto", req: true, lista: true, ayuda: "Ej. CNV 2025-012" },
      { n: "estado", e: "Estado", t: "opcion", lista: true, ops: o("en_estructuracion|En estructuración", "vigente|Vigente", "suspendido|Suspendido", "terminado|Terminado", "liquidado|Liquidado") },
      { n: "entidad_contratante", e: "Entidad contratante", t: "texto", req: true, lista: true },
      { n: "operador", e: "Operador", t: "texto", req: true, lista: true },
      { n: "objeto", e: "Objeto", t: "parrafo", req: true, ancho: true },
      { n: "proyecto_marco", e: "Proyecto marco", t: "texto", ancho: true },
      { n: "fecha_inicio", e: "Fecha de inicio", t: "fecha", lista: true },
      { n: "fecha_fin", e: "Fecha de terminación", t: "fecha", lista: true },
      { n: "valor", e: "Valor", t: "moneda", lista: true },
      { n: "observaciones", e: "Observaciones", t: "parrafo", ancho: true },
    ],
  },
  beneficiarios: {
    tabla: "beneficiarios", titulo: "Beneficiarios", singular: "beneficiario", grupo: "Gestión", nombre: "nombre",
    buscar: ["nombre", "numero_documento", "representante_nombre", "municipio"], orden: "nombre", editan: COORD, ven: OFICINA, borradoLogico: true,
    hijas: [{ modulo: "cuentas", fk: "beneficiario_id", titulo: "Cuentas bancarias" }],
    campos: [
      { n: "tipo", e: "Tipo", t: "opcion", req: true, lista: true, ops: o("persona_natural|Persona natural", "jac|Junta de Acción Comunal", "asociacion_acueducto|Asociación de acueducto", "comunidad_etnica|Comunidad étnica", "entidad|Entidad") },
      { n: "nombre", e: "Nombre o razón social", t: "texto", req: true, lista: true },
      { n: "tipo_documento", e: "Tipo de documento", t: "opcion", req: true, ops: o("CC|Cédula de ciudadanía", "NIT|NIT", "CE|Cédula de extranjería", "PASAPORTE|Pasaporte") },
      { n: "numero_documento", e: "Número de documento", t: "texto", req: true, lista: true, ayuda: "Solo números; el NIT sin dígito de verificación" },
      { n: "digito_verificacion", e: "Dígito de verificación", t: "entero" },
      { n: "representante_nombre", e: "Representante legal", t: "texto", lista: true },
      { n: "representante_documento", e: "Cédula del representante", t: "texto" },
      { n: "representante_cargo", e: "Cargo del representante", t: "texto" },
      { n: "personeria_resolucion", e: "Personería jurídica (resolución)", t: "texto" },
      { n: "personeria_fecha", e: "Fecha de la personería", t: "fecha" },
      { n: "personeria_entidad", e: "Entidad que la otorga", t: "texto" },
      { n: "telefono", e: "Teléfono", t: "texto" },
      { n: "correo", e: "Correo", t: "texto" },
      { n: "direccion", e: "Dirección", t: "texto" },
      { n: "municipio", e: "Municipio", t: "texto", lista: true },
      { n: "departamento", e: "Departamento", t: "texto" },
      { n: "observaciones", e: "Observaciones", t: "parrafo", ancho: true },
    ],
  },
  cuentas: {
    tabla: "beneficiario_cuentas", titulo: "Cuentas bancarias", singular: "cuenta bancaria", grupo: "interno", nombre: "banco || ' ' || numero",
    buscar: ["banco", "numero", "titular"], orden: "creado_en", editan: ["administrador", "coordinador", "financiero"], ven: ["administrador", "coordinador", "financiero"], borradoLogico: true,
    campos: [
      { n: "beneficiario_id", e: "Beneficiario", t: "ref", req: true, ref: { tabla: "beneficiarios", etiqueta: "nombre" } },
      { n: "banco", e: "Banco", t: "texto", req: true, lista: true },
      { n: "tipo_cuenta", e: "Tipo", t: "opcion", req: true, lista: true, ops: o("ahorros|Ahorros", "corriente|Corriente") },
      { n: "numero", e: "Número", t: "texto", req: true, lista: true },
      { n: "titular", e: "Titular", t: "texto", req: true, lista: true },
      { n: "titular_documento", e: "Documento del titular", t: "texto" },
      { n: "principal", e: "Cuenta principal", t: "si_no" },
    ],
  },
  predios: {
    tabla: "predios", titulo: "Predios", singular: "predio", grupo: "Gestión", nombre: "nombre",
    buscar: ["nombre", "fmi", "codigo_catastral", "vereda", "municipio"], orden: "nombre", editan: COORD, ven: OFICINA, borradoLogico: true,
    hijas: [
      { modulo: "titulares", fk: "predio_id", titulo: "Titulares" },
      { modulo: "areas_fuente", fk: "predio_id", titulo: "Áreas según cada fuente" },
      { modulo: "asignaciones", fk: "predio_id", titulo: "Funcionarios de campo asignados" },
    ],
    campos: [
      { n: "nombre", e: "Nombre del predio", t: "texto", req: true, lista: true },
      { n: "fmi", e: "Matrícula inmobiliaria (FMI)", t: "texto", lista: true, ayuda: "Formato 000-12345" },
      { n: "codigo_catastral", e: "Código catastral", t: "texto", ayuda: "30 dígitos" },
      { n: "vereda", e: "Vereda", t: "texto", lista: true },
      { n: "municipio", e: "Municipio", t: "texto", req: true, lista: true },
      { n: "departamento", e: "Departamento", t: "texto" },
      { n: "altitud_min", e: "Altitud mínima (msnm)", t: "numero" },
      { n: "altitud_max", e: "Altitud máxima (msnm)", t: "numero" },
      { n: "area_total_ha", e: "Área total (ha)", t: "numero", lista: true, ayuda: "En hectáreas. 10.000 m² = 1 ha" },
      { n: "area_conservacion_ha", e: "Área en conservación (ha)", t: "numero", lista: true },
      { n: "area_poligono_ha", e: "Área del polígono (ha)", t: "numero", soloLectura: true },
      { n: "zona_id", e: "Zona de conservación", t: "ref", ref: { tabla: "zonas_conservacion", etiqueta: "nombre" } },
      { n: "escritura_numero", e: "Escritura pública (número)", t: "texto" },
      { n: "escritura_fecha", e: "Fecha de la escritura", t: "fecha" },
      { n: "escritura_notaria", e: "Notaría", t: "texto" },
      { n: "regimen_tenencia", e: "Régimen de tenencia", t: "opcion", ops: TENENCIA },
      { n: "clasificacion_pot", e: "Clasificación en PBOT/POT", t: "parrafo", ancho: true },
      { n: "ecosistema_estrategico", e: "Ecosistema estratégico", t: "texto" },
      { n: "infraestructura", e: "Infraestructura", t: "texto" },
      { n: "uso_permitido", e: "Uso permitido", t: "parrafo" },
      { n: "uso_prohibido", e: "Uso prohibido", t: "parrafo" },
      { n: "situacion_juridica", e: "Situación jurídica", t: "parrafo" },
      { n: "alertas_juridicas", e: "Alertas jurídicas", t: "parrafo" },
      { n: "observaciones", e: "Observaciones", t: "parrafo", ancho: true },
    ],
  },
  titulares: {
    tabla: "predio_titulares", titulo: "Titulares", singular: "titular", grupo: "interno", nombre: "tenencia::text",
    buscar: [], orden: "creado_en", editan: COORD, ven: OFICINA,
    campos: [
      { n: "predio_id", e: "Predio", t: "ref", req: true, ref: { tabla: "predios", etiqueta: "nombre" } },
      { n: "beneficiario_id", e: "Beneficiario", t: "ref", req: true, lista: true, ref: { tabla: "beneficiarios", etiqueta: "nombre" } },
      { n: "tenencia", e: "Tenencia", t: "opcion", req: true, lista: true, ops: TENENCIA },
      { n: "porcentaje", e: "Porcentaje", t: "numero", lista: true },
      { n: "principal", e: "Titular principal", t: "si_no", lista: true },
    ],
  },
  asignaciones: {
    tabla: "predio_asignaciones", titulo: "Funcionarios asignados", singular: "asignación", grupo: "interno", nombre: "'Asignación'",
    buscar: [], orden: "asignado_en", editan: COORD, ven: OFICINA,
    campos: [
      { n: "predio_id", e: "Predio", t: "ref", req: true, ref: { tabla: "predios", etiqueta: "nombre" } },
      { n: "funcionario_id", e: "Funcionario", t: "ref", req: true, lista: true, ref: { tabla: "perfiles", etiqueta: "nombre" }, ayuda: "Verá este predio en la app de campo" },
    ],
  },
  areas_fuente: {
    tabla: "predio_areas_fuente", titulo: "Áreas según cada fuente", singular: "área de fuente", grupo: "interno", nombre: "fuente",
    buscar: [], orden: "creado_en", editan: COORD, ven: OFICINA,
    campos: [
      { n: "predio_id", e: "Predio", t: "ref", req: true, ref: { tabla: "predios", etiqueta: "nombre" } },
      { n: "concepto", e: "Concepto", t: "opcion", req: true, lista: true, ops: o("total|Área total", "conservacion|Área en conservación") },
      { n: "fuente", e: "Fuente", t: "texto", req: true, lista: true, ayuda: "Escritura, certificado de tradición, levantamiento…" },
      { n: "valor", e: "Valor tal como aparece", t: "numero", req: true, lista: true },
      { n: "unidad", e: "Unidad", t: "opcion", req: true, lista: true, ops: o("ha|Hectáreas", "m2|Metros cuadrados") },
      { n: "valor_ha", e: "Equivale a (ha)", t: "numero", lista: true, soloLectura: true },
    ],
  },
  acuerdos: {
    tabla: "acuerdos", titulo: "Acuerdos", singular: "acuerdo", grupo: "Gestión", nombre: "coalesce(codigo, 'Acuerdo sin código')",
    buscar: ["codigo", "compromisos", "observaciones"], orden: "creado_en desc", editan: COORD, ven: OFICINA, borradoLogico: true,
    hijas: [{ modulo: "prorrogas", fk: "acuerdo_id", titulo: "Prórrogas" }],
    campos: [
      { n: "codigo", e: "Código", t: "texto", lista: true },
      { n: "estado", e: "Estado", t: "opcion", req: true, lista: true, ops: o("borrador|Borrador", "activo|Activo", "suspendido|Suspendido", "terminado|Terminado", "incumplido|Incumplido") },
      { n: "convenio_id", e: "Convenio", t: "ref", req: true, lista: true, ref: { tabla: "convenios", etiqueta: "numero" } },
      { n: "beneficiario_id", e: "Beneficiario", t: "ref", req: true, lista: true, ref: { tabla: "beneficiarios", etiqueta: "nombre" } },
      { n: "predio_id", e: "Predio", t: "ref", req: true, lista: true, ref: { tabla: "predios", etiqueta: "nombre" } },
      { n: "modalidad", e: "Modalidad", t: "opcion", req: true, lista: true, ops: MODALIDAD },
      { n: "fecha_firma", e: "Fecha de firma", t: "fecha" },
      { n: "fecha_inicio", e: "Fecha de inicio", t: "fecha" },
      { n: "fecha_fin", e: "Fin de la vigencia", t: "fecha", lista: true },
      { n: "area_ha", e: "Área (ha)", t: "numero", lista: true },
      { n: "valor_ha_anio", e: "Valor por ha al año", t: "moneda" },
      { n: "valor_total", e: "Valor total", t: "moneda", lista: true },
      { n: "periodicidad", e: "Periodicidad del pago", t: "opcion", ops: o("unico|Único", "mensual|Mensual", "trimestral|Trimestral", "semestral|Semestral", "anual|Anual") },
      { n: "compromisos", e: "Compromisos", t: "parrafo", ancho: true },
      { n: "observaciones", e: "Observaciones", t: "parrafo", ancho: true },
    ],
  },
  prorrogas: {
    tabla: "acuerdo_prorrogas", titulo: "Prórrogas", singular: "prórroga", grupo: "interno", nombre: "'Prórroga ' || numero",
    buscar: [], orden: "numero", editan: COORD, ven: OFICINA,
    campos: [
      { n: "acuerdo_id", e: "Acuerdo", t: "ref", req: true, ref: { tabla: "acuerdos", etiqueta: "coalesce(codigo, id::text)" } },
      { n: "numero", e: "Número", t: "entero", req: true, lista: true },
      { n: "fecha_firma", e: "Fecha de firma", t: "fecha", req: true, lista: true },
      { n: "nueva_fecha_fin", e: "Nueva fecha de terminación", t: "fecha", req: true, lista: true },
      { n: "valor_adicional", e: "Valor adicional", t: "moneda", lista: true },
      { n: "observaciones", e: "Observaciones", t: "parrafo", ancho: true },
    ],
  },
  pagos: {
    tabla: "pagos", titulo: "Pagos", singular: "pago", grupo: "Gestión", nombre: "'Pago ' || vigencia || ' cuota ' || numero_cuota",
    buscar: ["fuente_recursos", "observaciones"], orden: "fecha_programada desc", editan: ["administrador", "coordinador", "financiero"], ven: OFICINA, borradoLogico: true,
    campos: [
      { n: "acuerdo_id", e: "Acuerdo", t: "ref", req: true, lista: true, ref: { tabla: "acuerdos", etiqueta: "coalesce(codigo, id::text)" } },
      { n: "vigencia", e: "Vigencia (año)", t: "entero", req: true, lista: true },
      { n: "numero_cuota", e: "Cuota", t: "entero", req: true, lista: true },
      { n: "estado", e: "Estado", t: "opcion", req: true, lista: true, ops: o("pendiente|Pendiente", "pagado|Pagado", "retenido_incumplimiento|Retenido por incumplimiento", "anulado|Anulado") },
      { n: "valor_programado", e: "Valor programado", t: "moneda", req: true, lista: true },
      { n: "fecha_programada", e: "Fecha programada", t: "fecha", req: true, lista: true },
      { n: "valor_pagado", e: "Valor pagado", t: "moneda", lista: true },
      { n: "fecha_pago", e: "Fecha real de pago", t: "fecha", lista: true },
      { n: "retenciones", e: "Retenciones", t: "moneda" },
      { n: "fuente_recursos", e: "Fuente de recursos", t: "texto" },
      { n: "observaciones", e: "Observaciones", t: "parrafo", ancho: true },
    ],
  },
  zonas: {
    tabla: "zonas_conservacion", titulo: "Zonas de conservación", singular: "zona", grupo: "Territorio", nombre: "nombre",
    buscar: ["nombre", "tipo", "cuenca", "acueducto", "ecosistema"], orden: "nombre", editan: COORD, ven: OFICINA, borradoLogico: true,
    campos: [
      { n: "nombre", e: "Nombre", t: "texto", req: true, lista: true },
      { n: "tipo", e: "Tipo", t: "texto", req: true, lista: true, ayuda: "Microcuenca abastecedora, área de recarga, corredor…" },
      { n: "cuenca", e: "Cuenca", t: "texto", lista: true },
      { n: "acueducto", e: "Acueducto", t: "texto", lista: true },
      { n: "ecosistema", e: "Ecosistema", t: "texto", lista: true },
      { n: "prioridad", e: "Prioridad (1 a 5)", t: "entero", lista: true },
      { n: "area_ha", e: "Área del polígono (ha)", t: "numero", lista: true, soloLectura: true },
      { n: "observaciones", e: "Observaciones", t: "parrafo", ancho: true },
    ],
  },
  costos: {
    tabla: "costo_oportunidad", titulo: "Costo de oportunidad", singular: "costo de oportunidad", grupo: "Territorio", nombre: "uso_suelo || ' v' || version",
    buscar: ["uso_suelo", "fuente", "justificacion"], orden: "zona_id, uso_suelo, version desc", editan: COORD, ven: OFICINA, borradoLogico: true,
    campos: [
      { n: "zona_id", e: "Zona", t: "ref", req: true, lista: true, ref: { tabla: "zonas_conservacion", etiqueta: "nombre" } },
      { n: "uso_suelo", e: "Uso del suelo", t: "texto", req: true, lista: true },
      { n: "aplicacion", e: "Aplicación", t: "opcion", req: true, lista: true, ops: o("aplica|Aplica", "no_aplica|No aplica", "valor_especial|Valor especial") },
      { n: "valor_ha_anio", e: "Valor por ha al año", t: "moneda", lista: true, ayuda: "Vacío si no aplica" },
      { n: "justificacion", e: "Justificación", t: "parrafo", ancho: true, ayuda: "Obligatoria si no aplica o es valor especial" },
      { n: "fuente", e: "Fuente", t: "texto" },
      { n: "fecha_calculo", e: "Fecha de cálculo", t: "fecha", req: true },
      { n: "anio_base", e: "Año base de los precios", t: "entero", req: true, lista: true },
      { n: "version", e: "Versión", t: "entero", req: true, lista: true },
      { n: "vigente_desde", e: "Vigente desde", t: "fecha", req: true },
      { n: "vigente_hasta", e: "Vigente hasta", t: "fecha" },
      { n: "reajuste_ipc", e: "Se reajusta por IPC", t: "si_no" },
      { n: "estado", e: "Estado", t: "opcion", req: true, lista: true, ops: o("borrador|Borrador", "vigente|Vigente", "reemplazado|Reemplazado", "anulado|Anulado") },
    ],
  },
  ipc: {
    tabla: "ipc_anual", titulo: "IPC anual", singular: "año de IPC", grupo: "Catálogos", pk: "anio", nombre: "anio::text",
    buscar: ["fuente"], orden: "anio desc", editan: COORD, ven: OFICINA,
    campos: [
      { n: "anio", e: "Año", t: "entero", req: true, lista: true },
      { n: "variacion_pct", e: "Variación anual (%)", t: "numero", req: true, lista: true },
      { n: "es_proyectado", e: "Es una proyección", t: "si_no", lista: true },
      { n: "fuente", e: "Fuente", t: "texto", lista: true, ayuda: "Ej. DANE, boletín técnico" },
    ],
  },
};

const AMBITO = o("beneficiario|Beneficiario", "predio|Predio", "acuerdo|Acuerdo");

Object.assign(MODULOS, {
  diagnosticos: {
    tabla: "diagnosticos", titulo: "Diagnósticos", singular: "diagnóstico", grupo: "Expedientes", nombre: "formato_codigo",
    buscar: ["elaboro", "area_estudio", "antecedentes_legales"], orden: "creado_en desc", editan: COORD, ven: OFICINA, borradoLogico: true,
    hijas: [{ modulo: "especies", fk: "diagnostico_id", titulo: "Flora y fauna" }],
    campos: [
      { n: "predio_id", e: "Predio", t: "ref", req: true, lista: true, ref: { tabla: "predios", etiqueta: "nombre" } },
      { n: "estado", e: "Estado", t: "opcion", req: true, lista: true, ops: o("borrador|Borrador", "en_revision|En revisión", "aprobado|Aprobado") },
      { n: "acuerdo_id", e: "Acuerdo (opcional)", t: "ref", ref: { tabla: "acuerdos", etiqueta: "coalesce(codigo, id::text)" } },
      { n: "formato_codigo", e: "Código del formato", t: "texto", req: true, lista: true },
      { n: "formato_version", e: "Versión del formato", t: "texto", lista: true },
      { n: "formato_fecha", e: "Fecha del formato", t: "fecha" },
      { n: "elaboro", e: "Elaboró", t: "texto", lista: true }, { n: "elaboro_fecha", e: "Fecha de elaboración", t: "fecha", lista: true },
      { n: "reviso", e: "Revisó", t: "texto" }, { n: "reviso_fecha", e: "Fecha de revisión", t: "fecha" },
      { n: "aprobo", e: "Aprobó", t: "texto" }, { n: "aprobo_fecha", e: "Fecha de aprobación", t: "fecha" },
      { n: "antecedentes_legales", e: "1. Antecedentes legales", t: "parrafo", ancho: true },
      { n: "identificacion_juridica", e: "2. Identificación jurídica", t: "parrafo", ancho: true, ayuda: "Si se deja vacío, el documento la arma con los datos del predio y sus titulares." },
      { n: "area_estudio", e: "3. Área de estudio", t: "parrafo", ancho: true },
      { n: "contexto_ecosistemico", e: "4. Contexto ecosistémico", t: "parrafo", ancho: true },
      { n: "uso_suelo", e: "5. Uso del suelo", t: "parrafo", ancho: true },
      { n: "importancia_ambiental", e: "7. Importancia ambiental", t: "parrafo", ancho: true },
      { n: "potencial_conservacion", e: "8. Potencial de conservación", t: "parrafo", ancho: true },
    ],
  },
  especies: {
    tabla: "diagnostico_especies", titulo: "Flora y fauna", singular: "especie", grupo: "interno", nombre: "nombre_comun",
    buscar: [], orden: "grupo, orden, nombre_comun", editan: COORD, ven: OFICINA,
    campos: [
      { n: "diagnostico_id", e: "Diagnóstico", t: "ref", req: true, ref: { tabla: "diagnosticos", etiqueta: "formato_codigo" } },
      { n: "grupo", e: "Grupo", t: "opcion", req: true, lista: true, ops: o("flora|Flora", "fauna|Fauna") },
      { n: "nombre_comun", e: "Nombre común", t: "texto", req: true, lista: true },
      { n: "nombre_cientifico", e: "Nombre científico", t: "texto", lista: true },
      { n: "familia", e: "Familia", t: "texto", lista: true },
      { n: "categoria_amenaza", e: "Categoría de amenaza", t: "texto" },
      { n: "taxonomia_valida", e: "Nombre científico verificado", t: "si_no", lista: true, soloLectura: true },
      { n: "taxonomia_nombre_aceptado", e: "Resultado de la verificación", t: "texto", lista: true, soloLectura: true },
    ],
  },
  tipos_documento: {
    tabla: "tipos_documento", titulo: "Tipos de documento", singular: "tipo de documento", grupo: "Expedientes", nombre: "nombre",
    buscar: ["codigo", "nombre"], orden: "ambito, nombre", editan: COORD, ven: OFICINA,
    campos: [
      { n: "codigo", e: "Código", t: "texto", req: true, lista: true },
      { n: "nombre", e: "Nombre", t: "texto", req: true, lista: true },
      { n: "ambito", e: "Pertenece al expediente de", t: "opcion", req: true, lista: true, ops: AMBITO },
      { n: "vigencia_dias", e: "Vigencia (días)", t: "entero", lista: true, ayuda: "Ej. 30 para el certificado de tradición. Vacío = no vence." },
      { n: "activo", e: "Activo", t: "si_no", lista: true },
    ],
  },
  listas: {
    tabla: "listas_chequeo", titulo: "Plantillas de chequeo", singular: "lista de chequeo", grupo: "Expedientes", nombre: "nombre",
    buscar: ["nombre"], orden: "ambito, nombre", editan: COORD, ven: OFICINA,
    hijas: [{ modulo: "lista_items", fk: "lista_id", titulo: "Documentos exigidos" }],
    campos: [
      { n: "nombre", e: "Nombre", t: "texto", req: true, lista: true },
      { n: "ambito", e: "Expediente", t: "opcion", req: true, lista: true, ops: AMBITO },
      { n: "modalidad", e: "Solo para la modalidad", t: "opcion", lista: true, ops: MODALIDAD },
      { n: "tipo_beneficiario", e: "Solo para beneficiarios de tipo", t: "opcion", lista: true, ops: o("persona_natural|Persona natural", "jac|Junta de Acción Comunal", "asociacion_acueducto|Asociación de acueducto", "comunidad_etnica|Comunidad étnica", "entidad|Entidad") },
      { n: "activa", e: "Activa", t: "si_no", lista: true },
    ],
  },
  lista_items: {
    tabla: "lista_chequeo_items", titulo: "Documentos exigidos", singular: "documento exigido", grupo: "interno", nombre: "orden::text",
    buscar: [], orden: "orden", editan: COORD, ven: OFICINA,
    campos: [
      { n: "lista_id", e: "Lista", t: "ref", req: true, ref: { tabla: "listas_chequeo", etiqueta: "nombre" } },
      { n: "tipo_documento_id", e: "Documento", t: "ref", req: true, lista: true, ref: { tabla: "tipos_documento", etiqueta: "nombre" } },
      { n: "obligatorio", e: "Obligatorio", t: "si_no", lista: true },
      { n: "orden", e: "Orden", t: "entero", lista: true },
      { n: "ayuda", e: "Indicaciones", t: "texto", ancho: true },
    ],
  },
} satisfies Record<string, Modulo>);

export const etiquetaOpcion = (campo: Campo, valor: unknown) => campo.ops?.find(([v]) => v === String(valor))?.[1] ?? String(valor ?? "");
