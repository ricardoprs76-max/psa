import { guardarFoto, usuarioDeToken } from "@/lib/movil";

export async function POST(peticion: Request) {
  const usuario = await usuarioDeToken(peticion);
  if (!usuario) return Response.json({ error: "Sesión vencida. Ingresa de nuevo." }, { status: 401 });
  const f = await peticion.formData().catch(() => null);
  const archivo = f?.get("archivo");
  if (!f || !(archivo instanceof File)) return Response.json({ error: "Falta la foto." }, { status: 400 });
  const num = (n: string) => (f.get(n) === null || f.get(n) === "" ? null : Number(f.get(n)));
  const r = await guardarFoto(usuario, {
    id: String(f.get("id") ?? ""), visita_id: String(f.get("visita_id") ?? ""), lat: num("lat"), lon: num("lon"),
    tomada_en: String(f.get("tomada_en") ?? new Date().toISOString()), descripcion: (f.get("descripcion") as string) || null, archivo,
  });
  return Response.json(r, { status: "error" in r ? 422 : 200 });
}
