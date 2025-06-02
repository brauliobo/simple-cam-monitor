import { createWriteStream, existsSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';

export class FlvWriter {
  constructor(filePath) {
    this.filePath = filePath;
    this.writeStream = null;
    this.fileOffset = 0;
    this.timeShift = 0;
    this.isAppending = false;
  }

  async open(append = true) {
    try {
      this.isAppending = append && existsSync(this.filePath);

      if (this.isAppending) {
        const result = this.analyzeExistingFile();
        this.fileOffset = result.fileSize;
        this.timeShift = result.lastTimestamp;
        
        // Open in append mode
        this.writeStream = createWriteStream(this.filePath, { flags: 'a' });
      } else {
        // Create new file, write FLV header
        this.writeStream = createWriteStream(this.filePath, { flags: 'w' });
        this.writeFlvHeader();
        this.fileOffset = 13; // FLV header size
      }

      return true;
    } catch (error) {
      console.error('[FlvWriter] Error opening file:', error);
      return false;
    }
  }

  analyzeExistingFile() {
    const stats = statSync(this.filePath);
    const fileSize = stats.size;
    
    if (fileSize < 17) { // FLV header (13) + minimum tag structure (4)
      return { fileSize: 0, lastTimestamp: 0 };
    }

    const fd = openSync(this.filePath, 'r');
    
    try {
      // Read last 4 bytes to get tag size
      const tagSizeBuffer = Buffer.alloc(4);
      readSync(fd, tagSizeBuffer, 0, 4, fileSize - 4);
      
      // Convert big-endian to tag size
      const tagSize = tagSizeBuffer.readUInt32BE(0);
      
      if (tagSize === 0 || tagSize + 4 > fileSize) {
        return { fileSize: 0, lastTimestamp: 0 };
      }

      // Read the last tag header (8 bytes from tag start)
      const tagHeaderBuffer = Buffer.alloc(8);
      readSync(fd, tagHeaderBuffer, 0, 8, fileSize - tagSize - 4);
      
      // Extract tag length and timestamp
      const tagLength = (tagHeaderBuffer[1] << 16) | (tagHeaderBuffer[2] << 8) | tagHeaderBuffer[3];
      
      if (tagSize !== tagLength + 11) {
        console.warn('[FlvWriter] Tag size mismatch, starting fresh');
        return { fileSize: 0, lastTimestamp: 0 };
      }

      // Extract timestamp (24-bit + 8-bit extended)
      const timestamp = (tagHeaderBuffer[7] << 24) | 
                       (tagHeaderBuffer[4] << 16) | 
                       (tagHeaderBuffer[5] << 8) | 
                       tagHeaderBuffer[6];

      console.log(`[FlvWriter] Appending to existing file: size=${fileSize}, lastTimestamp=${timestamp}`);
      return { fileSize, lastTimestamp: timestamp };
      
    } finally {
      closeSync(fd);
    }
  }

  writeFlvHeader() {
    // FLV file header (13 bytes)
    const flvHeader = Buffer.from([
      0x46, 0x4c, 0x56, // 'FLV'
      0x01,             // version 1
      0x05,             // audio + video flags
      0x00, 0x00, 0x00, 0x09, // header size (9)
      0x00, 0x00, 0x00, 0x00  // PreviousTagSize0
    ]);
    
    this.writeStream.write(flvHeader);
  }

  writeTag(type, data, timestamp) {
    if (!this.writeStream) {
      throw new Error('FlvWriter not opened');
    }

    // Adjust timestamp for append mode
    const adjustedTimestamp = this.isAppending ? timestamp + this.timeShift : timestamp;
    
    // Ensure timestamp doesn't go negative
    const finalTimestamp = Math.max(0, adjustedTimestamp);

    // Tag header (11 bytes)
    const tagHeader = Buffer.alloc(11);
    tagHeader[0] = type; // tag type (8=audio, 9=video, 18=script)
    
    // Data size (24-bit big-endian)
    const dataSize = data.length;
    tagHeader[1] = (dataSize >>> 16) & 0xFF;
    tagHeader[2] = (dataSize >>> 8) & 0xFF;
    tagHeader[3] = dataSize & 0xFF;
    
    // Timestamp (24-bit + 8-bit extended)
    tagHeader[4] = (finalTimestamp >>> 16) & 0xFF;
    tagHeader[5] = (finalTimestamp >>> 8) & 0xFF;
    tagHeader[6] = finalTimestamp & 0xFF;
    tagHeader[7] = (finalTimestamp >>> 24) & 0xFF;
    
    // Stream ID (always 0 for FLV)
    tagHeader[8] = 0;
    tagHeader[9] = 0;
    tagHeader[10] = 0;

    // Write tag header
    this.writeStream.write(tagHeader);
    
    // Write tag data
    this.writeStream.write(data);
    
    // Write tag size (4 bytes big-endian)
    const tagSize = 11 + dataSize;
    const tagSizeBuffer = Buffer.alloc(4);
    tagSizeBuffer.writeUInt32BE(tagSize, 0);
    this.writeStream.write(tagSizeBuffer);

    this.fileOffset += tagSize + 4;
  }

  close() {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }

  getFileSize() {
    return this.fileOffset;
  }

  isOpen() {
    return this.writeStream !== null;
  }
}

// Factory function for easier use
export function createFlvWriter(filePath) {
  return new FlvWriter(filePath);
}

// Utility to check if file needs FLV header
export function needsFlvHeader(filePath) {
  if (!existsSync(filePath)) return true;
  
  const stats = statSync(filePath);
  return stats.size < 13; // FLV header size
} 