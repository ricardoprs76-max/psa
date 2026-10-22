# Sistema PSA publicado en internet. Los datos no viven en este contenedor: al encender se bajan de Google Drive
# (carpeta "Proyecto PSA") y cada cambio se sube allí. Variables que hay que definir en el servicio de alojamiento:
#   PSA_NUBE_URL    dirección de la aplicación web de Apps Script (nube/Codigo.gs), termina en /exec
#   PSA_NUBE_TOKEN  la misma contraseña que quedó en TOKEN dentro de Codigo.gs
#   PSA_SECRETO     texto largo al azar: firma las sesiones y cifra la clave de IA (no cambiarlo después)
FROM node:22-bookworm-slim
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node supabase ./supabase
COPY --chown=node:node web/package.json web/package-lock.json web/copiar-mapa.mjs ./web/
WORKDIR /app/web
RUN npm ci --no-audit --no-fund
COPY --chown=node:node web ./
RUN npm run build
ENV NODE_ENV=production PORT=7860 PSA_DIR_DATOS=/tmp/psa-datos PSA_NOMBRE_SERVIDOR=servidor-en-la-nube
EXPOSE 7860
CMD ["sh", "-c", "exec node_modules/.bin/next start -H 0.0.0.0 -p ${PORT}"]
