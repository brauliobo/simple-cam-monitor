<template>
  <div class="stream-monitor-container">
    <h1>Multi-Source Stream Monitor</h1>
    <p v-if="connecting">🔌 Connecting to server...</p>
    <div v-if="error" class="error-message">⚠️ Error: {{ error }}</div>
    
    <!-- Header controls -->
    <div class="header-controls">
      <div class="rtmp-info">
        <h3>🔴 RTMP Publishing</h3>
        <p>Publish to: <code>{{ rtmpStreamUrl }}</code></p>
        <p><small>RTMP streams auto-start recording when published</small></p>
        <p><small>✅ Data-safe recording: Server restarts create new sequential files (no data loss)</small></p>
      </div>
      
      <div class="action-buttons">
        <button @click="showAddRtspModal = true" class="add-rtsp-btn">
          📹 Add RTSP Camera
        </button>
        <button @click="refreshStreams" class="refresh-btn">
          🔄 Refresh Streams
        </button>
      </div>
    </div>
    
    <!-- Empty state -->
    <div v-if="streams.length === 0 && !connecting" class="empty-state">
      <p>📡 No streams found. Add an RTSP camera or publish to RTMP.</p>
    </div>
    
    <!-- Active streams -->
    <div v-else class="streams-container">
      <div v-for="stream in streams" :key="stream.streamId" class="stream-player">
        <!-- Stream header with status and controls -->
        <div class="stream-header">
          <div class="stream-title">
            <h3>{{ stream.streamName || stream.streamId }}</h3>
            <div class="stream-badges">
              <div class="stream-type">{{ stream.sourceType?.toUpperCase() || 'RTMP' }}</div>
              <div :class="['stream-status', stream.isActive ? 'online' : 'offline']">
                {{ stream.isActive ? '🟢 ONLINE' : '🔴 OFFLINE' }}
              </div>
            </div>
          </div>
          
          <div class="stream-toolbar">
            <button @click="openStreamSettings(stream)" class="toolbar-btn settings-btn" title="Settings">
              ⚙️
            </button>
            <button @click="deleteStream(stream.streamId)" class="toolbar-btn delete-btn" title="Delete">
              🗑️
            </button>
          </div>
        </div>
        
        <!-- Video player for RTMP streams (using flv.js) -->
        <div v-if="(!stream.sourceType || stream.sourceType === 'rtmp') && stream.isActive" class="video-container">
          <video :id="`video-${stream.streamId}`" autoplay muted width="640" height="360"></video>
          <div class="custom-controls">
            <button @click="togglePlay(stream)">{{ stream.isPlaying ? 'Pause' : 'Play' }}</button>
            <select v-if="stream.recordings && stream.recordings.length > 0" @change="playRecording($event, stream)" v-model="stream.selectedRecording">
              <option :value="null">Select a recording</option>
              <option v-for="rec in stream.recordings" :key="rec.id" :value="rec.filePath">
                {{ rec.filePath.split('/').pop() }} ({{ formatRecordingDate(rec.startedAt) }})
              </option>
            </select>
            <span v-if="stream.currentRecordingFile">Playing: {{ stream.currentRecordingFile.split('/').pop() }}</span>
          </div>
        </div>
        
        <!-- Offline placeholder for RTMP -->
        <div v-else-if="!stream.sourceType || stream.sourceType === 'rtmp'" class="offline-placeholder">
          <div class="offline-content">
            <p>📺 Stream Offline</p>
            <p><small>Waiting for RTMP publish...</small></p>
          </div>
        </div>
        
        <!-- Video player for RTSP streams (native HTML5) -->
        <div v-else-if="stream.sourceType === 'rtsp' && stream.isActive" class="video-container">
          <video :id="`video-${stream.streamId}`" width="640" height="360" crossorigin="anonymous" autoplay muted>
            <source :src="stream.sourceUrl" type="application/x-rtsp">
            <p>Your browser doesn\'t support RTSP playback. Consider using a different method to view this stream.</p>
          </video>
          <div class="custom-controls">
            <button @click="togglePlay(stream)">{{ stream.isPlaying ? 'Pause' : 'Play' }}</button>
             <select v-if="stream.recordings && stream.recordings.length > 0" @change="playRecording($event, stream)" v-model="stream.selectedRecording">
              <option :value="null">Select a recording</option>
              <option v-for="rec in stream.recordings" :key="rec.id" :value="rec.filePath">
                 {{ rec.filePath.split('/').pop() }} ({{ formatRecordingDate(rec.startedAt) }})
              </option>
            </select>
            <span v-if="stream.currentRecordingFile">Playing: {{ stream.currentRecordingFile.split('/').pop() }}</span>
          </div>
          <div class="rtsp-info">
            <p><small>RTSP URL: <code>{{ stream.sourceUrl }}</code></small></p>
            <p><small>Note: Direct RTSP playback may not work in all browsers. Recording will still function.</small></p>
          </div>
        </div>
        
        <!-- Offline placeholder for RTSP -->
        <div v-else-if="stream.sourceType === 'rtsp'" class="offline-placeholder">
          <div class="offline-content">
            <p>📹 RTSP Camera Offline</p>
            <p><small>Camera may be unreachable</small></p>
          </div>
        </div>
        
        <div class="stream-info">
          <p><strong>Status:</strong> {{ stream.status || (stream.isActive ? 'Active' : 'Offline') }}</p>
          <p v-if="stream.httpFlvUrl && stream.isActive"><strong>FLV URL:</strong> <code>{{ stream.httpFlvUrl }}</code></p>
          <p v-if="stream.sourceIp"><strong>Source IP:</strong> {{ stream.sourceIp }}</p>
          <p v-if="stream.description"><strong>Description:</strong> {{ stream.description }}</p>
          
          <!-- RTSP recording controls -->
          <div v-if="stream.sourceType === 'rtsp'" class="recording-controls">
            <button @click="startRecording(stream.streamId)" :disabled="stream.recording || !stream.recordEnabled">
              {{ stream.recording ? 'Recording...' : 'Start Recording' }}
            </button>
            <button @click="stopRecording(stream.streamId)" :disabled="!stream.recording">
              Stop Recording
            </button>
            <span v-if="!stream.recordEnabled" class="recording-disabled">
              📵 Recording Disabled
            </span>
          </div>
          
          <!-- RTMP auto-recording status -->
          <div v-else class="auto-recording">
            <p v-if="stream.recordEnabled"><small>✅ Auto-recording {{ stream.isActive ? 'active' : 'ready' }}</small></p>
            <p v-else><small>📵 Recording disabled</small></p>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Add RTSP Modal -->
    <div v-if="showAddRtspModal" class="modal-overlay" @click="closeAddRtspModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>📹 Add RTSP Camera</h3>
          <button @click="closeAddRtspModal" class="close-btn">✕</button>
        </div>
        
        <form @submit.prevent="addRtspStream" class="modal-form">
          <div class="form-group">
            <label>Stream ID *</label>
            <input v-model="newRtsp.streamId" type="text" placeholder="e.g., cam_01" required />
          </div>
          <div class="form-group">
            <label>Stream Name *</label>
            <input v-model="newRtsp.streamName" type="text" placeholder="e.g., Front Door Camera" required />
          </div>
          <div class="form-group">
            <label>RTSP URL *</label>
            <input v-model="newRtsp.rtspUrl" type="url" placeholder="rtsp://192.168.1.100:554/stream1" required />
          </div>
          <div class="form-group">
            <label>Username (optional)</label>
            <input v-model="newRtsp.username" type="text" placeholder="admin" />
          </div>
          <div class="form-group">
            <label>Password (optional)</label>
            <input v-model="newRtsp.password" type="password" placeholder="password" />
          </div>
          <div class="form-group">
            <label>Description (optional)</label>
            <input v-model="newRtsp.description" type="text" placeholder="Additional info about this camera" />
          </div>
          <div class="form-group">
            <label>Recording Slice</label>
            <select v-model="newRtsp.recordSlice">
              <option value="hourly">Hourly (recommended)</option>
              <option value="daily">Daily</option>
            </select>
          </div>
          
          <div class="modal-actions">
            <button type="button" @click="closeAddRtspModal" class="cancel-btn">Cancel</button>
            <button type="submit" :disabled="adding" class="submit-btn">
              {{ adding ? 'Adding...' : 'Add Camera' }}
            </button>
          </div>
        </form>
      </div>
    </div>
    
    <!-- Stream Settings Modal -->
    <div v-if="showSettingsModal && selectedStream" class="modal-overlay" @click="closeSettingsModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>⚙️ Stream Settings</h3>
          <button @click="closeSettingsModal" class="close-btn">✕</button>
        </div>
        
        <form @submit.prevent="updateStreamSettings" class="modal-form">
          <div class="form-group">
            <label>Stream Name</label>
            <input v-model="streamSettings.streamName" type="text" required />
          </div>
          
          <div class="form-group">
            <label>Description</label>
            <input v-model="streamSettings.description" type="text" placeholder="Optional description" />
          </div>
          
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="streamSettings.recordEnabled" />
              Enable Recording
            </label>
          </div>
          
          <div class="form-group">
            <label>Recording Slice</label>
            <select v-model="streamSettings.recordSlice">
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
            </select>
          </div>
          
          <div v-if="selectedStream.sourceType === 'rtsp'" class="form-group">
            <label>RTSP URL</label>
            <input v-model="streamSettings.sourceUrl" type="url" required />
          </div>
          
          <div v-if="selectedStream.sourceType === 'rtsp'" class="form-group">
            <label>Username</label>
            <input v-model="streamSettings.username" type="text" placeholder="Optional" />
          </div>
          
          <div v-if="selectedStream.sourceType === 'rtsp'" class="form-group">
            <label>Password</label>
            <input v-model="streamSettings.password" type="password" placeholder="Optional" />
          </div>
          
          <div class="modal-actions">
            <button type="button" @click="closeSettingsModal" class="cancel-btn">Cancel</button>
            <button type="submit" :disabled="updating" class="submit-btn">
              {{ updating ? 'Updating...' : 'Save Settings' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="js">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';

const runtimeConfig = useRuntimeConfig();
const rtmpPort = runtimeConfig.public.rtmpPort;
const rtmpAppName = runtimeConfig.public.rtmpAppName;

const rtmpStreamUrl = ref(`rtmp://<YOUR_SERVER_IP_OR_HOSTNAME>:${rtmpPort}/${rtmpAppName}/<STREAM_KEY>`);

const streams = ref([]);
const connecting = ref(true);
const error = ref(null);
const adding = ref(false);
const updating = ref(false);

// Modal states
const showAddRtspModal = ref(false);
const showSettingsModal = ref(false);
const selectedStream = ref(null);

// RTSP form data
const newRtsp = ref({
  streamId: '',
  streamName: '',
  rtspUrl: '',
  username: '',
  password: '',
  description: '',
  recordSlice: 'hourly'
});

// Stream settings form data
const streamSettings = ref({
  streamName: '',
  description: '',
  recordEnabled: true,
  recordSlice: 'hourly',
  sourceUrl: '',
  username: '',
  password: ''
});

let ws = null;
let FlvJs = null;

const initializeWebSocket = async () => {
  try {
    console.log('[WebSocket Client] Initializing server...');
    const response = await $fetch('/api/socket');
    console.log('[WebSocket Client] Server initialization completed:', response);
  } catch (e) {
    console.error('[WebSocket Client] Failed to initialize server:', e);
    error.value = `Failed to initialize server: ${e.message}`;
    connecting.value = false;
    return;
  }

  let wsURL = '';
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsURL = `${protocol}//${window.location.hostname}:${window.location.port}/socket.io`;
    console.log(`[WebSocket Client] Attempting to connect to: ${wsURL}`);
  } else {
    console.warn('[WebSocket Client] Window object not found, cannot determine connection URL dynamically.');
    connecting.value = false;
    error.value = 'WebSocket can only run in the browser.';
    return;
  }

  try {
    ws = new WebSocket(wsURL);

    ws.onopen = async () => {
      console.log('[WebSocket] Connected to server!');
      connecting.value = false;
      error.value = null;
      
      // Load existing streams
      await loadExistingStreams();
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[WebSocket] Received message:', data);

        if (data.type === 'new-stream') {
          await handleNewStream(data);
        } else if (data.type === 'stream-ended') {
          handleStreamEnded(data);
        } else if (data.type === 'stream-error') {
          handleStreamError(data);
        } else if (data.type === 'recording-started') {
          handleRecordingStarted(data);
        } else if (data.type === 'recording-stopped') {
          handleRecordingStopped(data);
        }
      } catch (e) {
        console.error('[WebSocket] Error parsing message:', e);
      }
    };

    ws.onclose = (event) => {
      console.log('[WebSocket] Disconnected from server:', event.reason);
      connecting.value = true;
      error.value = `WebSocket disconnected: ${event.reason}. Will attempt to reconnect.`;
      streams.value.forEach(stream => {
        stream.status = 'Disconnected';
        stream.isActive = false;
        if (stream.player) {
          stream.player.destroy();
          stream.player = null;
        }
      });
    };

    ws.onerror = (err) => {
      console.error('[WebSocket] Connection error:', err);
      connecting.value = false;
      error.value = `Failed to connect to WebSocket: Is the server running?`;
      streams.value.forEach(stream => {
        if (stream.player) {
          stream.player.destroy();
        }
      });
    };

  } catch (e) {
    console.error('[WebSocket] Failed to create WebSocket connection:', e);
    error.value = `WebSocket connection failed: ${e.message}`;
    connecting.value = false;
  }
};

