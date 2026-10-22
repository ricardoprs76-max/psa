// Copia a public/ los archivos que MapLibre carga en tiempo de ejecución (su proceso auxiliar).
import fs from "node:fs";
const origen = "node_modules/maplibre-gl/dist/";
fs.mkdirSync("public/maplibre", { recursive: true });
for (const archivo of fs.readdirSync(origen)) {
  if (/^maplibre-gl-(worker|shared)\.mjs$/.test(archivo)) fs.copyFileSync(origen + archivo, "public/maplibre/" + archivo);
}
