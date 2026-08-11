-- SMTP delivery settings for the instance.
-- The password inside this JSON is AES-256-GCM ciphertext, never plaintext.
ALTER TABLE "InstanceConfig" ADD COLUMN "emailConfig" JSONB;
