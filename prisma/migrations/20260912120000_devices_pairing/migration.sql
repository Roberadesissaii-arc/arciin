-- Trusted devices and one-time pairing codes for future native clients.
-- Session.deviceId remains the per-browser cookie id. pairedDeviceId is the
-- optional FK to a Device row created by Settings → Devices pairing.

CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "DevicePairingStatus" AS ENUM ('PENDING', 'CLAIMED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "DevicePlatform" AS ENUM ('WINDOWS', 'MACOS', 'LINUX', 'IOS', 'ANDROID', 'OTHER');
CREATE TYPE "DeviceType" AS ENUM ('DESKTOP', 'LAPTOP', 'PHONE', 'TABLET', 'OTHER');

ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "discoveryServerId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "InstanceConfig_discoveryServerId_key"
  ON "InstanceConfig"("discoveryServerId");

CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceType" "DeviceType" NOT NULL DEFAULT 'DESKTOP',
    "platform" "DevicePlatform" NOT NULL DEFAULT 'OTHER',
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "credentialHash" TEXT NOT NULL,
    "pairedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "appVersion" TEXT,
    "protocolVersion" INTEGER NOT NULL DEFAULT 1,
    "osVersion" TEXT,
    "architecture" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Device_credentialHash_key" ON "Device"("credentialHash");
CREATE INDEX "Device_status_idx" ON "Device"("status");
CREATE INDEX "Device_lastSeenAt_idx" ON "Device"("lastSeenAt");

CREATE TABLE "DevicePairing" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "status" "DevicePairingStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "claimedByDeviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "DevicePairing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DevicePairing_status_expiresAt_idx" ON "DevicePairing"("status", "expiresAt");
CREATE INDEX "DevicePairing_createdByUserId_idx" ON "DevicePairing"("createdByUserId");

CREATE TABLE "DeviceSession" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceSession_tokenHash_key" ON "DeviceSession"("tokenHash");
CREATE INDEX "DeviceSession_deviceId_idx" ON "DeviceSession"("deviceId");
CREATE INDEX "DeviceSession_expiresAt_idx" ON "DeviceSession"("expiresAt");

ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "pairedDeviceId" TEXT;

CREATE INDEX IF NOT EXISTS "Session_pairedDeviceId_idx" ON "Session"("pairedDeviceId");

ALTER TABLE "DevicePairing"
  ADD CONSTRAINT "DevicePairing_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DevicePairing"
  ADD CONSTRAINT "DevicePairing_claimedByDeviceId_fkey"
  FOREIGN KEY ("claimedByDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeviceSession"
  ADD CONSTRAINT "DeviceSession_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_pairedDeviceId_fkey"
  FOREIGN KEY ("pairedDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
