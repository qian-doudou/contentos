PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_usage_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`run_id` text NOT NULL,
	`run_step_id` text NOT NULL,
	`run_type` text NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text,
	`account_id` text,
	`skill_code` text NOT NULL,
	`skill_version` integer NOT NULL,
	`provider_request_id` text,
	`model` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`estimated_cost` real,
	`billed_points` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`duration_ms` integer NOT NULL,
	`status` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`run_id`) REFERENCES `runs`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`run_step_id`) REFERENCES `run_steps`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`user_id`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`client_id`) REFERENCES `clients`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`account_id`) REFERENCES `accounts`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_usage_logs_status_valid" CHECK("__new_ai_usage_logs"."status" IN ('completed', 'failed')),
	CONSTRAINT "ai_usage_logs_tokens_valid" CHECK(("__new_ai_usage_logs"."input_tokens" IS NULL OR "__new_ai_usage_logs"."input_tokens" >= 0) AND ("__new_ai_usage_logs"."output_tokens" IS NULL OR "__new_ai_usage_logs"."output_tokens" >= 0)),
	CONSTRAINT "ai_usage_logs_values_valid" CHECK("__new_ai_usage_logs"."skill_version" >= 1 AND "__new_ai_usage_logs"."billed_points" >= 0 AND "__new_ai_usage_logs"."attempts" BETWEEN 1 AND 2 AND "__new_ai_usage_logs"."duration_ms" >= 0 AND ("__new_ai_usage_logs"."estimated_cost" IS NULL OR "__new_ai_usage_logs"."estimated_cost" >= 0))
);
--> statement-breakpoint
INSERT INTO `__new_ai_usage_logs`("id", "organization_id", "run_id", "run_step_id", "run_type", "user_id", "client_id", "account_id", "skill_code", "skill_version", "provider_request_id", "model", "input_tokens", "output_tokens", "estimated_cost", "billed_points", "attempts", "duration_ms", "status", "is_demo", "created_at") SELECT "id", "organization_id", "run_id", "run_step_id", "run_type", "user_id", "client_id", "account_id", "skill_code", "skill_version", "provider_request_id", "model", "input_tokens", "output_tokens", "estimated_cost", "billed_points", 1, "duration_ms", "status", "is_demo", "created_at" FROM `ai_usage_logs`;--> statement-breakpoint
DROP TABLE `ai_usage_logs`;--> statement-breakpoint
ALTER TABLE `__new_ai_usage_logs` RENAME TO `ai_usage_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_ai_usage_logs_organization_created` ON `ai_usage_logs` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_usage_logs_run` ON `ai_usage_logs` (`organization_id`,`run_id`);--> statement-breakpoint
CREATE INDEX `idx_contents_org_created_by_created` ON `contents` (`organization_id`,`created_by`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_contents_org_operator_deadline` ON `contents` (`organization_id`,`operator_id`,`deadline`);--> statement-breakpoint
CREATE INDEX `idx_edit_versions_org_creator_created` ON `edit_versions` (`organization_id`,`created_by`,`created_at`);
