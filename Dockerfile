FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.html scripts.js styles.css app.css money.js ./
COPY vendor ./vendor
COPY server ./server
USER node
EXPOSE 3000
# With TLS_CERT_FILE the server answers HTTPS only; override this check in that case.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
# Migrations are applied before every start; they keep the existing data.
CMD ["sh", "-c", "node server/init.js && node server/index.js"]
