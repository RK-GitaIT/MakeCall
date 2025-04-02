export class PCMUUtils {
    // μ-law decoding: standard ITU-T G.711 conversion.
    static ulawToLinear(u_val: number): number {
      // Complement to get the original value.
      u_val = ~u_val & 0xFF;
      const sign = (u_val & 0x80) ? -1 : 1;
      const exponent = (u_val >> 4) & 0x07;
      const mantissa = u_val & 0x0F;
      // ITU-T G.711 formula.
      const sample = (((mantissa << 1) + 33) << exponent) - 33;
      return sign * sample;
    }
  
    // Decode a PCMU (μ-law) encoded ArrayBuffer into normalized Float32Array samples.
    static decodePCMU(buffer: ArrayBuffer): Float32Array {
      const uLawData = new Uint8Array(buffer);
      const pcmSamples = new Float32Array(uLawData.length);
      for (let i = 0; i < uLawData.length; i++) {
        pcmSamples[i] = this.ulawToLinear(uLawData[i]) / 32768;
      }
      return pcmSamples;
    }
  
    // μ-law encoding: convert a 16-bit PCM sample to μ-law.
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
  
    // Encode normalized PCM (Float32Array with values between -1 and 1) to PCMU Uint8Array.
    static encodePCMU(pcm: Float32Array): Uint8Array {
      const encoded = new Uint8Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) {
        const sample = Math.max(-1, Math.min(1, pcm[i])); // Clamp.
        // Convert to 16-bit PCM.
        const pcm16 = sample < 0 ? sample * 32768 : sample * 32767;
        encoded[i] = this.linearToUlaw(pcm16);
      }
      return encoded;
    }
  
    // Convert a base64 string to an ArrayBuffer.
    static base64ToArrayBuffer(base64: string): ArrayBuffer {
      const binaryStr = atob(base64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return bytes.buffer;
    }
  
    // Convert an ArrayBuffer to a base64 string.
    static arrayBufferToBase64(buffer: ArrayBuffer): string {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
  }
  