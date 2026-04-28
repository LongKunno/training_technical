FROM node:24-alpine AS base

WORKDIR /app

FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build

COPY . .
RUN npm run build

FROM deps AS dev

ENV NODE_ENV=development
ENV HOST=0.0.0.0
ENV PORT=5173
ENV SIMULATOR_UI_CORE_PROXY_TARGET=http://core_trading:8080
ENV SIMULATOR_UI_DATA_PROXY_TARGET=http://data_pipeline:8000
ENV SIMULATOR_UI_BOT_PROXY_TARGET=http://bot_runner:8001

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]

FROM base AS prod-deps

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=80
ENV SIMULATOR_UI_CORE_PROXY_TARGET=http://core_trading:8080
ENV SIMULATOR_UI_DATA_PROXY_TARGET=http://data_pipeline:8000
ENV SIMULATOR_UI_BOT_PROXY_TARGET=http://bot_runner:8001

COPY package.json package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY server ./server
COPY --from=build /app/dist ./dist

EXPOSE 80

CMD ["node", "server/index.js"]
