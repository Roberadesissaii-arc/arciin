import path from "node:path"

import { config as loadEnv } from "dotenv"
import { z } from "zod"

import { APP_VERSION } from "@arciin/shared"

loadEnv()

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ARCIIN_DATA_DIR: z.string().default("/srv/arciin-storage/arciin"),
  ARCIIN_SETUP_TOKEN: z.string().optional(),
  ARCIIN_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  ARCIIN_API_URL: z.string().url().default("http://localhost:4000"),
  SESSION_COOKIE_NAME: z.string().default("arciin_session"),
  SESSION_SECRET: z.string().min(32).default("change-this-in-production-must-be-32-chars-min"),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(10240),
  API_PORT: z.coerce.number().int().positive().default(4000),
})

const parsed = envSchema.parse(process.env)

const defaultSetupToken =
  parsed.NODE_ENV !== "production" ? parsed.ARCIIN_SETUP_TOKEN || "dev-token" : parsed.ARCIIN_SETUP_TOKEN

if (!defaultSetupToken) {
  throw new Error("ARCIIN_SETUP_TOKEN is required in production.")
}

if (parsed.NODE_ENV === "production" && parsed.SESSION_SECRET.startsWith("change-this-in-production")) {
  throw new Error("SESSION_SECRET must be set to a strong random value in production. Generate one with: openssl rand -hex 32")
}

export const apiConfig = {
  ...parsed,
  setupToken: defaultSetupToken,
  appVersion: APP_VERSION,
  isProduction: parsed.NODE_ENV === "production",
  maxUploadSizeBytes: parsed.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
  dataDir: path.resolve(parsed.ARCIIN_DATA_DIR),
  storage: {
    objectsDir: path.resolve(parsed.ARCIIN_DATA_DIR, "objects"),
    librariesDir: path.resolve(parsed.ARCIIN_DATA_DIR, "libraries"),
    thumbnailsDir: path.resolve(parsed.ARCIIN_DATA_DIR, "thumbnails"),
    tempDir: path.resolve(parsed.ARCIIN_DATA_DIR, "temp"),
    logsDir: path.resolve(parsed.ARCIIN_DATA_DIR, "logs"),
  },
}
