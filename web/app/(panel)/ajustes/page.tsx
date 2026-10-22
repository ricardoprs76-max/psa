import { activarPlantilla, actualizarUsuario, borrarClaveIA, cambiarClaveComun, crearUsuario, guardarClaveIA, guardarEntidad, probarClaveIA, subirPlantilla } from "@/app/acciones";
import { BotonEnvio } from "@/components/BotonEnvio";
import { Aviso, Boton, Etiqueta, Insignia, Tarjeta, Titulo } from "@/components/ui";
import { modoLocal, q, q1, type Fila } from "@/lib/db";
import { configuracionIA, MODELO_POR_DEFECTO } from "@/lib/ia";
import { ETIQUETAS_AYUDA } from "@/lib/respuesta";
import { exigir, fechaClaveComun, ROLES } from "@/lib/sesion";

const TIPOS: Record<string, { titulo: string; ayuda: string; acepta: string }> = {
  respuesta_proyeccion: { titulo: "Carta de respuesta a solicitudes", ayuda: "Word (.docx) con las etiquetas de abajo. Se usa al generar la respuesta de una proyección.", acepta: ".docx" },
  diagnostico: { titulo: "Diagnóstico F-RE-08", ayuda: "Word (.docx) del formato vigente. Se usará en la fase 3 para generar diagnósticos.", acepta: ".docx" },
  logo: { titulo: "Logo de la entidad", ayuda: "PNG o JPG oficial. Aparece en el menú, en la pantalla de ingreso y en la carta genérica.", acepta: ".png,.jpg,.jpeg,.webp" },
};

