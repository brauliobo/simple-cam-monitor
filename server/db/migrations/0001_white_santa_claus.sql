PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_streams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stream_id` text NOT NULL,
	`stream_name` text NOT NULL,
	`source_type` text DEFAULT 'rtmp' NOT NULL,
	`source_url` text NOT NULL,
	`stream_path` text,
	`source_ip` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`ended_at` text,
	`is_active` integer DEFAULT true,
	`record_enabled` integer DEFAULT true,
	`record_slice` text DEFAULT 'hourly',
	`username` text,
	`password` text,
	`description` text
);
--> statement-breakpoint
INSERT INTO `__new_streams`("id", "stream_id", "stream_name", "source_type", "source_url", "stream_path", "source_ip", "created_at", "ended_at", "is_active", "record_enabled", "record_slice", "username", "password", "description") SELECT "id", "stream_id", "stream_name", "source_type", "source_url", "stream_path", "source_ip", "created_at", "ended_at", "is_active", "record_enabled", "record_slice", "username", "password", "description" FROM `streams`;--> statement-breakpoint
DROP TABLE `streams`;--> statement-breakpoint
ALTER TABLE `__new_streams` RENAME TO `streams`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `streams_stream_id_unique` ON `streams` (`stream_id`);