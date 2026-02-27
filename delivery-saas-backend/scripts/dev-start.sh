#!/bin/sh
echo "[dev-start] Instalando dependencias..."
npm ci --silent

echo "[dev-start] Gerando Prisma Client..."
npx prisma generate

echo "[dev-start] Sincronizando schema com DB..."
npx prisma db push --skip-generate

echo "[dev-start] Iniciando servidor..."
exec npm run dev
