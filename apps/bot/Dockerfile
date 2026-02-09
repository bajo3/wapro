FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY sql ./sql
COPY catalog ./catalog

RUN npm run build
RUN npm prune --omit=dev


FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/sql ./sql
COPY --from=builder /app/catalog ./catalog

EXPOSE 3000
CMD ["node","dist/index.js"]
