import { leerRespaldo } from "@/lib/respaldo";
import { usuarioActual } from "@/lib/sesion";

/** Descarga un respaldo guardado en este equipo. */
export async function GET(peticion: Request) {
  const usuario = await usuarioActual();
  if (!usuario) return new Response("Sin sesión", { status: 401 });
  if (usuario.rol !== "administrador" && usuario.rol !== "coordinador") return new Response("No encontrado", { status: 404 });
  const nombre = new URL(peticion.url).searchParams.get("nombre") ?? "";
  try {
    return new Response(new Uint8Array(await leerRespaldo(nombre)), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${nombre}"`, "Cache-Control": "private, no-store" },
    });
  } catch {
    return new Response("Ese respaldo ya no está en este equipo", { status: 404 });
  }
}
