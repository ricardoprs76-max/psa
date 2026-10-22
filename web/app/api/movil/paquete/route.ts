import { paquete, usuarioDeToken } from "@/lib/movil";

/** Predios asignados y visitas propias, para guardar en el teléfono. */
export async function GET(peticion: Request) {
  const usuario = await usuarioDeToken(peticion);
  if (!usuario) return Response.json({ error: "Sesión vencida. Ingresa de nuevo." }, { status: 401 });
  return Response.json(await paquete(usuario));
}
