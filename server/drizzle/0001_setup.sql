-- No default for a book's length, point of view or darkness: no books existed before this, and
-- every book is set up with all three.
CREATE TABLE "writer"."characters" (
	"book_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"role" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"who" text DEFAULT '' NOT NULL,
	"personality" text DEFAULT '' NOT NULL,
	"past" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "characters_book_id_id_pk" PRIMARY KEY("book_id","id")
);
--> statement-breakpoint
CREATE TABLE "writer"."feelings" (
	"book_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"about_id" uuid NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "feelings_book_id_character_id_about_id_pk" PRIMARY KEY("book_id","character_id","about_id")
);
--> statement-breakpoint
CREATE TABLE "writer"."worlds" (
	"book_id" uuid PRIMARY KEY NOT NULL,
	"genre" text DEFAULT '' NOT NULL,
	"tone" text DEFAULT '' NOT NULL,
	"setting" text DEFAULT '' NOT NULL,
	"rules" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "writer"."books" ADD COLUMN "length" text NOT NULL;--> statement-breakpoint
ALTER TABLE "writer"."books" ADD COLUMN "pov" text NOT NULL;--> statement-breakpoint
ALTER TABLE "writer"."books" ADD COLUMN "darkness" text NOT NULL;--> statement-breakpoint
ALTER TABLE "writer"."characters" ADD CONSTRAINT "characters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "writer"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writer"."feelings" ADD CONSTRAINT "feelings_book_id_character_id_characters_book_id_id_fk" FOREIGN KEY ("book_id","character_id") REFERENCES "writer"."characters"("book_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writer"."feelings" ADD CONSTRAINT "feelings_book_id_about_id_characters_book_id_id_fk" FOREIGN KEY ("book_id","about_id") REFERENCES "writer"."characters"("book_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writer"."worlds" ADD CONSTRAINT "worlds_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "writer"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "characters_one_protagonist" ON "writer"."characters" USING btree ("book_id") WHERE role = 'protagonist';--> statement-breakpoint

ALTER TABLE "writer"."worlds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "writer"."characters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "writer"."feelings" ENABLE ROW LEVEL SECURITY;
