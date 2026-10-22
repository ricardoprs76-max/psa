import * as XLSX from "xlsx";
import { listar } from "@/lib/crud";
import { etiquetaOpcion, MODULOS } from "@/lib/modulos";
import { usuarioActual } from "@/lib/sesion";

/** Descarga en Excel lo mismo que muestra la lista, con sus filtros y búsqueda. */
export async function GET(peticion: Request, { params }: { params: Promise<{ modulo: string }> }) {
  const { modulo: clave } = await params;
  const usuario = await usuarioActual();
  const modulo = MODULOS[clave];
  if (!usuario) return new Response("Sin sesión", { status: 401 });
  if (!modulo || !modulo.ven.includes(usuario.rol)) return new Response("No encontrado", { status: 404 });
  const url = new URL(peticion.url);
  const filtros = Object.fromEntries([...url.searchParams].filter(([k, v]) => k.startsWith("f_") && v).map(([k, v]) => [k.slice(2), v]));
  const { filas } = await listar(clave, { buscar: url.searchParams.get("q") ?? undefined, filtros, limite: 5000 });
  const datos = filas.map((f) => Object.fromEntries(modulo.campos.map((c) => {
    const v = f[c.n];
    const valor = v === null || v === undefined ? "" : c.t === "ref" ? f[`${c.n}__e`] ?? "" : c.t === "opcion" ? etiquetaOpcion(c, v)
      : c.t === "si_no" ? (v ? "Sí" : "No") : c.t === "numero" || c.t === "moneda" || c.t === "entero" ? Number(v) : c.t === "fecha" ? String(v).slice(0, 10) : String(v);
    return [c.e, valor];
  })));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(datos, { header: modulo.campos.map((c) => c.e) }), modulo.titulo.slice(0, 31));
  const archivo = XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(archivo), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${clave}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
