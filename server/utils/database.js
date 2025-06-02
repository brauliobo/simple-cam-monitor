import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { eq, desc, count, sum, and, sql } from 'drizzle-orm';
import { streams, recordings } from '../db/schema.js';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '../..');

// Database path
const DB_PATH = join(projectRoot, 'sqlite.db');
const RECORDINGS_PATH = join(projectRoot, 'recordings');

let db = null;
let sqliteDb = null;

// Initialize database
export function initDatabase() {
  if (db) return db;

  console.log(`[Database] Initializing SQLite database at: ${DB_PATH}`);
  
  // Create recordings directory if it doesn't exist
  if (!existsSync(RECORDINGS_PATH)) {
    mkdirSync(RECORDINGS_PATH, { recursive: true });
    console.log(`[Database] Created recordings directory: ${RECORDINGS_PATH}`);
  }

  // Initialize better-sqlite3
  sqliteDb = new Database(DB_PATH);
  sqliteDb.pragma('foreign_keys = ON');
  sqliteDb.pragma('journal_mode = WAL');

  // Initialize Drizzle
  db = drizzle(sqliteDb, { schema: { streams, recordings } });

  // Auto-migrate (create tables if they don't exist)
  try {
    const migrationsPath = join(__dirname, '../db/migrations');
    if (existsSync(migrationsPath)) {
      migrate(db, { migrationsFolder: migrationsPath });
      console.log('[Database] Migrations applied successfully');
    } else {
      // If no migrations exist, create tables manually using schema
      console.log('[Database] No migrations found, creating tables from schema...');
      createTablesFromSchema();
    }
  } catch (error) {
    console.log('[Database] Migration failed, creating tables manually:', error.message);
    createTablesFromSchema();
  }

  console.log('[Database] Database initialized successfully');
  return db;
}

// Create tables manually from schema (fallback)
function createTablesFromSchema() {
  // This is a fallback - normally Drizzle Kit would handle migrations
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS streams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id TEXT UNIQUE NOT NULL,
      stream_name TEXT NOT NULL,
      source_type TEXT DEFAULT 'rtmp' NOT NULL,
      source_url TEXT NOT NULL,
      stream_path TEXT,
      source_ip TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT,
      is_active INTEGER DEFAULT 1,
      record_enabled INTEGER DEFAULT 1,
      record_slice TEXT DEFAULT 'hourly',
      username TEXT,
      password TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      duration INTEGER,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      slice_type TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_streams_stream_id ON streams(stream_id);
    CREATE INDEX IF NOT EXISTS idx_streams_is_active ON streams(is_active);
    CREATE INDEX IF NOT EXISTS idx_recordings_stream_id ON recordings(stream_id);
    CREATE INDEX IF NOT EXISTS idx_recordings_started_at ON recordings(started_at);
  `);
  console.log('[Database] Tables created from schema');
}

// Stream operations using Drizzle ORM
export const streamOperations = {
  // Add a new RTMP stream (backward compatibility)
  async addStream(streamId, streamPath, sourceIp, recordEnabled = true, recordSlice = 'hourly') {
    const streamName = streamId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const sourceUrl = `rtmp://localhost:1934${streamPath}`;
    
    return await this.addMultiSourceStream({
      streamId,
      streamName,
      sourceType: 'rtmp',
      sourceUrl,
      streamPath,
      sourceIp,
      recordEnabled,
      recordSlice
    });
  },

  // Add a new multi-source stream (RTMP or RTSP)
  async addMultiSourceStream({
    streamId,
    streamName,
    sourceType = 'rtmp',
    sourceUrl,
    streamPath = null,
    sourceIp = null,
    recordEnabled = true,
    recordSlice = 'hourly',
    username = null,
    password = null,
    description = null
  }) {
    return await db.insert(streams).values({
      streamId,
      streamName,
      sourceType,
      sourceUrl,
      streamPath,
      sourceIp,
      recordEnabled,
      recordSlice,
      isActive: true,
      createdAt: new Date().toISOString(),
      endedAt: null,
      username,
      password,
      description
    }).onConflictDoUpdate({
      target: streams.streamId,
      set: {
        streamName,
        sourceType,
        sourceUrl,
        streamPath,
        sourceIp,
        recordEnabled,
        recordSlice,
        isActive: true,
        createdAt: new Date().toISOString(),
        endedAt: null,
        username,
        password,
        description
      }
    });
  },

  // Add RTSP stream specifically
  async addRtspStream({
    streamId,
    streamName,
    rtspUrl,
    username = null,
    password = null,
    description = null,
    recordEnabled = true,
    recordSlice = 'hourly'
  }) {
    return await this.addMultiSourceStream({
      streamId,
      streamName,
      sourceType: 'rtsp',
      sourceUrl: rtspUrl,
      streamPath: null,
      sourceIp: null,
      recordEnabled,
      recordSlice,
      username,
      password,
      description
    });
  },

  // End a stream
  async endStream(streamId) {
    return await db.update(streams)
      .set({ 
        isActive: false, 
        endedAt: new Date().toISOString() 
      })
      .where(and(
        eq(streams.streamId, streamId),
        eq(streams.isActive, true)
      ));
  },

  // Get stream info
  async getStream(streamId) {
    const result = await db.select().from(streams).where(eq(streams.streamId, streamId)).limit(1);
    return result[0] || null;
  },

  // Get all active streams
  async getActiveStreams() {
    return await db.select().from(streams).where(eq(streams.isActive, true));
  },

  // Get all streams (with optional limit)
  async getAllStreams(limit = 100) {
    return await db.select().from(streams).orderBy(desc(streams.createdAt)).limit(limit);
  },

  // Get streams by type
  async getStreamsByType(sourceType, limit = 100) {
    return await db.select().from(streams)
      .where(eq(streams.sourceType, sourceType))
      .orderBy(desc(streams.createdAt))
      .limit(limit);
  },

  // Get streams with their recording counts
  async getStreamsWithRecordingCounts(limit = 100) {
    return await db.select({
      ...streams,
      recordingCount: count(recordings.id),
    }).from(streams)
      .leftJoin(recordings, eq(streams.streamId, recordings.streamId))
      .groupBy(streams.id)
      .orderBy(desc(streams.createdAt))
      .limit(limit);
  },

  // Update stream settings
  async updateStream(streamId, updates) {
    return await db.update(streams)
      .set(updates)
      .where(eq(streams.streamId, streamId));
  },

  // Delete stream
  async deleteStream(streamId) {
    // First delete all recordings for this stream
    await db.delete(recordings).where(eq(recordings.streamId, streamId));
    // Then delete the stream
    return await db.delete(streams).where(eq(streams.streamId, streamId));
  }
};

