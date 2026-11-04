CREATE TABLE "note_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"source_note_id" uuid NOT NULL,
	"target_note_id" uuid NOT NULL,
	"type" text NOT NULL,
	"pair_key" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_relations" ADD CONSTRAINT "note_relations_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_relations" ADD CONSTRAINT "note_relations_source_note_id_notes_id_fk" FOREIGN KEY ("source_note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_relations" ADD CONSTRAINT "note_relations_target_note_id_notes_id_fk" FOREIGN KEY ("target_note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_relations" ADD CONSTRAINT "note_relations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_relations_pair_idx" ON "note_relations" USING btree ("knowledge_base_id","type","pair_key");--> statement-breakpoint
CREATE INDEX "note_relations_kb_idx" ON "note_relations" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX "note_relations_source_idx" ON "note_relations" USING btree ("source_note_id");--> statement-breakpoint
CREATE INDEX "note_relations_target_idx" ON "note_relations" USING btree ("target_note_id");