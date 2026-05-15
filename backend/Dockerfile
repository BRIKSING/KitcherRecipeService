FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS production
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma

EXPOSE 3000
CMD ["node", "dist/server.js"]

FROM base AS development
ENV NODE_ENV=development
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
EXPOSE 3000
CMD ["npm", "run", "dev"]
