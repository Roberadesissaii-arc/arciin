import { describe, expect, it } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

/**
 * What the three production images are allowed to look like.
 *
 * They used to be three Dockerfiles that built the same things down three
 * chains Docker could not recognise as equal: 328MB shared, ~3.55GB unique
 * each, about 11GB to hold one release. Two costs dominated — every image ran
 * `pnpm install --prod` against the root manifest under a differently-hashed
 * prefix, and every image finished with `chown -R 1000:1000 /app`, which
 * rewrote metadata across node_modules and copied all of it into a second
 * 1.01GB layer. One file with shared stages, and files created owned by 1000
 * in the first place, took the set to ~3.04GB on disk.
 *
 * The Prisma pin is here because losing it is silent. Prisma picks its engine
 * by shelling out to `ldconfig`, which is in /sbin and off a non-root PATH;
 * generating as uid 1000 produced a client built for debian-openssl-1.1.x on a
 * bookworm/OpenSSL-3 runtime. `new PrismaClient()` still succeeded. Only the
 * first query failed — so a smoke test that merely boots the image would have
 * called it green.
 */

const root = path.resolve(__dirname, "..")
const dockerfileRaw = readFileSync(path.join(root, "Dockerfile"), "utf8")
/** Instructions only. The comments in this file discuss the very things we forbid. */
const dockerfile = dockerfileRaw
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n")

describe("one Dockerfile, three targets", () => {
  it("replaced the three separate files", () => {
    for (const stale of ["Dockerfile.api", "Dockerfile.web", "Dockerfile.worker"]) {
      expect(existsSync(path.join(root, stale)), `${stale} must be gone`).toBe(false)
    }
    expect(existsSync(path.join(root, "Dockerfile"))).toBe(true)
  })

  it("declares the three runtime targets", () => {
    for (const target of ["api", "worker", "web"]) {
      expect(dockerfile).toMatch(new RegExp(`AS ${target}$`, "m"))
    }
  })

  it("builds the expensive dependency layer once, in a shared stage", () => {
    expect(dockerfile).toMatch(/FROM manifests AS prod-deps/)
    // Exactly one production install in the whole file — that is the point.
    const installs = dockerfile.match(/pnpm install --frozen-lockfile --prod/g) ?? []
    expect(installs).toHaveLength(1)
  })

  it("gives api and worker a shared media stage that web never inherits", () => {
    expect(dockerfile).toMatch(/FROM prod-deps AS media/)
    expect(dockerfile).toMatch(/FROM media AS api/)
    expect(dockerfile).toMatch(/FROM media AS worker/)
    // web branches off before the media toolchain.
    expect(dockerfile).toMatch(/FROM prod-deps AS web/)
  })

  it("never chowns the dependency tree into a duplicate layer", () => {
    expect(dockerfile).not.toMatch(/chown -R\s+1000:1000\s+\/app/)
    expect(dockerfile).toMatch(/COPY --chown=1000:1000/)
  })

  it("runs every target as uid 1000", () => {
    const userLines = dockerfile.match(/^USER .*/gm) ?? []
    expect(userLines.length).toBeGreaterThan(0)
    // Root appears only to install system packages, never as a final USER.
    for (const target of ["api", "worker", "web"]) {
      const stage = dockerfile.slice(dockerfile.search(new RegExp(`AS ${target}$`, "m")))
      const nextStage = stage.slice(1).search(/^FROM /m)
      const body = nextStage === -1 ? stage : stage.slice(0, nextStage + 1)
      const users = body.match(/^USER .*/gm) ?? []
      if (users.length > 0) {
        expect(users[users.length - 1], `${target} must end as non-root`).toBe("USER 1000:1000")
      }
    }
  })

  it("keeps the dev toolchain on a stage that never reaches an image", () => {
    // The full install exists exactly once, for the web build only.
    expect(dockerfile).toMatch(/FROM manifests AS build-deps/)
    expect(dockerfile).toMatch(/FROM build-deps AS web-builder/)
    expect(dockerfile).not.toMatch(/FROM (build-deps|web-builder) AS (api|worker|web)$/m)
  })
})

describe("the Prisma engine target is declared, not detected", () => {
  const schema = readFileSync(path.join(root, "prisma", "schema.prisma"), "utf8")

  it("names the Debian OpenSSL 3 runtime the images actually run", () => {
    expect(schema).toMatch(/binaryTargets\s*=\s*\[[^\]]*"debian-openssl-3\.0\.x"/)
  })

  it("keeps native so local development still works", () => {
    expect(schema).toMatch(/binaryTargets\s*=\s*\[\s*"native"/)
  })
})

describe("the build system points at the unified file", () => {
  it("compose builds each service by target", () => {
    const compose = readFileSync(path.join(root, "docker-compose.yml"), "utf8")
    expect(compose).not.toMatch(/Dockerfile\.(api|web|worker)/)
    for (const target of ["api", "worker", "web"]) {
      expect(compose).toMatch(new RegExp(`target: ${target}`))
    }
  })

  it("CI builds each service by target", () => {
    const ci = readFileSync(path.join(root, ".github/workflows/docker.yml"), "utf8")
    expect(ci).not.toMatch(/Dockerfile\.(api|web|worker)/)
    expect(ci).toMatch(/file: Dockerfile/)
    expect(ci).toMatch(/target: \$\{\{ matrix\.service \}\}/)
  })

  it("the build script builds each service by target", () => {
    const sh = readFileSync(path.join(root, "scripts/docker-build-images.sh"), "utf8")
    expect(sh).not.toMatch(/Dockerfile\.(api|web|worker)/)
    expect(sh).toMatch(/--target web/)
    expect(sh).toMatch(/--target api/)
    expect(sh).toMatch(/--target worker/)
  })
})
