CREATE TABLE "writer"."own_keys" (
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"sealed" text NOT NULL,
	"hint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "own_keys_user_id_provider_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "writer"."own_sign_ins" (
	"name" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "writer"."settings" ADD COLUMN "source" text DEFAULT 'house' NOT NULL;--> statement-breakpoint
CREATE INDEX "own_sign_ins_user" ON "writer"."own_sign_ins" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "writer"."own_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "writer"."own_sign_ins" ENABLE ROW LEVEL SECURITY;
