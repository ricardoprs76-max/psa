"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { guardarArchivo } from "@/lib/archivos";
import { PARAMETROS_INICIALES, type Parametros } from "@/lib/calculo";
import { eliminar, guardar, mensajeError } from "@/lib/crud";
import { comoUsuario, q, q1 } from "@/lib/db";
import { ErrorIA, probarIA } from "@/lib/ia";
import { buscarParecidas, calcularProyeccion, cambiarEstado, crearDesdePdf, crearManual, generarDocumento, importarExcel } from "@/lib/proyecciones";
import { revisarPlantilla } from "@/lib/respuesta";
import { anotarIntento, cerrarSesion, cifrar, claveCorrecta, claveRelleno, errorClaveNueva, exigir, fijarClaveComun, iniciarSesion, intentoPermitido, type Rol } from "@/lib/sesion";

/** Vuelve a la página indicada con un mensaje (ok o error) en la dirección. */
function volver(destino: string, tipo: "ok" | "error", mensaje: string): never {
  // Solo rutas internas: evita que un enlace manipulado saque a la persona a otro sitio.
  const ruta = destino.startsWith("/") && !destino.startsWith("//") ? destino : "/";
  redirect(`${ruta}${ruta.includes("?") ? "&" : "?"}${tipo}=${encodeURIComponent(mensaje)}`);
}

/** Next usa una excepción especial para redirigir; no es un error de verdad y hay que dejarla pasar. */
const esRedireccion = (e: unknown) => typeof (e as { digest?: string })?.digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_REDIRECT");

const texto = (f: FormData, n: string) => String(f.get(n) ?? "").trim();
const COORD: Rol[] = ["administrador", "coordinador"];

// ---------- Acceso ----------

export async function ingresar(f: FormData) {
  const correo = texto(f, "correo").toLowerCase();
  const clave = String(f.get("clave") ?? "");
  if (!intentoPermitido(correo)) volver("/ingresar", "error", "Demasiados intentos fallidos. Espera 15 minutos y vuelve a intentar.");
  // La contraseña es la misma para todos; quién entra lo decide el correo, que debe ser el de un usuario activo.
  const u = (await claveCorrecta(clave))
    ? await q1<{ id: string }>("select u.id from auth.users u join perfiles p on p.id = u.id where lower(u.email) = $1 and p.activo", [correo])
    : null;
  anotarIntento(correo, !!u);
  if (!u) volver("/ingresar", "error", "Correo o contraseña incorrectos.");
  await iniciarSesion(u.id);
  redirect("/");
}

/** Primer arranque: crea la cuenta del administrador. Solo funciona mientras no exista ningún usuario. */
export async function crearPrimerAdministrador(f: FormData) {
  const hay = await q1<{ n: number }>("select count(*)::int as n from auth.users");
  if (hay!.n > 0) volver("/ingresar", "error", "Ya existe un administrador.");
  const [nombre, correo] = [texto(f, "nombre"), texto(f, "correo").toLowerCase()];
  if (!nombre || !/^\S+@\S+\.\S+$/.test(correo)) volver("/ingresar", "error", "Escribe tu nombre y un correo válido.");
  const fallo = errorClaveNueva(String(f.get("clave") ?? ""), String(f.get("clave2") ?? ""));
  if (fallo) volver("/ingresar", "error", fallo);
  const u = await q1<{ id: string }>("insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values (gen_random_uuid(), $1, crypt($2, gen_salt('bf', 10)), $3) returning id", [correo, claveRelleno(), JSON.stringify({ nombre })]);
  await q("update perfiles set rol = 'administrador', nombre = $2 where id = $1", [u!.id, nombre]);
  await fijarClaveComun(String(f.get("clave")), u!.id);
  await iniciarSesion(u!.id);
  redirect("/");
}

export async function salir() {
  await cerrarSesion();
  redirect("/ingresar");
}

// ---------- Usuarios ----------

export async function crearUsuario(f: FormData) {
  const yo = await exigir("administrador");
  const [nombre, correo, clave, rol] = [texto(f, "nombre"), texto(f, "correo").toLowerCase(), claveRelleno(), texto(f, "rol")];
  if (!nombre || !/^\S+@\S+\.\S+$/.test(correo)) volver("/ajustes", "error", "Escribe el nombre y un correo válido.");
  try {
    await comoUsuario(yo.id, async () => {
      const u = await q1<{ id: string }>("insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values (gen_random_uuid(), $1, crypt($2, gen_salt('bf', 10)), $3) returning id", [correo, clave, JSON.stringify({ nombre })]);
      await q("update perfiles set rol = $2::rol_usuario, nombre = $3 where id = $1", [u!.id, rol, nombre]);
    });
  } catch (e) { volver("/ajustes", "error", mensajeError(e)); }
  revalidatePath("/ajustes");
  volver("/ajustes", "ok", `Usuario ${correo} creado. Entra con su correo y la contraseña común.`);
}

