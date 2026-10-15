CREATE TABLE "writer"."chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"scene_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"words" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "writer"."chapters" ADD CONSTRAINT "chapters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "writer"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writer"."chapters" ADD CONSTRAINT "chapters_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "writer"."scenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_scene" ON "writer"."chapters" USING btree ("scene_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_book_number" ON "writer"."chapters" USING btree ("book_id","number");--> statement-breakpoint
ALTER TABLE "writer"."chapters" ENABLE ROW LEVEL SECURITY;