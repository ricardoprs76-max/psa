import { comoUsuario, q, q1 } from "@/lib/db";
import { crearToken } from "@/lib/movil";
import { anotarIntento, claveCorrecta, claveRelleno, intentoPermitido } from "@/lib/sesion";

type UsuarioMovil = { id: string; nombre: string; rol: string; correo: string; activo: boolean };

const buscar = (correo: string) => q1<UsuarioMovil>(
  "select p.id, p.nombre, p.rol::text as rol, lower(u.email) as correo, p.activo from auth.users u join perfiles p on p.id = u.id where lower(u.email) = $1", [correo]);

/** "maria.rojas@…" → "Maria Rojas": nombre provisional mientras la oficina lo corrige en Ajustes. */
const nombreDeCorreo = (correo: string) =>
  correo.split("@")[0].split(/[._-]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(" ") || correo;

/**
 * Inicio de sesión de la app de campo: devuelve un token que el teléfono guarda.
 * Misma contraseña para todos; el correo identifica a la persona y con él quedan firmadas sus visitas. Un correo que
 * todavía no existe se registra solo como funcionario de campo (la oficina puede cambiarle el rol o desactivarlo).
 */
export async function POST(peticion: Request) {
  const cuerpo = await peticion.json().catch(() => null) as { correo?: string; clave?: string } | null;
  if (!cuerpo?.correo || !cuerpo.clave) return Response.json({ error: "Escribe correo y contraseña." }, { status: 400 });
  const correo = cuerpo.correo.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return Response.json({ error: "Escribe un correo válido." }, { status: 400 });
  if (!intentoPermitido(correo)) return Response.json({ error: "Demasiados intentos fallidos. Espera 15 minutos." }, { status: 429 });
  if (!(await claveCorrecta(cuerpo.clave))) {
    anotarIntento(correo, false);
    return Response.json({ error: "Contraseña incorrecta." }, { status: 401 });
  }
  let u = await buscar(correo);
  if (!u) {
    const nombre = nombreDeCorreo(correo);
    await comoUsuario(null, async () => {
      const nuevo = await q1<{ id: string }>(
        "insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values (gen_random_uuid(), $1, crypt($2, gen_salt('bf', 10)), $3) returning id",
        [correo, claveRelleno(), JSON.stringify({ nombre })]);
      await q("update perfiles set rol = 'funcionario_campo', nombre = $2 where id = $1", [nuevo!.id, nombre]);
    });
    u = await buscar(correo);
  }
  if (!u || !u.activo) {
    anotarIntento(correo, false);
    return Response.json({ error: "Este correo está desactivado en la plataforma. Habla con la oficina." }, { status: 401 });
  }
  anotarIntento(correo, true);
  const { activo: _a, ...usuario } = u;
  return Response.json({ token: crearToken(u.id), usuario });
}
