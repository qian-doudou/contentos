CREATE TABLE `edit_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`content_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`asset_url` text NOT NULL,
	`asset_type` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`content_id`) REFERENCES `contents`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`created_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "edit_versions_version_positive" CHECK("edit_versions"."version_no" >= 1 AND typeof("edit_versions"."version_no") = 'integer'),
	CONSTRAINT "edit_versions_asset_type_valid" CHECK("edit_versions"."asset_type" IN ('url', 'local_reference')),
	CONSTRAINT "edit_versions_asset_url_present" CHECK(length(trim("edit_versions"."asset_url")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_edit_versions_org_id` ON `edit_versions` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_edit_versions_org_content_version` ON `edit_versions` (`organization_id`,`content_id`,`version_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_edit_versions_org_content_id` ON `edit_versions` (`organization_id`,`content_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_edit_versions_org_content_created` ON `edit_versions` (`organization_id`,`content_id`,`created_at`);--> statement-breakpoint
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
	CONSTRAINT "content_status_logs_previous_valid" CHECK("previous_status" IN ('IDEA', 'SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH', 'PUBLISHED', 'REVIEWED')),
	CONSTRAINT "content_status_logs_new_valid" CHECK("new_status" IN ('IDEA', 'SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH', 'PUBLISHED', 'REVIEWED')),
	CONSTRAINT "content_status_logs_trigger_valid" CHECK("trigger_type" IN ('manual', 'approval', 'shoot', 'edit', 'publish', 'system'))
);
--> statement-breakpoint
INSERT INTO `__new_content_status_logs`("id", "organization_id", "content_id", "previous_status", "new_status", "trigger_type", "trigger_id", "operator_id", "reason", "is_demo", "created_at") SELECT "id", "organization_id", "content_id", "previous_status", "new_status", "trigger_type", "trigger_id", "operator_id", "reason", "is_demo", "created_at" FROM `content_status_logs`;--> statement-breakpoint
DROP TABLE `content_status_logs`;--> statement-breakpoint
ALTER TABLE `__new_content_status_logs` RENAME TO `content_status_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_content_status_logs_org_content_created` ON `content_status_logs` (`organization_id`,`content_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `contents` ADD `editor_id` text;--> statement-breakpoint
CREATE TRIGGER `validate_content_edit_pointers_update`
BEFORE UPDATE OF `current_edit_version_id`, `active_approved_edit_version_id` ON `contents`
WHEN (
	NEW.`current_edit_version_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `edit_versions`
		WHERE `organization_id` = NEW.`organization_id`
			AND `content_id` = NEW.`id`
			AND `id` = NEW.`current_edit_version_id`
	)
) OR (
	NEW.`active_approved_edit_version_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `edit_versions`
		WHERE `organization_id` = NEW.`organization_id`
			AND `content_id` = NEW.`id`
			AND `id` = NEW.`active_approved_edit_version_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'content edit pointer does not belong to content organization');
END;--> statement-breakpoint
CREATE TRIGGER `validate_content_editor_insert`
BEFORE INSERT ON `contents`
WHEN NEW.`editor_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `users`
	WHERE `organization_id` = NEW.`organization_id`
		AND `id` = NEW.`editor_id`
		AND `role` = 'editor'
		AND `status` = 'active'
)
BEGIN
	SELECT RAISE(ABORT, 'content editor role is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `validate_content_editor_update`
BEFORE UPDATE OF `organization_id`, `editor_id` ON `contents`
WHEN NEW.`editor_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `users`
	WHERE `organization_id` = NEW.`organization_id`
		AND `id` = NEW.`editor_id`
		AND `role` = 'editor'
		AND `status` = 'active'
)
BEGIN
	SELECT RAISE(ABORT, 'content editor role is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `validate_final_video_approval_version_insert`
BEFORE INSERT ON `approvals`
WHEN NEW.`approval_type` = 'final_video' AND NOT EXISTS (
	SELECT 1 FROM `edit_versions`
	WHERE `organization_id` = NEW.`organization_id`
		AND `content_id` = NEW.`content_id`
		AND `id` = NEW.`version_id`
)
BEGIN
	SELECT RAISE(ABORT, 'final video approval version does not belong to content organization');
END;--> statement-breakpoint
CREATE TRIGGER `validate_final_video_approval_version_update`
BEFORE UPDATE OF `organization_id`, `content_id`, `approval_type`, `version_id` ON `approvals`
WHEN NEW.`approval_type` = 'final_video' AND NOT EXISTS (
	SELECT 1 FROM `edit_versions`
	WHERE `organization_id` = NEW.`organization_id`
		AND `content_id` = NEW.`content_id`
		AND `id` = NEW.`version_id`
)
BEGIN
	SELECT RAISE(ABORT, 'final video approval version does not belong to content organization');
END;--> statement-breakpoint
CREATE TRIGGER `edit_versions_immutable_update`
BEFORE UPDATE ON `edit_versions`
BEGIN
	SELECT RAISE(ABORT, 'edit version is immutable');
END;--> statement-breakpoint
PRAGMA foreign_key_check;--> statement-breakpoint
PRAGMA optimize;
