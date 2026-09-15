-- Root ownership: the computer states which folders it backs up.
--
-- Both columns are nullable and have no default, so every existing row keeps
-- reading as "no statement made". That is deliberate: the Desktop installed in
-- production predates ownership reporting, and a server that demanded an
-- acknowledgement immediately would strip protection from roots that are
-- genuinely being backed up until the new client is installed.

-- When the computer claimed this root via POST /backup/roots with its sync
-- grant. NULL means no computer has ever claimed it.
ALTER TABLE "SyncRoot" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);

-- First heartbeat from this profile that carried an authoritative
-- ownedRootSourceIdentifiers list. NULL means the client predates ownership
-- reporting and legacy counting still applies.
ALTER TABLE "DeviceBackupProfile" ADD COLUMN "rootOwnershipObservedAt" TIMESTAMP(3);
