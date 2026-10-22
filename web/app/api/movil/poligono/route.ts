import { guardarPoligono, usuarioDeToken } from "@/lib/movil";

/** Polígono de un predio delimitado en el teléfono: { predio_id, poligono (GeoJSON) }. */
export async function POST(peticion: Request) {
  const usuario = await usuarioDeToken(peticion);
  if (!usuario) return Response.json({ error: "Sesión vencida. Ingresa de nuevo." }, { status: 401 });
  const d = await peticion.json().catch(() => null) as { predio_id?: string; poligono?: unknown } | null;
  if (!d?.predio_id) return Response.json({ error: "Falta el predio." }, { status: 400 });
  try {
    const r = await guardarPoligono(usuario, d.predio_id, d.poligono);
    return Response.json(r, { status: "ok" in r ? 200 : 422 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
