import NodeMediaServer from 'node-media-server';
import { initDatabase, streamOperations, recordingOperations, createRecordingDirectory, generateRecordingFilename, findActiveRecordingForTimeSlice } from '../utils/database.js';
import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import { createServer } from 'net';

// Remove io variable since we're using WebSocket broadcasting
let nms = null;
let initialized = false;
let activeRecordings = new Map(); // Track active recording processes

async function initializeServices() {
  if (initialized) return { nms };

  const config = useRuntimeConfig();
  const rtmpPort = parseInt(config.public.rtmpPort, 10);
  const rtmpAppName = config.public.rtmpAppName;

  console.log(`🚀 [RTMP Server] Initializing RTMP-only server and Database`);
  console.log(`   RTMP App: '${rtmpAppName}', Port: ${rtmpPort}`);

  initDatabase();

  // Initialize RTMP-only server (no HTTP serving)
  const nmsConfig = {
    rtmp: {
      port: rtmpPort,
      chunk_size: 60000,
      gop_cache: true,
      ping: 30,
      ping_timeout: 60,
    },
    // Remove HTTP configuration - we'll serve via Nuxt
  };

  try {
    nms = new NodeMediaServer(nmsConfig);
    
    // Add error handlers before starting
    nms.on('error', (error) => {
      console.error(`[RTMP Server] Critical error:`, error);
      process.exit(1);
    });

    // Check if port is available before starting
    await new Promise((resolve, reject) => {
      const testServer = createServer();
      
      testServer.listen(rtmpPort, (err) => {
        if (err) {
          reject(new Error(`RTMP port ${rtmpPort} is already in use or cannot be bound`));
        } else {
          testServer.close(() => {
            console.log(`[RTMP Server] Port ${rtmpPort} is available`);
            resolve();
          });
        }
      });
      
      testServer.on('error', (err) => {
        reject(new Error(`RTMP port ${rtmpPort} test failed: ${err.message}`));
      });
    });

    // Start the RTMP server
    nms.run();
    
    // Wait a moment to ensure server started successfully
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`[RTMP Server] Successfully started on port ${rtmpPort}`);

    // Make NMS globally available for plugin integration
    globalThis.nms = nms;

    // Integrate RTMP recorder if available in global scope
    if (typeof globalThis.integrateWithNodeMediaServer === 'function') {
      console.log('[RTMP Server] Integrating RTMP recorder...');
      globalThis.integrateWithNodeMediaServer(nms);
    } else {
      console.log('[RTMP Server] RTMP recorder integration not yet available, will be connected via plugin');
    }

  } catch (error) {
    console.error(`[RTMP Server] Failed to start RTMP server:`, error.message);
    console.error(`[RTMP Server] Please check if port ${rtmpPort} is available or change NUXT_PUBLIC_RTMP_PORT`);
    
    // Throw error to prevent further initialization
    throw new Error(`RTMP Server startup failed: ${error.message}`);
  }

  console.log(`✅ [RTMP Server] RTMP-only server started`);
  console.log(`   RTMP Ingest: rtmp://<host>:${rtmpPort}/${rtmpAppName}/<stream_key>`);
  console.log(`   HTTP-FLV Output: http://<host>:3000/api/stream/<stream_key>`);
  console.log(`   FLV Recording: ENABLED`);

  nms.on('preConnect', (id, args) => {
    console.log(`[RTMP] Client connecting: id=${id}`);
  });

  nms.on('postConnect', (id, args) => {
    console.log(`[RTMP] Client connected: id=${id}`);
  });

  nms.on('prePublish', (id, streamPath, args) => {
    console.log(`[RTMP] Stream publish starting: ${streamPath}`);
  });

  nms.on('postPublish', async (id, streamPath, args) => {
    
    let actualStreamPath = streamPath;
    if (!actualStreamPath && id && typeof id === 'object') {
      actualStreamPath = id.publishStreamPath || id.streamPath || id.path;
    }
    
    if (!actualStreamPath || typeof actualStreamPath !== 'string') {
      console.error(`[RTMP] Could not determine valid StreamPath. id:`, id, `streamPath:`, streamPath);
      return;
    }

    const streamKey = actualStreamPath.split('/').pop();
    const app = actualStreamPath.substring(1, actualStreamPath.lastIndexOf('/'));

    if (app === rtmpAppName) {
      const streamId = streamKey;
      
      let sourceIp = 'unknown';
      if (id && typeof id === 'object') {
        sourceIp = id.ip || id.clientIp || id.remoteAddress || 'unknown';
      }
      
      try {
        await streamOperations.addStream(streamId, actualStreamPath, sourceIp);
      } catch (error) {
        console.error(`[Database] Error adding RTMP stream:`, error);
      }

      try {
        createRecordingDirectory(streamId);
      } catch (error) {
        console.error(`[Recording] Error creating directory for stream ${streamId}:`, error);
      }

      try {
        const stream = await streamOperations.getStream(streamId);
        if (stream && stream.recordEnabled) {
          await startRecording(stream);
        }
      } catch (error) {
        console.error(`[Recording] Error starting recording for stream ${streamId}:`, error);
      }

      console.log(`[RTMP] Stream published: ${streamId}`);
      
      if (typeof globalThis.broadcastToWebSocketClients === 'function') {
        globalThis.broadcastToWebSocketClients({
          type: 'new-stream',
          streamId: streamId,
          streamName: streamKey,
          streamPath: actualStreamPath,
          connectionPath: actualStreamPath,
          sourceIp: sourceIp,
          sourceType: 'rtmp'
        });
      }
    }
  });

  nms.on('donePublish', async (id, streamPath, args) => {
    
    let actualStreamPath = streamPath;
    if (!actualStreamPath && id && typeof id === 'object') {
      actualStreamPath = id.publishStreamPath || id.streamPath || id.path;
    }
    
    if (!actualStreamPath || typeof actualStreamPath !== 'string') {
      console.error(`[RTMP] Could not determine valid StreamPath in donePublish. id:`, id, `streamPath:`, streamPath);
      return;
    }

    const streamKey = actualStreamPath.split('/').pop();
    const app = actualStreamPath.substring(1, actualStreamPath.lastIndexOf('/'));
    
    if (app === rtmpAppName) {
      const streamId = streamKey;
      
      await stopRecording(streamId);
      
      try {
        await streamOperations.endStream(streamId);
      } catch (error) {
        console.error(`[Database] Error ending RTMP stream:`, error);
      }

      console.log(`[RTMP] Stream ended: ${streamId}`);
      
      if (typeof globalThis.broadcastToWebSocketClients === 'function') {
        globalThis.broadcastToWebSocketClients({
          type: 'stream-ended',
          streamId: streamId
        });
      }
    }
  });

  nms.on('connectError', (id, err) => {
    console.error(`[RTMP] Connect error: ${err}`);
  });

  nms.on('doneConnect', (id, args) => {
    console.log(`[RTMP] Client disconnected: id=${id}`);
  });

  initialized = true;
  return { nms };
}

