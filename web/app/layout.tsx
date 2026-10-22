import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sistema PSA",
  description: "Gestión de Pagos por Servicios Ambientales",
};

// Aplica el modo oscuro guardado antes de pintar, para que la página no parpadee en claro.
const tema = `try{var t=localStorage.getItem('psa-tema');if(t==='oscuro'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: tema }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
