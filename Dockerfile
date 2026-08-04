FROM node:24.18.0-alpine3.23 AS development

WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY index.html vite.config.mjs ./
COPY src/ ./src/
COPY assets/ ./assets/
COPY server/ ./server/
COPY shared/ ./shared/
COPY config/ ./repository-config/
RUN mkdir -p /app/data /app/config /app/repository-config && chown -R node:node /app

USER node
EXPOSE 8080 8081
CMD ["npm", "run", "dev:container"]

FROM node:24.18.0-alpine3.23 AS frontend-build

WORKDIR /app
ENV NODE_ENV=production
ARG DEBUG=false
ENV VITE_DEBUG_UI=${DEBUG}

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY index.html vite.config.mjs ./
COPY src/ ./src/
COPY assets/ ./assets/
COPY shared/ ./shared/
RUN npm run build

FROM node:24.18.0-alpine3.23 AS production

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node server/ ./server/
COPY --chown=node:node shared/ ./shared/
COPY --chown=node:node config/ ./repository-config/
COPY --chown=node:node --from=frontend-build /app/dist/ ./dist/
RUN mkdir -p /app/data /app/config /app/repository-config && chown node:node /app/data /app/config /app/repository-config

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
