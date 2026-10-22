import { Mapa } from "@/components/Mapa";
import { Titulo } from "@/components/ui";
import { exigir, puede } from "@/lib/sesion";

export default async function PaginaMapa() {
  const usuario = await exigir("administrador", "coordinador", "financiero", "consulta");
  return (
    <>
      <Titulo titulo="Mapa" detalle="Predios, zonas de conservación y capas de referencia. Las áreas y los traslapes se calculan en la base de datos." />
      <Mapa puedeEditar={puede(usuario, "administrador", "coordinador")} />
    </>
  );
}
