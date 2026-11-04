CREATE TABLE "capture_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text,
	"selection_html" text,
	"selection_text" text,
	"status" text NOT NULL,
	"note_id" uuid,
	"revision_id" uuid,
	"duplicate_note_id" uuid,
	"duplicate_title" text,
	"error_code" text,
	"error_detail" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "source_canonical_url" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "source_title" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "source_site_name" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "capture_attempts" ADD CONSTRAINT "capture_attempts_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_attempts" ADD CONSTRAINT "capture_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_attempts" ADD CONSTRAINT "capture_attempts_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_attempts" ADD CONSTRAINT "capture_attempts_revision_id_note_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."note_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_attempts" ADD CONSTRAINT "capture_attempts_duplicate_note_id_notes_id_fk" FOREIGN KEY ("duplicate_note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capture_attempts_user_key_idx" ON "capture_attempts" USING btree ("user_id","idempotency_key") WHERE "capture_attempts"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "capture_attempts_user_created_idx" ON "capture_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "capture_attempts_kb_url_idx" ON "capture_attempts" USING btree ("knowledge_base_id","canonical_url");