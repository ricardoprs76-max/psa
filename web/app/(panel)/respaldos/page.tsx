import { carpetaEnNube, guardarDrive, respaldarAhora } from "@/app/acciones3";
import { almacenNube, copiaEnNube, estadoNube } from "@/lib/nube";
import { BotonEnvio } from "@/components/BotonEnvio";
import { Aviso, Boton, Etiqueta, Insignia, Tarjeta, Titulo, Vacio } from "@/components/ui";
import { modoLocal, q, type Fila } from "@/lib/db";
import { configuracionDrive } from "@/lib/respaldo";
import { exigir } from "@/lib/sesion";

export default async function Respaldos({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const usuario = await exigir("administrador", "coordinador");
  const sp = await searchParams;
  const drive = await configuracionDrive();
  const nube = almacenNube();
  const remoto = nube?.tipo === "remoto";
  const copia = modoLocal() ? await copiaEnNube() : null;
  const sinc = estadoNube();
  const pendiente = !sinc.ok && !sinc.ultima && sinc.mensaje.startsWith("Todavía");
  const filas = await q<Fila>(
    `select id, to_char(iniciado_en at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as fecha, resultado::text as resultado, tamano_bytes, archivos, destino, detalle,
            substring(destino from 'respaldo-psa_[0-9-]+\\.zip') as nombre from respaldos order by iniciado_en desc limit 40`);
  const ultimo = filas[0];
  return (
    <>
      <Titulo titulo="Respaldos" detalle="Copia diaria automática de la base de datos (CSV y Excel por tabla) y de todos los archivos.">
        <form action={respaldarAhora}><BotonEnvio texto="Respaldar ahora" enviando="Creando el respaldo…" /></form>
      </Titulo>
      <Aviso ok={sp.ok} error={sp.error} />
      {ultimo?.resultado === "fallido" && <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"><strong>El último respaldo falló</strong> ({ultimo.fecha}): {ultimo.detalle}</div>}
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Tarjeta>
          {filas.length === 0 ? <div className="p-6"><Vacio>Todavía no hay respaldos. El primero se crea solo al poco tiempo de encender el sistema, o ahora mismo con el botón.</Vacio></div> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-borde text-left text-xs text-tenue"><th className="px-4 py-2.5">Fecha</th><th>Resultado</th><th className="text-right">Tamaño</th><th className="px-4">Detalle</th></tr></thead>
              <tbody>{filas.map((r) => (
                <tr key={r.id} className="border-b border-borde/60 align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-2.5">{r.fecha}</td>
                  <td className="py-2.5"><Insignia tono={r.resultado === "exitoso" ? "verde" : r.resultado === "fallido" ? "rojo" : "ambar"}>{r.resultado.replace("_", " ")}</Insignia></td>
                  <td className="py-2.5 text-right">{r.tamano_bytes ? `${(Number(r.tamano_bytes) / 1048576).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB` : "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-tenue">{r.detalle}{r.destino && <div>{r.destino}</div>}{r.nombre && r.resultado === "exitoso" && <a href={`/api/respaldo?nombre=${r.nombre}`} className="font-medium text-marca-fuerte hover:underline">Descargar</a>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Tarjeta>
        <div className="space-y-4">
        <Tarjeta className="p-5">
          <div className="flex items-center gap-2"><h2 className="font-semibold">Datos en Google Drive</h2><Insignia tono={!nube?.disponible || pendiente ? "gris" : sinc.conflicto ? "ambar" : sinc.ok ? "verde" : "rojo"}>{!nube ? "Drive no encontrado" : !nube.disponible ? "carpeta no disponible" : pendiente ? "iniciando" : sinc.conflicto ? "requiere decisión" : sinc.ok ? "al día" : "con error"}</Insignia></div>
          <p className="mt-1 text-sm text-tenue">El sistema mantiene una copia completa (base de datos, archivos y respaldos) en la carpeta <strong>Proyecto PSA</strong> de Google Drive. {!modoLocal() ? "La base de datos está en un servidor PostgreSQL en la nube; los archivos se guardan en Drive al subirlos y cada día va a Drive un respaldo completo de la base." : remoto ? "Este servidor guarda en Drive cada cambio a los pocos segundos y, al encenderse, arranca con lo que haya allí." : "Para eso este computador necesita Google Drive para escritorio con la sesión de la cuenta iniciada; Drive se encarga de subirla."}</p>
          <dl className="mt-3 space-y-1 text-sm">
            <div><dt className="inline text-tenue">Carpeta: </dt><dd className="inline break-all">{nube ? nube.ruta : "—"}</dd></div>
            {modoLocal() && <div><dt className="inline text-tenue">Base guardada en Drive: </dt><dd className="inline">{copia?.fecha ? `${new Date(copia.fecha).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" })} (equipo ${copia.equipo})` : "todavía no hay"}</dd></div>}
            <div><dt className="inline text-tenue">Estado: </dt><dd className="inline">{sinc.mensaje}</dd></div>
          </dl>
          {usuario.rol === "administrador" ? (
            <>
              {sinc.conflicto && nube?.disponible && (
                <form action={carpetaEnNube} className="mt-3 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
                  <p>La carpeta ya trae datos de otro equipo. Elige cuáles se conservan; los otros no se borran de inmediato (queda la copia anterior).</p>
                  <div className="flex flex-wrap gap-2"><BotonEnvio tipo="suave" name="_accion" value="traer" texto="Usar los datos de la nube" enviando="Cargando…" /><BotonEnvio tipo="suave" name="_accion" value="subir" texto="Usar los de este equipo" enviando="Copiando…" /></div>
                </form>
              )}
              <form action={carpetaEnNube} className="mt-3 space-y-3">
                {!remoto && <Etiqueta texto="Ruta de la carpeta" ayuda="Déjala vacía para que el sistema la encuentre solo (G:\Mi unidad\Proyecto PSA)."><input name="carpeta" defaultValue={nube?.origen === "ajuste" ? nube.ruta : ""} placeholder="G:\Mi unidad\Proyecto PSA" className="campo" /></Etiqueta>}
                <div className="flex flex-wrap gap-2">{!remoto && <BotonEnvio tipo="suave" name="_accion" value="carpeta" texto="Guardar carpeta" enviando="Guardando…" />}<BotonEnvio name="_accion" value="sincronizar" texto="Sincronizar ahora" enviando="Sincronizando…" /></div>
              </form>
            </>
          ) : <p className="mt-3 text-sm text-tenue">Solo el administrador puede cambiar la carpeta.</p>}
        </Tarjeta>
        <Tarjeta className="p-5">
          <details>
          <summary className="flex cursor-pointer items-center gap-2"><h2 className="font-semibold">Subida directa con cuenta de servicio (opcional)</h2><Insignia tono={drive.credencial && drive.carpeta ? "verde" : "gris"}>{drive.credencial && drive.carpeta ? "configurado" : "sin configurar"}</Insignia></summary>
          <p className="mt-1 text-sm text-tenue">Alternativa para servidores sin Google Drive para escritorio: con una cuenta de servicio de Google, cada respaldo .zip se sube a la carpeta de Drive que indiques. Sirve con unidades compartidas de Google Workspace, no con una cuenta personal de Gmail.</p>
          {usuario.rol === "administrador" ? (
            <form action={guardarDrive} className="mt-3 space-y-3">
              <Etiqueta texto="Carpeta de Drive" ayuda="Pega el enlace o el identificador de la carpeta, y compártela como Editor con el correo de la cuenta de servicio."><input name="carpeta" defaultValue={drive.carpeta} className="campo" /></Etiqueta>
              <Etiqueta texto={drive.credencial ? `Credencial guardada (${drive.credencial.client_email}). Pega otra para reemplazarla.` : "Credencial de la cuenta de servicio (contenido del archivo JSON)"} ayuda="Se guarda cifrada y no se vuelve a mostrar.">
                <textarea name="credencial" rows={4} className="campo font-mono text-xs" placeholder='{ "type": "service_account", … }' />
              </Etiqueta>
              <div className="flex gap-2"><Boton tipo="suave">Guardar</Boton>{drive.credencial && <Boton tipo="peligro" name="_accion" value="quitar">Quitar credencial</Boton>}</div>
            </form>
          ) : <p className="mt-3 text-sm text-tenue">Solo el administrador puede configurar Drive.</p>}
          </details>
        </Tarjeta>
        </div>
      </div>
    </>
  );
}
