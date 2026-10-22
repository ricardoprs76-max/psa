import "server-only";
import * as XLSX from "xlsx";
import { guardarArchivo, leerArchivo } from "./archivos";
import { calcular, PARAMETROS_INICIALES, type Parametros, type Resultado } from "./calculo";
import { comoUsuario, q, q1, type Fila } from "./db";
import { analizarSolicitud, type DatosExtraidos } from "./ia";
import { generarRespuesta, type DatosRespuesta } from "./respuesta";
import type { Usuario } from "./sesion";

const hoy = () => new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long", year: "numeric" });

async function siguienteConsecutivo(): Promise<string> {
  const anio = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }).slice(0, 4);
  const n = await q1<{ n: number }>("select count(*)::int + 1 as n from proyecciones where consecutivo like $1", [`PRY-${anio}-%`]);
  return `PRY-${anio}-${String(n!.n).padStart(4, "0")}`;
}

// ---------- Validaciones de calidad sobre lo extraído o digitado ----------

export type Aviso = { campo: string; nivel: "error" | "advertencia"; mensaje: string };

export async function validarDatos(d: Partial<DatosExtraidos>): Promise<Aviso[]> {
  const avisos: Aviso[] = [];
  const fecha = d.fecha_solicitud ? new Date(d.fecha_solicitud) : null;
  if (d.fecha_solicitud && (!fecha || Number.isNaN(fecha.getTime()))) avisos.push({ campo: "fecha_solicitud", nivel: "error", mensaje: "La fecha no es válida (AAAA-MM-DD)." });
  else if (fecha && fecha.getTime() > Date.now() + 86_400_000) avisos.push({ campo: "fecha_solicitud", nivel: "error", mensaje: "La fecha de la solicitud es posterior a hoy." });
  if (d.area_ha != null && d.area_ha > 5000) avisos.push({ campo: "area_ha", nivel: "advertencia", mensaje: `Un área de ${d.area_ha} ha es muy grande: revisa si son metros cuadrados (${(d.area_ha / 10000).toFixed(4)} ha).` });
  if (d.area_ha != null && d.area_ha <= 0) avisos.push({ campo: "area_ha", nivel: "error", mensaje: "El área debe ser mayor que cero." });
  const sumaPredios = (d.predios ?? []).reduce((s, p) => s + (p.area_ha ?? 0), 0);
  if (d.area_ha != null && sumaPredios > 0 && Math.abs(sumaPredios - d.area_ha) / d.area_ha > 0.05) {
    avisos.push({ campo: "area_ha", nivel: "advertencia", mensaje: `El área total (${d.area_ha} ha) no coincide con la suma de los predios (${sumaPredios.toFixed(4)} ha).` });
  }
  for (const [i, p] of (d.predios ?? []).entries()) {
    const quien = p.nombre || `Predio ${i + 1}`;
    if (p.fmi && !/^[0-9]{3}-[0-9]{1,8}$/.test(p.fmi)) avisos.push({ campo: `predio_${i}_fmi`, nivel: "error", mensaje: `${quien}: la matrícula "${p.fmi}" no tiene el formato 000-12345.` });
    if (p.codigo_catastral && !/^[0-9]{30}$/.test(p.codigo_catastral)) avisos.push({ campo: `predio_${i}_catastral`, nivel: "error", mensaje: `${quien}: el código catastral tiene ${p.codigo_catastral.replace(/\D/g, "").length} dígitos y deben ser 30.` });
    if (p.area_ha != null && p.area_ha > 5000) avisos.push({ campo: `predio_${i}_area`, nivel: "advertencia", mensaje: `${quien}: ${p.area_ha} ha parece estar en metros cuadrados.` });
    // Contraste con lo que ya está registrado
    if (p.fmi) {
      const reg = await q1<Fila>("select nombre, municipio, vereda, area_total_ha from predios where fmi = $1 and eliminado_en is null", [p.fmi]);
      if (reg) {
        if (p.nombre && reg.nombre.toLowerCase() !== p.nombre.toLowerCase()) avisos.push({ campo: `predio_${i}_nombre`, nivel: "advertencia", mensaje: `La matrícula ${p.fmi} está registrada como "${reg.nombre}", no como "${p.nombre}".` });
        if (p.area_ha != null && reg.area_total_ha && Math.abs(Number(reg.area_total_ha) - p.area_ha) / Number(reg.area_total_ha) > 0.05) avisos.push({ campo: `predio_${i}_area`, nivel: "advertencia", mensaje: `${quien}: el área de la solicitud (${p.area_ha} ha) difiere de la registrada (${reg.area_total_ha} ha).` });
      }
    }
  }
  return avisos;
}

