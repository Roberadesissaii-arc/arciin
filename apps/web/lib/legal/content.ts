export type LegalSection = {
  title: string
  paragraphs: string[]
}

export const termsOfUseSections: LegalSection[] = [
  {
    title: "Arciin Terms of Use",
    paragraphs: [
      "Arciin is proprietary software. Copyright © 2026 Roberadesissaii-arc and Arciin contributors. All rights reserved.",
      "Your server, your control. You may install, configure, and run Arciin on servers and devices that you own or control, for personal, organizational, or internal business use, subject to this agreement and applicable law.",
    ],
  },
  {
    title: "Permitted use",
    paragraphs: [
      "You may modify the software for your own deployments, provided you do not distribute those modifications to third parties except as part of operating your own private instance.",
    ],
  },
  {
    title: "Restrictions",
    paragraphs: [
      "Do not publish, sell, or host Arciin as a multi-tenant SaaS for unrelated third parties without a separate agreement.",
      "Do not remove or alter copyright or license notices in distributed copies.",
      "Do not use the Arciin name or branding to imply endorsement without permission.",
      "Unauthorized copying, redistribution, sublicensing, or commercial resale of the software or derivative works is not permitted without prior written permission from the copyright holder.",
    ],
  },
  {
    title: "Self-hosted responsibility",
    paragraphs: [
      "This software runs on infrastructure you control. You are responsible for protecting environment files, setup tokens, session secrets, and API keys; keeping the host OS, PostgreSQL, Redis, and dependencies patched; configuring firewalls, TLS, and network access; and backing up your data and storage directories.",
    ],
  },
  {
    title: "Disclaimer",
    paragraphs: [
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
    ],
  },
]

export const privacyPolicySections: LegalSection[] = [
  {
    title: "Arciin Privacy Policy",
    paragraphs: [
      "Arciin is self-hosted software. When you run an instance, your data stays on systems you control unless you configure integrations that send data elsewhere.",
    ],
  },
  {
    title: "Data we store on your instance",
    paragraphs: [
      "During setup and normal use, Arciin stores account information (such as name and email), hashed passwords, session tokens, uploaded files, application metadata, and configuration you provide. This data resides in your PostgreSQL database and on-disk storage paths you choose during setup.",
    ],
  },
  {
    title: "What Arciin does not do by default",
    paragraphs: [
      "A default Arciin deployment does not send your files, chat history, or credentials to Arciin developers or third-party analytics services. Telemetry, remote model providers, or external webhooks only apply when you explicitly configure them.",
    ],
  },
  {
    title: "AI and integrations",
    paragraphs: [
      "If you enable chat, automation, or model integrations, prompts and context you submit may be sent to the model or service you configure (for example a local Ollama instance or another endpoint you supply). Review those services' policies before enabling them.",
    ],
  },
  {
    title: "Cookies and sessions",
    paragraphs: [
      "Arciin uses HTTP cookies or equivalent session mechanisms to keep you signed in. Session data is managed by your instance and can be revoked from profile or security settings.",
    ],
  },
  {
    title: "Your responsibilities",
    paragraphs: [
      "Because you operate the server, you decide who has access, how long data is retained, and how backups are performed. Protect network access to your instance and rotate secrets if they are exposed.",
    ],
  },
]