// Load existing streams from API (including offline ones)
const loadExistingStreams = async () => {
  try {
    const response = await $fetch('/api/streams');
    if (response.streams && response.streams.length > 0) {
      streams.value = response.streams.map(stream => ({
        ...stream,
        status: stream.isActive ? 'Active' : 'Offline',
        recording: false,
        player: null,
        videoElement: null,
        httpFlvUrl: null
      }));
      
      // Initialize players for active RTMP streams
      for (const stream of streams.value) {
        if (stream.sourceType === 'rtmp' && stream.isActive) {
          await nextTick();
          await handleRtmpStream(stream);
        }
      }
    }
  } catch (e) {
    console.error('[API] Failed to load existing streams:', e);
  }
};

const refreshStreams = async () => {
  await loadExistingStreams();
};

const handleNewStream = async (data) => {
  console.log('[WebSocket] Received new-stream:', data);
  
  let existingStream = streams.value.find(s => s.streamId === data.streamId);

  if (data.sourceType === 'rtmp') {
    // Handle RTMP stream with flv.js - now served via Nuxt
    const httpFlvUrl = `http://${window.location.hostname}:3000/api/stream/${data.streamId}`;

    if (existingStream) {
      console.warn(`Stream ${data.streamId} already exists. Activating...`);
      existingStream.isActive = true;
      existingStream.status = 'Re-initializing player...';
      existingStream.sourceIp = data.sourceIp;
      if (existingStream.player) {
        existingStream.player.destroy();
      }
      existingStream.httpFlvUrl = httpFlvUrl;
    } else {
      streams.value.push({
        streamId: data.streamId,
        streamName: data.streamName || data.streamId,
        sourceType: 'rtmp',
        sourceUrl: `rtmp://${window.location.hostname}:${rtmpPort}${data.streamPath}`,
        sourceIp: data.sourceIp,
        isActive: true,
        recordEnabled: true,
        recordSlice: 'hourly',
        player: null,
        videoElement: null,
        status: 'Received, creating player...',
        httpFlvUrl: httpFlvUrl,
        recording: true // RTMP auto-records
      });
    }

    await nextTick();
    await initializeFlvPlayer(data.streamId);
  } else if (data.sourceType === 'rtsp') {
    // Handle RTSP stream
    if (existingStream) {
      existingStream.isActive = true;
      existingStream.status = 'RTSP stream online';
    } else {
      streams.value.push({
        streamId: data.streamId,
        streamName: data.streamName || data.streamId,
        sourceType: 'rtsp',
        sourceUrl: data.sourceUrl,
        sourceIp: data.sourceIp,
        isActive: true,
        recordEnabled: true,
        recordSlice: 'hourly',
        status: 'RTSP stream added',
        recording: false
      });
    }
  }
};

