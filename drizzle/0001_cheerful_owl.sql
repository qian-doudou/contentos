CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`client_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`store_id` text NOT NULL,
	`platform` text DEFAULT 'douyin' NOT NULL,
	`account_name` text NOT NULL,
	`account_type` text DEFAULT 'other' NOT NULL,
	`account_goal_json` text DEFAULT '[]' NOT NULL,
	`content_style_json` text DEFAULT '[]' NOT NULL,
	`forbidden_style_json` text DEFAULT '[]' NOT NULL,
	`followers` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`client_id`) REFERENCES `clients`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`client_id`,`brand_id`) REFERENCES `brands`(`organization_id`,`client_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`brand_id`,`store_id`) REFERENCES `stores`(`organization_id`,`brand_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "accounts_status_valid" CHECK("accounts"."status" IN ('active', 'inactive')),
	CONSTRAINT "accounts_platform_valid" CHECK("accounts"."platform" = 'douyin'),
	CONSTRAINT "accounts_type_valid" CHECK("accounts"."account_type" IN ('official', 'owner_ip', 'employee_ip', 'store', 'other')),
	CONSTRAINT "accounts_followers_nonnegative" CHECK("accounts"."followers" IS NULL OR ("accounts"."followers" >= 0 AND typeof("accounts"."followers") = 'integer')),
	CONSTRAINT "accounts_json_arrays" CHECK(json_type("accounts"."account_goal_json") = 'array' AND json_type("accounts"."content_style_json") = 'array' AND json_type("accounts"."forbidden_style_json") = 'array')
);
--> statement-breakpoint
CREATE INDEX `idx_accounts_org_hierarchy` ON `accounts` (`organization_id`,`client_id`,`brand_id`,`store_id`);--> statement-breakpoint
CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`client_id` text NOT NULL,
	`brand_name` text NOT NULL,
	`industry` text DEFAULT '' NOT NULL,
	`sub_industry` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`brand_positioning` text DEFAULT '' NOT NULL,
	`target_audience_json` text DEFAULT '[]' NOT NULL,
	`core_products_json` text DEFAULT '[]' NOT NULL,
	`core_selling_points_json` text DEFAULT '[]' NOT NULL,
	`brand_tone_json` text DEFAULT '[]' NOT NULL,
	`forbidden_topics_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`client_id`) REFERENCES `clients`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "brands_status_valid" CHECK("brands"."status" IN ('active', 'inactive')),
	CONSTRAINT "brands_json_arrays" CHECK(json_type("brands"."target_audience_json") = 'array' AND json_type("brands"."core_products_json") = 'array' AND json_type("brands"."core_selling_points_json") = 'array' AND json_type("brands"."brand_tone_json") = 'array' AND json_type("brands"."forbidden_topics_json") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_brands_org_id` ON `brands` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_brands_org_client_id` ON `brands` (`organization_id`,`client_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_brands_org_client` ON `brands` (`organization_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`client_name` text NOT NULL,
	`industry` text NOT NULL,
	`sub_industry` text DEFAULT '' NOT NULL,
	`cooperation_status` text DEFAULT 'lead' NOT NULL,
	`contract_start` text,
	`contract_end` text,
	`monthly_content_target` integer DEFAULT 0 NOT NULL,
	`owner_user_id` text,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`owner_user_id`) REFERENCES `users`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clients_target_nonnegative" CHECK("clients"."monthly_content_target" >= 0 AND typeof("clients"."monthly_content_target") = 'integer'),
	CONSTRAINT "clients_status_valid" CHECK("clients"."status" IN ('active', 'inactive')),
	CONSTRAINT "clients_cooperation_valid" CHECK("clients"."cooperation_status" IN ('lead', 'active', 'paused', 'ended')),
	CONSTRAINT "clients_contract_order" CHECK("clients"."contract_start" IS NULL OR "clients"."contract_end" IS NULL OR "clients"."contract_start" <= "clients"."contract_end")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_clients_org_id` ON `clients` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_clients_org_created` ON `clients` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_clients_org_filters` ON `clients` (`organization_id`,`cooperation_status`,`industry`);--> statement-breakpoint
CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`brand_id` text NOT NULL,
	`store_name` text NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`district` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`store_type` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`brand_id`) REFERENCES `brands`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stores_status_valid" CHECK("stores"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stores_org_id` ON `stores` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stores_org_brand_id` ON `stores` (`organization_id`,`brand_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_stores_org_brand` ON `stores` (`organization_id`,`brand_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_organization_id_id` ON `users` (`organization_id`,`id`);