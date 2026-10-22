import { q1, type Fila } from "@/lib/db";

/**
 * Quién hizo el registro: el correo de la persona que lo creó y el de la última que lo modificó, con su fecha.
 * Sale de la bitácora de auditoría, que la base llena sola en cada cambio.
 */
export async function Autoria({ tabla, id }: { tabla: string; id: string }) {
  const consulta = (orden: string, accion: string) => q1<Fila>(
    `select coalesce(lower(u.email), 'sin usuario') as correo, p.nombre, to_char(a.fecha at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as fecha
       from auditoria a left join auth.users u on u.id = a.usuario_id left join perfiles p on p.id = a.usuario_id
      where a.tabla = $1 and a.registro_id = $2 and a.accion = $3 order by a.fecha ${orden}, a.id ${orden} limit 1`, [tabla, id, accion]).catch(() => null);
  const [creo, cambio] = await Promise.all([consulta("asc", "INSERT"), consulta("desc", "UPDATE")]);
  if (!creo && !cambio) return null;
  const linea = (r: Fila) => <><strong className="font-medium text-texto">{String(r.correo)}</strong>{r.nombre ? ` (${r.nombre})` : ""} · {String(r.fecha)}</>;
  return (
    <p className="mt-3 text-xs text-tenue">
      {creo && <>Registrado por {linea(creo)}</>}
      {creo && cambio && <span className="mx-2">|</span>}
      {cambio && <>Última modificación por {linea(cambio)}</>}
    </p>
  );
}