/** Cambia la contraseña común de la plataforma y de la app de campo. Cierra las sesiones de todos, salvo la de quien la cambia. */
export async function cambiarClaveComun(f: FormData) {
  const yo = await exigir("administrador");
  const clave = String(f.get("clave") ?? "");
  const fallo = errorClaveNueva(clave, String(f.get("clave2") ?? ""));
  if (fallo) volver("/ajustes", "error", fallo);
  await fijarClaveComun(clave, yo.id);
  await iniciarSesion(yo.id);
  volver("/ajustes", "ok", "Contraseña común cambiada. Se cerraron las demás sesiones (web y app de campo): comparte la nueva contraseña con el equipo.");
}

export async function actualizarUsuario(f: FormData) {
  const yo = await exigir("administrador");
  const id = texto(f, "id");
  if (id === yo.id && (texto(f, "rol") !== "administrador" || f.get("activo") !== "on")) volver("/ajustes", "error", "No puedes quitarte a ti mismo el rol de administrador ni desactivarte.");
  await comoUsuario(yo.id, () => q("update perfiles set rol = $2::rol_usuario, activo = $3 where id = $1", [id, texto(f, "rol"), f.get("activo") === "on"]));
  revalidatePath("/ajustes");
  volver("/ajustes", "ok", "Usuario actualizado.");
}

// ---------- CRUD genérico ----------

export async function guardarRegistro(f: FormData) {
  const usuario = await exigir();
  const modulo = texto(f, "_modulo");
  const id = texto(f, "_id") || null;
  const regreso = texto(f, "_regreso") || `/m/${modulo}`;
  let nuevoId: string;
  try {
    nuevoId = await guardar(modulo, id, f, usuario);
  } catch (e) {
    volver(texto(f, "_aqui") || regreso, "error", mensajeError(e));
  }
  revalidatePath("/", "layout");
  volver(texto(f, "_regreso") || `/m/${modulo}/${nuevoId}`, "ok", "Guardado.");
}

export async function eliminarRegistro(f: FormData) {
  const usuario = await exigir();
  const modulo = texto(f, "_modulo");
  const regreso = texto(f, "_regreso") || `/m/${modulo}`;
  try {
    await eliminar(modulo, texto(f, "_id"), usuario);
  } catch (e) {
    volver(regreso, "error", mensajeError(e));
  }
  revalidatePath("/", "layout");
  volver(regreso, "ok", "Eliminado.");
}

export async function resolverAlerta(f: FormData) {
  const usuario = await exigir(...COORD);
  await q("update alertas_calidad set resuelta = true, resuelta_por = $2, resuelta_en = now(), nota_resolucion = $3 where id = $1", [texto(f, "id"), usuario.id, texto(f, "nota") || null]);
  revalidatePath("/alertas");
}

/** Publica una versión nueva del costo de oportunidad: la vigente pasa a "reemplazado" y queda como historial. */
export async function nuevaVersionCosto(f: FormData) {
  const usuario = await exigir(...COORD);
  const id = texto(f, "id");
  let nuevo: string;
  try {
    nuevo = await comoUsuario(usuario.id, async () => {
      const actual = await q1<Record<string, any>>("select * from costo_oportunidad where id = $1", [id]);
      if (!actual) throw new Error("El costo ya no existe.");
      await q("update costo_oportunidad set estado = 'reemplazado', vigente_hasta = current_date where id = $1 and estado = 'vigente'", [id]);
      const fila = await q1<{ id: string }>(
        `insert into costo_oportunidad (zona_id, uso_suelo, aplicacion, valor_ha_anio, justificacion, fuente, fecha_calculo, anio_base, version, vigente_desde, reajuste_ipc, estado, reemplaza_a, creado_por)
         select zona_id, uso_suelo, aplicacion, valor_ha_anio, justificacion, fuente, current_date, anio_base,
                (select max(version) + 1 from costo_oportunidad c2 where c2.zona_id = c.zona_id and c2.uso_suelo = c.uso_suelo), current_date, reajuste_ipc, 'borrador', id, $2
         from costo_oportunidad c where id = $1 returning id`, [id, usuario.id]);
      return fila!.id;
    });
  } catch (e) { volver(`/m/costos/${id}`, "error", mensajeError(e)); }
  volver(`/m/costos/${nuevo}`, "ok", "Versión nueva creada como borrador. Ajusta el valor y pásala a Vigente.");
}

