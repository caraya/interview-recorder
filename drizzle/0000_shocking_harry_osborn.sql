CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"project" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration" double precision NOT NULL,
	"model" text NOT NULL,
	"language" text NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"transcript" text NOT NULL,
	"segments" jsonb NOT NULL,
	"audio_file" text NOT NULL,
	"audio_type" text NOT NULL,
	"audio_size" bigint NOT NULL,
	CONSTRAINT "interviews_duration_check" CHECK ("interviews"."duration" >= 0),
	CONSTRAINT "interviews_audio_size_check" CHECK ("interviews"."audio_size" > 0)
);
--> statement-breakpoint
CREATE INDEX "interviews_created_at_idx" ON "interviews" USING btree ("created_at");