# Étape de base avec les dépendances partagées
FROM node:20-alpine as base

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Étape de build
FROM base as builder

WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY . .

# Construction du client et du serveur
RUN npm run build

# Étape de production
FROM node:20-alpine as production

WORKDIR /app

# Installation des dépendances de production uniquement
COPY package*.json ./
RUN npm ci --omit=dev

# Copie des fichiers nécessaires depuis l'étape de build
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client/dist ./client/dist

# Copie des fichiers de configuration nécessaires
COPY --from=builder /app/vite.config.ts ./

EXPOSE 3000

# Utilisation de cross-env pour définir NODE_ENV
CMD ["npm", "run", "start"]