// Recording operations using Drizzle ORM
export const recordingOperations = {
  // Add a new recording
  async addRecording(streamId, filePath, sliceType, startedAt = new Date().toISOString()) {
    const result = await db.insert(recordings).values({
      streamId,
      filePath,
      sliceType,
      startedAt,
    }).returning();
    return result[0];
  },

  // Finish a recording (update end time and file size)
  async finishRecording(recordingId, endedAt = new Date().toISOString(), fileSize = null, duration = null) {
    return await db.update(recordings)
      .set({ endedAt, fileSize, duration })
      .where(eq(recordings.id, recordingId));
  },

  // Get recordings for a stream
  async getRecordingsByStream(streamId, limit = 50) {
    return await db.select().from(recordings)
      .where(eq(recordings.streamId, streamId))
      .orderBy(desc(recordings.startedAt))
      .limit(limit);
  },

  // Get all recordings with stream info
  async getAllRecordings(limit = 100) {
    return await db.select({
      id: recordings.id,
      streamId: recordings.streamId,
      filePath: recordings.filePath,
      fileSize: recordings.fileSize,
      duration: recordings.duration,
      startedAt: recordings.startedAt,
      endedAt: recordings.endedAt,
      sliceType: recordings.sliceType,
      streamName: streams.streamName,
      sourceType: streams.sourceType,
      sourceUrl: streams.sourceUrl,
      sourceIp: streams.sourceIp,
    }).from(recordings)
      .leftJoin(streams, eq(recordings.streamId, streams.streamId))
      .orderBy(desc(recordings.startedAt))
      .limit(limit);
  },

  // Delete old recordings (cleanup)
  async deleteOldRecordings(daysOld = 30) {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
    return await db.delete(recordings).where(sql`${recordings.startedAt} < ${cutoffDate}`);
  },

  // Get recordings by date range
  async getRecordingsByDateRange(startDate, endDate, limit = 100) {
    return await db.select().from(recordings)
      .where(and(
        sql`${recordings.startedAt} >= ${startDate}`,
        sql`${recordings.startedAt} <= ${endDate}`
      ))
      .orderBy(desc(recordings.startedAt))
      .limit(limit);
  }
};

// Export dbUtils for advanced database operations
export const dbUtils = {
  getDb: () => db,
  getSchema: () => ({ streams, recordings }),
  // Get database stats
  async getStats() {
    const totalStreamsResult = await db.select({ count: count() }).from(streams);
    const activeStreamsResult = await db.select({ count: count() }).from(streams).where(eq(streams.isActive, true));
    const rtmpStreamsResult = await db.select({ count: count() }).from(streams).where(eq(streams.sourceType, 'rtmp'));
    const rtspStreamsResult = await db.select({ count: count() }).from(streams).where(eq(streams.sourceType, 'rtsp'));
    const totalRecordingsResult = await db.select({ count: count() }).from(recordings);
    const totalSizeResult = await db.select({ 
      size: sum(recordings.fileSize) 
    }).from(recordings).where(sql`${recordings.fileSize} IS NOT NULL`);
    
    return {
      totalStreams: totalStreamsResult[0]?.count || 0,
      activeStreams: activeStreamsResult[0]?.count || 0,
      rtmpStreams: rtmpStreamsResult[0]?.count || 0,
      rtspStreams: rtspStreamsResult[0]?.count || 0,
      totalRecordings: totalRecordingsResult[0]?.count || 0,
      totalRecordingSize: totalSizeResult[0]?.size || 0
    };
  },

  // Close database connection
  close() {
    if (sqliteDb) {
      sqliteDb.close();
      sqliteDb = null;
      db = null;
      console.log('[Database] Database connection closed');
    }
  },

  // Get raw SQLite instance
  getSqliteDb() {
    return sqliteDb;
  }
};

