"use client";

import { BarChart3, Calculator, Footprints, ClipboardList, DatabaseBackup, FolderCheck, ListChecks, Upload, FileStack, FileText, Landmark, LogOut, Map as MapIcon, MapPinned, Moon, Percent, Settings, ShieldAlert, Sun, Trees, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const ICONOS: Record<string, ReactNode> = {
  "/": <BarChart3 size={18} />, "/m/convenios": <Landmark size={18} />, "/m/beneficiarios": <Users size={18} />, "/m/predios": <MapPinned size={18} />,
  "/m/acuerdos": <FileText size={18} />, "/m/pagos": <Wallet size={18} />, "/mapa": <MapIcon size={18} />, "/m/zonas": <Trees size={18} />,
  "/m/costos": <Wallet size={18} />, "/m/ipc": <Percent size={18} />, "/calculadora": <Calculator size={18} />, "/proyecciones": <FileStack size={18} />,
  "/alertas": <ShieldAlert size={18} />, "/visitas": <Footprints size={18} />, "/expedientes": <FolderCheck size={18} />, "/m/diagnosticos": <ClipboardList size={18} />, "/importar": <Upload size={18} />, "/respaldos": <DatabaseBackup size={18} />,
  "/m/tipos_documento": <FileText size={18} />, "/m/listas": <ListChecks size={18} />, "/ajustes": <Settings size={18} />,
};

export type Grupo = { titulo: string; enlaces: { href: string; texto: string; cuenta?: number }[] };

export function Navegacion({ grupos, usuario, rol, conLogo, salir }: { grupos: Grupo[]; usuario: string; rol: string; conLogo: boolean; salir: () => Promise<void> }) {
  const ruta = usePathname();
  const activo = (href: string) => (href === "/" ? ruta === "/" : ruta === href || ruta.startsWith(href + "/"));
  const alternarTema = () => {
    const oscuro = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("psa-tema", oscuro ? "oscuro" : "claro"); } catch { /* sin almacenamiento: el cambio dura esta visita */ }
  };
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-borde bg-tarjeta md:sticky md:top-0 md:h-screen md:w-64 md:border-b-0 md:border-r">
      {conLogo ? (
        <div className="flex items-center gap-3 px-5 py-4">
          <img src="/api/logo" alt="Logo de la entidad" className="h-10 w-auto max-w-[120px] object-contain" />
          <div className="leading-tight">
            <div className="font-semibold">Sistema PSA</div>
            <div className="text-xs text-tenue">Servicios Ambientales</div>
          </div>
        </div>
      ) : (
        <div className="bg-[#14532d] px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <img src="/marca/matica-blanca.png" alt="" className="h-11 w-11" />
            <div className="text-lg font-semibold leading-tight">Sistema PSA</div>
          </div>
          <div className="text-xs text-white/75">Pagos por Servicios Ambientales</div>
        </div>
      )}
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 pt-3 md:block md:flex-1 md:overflow-y-auto">
        {grupos.map((g) => (
          <div key={g.titulo} className="flex gap-1 md:mb-4 md:block">
            <div className="hidden px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-tenue md:block">{g.titulo}</div>
            {g.enlaces.map((e) => (
              <Link key={e.href} href={e.href} className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition-colors ${activo(e.href) ? "bg-marca-suave font-medium text-marca-fuerte" : "hover:bg-marca-suave/60"}`}>
                {ICONOS[e.href]}<span className="flex-1">{e.texto}</span>
                {!!e.cuenta && <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{e.cuenta}</span>}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-2 border-t border-borde px-4 py-3">
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium">{usuario}</div>
          <div className="text-xs text-tenue">{rol}</div>
        </div>
        <button onClick={alternarTema} aria-label="Cambiar entre modo claro y oscuro" className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg hover:bg-marca-suave">
          <Sun size={18} className="hidden dark:block" /><Moon size={18} className="dark:hidden" />
        </button>
        <form action={salir}><button aria-label="Cerrar sesión" className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg hover:bg-marca-suave"><LogOut size={18} /></button></form>
      </div>
    </aside>
  );
}
