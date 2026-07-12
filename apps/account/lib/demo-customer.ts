/** Demo identity for account.arciin.com prototype (no real auth). */
export const DEMO_CUSTOMER = {
  name: "Demo Customer",
  email: "you@yourserver.com",
} as const

export const INSTALL_COMMAND = "curl -fsSL https://get.arciin.com/install.sh | bash"

export const DOCKER_INSTALL_HINT = `mkdir -p /srv/arciin && cd /srv/arciin
# place docker-compose.yml + .env from your private release
docker compose pull && docker compose up -d`

export const APP_VERSION = "0.1.0-dev"
export const RELEASE_CHANNEL = "stable" as const
