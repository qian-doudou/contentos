CREATE TABLE `client_members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_override` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`,`client_id`) REFERENCES `clients`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`user_id`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "client_members_role_valid" CHECK("client_members"."role_override" IS NULL OR "client_members"."role_override" IN ('owner', 'admin', 'operator', 'photographer', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_client_members_org_client_user` ON `client_members` (`organization_id`,`client_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_client_members_org_user` ON `client_members` (`organization_id`,`user_id`);