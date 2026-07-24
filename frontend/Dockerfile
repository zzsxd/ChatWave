FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --global npm@11.6.2 \
    && npm ci --no-audit --no-fund

COPY . .

ARG NEXT_PUBLIC_CHATWAVE_API_URL
ENV NEXT_PUBLIC_CHATWAVE_API_URL=${NEXT_PUBLIC_CHATWAVE_API_URL}

RUN npx next build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
