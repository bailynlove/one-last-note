ALTER TABLE "knowledge_bases" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "deleted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "note_associations" ADD COLUMN "trashed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "note_associations" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "note_associations" ADD COLUMN "trashed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_associations" ADD CONSTRAINT "note_associations_trashed_by_user_id_users_id_fk" FOREIGN KEY ("trashed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_associations_purge_idx" ON "note_associations" USING btree ("purge_after");