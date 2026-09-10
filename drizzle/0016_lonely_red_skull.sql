CREATE TABLE `bad_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`run_id` text NOT NULL,
	`step_code` text NOT NULL,
	`skill_code` text NOT NULL,
	`skill_version` integer NOT NULL,
	`input_snapshot_json` text NOT NULL,
	`context_snapshot_json` text NOT NULL,
	`output_json` text NOT NULL,
	`expected_behavior` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`rule_generated` integer NOT NULL,
	`source_rating_id` text,
	`fingerprint` text NOT NULL,
	`created_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`run_id`) REFERENCES `runs`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`source_rating_id`) REFERENCES `ratings`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`created_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bad_cases_category_valid" CHECK("bad_cases"."category" IN (
    'brand_fact_error', 'expired_information', 'duplicate_content', 'wrong_style',
    'unusable_script', 'wrong_content_goal', 'poor_strategy', 'invalid_json',
    'context_missing', 'other', 'low_rating', 'memory_status_violation',
    'high_duplicate_default', 'schema_repeated_failure', 'manual_flag'
  )),
	CONSTRAINT "bad_cases_severity_valid" CHECK("bad_cases"."severity" IN ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "bad_cases_status_valid" CHECK("bad_cases"."status" IN ('open', 'investigating', 'resolved', 'dismissed')),
	CONSTRAINT "bad_cases_skill_version_valid" CHECK("bad_cases"."skill_version" >= 1 AND typeof("bad_cases"."skill_version") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bad_cases_org_id` ON `bad_cases` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bad_cases_org_fingerprint` ON `bad_cases` (`organization_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_bad_cases_org_status_created` ON `bad_cases` (`organization_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_bad_cases_org_skill_version` ON `bad_cases` (`organization_id`,`skill_code`,`skill_version`);--> statement-breakpoint
CREATE TABLE `eval_case_results` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`experiment_id` text NOT NULL,
	`eval_case_id` text NOT NULL,
	`variant` text NOT NULL,
	`run_id` text NOT NULL,
	`output_json` text NOT NULL,
	`metrics_json` text NOT NULL,
	`schema_valid` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`estimated_cost` real,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`experiment_id`) REFERENCES `eval_experiments`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`eval_case_id`) REFERENCES `eval_cases`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`run_id`) REFERENCES `runs`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "eval_case_results_variant_valid" CHECK("eval_case_results"."variant" IN ('a', 'b')),
	CONSTRAINT "eval_case_results_values_valid" CHECK("eval_case_results"."duration_ms" >= 0 AND ("eval_case_results"."estimated_cost" IS NULL OR "eval_case_results"."estimated_cost" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_eval_case_results_org_id` ON `eval_case_results` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_eval_case_results_experiment_case_variant` ON `eval_case_results` (`organization_id`,`experiment_id`,`eval_case_id`,`variant`);--> statement-breakpoint
CREATE INDEX `idx_eval_case_results_org_experiment` ON `eval_case_results` (`organization_id`,`experiment_id`,`variant`);--> statement-breakpoint
CREATE TABLE `eval_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`name` text NOT NULL,
	`skill_code` text NOT NULL,
	`skill_version` integer NOT NULL,
	`input_snapshot_json` text NOT NULL,
	`context_snapshot_json` text NOT NULL,
	`expected_behavior` text NOT NULL,
	`expected_duplicate_level` text,
	`assertions_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`created_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "eval_cases_source_valid" CHECK("eval_cases"."source_type" IN ('bad_case', 'high_rating_production', 'manual')),
	CONSTRAINT "eval_cases_status_valid" CHECK("eval_cases"."status" IN ('active', 'inactive')),
	CONSTRAINT "eval_cases_version_valid" CHECK("eval_cases"."skill_version" >= 1 AND typeof("eval_cases"."skill_version") = 'integer'),
	CONSTRAINT "eval_cases_duplicate_level_valid" CHECK("eval_cases"."expected_duplicate_level" IS NULL OR "eval_cases"."expected_duplicate_level" IN ('new', 'mild', 'remixable', 'high'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_eval_cases_org_id` ON `eval_cases` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_eval_cases_org_source` ON `eval_cases` (`organization_id`,`source_type`,`source_id`) WHERE "eval_cases"."source_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_eval_cases_org_skill_status` ON `eval_cases` (`organization_id`,`skill_code`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `eval_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`proposal_id` text NOT NULL,
	`baseline_skill_version` integer NOT NULL,
	`model_profile` text NOT NULL,
	`case_ids_json` text NOT NULL,
	`run_ids_a_json` text DEFAULT '[]' NOT NULL,
	`run_ids_b_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`verdict` text DEFAULT 'data_insufficient' NOT NULL,
	`metrics_a_json` text DEFAULT '{}' NOT NULL,
	`metrics_b_json` text DEFAULT '{}' NOT NULL,
	`comparison_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`proposal_id`) REFERENCES `improvement_proposals`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`created_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "eval_experiments_status_valid" CHECK("eval_experiments"."status" IN ('running', 'completed', 'failed')),
	CONSTRAINT "eval_experiments_verdict_valid" CHECK("eval_experiments"."verdict" IN ('data_insufficient', 'passed', 'regressed')),
	CONSTRAINT "eval_experiments_arrays_valid" CHECK(json_type("eval_experiments"."case_ids_json") = 'array' AND json_type("eval_experiments"."run_ids_a_json") = 'array' AND json_type("eval_experiments"."run_ids_b_json") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_eval_experiments_org_id` ON `eval_experiments` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_eval_experiments_org_proposal_created` ON `eval_experiments` (`organization_id`,`proposal_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `improvement_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`base_skill_version` integer NOT NULL,
	`proposal_run_id` text NOT NULL,
	`root_cause` text NOT NULL,
	`change_reason` text NOT NULL,
	`new_system_prompt` text NOT NULL,
	`new_user_prompt_template` text NOT NULL,
	`risks_json` text DEFAULT '[]' NOT NULL,
	`affected_cases_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`applied_skill_version` integer,
	`applied_by` text,
	`applied_at` text,
	`created_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`proposal_run_id`) REFERENCES `runs`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`applied_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`created_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "improvement_proposals_status_valid" CHECK("improvement_proposals"."status" IN ('draft', 'evaluated', 'applied', 'rejected')),
	CONSTRAINT "improvement_proposals_version_valid" CHECK("improvement_proposals"."base_skill_version" >= 1 AND ("improvement_proposals"."applied_skill_version" IS NULL OR "improvement_proposals"."applied_skill_version" > "improvement_proposals"."base_skill_version")),
	CONSTRAINT "improvement_proposals_cases_array" CHECK(json_type("improvement_proposals"."affected_cases_json") = 'array' AND json_type("improvement_proposals"."risks_json") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_improvement_proposals_org_id` ON `improvement_proposals` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_improvement_proposals_org_status_created` ON `improvement_proposals` (`organization_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `rating_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`rating_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`overall_score` integer NOT NULL,
	`brand_consistency` integer NOT NULL,
	`usability` integer NOT NULL,
	`novelty` integer NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`issue_tags_json` text DEFAULT '[]' NOT NULL,
	`marked_bad_case` integer DEFAULT false NOT NULL,
	`rated_by` text NOT NULL,
	`rated_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`rating_id`) REFERENCES `ratings`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`rated_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rating_versions_scores_valid" CHECK(
    "rating_versions"."overall_score" BETWEEN 1 AND 5 AND "rating_versions"."brand_consistency" BETWEEN 1 AND 5 AND
    "rating_versions"."usability" BETWEEN 1 AND 5 AND "rating_versions"."novelty" BETWEEN 1 AND 5
  ),
	CONSTRAINT "rating_versions_version_valid" CHECK("rating_versions"."version_no" >= 1 AND typeof("rating_versions"."version_no") = 'integer'),
	CONSTRAINT "rating_versions_issue_tags_array" CHECK(json_type("rating_versions"."issue_tags_json") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_rating_versions_org_id` ON `rating_versions` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_rating_versions_rating_version` ON `rating_versions` (`organization_id`,`rating_id`,`version_no`);--> statement-breakpoint
CREATE INDEX `idx_rating_versions_org_rating` ON `rating_versions` (`organization_id`,`rating_id`,`version_no`);--> statement-breakpoint
CREATE TABLE `ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`run_id` text NOT NULL,
	`overall_score` integer NOT NULL,
	`brand_consistency` integer NOT NULL,
	`usability` integer NOT NULL,
	`novelty` integer NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`issue_tags_json` text DEFAULT '[]' NOT NULL,
	`marked_bad_case` integer DEFAULT false NOT NULL,
	`rated_by` text NOT NULL,
	`rated_at` text NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`run_id`) REFERENCES `runs`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`rated_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ratings_scores_valid" CHECK(
    "ratings"."overall_score" BETWEEN 1 AND 5 AND "ratings"."brand_consistency" BETWEEN 1 AND 5 AND
    "ratings"."usability" BETWEEN 1 AND 5 AND "ratings"."novelty" BETWEEN 1 AND 5
  ),
	CONSTRAINT "ratings_version_valid" CHECK("ratings"."current_version" >= 1 AND typeof("ratings"."current_version") = 'integer'),
	CONSTRAINT "ratings_issue_tags_array" CHECK(json_type("ratings"."issue_tags_json") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ratings_org_run_rater` ON `ratings` (`organization_id`,`run_id`,`rated_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ratings_org_id` ON `ratings` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_ratings_org_run` ON `ratings` (`organization_id`,`run_id`,`rated_at`);
--> statement-breakpoint
CREATE TRIGGER prevent_rating_versions_update
BEFORE UPDATE ON rating_versions
BEGIN
  SELECT RAISE(ABORT, 'rating_versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER prevent_rating_versions_delete
BEFORE DELETE ON rating_versions
BEGIN
  SELECT RAISE(ABORT, 'rating_versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER prevent_eval_case_results_update
BEFORE UPDATE ON eval_case_results
BEGIN
  SELECT RAISE(ABORT, 'eval_case_results are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER prevent_eval_case_results_delete
BEFORE DELETE ON eval_case_results
BEGIN
  SELECT RAISE(ABORT, 'eval_case_results are immutable');
END;
