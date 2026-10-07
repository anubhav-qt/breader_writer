ALTER TABLE "writer"."scenes" ADD COLUMN "openings" jsonb;--> statement-breakpoint
ALTER TABLE "writer"."turns" ADD COLUMN "played" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "scenes_one_next" ON "writer"."scenes" USING btree ("book_id") WHERE status = 'next';