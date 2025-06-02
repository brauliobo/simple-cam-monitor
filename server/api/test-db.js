import { initDatabase, streamOperations, recordingOperations, dbUtils } from '../utils/database.js';

export default defineEventHandler(async (event) => {
  try {
    // Initialize database
    initDatabase();
    
    // Get database stats
    const stats = await dbUtils.getStats();
    
    // Try to get active streams
    const activeStreams = await streamOperations.getActiveStreams();
    
    // Try to get all streams
    const allStreams = await streamOperations.getAllStreams(5);
    
    return {
      success: true,
      message: 'Drizzle ORM database connection successful',
      stats,
      activeStreams,
      allStreams,
      database: 'sqlite.db',
      orm: 'Drizzle ORM'
    };
  } catch (error) {
    console.error('[Database Test] Error:', error);
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}); 