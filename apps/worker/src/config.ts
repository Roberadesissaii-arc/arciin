import { config as loadEnv } from "dotenv"
import { z } from "zod"

loadEnv()

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REDIS_URL: z.string().min(1),
  ARCIIN_DATA_DIR: z.string().default("./data/arciin"),
})

export const workerConfig = envSchema.parse(process.env)
