DROP INDEX "capture_attempts_user_key_idx";--> statement-breakpoint
ALTER TABLE "capture_attempts" ADD COLUMN "media_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "capture_attempts_user_kb_key_idx" ON "capture_attempts" USING btree ("user_id","knowledge_base_id","idempotency_key") WHERE "capture_attempts"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "notes_source_canonical_idx" ON "notes" USING btree ("source_canonical_url");