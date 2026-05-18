-- Add APPLICATION media type for installers (.exe, .msi, .iso, etc.)
ALTER TYPE "MediaType" ADD VALUE IF NOT EXISTS 'APPLICATION';
