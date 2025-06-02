import { recordingOperations, generateResumableRecordingFilename, findActiveRecordingForTimeSlice, paths } from './database.js';
import { existsSync, mkdirSync, openSync, writeSync, closeSync, fstatSync, readSync, statSync } from 'fs';
import { dirname, join } from 'path';

// FLV constants inspired by nginx module
const FLV_HEADER = Buffer.from([
  0x46, 0x4c, 0x56, // 'FLV'
  0x01, // version = 1
  0x05, // audio + video flags
  0x00, 0x00, 0x00, 0x09, // header size
  0x00, 0x00, 0x00, 0x00  // PreviousTagSize0
]);

const TAG_TYPE_AUDIO = 8;
const TAG_TYPE_VIDEO = 9;
const TAG_TYPE_SCRIPT = 18;

export class RtmpRecorder {
  constructor() {
    this.activeRecorders = new Map();
  }

  startRecording(streamId, streamData) {
    if (this.activeRecorders.has(streamId)) {
      console.log(`[RtmpRecorder] Recording already active for ${streamId}`);
      return;
    }

    const recorder = new StreamRecorder(streamId, streamData);
    this.activeRecorders.set(streamId, recorder);
    
    recorder.start().catch(error => {
      console.error(`[RtmpRecorder] Failed to start recording for ${streamId}:`, error.message);
      this.stopRecording(streamId); // Ensure cleanup on start failure
    });
  }

  stopRecording(streamId) {
    const recorder = this.activeRecorders.get(streamId);
    if (recorder) {
      recorder.stop();
      this.activeRecorders.delete(streamId);
    }
  }

  stopAllRecordings() {
    for (const [streamId, recorder] of this.activeRecorders) {
      recorder.stop();
    }
    this.activeRecorders.clear();
  }

  getActiveRecordings() {
    return Array.from(this.activeRecorders.keys());
  }

  isRecording(streamId) {
    return this.activeRecorders.has(streamId);
  }

  getRecordingInfo(streamId) {
    const recorder = this.activeRecorders.get(streamId);
    return recorder ? recorder.getInfo() : null;
  }
}

class StreamRecorder {
  constructor(streamId, streamData) {
    this.streamId = streamId;
    this.streamData = streamData;
    this.sessionId = streamData.sessionId;

    this.fd = null;
    this.filePath = null;
    this.recordingId = null;
    this.startTime = null;
    this.frameCount = 0;
    this.fileOffset = 0;
    this.isActive = false;
    this.initialized = false;
    this.hasAudio = false;
    this.hasVideo = false;
    this.epoch = 0;
    this.aacHeaderSent = false;
    this.avcHeaderSent = false;
    this.videoKeySent = false;
    this.timeShift = 0;

    this.originalOnAudioPacket = null;
    this.originalOnVideoPacket = null;
    this.nmsSession = null; 
  }

