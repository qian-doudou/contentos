CREATE TABLE `user_permission_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`permission_code` text NOT NULL,
	`effect` text NOT NULL,
	`reason` text NOT NULL,
	`expires_at` text,
	`granted_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`,`user_id`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`granted_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_permission_overrides_permission_valid" CHECK("user_permission_overrides"."permission_code" IN (
    'master_data.write', 'team.read', 'team.manage', 'skills.read', 'skills.write',
    'ai.test', 'ai.settings', 'runs.read', 'ops.read', 'eval.read', 'eval.rate',
    'eval.manage', 'memory.read', 'memory.write', 'context.build', 'system.dangerous'
  )),
	CONSTRAINT "user_permission_overrides_effect_valid" CHECK("user_permission_overrides"."effect" IN ('allow', 'deny')),
	CONSTRAINT "user_permission_overrides_reason_valid" CHECK(length(trim("user_permission_overrides"."reason")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_permission_overrides_org_id` ON `user_permission_overrides` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_permission_overrides_user_permission` ON `user_permission_overrides` (`organization_id`,`user_id`,`permission_code`);--> statement-breakpoint
CREATE INDEX `idx_user_permission_overrides_org_user_expiry` ON `user_permission_overrides` (`organization_id`,`user_id`,`expires_at`);