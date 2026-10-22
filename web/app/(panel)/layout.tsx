import { salir } from "@/app/acciones";
import { Navegacion, type Grupo } from "@/components/Navegacion";
import { q1 } from "@/lib/db";
import { MODULOS } from "@/lib/modulos";
import { programarRespaldos } from "@/lib/respaldo";
import { exigir, puede, ROLES } from "@/lib/sesion";

export default async function Panel({ children }: { children: React.ReactNode }) {
  const usuario = await exigir();
  programarRespaldos();
  const oficina = usuario.rol !== "funcionario_campo";
  const alertas = oficina ? (await q1<{ n: number }>("select count(*)::int as n from alertas_calidad where not resuelta"))!.n : 0;
  const logo = await q1("select 1 from plantillas where tipo = 'logo' and activa");
  const delGrupo = (grupo: string) => Object.entries(MODULOS).filter(([, m]) => m.grupo === grupo && m.ven.includes(usuario.rol)).map(([clave, m]) => ({ href: `/m/${clave}`, texto: m.titulo }));
  const grupos: Grupo[] = [
    { titulo: "Inicio", enlaces: [{ href: "/", texto: "Tablero" }] },
    { titulo: "Gestión", enlaces: delGrupo("Gestión") },
    { titulo: "Territorio", enlaces: oficina ? [{ href: "/mapa", texto: "Mapa" }, ...delGrupo("Territorio"), ...delGrupo("Catálogos")] : [] },
    { titulo: "Proyecciones", enlaces: puede(usuario, "administrador", "coordinador", "financiero") ? [{ href: "/calculadora", texto: "Calculadora" }, { href: "/proyecciones", texto: "Banco de proyecciones" }] : [] },
    { titulo: "Expedientes", enlaces: oficina ? [{ href: "/expedientes", texto: "Listas de chequeo" }, { href: "/visitas", texto: "Visitas de campo" }, ...delGrupo("Expedientes")] : [] },
    { titulo: "Control", enlaces: [...(puede(usuario, "administrador", "coordinador") ? [{ href: "/importar", texto: "Importar datos" }, { href: "/respaldos", texto: "Respaldos" }] : []), ...(oficina ? [{ href: "/alertas", texto: "Calidad de datos", cuenta: alertas }] : []), ...(puede(usuario, "administrador", "coordinador") ? [{ href: "/ajustes", texto: "Ajustes" }] : [])] },
  ].filter((g) => g.enlaces.length);
  return (
    <div className="md:flex">
      <Navegacion grupos={grupos} usuario={usuario.nombre} rol={ROLES[usuario.rol]} conLogo={!!logo} salir={salir} />
      <main className="min-w-0 flex-1 p-5 md:p-8">{children}</main>
    </div>
  );
}
