-- Remove Computer Backup.
--
-- Only the four tables that belong exclusively to the feature are dropped,
-- along with the enums that nothing else uses. Nothing here touches Asset,
-- StorageObject, Folder, Library, Device, Session or User.
--
-- The 245 files this computer had already backed up live in the Computers
-- library as ordinary Assets with ordinary StorageObjects. Dropping SyncEntry
-- removes the join rows that pointed at them, not the assets themselves or
-- their bytes on disk — they stay browsable as normal files. Deleting a user's
-- files is not part of removing a feature.
--
-- Device survives deliberately: Arciin Desktop still pairs and authenticates
-- through it, and only the backup-facing surface is going away.

-- Children before parents: SyncEntry -> SyncRoot -> DeviceBackupGrant/Profile.
DROP TABLE IF EXISTS "SyncEntry";
DROP TABLE IF EXISTS "SyncRoot";
DROP TABLE IF EXISTS "DeviceBackupGrant";
DROP TABLE IF EXISTS "DeviceBackupProfile";

DROP TYPE IF EXISTS "SyncEntryState";
DROP TYPE IF EXISTS "SyncEntryType";
DROP TYPE IF EXISTS "SyncRootStatus";
DROP TYPE IF EXISTS "SyncRootKind";
DROP TYPE IF EXISTS "DeviceBackupHealth";
DROP TYPE IF EXISTS "DeviceBackupStatus";
