-- The relationship graph replaces feelings. Each pair's two feelings become the two sides' "sees"
-- of one relationship, so nothing typed into setup is lost; 0003 drops feelings after.
CREATE TABLE "writer"."relationships" (
	"book_id" uuid NOT NULL,
	"a_id" uuid NOT NULL,
	"b_id" uuid NOT NULL,
	"bond" text DEFAULT '' NOT NULL,
	"a_sees" text DEFAULT '' NOT NULL,
	"a_hides" text DEFAULT '' NOT NULL,
	"b_sees" text DEFAULT '' NOT NULL,
	"b_hides" text DEFAULT '' NOT NULL,
	CONSTRAINT "relationships_book_id_a_id_b_id_pk" PRIMARY KEY("book_id","a_id","b_id"),
	CONSTRAINT "relationships_in_order" CHECK ("writer"."relationships"."a_id" < "writer"."relationships"."b_id")
);
--> statement-breakpoint
ALTER TABLE "writer"."relationships" ADD CONSTRAINT "relationships_book_id_a_id_characters_book_id_id_fk" FOREIGN KEY ("book_id","a_id") REFERENCES "writer"."characters"("book_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writer"."relationships" ADD CONSTRAINT "relationships_book_id_b_id_characters_book_id_id_fk" FOREIGN KEY ("book_id","b_id") REFERENCES "writer"."characters"("book_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "writer"."relationships" ("book_id", "a_id", "b_id", "a_sees", "b_sees")
SELECT
	"book_id",
	least("character_id", "about_id"),
	greatest("character_id", "about_id"),
	coalesce(max("text") FILTER (WHERE "character_id" < "about_id"), ''),
	coalesce(max("text") FILTER (WHERE "character_id" > "about_id"), '')
FROM "writer"."feelings"
GROUP BY "book_id", least("character_id", "about_id"), greatest("character_id", "about_id");--> statement-breakpoint

ALTER TABLE "writer"."relationships" ENABLE ROW LEVEL SECURITY;