  async start() {
    try {
      const existingRecording = await findActiveRecordingForTimeSlice(this.streamId, 'hourly');
      let resumeMode = false;
      let timeShift = 0;

      if (existingRecording) {
        const fullPath = join(paths.recordings, existingRecording.filePath);
        if (existsSync(fullPath)) {
          this.filePath = fullPath;
          this.recordingId = existingRecording.id;
          resumeMode = true;
          this.fd = openSync(this.filePath, 'r+');
          const analyzeResult = this.analyzeExistingFile();
          this.fileOffset = analyzeResult.fileSize;
          timeShift = analyzeResult.lastTimestamp;
          console.log(`[StreamRecorder] Resuming recording ${this.streamId} from ${this.filePath} at offset ${this.fileOffset} with timeShift ${timeShift}`);
        } else {
          console.warn(`[StreamRecorder] DB record for stream ${this.streamId} (ID: ${existingRecording.id}, Path: ${existingRecording.filePath}) found, but file '${fullPath}' is missing. Attempting to finalize old DB record and create a new file.`);
          try {
            const endTime = new Date().toISOString();
            const duration = existingRecording.startTime 
                             ? Math.floor((new Date(endTime).getTime() - new Date(existingRecording.startTime).getTime()) / 1000)
                             : 0;
            await recordingOperations.finishRecording(
              existingRecording.id,
              endTime, 
              0,
              Math.max(0, duration)
            );
            console.log(`[StreamRecorder] Marked old recording ${existingRecording.id} as finished due to missing file.`);
          } catch (dbError) {
            console.error(`[StreamRecorder] Error finalizing DB entry for missing file (ID: ${existingRecording.id}):`, dbError.message);
          }
        }
      }
      
      if (!resumeMode) {
        const recordingInfo = generateResumableRecordingFilename(this.streamId);
        this.filePath = recordingInfo.fullPath;
        const dir = dirname(this.filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        this.recordingId = await recordingOperations.addRecording(
          this.streamId,
          recordingInfo.relativePath,
          'hourly',
          new Date().toISOString()
        ).then(result => result.id);
        
        if (this.fd) { 
          try { closeSync(this.fd); } catch(e){ console.error(`[StreamRecorder] Error closing seemingly orphaned fd before new recording: ${e.message}`); }
          this.fd = null; 
        }
        this.fd = openSync(this.filePath, 'w');
        this.fileOffset = 0;
        this.writeFlvHeader();
        console.log(`[StreamRecorder] Started new recording ${this.streamId} (ID: ${this.recordingId}) to ${this.filePath}`);
      }

      this.startTime = new Date();
      this.isActive = true;
      this.timeShift = timeShift;

      this.attachToNMSSession();
      
    } catch (error) {
      console.error(`[StreamRecorder] Error starting recording for ${this.streamId}:`, error.message);
      this.cleanup();
      throw error; 
    }
  }

  attachToNMSSession(retryCount = 0) {
    if (!this.isActive) return;

    const nms = globalThis.nodeMediaServer?.nms;
    if (!nms) {
      if (retryCount < 5) {
        console.log(`[StreamRecorder] NMS instance not available, retrying attach for ${this.streamId} (${retryCount + 1}/5)`);
        setTimeout(() => this.attachToNMSSession(retryCount + 1), 300);
      } else {
        console.error(`[StreamRecorder] Failed to attach to NMS for ${this.streamId}: NMS instance not found.`);
        this.cleanup();
      }
      return;
    }

    const session = nms.getSession(this.sessionId);
    if (!session) {
      if (retryCount < 5) {
        console.log(`[StreamRecorder] NMS session ${this.sessionId} not found for ${this.streamId}, retrying (${retryCount + 1}/5)`);
        setTimeout(() => this.attachToNMSSession(retryCount + 1), 300);
      } else {
        console.error(`[StreamRecorder] Failed to attach to NMS session ${this.sessionId} for ${this.streamId}: Session not found.`);
        this.cleanup();
      }
      return;
    }

    this.nmsSession = session;
    console.log(`[StreamRecorder] NMS session ${this.sessionId} for ${this.streamId} found. Publisher type: ${session.constructor.name}`);

    if (typeof session.onAudioPacket === 'function') {
        this.originalOnAudioPacket = session.onAudioPacket;
        session.onAudioPacket = (packet, ...args) => {
          if (this.originalOnAudioPacket) {
            this.originalOnAudioPacket.call(session, packet, ...args);
          }
          if (this.isActive) {
            this.handleRtmpPacket(packet);
          }
        };
    } else {
        console.warn(`[StreamRecorder] NMS session ${this.sessionId} for ${this.streamId} does not have onAudioPacket method.`);
    }

    if (typeof session.onVideoPacket === 'function') {
        this.originalOnVideoPacket = session.onVideoPacket;
        session.onVideoPacket = (packet, ...args) => {
          if (this.originalOnVideoPacket) {
            this.originalOnVideoPacket.call(session, packet, ...args);
          }
          if (this.isActive) {
            this.handleRtmpPacket(packet);
          }
        };
    } else {
        console.warn(`[StreamRecorder] NMS session ${this.sessionId} for ${this.streamId} does not have onVideoPacket method.`);
    }
    
    console.log(`[StreamRecorder] Attached to NMS session ${this.sessionId} packet handlers for stream ${this.streamId}`);
  }

  detachFromNMSSession() {
    if (this.nmsSession) {
      if (this.originalOnAudioPacket && typeof this.nmsSession.onAudioPacket === 'function') {
         this.nmsSession.onAudioPacket = this.originalOnAudioPacket;
      }
      if (this.originalOnVideoPacket && typeof this.nmsSession.onVideoPacket === 'function') {
        this.nmsSession.onVideoPacket = this.originalOnVideoPacket;
      }
      console.log(`[StreamRecorder] Detached from NMS session ${this.sessionId} for stream ${this.streamId}`);
    }
    this.originalOnAudioPacket = null;
    this.originalOnVideoPacket = null;
    this.nmsSession = null;
  }

  stop() {
    if (!this.isActive && !this.fd) return;
    
    this.isActive = false; 
    this.detachFromNMSSession();

    try {
      if (this.initialized && this.fd) {
        const avFlags = (this.hasVideo ? 0x01 : 0) | (this.hasAudio ? 0x04 : 0);
        const flagBuffer = Buffer.from([avFlags]);
        if (this.fd !== null) {
            try { writeSync(this.fd, flagBuffer, 0, 1, 4); } 
            catch (e) { console.error(`[StreamRecorder] Error writing AV flags for ${this.streamId}: ${e.message}`);}
        }
      }

      if (this.fd) {
        try { closeSync(this.fd); } 
        catch (e) { console.error(`[StreamRecorder] Error closing fd for ${this.streamId} in stop: ${e.message}`); }
        this.fd = null;
      }

      if (this.recordingId) {
        const fileSize = this.filePath && existsSync(this.filePath) ? statSync(this.filePath).size : this.fileOffset;
        recordingOperations.finishRecording(
          this.recordingId, new Date().toISOString(), fileSize,
          this.startTime ? Math.floor((Date.now() - this.startTime.getTime()) / 1000) : 0
        ).catch(error => {
          console.error(`[StreamRecorder] Error updating recording DB ${this.recordingId}:`, error.message);
        });
      }
      console.log(`[StreamRecorder] Stopped recording ${this.streamId} (${this.frameCount} frames)`);
    } catch (error) {
      console.error(`[StreamRecorder] Error during stop procedure for ${this.streamId}:`, error.message);
    }
  }

  analyzeExistingFile() {
    if (!this.fd) return { fileSize: 0, lastTimestamp: 0 };
    
    let fileSize = 0;
    try { fileSize = fstatSync(this.fd).size; }
    catch(e) { console.error(`[StreamRecorder] fstatSync failed for ${this.streamId}: ${e.message}`); return { fileSize: 0, lastTimestamp: 0}; }

    let lastTimestamp = 0;
    if (fileSize < 17) return { fileSize: 0, lastTimestamp: 0 };

    try {
      const tagSizeBuffer = Buffer.alloc(4);
      readSync(this.fd, tagSizeBuffer, 0, 4, fileSize - 4);
      const tagSize = tagSizeBuffer.readUInt32BE(0);
      if (tagSize === 0 || tagSize + 4 > fileSize) return { fileSize: 0, lastTimestamp: 0 };

      const tagHeaderBuffer = Buffer.alloc(8);
      readSync(this.fd, tagHeaderBuffer, 0, 8, fileSize - tagSize - 4);
      const tagLength = (tagHeaderBuffer[1] << 16) | (tagHeaderBuffer[2] << 8) | tagHeaderBuffer[3];
      if (tagSize !== tagLength + 11) {
        console.warn(`[StreamRecorder] Tag size mismatch in ${this.streamId}. File might be corrupt. Starting fresh or from last known good state.`);
        return { fileSize: 0, lastTimestamp: 0 };
      }
      lastTimestamp = (tagHeaderBuffer[7] << 24) | (tagHeaderBuffer[4] << 16) | (tagHeaderBuffer[5] << 8) | tagHeaderBuffer[6];
      return { fileSize, lastTimestamp };
    } catch (error) {
      console.error(`[StreamRecorder] Error analyzing existing file ${this.streamId}:`, error.message);
      return { fileSize: 0, lastTimestamp: 0 };
    }
  }

  writeFlvHeader() {
    if (!this.fd) return;
    try {
      writeSync(this.fd, FLV_HEADER, 0, FLV_HEADER.length, this.fileOffset);
      this.fileOffset += FLV_HEADER.length;
    } catch (error) {
      console.error(`[StreamRecorder] Error writing FLV header for ${this.streamId}:`, error.message);
      this.cleanup(); throw error;
    }
  }

  writeFlvTag(type, data, timestamp) {
    if (!this.fd || !this.isActive) return false;
    try {
      const adjustedTimestamp = Math.max(0, timestamp - this.epoch + this.timeShift);
      const tagHeader = Buffer.alloc(11);
      let offset = 0;
      tagHeader[offset++] = type;
      const dataSize = data.length;
      tagHeader[offset++] = (dataSize >> 16) & 0xFF;
      tagHeader[offset++] = (dataSize >> 8) & 0xFF;
      tagHeader[offset++] = dataSize & 0xFF;
      tagHeader[offset++] = (adjustedTimestamp >> 16) & 0xFF;
      tagHeader[offset++] = (adjustedTimestamp >> 8) & 0xFF;
      tagHeader[offset++] = adjustedTimestamp & 0xFF;
      tagHeader[offset++] = (adjustedTimestamp >> 24) & 0xFF;
      tagHeader[offset++] = 0; tagHeader[offset++] = 0; tagHeader[offset++] = 0;
      const tagSizeVal = tagHeader.length + data.length;
      writeSync(this.fd, tagHeader, 0, tagHeader.length, this.fileOffset);
      this.fileOffset += tagHeader.length;
      writeSync(this.fd, data, 0, data.length, this.fileOffset);
      this.fileOffset += data.length;
      const prevTagSize = Buffer.alloc(4);
      prevTagSize.writeUInt32BE(tagSizeVal, 0);
      writeSync(this.fd, prevTagSize, 0, 4, this.fileOffset);
      this.fileOffset += 4;
      this.frameCount++;
      return true;
    } catch (error) {
      console.error(`[StreamRecorder] Error writing FLV tag for ${this.streamId}: ${error.message}. Cleaning up.`);
      this.cleanup(); return false;
    }
  }

  handleRtmpPacket(packet) {
    if (!this.isActive || !this.fd) return;
    try {
      const { type: flvType, data, timestamp, isKeyframe } = this.parseRtmpPacket(packet);
      if (!flvType || !data) return;

      if (!this.initialized) {
        this.initialized = true;
        this.epoch = timestamp;

        if (this.nmsSession) {
          const sessionParser = this.nmsSession.parser;
          const aacHeader = this.nmsSession.aacSequenceHeader || (sessionParser && sessionParser.aacSequenceHeader);
          const avcHeader = this.nmsSession.avcSequenceHeader || (sessionParser && sessionParser.avcSequenceHeader);

          if (aacHeader && !this.aacHeaderSent) {
            const aacConfig = Buffer.isBuffer(aacHeader) ? aacHeader : Buffer.from(aacHeader);
            if (this.writeFlvTag(TAG_TYPE_AUDIO, aacConfig, this.epoch)) {
                this.aacHeaderSent = true;
                console.log(`[StreamRecorder] Wrote AAC sequence header for ${this.streamId}`);
            }
          }
          if (avcHeader && !this.avcHeaderSent) {
             const avcConfig = Buffer.isBuffer(avcHeader) ? avcHeader : Buffer.from(avcHeader);
            if (this.writeFlvTag(TAG_TYPE_VIDEO, avcConfig, this.epoch)) {
                this.avcHeaderSent = true;
                console.log(`[StreamRecorder] Wrote AVC sequence header for ${this.streamId}`);
            }
          }
        }
      }

      if (flvType === TAG_TYPE_AUDIO) this.hasAudio = true;
      else if (flvType === TAG_TYPE_VIDEO) {
        this.hasVideo = true;
        if (isKeyframe) this.videoKeySent = true;
        if (!this.videoKeySent && this.avcHeaderSent) {
             return; 
        } else if (!this.avcHeaderSent && isKeyframe) {
            this.videoKeySent = true;
        } else if (!this.videoKeySent) {
            return;
        }
      }
      this.writeFlvTag(flvType, data, timestamp);
    } catch (error) {
      console.error(`[StreamRecorder] Error handling RTMP packet for ${this.streamId}:`, error.message);
    }
  }

  parseRtmpPacket(packet) { 
    if (!packet || !packet.header || !packet.payload) return {};
    const header = packet.header; 
    const rtmpType = header.type; 
    const timestamp = header.timestamp || 0; 
    const data = Buffer.from(packet.payload); 

    let flvType; let isKeyframe = false;
    switch (rtmpType) {
      case 8: flvType = TAG_TYPE_AUDIO; break;
      case 9: 
        flvType = TAG_TYPE_VIDEO;
        if (data.length > 0) { const frameType = (data[0] >> 4) & 0x0F; isKeyframe = frameType === 1; }
        break;
      case 18: flvType = TAG_TYPE_SCRIPT; break;
      default: return {};
    }
    return { type: flvType, data, timestamp, isKeyframe };
  }

  getFileSize() {
    if (!this.fd) return this.fileOffset;
    try { return fstatSync(this.fd).size; } 
    catch (error) { 
        console.warn(`[StreamRecorder] getFileSize: fstatSync failed for ${this.streamId}: ${error.message}. Returning fileOffset.`);
        return this.fileOffset; 
    }
  }

  getInfo() {
    let currentSize = this.fileOffset;
    if (this.filePath && existsSync(this.filePath)) {
        try { currentSize = statSync(this.filePath).size; } catch(e) { /* ignore, use fileOffset */ }
    } else if (this.fd) {
        currentSize = this.getFileSize();
    }

    return {
      streamId: this.streamId, filePath: this.filePath, isActive: this.isActive,
      startTime: this.startTime, frameCount: this.frameCount, 
      fileSize: currentSize,
      hasAudio: this.hasAudio, hasVideo: this.hasVideo, sessionId: this.sessionId,
    };
  }

  cleanup() {
    this.isActive = false;
    this.detachFromNMSSession();
    if (this.fd) {
      try { closeSync(this.fd); } 
      catch (error) { console.error(`[StreamRecorder] Error closing file for ${this.streamId} in cleanup:`, error.message); }
      this.fd = null;
    }
  }
}

export const rtmpRecorder = new RtmpRecorder();

export function integrateWithNodeMediaServer(nms) {
  if (!nms) {
    console.error("[RtmpRecorder] NMS instance not provided for integration.");
    return;
  }

  if (!globalThis.nodeMediaServer) globalThis.nodeMediaServer = {};
  globalThis.nodeMediaServer.nms = nms;

  nms.on('postPublish', (id, streamPath, args) => {
    let actualStreamPath = streamPath;
    if (!actualStreamPath && id && typeof id === 'object' && id.constructor === Object && id.id) {
        actualStreamPath = id.publishStreamPath || id.streamPath || id.path;
        if (!args && id.args) args = id.args;
        id = id.id;
    } else if (!actualStreamPath && typeof id === 'string' && args && args.path) {
        actualStreamPath = args.path;
    }

    if (!actualStreamPath || typeof actualStreamPath !== 'string') {
      console.error(`[RtmpRecorder] Could not determine valid StreamPath. session_id_param: ${id}, streamPath_param: ${streamPath}, args_param: ${JSON.stringify(args)}`);
      return;
    }
    const streamKey = actualStreamPath.split('/').pop();
    if (streamKey && typeof id === 'string') {
      console.log(`[RtmpRecorder] Stream published: ${streamKey} (Session ID: ${id})`);
      rtmpRecorder.startRecording(streamKey, { streamPath: actualStreamPath, args, sessionId: id });
    } else {
      console.error(`[RtmpRecorder] Invalid streamKey or sessionId for postPublish. streamKey: ${streamKey}, sessionId: ${id}`);
    }
  });

  nms.on('donePublish', (id, streamPath, args) => {
    let actualStreamPath = streamPath;
     if (!actualStreamPath && id && typeof id === 'object' && id.constructor === Object && id.id) {
        actualStreamPath = id.publishStreamPath || id.streamPath || id.path;
        id = id.id;
    } else if (!actualStreamPath && typeof id === 'string' && args && args.path) {
        actualStreamPath = args.path;
    }

    if (!actualStreamPath || typeof actualStreamPath !== 'string') {
      console.error(`[RtmpRecorder] Could not determine valid StreamPath in donePublish. session_id_param: ${id}, streamPath_param: ${streamPath}`);
      return;
    }
    const streamKey = actualStreamPath.split('/').pop();
    if (streamKey) {
      console.log(`[RtmpRecorder] Stream ended: ${streamKey}`);
      rtmpRecorder.stopRecording(streamKey);
    }
  });
  
  console.log('[RtmpRecorder] RTMP recorder integration with NMS packet hooking logic complete.');

  process.on('SIGINT', () => {
    console.log('[RtmpRecorder] SIGINT: Cleaning up recordings...');
    rtmpRecorder.stopAllRecordings();
    setTimeout(() => process.exit(0), 500);
  });
  process.on('SIGTERM', () => {
    console.log('[RtmpRecorder] SIGTERM: Cleaning up recordings...');
    rtmpRecorder.stopAllRecordings();
    setTimeout(() => process.exit(0), 500);
  });
}

export default rtmpRecorder; 