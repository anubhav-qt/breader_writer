-- The ledgers became pages of the reference (0006). Nothing has played yet anywhere, so they hold
-- nothing; if one ever does, this stops before anything is lost, and its rows need moving first.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "writer"."facts")
		OR EXISTS (SELECT 1 FROM "writer"."threads")
		OR EXISTS (SELECT 1 FROM "writer"."timeline")
		OR EXISTS (SELECT 1 FROM "writer"."growth")
		OR EXISTS (SELECT 1 FROM "writer"."arcs")
		OR EXISTS (SELECT 1 FROM "writer"."versions" WHERE "table_name" IN ('facts', 'threads', 'timeline', 'growth', 'arcs')) THEN
		RAISE EXCEPTION 'The story ledgers have rows: move them into pages before dropping them.';
	END IF;
END $$;--> statement-breakpoint
DROP TABLE "writer"."arcs" CASCADE;--> statement-breakpoint
DROP TABLE "writer"."facts" CASCADE;--> statement-breakpoint
DROP TABLE "writer"."growth" CASCADE;--> statement-breakpoint
DROP TABLE "writer"."threads" CASCADE;--> statement-breakpoint
DROP TABLE "writer"."timeline" CASCADE;--> statement-breakpoint
ALTER TABLE "writer"."scenes" DROP COLUMN "folded_through";