const handleRtmpStream = async (stream) => {
  // For existing RTMP streams, we construct the HTTP-FLV URL via Nuxt
  const httpFlvUrl = `http://${window.location.hostname}:3000/api/stream/${stream.streamId}`;
  
  stream.httpFlvUrl = httpFlvUrl;
  await nextTick();
  await initializeFlvPlayer(stream.streamId);
};

const initializeFlvPlayer = async (streamId) => {
  const stream = streams.value.find(s => s.streamId === streamId);
  if (!stream || !stream.httpFlvUrl || !stream.isActive) return;

  const videoElementId = `video-${streamId}`;
  stream.videoElement = document.getElementById(videoElementId);

  if (!stream.videoElement) {
    console.error(`Video element ${videoElementId} not found for stream ${streamId}.`);
    stream.status = 'Error: Video element not found';
    return;
  }

  if (FlvJs && FlvJs.isSupported() && stream.httpFlvUrl) {
    console.log(`Initializing flv.js for ${streamId} with URL: ${stream.httpFlvUrl}`);
    stream.status = `Loading FLV stream: ${stream.streamName}`;
    try {
      const flvPlayer = FlvJs.createPlayer({
        type: 'flv',
        isLive: true,
        url: stream.httpFlvUrl,
        hasAudio: true,
        hasVideo: true
      }, {
        enableStashBuffer: true,
        stashInitialSize: 128,
        lazyLoad: false,
      });

      flvPlayer.attachMediaElement(stream.videoElement);
      flvPlayer.load();
      
      const playPromise = flvPlayer.play();
      if (playPromise !== undefined && typeof playPromise.then === 'function') {
        playPromise.catch(playError => {
          console.error(`Error playing stream ${streamId}:`, playError);
          stream.status = `Error playing: ${playError.message}`;
        });
      }

      flvPlayer.on(FlvJs.Events.ERROR, (errType, errDetail) => {
        console.error(`flv.js Error (${streamId}): Type: ${errType}, Detail: ${errDetail}`);
        stream.status = `FLV Error: ${errType} - ${errDetail}`;
      });
      
      flvPlayer.on(FlvJs.Events.MEDIA_INFO, (mediaInfo) => {
        console.log(`flv.js (${streamId}): Media Info:`, mediaInfo);
        stream.status = `Playing stream: ${stream.streamName}`;
      });

      stream.player = flvPlayer;
    } catch (e) {
      console.error(`Error creating flv.js player for ${streamId}:`, e);
      stream.status = `Error: ${e.message}`;
    }
  }
};

