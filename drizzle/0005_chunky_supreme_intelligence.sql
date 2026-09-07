CREATE TABLE `content_status_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`content_id` text NOT NULL,
	`previous_status` text NOT NULL,
	`new_status` text NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_id` text,
	`operator_id` text NOT NULL,
	`reason` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`content_id`) REFERENCES `contents`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`operator_id`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "content_status_logs_previous_valid" CHECK("content_status_logs"."previous_status" IN ('IDEA', 'SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH', 'PUBLISHED', 'REVIEWED')),
	CONSTRAINT "content_status_logs_new_valid" CHECK("content_status_logs"."new_status" IN ('IDEA', 'SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH', 'PUBLISHED', 'REVIEWED')),
	CONSTRAINT "content_status_logs_trigger_valid" CHECK("content_status_logs"."trigger_type" IN ('manual', 'shoot', 'publish', 'system'))
);
--> statement-breakpoint
CREATE INDEX `idx_content_status_logs_org_content_created` ON `content_status_logs` (`organization_id`,`content_id`,`created_at`);--> statement-breakpoint
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
	CONSTRAINT "contents_type_valid" CHECK("__new_contents"."content_type" IN ('persona', 'product', 'local', 'trust', 'conversion', 'education', 'process', 'customer_case', 'other')),
	CONSTRAINT "contents_goal_valid" CHECK("__new_contents"."content_goal" IN ('exposure', 'followers', 'trust', 'click', 'conversion', 'gmv')),
	CONSTRAINT "contents_hook_valid" CHECK("__new_contents"."hook_type" IN ('contrast', 'conflict', 'price', 'question', 'identity', 'local', 'result', 'mistake', 'secret', 'challenge', 'other')),
	CONSTRAINT "contents_priority_valid" CHECK("__new_contents"."priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "contents_status_valid" CHECK("__new_contents"."status" IN ('IDEA', 'SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH', 'PUBLISHED', 'REVIEWED')),
	CONSTRAINT "contents_people_array" CHECK(json_type("__new_contents"."people_json") = 'array')
);
--> statement-breakpoint
INSERT INTO `__new_contents`("id", "organization_id", "client_id", "brand_id", "store_id", "account_id", "monthly_plan_id", "title", "content_type", "content_goal", "topic", "angle", "hook_type", "hook_text", "core_message", "product_text", "cta_type", "local_element", "people_json", "status", "priority", "operator_id", "planned_publish_date", "deadline", "current_script_version_id", "active_approved_script_version_id", "current_edit_version_id", "active_approved_edit_version_id", "ai_review_status", "created_by", "is_demo", "created_at", "updated_at") SELECT "id", "organization_id", "client_id", "brand_id", "store_id", "account_id", "monthly_plan_id", "title", "content_type", "content_goal", "topic", "angle", "hook_type", "hook_text", "core_message", "product_text", "cta_type", "local_element", "people_json", CASE WHEN "status" IN ('IDEA', 'SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH', 'PUBLISHED', 'REVIEWED') THEN "status" ELSE 'IDEA' END, "priority", "operator_id", "planned_publish_date", "deadline", "current_script_version_id", "active_approved_script_version_id", "current_edit_version_id", "active_approved_edit_version_id", "ai_review_status", "created_by", "is_demo", "created_at", "updated_at" FROM `contents`;--> statement-breakpoint
DROP TABLE `contents`;--> statement-breakpoint
ALTER TABLE `__new_contents` RENAME TO `contents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_contents_org_id` ON `contents` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_contents_org_account_status` ON `contents` (`organization_id`,`account_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_contents_org_plan` ON `contents` (`organization_id`,`monthly_plan_id`);--> statement-breakpoint
CREATE INDEX `idx_contents_org_publish_date` ON `contents` (`organization_id`,`planned_publish_date`);
