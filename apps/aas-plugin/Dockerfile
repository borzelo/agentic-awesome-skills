# Build from the repository root: docker build -f apps/aas-plugin/Dockerfile .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps/web-app/package.json apps/web-app/package-lock.json ./apps/web-app/
COPY apps/aas-plugin/package.json apps/aas-plugin/package-lock.json ./apps/aas-plugin/
RUN npm --prefix apps/web-app ci --ignore-scripts && npm --prefix apps/aas-plugin ci --ignore-scripts --omit=dev
COPY apps/web-app ./apps/web-app
COPY apps/aas-plugin ./apps/aas-plugin
COPY schemas ./schemas
COPY docs/examples ./docs/examples
COPY data/aas-v1 ./data/aas-v1
COPY data/catalog.json ./data/catalog.json
COPY tools/lib ./tools/lib
COPY skills ./skills
RUN npm run plugin:build
FROM node:24-bookworm-slim
ENV NODE_ENV=production AAS_BIND=0.0.0.0 PORT=3100
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/tools/lib ./tools/lib
COPY --from=build --chown=node:node /app/schemas ./schemas
COPY --from=build --chown=node:node /app/data/aas-v1 ./data/aas-v1
COPY --from=build --chown=node:node /app/data/catalog.json ./data/catalog.json
COPY --from=build --chown=node:node /app/skills ./skills
COPY --from=build --chown=node:node /app/apps/aas-plugin ./apps/aas-plugin
COPY --from=build --chown=node:node /app/.tmp/aas-plugin/workbench.html ./.tmp/aas-plugin/workbench.html
USER node
EXPOSE 3100
CMD ["node", "apps/aas-plugin/src/start.mjs"]
