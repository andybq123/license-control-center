# Implantar na VPS: passo a passo para copiar e colar

Funciona em Ubuntu 22.04/24.04 ou Debian 12. Troque o que estiver em **MAIÚSCULAS**.

## Jeito rápido: script automático (recomendado)

Depois do **Passo 1** (entrar na VPS) e do **Passo 2** (instalar Docker e Git), rode:

```bash
cd /opt/projeto/sistema-licencas
sudo bash instalar.sh
```

O script `instalar.sh` faz o resto sozinho: instala o Docker se faltando, pergunta
domínio/e-mail/senha, confere o DNS, gera o `.env`, sobe tudo com `docker compose`
e confere se o painel ficou no ar. Depois é só seguir o **Passo 6** para conferir.

---

## Passo 0: antes de começar

1. No seu provedor de domínio, crie um registro **A**:
   `licencas.SEUDOMINIO.com` → **IP da sua VPS**
2. Libere as portas **80** e **443** no painel da VPS (firewall do provedor).
3. Pegue a URL do seu repositório no GitHub (botão verde **Code**).

---

## Passo 1: entrar na VPS

No seu computador:

```bash
ssh root@IP_DA_VPS
```

## Passo 2: instalar Docker e Git

```bash
apt update && apt install -y git curl
curl -fsSL https://get.docker.com | sh
```

## Passo 3: baixar o projeto do GitHub

Se o repositório é **privado**, crie um token em GitHub → Settings → Developer settings →
Personal access tokens. Use o token como senha quando o Git pedir.

```bash
cd /opt
git clone https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git projeto
cd /opt/projeto/sistema-licencas
```

## Passo 4: configurar

```bash
cp .env.example .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
nano .env
```

No editor, ajuste:

```
DOMAIN=licencas.SEUDOMINIO.com
ADMIN_EMAIL=SEU@EMAIL.com
ADMIN_PASSWORD=UMA_SENHA_FORTE
```

Salve com `Ctrl+O`, `Enter`, depois saia com `Ctrl+X`.

## Passo 5: subir o sistema

```bash
docker compose up -d --build
```

Espere 1 ou 2 minutos e abra **https://licencas.SEUDOMINIO.com**.
O certificado HTTPS é criado e renovado sozinho.

## Passo 6: conferir

```bash
docker compose ps                 # os dois serviços devem estar "running"
docker compose logs -f app        # logs do sistema (Ctrl+C para sair)
curl https://licencas.SEUDOMINIO.com/health   # deve responder {"ok":true}
```

Pegue a chave pública para colar no `client/license-client.js` do seu sistema:

```bash
curl https://licencas.SEUDOMINIO.com/api/v1/public-key
```

---

## Atualizar depois de mudanças no GitHub

```bash
cd /opt/projeto && git pull
cd sistema-licencas && docker compose up -d --build
```

## Backup diário automático (recomendado)

```bash
mkdir -p /opt/backups
(crontab -l 2>/dev/null; echo "0 3 * * * tar czf /opt/backups/licencas-\$(date +\%F).tgz -C /opt/projeto/sistema-licencas data") | crontab -
```

A pasta `data/` guarda o banco e a chave de assinatura. **Nunca apague**
`data/signing_private.pem`. Sem ela, os sistemas que já usam a chave pública param de validar.

## Problemas comuns

| Sintoma | Solução |
|---|---|
| Site não abre / erro de certificado | Confira o registro A (`ping licencas.SEUDOMINIO.com` deve mostrar o IP da VPS) e as portas 80/443. Veja `docker compose logs caddy`. |
| Não consigo entrar no painel | O admin só é criado na primeira vez. Para recriar: `docker compose down && rm -rf data && docker compose up -d` (**apaga tudo**). |
| Mudei o `.env` e nada mudou | `docker compose up -d --force-recreate` |
| Firewall do Ubuntu ativo | `ufw allow 80 && ufw allow 443 && ufw allow OpenSSH` |
