CREATE TABLE `content_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`account_id` text NOT NULL,
	`content_id` text NOT NULL,
	`embedding_model` text NOT NULL,
	`source_hash` text NOT NULL,
	`vector_json` text NOT NULL,
	`status` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`account_id`,`content_id`) REFERENCES `contents`(`organization_id`,`account_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "content_embeddings_status_valid" CHECK("content_embeddings"."status" IN ('active', 'stale', 'failed')),
	CONSTRAINT "content_embeddings_model_valid" CHECK(length(trim("content_embeddings"."embedding_model")) > 0),
	CONSTRAINT "content_embeddings_hash_valid" CHECK(length("content_embeddings"."source_hash") = 64),
	CONSTRAINT "content_embeddings_vector_json_valid" CHECK(json_valid("content_embeddings"."vector_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_content_embeddings_org_id` ON `content_embeddings` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_content_embeddings_active_content` ON `content_embeddings` (`organization_id`,`account_id`,`content_id`) WHERE "content_embeddings"."status" = 'active';--> statement-breakpoint
CREATE INDEX `idx_content_embeddings_lookup` ON `content_embeddings` (`organization_id`,`account_id`,`status`,`embedding_model`);--> statement-breakpoint
CREATE TABLE `content_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`format` text NOT NULL,
	`dedup_strategy` text NOT NULL,
	`source_hash` text NOT NULL,
	`preview_json` text NOT NULL,
	`status` text DEFAULT 'previewed' NOT NULL,
	`total_rows` integer NOT NULL,
	`valid_rows` integer NOT NULL,
	`duplicate_rows` integer NOT NULL,
	`invalid_rows` integer NOT NULL,
	`committed_rows` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`committed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`created_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "content_import_batches_format_valid" CHECK("content_import_batches"."format" IN ('csv', 'json')),
	CONSTRAINT "content_import_batches_dedup_valid" CHECK("content_import_batches"."dedup_strategy" IN ('external_id', 'title_published_at', 'canonical')),
	CONSTRAINT "content_import_batches_status_valid" CHECK("content_import_batches"."status" IN ('previewed', 'committed', 'failed')),
	CONSTRAINT "content_import_batches_counts_valid" CHECK("content_import_batches"."total_rows" >= 0 AND "content_import_batches"."valid_rows" >= 0 AND "content_import_batches"."duplicate_rows" >= 0 AND "content_import_batches"."invalid_rows" >= 0 AND "content_import_batches"."committed_rows" >= 0 AND "content_import_batches"."valid_rows" + "content_import_batches"."duplicate_rows" + "content_import_batches"."invalid_rows" = "content_import_batches"."total_rows")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_content_import_batches_org_id` ON `content_import_batches` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_content_import_batches_org_created` ON `content_import_batches` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `history_retrieval_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`account_id` text NOT NULL,
	`retrieval_id` text NOT NULL,
	`content_id` text NOT NULL,
	`similarity` real NOT NULL,
	`retrieval_method` text NOT NULL,
	`source_hash` text NOT NULL,
	`rank` integer NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`retrieval_id`) REFERENCES `history_retrievals`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`account_id`,`content_id`) REFERENCES `contents`(`organization_id`,`account_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "history_retrieval_items_similarity_valid" CHECK("history_retrieval_items"."similarity" BETWEEN 0 AND 1),
	CONSTRAINT "history_retrieval_items_method_valid" CHECK("history_retrieval_items"."retrieval_method" IN ('embedding', 'fallback_bigram')),
	CONSTRAINT "history_retrieval_items_hash_valid" CHECK(length("history_retrieval_items"."source_hash") = 64),
	CONSTRAINT "history_retrieval_items_rank_valid" CHECK("history_retrieval_items"."rank" BETWEEN 1 AND 10 AND typeof("history_retrieval_items"."rank") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_history_retrieval_items_rank` ON `history_retrieval_items` (`organization_id`,`retrieval_id`,`rank`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_history_retrieval_items_content` ON `history_retrieval_items` (`organization_id`,`retrieval_id`,`content_id`);--> statement-breakpoint
CREATE INDEX `idx_history_retrieval_items_org_account` ON `history_retrieval_items` (`organization_id`,`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `history_retrievals` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`account_id` text NOT NULL,
	`candidate_json` text NOT NULL,
	`retrieval_method` text NOT NULL,
	`run_id` text,
	`created_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`account_id`) REFERENCES `accounts`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`run_id`) REFERENCES `runs`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`created_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "history_retrievals_method_valid" CHECK("history_retrievals"."retrieval_method" IN ('embedding', 'fallback_bigram'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_history_retrievals_org_id` ON `history_retrievals` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_history_retrievals_org_account_created` ON `history_retrievals` (`organization_id`,`account_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`store_id` text NOT NULL,
	`account_id` text NOT NULL,
	`monthly_plan_id` text,
	`title` text NOT NULL,
	`content_type` text NOT NULL,
	`content_goal` text NOT NULL,
	`topic` text DEFAULT '' NOT NULL,
	`angle` text DEFAULT '' NOT NULL,
	`hook_type` text DEFAULT 'other' NOT NULL,
	`hook_text` text DEFAULT '' NOT NULL,
	`core_message` text DEFAULT '' NOT NULL,
	`product_text` text DEFAULT '' NOT NULL,
	`cta_type` text DEFAULT '' NOT NULL,
	`local_element` text DEFAULT '' NOT NULL,
	`people_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'IDEA' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`operator_id` text NOT NULL,
	`planned_publish_date` text,
	`published_at` text,
	`deadline` text,
	`external_id` text,
	`import_dedup_key` text,
	`import_batch_id` text,
	`current_script_version_id` text,
	`active_approved_script_version_id` text,
	`current_edit_version_id` text,
	`active_approved_edit_version_id` text,
	`ai_review_status` text,
	`created_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`client_id`,`brand_id`,`store_id`,`account_id`) REFERENCES `accounts`(`organization_id`,`client_id`,`brand_id`,`store_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`account_id`,`monthly_plan_id`) REFERENCES `monthly_plans`(`organization_id`,`account_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`operator_id`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`created_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`import_batch_id`) REFERENCES `content_import_batches`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contents_type_valid" CHECK("__new_contents"."content_type" IN ('persona', 'product', 'local', 'trust', 'conversion', 'education', 'process', 'customer_case', 'other')),
	CONSTRAINT "contents_goal_valid" CHECK("__new_contents"."content_goal" IN ('exposure', 'followers', 'trust', 'click', 'conversion', 'gmv')),
	CONSTRAINT "contents_hook_valid" CHECK("__new_contents"."hook_type" IN ('contrast', 'conflict', 'price', 'question', 'identity', 'local', 'result', 'mistake', 'secret', 'challenge', 'other')),
	CONSTRAINT "contents_priority_valid" CHECK("__new_contents"."priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "contents_status_valid" CHECK("__new_contents"."status" IN ('IDEA', 'SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH', 'PUBLISHED', 'REVIEWED')),
	CONSTRAINT "contents_people_array" CHECK(json_type("__new_contents"."people_json") = 'array')
);
--> statement-breakpoint
INSERT INTO `__new_contents`("id", "organization_id", "client_id", "brand_id", "store_id", "account_id", "monthly_plan_id", "title", "content_type", "content_goal", "topic", "angle", "hook_type", "hook_text", "core_message", "product_text", "cta_type", "local_element", "people_json", "status", "priority", "operator_id", "planned_publish_date", "published_at", "deadline", "external_id", "import_dedup_key", "import_batch_id", "current_script_version_id", "active_approved_script_version_id", "current_edit_version_id", "active_approved_edit_version_id", "ai_review_status", "created_by", "is_demo", "created_at", "updated_at") SELECT "id", "organization_id", "client_id", "brand_id", "store_id", "account_id", "monthly_plan_id", "title", "content_type", "content_goal", "topic", "angle", "hook_type", "hook_text", "core_message", "product_text", "cta_type", "local_element", "people_json", "status", "priority", "operator_id", "planned_publish_date", NULL, "deadline", NULL, NULL, NULL, "current_script_version_id", "active_approved_script_version_id", "current_edit_version_id", "active_approved_edit_version_id", "ai_review_status", "created_by", "is_demo", "created_at", "updated_at" FROM `contents`;--> statement-breakpoint
DROP TABLE `contents`;--> statement-breakpoint
ALTER TABLE `__new_contents` RENAME TO `contents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contents_org_id` ON `contents` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contents_org_account_id` ON `contents` (`organization_id`,`account_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contents_import_dedup` ON `contents` (`organization_id`,`account_id`,`import_dedup_key`) WHERE "contents"."import_dedup_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_contents_org_account_status` ON `contents` (`organization_id`,`account_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_contents_org_plan` ON `contents` (`organization_id`,`monthly_plan_id`);--> statement-breakpoint
CREATE INDEX `idx_contents_org_publish_date` ON `contents` (`organization_id`,`planned_publish_date`);--> statement-breakpoint
CREATE INDEX `idx_contents_org_account_published` ON `contents` (`organization_id`,`account_id`,`published_at`);
