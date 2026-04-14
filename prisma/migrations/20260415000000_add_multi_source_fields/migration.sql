-- AlterTable: add multi-source fields to NewsItem (CMP-126)
ALTER TABLE "NewsItem" ADD COLUMN IF NOT EXISTS "sourceCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "NewsItem" ADD COLUMN IF NOT EXISTS "sourceList" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "NewsItem" ADD COLUMN IF NOT EXISTS "consensusFacts" TEXT;
ALTER TABLE "NewsItem" ADD COLUMN IF NOT EXISTS "conflictingFacts" TEXT;
