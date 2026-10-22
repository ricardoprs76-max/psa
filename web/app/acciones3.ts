"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { guardarArchivo, leerArchivo } from "@/lib/archivos";
import { mensajeError } from "@/lib/crud";
import { comoUsuario, q, reabrirBase } from "@/lib/db";
import { fijarCarpetaNube, resolverConflicto, restauracionSolicitada, sincronizarNube } from "@/lib/nube";
import { generarDiagnostico, verificarEspecies } from "@/lib/diagnostico";
import { IMPORTABLES, importarFilas, leerTabla } from "@/lib/importar";
import { MODULOS } from "@/lib/modulos";
import { hacerRespaldo } from "@/lib/respaldo";
import { cifrar, exigir, type Rol } from "@/lib/sesion";

function volver(destino: string, tipo: "ok" | "error", mensaje: string): never {
  const ruta = destino.startsWith("/") && !destino.startsWith("//") ? destino : "/";
  redirect(`${ruta}${ruta.includes("?") ? "&" : "?"}${tipo}=${encodeURIComponent(mensaje)}`);
}
const texto = (f: FormData, n: string) => String(f.get(n) ?? "").trim();
const COORD: Rol[] = ["administrador", "coordinador"];
const AMBITOS = { beneficiario: "beneficiario_id", predio: "predio_id", acuerdo: "acuerdo_id" } as const;

// ---------- Documentos del expediente ----------

/** Sube un documento al expediente. Si el tipo tiene vigencia, el vencimiento se calcula desde la fecha de emisión. */
export async function subirDocumento(f: FormData) {
  const usuario = await exigir(...COORD);
  const ambito = texto(f, "ambito") as keyof typeof AMBITOS;
  const regreso = texto(f, "_regreso") || "/expedientes";
  const archivo = f.get("archivo");
  if (!AMBITOS[ambito]) volver(regreso, "error", "Expediente desconocido.");
  if (!(archivo instanceof File) || archivo.size === 0) volver(regreso, "error", "Elige el archivo del documento.");
  if (archivo.size > 25 * 1024 * 1024) volver(regreso, "error", "El archivo supera los 25 MB.");
  if (!/\.(pdf|png|jpe?g|docx?|xlsx?)$/i.test(archivo.name)) volver(regreso, "error", "Formatos admitidos: PDF, imagen, Word o Excel.");
  const emision = texto(f, "fecha_emision") || null;
  try {
    if (emision && new Date(emision).getTime() > Date.now() + 86_400_000) throw new Error("La fecha de emisión es posterior a hoy.");
    const ruta = await guardarArchivo(`documentos/${ambito}/${texto(f, "id")}`, archivo.name, Buffer.from(await archivo.arrayBuffer()));
    await comoUsuario(usuario.id, () => q(
      `insert into documentos (tipo_id, ${AMBITOS[ambito]}, archivo_ruta, archivo_nombre, estado, fecha_emision, fecha_vencimiento, observaciones, creado_por, version)
       select t.id, $2, $3, $4, 'pendiente', $5::date, case when t.vigencia_dias is not null and $5::date is not null then $5::date + t.vigencia_dias else nullif($6, '')::date end, nullif($7, ''), $8,
              coalesce((select max(version) + 1 from documentos d where d.tipo_id = t.id and d.${AMBITOS[ambito]} = $2), 1)
       from tipos_documento t where t.id = $1`,
      [texto(f, "tipo_id"), texto(f, "id"), ruta, archivo.name, emision, texto(f, "fecha_vencimiento"), texto(f, "observaciones"), usuario.id]));
  } catch (e) { volver(regreso, "error", mensajeError(e)); }
  revalidatePath("/", "layout");
  volver(regreso, "ok", "Documento cargado. Queda pendiente hasta que alguien lo verifique.");
}

