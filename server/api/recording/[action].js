import { initDatabase, streamOperations } from '../../utils/database.js';
import { startRtspRecording, stopRtspRecording } from '../socket.js';

export default defineEventHandler(async (event) => {
  // Initialize database
  initDatabase();
  
  const method = getMethod(event);
  const action = getRouterParam(event, 'action');
  const { streamId } = await readBody(event);
  
  if (method !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method Not Allowed - Only POST is supported'
    });
  }
  
  if (!streamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'streamId is required'
    });
  }
  
  try {
    switch (action) {
      case 'start':
        return await handleStartRecording(streamId);
      case 'stop':
        return await handleStopRecording(streamId);
      default:
        throw createError({
          statusCode: 400,
          statusMessage: 'Invalid action. Use "start" or "stop"'
        });
    }
  } catch (error) {
    console.error('[Recording API] Error:', error);
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || 'Internal Server Error',
      data: error.message
    });
  }
});

async function handleStartRecording(streamId) {
  // Check if stream exists
  const stream = await streamOperations.getStream(streamId);
  if (!stream) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Stream not found'
    });
  }
  
  if (stream.sourceType === 'rtsp') {
    await startRtspRecording(streamId);
    return {
      success: true,
      message: `Started RTSP recording for stream ${streamId}`,
      streamId,
      sourceType: 'rtsp'
    };
  } else {
    throw createError({
      statusCode: 400,
      statusMessage: 'Manual recording control is only available for RTSP streams. RTMP streams auto-record when published.'
    });
  }
}

async function handleStopRecording(streamId) {
  // Check if stream exists
  const stream = await streamOperations.getStream(streamId);
  if (!stream) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Stream not found'
    });
  }
  
  if (stream.sourceType === 'rtsp') {
    await stopRtspRecording(streamId);
    return {
      success: true,
      message: `Stopped RTSP recording for stream ${streamId}`,
      streamId,
      sourceType: 'rtsp'
    };
  } else {
    throw createError({
      statusCode: 400,
      statusMessage: 'Manual recording control is only available for RTSP streams. RTMP streams auto-stop when publishing ends.'
    });
  }
} 