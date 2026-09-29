-- Additive: a per-user "cleared through" cursor for the notification inbox.
-- Clearing hides events up to this time from that user's inbox only; the
-- ActivityEvent rows themselves (Activity, audit) are never touched.
ALTER TABLE "User" ADD COLUMN "notificationsClearedThrough" TIMESTAMP(3);