// Start recording function for both RTMP and RTSP (with data preservation)
async function startRecording(stream) {
  try {
    const existingRecording = await findActiveRecordingForTimeSlice(stream.streamId, stream.recordSlice);
    
    if (existingRecording) {
      console.log(`[Recording] Found existing incomplete recording for ${stream.streamId}: ${existingRecording.filePath}`);
      console.log(`[Recording] Server restart detected - creating new sequential file to preserve data`);
    }
    
    const recordingInfo = generateRecordingFilename(stream.streamId, stream.recordSlice);
    
    if (recordingInfo.isSequential) {
      console.log(`[Recording] Creating sequential file ${recordingInfo.filename} for ${stream.streamId} (avoiding data loss)`);
    } else {
      console.log(`[Recording] Starting new recording for ${stream.streamId} -> ${recordingInfo.filename}`);
    }
    
    const recording = await recordingOperations.addRecording(
      stream.streamId, 
      recordingInfo.relativePath, 
      stream.recordSlice,
      new Date().toISOString()
    );
    
    let inputArgs = [];
    
    if (stream.sourceType === 'rtsp') {
      inputArgs.push(
        '-rtsp_transport', 'tcp',
        '-allowed_media_types', 'video+audio',
        '-fflags', '+genpts'
      );
      
      if (stream.username && stream.password) {
        inputArgs.push('-credentials', `${stream.username}:${stream.password}`);
      }
    }
    
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', 'error',
      '-nostats',
      ...inputArgs,
      '-i', stream.sourceUrl,
      '-c', 'copy',
      '-f', 'flv',
      recordingInfo.fullPath
    ];
    
    console.log(`[Recording] Starting FFmpeg with args: ${ffmpegArgs.join(' ')}`);
    
    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.log(`[Recording] FFmpeg ${stream.streamId}: ${output}`);
    });
    
    ffmpegProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Recording] FFmpeg stdout ${stream.streamId}: ${output}`);
    });
    
    activeRecordings.set(stream.streamId, {
      process: ffmpegProcess,
      recordingId: recording.id,
      startTime: new Date(),
      filePath: recordingInfo.fullPath,
      streamId: stream.streamId,
      sourceType: stream.sourceType,
      isSequential: recordingInfo.isSequential,
      sequenceNumber: recordingInfo.sequenceNumber
    });
    
    ffmpegProcess.on('close', async (code) => {
      const recordingInfo = activeRecordings.get(stream.streamId);
      if (recordingInfo && existsSync(recordingInfo.filePath)) {
        try {
          const stats = statSync(recordingInfo.filePath);
          const duration = Math.floor((new Date() - recordingInfo.startTime) / 1000);
          
          await recordingOperations.finishRecording(
            recordingInfo.recordingId, 
            new Date().toISOString(), 
            stats.size, 
            duration
          );
          
          const seqInfo = recordingInfo.isSequential ? ` (seq #${recordingInfo.sequenceNumber})` : '';
          console.log(`[Recording] Completed ${stream.streamId} (${recordingInfo.sourceType.toUpperCase()})${seqInfo} - ${(stats.size / 1024 / 1024).toFixed(1)}MB, ${duration}s`);
        } catch (error) {
          console.error(`[Recording] Error finalizing ${stream.streamId}:`, error);
        }
      }
      activeRecordings.delete(stream.streamId);
    });
    
    ffmpegProcess.on('error', (error) => {
      if (error.code === 'EEXIST') {
        console.error(`[Recording] File already exists for ${stream.streamId} - this should not happen with sequential naming`);
      } else {
        console.error(`[Recording] Process error for ${stream.streamId} (${stream.sourceType.toUpperCase()}):`, error.message);
      }
      activeRecordings.delete(stream.streamId);
    });
    
  } catch (error) {
    console.error(`[Recording] Error starting recording for ${stream.streamId}:`, error);
  }
}

