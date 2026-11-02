#!/usr/bin/env bash
# Prepara a VM da Oracle Cloud (Ubuntu 24.04, ARM) para o Contorno, uma vez (ADR-015).
# Pode rodar de novo: cada passo confere se já foi feito.
# Na VM, como root, com atualizar.sh na mesma pasta:
#   sudo DUCKDNS_SUBDOMINIO=contorno DUCKDNS_TOKEN=... \
#        NOMINATIM_USER_AGENT="Contorno/0.1 (contato: ...)" \
#        CHAVE_DEPLOY="ssh-ed25519 AAAA... contorno-deploy-github" \
#        bash instalar.sh
# Depois, o primeiro deploy: sudo -u deploy contorno-atualizar <versão>
set -euo pipefail

: "${DUCKDNS_SUBDOMINIO:?defina DUCKDNS_SUBDOMINIO (só o nome, sem .duckdns.org)}"
: "${DUCKDNS_TOKEN:?defina DUCKDNS_TOKEN}"
: "${NOMINATIM_USER_AGENT:?defina NOMINATIM_USER_AGENT, com contato (política do Nominatim)}"
: "${CHAVE_DEPLOY:?defina CHAVE_DEPLOY, a chave pública do workflow de deploy}"

AQUI="$(cd "$(dirname "$0")" && pwd)"
REPO=https://github.com/frsrodrigobocayuva/Contorno.git
DESTINO=/opt/contorno
DOMINIO="$DUCKDNS_SUBDOMINIO.duckdns.org"
export DEBIAN_FRONTEND=noninteractive

echo "== 1/7 Firewall: portas 80 e 443"
# A imagem Ubuntu da Oracle só aceita a 22 no iptables (a Security List da VCN também precisa
# liberar 80 e 443). A regra entra na hora e no rules.v4, sem salvar as regras do Docker.
for porta in 80 443; do
	iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport "$porta" -j ACCEPT 2>/dev/null ||
		iptables -I INPUT 1 -p tcp -m state --state NEW -m tcp --dport "$porta" -j ACCEPT
	regra="-A INPUT -p tcp -m state --state NEW -m tcp --dport $porta -j ACCEPT"
	if [ -f /etc/iptables/rules.v4 ] && ! grep -qxF -- "$regra" /etc/iptables/rules.v4; then
		sed -i "/--dport 22 -j ACCEPT/a $regra" /etc/iptables/rules.v4
	fi
done

echo "== 2/7 Swap de 2 GB (folga para o build na VM de 4 GB)"
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
	[ -f /swapfile ] || fallocate -l 2G /swapfile
	chmod 600 /swapfile
	mkswap /swapfile >/dev/null
	swapon /swapfile
	grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

echo "== 3/7 Docker (repositório oficial)"
if ! command -v docker >/dev/null; then
	apt-get update -q
	apt-get install -y -q ca-certificates curl git
	install -m 0755 -d /etc/apt/keyrings
	curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
	chmod a+r /etc/apt/keyrings/docker.asc
	# shellcheck source=/dev/null
	codinome="$(. /etc/os-release && echo "$VERSION_CODENAME")"
	cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $codinome
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
	apt-get update -q
	apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

echo "== 4/7 Usuário deploy e cópia do repositório"
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
# Sem senha, mas não bloqueado ("*", não "!"): entra só por chave.
usermod -p '*' deploy
usermod -aG docker deploy
if [ ! -d "$DESTINO/.git" ]; then
	install -d -o deploy -g deploy "$DESTINO"
	sudo -u deploy git clone --quiet "$REPO" "$DESTINO"
fi

echo "== 5/7 .env de produção"
# Os valores medidos vêm do .env.example; só o contato e o domínio são da VM.
if [ ! -f "$DESTINO/.env" ]; then
	{
		grep -v '^NOMINATIM_USER_AGENT=' "$DESTINO/.env.example"
		echo
		echo "# Produção (ADR-015)"
		echo "NOMINATIM_USER_AGENT=$NOMINATIM_USER_AGENT"
		echo "DOMINIO=$DOMINIO"
	} >"$DESTINO/.env"
	chown deploy:deploy "$DESTINO/.env"
	chmod 600 "$DESTINO/.env"
fi

echo "== 6/7 Atualização restrita para o workflow de deploy"
install -m 0755 -o root -g root "$AQUI/atualizar.sh" /usr/local/bin/contorno-atualizar
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
# A chave do GitHub só roda o contorno-atualizar: sem shell, túnel nem terminal.
printf 'command="/usr/local/bin/contorno-atualizar",restrict %s\n' "$CHAVE_DEPLOY" \
	>/home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

echo "== 7/7 DuckDNS: $DOMINIO aponta para o IP desta VM"
install -d -m 700 /etc/contorno
printf '%s\n' "$DUCKDNS_TOKEN" >/etc/contorno/duckdns-token
chmod 600 /etc/contorno/duckdns-token
cat >/usr/local/bin/contorno-duckdns <<EOF
#!/bin/sh
# Mantém $DOMINIO apontando para o IP público desta VM (ip vazio: o DuckDNS usa o de origem).
# O token vai pelo stdin do curl, para não aparecer na lista de processos.
printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip="\n' \\
	"$DUCKDNS_SUBDOMINIO" "\$(cat /etc/contorno/duckdns-token)" |
	curl -fsS --max-time 20 -K -
EOF
chmod 0755 /usr/local/bin/contorno-duckdns
echo '*/5 * * * * root /usr/local/bin/contorno-duckdns >/dev/null 2>&1' >/etc/cron.d/contorno-duckdns
resposta="$(/usr/local/bin/contorno-duckdns)"
echo "DuckDNS: $resposta"
[ "$resposta" = "OK" ]

echo "== Pronto. Primeiro deploy: sudo -u deploy contorno-atualizar <versão>"
