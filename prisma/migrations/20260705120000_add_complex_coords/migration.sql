-- 단지 좌표(new.land 백필) — 통근·상권 점수용
ALTER TABLE "ComplexCandidate" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "ComplexCandidate" ADD COLUMN "lng" DOUBLE PRECISION;
