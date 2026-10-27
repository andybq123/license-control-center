#!/usr/bin/env bash
# Atualiza o painel de licenças com a versão do GitHub, sem tocar em .env, banco ou credenciais.
set -euo pipefail
cd "$(dirname "$0")/.."
RAMO=$(git remote show origin | sed -n 's/.*HEAD branch: //p')
RAMO=${RAMO:-main}
echo "• Ramo: $RAMO"
git config --global --add safe.directory "$(pwd)" || true
git fetch origin "$RAMO"
echo "• Versão atual: $(git rev-parse --short HEAD)  →  GitHub: $(git rev-parse --short origin/$RAMO)"
git reset --hard "origin/$RAMO"
cd sistema-licencas
docker compose up -d --build
echo "✔ Painel atualizado para $(git rev-parse --short HEAD). Aperte Ctrl+F5 no navegador."