// ---------- Mapa ----------

/** Guarda el polígono (GeoJSON) de un predio o de una zona, o crea una capa de referencia. */
export async function guardarGeometria(destino: "predios" | "zonas_conservacion" | "capas_referencia", id: string | null, geojson: string, extra?: { nombre: string; categoria: string }) {
  const usuario = await exigir(...COORD);
  const geom = "st_multi(st_collectionextract(st_makevalid(st_force2d(st_setsrid(st_geomfromgeojson($1), 4326))), 3))";
  try {
    await comoUsuario(usuario.id, async () => {
      if (destino === "capas_referencia") await q(`insert into capas_referencia (categoria, nombre, geom) values ($2, $3, ${geom})`, [geojson, extra?.categoria || "area_protegida", extra?.nombre || "Capa"]);
      else await q(`update ${destino === "predios" ? "predios" : "zonas_conservacion"} set geom = ${geom} where id = $2`, [geojson, id]);
    });
  } catch (e) { return { error: mensajeError(e) }; }
  revalidatePath("/mapa");
  return { ok: true };
}

export async function borrarGeometria(destino: "predios" | "zonas_conservacion" | "capas_referencia", id: string) {
  const usuario = await exigir(...COORD);
  await comoUsuario(usuario.id, () => q(destino === "capas_referencia" ? "delete from capas_referencia where id = $1" : `update ${destino === "predios" ? "predios" : "zonas_conservacion"} set geom = null where id = $1`, [id]));
  revalidatePath("/mapa");
  return { ok: true };
}

// ---------- Metodología de cálculo ----------

export async function guardarMetodologia(f: FormData) {
  const usuario = await exigir(...COORD);
  const p: Parametros = {
    reajuste: texto(f, "reajuste") as Parametros["reajuste"], ipc_de: texto(f, "ipc_de") as Parametros["ipc_de"], tasa_pct: Number(texto(f, "tasa_pct") || 0),
    ipc_faltante: texto(f, "ipc_faltante") as Parametros["ipc_faltante"], actualizar_base: f.get("actualizar_base") === "on", redondeo: texto(f, "redondeo") as Parametros["redondeo"],
  };
  const nombre = texto(f, "nombre") || "Metodología";
  const aprobar = f.get("aprobada") === "on";
  if (aprobar && usuario.rol !== "administrador" && usuario.rol !== "coordinador") volver("/calculadora", "error", "Solo coordinación puede aprobar la metodología.");
  await comoUsuario(usuario.id, async () => {
    await q("update metodologias_calculo set vigente = false where vigente");
    await q(
      `insert into metodologias_calculo (nombre, version, descripcion, parametros, vigente, aprobada_por)
       values ($1, coalesce((select max(version) + 1 from metodologias_calculo where nombre = $1), 1), $2, $3, true, $4)`,
      [nombre, texto(f, "descripcion") || null, JSON.stringify({ ...PARAMETROS_INICIALES, ...p }), aprobar ? usuario.id : null]);
  });
  volver("/calculadora", "ok", aprobar ? "Metodología guardada y marcada como aprobada." : "Metodología guardada como provisional.");
}

// ---------- Proyecciones ----------

const MAX_PDF = 30 * 1024 * 1024;

export async function subirSolicitud(f: FormData) {
  const usuario = await exigir(...COORD);
  const archivo = f.get("pdf");
  if (!(archivo instanceof File) || archivo.size === 0) volver("/proyecciones", "error", "Elige el PDF de la solicitud.");
  if (archivo.size > MAX_PDF) volver("/proyecciones", "error", "El PDF supera los 30 MB que admite el análisis.");
  const datos = Buffer.from(await archivo.arrayBuffer());
  if (datos.subarray(0, 5).toString() !== "%PDF-") volver("/proyecciones", "error", "El archivo no es un PDF.");
  let id: string;
  try {
    id = await crearDesdePdf(archivo.name, datos, usuario);
  } catch (e) {
    if (esRedireccion(e)) throw e;
    volver("/proyecciones", "error", e instanceof ErrorIA ? e.message : mensajeError(e));
  }
  redirect(`/proyecciones/${id}`);
}