const handleStreamEnded = (data) => {
  console.log('[WebSocket] Received stream-ended:', data);
  const stream = streams.value.find(s => s.streamId === data.streamId);
  if (stream) {
    stream.status = 'Stream ended by server';
    stream.isActive = false;
    stream.recording = false;
    if (stream.player) {
      stream.player.destroy();
      stream.player = null;
    }
  }
};

const handleStreamError = (data) => {
  console.error('[WebSocket] Received stream-error:', data);
  const stream = streams.value.find(s => s.streamId === data.streamId);
  if (stream) {
    stream.status = `Error: ${data.message}`;
    stream.isActive = false;
    if (stream.player) {
      stream.player.destroy();
      stream.player = null;
    }
  }
};

const handleRecordingStarted = (data) => {
  const stream = streams.value.find(s => s.streamId === data.streamId);
  if (stream) {
    stream.recording = true;
    stream.status = 'Recording started';
  }
};

const handleRecordingStopped = (data) => {
  const stream = streams.value.find(s => s.streamId === data.streamId);
  if (stream) {
    stream.recording = false;
    stream.status = 'Recording stopped';
  }
};

// Modal functions
const closeAddRtspModal = () => {
  showAddRtspModal.value = false;
  // Reset form
  newRtsp.value = {
    streamId: '',
    streamName: '',
    rtspUrl: '',
    username: '',
    password: '',
    description: '',
    recordSlice: 'hourly'
  };
};

