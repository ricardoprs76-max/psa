import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // La base embebida (PGlite) trae archivos WebAssembly que no se deben empaquetar.
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-postgis", "pg"],
  experimental: {
    // Solicitudes en PDF y archivos de Excel pasan por acciones del servidor.
    serverActions: { bodySizeLimit: "40mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
