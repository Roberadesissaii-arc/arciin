import { config as loadEnv } from "dotenv"
import { workerEnvSchema } from "@arciin/config"

loadEnv()

export const workerConfig = workerEnvSchema.parse(process.env)
