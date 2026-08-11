-- Discord delivery settings for the instance.
-- The webhook URL inside this JSON is AES-256-GCM ciphertext, never plaintext.
ALTER TABLE "InstanceConfig" ADD COLUMN "discordConfig" JSONB;