const openStreamSettings = (stream) => {
  selectedStream.value = stream;
  streamSettings.value = {
    streamName: stream.streamName || stream.streamId,
    description: stream.description || '',
    recordEnabled: stream.recordEnabled,
    recordSlice: stream.recordSlice || 'hourly',
    sourceUrl: stream.sourceUrl || '',
    username: stream.username || '',
    password: stream.password || ''
  };
  showSettingsModal.value = true;
};

const closeSettingsModal = () => {
  showSettingsModal.value = false;
  selectedStream.value = null;
};

// Add RTSP stream
const addRtspStream = async () => {
  if (adding.value) return;
  adding.value = true;
  
  try {
    const response = await $fetch('/api/streams', {
      method: 'POST',
      body: {
        sourceType: 'rtsp',
        streamId: newRtsp.value.streamId,
        streamName: newRtsp.value.streamName,
        rtspUrl: newRtsp.value.rtspUrl,
        username: newRtsp.value.username || null,
        password: newRtsp.value.password || null,
        description: newRtsp.value.description || null,
        recordSlice: newRtsp.value.recordSlice
      }
    });
    
    console.log('[API] RTSP stream added:', response);
    
    // Add to local streams list
    streams.value.push({
      ...response.stream,
      status: 'RTSP stream added successfully',
      recording: false,
      player: null,
      videoElement: null,
      httpFlvUrl: null
    });
    
    closeAddRtspModal();
    
  } catch (e) {
    console.error('[API] Error adding RTSP stream:', e);
    error.value = `Failed to add RTSP stream: ${e.message || e}`;
  } finally {
    adding.value = false;
  }
};

// Update stream settings
const updateStreamSettings = async () => {
  if (updating.value || !selectedStream.value) return;
  updating.value = true;
  
  try {
    const response = await $fetch('/api/streams', {
      method: 'PUT',
      body: {
        streamId: selectedStream.value.streamId,
        streamName: streamSettings.value.streamName,
        description: streamSettings.value.description,
        recordEnabled: streamSettings.value.recordEnabled,
        recordSlice: streamSettings.value.recordSlice,
        ...(selectedStream.value.sourceType === 'rtsp' && {
          sourceUrl: streamSettings.value.sourceUrl,
          username: streamSettings.value.username || null,
          password: streamSettings.value.password || null
        })
      }
    });
    
    console.log('[API] Stream updated:', response);
    
    // Update local stream data
    Object.assign(selectedStream.value, {
      streamName: streamSettings.value.streamName,
      description: streamSettings.value.description,
      recordEnabled: streamSettings.value.recordEnabled,
      recordSlice: streamSettings.value.recordSlice,
      ...(selectedStream.value.sourceType === 'rtsp' && {
        sourceUrl: streamSettings.value.sourceUrl,
        username: streamSettings.value.username,
        password: streamSettings.value.password
      })
    });
    
    closeSettingsModal();
    
  } catch (e) {
    console.error('[API] Error updating stream:', e);
    error.value = `Failed to update stream: ${e.message || e}`;
  } finally {
    updating.value = false;
  }
};

// Start RTSP recording
const startRecording = async (streamId) => {
  try {
    const response = await $fetch(`/api/recording/start`, {
      method: 'POST',
      body: { streamId }
    });
    console.log('[API] Recording started:', response);
  } catch (e) {
    console.error('[API] Error starting recording:', e);
    error.value = `Failed to start recording: ${e.message || e}`;
  }
};

// Stop RTSP recording
const stopRecording = async (streamId) => {
  try {
    const response = await $fetch(`/api/recording/stop`, {
      method: 'POST',
      body: { streamId }
    });
    console.log('[API] Recording stopped:', response);
  } catch (e) {
    console.error('[API] Error stopping recording:', e);
    error.value = `Failed to stop recording: ${e.message || e}`;
  }
};

