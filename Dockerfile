FROM node:24.18.0-alpine3.23 AS development

WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html ./
COPY assets/ ./assets/
COPY server/ ./server/
COPY shared/ ./shared/

EXPOSE 8080
CMD ["npm", "run", "dev"]

FROM node:24.18.0-alpine3.23 AS production

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node index.html ./
COPY --chown=node:node assets/ ./assets/
COPY --chown=node:node server/ ./server/
COPY --chown=node:node shared/ ./shared/

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
