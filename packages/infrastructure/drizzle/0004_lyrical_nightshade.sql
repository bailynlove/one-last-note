CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"original_revision_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mark_type" text,
	"body" text,
	"anchor" jsonb NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_revision_id_note_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."note_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_original_revision_id_note_revisions_id_fk" FOREIGN KEY ("original_revision_id") REFERENCES "public"."note_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_parent_id_annotations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."annotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotations_kb_note_idx" ON "annotations" USING btree ("knowledge_base_id","note_id");--> statement-breakpoint
CREATE INDEX "annotations_parent_idx" ON "annotations" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "annotations_revision_idx" ON "annotations" USING btree ("revision_id");