// Stop recording function
async function stopRecording(streamId) {
  const recordingInfo = activeRecordings.get(streamId);
  if (recordingInfo) {
    recordingInfo.process.kill('SIGTERM');
    activeRecordings.delete(streamId);
    console.log(`[Recording] Stopped recording for ${streamId}`);
  }
}

// Function to start RTSP recording manually (for UI-added streams)
export async function startRtspRecording(streamId) {
  try {
    const stream = await streamOperations.getStream(streamId);
    if (!stream) {
      throw new Error(`Stream ${streamId} not found`);
    }
    
    if (stream.sourceType !== 'rtsp') {
      throw new Error(`Stream ${streamId} is not an RTSP stream`);
    }
    
    if (activeRecordings.has(streamId)) {
      console.log(`[Recording] RTSP stream ${streamId} is already being recorded`);
      return;
    }
    
    createRecordingDirectory(streamId);
    await startRecording(stream);
    
    console.log(`[Recording] Started RTSP recording for ${streamId}`);
    
    if (typeof globalThis.broadcastToWebSocketClients === 'function') {
      globalThis.broadcastToWebSocketClients({
        type: 'recording-started',
        streamId: streamId,
        sourceType: 'rtsp'
      });
    }
    
  } catch (error) {
    console.error(`[Recording] Error starting RTSP recording for ${streamId}:`, error);
    throw error;
  }
}

// Function to stop RTSP recording manually
export async function stopRtspRecording(streamId) {
  await stopRecording(streamId);
  
  if (typeof globalThis.broadcastToWebSocketClients === 'function') {
    globalThis.broadcastToWebSocketClients({
      type: 'recording-stopped',
      streamId: streamId,
      sourceType: 'rtsp'
    });
  }
}

export default defineEventHandler(async (event) => {
  try {
    const { nms: nodeMediaServer } = await initializeServices();

    return { 
      status: 'RTMP server and Database services initialized - Streaming via Nuxt on port 3000',
      rtmpPort: useRuntimeConfig().public.rtmpPort,
      rtmpAppName: useRuntimeConfig().public.rtmpAppName,
      streamingUrl: 'http://localhost:3000/api/stream/<stream_key>'
    };
  } catch (error) {
    console.error('[RTMP Server] Initialization failed:', error);
    throw createError({
      statusCode: 500,
      statusMessage: `RTMP Server initialization failed: ${error.message}`
    });
  }
}); 