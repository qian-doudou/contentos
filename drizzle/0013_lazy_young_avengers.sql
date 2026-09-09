CREATE TABLE `performance_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source_hash` text NOT NULL,
	`mapping_json` text NOT NULL,
	`preview_json` text NOT NULL,
	`status` text DEFAULT 'previewed' NOT NULL,
	`total_rows` integer NOT NULL,
	`valid_rows` integer NOT NULL,
	`duplicate_rows` integer NOT NULL,
	`invalid_rows` integer NOT NULL,
	`committed_rows` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`committed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`created_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "performance_import_batches_status_valid" CHECK("performance_import_batches"."status" IN ('previewed', 'committed', 'failed')),
	CONSTRAINT "performance_import_batches_counts_valid" CHECK(
    "performance_import_batches"."total_rows" >= 0 AND "performance_import_batches"."valid_rows" >= 0 AND "performance_import_batches"."duplicate_rows" >= 0 AND "performance_import_batches"."invalid_rows" >= 0 AND
    "performance_import_batches"."committed_rows" >= 0 AND "performance_import_batches"."valid_rows" + "performance_import_batches"."duplicate_rows" + "performance_import_batches"."invalid_rows" = "performance_import_batches"."total_rows"
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_performance_import_batches_org_id` ON `performance_import_batches` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_performance_import_batches_org_created` ON `performance_import_batches` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `performance_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`publish_id` text NOT NULL,
	`snapshot_time` text NOT NULL,
	`views` integer,
	`likes` integer,
	`comments` integer,
	`shares` integer,
	`favorites` integer,
	`profile_visits` integer,
	`groupbuy_clicks` integer,
	`orders` integer,
	`gmv` real,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`publish_id`) REFERENCES `publishes`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "performance_snapshots_nonnegative" CHECK(
    ("performance_snapshots"."views" IS NULL OR ("performance_snapshots"."views" >= 0 AND typeof("performance_snapshots"."views") = 'integer')) AND
    ("performance_snapshots"."likes" IS NULL OR ("performance_snapshots"."likes" >= 0 AND typeof("performance_snapshots"."likes") = 'integer')) AND
    ("performance_snapshots"."comments" IS NULL OR ("performance_snapshots"."comments" >= 0 AND typeof("performance_snapshots"."comments") = 'integer')) AND
    ("performance_snapshots"."shares" IS NULL OR ("performance_snapshots"."shares" >= 0 AND typeof("performance_snapshots"."shares") = 'integer')) AND
    ("performance_snapshots"."favorites" IS NULL OR ("performance_snapshots"."favorites" >= 0 AND typeof("performance_snapshots"."favorites") = 'integer')) AND
    ("performance_snapshots"."profile_visits" IS NULL OR ("performance_snapshots"."profile_visits" >= 0 AND typeof("performance_snapshots"."profile_visits") = 'integer')) AND
    ("performance_snapshots"."groupbuy_clicks" IS NULL OR ("performance_snapshots"."groupbuy_clicks" >= 0 AND typeof("performance_snapshots"."groupbuy_clicks") = 'integer')) AND
    ("performance_snapshots"."orders" IS NULL OR ("performance_snapshots"."orders" >= 0 AND typeof("performance_snapshots"."orders") = 'integer')) AND
    ("performance_snapshots"."gmv" IS NULL OR "performance_snapshots"."gmv" >= 0)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_performance_snapshots_org_id` ON `performance_snapshots` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_performance_snapshots_publish_time` ON `performance_snapshots` (`organization_id`,`publish_id`,`snapshot_time`);--> statement-breakpoint
CREATE INDEX `idx_performance_snapshots_org_time` ON `performance_snapshots` (`organization_id`,`snapshot_time`);--> statement-breakpoint
CREATE TABLE `publishes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`content_id` text NOT NULL,
	`platform` text NOT NULL,
	`published_at` text NOT NULL,
	`post_url` text NOT NULL,
	`platform_post_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`content_id`) REFERENCES `contents`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`created_by`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "publishes_platform_valid" CHECK("publishes"."platform" IN ('douyin')),
	CONSTRAINT "publishes_status_valid" CHECK("publishes"."status" IN ('active', 'inactive')),
	CONSTRAINT "publishes_post_url_present" CHECK(length(trim("publishes"."post_url")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_publishes_org_id` ON `publishes` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_publishes_active_content` ON `publishes` (`organization_id`,`content_id`) WHERE "publishes"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `uq_publishes_platform_post` ON `publishes` (`organization_id`,`platform`,`platform_post_id`) WHERE "publishes"."platform_post_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_publishes_org_published` ON `publishes` (`organization_id`,`published_at`);--> statement-breakpoint
CREATE TRIGGER validate_publish_ready_insert
BEFORE INSERT ON publishes
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM contents c
    JOIN edit_versions e
      ON e.organization_id = c.organization_id
     AND e.content_id = c.id
     AND e.id = c.active_approved_edit_version_id
    WHERE c.organization_id = NEW.organization_id
      AND c.id = NEW.content_id
      AND c.status = 'READY_TO_PUBLISH'
  ) THEN RAISE(ABORT, 'publish requires ready content with approved edit') END;
END;--> statement-breakpoint
CREATE TRIGGER performance_snapshots_immutable_update
BEFORE UPDATE ON performance_snapshots
BEGIN
  SELECT RAISE(ABORT, 'performance snapshot is immutable');
END;--> statement-breakpoint
PRAGMA foreign_key_check;--> statement-breakpoint
PRAGMA optimize;