export async function nuevaProyeccionManual() {
  const usuario = await exigir(...COORD);
  redirect(`/proyecciones/${await crearManual(usuario)}`);
}

export async function importarProyecciones(f: FormData) {
  const usuario = await exigir(...COORD);
  const archivos = f.getAll("excel").filter((a): a is File => a instanceof File && a.size > 0);
  if (!archivos.length) volver("/proyecciones", "error", "Elige al menos un archivo de Excel.");
  let hechos = 0;
  const fallidos: string[] = [];
  for (const a of archivos) {
    try { await importarExcel(a.name, Buffer.from(await a.arrayBuffer()), usuario); hechos++; } catch { fallidos.push(a.name); }
  }
  revalidatePath("/proyecciones");
  volver("/proyecciones", fallidos.length ? "error" : "ok", `${hechos} archivo(s) importado(s).` + (fallidos.length ? ` No se pudieron leer: ${fallidos.join(", ")}.` : " Completa en cada uno solicitante, área y valor para mejorar las búsquedas."));
}

/** Guarda lo que la persona revisó. Con "aprobar" queda constancia de quién aprobó la extracción. */
export async function guardarRevision(f: FormData) {
  const usuario = await exigir(...COORD);
  const id = texto(f, "id");
  const ruta = `/proyecciones/${id}`;
  const num = (n: string) => (texto(f, n) === "" ? null : Number(texto(f, n)));
  const datos = {
    solicitante: texto(f, "solicitante") || "[PENDIENTE]", solicitante_documento: texto(f, "solicitante_documento") || null, radicado: texto(f, "radicado") || null,
    fecha_solicitud: texto(f, "fecha_solicitud") || null, asunto: texto(f, "asunto") || null, municipio: texto(f, "municipio") || null, vereda: texto(f, "vereda") || null,
    area_ha: num("area_ha"), anios: num("anios"), costo_oportunidad_id: texto(f, "costo_oportunidad_id") || null,
  };
  const predios = f.getAll("predio_nombre").map((_, i) => ({
    nombre: String(f.getAll("predio_nombre")[i] ?? "").trim() || null, fmi: String(f.getAll("predio_fmi")[i] ?? "").trim() || null,
    codigo_catastral: String(f.getAll("predio_catastral")[i] ?? "").trim() || null, vereda: String(f.getAll("predio_vereda")[i] ?? "").trim() || null,
    municipio: String(f.getAll("predio_municipio")[i] ?? "").trim() || null, area_ha: String(f.getAll("predio_area")[i] ?? "").trim() === "" ? null : Number(f.getAll("predio_area")[i]),
  })).filter((p) => p.nombre || p.fmi || p.codigo_catastral);
  const aprobar = texto(f, "_accion") === "aprobar";
  try {
    // Una respuesta ya aprobada o enviada no se toca; las históricas importadas sí se pueden completar.
    const actual = await q1<{ estado: string; origen: string }>("select estado::text as estado, origen::text as origen from proyecciones where id = $1", [id]);
    if (!actual) throw new Error("La proyección no existe.");
    if (actual.origen !== "importada_excel" && !["borrador", "en_revision"].includes(actual.estado)) throw new Error("La proyección ya fue aprobada: reábrela a revisión para cambiarla.");
    if (datos.area_ha !== null && !(datos.area_ha > 0)) throw new Error("El área debe ser mayor que cero.");
    if (datos.anios !== null && !(datos.anios >= 1 && datos.anios <= 50)) throw new Error("Los años deben estar entre 1 y 50.");
    await comoUsuario(usuario.id, async () => {
      await q(
        `update proyecciones set solicitante = $2, solicitante_documento = $3, radicado = $4, fecha_solicitud = $5, asunto = $6, municipio = $7, vereda = $8, area_ha = $9, anios = $10,
           costo_oportunidad_id = $11, datos_revisados = $12,
           extraccion_revisada_por = case when $13 then $14::uuid else extraccion_revisada_por end, extraccion_revisada_en = case when $13 then now() else extraccion_revisada_en end
         where id = $1`,
        [id, datos.solicitante, datos.solicitante_documento, datos.radicado, datos.fecha_solicitud, datos.asunto, datos.municipio, datos.vereda, datos.area_ha, datos.anios,
          datos.costo_oportunidad_id, JSON.stringify({ ...datos, predios }), aprobar, usuario.id]);
      await q("delete from proyeccion_predios where proyeccion_id = $1", [id]);
      for (const p of predios) {
        const reg = p.fmi ? await q1<{ id: string }>("select id from predios where fmi = $1 and eliminado_en is null", [p.fmi]) : null;
        await q("insert into proyeccion_predios (proyeccion_id, predio_id, nombre, fmi, codigo_catastral, vereda, municipio, area_ha) values ($1, $2, $3, $4, $5, $6, $7, $8)",
          [id, reg?.id ?? null, p.nombre, p.fmi, p.codigo_catastral, p.vereda, p.municipio, p.area_ha]);
      }
    });
  } catch (e) { volver(ruta, "error", mensajeError(e)); }
  revalidatePath(ruta);
  volver(ruta, "ok", aprobar ? "Datos revisados y aprobados." : "Cambios guardados.");
}

