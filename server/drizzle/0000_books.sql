-- The migrator makes this schema first, for its own table (writer.migrations), so it may exist.
CREATE SCHEMA IF NOT EXISTS "writer";
--> statement-breakpoint
CREATE TABLE "writer"."books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"color" text NOT NULL,
	"word_goal" integer NOT NULL,
	"words_written" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "books_user_idx" ON "writer"."books" USING btree ("user_id","updated_at");;--> statement-breakpoint

-- As breader does with its tables: the server's own role owns them and so isn't limited, while
-- anything reaching Supabase through its public APIs sees nothing.
ALTER TABLE "writer"."books" ENABLE ROW LEVEL SECURITY;
