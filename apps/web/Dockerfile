FROM node:22-slim AS build
WORKDIR /srv
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /srv
ENV NODE_ENV=production
COPY --from=build /srv/.next ./.next
COPY --from=build /srv/node_modules ./node_modules
COPY --from=build /srv/package.json ./
COPY --from=build /srv/public ./public
# `next start` reloads the config FILE at runtime (route headers come from
# .next/routes-manifest, but server options like `poweredByHeader` are read
# from next.config via loadConfig — without this file the runtime would fall
# back to Next defaults and re-add `x-powered-by: Next.js`, spec §6).
COPY --from=build /srv/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["npm", "start"]