// ---------- Creación ----------

/** Crea la proyección a partir de un PDF: guarda el original, lo lee con IA y deja todo listo para la revisión humana. */
export async function crearDesdePdf(nombre: string, pdf: Buffer, usuario: Usuario): Promise<string> {
  const ruta = await guardarArchivo("solicitudes", nombre, pdf);
  const { datos, modelo } = await analizarSolicitud(pdf);
  return comoUsuario(usuario.id, async () => {
    const fila = await q1<{ id: string }>(
      `insert into proyecciones (consecutivo, origen, solicitante, solicitante_documento, radicado, fecha_solicitud, asunto, municipio, vereda, area_ha, anios,
         solicitud_pdf_ruta, datos_extraidos, modelo_ia, texto_fuente, creado_por)
       values ($1, 'solicitud_ia', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
      [await siguienteConsecutivo(), datos.solicitante ?? "[PENDIENTE]", datos.solicitante_documento, datos.radicado, fechaValida(datos.fecha_solicitud), datos.asunto,
        datos.municipio, datos.vereda, datos.area_ha && datos.area_ha > 0 ? datos.area_ha : null, datos.anios && datos.anios >= 1 && datos.anios <= 50 ? Math.round(datos.anios) : null,
        ruta, JSON.stringify(datos), modelo, datos.resumen, usuario.id],
    );
    for (const p of datos.predios) await insertarPredio(fila!.id, p);
    return fila!.id;
  });
}

const fechaValida = (f: string | null | undefined) => (f && /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(new Date(f).getTime()) ? f : null);

async function insertarPredio(proyeccionId: string, p: DatosExtraidos["predios"][number]) {
  const registrado = p.fmi ? await q1<{ id: string }>("select id from predios where fmi = $1 and eliminado_en is null", [p.fmi]) : null;
  await q("insert into proyeccion_predios (proyeccion_id, predio_id, nombre, fmi, codigo_catastral, vereda, municipio, area_ha) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [proyeccionId, registrado?.id ?? null, p.nombre, p.fmi, p.codigo_catastral, p.vereda, p.municipio, p.area_ha && p.area_ha > 0 ? p.area_ha : null]);
}

export async function crearManual(usuario: Usuario): Promise<string> {
  return comoUsuario(usuario.id, async () =>
    (await q1<{ id: string }>("insert into proyecciones (consecutivo, origen, solicitante, creado_por) values ($1, 'manual', '[PENDIENTE]', $2) returning id", [await siguienteConsecutivo(), usuario.id]))!.id);
}

/** Importa una proyección histórica desde Excel: guarda el archivo y su texto completo para poder encontrarla después. */
export async function importarExcel(nombre: string, archivo: Buffer, usuario: Usuario): Promise<string> {
  const libro = XLSX.read(archivo, { type: "buffer" });
  const texto = libro.SheetNames.map((hoja) => `## ${hoja}\n` + XLSX.utils.sheet_to_csv(libro.Sheets[hoja], { blankrows: false })).join("\n\n").slice(0, 200_000);
  const ruta = await guardarArchivo("proyecciones_historicas", nombre, archivo);
  return comoUsuario(usuario.id, async () =>
    (await q1<{ id: string }>(
      `insert into proyecciones (consecutivo, origen, solicitante, asunto, estado, archivo_origen_ruta, archivo_origen_nombre, texto_fuente, creado_por)
       values ($1, 'importada_excel', '[PENDIENTE]', $2, 'aprobada', $3, $4, $5, $6) returning id`,
      [`HIST-${Date.now().toString(36).toUpperCase()}`, nombre.replace(/\.[^.]+$/, ""), ruta, nombre, texto, usuario.id]))!.id);
}

// ---------- Búsqueda de proyecciones parecidas ----------

export type Parecida = { id: string; consecutivo: string; solicitante: string; fecha: string | null; valor_total: string | null; origen: string; puntaje: number; motivos: string[] };

/** Las proyecciones ya aprobadas más parecidas a la indicada, con el puntaje (0–100) y por qué coinciden. */
export async function buscarParecidas(id: string, limite = 5): Promise<Parecida[]> {
  const base = await q1<Fila>("select * from proyecciones where id = $1", [id]);
  if (!base) return [];
  const fmis = (await q<{ fmi: string }>("select fmi from proyeccion_predios where proyeccion_id = $1 and fmi is not null", [id])).map((r) => r.fmi);
  const consulta = [base.municipio, base.vereda, base.asunto, base.solicitante === "[PENDIENTE]" ? "" : base.solicitante, ...fmis].filter(Boolean).join(" ");
  const candidatas = await q<Fila>(
    `select p.id, p.consecutivo, p.solicitante, p.fecha_solicitud::text as fecha, p.valor_total::text, p.origen::text, p.municipio, p.vereda, p.zona_id, p.area_ha, p.anios,
            coalesce(word_similarity(unaccent(lower($2)), unaccent(lower(coalesce(p.texto_fuente, '') || ' ' || coalesce(p.asunto, '')))), 0) as texto,
            exists (select 1 from proyeccion_predios pp where pp.proyeccion_id = p.id and pp.fmi = any($3::text[])) as mismo_predio
     from proyecciones p
     where p.id <> $1 and p.eliminado_en is null and p.estado in ('aprobada', 'enviada')`, [id, consulta, fmis]);
  const igual = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  return candidatas.map((c) => {
    const motivos: string[] = [];
    let puntos = 0;
    if (c.mismo_predio) { puntos += 30; motivos.push("mismo predio (matrícula)"); }
    if (igual(c.municipio, base.municipio)) { puntos += 15; motivos.push(`mismo municipio (${c.municipio})`); }
    if (igual(c.vereda, base.vereda)) { puntos += 10; motivos.push(`misma vereda (${c.vereda})`); }
    if (c.zona_id && c.zona_id === base.zona_id) { puntos += 15; motivos.push("misma zona de conservación"); }
    if (c.area_ha && base.area_ha && Math.abs(Number(c.area_ha) - Number(base.area_ha)) / Number(base.area_ha) <= 0.3) { puntos += 10; motivos.push(`área parecida (${Number(c.area_ha)} ha)`); }
    if (c.anios && c.anios === base.anios) { puntos += 5; motivos.push(`mismos años (${c.anios})`); }
    const texto = Math.round(Number(c.texto) * 15);
    if (texto >= 4) { puntos += texto; motivos.push("texto parecido"); }
    return { id: c.id, consecutivo: c.consecutivo, solicitante: c.solicitante, fecha: c.fecha, valor_total: c.valor_total, origen: c.origen, puntaje: Math.min(puntos, 100), motivos };
  }).filter((c) => c.puntaje > 0).sort((a, b) => b.puntaje - a.puntaje).slice(0, limite);
}

// ---------- Cálculo ----------

export async function metodologiaVigente(): Promise<{ id: string | null; nombre: string; aprobada: boolean; parametros: Parametros }> {
  const m = await q1<Fila>("select id, nombre, version, parametros, aprobada_por from metodologias_calculo where vigente order by creado_en desc limit 1");
  if (!m) return { id: null, nombre: "Provisional (sin definir)", aprobada: false, parametros: PARAMETROS_INICIALES };
  return { id: m.id, nombre: `${m.nombre} v${m.version}`, aprobada: !!m.aprobada_por, parametros: { ...PARAMETROS_INICIALES, ...m.parametros } };
}

export async function tablaIpc(): Promise<Record<number, { pct: number; proyectado: boolean }>> {
  const filas = await q<Fila>("select anio, variacion_pct, es_proyectado from ipc_anual");
  return Object.fromEntries(filas.map((f) => [f.anio, { pct: Number(f.variacion_pct), proyectado: f.es_proyectado }]));
}

/** Calcula la proyección con el costo de oportunidad elegido y la guarda. Devuelve el resultado o el motivo por el que no se pudo. */
export async function calcularProyeccion(id: string, anioInicio: number, usuario: Usuario): Promise<Resultado | { error: string }> {
  const pr = await q1<Fila>("select * from proyecciones where id = $1", [id]);
  if (!pr) return { error: "La proyección no existe." };
  if (!pr.area_ha || !pr.anios) return { error: "Faltan el área y los años a proyectar." };
  if (!pr.costo_oportunidad_id) return { error: "Elige primero el costo de oportunidad." };
  const costo = await q1<Fila>("select * from costo_oportunidad where id = $1", [pr.costo_oportunidad_id]);
  if (!costo) return { error: "El costo de oportunidad ya no existe." };
  if (costo.aplicacion === "no_aplica") return { error: `Para este uso el costo de oportunidad no aplica: ${costo.justificacion}` };
  const m = await metodologiaVigente();
  const parametros: Parametros = costo.reajuste_ipc ? m.parametros : { ...m.parametros, reajuste: "ninguno" };
  const r = calcular({ area_ha: Number(pr.area_ha), valor_ha_anio: Number(costo.valor_ha_anio), anio_base: costo.anio_base, anio_inicio: anioInicio, anios: pr.anios, ipc: await tablaIpc() }, parametros);
  if (!m.aprobada) r.avisos.unshift("Metodología provisional: aún no ha sido aprobada contra las proyecciones históricas.");
  await comoUsuario(usuario.id, () => q(
    "update proyecciones set resultado = $2, valor_total = $3, reajuste = $4, metodologia_id = $5, zona_id = $6, escenario = $7 where id = $1",
    [id, JSON.stringify(r), r.total, JSON.stringify({ ...parametros, anio_inicio: anioInicio }), m.id, costo.zona_id, m.nombre]));
  return r;
}

// ---------- Documento y estados ----------

export async function generarDocumento(id: string, usuario: Usuario): Promise<string> {
  const pr = await q1<Fila>(
    `select p.*, p.fecha_solicitud::text as fecha_txt, z.nombre as zona, c.uso_suelo, c.valor_ha_anio, c.anio_base, c.aplicacion::text as aplicacion, c.justificacion,
            m.nombre as met_nombre, m.version as met_version, m.aprobada_por as met_aprobada
     from proyecciones p left join costo_oportunidad c on c.id = p.costo_oportunidad_id left join zonas_conservacion z on z.id = c.zona_id
     left join metodologias_calculo m on m.id = p.metodologia_id where p.id = $1`, [id]);
  if (!pr) throw new Error("La proyección no existe.");
  const predios = await q<Fila>("select nombre, fmi, codigo_catastral, vereda, municipio, area_ha from proyeccion_predios where proyeccion_id = $1 order by nombre", [id]);
  const referencias = await q<Fila>(
    `select r.consecutivo, r.solicitante, r.fecha_solicitud::text as fecha, r.valor_total, pr.motivo from proyeccion_referencias pr
     join proyecciones r on r.id = pr.referencia_id where pr.proyeccion_id = $1 and pr.incluida order by pr.puntaje desc`, [id]);
  const entidad = (await q1<{ valor: { nombre?: string } }>("select valor from configuracion where clave = 'entidad'"))?.valor?.nombre ?? "Sistema PSA";
  const resultado = pr.resultado as Resultado | null;
  const pendiente = (v: unknown) => (v === "[PENDIENTE]" ? null : (v as string | null));
  const datos: DatosRespuesta = {
    consecutivo: pr.consecutivo, fecha_hoy: hoy(), entidad,
    solicitante: pendiente(pr.solicitante), solicitante_documento: pr.solicitante_documento, radicado: pr.radicado, fecha_solicitud: pr.fecha_txt,
    asunto: pr.asunto, municipio: pr.municipio, vereda: pr.vereda, area_ha: pr.area_ha === null ? null : Number(pr.area_ha), anios: pr.anios,
    zona: pr.zona, uso_suelo: pr.uso_suelo, costo_ha_anio: pr.valor_ha_anio === null || pr.valor_ha_anio === undefined ? null : Number(pr.valor_ha_anio), anio_base: pr.anio_base,
    costo_aplicacion: pr.aplicacion, costo_justificacion: pr.justificacion,
    metodologia: pr.met_nombre ? `${pr.met_nombre} v${pr.met_version}` : pr.escenario, metodologia_aprobada: !!pr.met_aprobada,
    valor_total: pr.valor_total === null ? null : Number(pr.valor_total), avisos: resultado?.avisos ?? [],
    filas: (resultado?.filas ?? []).map((f) => ({ anio: f.anio, variacion: f.variacion_pct === null ? "—" : `${f.variacion_pct.toLocaleString("es-CO")} % (${f.origen})`, valor_ha: f.valor_ha, valor: f.valor })),
    predios: predios.map((p) => ({ ...p, area_ha: p.area_ha === null ? null : Number(p.area_ha) })) as DatosRespuesta["predios"],
    referencias: referencias.map((r) => ({ ...r, valor_total: r.valor_total === null ? null : Number(r.valor_total) })) as DatosRespuesta["referencias"],
  };
  const { archivo, plantilla } = await generarRespuesta(datos);
  const version = pr.documento_ruta ? pr.version + 1 : pr.version;
  const ruta = await guardarArchivo("respuestas", `${pr.consecutivo}_v${version}.docx`, archivo);
  await comoUsuario(usuario.id, async () => {
    await q("update proyecciones set documento_ruta = $2, version = $3 where id = $1", [id, ruta, version]);
    await q(
      `insert into proyeccion_versiones (proyeccion_id, version, estado, documento_ruta, contenido, comentario, creado_por) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (proyeccion_id, version) do update set documento_ruta = excluded.documento_ruta, contenido = excluded.contenido, comentario = excluded.comentario`,
      [id, version, pr.estado, ruta, JSON.stringify(datos), `Generado con: ${plantilla}`, usuario.id]);
  });
  return ruta;
}

const SIGUIENTE: Record<string, string[]> = { borrador: ["en_revision"], en_revision: ["borrador", "aprobada"], aprobada: ["en_revision", "enviada"], enviada: [] };

export async function cambiarEstado(id: string, nuevo: string, usuario: Usuario): Promise<void> {
  const pr = await q1<Fila>("select estado::text as estado, documento_ruta, extraccion_revisada_en, origen::text as origen from proyecciones where id = $1", [id]);
  if (!pr) throw new Error("La proyección no existe.");
  if (!SIGUIENTE[pr.estado]?.includes(nuevo)) throw new Error(`No se puede pasar de "${pr.estado}" a "${nuevo}".`);
  if (nuevo !== "borrador" && pr.origen === "solicitud_ia" && !pr.extraccion_revisada_en) throw new Error("Primero una persona debe revisar y aprobar los datos extraídos del PDF.");
  if ((nuevo === "aprobada" || nuevo === "enviada") && !pr.documento_ruta) throw new Error("Genera el documento de respuesta antes de aprobar.");
  if ((nuevo === "aprobada" || nuevo === "enviada") && !["administrador", "coordinador"].includes(usuario.rol)) throw new Error("Solo un coordinador o administrador puede aprobar o marcar como enviada.");
  await comoUsuario(usuario.id, () => q(
    `update proyecciones set estado = $2::estado_proyeccion,
       aprobada_por = case when $2 = 'aprobada' then $3::uuid else aprobada_por end, aprobada_en = case when $2 = 'aprobada' then now() else aprobada_en end,
       enviada_en = case when $2 = 'enviada' then now() else enviada_en end where id = $1`, [id, nuevo, usuario.id]));
}

export { leerArchivo };
