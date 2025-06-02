import { initDatabase, recordingOperations, dbUtils } from '../../utils/database.js';
import { existsSync, statSync } from 'fs';
import { join } from 'path';

export default defineEventHandler(async (event) => {
  // Initialize database
  initDatabase();
  
  const method = getMethod(event);
  const query = getQuery(event);
  
  if (method !== 'GET') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method Not Allowed - Only GET is supported'
    });
  }
  
  try {
    return await handleRecovery(query);
  } catch (error) {
    console.error('[Recovery API] Error:', error);
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || 'Internal Server Error',
      data: error.message
    });
  }
});

async function handleRecovery(query) {
  const { fix = false } = query;
  
  try {
    const db = dbUtils.getDb();
    
    // Find all recordings without an end time (orphaned recordings)
    const orphanedRecordings = await db.select().from(dbUtils.getSchema().recordings)
      .where(sql`ended_at IS NULL`)
      .orderBy(desc(dbUtils.getSchema().recordings.startedAt));
    
    const recoveryResults = [];
    let totalRecovered = 0;
    let totalSize = 0;
    
    for (const recording of orphanedRecordings) {
      const projectRoot = join(process.cwd());
      const fullPath = join(projectRoot, 'recordings', recording.filePath);
      
      const result = {
        id: recording.id,
        streamId: recording.streamId,
        filePath: recording.filePath,
        startedAt: recording.startedAt,
        status: 'unknown',
        fileExists: false,
        fileSize: 0,
        duration: 0,
        action: 'none'
      };
      
      // Check if file exists
      if (existsSync(fullPath)) {
        result.fileExists = true;
        try {
          const stats = statSync(fullPath);
          result.fileSize = stats.size;
          result.status = 'file_exists';
          
          // Calculate duration based on start time and file modification time
          const startTime = new Date(recording.startedAt);
          const modTime = new Date(stats.mtime);
          result.duration = Math.floor((modTime - startTime) / 1000);
          
          if (fix) {
            // Update the recording with file information
            await recordingOperations.finishRecording(
              recording.id,
              modTime.toISOString(),
              stats.size,
              result.duration
            );
            
            result.action = 'recovered';
            totalRecovered++;
            totalSize += stats.size;
          }
          
        } catch (error) {
          result.status = 'file_error';
          result.error = error.message;
        }
      } else {
        result.status = 'file_missing';
        
        if (fix) {
          // Remove orphaned database record for missing file
          await db.delete(dbUtils.getSchema().recordings)
            .where(eq(dbUtils.getSchema().recordings.id, recording.id));
          
          result.action = 'cleaned_up';
          totalRecovered++;
        }
      }
      
      recoveryResults.push(result);
    }
    
    return {
      success: true,
      action: fix ? 'recovery_performed' : 'analysis_only',
      summary: {
        totalOrphanedRecordings: orphanedRecordings.length,
        recordingsWithFiles: recoveryResults.filter(r => r.fileExists).length,
        recordingsWithMissingFiles: recoveryResults.filter(r => !r.fileExists).length,
        totalRecovered: fix ? totalRecovered : 0,
        totalSizeRecovered: fix ? totalSize : 0
      },
      recordings: recoveryResults,
      message: fix 
        ? `Recovery completed: ${totalRecovered} recordings processed`
        : `Analysis completed: ${orphanedRecordings.length} orphaned recordings found. Use ?fix=true to recover them.`
    };
    
  } catch (error) {
    throw new Error(`Recovery operation failed: ${error.message}`);
  }
}

// Helper to import sql and eq functions
import { sql, eq, desc } from 'drizzle-orm'; 