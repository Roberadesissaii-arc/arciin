-- New enum value must be committed before any row uses it.
ALTER TYPE "LibraryKind" ADD VALUE IF NOT EXISTS 'COMPUTER';
