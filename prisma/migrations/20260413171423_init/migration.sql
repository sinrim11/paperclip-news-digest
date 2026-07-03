-- CreateEnum
CREATE TYPE "Category" AS ENUM ('GLOBAL', 'STOCKS', 'AI', 'POLICY', 'REALESTATE');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('breaking', 'watch', 'note');

-- CreateEnum
CREATE TYPE "DigestStatus" AS ENUM ('pending', 'in_progress', 'done', 'failed');

-- CreateTable
CREATE TABLE "DailyDigest" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DigestStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketDaily" (
    "id" TEXT NOT NULL,
    "digestId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kospiValue" DOUBLE PRECISION,
    "kospiChange" TEXT,
    "kospiDir" TEXT,
    "kosdaqValue" DOUBLE PRECISION,
    "kosdaqChange" TEXT,
    "kosdaqDir" TEXT,
    "usdKrwValue" DOUBLE PRECISION,
    "usdKrwChange" TEXT,
    "usdKrwDir" TEXT,
    "wtiValue" DOUBLE PRECISION,
    "wtiChange" TEXT,
    "wtiDir" TEXT,
    "us10yValue" DOUBLE PRECISION,
    "us10yChange" TEXT,
    "us10yDir" TEXT,
    "btcUsdValue" DOUBLE PRECISION,
    "btcUsdChange" TEXT,
    "btcUsdDir" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryBriefing" (
    "id" TEXT NOT NULL,
    "digestId" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "summary" TEXT NOT NULL,
    "newsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryBriefing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL,
    "digestId" TEXT NOT NULL,
    "categoryBriefingId" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "newsOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "urgency" "Urgency" NOT NULL DEFAULT 'note',
    "fact" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "contextTags" TEXT[],
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "isTop3" BOOLEAN NOT NULL DEFAULT false,
    "top3Rank" INTEGER,
    "relatedData" TEXT[],
    "contextLinks" TEXT[],
    "upcomingEvents" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextTagHistory" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastSeenDate" DATE NOT NULL,
    "newsItemIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContextTagHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyDigest" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "weekEnd" DATE NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyDigest_date_key" ON "DailyDigest"("date");

-- CreateIndex
CREATE INDEX "DailyDigest_date_idx" ON "DailyDigest"("date");

-- CreateIndex
CREATE INDEX "DailyDigest_status_idx" ON "DailyDigest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketDaily_digestId_key" ON "MarketDaily"("digestId");

-- CreateIndex
CREATE INDEX "MarketDaily_date_idx" ON "MarketDaily"("date");

-- CreateIndex
CREATE INDEX "CategoryBriefing_digestId_idx" ON "CategoryBriefing"("digestId");

-- CreateIndex
CREATE INDEX "CategoryBriefing_category_idx" ON "CategoryBriefing"("category");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryBriefing_digestId_category_key" ON "CategoryBriefing"("digestId", "category");

-- CreateIndex
CREATE INDEX "NewsItem_digestId_idx" ON "NewsItem"("digestId");

-- CreateIndex
CREATE INDEX "NewsItem_category_idx" ON "NewsItem"("category");

-- CreateIndex
CREATE INDEX "NewsItem_urgency_idx" ON "NewsItem"("urgency");

-- CreateIndex
CREATE INDEX "NewsItem_isTop3_idx" ON "NewsItem"("isTop3");

-- CreateIndex
CREATE INDEX "NewsItem_contextTags_idx" ON "NewsItem"("contextTags");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_digestId_category_newsOrder_key" ON "NewsItem"("digestId", "category", "newsOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ContextTagHistory_tag_key" ON "ContextTagHistory"("tag");

-- CreateIndex
CREATE INDEX "ContextTagHistory_tag_idx" ON "ContextTagHistory"("tag");

-- CreateIndex
CREATE INDEX "ContextTagHistory_count_idx" ON "ContextTagHistory"("count");

-- CreateIndex
CREATE INDEX "ContextTagHistory_lastSeenDate_idx" ON "ContextTagHistory"("lastSeenDate");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyDigest_weekStart_key" ON "WeeklyDigest"("weekStart");

-- CreateIndex
CREATE INDEX "WeeklyDigest_weekStart_idx" ON "WeeklyDigest"("weekStart");

-- CreateIndex
CREATE INDEX "WeeklyDigest_weekEnd_idx" ON "WeeklyDigest"("weekEnd");

-- AddForeignKey
ALTER TABLE "MarketDaily" ADD CONSTRAINT "MarketDaily_digestId_fkey" FOREIGN KEY ("digestId") REFERENCES "DailyDigest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryBriefing" ADD CONSTRAINT "CategoryBriefing_digestId_fkey" FOREIGN KEY ("digestId") REFERENCES "DailyDigest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_digestId_fkey" FOREIGN KEY ("digestId") REFERENCES "DailyDigest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_categoryBriefingId_fkey" FOREIGN KEY ("categoryBriefingId") REFERENCES "CategoryBriefing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
