// Store connected WebSocket peers globally
let connectedPeers = new Set();

// Global function to broadcast to all WebSocket clients
globalThis.broadcastToWebSocketClients = (message) => {
  for (const peer of connectedPeers) {
    try {
      peer.send(JSON.stringify(message));
    } catch (error) {
      console.error('[WebSocket] Error sending message to peer:', error);
      connectedPeers.delete(peer); // Remove disconnected peers
    }
  }
};

export default defineWebSocketHandler({
  open(peer) {
    console.log(`[WebSocket] Client connected: ${peer.id}`);
    connectedPeers.add(peer);
    peer.send(JSON.stringify({ type: 'connection', message: 'Connected to WebSocket server' }));
  },

  message(peer, message) {
    // Handle any client messages if needed
  },

  close(peer, event) {
    console.log(`[WebSocket] Client disconnected: ${peer.id}`);
    connectedPeers.delete(peer);
  },

  error(peer, error) {
    console.error(`[WebSocket] Error for ${peer.id}:`, error);
    connectedPeers.delete(peer);
  }
}); 