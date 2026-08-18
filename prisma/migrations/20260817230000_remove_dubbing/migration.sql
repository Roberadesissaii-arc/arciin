-- Remove the dubbing feature.
--
-- Dubbing — synthetic speech over a separated background — turned out to be a
-- different product from the one Arciin is, and it is being taken out rather
-- than finished here. What it stored is removed with it: a table nobody writes
-- to is a table somebody eventually reads.
--
-- `IF EXISTS` throughout because these objects were created by `db push` during
-- development and never had a migration of their own. An installation that
-- never ran that development build has none of them, and this must be a no-op
-- there rather than an error that stops an upgrade.
--
-- Nothing here touches Asset, MediaTranscript or MediaTranslation. Transcripts
-- and text translations are Arciin features in their own right and are
-- deliberately untouched: only the rows that describe generated *audio* go.

DROP TABLE IF EXISTS "MediaDub";

DROP TYPE IF EXISTS "MediaDubStatus";

-- Held the separation mode and the RunPod connection. Both existed only to
-- decide where dialogue/background separation ran.
ALTER TABLE "InstanceConfig" DROP COLUMN IF EXISTS "dubbingConfig";
