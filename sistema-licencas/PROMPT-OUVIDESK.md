# Prompt para colar no projeto do OuviDesk (Ouvidoria)

Copie tudo abaixo da linha e cole no chat do projeto da Ouvidoria.

---

Integre o OuviDesk ao servidor de licenças em `https://licenca.chatizy.com.br` com heartbeat automático e modo bloqueado (somente consulta).

**1. Heartbeat automático (VPS)**
- Crie `local-docker/deploy/heartbeat-licenca.sh`. Ele usa as mesmas funções do `comum.sh` (`licenca_url`, `instalacao_id`, `.licenca`, domínio de `APP_DOMAIN`) e envia `POST ${LICENCA_URL}/api/public/heartbeat` com `{chave, dominio, instalacao_id, versao}`. A resposta (sempre HTTP 200) é `{valida, mensagem, codigo}`.
- Instale um timer systemd que rode o script a cada 30 segundos (`OnBootSec=10s`, `OnUnitActiveSec=30s`, `AccuracySec=1s`, `RandomizedDelaySec=0`). Remova o timer/cron antigo de 5 ou 10 minutos para não duplicar chamadas. O `instalar.sh` e o `atualizar.sh` devem instalar o timer automaticamente, e a opção "Trocar a licença" em Ferramentas também.
- Use timeout total de 10 segundos por chamada HTTPS, sem execuções sobrepostas. O servidor retorna `proxima_verificacao_segundos: 30`. O bloqueio e o desbloqueio devem chegar ao banco e à interface em até 60 segundos, quando as VPS estão acessíveis. Leia o estado na interface a cada 10 segundos ou use uma assinatura em tempo real. Verifique o bloqueio antes de cada escrita e de cada tarefa do agente 1Doc/e-mails; não dependa somente de um ciclo demorado. Teste as duas transições cronometradas com sessão real de admin e usuário comum.
- Grave o resultado no banco local numa tabela única `licenca_estado (id=1, bloqueado bool, motivo text, codigo text, verificado_em timestamptz)`. Crie a migração nas atualizações de banco existentes.
- Regras do resultado:
  - `codigo = instance_blocked`, `revoked`, `suspended` ou `expired` → `bloqueado=true` com a `mensagem` como motivo.
  - `valida=true` → `bloqueado=false`.
  - Servidor fora do ar → não muda nada, o último estado continua valendo. Só registre no log.

**2. Modo bloqueado (somente consulta)**
- O servidor precisa travar as alterações também no backend, não só nas telas. Toda função de servidor ou rota que grava dados (criar, editar, excluir, importar, configurações, usuários) checa `licenca_estado.bloqueado` e recusa com a mensagem "Sistema bloqueado pela licença: somente consulta". A leitura continua funcionando para todos.
- O agente 1Doc (`local-docker/agente-1doc`) não executa nenhuma tarefa enquanto estiver bloqueado: confere o estado a cada ciclo e fica parado.
- A sincronização e coleta de e-mails (ingestão, incluindo `api/public/ingest-protocolos`) também fica parada enquanto estiver bloqueado.
- Admins (`has_role admin`): na entrada do sistema aparece uma tela ou aviso de bloqueio com o motivo, a data da última verificação e o texto "O sistema está em modo somente consulta. Entre em contato com o fornecedor da licença.". Depois o admin pode fechar o aviso e navegar por tudo; uma faixa vermelha fixa no topo continua avisando.
- Usuários comuns: não veem aviso nenhum, mas todos os botões, formulários e ações de edição ficam desabilitados.
- Crie um hook `useLicencaBloqueada()` para a interface, lendo o estado por uma função de servidor, e use em todos os botões e formulários de edição.
- Quando a licença voltar a ficar válida (próximo heartbeat), tudo volta ao normal sozinho, sem reiniciar.

**3. Testes**
- Escreva um teste para a regra que converte a resposta do servidor em `bloqueado` (blocked, revoked, suspended e expired bloqueiam; valid libera; unreachable mantém o estado anterior).
- Escreva um teste para garantir que uma função de gravação recusa a operação quando o estado está bloqueado.
- Teste que o intervalo de heartbeat é 30 segundos, o timeout é 10 segundos e que a propagação completa de bloqueio e desbloqueio não excede 60 segundos com rede disponível.