// Delete stream
const deleteStream = async (streamId) => {
  if (!confirm(`Are you sure you want to delete stream "${streamId}"?`)) return;
  
  try {
    const response = await $fetch(`/api/streams?streamId=${streamId}`, {
      method: 'DELETE'
    });
    
    console.log('[API] Stream deleted:', response);
    
    // Remove from local list
    const streamIndex = streams.value.findIndex(s => s.streamId === streamId);
    if (streamIndex > -1) {
      const stream = streams.value[streamIndex];
      if (stream.player) {
        stream.player.destroy();
      }
      streams.value.splice(streamIndex, 1);
    }
    
  } catch (e) {
    console.error('[API] Error deleting stream:', e);
    error.value = `Failed to delete stream: ${e.message || e}`;
  }
};

const togglePlay = (stream) => {
  const videoElement = document.getElementById(`video-${stream.streamId}`);
  if (videoElement) {
    if (stream.isPlaying) {
      videoElement.pause();
    } else {
      if (videoElement.src) {
        videoElement.play().catch(e => console.error(`Error playing ${stream.streamId}:`, e));
      } else if (stream.sourceType === 'rtmp' && stream.player) {
        stream.player.play().catch(e => console.error(`Error playing FLV ${stream.streamId}:`, e));
      } else {
         // If no src, and it's a live stream, try to set it up
         if (stream.sourceType === 'rtmp') setupFlvPlayer(stream);
         else if (stream.sourceType === 'rtsp') videoElement.src = stream.sourceUrl;
         videoElement.play().catch(e => console.error(`Error playing ${stream.streamId} after setup:`, e));
      }
    }
    stream.isPlaying = !stream.isPlaying;
  }
};

const playRecording = async (event, stream) => {
  const filePath = event.target.value;
  stream.selectedRecording = filePath; // Keep track of selected recording

  if (!filePath) { // User selected "Select a recording" or no recording is available
    // Revert to live stream
    stream.currentRecordingFile = null;
    const videoElement = document.getElementById(`video-${stream.streamId}`);
    if (videoElement) {
      if (stream.sourceType === 'rtmp') {
        if (stream.player) {
          stream.player.unload();
          stream.player.detachMediaElement();
          stream.player.attachMediaElement(videoElement);
          stream.player.loadSource(stream.httpFlvUrl); // Ensure this is the live FLV URL
          stream.player.play();
        } else {
          // If player didn't exist for live stream, initialize it for live stream
          await initializeFlvPlayer(stream.streamId);
        }
      } else if (stream.sourceType === 'rtsp') {
        videoElement.src = stream.sourceUrl;
        videoElement.load();
        videoElement.play().catch(e => console.error(`Error playing RTSP recording ${filePath}:`, e));
      } else {
        // General HTML5 video playback for other types, if any
        if (stream.player) {
          // Re-attach and play to get the latest frames for FLV.js
          // Ensure the player is reset to the live URL if it was playing a recording
          console.log(`Re-attaching FLV player for live stream ${stream.streamId} on visibility change.`);
          stream.player.unload();
          stream.player.detachMediaElement();
          stream.player.attachMediaElement(videoElement);
          stream.player.loadSource(stream.httpFlvUrl); // Use live URL
          await stream.player.play();
        } else {
          // If no player instance exists (e.g., after an error or if it was a recording player that got cleaned up)
          console.log(`No existing FLV player for ${stream.streamId} on visibility change, calling initializeFlvPlayer for live stream.`);
          await initializeFlvPlayer(stream.streamId); 
        }
      }
      stream.isPlaying = true;
    }
    return;
  }

  const videoElement = document.getElementById(`video-${stream.streamId}`);
  if (videoElement) {
    const recordingUrl = `/recordings/${filePath}`; 

    if (stream.player) { // Destroy any existing FLV player
      stream.player.destroy();
      stream.player = null;
    }
    
    if (stream.sourceType === 'rtsp') {
        videoElement.src = recordingUrl;
        videoElement.load(); 
        videoElement.play().catch(e => console.error(`Error playing RTSP recording ${filePath}:`, e));
    } else if (stream.sourceType === 'rtmp') { 
        if (FlvJs && FlvJs.isSupported()) {
            const newFlvPlayer = FlvJs.createPlayer({
                type: 'flv',
                isLive: false, // This is a recording
                url: recordingUrl,
                hasAudio: true, 
                hasVideo: true
            }, {
                enableStashBuffer: true,
                stashInitialSize: 1024 * 256, // 256KB stash for recordings
            });
            newFlvPlayer.attachMediaElement(videoElement);
            newFlvPlayer.load();
            newFlvPlayer.play().catch(e => console.error(`Error playing FLV recording ${filePath} with new player:`, e));
            stream.player = newFlvPlayer; // Assign the new recording player
        } else {
            console.warn("FlvJs not supported or available. Falling back to direct src for FLV recording.");
            videoElement.src = recordingUrl; 
            videoElement.play().catch(e => console.error(`Error playing FLV recording directly (fallback) ${filePath}:`, e));
        }
    } else { 
        videoElement.src = recordingUrl;
        videoElement.play().catch(e => console.error(`Error playing recording ${filePath}:`, e));
    }
    stream.currentRecordingFile = filePath;
    stream.isPlaying = true;
  }
};

