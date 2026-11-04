CREATE TABLE "app_extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"extension_id" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"api_version" integer NOT NULL,
	"publisher" text NOT NULL,
	"package_hash" text NOT NULL,
	"source" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"files" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"installed_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_extensions" ADD CONSTRAINT "app_extensions_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_extensions" ADD CONSTRAINT "app_extensions_installed_by_user_id_users_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_extensions_version_idx" ON "app_extensions" USING btree ("knowledge_base_id","extension_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "app_extensions_enabled_idx" ON "app_extensions" USING btree ("knowledge_base_id","extension_id") WHERE "app_extensions"."enabled";--> statement-breakpoint
CREATE INDEX "app_extensions_knowledge_base_idx" ON "app_extensions" USING btree ("knowledge_base_id");