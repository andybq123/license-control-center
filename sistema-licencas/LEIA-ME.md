# Sistema de Licenciamento

> **Passo a passo para copiar e colar na VPS:** veja [IMPLANTAR-NA-VPS.md](./IMPLANTAR-NA-VPS.md)


Painel para cadastrar clientes, gerar chaves e acompanhar cada instalação (URL, IP, status online/offline e região).

## 1. Instalar na VPS (Ubuntu/Debian)

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Envie esta pasta para a VPS (ex.: /opt/licencas) e entre nela
cd /opt/licencas
cp .env.example .env
nano .env          # preencha DOMAIN, ADMIN_EMAIL, ADMIN_PASSWORD e JWT_SECRET (openssl rand -hex 32)

docker compose up -d --build
```

Antes de subir, crie no seu provedor de domínio um registro **A** `licencas.seudominio.com → IP da VPS`.
O HTTPS (Let's Encrypt) é emitido e renovado sozinho pelo Caddy. Portas 80 e 443 precisam estar liberadas.

Acesse `https://licencas.seudominio.com` e entre com o e-mail/senha do `.env`.

**Backup:** copie a pasta `data/` (banco + chave de assinatura). Nunca apague `data/signing_private.pem`.

## 2. Usando o painel

- **Clientes**: cadastre quem vai licenciar.
- **Licenças**: escolha o cliente, validade, limite de instalações e domínios → **Gerar chave**.
  - Domínios vazios = a licença trava no domínio da 1ª instalação.
  - Aceita curinga: `*.cliente.com`.
  - Status: Ativa / Suspensa / Revogada (o servidor passa a recusar imediatamente; o sistema instalado aplica na próxima verificação).
- **Instalações**: URL, domínio, IP, cidade/região/país, versão, último contato e status
  (online, offline, bloqueada, licença inválida). Dá pra bloquear uma instalação ou liberar a vaga.
- **Registros**: histórico de todas as tentativas de validação.
- **Administradores**: vários admins, cada um com seu login.

## 3. Integrando no seu sistema (sugestão: Node.js)

Copie `client/license-client.js` para o seu projeto.

**No instalador** (bloqueia se a licença não for válida):

```js
import { activate } from "./license-client.js";
const r = await activate({ server: "https://licencas.seudominio.com", key: chaveDigitada, url: "https://app.cliente.com", version: "1.0.0" });
if (!r.valid) { console.error(r.message); process.exit(1); }
```

**No sistema rodando** (mantém o status online e bloqueia se revogarem):

```js
import { startHeartbeat } from "./license-client.js";
startHeartbeat({ server, key, url, version: "1.0.0", onInvalid: (r) => { /* desativar o sistema */ } });
```

Teste rápido pelo terminal: `node client/license-client.js https://licencas.seudominio.com CHAVE https://app.cliente.com`

**Segurança extra:** pegue a chave pública em `https://licencas.seudominio.com/api/v1/public-key` e cole em
`PUBLIC_KEY` no `license-client.js`. Assim o cliente só aceita respostas assinadas pelo seu servidor.

### Outras linguagens (API HTTP)

`POST /api/v1/activate`, `/api/v1/validate`, `/api/v1/heartbeat`, `/api/v1/deactivate`

```bash
curl -X POST https://licencas.seudominio.com/api/v1/activate \
  -H 'content-type: application/json' \
  -d '{"license_key":"XXXXX-XXXXX-XXXXX-XXXXX-XXXXX","instance_id":"id-unico-da-instalacao","url":"https://app.cliente.com","app_version":"1.0.0"}'
```

Resposta: `{"valid": true|false, "code": "...", "message": "..."}`. Códigos de bloqueio:
`invalid_key, revoked, suspended, expired, domain_not_allowed, install_limit, instance_blocked, not_activated`.

## Observações

- A região vem do IP via ip-api.com (gratuito só para uso não comercial). Para uso comercial, defina
  `GEOIP_URL` no `.env`, ex.: `https://ipapi.co/{ip}/json/`.
- Nenhuma proteção no cliente é inquebrável: se o código-fonte do seu sistema é entregue ao cliente,
  ofusque/compile a parte da checagem.

## Integração com o OuviDesk (Ouvidoria)

O OuviDesk já tem a checagem pronta. Na VPS da ouvidoria, edite
`local-docker/deploy/licenca.conf` e coloque:

```
LICENCA_URL=https://SEU-SUBDOMINIO-DE-LICENCAS
```

A partir daí `deploy.sh instalar` e `deploy.sh atualizar` pedem a chave e chamam
`POST /api/public/validar` (`{chave, dominio, instalacao_id, versao}` → `{valida, mensagem}`).
A instalação aparece no painel com URL, IP, região e status.
Para manter o status "online", instale no OuviDesk um timer a cada **30 segundos** que envie
`POST /api/public/heartbeat` com o mesmo corpo e timeout de 10 segundos. A resposta contém
`proxima_verificacao_segundos: 30`. Veja [PROMPT-OUVIDESK.md](./PROMPT-OUVIDESK.md) para instalar a verificação e aplicar o modo somente consulta.

## Atualização do painel e mapa

Na VPS de licenças, dentro da pasta clonada do repositório:

```bash
git pull
cd sistema-licencas
sudo docker compose up -d --build
```

O mapa fica na **Visão geral** e recupera coordenadas ausentes pelo IP já registrado, sem precisar reinstalar as instâncias. Coordenadas zero são válidas e falhas temporárias não apagam um ponto conhecido. O ponto é aproximado e representa a VPS de saída, não o endereço físico do cliente. Redes locais e provedores de geolocalização indisponíveis não geram pontos fictícios.

**Prazo de bloqueio:** a decisão fica salva imediatamente no painel, mas o prazo de até 60 segundos depende de instalar a verificação de 30 segundos e a aplicação do estado no OuviDesk. Atualizar apenas esta VPS não muda o timer do OuviDesk. Sem conexão, o último estado é mantido e não há garantia desse prazo. O cliente Node oferece `onInvalid`, `onValid` (restaura o uso) e `onUnreachable`.

## Tentativas de instalação e mapa escuro

- O instalador pode enviar cada etapa para `POST /api/public/instalacao-evento` com `{evento, chave, dominio, instalacao_id, versao, resultado, mensagem}`. Elas aparecem na aba **Tentativas** do painel (inclusive chaves erradas).
- Mapa Mapbox escuro: coloque `MAPBOX_TOKEN=pk....` no `.env` e rode `sudo docker compose up -d --build`. Sem token, o painel usa um mapa escuro gratuito.
<!-- sync 2026-10-27T16:41:55Z -->