/** Verificar (recibido), rechazar o eliminar un documento; queda quién lo verificó. */
export async function revisarDocumento(f: FormData) {
  const usuario = await exigir(...COORD);
  const regreso = texto(f, "_regreso") || "/expedientes";
  const accion = texto(f, "_accion");
  await comoUsuario(usuario.id, async () => {
    if (accion === "eliminar") await q("update documentos set eliminado_en = now() where id = $1", [texto(f, "id")]);
    else await q("update documentos set estado = $2::estado_documento, verificado_por = $3, verificado_en = now(), observaciones = coalesce(nullif($4, ''), observaciones) where id = $1",
      [texto(f, "id"), accion === "rechazar" ? "rechazado" : "recibido", usuario.id, texto(f, "nota")]);
  });
  revalidatePath("/", "layout");
  volver(regreso, "ok", accion === "eliminar" ? "Documento eliminado." : accion === "rechazar" ? "Documento rechazado." : "Documento verificado.");
}

// ---------- Diagnósticos ----------

export async function generarDiagnosticoAccion(f: FormData) {
  const usuario = await exigir(...COORD);
  const id = texto(f, "id");
  let r: Awaited<ReturnType<typeof generarDiagnostico>>;
  try { r = await generarDiagnostico(id, usuario); } catch (e) { volver(`/m/diagnosticos/${id}`, "error", mensajeError(e)); }
  revalidatePath(`/m/diagnosticos/${id}`);
  volver(`/m/diagnosticos/${id}`, "ok", `Documento generado con ${r.plantilla}.` + (r.pendientes ? ` Tiene ${r.pendientes} dato(s) como [PENDIENTE].` : ""));
}

export async function verificarEspeciesAccion(f: FormData) {
  const usuario = await exigir(...COORD);
  const id = texto(f, "id");
  const r = await verificarEspecies(id, usuario);
  revalidatePath(`/m/diagnosticos/${id}`);
  if (r.sinRed) volver(`/m/diagnosticos/${id}`, "error", `No hubo conexión con el catálogo taxonómico (api.gbif.org). Se alcanzaron a revisar ${r.revisadas}. Intenta de nuevo cuando haya internet.`);
  volver(`/m/diagnosticos/${id}`, r.dudosas ? "error" : "ok", `${r.revisadas} nombre(s) científico(s) revisado(s)` + (r.dudosas ? `; ${r.dudosas} con observaciones: míralas en la lista de flora y fauna.` : ", todos aceptados."));
}

// ---------- Importación ----------

export async function prepararImportacion(f: FormData) {
  await exigir(...COORD);
  const modulo = texto(f, "modulo");
  const archivo = f.get("archivo");
  if (!IMPORTABLES.includes(modulo)) volver("/importar", "error", "Elige qué se va a importar.");
  if (!(archivo instanceof File) || archivo.size === 0) volver("/importar", "error", "Elige un archivo de Excel o CSV.");
  if (archivo.size > 20 * 1024 * 1024) volver("/importar", "error", "El archivo supera los 20 MB.");
  const datos = Buffer.from(await archivo.arrayBuffer());
  try { leerTabla(datos); } catch (e) { volver("/importar", "error", `No pude leer el archivo: ${(e as Error).message}`); }
  const ruta = await guardarArchivo("importaciones", archivo.name, datos);
  redirect(`/importar?modulo=${modulo}&archivo=${encodeURIComponent(ruta.replace("importaciones/", ""))}`);
}

