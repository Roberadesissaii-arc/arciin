-- Give a session a stable per-browser identity.
--
-- Repeat sign-ins used to be collapsed by matching (userId, userAgent,
-- ipAddress). That tuple identifies a *network position*, not a device: two
-- Chrome profiles, a normal and a private window, or two people behind one
-- NAT all produce the same triple. Signing in on one therefore deleted the
-- other's session, which read as a random logout.
--
-- `deviceId` comes from a long-lived opaque cookie minted on first sign-in, so
-- collapse now only ever touches sessions the same browser created. It is
-- nullable on purpose: Bearer-only clients (the mobile PWA) send no cookie,
-- get no id, and are never collapsed. Existing rows keep NULL and are simply
-- left alone from here on.
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;

CREATE INDEX IF NOT EXISTS "Session_userId_deviceId_idx" ON "Session"("userId", "deviceId");
