export default defineEventHandler(async (event) => {
  const recorder = globalThis.rtmpRecorder;
  
  if (!recorder) {
    return {
      status: 'error',
      message: 'RTMP recorder not initialized',
      available: false
    };
  }
  
  return {
    status: 'success',
    message: 'RTMP recorder is available',
    available: true,
    activeRecordings: recorder.getActiveRecordings(),
    hasNMS: !!globalThis.nms
  };
});