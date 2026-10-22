import { leerArchivo, tipoMime } from "@/lib/archivos";
import { q1 } from "@/lib/db";

/** Logo activo de la entidad (se muestra también en la pantalla de ingreso, por eso no pide sesión). */
export async function GET() {
  const logo = await q1<{ archivo_ruta: string; archivo_nombre: string }>("select archivo_ruta, archivo_nombre from plantillas where tipo = 'logo' and activa");
  if (!logo) return new Response("Sin logo", { status: 404 });
  try {
    return new Response(new Uint8Array(await leerArchivo(logo.archivo_ruta)), {
      headers: { "Content-Type": tipoMime(logo.archivo_nombre), "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new Response("Sin logo", { status: 404 });
  }
}
