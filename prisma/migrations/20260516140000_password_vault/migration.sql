-- CreateTable
CREATE TABLE "PasswordVaultEntry" (
    "id" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "importSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordVaultEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasswordVaultEntry_createdAt_idx" ON "PasswordVaultEntry"("createdAt");
