import { guardarVisita, usuarioDeToken } from "@/lib/movil";

/** Recibe una visita del teléfono. 200 guardada · 409 conflicto (devuelve la versión del servidor) · 422 rechazada. */
export async function POST(peticion: Request) {
  const usuario = await usuarioDeToken(peticion);
  if (!usuario) return Response.json({ error: "Sesión vencida. Ingresa de nuevo." }, { status: 401 });
  const visita = await peticion.json().catch(() => null);
  if (!visita || typeof visita !== "object") return Response.json({ error: "Datos ilegibles." }, { status: 400 });
  try {
    const r = await guardarVisita(usuario, visita);
    return Response.json(r, { status: r.estado === "guardada" ? 200 : r.estado === "conflicto" ? 409 : 422 });
  } catch (e) {
    return Response.json({ estado: "rechazada", motivo: (e as Error).message }, { status: 422 });
  }
}
