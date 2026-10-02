CREATE TABLE "writer"."settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"thinking" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "writer"."settings" ENABLE ROW LEVEL SECURITY;
