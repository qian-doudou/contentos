CREATE TABLE `contents` (
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
	`status` text DEFAULT 'active' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`operator_id` text NOT NULL,
	`planned_publish_date` text,
	`deadline` text,
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
	CONSTRAINT "contents_type_valid" CHECK("contents"."content_type" IN ('persona', 'product', 'local', 'trust', 'conversion', 'education', 'process', 'customer_case', 'other')),
	CONSTRAINT "contents_goal_valid" CHECK("contents"."content_goal" IN ('exposure', 'followers', 'trust', 'click', 'conversion', 'gmv')),
	CONSTRAINT "contents_hook_valid" CHECK("contents"."hook_type" IN ('contrast', 'conflict', 'price', 'question', 'identity', 'local', 'result', 'mistake', 'secret', 'challenge', 'other')),
	CONSTRAINT "contents_priority_valid" CHECK("contents"."priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "contents_status_valid" CHECK("contents"."status" IN ('active', 'inactive')),
	CONSTRAINT "contents_people_array" CHECK(json_type("contents"."people_json") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contents_org_id` ON `contents` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_contents_org_account_status` ON `contents` (`organization_id`,`account_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_contents_org_plan` ON `contents` (`organization_id`,`monthly_plan_id`);--> statement-breakpoint
CREATE INDEX `idx_contents_org_publish_date` ON `contents` (`organization_id`,`planned_publish_date`);--> statement-breakpoint
CREATE TABLE `monthly_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`account_id` text NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`primary_goal` text NOT NULL,
	`planned_content_count` integer DEFAULT 0 NOT NULL,
	`campaign_notes` text DEFAULT '' NOT NULL,
	`key_products_json` text DEFAULT '[]' NOT NULL,
	`content_mix_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`account_id`) REFERENCES `accounts`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`created_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "monthly_plans_year_valid" CHECK("monthly_plans"."year" BETWEEN 2000 AND 2100 AND typeof("monthly_plans"."year") = 'integer'),
	CONSTRAINT "monthly_plans_month_valid" CHECK("monthly_plans"."month" BETWEEN 1 AND 12 AND typeof("monthly_plans"."month") = 'integer'),
	CONSTRAINT "monthly_plans_count_nonnegative" CHECK("monthly_plans"."planned_content_count" >= 0 AND typeof("monthly_plans"."planned_content_count") = 'integer'),
	CONSTRAINT "monthly_plans_status_valid" CHECK("monthly_plans"."status" IN ('active', 'inactive')),
	CONSTRAINT "monthly_plans_goal_valid" CHECK("monthly_plans"."primary_goal" IN ('exposure', 'followers', 'trust', 'click', 'conversion', 'gmv')),
	CONSTRAINT "monthly_plans_products_array" CHECK(json_type("monthly_plans"."key_products_json") = 'array'),
	CONSTRAINT "monthly_plans_mix_object" CHECK(json_type("monthly_plans"."content_mix_json") = 'object'),
	CONSTRAINT "monthly_plans_mix_total" CHECK((
    "monthly_plans"."planned_content_count" = 0 AND "monthly_plans"."content_mix_json" = '{}'
  ) OR (
    coalesce(json_extract("monthly_plans"."content_mix_json", '$.persona'), 0) +
    coalesce(json_extract("monthly_plans"."content_mix_json", '$.product'), 0) +
    coalesce(json_extract("monthly_plans"."content_mix_json", '$.local'), 0) +
    coalesce(json_extract("monthly_plans"."content_mix_json", '$.trust'), 0) +
    coalesce(json_extract("monthly_plans"."content_mix_json", '$.conversion'), 0) +
    coalesce(json_extract("monthly_plans"."content_mix_json", '$.education'), 0) +
    coalesce(json_extract("monthly_plans"."content_mix_json", '$.process'), 0) +
    coalesce(json_extract("monthly_plans"."content_mix_json", '$.customer_case'), 0) +
    coalesce(json_extract("monthly_plans"."content_mix_json", '$.other'), 0) = 100
  ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_monthly_plans_org_account_period` ON `monthly_plans` (`organization_id`,`account_id`,`year`,`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_monthly_plans_org_account_id` ON `monthly_plans` (`organization_id`,`account_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_monthly_plans_org_period` ON `monthly_plans` (`organization_id`,`year`,`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_accounts_org_hierarchy_id` ON `accounts` (`organization_id`,`client_id`,`brand_id`,`store_id`,`id`);