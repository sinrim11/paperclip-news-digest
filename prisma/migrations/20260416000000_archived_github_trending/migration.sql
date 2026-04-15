-- CMP-131: Add archived flag + GitHub Trending fields
-- DailyDigest
ALTER TABLE "DailyDigest" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

-- CategoryBriefing
ALTER TABLE "CategoryBriefing" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

-- NewsItem
ALTER TABLE "NewsItem" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NewsItem" ADD COLUMN "isGithubTrending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NewsItem" ADD COLUMN "githubStarsDelta" INTEGER;
ALTER TABLE "NewsItem" ADD COLUMN "githubLanguage" TEXT;

-- Indexes
CREATE INDEX "DailyDigest_archived_idx" ON "DailyDigest"("archived");
CREATE INDEX "CategoryBriefing_archived_idx" ON "CategoryBriefing"("archived");
CREATE INDEX "NewsItem_archived_idx" ON "NewsItem"("archived");
CREATE INDEX "NewsItem_isGithubTrending_idx" ON "NewsItem"("isGithubTrending");

-- Archive all existing data (CMP-131 §7: hide old data, new pipeline starts fresh)
UPDATE "DailyDigest" SET "archived" = true;
UPDATE "CategoryBriefing" SET "archived" = true;
UPDATE "NewsItem" SET "archived" = true;
