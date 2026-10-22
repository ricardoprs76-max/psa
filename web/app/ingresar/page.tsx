import { redirect } from "next/navigation";
import { crearPrimerAdministrador, ingresar } from "@/app/acciones";
import { Aviso, Boton, Etiqueta, Tarjeta } from "@/components/ui";
import { q1 } from "@/lib/db";
import { usuarioActual } from "@/lib/sesion";

export default async function Ingresar({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  if (await usuarioActual()) redirect("/");
  const sp = await searchParams;
  const sinUsuarios = (await q1<{ n: number }>("select count(*)::int as n from auth.users"))!.n === 0;
  const logo = await q1("select 1 from plantillas where tipo = 'logo' and activa");
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-br from-marca-suave to-fondo p-6">
      <Tarjeta className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <img src={logo ? "/api/logo" : "/marca/matica.png"} alt="Logo de la entidad" className="h-14 w-auto rounded-full bg-white" />
          <div>
            <h1 className="text-xl font-semibold">Sistema PSA</h1>
            <p className="text-sm text-tenue">Pagos por Servicios Ambientales</p>
          </div>
        </div>
        <Aviso {...sp} />
        {sinUsuarios ? (
          <form action={crearPrimerAdministrador} className="space-y-4">
            <p className="rounded-xl bg-marca-suave px-4 py-3 text-sm">Primer ingreso: crea la cuenta del administrador. Después podrás crear a los demás usuarios en Ajustes.</p>
            <Etiqueta texto="Nombre completo" requerido><input name="nombre" className="campo" required /></Etiqueta>
            <Etiqueta texto="Correo" requerido><input name="correo" type="email" className="campo" required autoComplete="username" /></Etiqueta>
            <Etiqueta texto="Contraseña común (mínimo 10 caracteres)" requerido><input name="clave" type="password" className="campo" required minLength={10} autoComplete="new-password" /></Etiqueta>
            <Etiqueta texto="Repite la contraseña" requerido><input name="clave2" type="password" className="campo" required minLength={10} autoComplete="new-password" /></Etiqueta>
            <p className="text-xs text-tenue">Todas las personas entrarán con su propio correo y esta contraseña. Puedes cambiarla después en Ajustes.</p>
            <Boton className="w-full">Crear administrador</Boton>
          </form>
        ) : (
          <form action={ingresar} className="space-y-4">
            <Etiqueta texto="Correo"><input name="correo" type="email" className="campo" required autoComplete="username" /></Etiqueta>
            <Etiqueta texto="Contraseña"><input name="clave" type="password" className="campo" required autoComplete="current-password" /></Etiqueta>
            <Boton className="w-full">Ingresar</Boton>
          </form>
        )}
      </Tarjeta>
    </main>
  );
}
