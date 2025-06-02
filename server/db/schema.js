import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Streams table - now supports both RTMP and RTSP
export const streams = sqliteTable('streams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  streamId: text('stream_id').unique().notNull(),
  streamName: text('stream_name').notNull(), // Display name for the stream
  sourceType: text('source_type', { enum: ['rtmp', 'rtsp'] }).notNull().default('rtmp'),
  sourceUrl: text('source_url').notNull(), // Full URL (rtmp://... or rtsp://...)
  streamPath: text('stream_path'), // For RTMP compatibility (can be null for RTSP)
  sourceIp: text('source_ip'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  endedAt: text('ended_at'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  recordEnabled: integer('record_enabled', { mode: 'boolean' }).default(true),
  recordSlice: text('record_slice', { enum: ['hourly', 'daily'] }).default('hourly'),
  // Additional RTSP-specific fields
  username: text('username'), // For RTSP authentication
  password: text('password'), // For RTSP authentication
  description: text('description'), // Optional description
});

// Recordings table
export const recordings = sqliteTable('recordings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  streamId: text('stream_id').notNull(),
  filePath: text('file_path').notNull(),
  fileSize: integer('file_size'),
  duration: integer('duration'),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  sliceType: text('slice_type', { enum: ['hourly', 'daily'] }).notNull(),
});

// Relations (for joins)
import { relations } from 'drizzle-orm';

export const streamsRelations = relations(streams, ({ many }) => ({
  recordings: many(recordings),
}));

export const recordingsRelations = relations(recordings, ({ one }) => ({
  stream: one(streams, {
    fields: [recordings.streamId],
    references: [streams.streamId],
  }),
})); 