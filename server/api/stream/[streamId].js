import { spawn } from 'child_process';
import { Readable } from 'stream';

export default defineEventHandler(async (event) => {
  const streamId = getRouterParam(event, 'streamId');
  const query = getQuery(event);
  
  if (!streamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Stream ID is required'
    });
  }

  // Get RTMP URL from runtime config
  const config = useRuntimeConfig();
  const rtmpPort = config.public.rtmpPort;
  const rtmpAppName = config.public.rtmpAppName;
  const rtmpUrl = `rtmp://localhost:${rtmpPort}/${rtmpAppName}/${streamId}`;

  console.log(`[Stream API] Serving FLV stream for ${streamId} from ${rtmpUrl}`);

  // Set appropriate headers for FLV streaming
  setHeader(event, 'Content-Type', 'video/x-flv');
  setHeader(event, 'Access-Control-Allow-Origin', '*');
  setHeader(event, 'Access-Control-Allow-Headers', 'Range');
  setHeader(event, 'Cache-Control', 'no-cache');
  setHeader(event, 'Connection', 'keep-alive');

  // Handle HEAD requests
  if (getMethod(event) === 'HEAD') {
    return '';
  }

  return new Promise((resolve, reject) => {
    // Use FFmpeg to convert RTMP to FLV for HTTP streaming
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', rtmpUrl,
      '-c', 'copy',           // Copy streams without re-encoding
      '-f', 'flv',            // Output format FLV
      '-fflags', '+genpts',   // Generate presentation timestamps
      'pipe:1'                // Output to stdout
    ];

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
    
    // Handle FFmpeg errors
    ffmpegProcess.on('error', (error) => {
      console.error(`[Stream API] FFmpeg error for ${streamId}:`, error);
      reject(createError({
        statusCode: 500,
        statusMessage: 'Stream processing error'
      }));
    });

    ffmpegProcess.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[Stream API] FFmpeg exited with code ${code} for ${streamId}`);
      }
    });

    // Stream the FFmpeg output directly to the response
    ffmpegProcess.stdout.on('data', (chunk) => {
      try {
        event.node.res.write(chunk);
      } catch (error) {
        console.error(`[Stream API] Response write error for ${streamId}:`, error);
        ffmpegProcess.kill('SIGTERM');
      }
    });

    ffmpegProcess.stdout.on('end', () => {
      console.log(`[Stream API] Stream ended for ${streamId}`);
      event.node.res.end();
      resolve();
    });

    ffmpegProcess.stderr.on('data', (data) => {
      console.error(`[Stream API] FFmpeg stderr for ${streamId}: ${data}`);
    });

    // Handle client disconnect
    event.node.req.on('close', () => {
      console.log(`[Stream API] Client disconnected from ${streamId}`);
      ffmpegProcess.kill('SIGTERM');
    });

    event.node.req.on('error', () => {
      ffmpegProcess.kill('SIGTERM');
    });
  });
}); 