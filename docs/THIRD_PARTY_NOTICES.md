# Third-Party Notices

Arciin is proprietary software. See [`LICENSE`](../LICENSE) for terms governing the Arciin codebase itself.

This document lists open-source components, fonts, and third-party assets used in the project, plus trademark notices for brand logos shown in the UI.

---

## Open-source software

Arciin is built with standard open-source libraries installed via pnpm (MIT, Apache-2.0, ISC, and similar permissive licenses). Major runtime dependencies include:

| Component | License | Notes |
|-----------|---------|-------|
| Next.js, React | MIT | Web UI |
| Fastify | MIT | API server |
| Prisma | Apache-2.0 | Database ORM |
| TanStack Query | MIT | Client data fetching |
| Zustand | MIT | Client UI state |
| Socket.IO | MIT | Realtime events |
| BullMQ | MIT | Background jobs |
| Sharp | Apache-2.0 | Image processing |
| Lucide React | ISC | UI icons (sidebar, buttons, toasts) |
| shadcn/ui + Radix UI | MIT | UI primitives (copied into `apps/web/components/ui/`) |
| Sonner | MIT | Toast notifications |
| pdfjs-dist (Mozilla PDF.js) | Apache-2.0 | PDF preview; WASM binaries under `apps/web/public/pdfjs-wasm/` |
| shiki | MIT | Syntax highlighting |
| Zod | MIT | Schema validation |

Full license texts for npm packages are in `node_modules/<package>/LICENSE` (or equivalent) after `pnpm install`.

---

## Fonts

| Font | Source | License |
|------|--------|---------|
| **Geist** / **Geist Mono** | [Vercel](https://vercel.com/font) via `next/font/google` | SIL Open Font License 1.1 |
| **Space Grotesk** | [floriankarsten/space-grotesk](https://github.com/floriankarsten/space-grotesk) | SIL Open Font License 1.1 — full text in `apps/web/public/fonts/space-grotesk/OFL.txt` |

---

## Brand and service icons

Arciin displays third-party brand logos to **identify** services in the password vault, link import UI, and related views. Logos are **not** used to imply endorsement, partnership, or sponsorship.

### Icon collections

| Collection | Location | License | Link |
|------------|----------|---------|------|
| **LobeHub Icons** (`@lobehub/icons`) | npm dependency + vendored SVGs in `apps/web/public/assets/icons/` | MIT | https://github.com/lobehub/lobe-icons |

Most brand SVGs under:

```text
apps/web/public/assets/icons/apps/     # apps & streaming (Spotify, GitHub, etc.)
apps/web/public/assets/icons/cloud/    # cloud providers (AWS, Azure, GCP, Alibaba)
apps/web/public/assets/icons/models/   # AI / LLM providers (OpenAI, Anthropic, etc.)
apps/web/public/assets/icons/sources/  # link-import sources (YouTube, TikTok, etc.)
```

were sourced from or match the [LobeHub / lobe-icons](https://github.com/lobehub/lobe-icons) collection (also browsable at [lobehub.com/icons](https://lobehub.com/icons)).

**MIT notice (LobeHub Icons):**

```text
Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

### AWS logo

The AWS icon at `apps/web/public/assets/icons/cloud/aws.svg` is the **Amazon Web Services light** mark (white wordmark and orange smile on dark tiles). **Amazon Web Services** is a trademark of Amazon.com, Inc. or its affiliates.

### Trademark disclaimer

All product names, logos, and brands (including but not limited to **Amazon**, **AWS**, **Google**, **Microsoft**, **Apple**, **OpenAI**, **Anthropic**, **Spotify**, **Netflix**, **Adobe**, **GitHub**, and others) are property of their respective owners. Use in Arciin is for **identification and user organization only**.

If you redistribute Arciin or derivative builds, preserve this notice and the LobeHub MIT notice above where applicable.

---

## UI components that do not require in-app attribution

The following are used under permissive licenses and do **not** require visible credit inside the application UI:

- Lucide icons (ISC)
- shadcn/ui components (MIT)
- Standard npm dependencies listed in `package.json`

---

## Server binaries (operator responsibility)

Native and Docker deployments may use system packages not bundled in this repository:

| Tool | Typical license | Use in Arciin |
|------|-----------------|---------------|
| **FFmpeg** | LGPL/GPL (build-dependent) | Media probing and transcoding in worker |
| **PostgreSQL** | PostgreSQL License | Database |
| **Redis** | BSD-3-Clause | Queues and realtime |
| **Node.js** | MIT | Runtime |

Operators are responsible for complying with licenses of software installed on the host OS.

---

## Questions

For Arciin licensing: see [`LICENSE`](../LICENSE) or open an issue on the repository.

For LobeHub Icons: https://github.com/lobehub/lobe-icons
