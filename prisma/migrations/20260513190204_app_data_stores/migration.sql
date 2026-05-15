-- CreateTable
CREATE TABLE "AppDatabase" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppDatabase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppDatabaseFolder" (
    "id" TEXT NOT NULL,
    "databaseId" TEXT NOT NULL,
    "parentFolderId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "pathCache" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AppDatabaseFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppDatabaseRecord" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppDatabaseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppDatabase_slug_key" ON "AppDatabase"("slug");

-- CreateIndex
CREATE INDEX "AppDatabase_createdById_idx" ON "AppDatabase"("createdById");

-- CreateIndex
CREATE INDEX "AppDatabaseFolder_databaseId_idx" ON "AppDatabaseFolder"("databaseId");

-- CreateIndex
CREATE INDEX "AppDatabaseFolder_parentFolderId_idx" ON "AppDatabaseFolder"("parentFolderId");

-- CreateIndex
CREATE INDEX "AppDatabaseFolder_deletedAt_idx" ON "AppDatabaseFolder"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppDatabaseFolder_databaseId_pathCache_key" ON "AppDatabaseFolder"("databaseId", "pathCache");

-- CreateIndex
CREATE INDEX "AppDatabaseRecord_folderId_idx" ON "AppDatabaseRecord"("folderId");

-- CreateIndex
CREATE UNIQUE INDEX "AppDatabaseRecord_folderId_name_key" ON "AppDatabaseRecord"("folderId", "name");

-- AddForeignKey
ALTER TABLE "AppDatabase" ADD CONSTRAINT "AppDatabase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppDatabaseFolder" ADD CONSTRAINT "AppDatabaseFolder_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "AppDatabase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppDatabaseFolder" ADD CONSTRAINT "AppDatabaseFolder_parentFolderId_fkey" FOREIGN KEY ("parentFolderId") REFERENCES "AppDatabaseFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppDatabaseRecord" ADD CONSTRAINT "AppDatabaseRecord_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "AppDatabaseFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
