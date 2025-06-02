CREATE TABLE `recordings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stream_id` text NOT NULL,
	`file_path` text NOT NULL,
	`file_size` integer,
	`duration` integer,
	`started_at` text NOT NULL,
	`ended_at` text,
	`slice_type` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `streams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stream_id` text NOT NULL,
	`stream_path` text NOT NULL,
	`source_ip` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`ended_at` text,
	`is_active` integer DEFAULT true,
	`record_enabled` integer DEFAULT true,
	`record_slice` text DEFAULT 'hourly'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `streams_stream_id_unique` ON `streams` (`stream_id`);