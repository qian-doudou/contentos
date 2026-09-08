CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`content_id` text NOT NULL,
	`approval_type` text NOT NULL,
	`version_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewer_type` text NOT NULL,
	`reviewer_user_id` text,
	`review_token_hash` text,
	`expires_at` text,
	`comment` text DEFAULT '' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`content_id`) REFERENCES `contents`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`reviewer_user_id`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "approvals_type_valid" CHECK("approvals"."approval_type" IN ('script', 'final_video')),
	CONSTRAINT "approvals_status_valid" CHECK("approvals"."status" IN ('pending', 'approved', 'changes_requested', 'rejected', 'expired')),
	CONSTRAINT "approvals_reviewer_type_valid" CHECK("approvals"."reviewer_type" IN ('internal_user', 'external_client')),
	CONSTRAINT "approvals_token_hash_valid" CHECK("approvals"."review_token_hash" IS NULL OR length("approvals"."review_token_hash") = 64),
	CONSTRAINT "approvals_reviewer_binding_valid" CHECK((
    "approvals"."reviewer_type" = 'internal_user' AND "approvals"."reviewer_user_id" IS NOT NULL AND "approvals"."review_token_hash" IS NULL AND "approvals"."expires_at" IS NULL
  ) OR (
    "approvals"."reviewer_type" = 'external_client' AND "approvals"."reviewer_user_id" IS NULL AND "approvals"."review_token_hash" IS NOT NULL AND "approvals"."expires_at" IS NOT NULL
  ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_approvals_org_id` ON `approvals` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_approvals_review_token_hash` ON `approvals` (`review_token_hash`) WHERE "approvals"."review_token_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_approvals_org_content_created` ON `approvals` (`organization_id`,`content_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_approvals_org_status_expiry` ON `approvals` (`organization_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `script_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`content_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`script_json` text NOT NULL,
	`source_type` text NOT NULL,
	`change_summary` text NOT NULL,
	`created_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`content_id`) REFERENCES `contents`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`created_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "script_versions_version_positive" CHECK("script_versions"."version_no" >= 1 AND typeof("script_versions"."version_no") = 'integer'),
	CONSTRAINT "script_versions_source_valid" CHECK("script_versions"."source_type" IN ('ai', 'operator', 'client_revision', 'rewrite')),
	CONSTRAINT "script_versions_json_valid" CHECK(json_valid("script_versions"."script_json") AND json_type("script_versions"."script_json") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_script_versions_org_id` ON `script_versions` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_script_versions_org_content_version` ON `script_versions` (`organization_id`,`content_id`,`version_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_script_versions_org_content_id` ON `script_versions` (`organization_id`,`content_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_script_versions_org_content_created` ON `script_versions` (`organization_id`,`content_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_content_status_logs` (
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
	CONSTRAINT "content_status_logs_previous_valid" CHECK("__new_content_status_logs"."previous_status" IN ('IDEA', 'SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH', 'PUBLISHED', 'REVIEWED')),
	CONSTRAINT "content_status_logs_new_valid" CHECK("__new_content_status_logs"."new_status" IN ('IDEA', 'SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH', 'PUBLISHED', 'REVIEWED')),
	CONSTRAINT "content_status_logs_trigger_valid" CHECK("__new_content_status_logs"."trigger_type" IN ('manual', 'approval', 'shoot', 'publish', 'system'))
);
--> statement-breakpoint
INSERT INTO `__new_content_status_logs`("id", "organization_id", "content_id", "previous_status", "new_status", "trigger_type", "trigger_id", "operator_id", "reason", "is_demo", "created_at") SELECT "id", "organization_id", "content_id", "previous_status", "new_status", "trigger_type", "trigger_id", "operator_id", "reason", "is_demo", "created_at" FROM `content_status_logs`;--> statement-breakpoint
DROP TABLE `content_status_logs`;--> statement-breakpoint
ALTER TABLE `__new_content_status_logs` RENAME TO `content_status_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_content_status_logs_org_content_created` ON `content_status_logs` (`organization_id`,`content_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `validate_script_approval_version_insert`
BEFORE INSERT ON `approvals`
WHEN NEW.`approval_type` = 'script' AND NOT EXISTS (
	SELECT 1 FROM `script_versions`
	WHERE `organization_id` = NEW.`organization_id`
		AND `content_id` = NEW.`content_id`
		AND `id` = NEW.`version_id`
)
BEGIN
	SELECT RAISE(ABORT, 'script approval version does not belong to content organization');
END;--> statement-breakpoint
CREATE TRIGGER `validate_script_approval_version_update`
BEFORE UPDATE OF `organization_id`, `content_id`, `approval_type`, `version_id` ON `approvals`
WHEN NEW.`approval_type` = 'script' AND NOT EXISTS (
	SELECT 1 FROM `script_versions`
	WHERE `organization_id` = NEW.`organization_id`
		AND `content_id` = NEW.`content_id`
		AND `id` = NEW.`version_id`
)
BEGIN
	SELECT RAISE(ABORT, 'script approval version does not belong to content organization');
END;--> statement-breakpoint
CREATE TRIGGER `validate_content_script_pointers_update`
BEFORE UPDATE OF `current_script_version_id`, `active_approved_script_version_id` ON `contents`
WHEN (
	NEW.`current_script_version_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `script_versions`
		WHERE `organization_id` = NEW.`organization_id`
			AND `content_id` = NEW.`id`
			AND `id` = NEW.`current_script_version_id`
	)
) OR (
	NEW.`active_approved_script_version_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `script_versions`
		WHERE `organization_id` = NEW.`organization_id`
			AND `content_id` = NEW.`id`
			AND `id` = NEW.`active_approved_script_version_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'content script pointer does not belong to content organization');
END;