export default async function Ajustes({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const usuario = await exigir("administrador", "coordinador");
  const sp = await searchParams;
  const admin = usuario.rol === "administrador";
  const ia = await configuracionIA();
  const fechaClave = await fechaClaveComun();
  const claveInfo = await q1<Fila>("select to_char(s.actualizado_en at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as fecha, p.nombre from secretos s left join perfiles p on p.id = s.actualizado_por where s.clave = 'anthropic_api_key'");
  const plantillas = await q<Fila>("select p.id, p.tipo, p.nombre, p.archivo_nombre, p.version, p.activa, p.notas, to_char(p.creado_en at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as fecha, u.nombre as autor from plantillas p left join perfiles u on u.id = p.subida_por order by p.tipo, p.version desc");
  const usuarios = admin ? await q<Fila>("select p.id, p.nombre, p.rol::text as rol, p.activo, u.email from perfiles p join auth.users u on u.id = p.id order by p.nombre") : [];
  const entidad = (await q1<{ valor: { nombre?: string } }>("select valor from configuracion where clave = 'entidad'"))?.valor?.nombre ?? "";
  return (
    <>
      <Titulo titulo="Ajustes" detalle={modoLocal() ? "Modo local: los datos están en este computador (carpeta web/.datos) y se copian a Google Drive; ver Respaldos." : "Conectado a la base de datos configurada."} />
      <Aviso ok={sp.ok} error={sp.error} />

      <Tarjeta className="p-5">
        <h2 className="font-semibold">Plantillas y logo</h2>
        <p className="mt-1 text-sm text-tenue">Puedes subir una plantilla nueva en cualquier momento: pasa a ser la activa y las anteriores quedan guardadas para volver a ellas.</p>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          {Object.entries(TIPOS).map(([tipo, t]) => {
            const lista = plantillas.filter((p) => p.tipo === tipo);
            return (
              <div key={tipo} className="rounded-xl border border-borde p-4">
                <div className="font-medium">{t.titulo}</div>
                <p className="mt-0.5 text-xs text-tenue">{t.ayuda}</p>
                {tipo === "logo" && lista.some((p) => p.activa) && <img src="/api/logo" alt="Logo actual" className="mt-3 h-14 w-auto rounded bg-white p-1" />}
                <form action={subirPlantilla} className="mt-3 space-y-2">
                  <input type="hidden" name="tipo" value={tipo} />
                  <input type="file" name="archivo" accept={t.acepta} required className="campo" />
                  <input name="notas" placeholder="Nota (opcional): versión, quién la aprobó…" className="campo" />
                  <BotonEnvio texto="Subir y activar" enviando="Subiendo…" tipo="suave" />
                </form>
                {lista.length === 0 ? <p className="mt-3 text-xs text-tenue">{tipo === "logo" ? "Sin logo propio: se usa el logo del sistema (la matica)." : "Sin plantilla: se usa el formato genérico del sistema."}</p> : (
                  <ul className="mt-3 space-y-2 text-sm">{lista.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2">
                      <a href={`/api/archivo?tipo=plantilla&id=${p.id}`} className="font-medium text-marca-fuerte hover:underline">v{p.version} · {p.archivo_nombre}</a>
                      {p.activa && <Insignia tono="verde">activa</Insignia>}
                      <span className="text-xs text-tenue">{p.fecha} · {p.autor}{p.notas ? ` · ${p.notas}` : ""}</span>
                      <form action={activarPlantilla} className="ml-auto"><input type="hidden" name="id" value={p.id} /><button name="_accion" value={p.activa ? "desactivar" : "activar"} className="cursor-pointer text-xs text-marca-fuerte underline">{p.activa ? "Desactivar" : "Usar esta"}</button></form>
                    </li>
                  ))}</ul>
                )}
              </div>
            );
          })}
        </div>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium text-marca-fuerte">Etiquetas para la carta de respuesta</summary>
          <p className="mt-2 text-tenue">Escribe estas etiquetas en tu Word donde deba ir cada dato. Lo que no tenga valor saldrá como [PENDIENTE] resaltado.</p>
          <table className="mt-2 w-full text-sm"><tbody>{ETIQUETAS_AYUDA.map(([e, d]) => <tr key={e} className="border-b border-borde/60"><td className="py-1 pr-4 font-mono text-xs">{e}</td><td className="text-tenue">{d}</td></tr>)}</tbody></table>
        </details>
      </Tarjeta>

      {admin && (
        <Tarjeta className="mt-4 p-5">
          <div className="flex items-center gap-2"><h2 className="font-semibold">Inteligencia artificial</h2><Insignia tono={ia.clave ? "verde" : "gris"}>{ia.clave ? "clave configurada" : "sin clave"}</Insignia></div>
          <p className="mt-1 text-sm text-tenue">
            El análisis de solicitudes en PDF usa la API de Claude con la clave que escribas aquí. El sistema no trae ninguna clave ni la toma de otro lugar: mientras este campo esté vacío, la función queda desactivada.
            La clave se guarda cifrada, no se vuelve a mostrar y solo la usa el servidor.
          </p>
          <form action={guardarClaveIA} className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end">
            <Etiqueta texto={ia.clave ? "Reemplazar la clave (déjalo vacío para conservar la actual)" : "Clave de la API de Anthropic"} ayuda="Se crea en console.anthropic.com → API keys">
              <input name="clave" type="password" autoComplete="off" placeholder="sk-ant-…" className="campo" />
            </Etiqueta>
            <Etiqueta texto="Modelo" ayuda={`Por defecto ${MODELO_POR_DEFECTO}`}><input name="modelo" defaultValue={ia.modelo} className="campo" /></Etiqueta>
            <Boton>Guardar</Boton>
          </form>
          {claveInfo && <p className="mt-2 text-xs text-tenue">Clave guardada el {claveInfo.fecha}{claveInfo.nombre ? ` por ${claveInfo.nombre}` : ""}.</p>}
          {ia.clave && (
            <div className="mt-3 flex gap-2">
              <form action={probarClaveIA}><BotonEnvio texto="Probar conexión" enviando="Probando…" tipo="suave" /></form>
              <form action={borrarClaveIA}><Boton tipo="peligro">Eliminar la clave</Boton></form>
            </div>
          )}
        </Tarjeta>
      )}

      {admin && (
        <Tarjeta className="mt-4 p-5">
          <h2 className="font-semibold">Entidad</h2>
          <form action={guardarEntidad} className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[280px] flex-1"><Etiqueta texto="Nombre que aparece en los documentos"><input name="nombre" defaultValue={entidad} placeholder="Nombre de la entidad" className="campo" /></Etiqueta></div>
            <Boton tipo="suave">Guardar</Boton>
          </form>
        </Tarjeta>
      )}

      {admin && (
        <Tarjeta className="mt-4 p-5">
          <h2 className="font-semibold">Usuarios y roles</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-borde text-left text-xs text-tenue"><th className="py-2">Nombre</th><th>Correo</th><th>Rol</th><th>Activo</th><th /></tr></thead>
              <tbody>{usuarios.map((u) => (
                <tr key={u.id} className="border-b border-borde/60">
                  <td className="py-2">{u.nombre}</td><td>{u.email}</td>
                  <td colSpan={3}>
                    <form action={actualizarUsuario} className="flex items-center gap-3">
                      <input type="hidden" name="id" value={u.id} />
                      <select name="rol" defaultValue={u.rol} className="campo w-52">{Object.entries(ROLES).map(([v, e]) => <option key={v} value={v}>{e}</option>)}</select>
                      <input type="checkbox" name="activo" defaultChecked={u.activo} className="h-4 w-4" aria-label="Activo" />
                      <Boton tipo="suave">Guardar</Boton>
                    </form>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="mt-4 border-t border-borde pt-4">
            <p className="text-sm text-tenue">Todas las personas entran con su propio correo y la <strong>contraseña común</strong>. El correo identifica a cada quien y queda guardado en cada registro que crea o modifica.
              {fechaClave ? ` Último cambio de la contraseña: ${fechaClave}.` : " Todavía no se ha fijado una contraseña común."}</p>
            <form action={cambiarClaveComun} className="mt-3 grid gap-3 md:grid-cols-3 md:items-end">
              <Etiqueta texto="Nueva contraseña común (mín. 10)"><input name="clave" type="password" required minLength={10} autoComplete="new-password" className="campo" /></Etiqueta>
              <Etiqueta texto="Repítela"><input name="clave2" type="password" required minLength={10} autoComplete="new-password" className="campo" /></Etiqueta>
              <Boton tipo="suave">Cambiar contraseña</Boton>
            </form>
            <p className="mt-2 text-xs text-tenue">Al cambiarla se cierran todas las sesiones abiertas, en la web y en la app de campo.</p>
          </div>
          <form action={crearUsuario} className="mt-3 grid gap-3 md:grid-cols-4 md:items-end">
            <Etiqueta texto="Nombre"><input name="nombre" required className="campo" /></Etiqueta>
            <Etiqueta texto="Correo"><input name="correo" type="email" required className="campo" /></Etiqueta>
            <Etiqueta texto="Rol"><select name="rol" className="campo" defaultValue="consulta">{Object.entries(ROLES).map(([v, e]) => <option key={v} value={v}>{e}</option>)}</select></Etiqueta>
            <Boton>Crear usuario</Boton>
          </form>
        </Tarjeta>
      )}
    </>
  );
}
