# Corrigir o comando de instalação (usuário sem root)

O erro aconteceu porque a VPS (AWS) entra com o usuário `ubuntu`, que não é administrador. Por isso `apt` e a criação de `/opt/projeto` precisam de `sudo`.

## Para você agora (funciona já, sem esperar mudança)

```bash
REPO=https://github.com/andybq123/license-control-center.git
sudo apt update && sudo apt install -y git curl openssl && \
sudo git clone "$REPO" /opt/projeto && \
cd /opt/projeto/sistema-licencas && sudo bash instalar.sh
```

## O que vou mudar no README

1. Trocar o link de exemplo pelo seu: `https://github.com/andybq123/license-control-center.git`.
2. Colocar `sudo` em todos os comandos do bloco de 1 comando e da seção de atualização (`sudo git pull`).
3. Adicionar nota: em AWS/Ubuntu o usuário é `ubuntu`, então os comandos usam `sudo`; também funciona como root.
4. Lembrar na AWS de liberar portas 80 e 443 no Security Group.
5. Aplicar a mesma correção no guia `sistema-licencas/IMPLANTAR-NA-VPS.md`.
