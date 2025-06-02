export default async (nitroApp) => {
  console.log('[RTMP Recorder Plugin] Initializing...');

  try {
    // Dynamic import the RTMP recorder
    const { rtmpRecorder, integrateWithNodeMediaServer } = await import('../utils/rtmp-recorder.js');
    
    // Store in global for access across the app
    globalThis.rtmpRecorder = rtmpRecorder;
    globalThis.integrateWithNodeMediaServer = integrateWithNodeMediaServer;
    
    console.log('[RTMP Recorder Plugin] RTMP recorder loaded successfully');
    
    // Note: The NMS integration will happen in socket.js when NMS is available
    
  } catch (error) {
    console.error('[RTMP Recorder Plugin] Error loading RTMP recorder:', error);
  }
}; 