const formatRecordingDate = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Function to handle visibility change
const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    streams.value.forEach(async stream => {
      const videoElement = document.getElementById(`video-${stream.streamId}`);
      if (videoElement && stream.isActive) {
        try {
          if (stream.player) { // Destroy existing player before re-initializing
            stream.player.destroy();
            stream.player = null;
          }

          if (stream.currentRecordingFile && stream.selectedRecording) {
            console.log(`Resuming recording ${stream.currentRecordingFile} for ${stream.streamId} on visibility change.`);
            const recordingUrl = `/recordings/${stream.currentRecordingFile}`;
            if (stream.sourceType === 'rtsp') {
              videoElement.src = recordingUrl;
              videoElement.load();
              await videoElement.play();
            } else if (stream.sourceType === 'rtmp') {
              if (FlvJs && FlvJs.isSupported()) {
                const recordingPlayer = FlvJs.createPlayer({
                    type: 'flv',
                    isLive: false,
                    url: recordingUrl,
                    hasAudio: true,
                    hasVideo: true
                }, {
                    enableStashBuffer: true,
                    stashInitialSize: 1024 * 256,
                });
                recordingPlayer.attachMediaElement(videoElement);
                recordingPlayer.load();
                await recordingPlayer.play();
                stream.player = recordingPlayer;
              } else {
                videoElement.src = recordingUrl; // Fallback
                await videoElement.play();
              }
            }
            stream.isPlaying = true;
          } else {
            console.log(`Refreshing live stream for ${stream.streamId} on visibility change`);
            if (stream.sourceType === 'rtmp') {
              await initializeFlvPlayer(stream.streamId); // This will create and assign to stream.player
            } else if (stream.sourceType === 'rtsp') {
              videoElement.src = stream.sourceUrl; 
              videoElement.load();
              await videoElement.play();
            }
            stream.isPlaying = true; 
          }
        } catch (e) {
            console.error(`Error resuming/restarting play for ${stream.streamId} on visibility change:`, e);
            stream.isPlaying = false; // Update status if play failed
        }
      }
    });
  }
};

onMounted(async () => {
  if (typeof window !== 'undefined') {
    rtmpStreamUrl.value = `rtmp://${window.location.hostname}:${rtmpPort}/${rtmpAppName}/<STREAM_KEY>`;
    
    try {
      const flvModule = await import('flv.js');
      FlvJs = flvModule.default;
      if (!FlvJs && window.flvjs) FlvJs = window.flvjs;

      if (FlvJs) {
        console.log('flv.js loaded successfully.', FlvJs.version);
      } else {
        error.value = 'Failed to load flv.js library.';
        console.error('Failed to load flv.js library.');
        // return; // Commented out to allow RTSP to work if FLV.js fails
      }
    } catch (e) {
      error.value = 'Error importing flv.js: ' + e.message;
      console.error('Error importing flv.js:', e);
      // return; // Commented out to allow RTSP to work if FLV.js fails
    }
    
    await initializeWebSocket();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    // Initial fetch of streams and their recordings
    // fetchStreams(true); // Moved to initializeWebSocket to ensure FlvJs is loaded
  } else {
    connecting.value = false;
    // error.value = 'WebSocket and flv.js can only run in the browser.';
  }
});

