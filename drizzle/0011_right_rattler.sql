CREATE TABLE `shoot_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shoot_id` text NOT NULL,
	`content_id` text NOT NULL,
	`approved_script_version_id` text NOT NULL,
	`shoot_item_status` text DEFAULT 'planned' NOT NULL,
	`missing_shots` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`shoot_id`) REFERENCES `shoots`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`content_id`) REFERENCES `contents`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`content_id`,`approved_script_version_id`) REFERENCES `script_versions`(`organization_id`,`content_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shoot_contents_status_valid" CHECK("shoot_contents"."shoot_item_status" IN ('planned', 'shot', 'missing_shots', 'rescheduled', 'cancelled')),
	CONSTRAINT "shoot_contents_missing_detail" CHECK("shoot_contents"."shoot_item_status" <> 'missing_shots' OR length(trim("shoot_contents"."missing_shots")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_shoot_contents_org_id` ON `shoot_contents` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_shoot_contents_org_shoot_content` ON `shoot_contents` (`organization_id`,`shoot_id`,`content_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_shoot_contents_active_content` ON `shoot_contents` (`organization_id`,`content_id`) WHERE "shoot_contents"."shoot_item_status" IN ('planned', 'missing_shots');--> statement-breakpoint
CREATE INDEX `idx_shoot_contents_org_shoot_status` ON `shoot_contents` (`organization_id`,`shoot_id`,`shoot_item_status`);--> statement-breakpoint
CREATE INDEX `idx_shoot_contents_org_content` ON `shoot_contents` (`organization_id`,`content_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `shoots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`store_id` text NOT NULL,
	`shoot_date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`operator_id` text NOT NULL,
	`photographer_id` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`client_id`) REFERENCES `clients`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`store_id`) REFERENCES `stores`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`operator_id`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`photographer_id`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shoots_date_valid" CHECK(length("shoots"."shoot_date") = 10 AND date("shoots"."shoot_date") IS NOT NULL),
	CONSTRAINT "shoots_start_time_valid" CHECK(length("shoots"."start_time") = 5 AND time("shoots"."start_time") IS NOT NULL),
	CONSTRAINT "shoots_end_time_valid" CHECK(length("shoots"."end_time") = 5 AND time("shoots"."end_time") IS NOT NULL),
	CONSTRAINT "shoots_time_order" CHECK("shoots"."start_time" < "shoots"."end_time"),
	CONSTRAINT "shoots_status_valid" CHECK("shoots"."status" IN ('planned', 'in_progress', 'completed', 'partially_completed', 'cancelled', 'rescheduled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_shoots_org_id` ON `shoots` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_shoots_org_date_status` ON `shoots` (`organization_id`,`shoot_date`,`status`);--> statement-breakpoint
CREATE INDEX `idx_shoots_org_client_date` ON `shoots` (`organization_id`,`client_id`,`shoot_date`);--> statement-breakpoint
CREATE INDEX `idx_shoots_org_photographer_date` ON `shoots` (`organization_id`,`photographer_id`,`shoot_date`);
--> statement-breakpoint
CREATE TRIGGER `validate_shoot_hierarchy_insert`
BEFORE INSERT ON `shoots`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM stores s
    JOIN brands b ON b.organization_id = s.organization_id AND b.id = s.brand_id
    WHERE s.organization_id = NEW.organization_id AND s.id = NEW.store_id AND b.client_id = NEW.client_id
  ) THEN RAISE(ABORT, 'shoot store does not belong to client') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.organization_id = NEW.organization_id AND u.id = NEW.operator_id
      AND u.status = 'active' AND u.role IN ('owner', 'admin', 'operator')
  ) THEN RAISE(ABORT, 'shoot operator role is invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.organization_id = NEW.organization_id AND u.id = NEW.photographer_id
      AND u.status = 'active' AND u.role = 'photographer'
  ) THEN RAISE(ABORT, 'shoot photographer role is invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `validate_shoot_hierarchy_update`
BEFORE UPDATE OF organization_id, client_id, store_id, operator_id, photographer_id ON `shoots`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM stores s
    JOIN brands b ON b.organization_id = s.organization_id AND b.id = s.brand_id
    WHERE s.organization_id = NEW.organization_id AND s.id = NEW.store_id AND b.client_id = NEW.client_id
  ) THEN RAISE(ABORT, 'shoot store does not belong to client') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.organization_id = NEW.organization_id AND u.id = NEW.operator_id
      AND u.status = 'active' AND u.role IN ('owner', 'admin', 'operator')
  ) THEN RAISE(ABORT, 'shoot operator role is invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u WHERE u.organization_id = NEW.organization_id AND u.id = NEW.photographer_id
      AND u.status = 'active' AND u.role = 'photographer'
  ) THEN RAISE(ABORT, 'shoot photographer role is invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER `validate_shoot_content_insert`
BEFORE INSERT ON `shoot_contents`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM shoots s
    JOIN contents c ON c.organization_id = s.organization_id
      AND c.client_id = s.client_id AND c.store_id = s.store_id AND c.id = NEW.content_id
    WHERE s.organization_id = NEW.organization_id AND s.id = NEW.shoot_id
  ) THEN RAISE(ABORT, 'shoot content does not belong to shoot hierarchy') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM contents c
    WHERE c.organization_id = NEW.organization_id AND c.id = NEW.content_id
      AND c.active_approved_script_version_id = NEW.approved_script_version_id
      AND (
        c.status = 'APPROVED'
        OR (
          c.status = 'WAITING_SHOOT'
          AND EXISTS (
            SELECT 1 FROM shoot_contents old
            WHERE old.organization_id = NEW.organization_id AND old.content_id = NEW.content_id
              AND old.shoot_item_status = 'rescheduled'
          )
        )
      )
  ) THEN RAISE(ABORT, 'shoot content requires an active approved script') END;
END;
--> statement-breakpoint
CREATE TRIGGER `validate_shoot_content_identity_update`
BEFORE UPDATE OF organization_id, shoot_id, content_id, approved_script_version_id ON `shoot_contents`
WHEN NEW.organization_id IS NOT OLD.organization_id
  OR NEW.shoot_id IS NOT OLD.shoot_id
  OR NEW.content_id IS NOT OLD.content_id
  OR NEW.approved_script_version_id IS NOT OLD.approved_script_version_id
BEGIN
  SELECT RAISE(ABORT, 'shoot content identity is immutable');
END;
--> statement-breakpoint
PRAGMA optimize;
