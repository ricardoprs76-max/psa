import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DIR_DATOS, q, q1 } from "./db";

export type Rol = "administrador" | "coordinador" | "funcionario_campo" | "financiero" | "consulta";
export type Usuario = { id: string; nombre: string; rol: Rol; correo: string };

/**
 * Contraseña común de la plataforma y de la app de campo: todas las personas entran con su propio correo y esta misma
 * contraseña (el correo identifica a cada quien y con él queda firmado cada registro). No está escrita en el código:
 * se guarda en la tabla `secretos` como huella scrypt ("sal$huella") y la cambia el administrador en Ajustes.
 * Cambiarla cierra todas las sesiones abiertas, en la web y en los teléfonos.
 */
const SECRETO_CLAVE = "clave_comun";
export const CLAVE_MINIMA = 10;
const huella = (clave: string, sal: string) => crypto.scryptSync(clave, sal, 32);

async function claveGuardada() {
  return q1<{ valor: string; desde: number; fecha: string }>(
    `select valor_cifrado as valor, (extract(epoch from actualizado_en) * 1000)::float8 as desde,
            to_char(actualizado_en at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as fecha
     from secretos where clave = $1`, [SECRETO_CLAVE]);
}

/** Fecha (hora Colombia) del último cambio de la contraseña común, o null si todavía no se ha fijado. */
export async function fechaClaveComun(): Promise<string | null> {
  return (await claveGuardada())?.fecha ?? null;
}

/** Compara la contraseña escrita con la común, sin revelar por el tiempo de respuesta en qué difiere. */
export async function claveCorrecta(clave: string): Promise<boolean> {
  const g = await claveGuardada();
  const [sal, h] = g?.valor.split("$") ?? [];
  if (!sal || !h) return false;
  const [a, b] = [huella(clave, sal), Buffer.from(h, "hex")];
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Fija (o cambia) la contraseña común. Las sesiones y tokens emitidos antes de este momento dejan de valer. */
export async function fijarClaveComun(clave: string, porId: string | null) {
  const sal = crypto.randomBytes(16).toString("hex");
  await q(
    `insert into secretos (clave, valor_cifrado, actualizado_por, actualizado_en) values ($1, $2, $3, to_timestamp($4::float8 / 1000))
     on conflict (clave) do update set valor_cifrado = excluded.valor_cifrado, actualizado_por = excluded.actualizado_por, actualizado_en = excluded.actualizado_en`,
    [SECRETO_CLAVE, `${sal}$${huella(clave, sal).toString("hex")}`, porId, Date.now()]);
}

/** Momento (ms) del último cambio de la contraseña común: lo emitido antes ya no vale. */
export async function validoDesde(): Promise<number> {
  return (await claveGuardada())?.desde ?? 0;
}

/** Valor para auth.users.encrypted_password: el ingreso no lo usa (usa la contraseña común), pero la columna lo exige. */
export const claveRelleno = () => crypto.randomBytes(24).toString("hex");

/** Revisa una contraseña común nueva: devuelve el error, o null si sirve. */
export function errorClaveNueva(clave: string, repetida: string): string | null {
  if (clave.length < CLAVE_MINIMA) return `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`;
  if (clave !== repetida) return "Las dos contraseñas no coinciden.";
  return null;
}

export const ROLES: Record<Rol, string> = {
  administrador: "Administrador", coordinador: "Coordinador", funcionario_campo: "Funcionario de campo",
  financiero: "Financiero", consulta: "Consulta",
};

const COOKIE = "psa_sesion";
const HORAS = 12;

/**
 * Llave del servidor: firma las sesiones y cifra los secretos. Sale de PSA_SECRETO o, en modo local,
 * de un archivo que se crea solo la primera vez (web/.datos/llave).
 */
export function llaveServidor(): Buffer {
  if (process.env.PSA_SECRETO) return crypto.createHash("sha256").update(process.env.PSA_SECRETO).digest();
  const archivo = path.join(DIR_DATOS, "llave");
  if (!fs.existsSync(archivo)) {
    fs.mkdirSync(DIR_DATOS, { recursive: true });
    fs.writeFileSync(archivo, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(archivo, "utf8").trim(), "hex");
}

const firmar = (texto: string) => crypto.createHmac("sha256", llaveServidor()).update(texto).digest("base64url");

/**
 * Freno a quien prueba contraseñas: tras 8 intentos fallidos con un mismo correo, ese correo espera 15 minutos.
 * `intentoPermitido` se consulta antes de revisar la clave y `anotarIntento` después.
 */
const fallos = ((globalThis as unknown as { __psaFallos?: Map<string, { n: number; desde: number }> }).__psaFallos ??= new Map());
const VENTANA = 15 * 60_000;
export function intentoPermitido(correo: string): boolean {
  const f = fallos.get(correo);
  if (f && Date.now() - f.desde > VENTANA) fallos.delete(correo);
  return (fallos.get(correo)?.n ?? 0) < 8;
}
export function anotarIntento(correo: string, acerto: boolean) {
  if (acerto) { fallos.delete(correo); return; }
  if (fallos.size > 5000) fallos.clear();
  const f = fallos.get(correo) ?? { n: 0, desde: Date.now() };
  fallos.set(correo, { n: f.n + 1, desde: f.desde });
}

export async function iniciarSesion(usuarioId: string) {
  const cuerpo = `${usuarioId}.${Date.now() + HORAS * 3_600_000}`;
  (await cookies()).set(COOKIE, `${cuerpo}.${firmar(cuerpo)}`, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: HORAS * 3600,
  });
}

export async function cerrarSesion() {
  (await cookies()).delete(COOKIE);
}

/** Usuario de la sesión, o null si no hay sesión válida o el perfil está inactivo. */
export async function usuarioActual(): Promise<Usuario | null> {
  const valor = (await cookies()).get(COOKIE)?.value;
  if (!valor) return null;
  const [id, vence, firma] = valor.split(".");
  if (!id || !vence || !firma) return null;
  const esperada = firmar(`${id}.${vence}`);
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  if (Number(vence) < Date.now()) return null;
  if (Number(vence) - HORAS * 3_600_000 < (await validoDesde())) return null; // emitida antes del último cambio de contraseña
  return q1<Usuario>(
    "select p.id, p.nombre, p.rol, u.email as correo from perfiles p join auth.users u on u.id = p.id where p.id = $1 and p.activo", [id],
  );
}

/** Exige sesión (y, si se indican, alguno de los roles). Sin sesión manda al inicio de sesión. */
export async function exigir(...roles: Rol[]): Promise<Usuario> {
  const usuario = await usuarioActual();
  if (!usuario) redirect("/ingresar");
  if (roles.length && !roles.includes(usuario.rol)) throw new Error("No tienes permiso para esta acción.");
  return usuario;
}

export const puede = (usuario: Usuario, ...roles: Rol[]) => roles.includes(usuario.rol);

// ---------- Secretos cifrados (clave de la API de IA) ----------

export function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", llaveServidor(), iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), datos].map((b) => b.toString("base64")).join(".");
}

export function descifrar(valor: string): string | null {
  try {
    const [iv, tag, datos] = valor.split(".").map((p) => Buffer.from(p, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", llaveServidor(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(datos), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
