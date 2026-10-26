# Sistema de Licenciamento (License Control Center)

Painel para cadastrar clientes, gerar chaves de licença e acompanhar cada instalação
(URL, IP, status online/offline e região). As licenças são validadas na instalação
do sistema do cliente; se forem inválidas, a instalação é bloqueada.

> **Como instalar na VPS: passo a passo para copiar e colar está logo abaixo,**
> **e também no arquivo [`sistema-licencas/IMPLANTAR-NA-VPS.md`](./sistema-licencas/IMPLANTAR-NA-VPS.md).**

## Instalação automática (recomendado)

Depois de entrar na VPS, instalar Docker e Git e clonar o repositório (passos abaixo),
basta rodar um comando e responder as perguntas:

```bash
cd /opt/projeto/sistema-licencas
sudo bash instalar.sh
```

O script instala o Docker se faltando, pergunta domínio/e-mail/senha do admin,
confere o DNS, gera o `.env`, sobe tudo com `docker compose` e avisa quando o
painel estiver no ar. Também oferece criar o backup diário automático.

## O que tem no repositório

| Pasta / arquivo | O que é |
|---|---|
| `sistema-licencas/` | O sistema de licenciamento completo (painel + API), pronto para rodar na VPS com Docker |
| `sistema-licencas/client/license-client.js` | Biblioteca para integrar no **seu** sistema (valida na instalação e mantém o heartbeat) |
| `sistema-licencas/instalar.sh` | Script que faz a instalação na VPS sozinho |
| `sistema-licencas/LEIA-ME.md` | Manual de uso do painel e da integração |
| `sistema-licencas/IMPLANTAR-NA-VPS.md` | Guia de implantação na VPS |

---

# Instalar o sistema na VPS (passo a passo)

Funciona em Ubuntu 22.04/24.04 ou Debian 12. Troque o que estiver em **MAIÚSCULAS**.

## Passo 0: antes de começar

1. No seu provedor de domínio, crie um registro **A**:
   `licencas.SEUDOMINIO.com` → **IP da sua VPS**
2. Libere as portas **80** e **443** no painel da VPS (firewall do provedor).
3. Pegue a URL deste repositório no GitHub (botão verde **Code**).

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

Se o repositório for **privado**, crie um token em GitHub → Settings → Developer settings →
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
O certificado HTTPS é criado e renovado sozinho (Caddy + Let's Encrypt).

## Passo 6: conferir

```bash
docker compose ps                              # os dois serviços devem estar "running"
docker compose logs -f app                     # logs do sistema (Ctrl+C para sair)
curl https://licencas.SEUDOMINIO.com/health    # deve responder {"ok":true}
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

---

# Integrar no seu sistema (o que será licenciado)

Copie `sistema-licencas/client/license-client.js` para o seu projeto.

**No instalador** (bloqueia se a licença não for válida):

```js
import { activate } from "./license-client.js";
const r = await activate({ server: "https://licencas.SEUDOMINIO.com", key: chaveDigitada, url: "https://app.cliente.com", version: "1.0.0" });
if (!r.valid) { console.error(r.message); process.exit(1); }
```

**No sistema rodando** (mantém o status online e bloqueia se revogarem):

```js
import { startHeartbeat } from "./license-client.js";
startHeartbeat({ server, key, url, version: "1.0.0", onInvalid: (r) => { /* desativar o sistema */ } });
```

Mais detalhes (outras linguagens via API HTTP, curinga de domínio, códigos de bloqueio):
veja [`sistema-licencas/LEIA-ME.md`](./sistema-licencas/LEIA-ME.md).

---

This project was built with [Lovable](https://lovable.dev).
