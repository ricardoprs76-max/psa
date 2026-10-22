import path from "node:path";
import { leerArchivo, tipoMime } from "@/lib/archivos";
import { q1 } from "@/lib/db";
import { usuarioActual } from "@/lib/sesion";

/**
 * Entrega un archivo guardado. No recibe rutas libres: recibe qué documento se quiere (tipo + id) y la ruta
 * sale de la base, con la misma regla de acceso por rol que el registro al que pertenece.
 */
export async function GET(peticion: Request) {
  const usuario = await usuarioActual();
  if (!usuario) return new Response("Sin sesión", { status: 401 });
  const url = new URL(peticion.url);
  const [tipo, id] = [url.searchParams.get("tipo"), url.searchParams.get("id")];
  const consultas: Record<string, { sql: string; roles: string[] }> = {
    solicitud: { sql: "select solicitud_pdf_ruta as ruta from proyecciones where id = $1", roles: ["administrador", "coordinador", "financiero"] },
    respuesta: { sql: "select documento_ruta as ruta from proyecciones where id = $1", roles: ["administrador", "coordinador", "financiero"] },
    version: { sql: "select documento_ruta as ruta from proyeccion_versiones where id = $1", roles: ["administrador", "coordinador", "financiero"] },
    origen: { sql: "select archivo_origen_ruta as ruta from proyecciones where id = $1", roles: ["administrador", "coordinador", "financiero"] },
    documento: { sql: "select archivo_ruta as ruta from documentos where id = $1 and eliminado_en is null", roles: ["administrador", "coordinador", "financiero", "consulta"] },
    diagnostico: { sql: "select documento_ruta as ruta from diagnosticos where id = $1", roles: ["administrador", "coordinador", "financiero", "consulta"] },
    foto: { sql: "select archivo_ruta as ruta from visita_fotos where id = $1 and eliminado_en is null", roles: ["administrador", "coordinador", "financiero", "consulta"] },
    firma: { sql: "select firma_ruta as ruta from visitas_campo where id = $1", roles: ["administrador", "coordinador", "financiero", "consulta"] },
    plantilla: { sql: "select archivo_ruta as ruta from plantillas where id = $1", roles: ["administrador", "coordinador"] },
  };
  const c = tipo ? consultas[tipo] : undefined;
  if (!c || !id || !c.roles.includes(usuario.rol)) return new Response("No encontrado", { status: 404 });
  const fila = await q1<{ ruta: string | null }>(c.sql, [id]);
  if (!fila?.ruta) return new Response("No encontrado", { status: 404 });
  try {
    const datos = await leerArchivo(fila.ruta);
    const nombre = path.basename(fila.ruta).replace(/^[0-9a-f]{8}_/, "");
    const enLinea = tipo === "solicitud" || tipo === "foto" || tipo === "firma" || (tipo === "documento" && /\.pdf$/i.test(nombre));
    return new Response(new Uint8Array(datos), {
      headers: {
        "Content-Type": tipoMime(nombre),
        "Content-Disposition": `${enLinea ? "inline" : "attachment"}; filename="${nombre}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("El archivo ya no está en el almacén", { status: 404 });
  }
}
