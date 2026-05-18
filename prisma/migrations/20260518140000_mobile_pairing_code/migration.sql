-- CreateTable
CREATE TABLE "MobilePairingCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobilePairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MobilePairingCode_codeHash_key" ON "MobilePairingCode"("codeHash");

-- CreateIndex
CREATE INDEX "MobilePairingCode_createdById_idx" ON "MobilePairingCode"("createdById");

-- CreateIndex
CREATE INDEX "MobilePairingCode_expiresAt_idx" ON "MobilePairingCode"("expiresAt");

-- AddForeignKey
ALTER TABLE "MobilePairingCode" ADD CONSTRAINT "MobilePairingCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
