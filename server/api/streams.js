import { initDatabase, streamOperations, recordingOperations } from '../utils/database.js';

export default defineEventHandler(async (event) => {
  // Initialize database
  initDatabase();
  
  const method = getMethod(event);
  const query = getQuery(event);
  
  try {
    switch (method) {
      case 'GET':
        return await handleGet(query);
      case 'POST':
        return await handlePost(event);
      case 'PUT':
        return await handlePut(event);
      case 'DELETE':
        return await handleDelete(event);
      default:
        throw createError({
          statusCode: 405,
          statusMessage: 'Method Not Allowed'
        });
    }
  } catch (error) {
    console.error('[Streams API] Error:', error);
    throw createError({
      statusCode: error.statusCode || 500,
      statusMessage: error.statusMessage || 'Internal Server Error',
      data: error.message
    });
  }
});

// Handle GET requests
async function handleGet(query) {
  const { type, streamId, includeRecordings } = query;
  
  if (streamId) {
    // Get specific stream
    const stream = await streamOperations.getStream(streamId);
    if (!stream) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Stream not found'
      });
    }
    
    if (includeRecordings) {
      const recordings = await recordingOperations.getRecordingsByStream(streamId, 20);
      return { stream, recordings };
    }
    
    return { stream };
  }
  
  // Get streams by type or all streams
  let streams;
  if (type && ['rtmp', 'rtsp'].includes(type)) {
    streams = await streamOperations.getStreamsByType(type);
  } else {
    streams = await streamOperations.getAllStreams();
  }
  
  return {
    streams,
    total: streams.length
  };
}

// Handle POST requests (create new stream)
async function handlePost(event) {
  const body = await readBody(event);
  const { sourceType } = body;
  
  if (sourceType === 'rtsp') {
    return await createRtspStream(body);
  } else if (sourceType === 'rtmp') {
    return await createRtmpStream(body);
  } else {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid source type. Must be "rtmp" or "rtsp"'
    });
  }
}

// Handle PUT requests (update stream)
async function handlePut(event) {
  const body = await readBody(event);
  const { streamId, ...updates } = body;
  
  if (!streamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'streamId is required'
    });
  }
  
  const result = await streamOperations.updateStream(streamId, updates);
  
  return {
    success: true,
    message: `Stream ${streamId} updated successfully`,
    result
  };
}

// Handle DELETE requests
async function handleDelete(event) {
  const query = getQuery(event);
  const { streamId } = query;
  
  if (!streamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'streamId is required'
    });
  }
  
  const result = await streamOperations.deleteStream(streamId);
  
  return {
    success: true,
    message: `Stream ${streamId} deleted successfully`,
    result
  };
}

// Create RTSP stream
async function createRtspStream(data) {
  const { streamId, streamName, rtspUrl, username, password, description, recordEnabled = true, recordSlice = 'hourly' } = data;
  
  if (!streamId || !streamName || !rtspUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'streamId, streamName, and rtspUrl are required'
    });
  }
  
  // Validate RTSP URL format
  if (!rtspUrl.startsWith('rtsp://')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid RTSP URL format'
    });
  }
  
  const result = await streamOperations.addRtspStream({
    streamId,
    streamName,
    rtspUrl,
    username,
    password,
    description,
    recordEnabled,
    recordSlice
  });
  
  return {
    success: true,
    message: `RTSP stream ${streamId} created successfully`,
    stream: await streamOperations.getStream(streamId)
  };
}

// Create RTMP stream (for manual addition)
async function createRtmpStream(data) {
  const { streamId, streamName, rtmpUrl, description, recordEnabled = true, recordSlice = 'hourly' } = data;
  
  if (!streamId || !streamName || !rtmpUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'streamId, streamName, and rtmpUrl are required'
    });
  }
  
  // Validate RTMP URL format
  if (!rtmpUrl.startsWith('rtmp://')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid RTMP URL format'
    });
  }
  
  const result = await streamOperations.addMultiSourceStream({
    streamId,
    streamName,
    sourceType: 'rtmp',
    sourceUrl: rtmpUrl,
    streamPath: null,
    sourceIp: null,
    recordEnabled,
    recordSlice,
    description
  });
  
  return {
    success: true,
    message: `RTMP stream ${streamId} created successfully`,
    stream: await streamOperations.getStream(streamId)
  };
} 