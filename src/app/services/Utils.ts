export class Utils {
    // μ-law decoding: standard ITU-T G.711 conversion.
    static ulawToLinear(u_val: number): number {
      u_val = ~u_val & 0xFF;
      const sign = (u_val & 0x80) ? -1 : 1;
      const exponent = (u_val >> 4) & 0x07;
      const mantissa = u_val & 0x0F;
      const sample = (((mantissa << 1) + 33) << exponent) - 33;
      return sign * sample;
    }
  
    static decode(buffer: ArrayBuffer): Float32Array {
        try {
            const uLawData = new Uint8Array(buffer);
            const pcmSamples = new Float32Array(uLawData.length);
            
            for (let i = 0; i < uLawData.length; i++) {
                pcmSamples[i] = this.ulawToLinear(uLawData[i]) / 32768;
            }
            
            return pcmSamples;
        } catch (error) {
            console.error('Error decoding audio data:', error);
            return new Float32Array(0);
        }
    }
  
    static linearToUlaw(pcm_val: number): number {
      const MU = 255;
      const MAX = 32768;
      const sign = pcm_val < 0 ? 0x80 : 0;
      const magnitude = Math.min(MAX, Math.abs(pcm_val));
      const ulaw = Math.log(1 + (MU * magnitude) / MAX) / Math.log(1 + MU);
      let ulawByte = ~(Math.floor(ulaw * 127)) & 0xFF;
      ulawByte = ulawByte | sign;
      return ulawByte;
    }
  
    static encode(pcm: Float32Array): Uint8Array {
      const encoded = new Uint8Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) {
        const sample = Math.max(-1, Math.min(1, pcm[i]));
        const pcm16 = sample < 0 ? sample * 32768 : sample * 32767;
        encoded[i] = this.linearToUlaw(pcm16);
      }
      return encoded;
    }
  
    static base64ToArrayBuffer(base64: string): ArrayBuffer {
      const binaryStr = atob(base64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return bytes.buffer;
    }
  
    static arrayBufferToBase64(buffer: ArrayBuffer): string {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }

    static createRTPHeader(sequenceNumber: number, timestamp: number, ssrc: number): Uint8Array {
        const header = new Uint8Array(12);
        // Version (2), Padding (0), Extension (0), CSRC count (0)
        header[0] = 0x80;
        // Marker (0), Payload type (0 for PCMU)
        header[1] = 0x00;
        // Sequence number (16 bits)
        header[2] = (sequenceNumber >> 8) & 0xFF;
        header[3] = sequenceNumber & 0xFF;
        // Timestamp (32 bits)
        header[4] = (timestamp >> 24) & 0xFF;
        header[5] = (timestamp >> 16) & 0xFF;
        header[6] = (timestamp >> 8) & 0xFF;
        header[7] = timestamp & 0xFF;
        // SSRC (32 bits)
        header[8] = (ssrc >> 24) & 0xFF;
        header[9] = (ssrc >> 16) & 0xFF;
        header[10] = (ssrc >> 8) & 0xFF;
        header[11] = ssrc & 0xFF;
        return header;
    }

    static createRTPPacket(audioData: Float32Array, sequenceNumber: number, timestamp: number, ssrc: number): Uint8Array {
        const header = this.createRTPHeader(sequenceNumber, timestamp, ssrc);
        const encodedAudio = this.encode(audioData);
        
        // Create a buffer that includes both header and audio data
        const packet = new Uint8Array(header.length + encodedAudio.length);
        packet.set(header);
        packet.set(encodedAudio, header.length);
        
        return packet;
    }

    static decodeRTPPacket(rtpPacket: ArrayBuffer): Float32Array | null {
        try {
            const bytes = new Uint8Array(rtpPacket);
            
            // Check if this is a valid RTP packet
            if (bytes.length < 12) {
                // If not an RTP packet, try to decode directly
                return this.decode(rtpPacket);
            }
            
            // Check RTP version (should be 2)
            const version = (bytes[0] & 0xC0) >> 6;
            if (version !== 2) {
                // If not RTP version 2, try to decode directly
                return this.decode(rtpPacket);
            }
            
            // Skip RTP header (12 bytes)
            const headerLength = 12;
            const payload = bytes.slice(headerLength);
            
            // Decode the payload
            return this.decode(payload.buffer);
        } catch (error) {
            console.error('Error decoding RTP packet:', error);
            return null;
        }
    }
}
  