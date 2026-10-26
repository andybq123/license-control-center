#!/usr/bin/env bash
# =============================================================================
# Instalador automático do Sistema de Licenciamento
#
# O que ele faz:
#   1. Confere se está rodando como root em Ubuntu/Debian
#   2. Instala Docker e Docker Compose se faltarem
#   3. Pergunta só o subdomínio e o e-mail do HTTPS (o admin é gerado sozinho)
#   4. Confere se o domínio aponta para o IP da VPS
#   5. Gera o arquivo .env (com JWT_SECRET aleatório)
#   6. Sobe tudo com docker compose e confere se ficou no ar
#
# Como usar (dentro da pasta sistema-licencas do repositório clonado):
#   sudo bash instalar.sh
# =============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

bold()  { echo -e "\e[1m$*\e[0m"; }
ok()    { echo -e "  ✅ $*"; }
warn()  { echo -e "  ⚠️  $*"; }
fail()  { echo -e "  ❌ $*"; exit 1; }

echo ""
bold "════════════════════════════════════════════════════════════"
bold "  Instalador do Sistema de Licenciamento"
bold "════════════════════════════════════════════════════════════"
echo ""

# ---------------------------------------------------------------------------
# 1. Pré-requisitos
# ---------------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  warn "Não está rodando como root. Tentando com sudo..."
  SUDO="sudo"
else
  SUDO=""
fi

if [ -r /etc/os-release ]; then
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ok "Sistema detectado: $PRETTY_NAME" ;;
    *) warn "Sistema não testado ($ID). Vou continuar mesmo assim." ;;
  esac
fi

# ---------------------------------------------------------------------------
# 2. Docker
# ---------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1; then
  ok "Docker já instalado: $(docker --version | cut -d' ' -f3 | tr -d ',')"
else
  bold "→ Instalando Docker (pode levar alguns minutos)..."
  $SUDO apt-get update -y >/dev/null
  $SUDO apt-get install -y git curl >/dev/null
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
  ok "Docker instalado"
fi

if docker compose version >/dev/null 2>&1; then
  ok "Docker Compose disponível"
else
  fail "Docker Compose não encontrado. Instale o Docker novamente."
fi

# ---------------------------------------------------------------------------
# 3. Perguntas (só duas: subdomínio e e-mail do HTTPS)
# ---------------------------------------------------------------------------
ask() {
  local pergunta="$1" valor
  read -r -p "$pergunta: " valor </dev/tty
  echo "$valor"
}

if [ -f .env ]; then
  warn "Já existe uma instalação. Vou reaproveitar as configurações e o admin atuais."
  # shellcheck disable=SC1091
  source .env
fi

echo ""
bold "→ Só preciso de 2 informações:"
DOMAIN=${DOMAIN:-}
while [ -z "$DOMAIN" ]; do
  DOMAIN=$(ask "Subdomínio do painel (ex.: licencas.seudominio.com)")
  DOMAIN=$(echo "$DOMAIN" | sed -E 's#^https?://##; s#/.*$##')
done
ACME_EMAIL=${ACME_EMAIL:-}
while [[ ! "$ACME_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; do
  ACME_EMAIL=$(ask "E-mail para o certificado HTTPS")
done

# Tudo o resto é gerado automaticamente
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@$DOMAIN}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 16)}
JWT_SECRET=${JWT_SECRET:-$(openssl rand -hex 32)}
ONLINE_MINUTES=${ONLINE_MINUTES:-15}

# ---------------------------------------------------------------------------
# 4. Conferir DNS
# ---------------------------------------------------------------------------
SERVER_IP=$(curl -s --max-time 10 https://api.ipify.org || echo "")
DOMAIN_IP=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1; exit}' || true)

echo ""
if [ -n "$SERVER_IP" ] && [ -n "$DOMAIN_IP" ]; then
  if [ "$SERVER_IP" = "$DOMAIN_IP" ]; then
    ok "DNS conferido: $DOMAIN → $DOMAIN_IP"
  else
    warn "O domínio $DOMAIN aponta para $DOMAIN_IP, mas o IP desta VPS é $SERVER_IP."
    warn "O HTTPS só vai funcionar depois de corrigir o registro A. Instalando mesmo assim..."
  fi
else
  warn "Não consegui conferir o DNS agora (sem internet ou domínio novo). Seguindo..."
fi

# ---------------------------------------------------------------------------
# 5. Escrever o .env
# ---------------------------------------------------------------------------
bold "→ Criando o arquivo .env..."
cat > .env <<EOF
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
JWT_SECRET=$JWT_SECRET
ONLINE_MINUTES=$ONLINE_MINUTES
EOF
chmod 600 .env
ok ".env criado"

# ---------------------------------------------------------------------------
# 6. Subir
# ---------------------------------------------------------------------------
echo ""
bold "→ Subindo o sistema (a primeira compilação leva 1-2 minutos)..."
$SUDO docker compose up -d --build

# Aguardar o app responder
echo -n "  Aguardando o painel subir"
for i in $(seq 1 60); do
  if $SUDO docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    echo ""
    ok "Painel no ar!"
    break
  fi
  echo -n "."
  sleep 2
done

if ! $SUDO docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  echo ""
  warn "O painel ainda não respondeu. Veja os logs: sudo docker compose logs -f app"
fi

# ---------------------------------------------------------------------------
# 7. Resumo
# ---------------------------------------------------------------------------
echo ""
bold "════════════════════════════════════════════════════════════"
bold "  Instalação concluída!"
bold "════════════════════════════════════════════════════════════"
echo ""
echo "  Painel:   https://$DOMAIN"
echo "  Login:    $ADMIN_EMAIL"
echo "  Senha:    $ADMIN_PASSWORD   (troque no painel depois de entrar)"
echo "  Guardado em: $APP_DIR/CREDENCIAIS.txt"
echo "  Saúde:    curl https://$DOMAIN/health  (deve responder {\"ok\":true})"
echo ""
echo "  Chave pública para o license-client.js:"
echo "    curl https://$DOMAIN/api/v1/public-key"
echo ""
echo "  O HTTPS (certificado) é emitido pelo Caddy em até ~2 minutos."
echo "  Se o site não abrir, confira o registro A e as portas 80/443,"
echo "  e veja os logs: sudo docker compose logs -f caddy"
echo ""

# Backup diário automático (03h)
mkdir -p /opt/backups
if ! crontab -l 2>/dev/null | grep -q "licencas-"; then
  (crontab -l 2>/dev/null; echo "0 3 * * * tar czf /opt/backups/licencas-\$(date +\%F).tgz -C $APP_DIR data && find /opt/backups -name 'licencas-*.tgz' -mtime +14 -delete") | crontab -
fi
ok "Backup diário às 03h em /opt/backups (guarda 14 dias)"

# Salvar credenciais num arquivo só do root
cat > "$APP_DIR/CREDENCIAIS.txt" <<EOF
Painel: https://$DOMAIN
Login:  $ADMIN_EMAIL
Senha:  $ADMIN_PASSWORD
(Troque a senha no painel, aba Administradores)
EOF
chmod 600 "$APP_DIR/CREDENCIAIS.txt"

echo ""
ok "Pronto! Acesse https://$DOMAIN e entre com o login e a senha acima."