/** Busca proyecciones parecidas y las deja propuestas (incluidas) para que la persona decida. */
export async function buscarReferencias(f: FormData) {
  const usuario = await exigir(...COORD);
  const id = texto(f, "id");
  const parecidas = await buscarParecidas(id);
  await comoUsuario(usuario.id, async () => {
    for (const p of parecidas) {
      await q(
        `insert into proyeccion_referencias (proyeccion_id, referencia_id, puntaje, motivo) values ($1, $2, $3, $4)
         on conflict (proyeccion_id, referencia_id) do update set puntaje = excluded.puntaje, motivo = excluded.motivo`, [id, p.id, p.puntaje, p.motivos.join("; ")]);
    }
  });
  revalidatePath(`/proyecciones/${id}`);
  volver(`/proyecciones/${id}`, parecidas.length ? "ok" : "error", parecidas.length ? `${parecidas.length} proyección(es) parecida(s) encontrada(s).` : "No hay proyecciones aprobadas comparables. Los datos sin referencia quedarán como [PENDIENTE].");
}

export async function alternarReferencia(f: FormData) {
  await exigir(...COORD);
  await q("update proyeccion_referencias set incluida = not incluida where proyeccion_id = $1 and referencia_id = $2", [texto(f, "id"), texto(f, "referencia")]);
  revalidatePath(`/proyecciones/${texto(f, "id")}`);
}

export async function calcularAccion(f: FormData) {
  const usuario = await exigir(...COORD);
  const id = texto(f, "id");
  const r = await calcularProyeccion(id, Number(texto(f, "anio_inicio")) || new Date().getFullYear(), usuario);
  revalidatePath(`/proyecciones/${id}`);
  if ("error" in r) volver(`/proyecciones/${id}`, "error", r.error);
  volver(`/proyecciones/${id}`, "ok", "Proyección calculada.");
}

export async function generarDocumentoAccion(f: FormData) {
  const usuario = await exigir(...COORD);
  const id = texto(f, "id");
  try { await generarDocumento(id, usuario); } catch (e) { volver(`/proyecciones/${id}`, "error", mensajeError(e)); }
  revalidatePath(`/proyecciones/${id}`);
  volver(`/proyecciones/${id}`, "ok", "Documento de respuesta generado. Descárgalo y revísalo en Word.");
}

export async function cambiarEstadoAccion(f: FormData) {
  const usuario = await exigir();
  const id = texto(f, "id");
  try { await cambiarEstado(id, texto(f, "estado"), usuario); } catch (e) { volver(`/proyecciones/${id}`, "error", mensajeError(e)); }
  revalidatePath(`/proyecciones/${id}`);
  volver(`/proyecciones/${id}`, "ok", "Estado actualizado.");
}

// ---------- Ajustes: clave de IA, plantillas, logo ----------

/** La clave la escribe un administrador; se guarda cifrada y nunca se vuelve a mostrar. */
export async function guardarClaveIA(f: FormData) {
  const usuario = await exigir("administrador");
  const clave = texto(f, "clave");
  const modelo = texto(f, "modelo");
  await comoUsuario(usuario.id, async () => {
    if (clave) {
      await q("insert into secretos (clave, valor_cifrado, actualizado_por) values ('anthropic_api_key', $1, $2) on conflict (clave) do update set valor_cifrado = excluded.valor_cifrado, actualizado_por = excluded.actualizado_por, actualizado_en = now()", [cifrar(clave), usuario.id]);
    }
    await q("insert into configuracion (clave, valor, actualizado_por) values ('ia', $1, $2) on conflict (clave) do update set valor = excluded.valor, actualizado_por = excluded.actualizado_por, actualizado_en = now()", [JSON.stringify({ modelo }), usuario.id]);
  });
  revalidatePath("/ajustes");
  volver("/ajustes", "ok", clave ? "Clave guardada (cifrada)." : "Modelo guardado.");
}

