CREATE TABLE `__new_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`run_type` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text,
	`status` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`created_by` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "runs_status_valid" CHECK("__new_runs"."status" IN ('queued', 'running', 'completed', 'completed_with_warnings', 'manual_review_required', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_runs_organization_id` ON `__new_runs` (`organization_id`,`id`);--> statement-breakpoint
INSERT INTO `__new_runs`("id", "organization_id", "run_type", "subject_type", "subject_id", "status", "started_at", "finished_at", "created_by", "is_demo", "created_at") SELECT "id", "organization_id", "run_type", "subject_type", "subject_id", CASE WHEN "status" = 'pending' THEN 'queued' WHEN "status" = 'succeeded' THEN 'completed' ELSE "status" END, "started_at", "finished_at", "created_by", "is_demo", "created_at" FROM `runs`;--> statement-breakpoint
CREATE TABLE `__new_run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`step_code` text NOT NULL,
	`status` text NOT NULL,
	`input_json` text,
	`output_json` text,
	`error_json` text,
	`started_at` text,
	`finished_at` text,
	`duration_ms` integer,
	`warning_codes_json` text,
	`is_demo` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`run_id`) REFERENCES `__new_runs`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_run_steps`("id", "organization_id", "run_id", "sequence", "step_code", "status", "input_json", "output_json", "error_json", "started_at", "finished_at", "duration_ms", "warning_codes_json", "is_demo") SELECT "id", "organization_id", "run_id", "sequence", "step_code", "status", "input_json", "output_json", "error_json", "started_at", "finished_at", "duration_ms", "warning_codes_json", "is_demo" FROM `run_steps`;--> statement-breakpoint
DROP TABLE `run_steps`;--> statement-breakpoint
DROP TABLE `runs`;--> statement-breakpoint
ALTER TABLE `__new_runs` RENAME TO `runs`;--> statement-breakpoint
ALTER TABLE `__new_run_steps` RENAME TO `run_steps`;--> statement-breakpoint
CREATE INDEX `idx_runs_organization_created_at` ON `runs` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_runs_organization_status` ON `runs` (`organization_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_run_steps_run_sequence` ON `run_steps` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_run_steps_organization_id` ON `run_steps` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_run_steps_organization_id` ON `run_steps` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`system_prompt` text NOT NULL,
	`user_prompt_template` text NOT NULL,
	`input_schema_json` text NOT NULL,
	`output_schema_json` text NOT NULL,
	`model_profile` text NOT NULL,
	`point_cost` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "skills_code_valid" CHECK(length(trim("skills"."code")) > 0),
	CONSTRAINT "skills_model_profile_valid" CHECK("skills"."model_profile" IN ('light', 'standard', 'strong')),
	CONSTRAINT "skills_point_cost_nonnegative" CHECK("skills"."point_cost" >= 0 AND typeof("skills"."point_cost") = 'integer'),
	CONSTRAINT "skills_version_positive" CHECK("skills"."current_version" >= 1 AND typeof("skills"."current_version") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_skills_system_code` ON `skills` (`code`) WHERE "skills"."organization_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_skills_organization_code` ON `skills` (`organization_id`,`code`) WHERE "skills"."organization_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_skills_organization_enabled` ON `skills` (`organization_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `skill_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`skill_id` text NOT NULL,
	`version` integer NOT NULL,
	`system_prompt` text NOT NULL,
	`user_prompt_template` text NOT NULL,
	`input_schema_json` text NOT NULL,
	`output_schema_json` text NOT NULL,
	`model_profile` text NOT NULL,
	`point_cost` integer NOT NULL,
	`change_reason` text NOT NULL,
	`created_by` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "skill_versions_version_positive" CHECK("skill_versions"."version" >= 1 AND typeof("skill_versions"."version") = 'integer'),
	CONSTRAINT "skill_versions_model_profile_valid" CHECK("skill_versions"."model_profile" IN ('light', 'standard', 'strong')),
	CONSTRAINT "skill_versions_point_cost_nonnegative" CHECK("skill_versions"."point_cost" >= 0 AND typeof("skill_versions"."point_cost") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_skill_versions_skill_version` ON `skill_versions` (`skill_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_skill_versions_organization_skill` ON `skill_versions` (`organization_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `model_price_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`input_price_per_million` real,
	`output_price_per_million` real,
	`effective_at` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "model_price_configs_status_valid" CHECK("model_price_configs"."status" IN ('active', 'inactive')),
	CONSTRAINT "model_price_configs_input_nonnegative" CHECK("model_price_configs"."input_price_per_million" IS NULL OR "model_price_configs"."input_price_per_million" >= 0),
	CONSTRAINT "model_price_configs_output_nonnegative" CHECK("model_price_configs"."output_price_per_million" IS NULL OR "model_price_configs"."output_price_per_million" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_model_price_configs_model_effective` ON `model_price_configs` (`model`,`effective_at`);--> statement-breakpoint
CREATE INDEX `idx_model_price_configs_lookup` ON `model_price_configs` (`model`,`status`,`effective_at`);--> statement-breakpoint
CREATE TABLE `organization_ai_quotas` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`quota_points` integer NOT NULL,
	`used_points` integer DEFAULT 0 NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "organization_ai_quotas_period_valid" CHECK("organization_ai_quotas"."period_start" < "organization_ai_quotas"."period_end"),
	CONSTRAINT "organization_ai_quotas_points_valid" CHECK("organization_ai_quotas"."quota_points" >= 0 AND "organization_ai_quotas"."used_points" >= 0 AND "organization_ai_quotas"."used_points" <= "organization_ai_quotas"."quota_points")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_organization_ai_quotas_period` ON `organization_ai_quotas` (`organization_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE INDEX `idx_organization_ai_quotas_active` ON `organization_ai_quotas` (`organization_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE TABLE `ai_point_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`run_id` text,
	`skill_code` text NOT NULL,
	`points` integer NOT NULL,
	`ledger_type` text NOT NULL,
	`reason` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`run_id`) REFERENCES `runs`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_point_ledger_type_valid" CHECK("ai_point_ledger"."ledger_type" IN ('consume', 'grant', 'refund', 'adjustment')),
	CONSTRAINT "ai_point_ledger_points_positive" CHECK("ai_point_ledger"."points" > 0 AND typeof("ai_point_ledger"."points") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `idx_ai_point_ledger_organization_created` ON `ai_point_ledger` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ai_point_ledger_run_consume` ON `ai_point_ledger` (`organization_id`,`run_id`) WHERE "ai_point_ledger"."ledger_type" = 'consume' AND "ai_point_ledger"."run_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `ai_usage_logs` (
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
	CONSTRAINT "ai_usage_logs_status_valid" CHECK("ai_usage_logs"."status" IN ('completed', 'failed')),
	CONSTRAINT "ai_usage_logs_tokens_valid" CHECK(("ai_usage_logs"."input_tokens" IS NULL OR "ai_usage_logs"."input_tokens" >= 0) AND ("ai_usage_logs"."output_tokens" IS NULL OR "ai_usage_logs"."output_tokens" >= 0)),
	CONSTRAINT "ai_usage_logs_values_valid" CHECK("ai_usage_logs"."skill_version" >= 1 AND "ai_usage_logs"."billed_points" >= 0 AND "ai_usage_logs"."duration_ms" >= 0 AND ("ai_usage_logs"."estimated_cost" IS NULL OR "ai_usage_logs"."estimated_cost" >= 0))
);
--> statement-breakpoint
CREATE INDEX `idx_ai_usage_logs_organization_created` ON `ai_usage_logs` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_usage_logs_run` ON `ai_usage_logs` (`organization_id`,`run_id`);