onBeforeUnmount(() => {
  streams.value.forEach(stream => {
    if (stream.player) {
      stream.player.destroy();
      stream.player = null; // Clean up player instance
    }
  });
  if (ws) {
    console.log('[WebSocket] Closing WebSocket connection before component unmount.');
    ws.close();
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});

// Helper function to get the latest recording for a stream
// This is a placeholder, actual logic might depend on how recordings are named or sorted
// For now, it assumes recordings are sorted by date in stream.recordings
/* // This helper might not be strictly needed if using selectedRecording or currentRecordingFile
const getLatestRecordingPath = (stream) => {
  if (stream.recordings && stream.recordings.length > 0) {
    // Assuming recordings are pre-sorted with newest first
    return stream.recordings[0].filePath;
  }
  return null;
};
*/

</script>

<style scoped>
.stream-monitor-container {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  padding: 20px;
  background-color: #f0f2f5;
  min-height: 100vh;
  color: #333;
}

h1 {
  text-align: center;
  color: #1a1a1a;
  margin-bottom: 25px;
  font-weight: 600;
}

.header-controls {
  display: flex;
  gap: 20px;
  margin-bottom: 30px;
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.rtmp-info {
  flex: 1;
  padding: 15px;
  background: #f8f9fa;
  border-left: 4px solid #dc3545;
  border-radius: 4px;
}

.rtmp-info h3 {
  margin-top: 0;
  margin-bottom: 10px;
  color: #dc3545;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
  justify-content: center;
}

.add-rtsp-btn {
  background: #007bff;
  color: white;
  border: none;
  padding: 12px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  white-space: nowrap;
}

.add-rtsp-btn:hover {
  background: #0056b3;
}

.refresh-btn {
  background: #28a745;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.refresh-btn:hover {
  background: #1e7e34;
}

.empty-state {
  text-align: center;
  padding: 40px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.streams-container {
  display: flex; 
  flex-wrap: wrap; 
  gap: 1px; /* Thin line separation */
  background-color: #ccc; /* Color of the thin line */
}

.stream-player {
  background-color: #fff; 
  border-radius: 0px; 
  box-shadow: none; /* Remove individual shadow for a flatter look */
  display: flex;
  flex-direction: column;
  overflow: hidden; 
  flex: 1 1 320px; /* Base size, allows wrapping */
  min-width: 300px; /* Minimum width before wrapping */
  border: none; /* Remove individual borders, gap will create lines */
}

.stream-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 15px;
}

.stream-title h3 {
  margin: 0 0 8px 0;
  color: #1a1a1a;
}

.stream-badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.stream-type {
  background: #007bff;
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.stream-status {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.stream-status.online {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.stream-status.offline {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

.stream-toolbar {
  display: flex;
  gap: 5px;
}

.toolbar-btn {
  background: none;
  border: 1px solid #ddd;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  background: #f8f9fa;
}

.settings-btn:hover {
  border-color: #007bff;
}

.delete-btn:hover {
  border-color: #dc3545;
  background: #f8d7da;
}

.video-container {
  position: relative;
  background-color: #000; 
  width: 100%; 
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 180px; 
}

.video-container video {
  width: 100%; 
  height: auto; 
  max-height: 500px; 
  display: block; 
}

.offline-placeholder {
  width: 640px;
  height: 360px;
  background: #f8f9fa;
  border: 2px dashed #dee2e6;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 15px;
}

.offline-content {
  text-align: center;
  color: #6c757d;
}

.offline-content p {
  margin: 5px 0;
}

.rtsp-info {
  margin-top: 10px;
  padding: 10px;
  background: #f8f9fa;
  border-radius: 4px;
  font-size: 12px;
}

.stream-info p {
  text-align: left;
  margin: 5px 0;
  font-size: 14px;
}

.recording-controls {
  margin: 10px 0;
}

.recording-controls button {
  margin-right: 10px;
  font-size: 12px;
  padding: 6px 12px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.recording-controls button:disabled {
  background: #6c757d;
  cursor: not-allowed;
}

.recording-disabled {
  color: #dc3545;
  font-size: 12px;
  font-weight: 500;
}

.auto-recording {
  margin: 10px 0;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 8px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  max-width: 500px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 20px 0 20px;
  margin-bottom: 20px;
}

.modal-header h3 {
  margin: 0;
  color: #1a1a1a;
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #6c757d;
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  background: #f8f9fa;
  color: #495057;
}

.modal-form {
  padding: 0 20px 20px 20px;
}

.form-group {
  margin-bottom: 15px;
}

.form-group label {
  display: block;
  font-weight: 500;
  margin-bottom: 5px;
  color: #555;
}

.checkbox-label {
  display: flex !important;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  margin: 0;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  box-sizing: border-box;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
}

.modal-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #eee;
}

.cancel-btn {
  background: #6c757d;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
}

.cancel-btn:hover {
  background: #5a6268;
}

.submit-btn {
  background: #007bff;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
}

.submit-btn:hover:not(:disabled) {
  background: #0056b3;
}

.submit-btn:disabled {
  background: #6c757d;
  cursor: not-allowed;
}

code {
  background-color: #e9ecef;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
  color: #495057;
  font-size: 85%;
}

.error-message {
  color: #dc3545;
  background-color: #f8d7da;
  border: 1px solid #f5c6cb;
  padding: 15px;
  border-radius: 5px;
  margin-bottom: 20px;
}

p {
  text-align: center;
  color: #555;
  margin-bottom: 10px;
}

.custom-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0; /* Ensure it spans full width */
  background-color: rgba(0, 0, 0, 0.6);
  color: white;
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between; /* Better distribution */
  opacity: 0; 
  transition: opacity 0.3s ease-in-out;
  z-index: 10;
}

.stream-player:hover .custom-controls {
  opacity: 1; 
}

.custom-controls button {
  background-color: rgba(50, 50, 50, 0.8);
  color: white;
  border: 1px solid rgba(255,255,255,0.2);
  padding: 6px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 0.9em;
}

.custom-controls button:hover {
  background-color: rgba(70, 70, 70, 0.9);
}

.custom-controls select {
  background-color: rgba(50, 50, 50, 0.8);
  color: white;
  border: 1px solid rgba(255,255,255,0.2);
  padding: 6px;
  border-radius: 4px;
  font-size: 0.9em;
  max-width: 180px; 
  margin: 0 10px; /* Add some margin */
}

.custom-controls span {
  font-size: 0.85em;
  margin-left: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px; 
  flex-shrink: 1; /* Allow shrinking if space is tight */
}
</style> 