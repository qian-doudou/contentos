CREATE TABLE `strategy_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`account_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`metrics_snapshot_json` text NOT NULL,
	`previous_strategy_memory_ids_json` text DEFAULT '[]' NOT NULL,
	`ai_analysis_json` text NOT NULL,
	`ai_strategy_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`confirmed_by` text,
	`confirmed_at` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`account_id`) REFERENCES `accounts`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`confirmed_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "strategy_reviews_period_valid" CHECK("strategy_reviews"."period_start" < "strategy_reviews"."period_end"),
	CONSTRAINT "strategy_reviews_status_valid" CHECK("strategy_reviews"."status" IN ('draft', 'confirmed', 'rejected')),
	CONSTRAINT "strategy_reviews_confirmed_fields" CHECK((
    "strategy_reviews"."status" = 'confirmed' AND "strategy_reviews"."confirmed_by" IS NOT NULL AND "strategy_reviews"."confirmed_at" IS NOT NULL
  ) OR (
    "strategy_reviews"."status" <> 'confirmed' AND "strategy_reviews"."confirmed_by" IS NULL AND "strategy_reviews"."confirmed_at" IS NULL
  )),
	CONSTRAINT "strategy_reviews_memory_ids_array" CHECK(json_type("strategy_reviews"."previous_strategy_memory_ids_json") = 'array'),
	CONSTRAINT "strategy_reviews_metrics_object" CHECK(json_type("strategy_reviews"."metrics_snapshot_json") = 'object'),
	CONSTRAINT "strategy_reviews_analysis_object" CHECK(json_type("strategy_reviews"."ai_analysis_json") = 'object'),
	CONSTRAINT "strategy_reviews_strategy_object" CHECK(json_type("strategy_reviews"."ai_strategy_json") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_strategy_reviews_org_id` ON `strategy_reviews` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_strategy_reviews_org_account_period` ON `strategy_reviews` (`organization_id`,`account_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE INDEX `idx_strategy_reviews_org_status_created` ON `strategy_reviews` (`organization_id`,`status`,`created_at`);