// Helper function to create recording directory structure
export function createRecordingDirectory(streamId) {
  // Replace slashes with underscores for filesystem safety, then create directory
  const safeDirName = streamId.replace(/\//g, '_');
  const recordingDir = join(RECORDINGS_PATH, safeDirName);
  
  if (!existsSync(recordingDir)) {
    mkdirSync(recordingDir, { recursive: true });
  }
  
  return recordingDir;
}

// Helper function to generate recording filename (resumable - no collision avoidance)
export function generateResumableRecordingFilename(streamId, sliceType = 'hourly') {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  
  let datePrefix;
  if (sliceType === 'daily') {
    datePrefix = `${year}-${month}-${day}`;
  } else { // hourly
    datePrefix = `${year}-${month}-${day}_${hour}`;
  }
  
  const safeDirName = streamId.replace(/\//g, '_');
  const recordingDir = join(RECORDINGS_PATH, safeDirName);
  
  // Use fixed filename for resumable recordings
  const filename = `${datePrefix}_${safeDirName}.flv`;
  const fullPath = join(recordingDir, filename);
  
  return {
    filename,
    relativePath: `${safeDirName}/${filename}`,
    fullPath,
    isSequential: false,
    sequenceNumber: 0
  };
}

// Helper function to generate recording filename (with collision avoidance)
export function generateRecordingFilename(streamId, sliceType = 'hourly') {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  
  let datePrefix;
  if (sliceType === 'daily') {
    datePrefix = `${year}-${month}-${day}`;
  } else { // hourly
    datePrefix = `${year}-${month}-${day}_${hour}`;
  }
  
  const safeDirName = streamId.replace(/\//g, '_');
  const recordingDir = join(RECORDINGS_PATH, safeDirName);
  
  // Find the next available sequence number to avoid overwriting
  let sequence = '';
  let sequenceNum = 0;
  let filename;
  let fullPath;
  
  do {
    if (sequenceNum === 0) {
      filename = `${datePrefix}_${safeDirName}.flv`;
    } else {
      const seqStr = String(sequenceNum).padStart(3, '0');
      filename = `${datePrefix}_${safeDirName}_${seqStr}.flv`;
    }
    
    fullPath = join(recordingDir, filename);
    sequenceNum++;
    
    // Safety limit to prevent infinite loop
    if (sequenceNum > 999) {
      console.error(`[Recording] Too many sequence files for ${streamId} at ${datePrefix}`);
      break;
    }
  } while (existsSync(fullPath));
  
  return {
    filename,
    relativePath: `${safeDirName}/${filename}`,
    fullPath,
    isSequential: sequenceNum > 1,
    sequenceNumber: sequenceNum - 1
  };
}

// Helper function to find active recording for a stream in current time slice
export async function findActiveRecordingForTimeSlice(streamId, sliceType = 'hourly') {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  
  let timeSliceStart, timeSliceEnd;
  
  if (sliceType === 'daily') {
    timeSliceStart = `${year}-${month}-${day}T00:00:00.000Z`;
    timeSliceEnd = `${year}-${month}-${day}T23:59:59.999Z`;
  } else { // hourly
    timeSliceStart = `${year}-${month}-${day}T${hour}:00:00.000Z`;
    timeSliceEnd = `${year}-${month}-${day}T${hour}:59:59.999Z`;
  }
  
  try {
    // Look for recordings in the current time slice that don't have an end time
    const activeRecording = await db.select().from(recordings)
      .where(and(
        eq(recordings.streamId, streamId),
        eq(recordings.sliceType, sliceType),
        sql`${recordings.startedAt} >= ${timeSliceStart}`,
        sql`${recordings.startedAt} <= ${timeSliceEnd}`,
        sql`${recordings.endedAt} IS NULL`
      ))
      .limit(1);
    
    return activeRecording[0] || null;
  } catch (error) {
    console.error(`[Recording] Error finding active recording for ${streamId}:`, error);
    return null;
  }
}

// Export paths for external use
export const paths = {
  database: DB_PATH,
  recordings: RECORDINGS_PATH
}; 