export async function ejecutarImportacion(f: FormData) {
  const usuario = await exigir(...COORD);
  const modulo = texto(f, "modulo");
  const archivo = texto(f, "archivo");
  const aqui = `/importar?modulo=${modulo}&archivo=${encodeURIComponent(archivo)}`;
  if (!IMPORTABLES.includes(modulo) || !/^[\w.\- ]+$/.test(archivo)) volver("/importar", "error", "Importación no válida.");
  const mapa = Object.fromEntries(MODULOS[modulo].campos.map((c) => [c.n, texto(f, `col_${c.n}`)]).filter(([, col]) => col));
  let r: Awaited<ReturnType<typeof importarFilas>>;
  try {
    const { filas } = leerTabla(await leerArchivo(`importaciones/${archivo}`));
    r = await importarFilas(modulo, filas, mapa, usuario);
  } catch (e) { volver(aqui, "error", mensajeError(e)); }
  revalidatePath("/", "layout");
  const detalle = r.errores.slice(0, 8).map((e) => `fila ${e.fila}: ${e.mensaje}`).join(" · ");
  if (r.errores.length) volver(aqui, "error", `${r.creados} registro(s) importado(s) y ${r.errores.length} con error — ${detalle}${r.errores.length > 8 ? " …" : ""}`);
  volver(`/m/${modulo}`, "ok", `${r.creados} registro(s) importado(s).`);
}

// ---------- Respaldos ----------

export async function respaldarAhora() {
  await exigir(...COORD);
  const r = await hacerRespaldo();
  revalidatePath("/respaldos");
  volver("/respaldos", r.resultado_t === "exitoso" ? "ok" : "error", r.resultado_t === "exitoso" ? `Respaldo creado: ${r.detalle}.` : `El respaldo falló: ${r.detalle}`);
}

/** Carpeta de Google Drive en este computador: fijarla a mano, sincronizar ya o decidir qué datos mandan. */
export async function carpetaEnNube(f: FormData) {
  await exigir("administrador");
  const accion = texto(f, "_accion");
  let mensaje = "", fallo = "";
  try {
    if (accion === "carpeta") {
      fijarCarpetaNube(texto(f, "carpeta").replace(/^"|"$/g, ""));
    } else if (accion === "subir" || accion === "traer") {
      await resolverConflicto(accion);
      if (accion === "traer") {
        await reabrirBase();
        if (!restauracionSolicitada()) mensaje = "Datos de la nube cargados. La base que había en este equipo quedó guardada en web/.datos como pg_anterior. ";
      }
    }
  } catch (e) {
    fallo = (e as Error).message;
  }
  if (fallo) volver("/respaldos", "error", fallo);
  const r = await sincronizarNube({ base: accion === "subir" || accion === "sincronizar", respaldos: true });
  revalidatePath("/", "layout");
  volver("/respaldos", r.ok && !r.conflicto ? "ok" : "error", mensaje + (r.ok && !r.conflicto ? `Carpeta en la nube al día: ${r.mensaje}` : r.mensaje));
}

/** Datos de Google Drive: los escribe un administrador; la credencial se guarda cifrada. */
export async function guardarDrive(f: FormData) {
  const usuario = await exigir("administrador");
  const credencial = texto(f, "credencial");
  if (credencial) {
    let json: { client_email?: string; private_key?: string };
    try { json = JSON.parse(credencial); } catch { volver("/respaldos", "error", "La credencial debe ser el contenido completo del archivo JSON de la cuenta de servicio."); }
    if (!json.client_email || !json.private_key) volver("/respaldos", "error", "El JSON no trae client_email y private_key: no es una cuenta de servicio.");
    await q("insert into secretos (clave, valor_cifrado, actualizado_por) values ('drive_cuenta_servicio', $1, $2) on conflict (clave) do update set valor_cifrado = excluded.valor_cifrado, actualizado_por = excluded.actualizado_por, actualizado_en = now()", [cifrar(credencial), usuario.id]);
  }
  if (texto(f, "_accion") === "quitar") await q("delete from secretos where clave = 'drive_cuenta_servicio'");
  const carpeta = texto(f, "carpeta").replace(/^.*\/folders\/([\w-]+).*$/, "$1");
  await q("insert into configuracion (clave, valor, actualizado_por) values ('drive', $1, $2) on conflict (clave) do update set valor = excluded.valor, actualizado_por = excluded.actualizado_por, actualizado_en = now()", [JSON.stringify({ carpeta }), usuario.id]);
  revalidatePath("/respaldos");
  volver("/respaldos", "ok", "Configuración de Google Drive guardada. Pulsa \"Respaldar ahora\" para probarla.");
}

