CREATE TABLE `context_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`account_id` text NOT NULL,
	`content_id` text,
	`monthly_plan_id` text,
	`context_snapshot_json` text NOT NULL,
	`created_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`account_id`) REFERENCES `accounts`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`content_id`) REFERENCES `contents`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`account_id`,`monthly_plan_id`) REFERENCES `monthly_plans`(`organization_id`,`account_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`created_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_context_snapshots_org_id` ON `context_snapshots` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_context_snapshots_org_account_created` ON `context_snapshots` (`organization_id`,`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`memory_key` text NOT NULL,
	`memory_type` text NOT NULL,
	`value_json` text NOT NULL,
	`summary` text NOT NULL,
	`importance` integer NOT NULL,
	`confidence` real NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`effective_at` text NOT NULL,
	`expires_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`supersedes_memory_id` text,
	`created_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`created_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`supersedes_memory_id`) REFERENCES `memories`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memories_scope_type_valid" CHECK("memories"."scope_type" IN ('brand', 'account')),
	CONSTRAINT "memories_type_valid" CHECK("memories"."memory_type" IN ('brand', 'preference', 'content_pattern', 'performance_pattern', 'strategy', 'temporary')),
	CONSTRAINT "memories_status_valid" CHECK("memories"."status" IN ('active', 'inactive', 'superseded', 'expired')),
	CONSTRAINT "memories_source_type_valid" CHECK("memories"."source_type" IN ('brand_profile', 'confirmed_preference', 'confirmed_performance', 'confirmed_strategy', 'manual')),
	CONSTRAINT "memories_importance_valid" CHECK("memories"."importance" BETWEEN 1 AND 5 AND typeof("memories"."importance") = 'integer'),
	CONSTRAINT "memories_confidence_valid" CHECK("memories"."confidence" BETWEEN 0 AND 1),
	CONSTRAINT "memories_expiration_order" CHECK("memories"."expires_at" IS NULL OR "memories"."effective_at" < "memories"."expires_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_memories_org_id` ON `memories` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_memories_active_key` ON `memories` (`organization_id`,`scope_type`,`scope_id`,`memory_key`) WHERE "memories"."status" = 'active';--> statement-breakpoint
CREATE INDEX `idx_memories_context_lookup` ON `memories` (`organization_id`,`scope_type`,`scope_id`,`status`,`effective_at`);--> statement-breakpoint
CREATE INDEX `idx_memories_expiration` ON `memories` (`organization_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE TRIGGER `memories_scope_insert_guard`
BEFORE INSERT ON `memories`
BEGIN
  SELECT CASE
    WHEN NEW.scope_type = 'brand' AND NOT EXISTS (
      SELECT 1 FROM brands WHERE organization_id = NEW.organization_id AND id = NEW.scope_id
    ) THEN RAISE(ABORT, 'memory brand scope does not belong to organization')
    WHEN NEW.scope_type = 'account' AND NOT EXISTS (
      SELECT 1 FROM accounts WHERE organization_id = NEW.organization_id AND id = NEW.scope_id
    ) THEN RAISE(ABORT, 'memory account scope does not belong to organization')
  END;
END;--> statement-breakpoint
CREATE TRIGGER `memories_scope_update_guard`
BEFORE UPDATE OF organization_id, scope_type, scope_id ON `memories`
BEGIN
  SELECT CASE
    WHEN NEW.scope_type = 'brand' AND NOT EXISTS (
      SELECT 1 FROM brands WHERE organization_id = NEW.organization_id AND id = NEW.scope_id
    ) THEN RAISE(ABORT, 'memory brand scope does not belong to organization')
    WHEN NEW.scope_type = 'account' AND NOT EXISTS (
      SELECT 1 FROM accounts WHERE organization_id = NEW.organization_id AND id = NEW.scope_id
    ) THEN RAISE(ABORT, 'memory account scope does not belong to organization')
  END;
END;
