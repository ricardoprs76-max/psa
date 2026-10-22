import { crearPredio, usuarioDeToken } from "@/lib/movil";

/** Predio nuevo levantado en campo. 200 creado (o ya existía) · 422 datos no válidos. */
export async function POST(peticion: Request) {
  const usuario = await usuarioDeToken(peticion);
  if (!usuario) return Response.json({ error: "Sesión vencida. Ingresa de nuevo." }, { status: 401 });
  const datos = await peticion.json().catch(() => null);
  if (!datos || typeof datos !== "object") return Response.json({ error: "Datos ilegibles." }, { status: 400 });
  try {
    const r = await crearPredio(usuario, datos);
    return Response.json(r, { status: "ok" in r ? 200 : 422 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