export async function borrarClaveIA() {
  await exigir("administrador");
  await q("delete from secretos where clave = 'anthropic_api_key'");
  revalidatePath("/ajustes");
  volver("/ajustes", "ok", "Clave eliminada. El análisis con IA queda desactivado.");
}

export async function probarClaveIA() {
  await exigir("administrador");
  let r: string;
  try { r = await probarIA(); } catch (e) { volver("/ajustes", "error", e instanceof ErrorIA ? e.message : mensajeError(e)); }
  volver("/ajustes", "ok", `La IA respondió: ${r}`);
}

/** Sube una plantilla o un logo. Se puede hacer en cualquier momento: la nueva pasa a ser la activa y las anteriores quedan guardadas. */
export async function subirPlantilla(f: FormData) {
  const usuario = await exigir(...COORD);
  const tipo = texto(f, "tipo");
  const archivo = f.get("archivo");
  if (!["respuesta_proyeccion", "diagnostico", "logo"].includes(tipo)) volver("/ajustes", "error", "Tipo de plantilla desconocido.");
  if (!(archivo instanceof File) || archivo.size === 0) volver("/ajustes", "error", "Elige un archivo.");
  if (archivo.size > 10 * 1024 * 1024) volver("/ajustes", "error", "El archivo supera los 10 MB.");
  const datos = Buffer.from(await archivo.arrayBuffer());
  const esLogo = tipo === "logo";
  if (esLogo && !/\.(png|jpe?g|webp)$/i.test(archivo.name)) volver("/ajustes", "error", "El logo debe ser PNG, JPG o WEBP.");
  if (!esLogo) {
    if (!/\.docx$/i.test(archivo.name)) volver("/ajustes", "error", "La plantilla debe ser un archivo de Word (.docx).");
    const problema = revisarPlantilla(datos);
    if (problema) volver("/ajustes", "error", `La plantilla tiene un problema en sus etiquetas: ${problema}`);
  }
  const ruta = await guardarArchivo(esLogo ? "logos" : "plantillas", archivo.name, datos);
  await comoUsuario(usuario.id, async () => {
    await q("update plantillas set activa = false where tipo = $1 and activa", [tipo]);
    await q(
      `insert into plantillas (tipo, nombre, archivo_ruta, archivo_nombre, version, notas, subida_por)
       values ($1, $2, $3, $4, coalesce((select max(version) + 1 from plantillas where tipo = $1), 1), $5, $6)`,
      [tipo, texto(f, "nombre") || archivo.name.replace(/\.[^.]+$/, ""), ruta, archivo.name, texto(f, "notas") || null, usuario.id]);
  });
  revalidatePath("/", "layout");
  volver("/ajustes", "ok", esLogo ? "Logo actualizado." : "Plantilla subida y activada.");
}

export async function activarPlantilla(f: FormData) {
  const usuario = await exigir(...COORD);
  const id = texto(f, "id");
  const desactivar = texto(f, "_accion") === "desactivar";
  await comoUsuario(usuario.id, async () => {
    const p = await q1<{ tipo: string }>("select tipo from plantillas where id = $1", [id]);
    if (!p) return;
    await q("update plantillas set activa = false where tipo = $1 and activa", [p.tipo]);
    if (!desactivar) await q("update plantillas set activa = true where id = $1", [id]);
  });
  revalidatePath("/", "layout");
  volver("/ajustes", "ok", desactivar ? "Plantilla desactivada: se usará el formato genérico." : "Plantilla activada.");
}

export async function guardarEntidad(f: FormData) {
  const usuario = await exigir("administrador");
  await q("insert into configuracion (clave, valor, actualizado_por) values ('entidad', $1, $2) on conflict (clave) do update set valor = excluded.valor, actualizado_por = excluded.actualizado_por, actualizado_en = now()", [JSON.stringify({ nombre: texto(f, "nombre") }), usuario.id]);
  revalidatePath("/", "layout");
  volver("/ajustes", "ok", "Nombre de la entidad guardado.");
}
