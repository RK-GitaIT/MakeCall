import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class WebRTCStreming {
  private socket: WebSocket | null = null;
  private messageSubject = new Subject<any>();
  // Create an AudioContext and a MediaStreamDestination to build our remote stream.
  private audioCtx: AudioContext | null = null;
  private remoteStreamDestination: MediaStreamAudioDestinationNode | null = null;
  private remoteStream: MediaStream | null = null;

  // Expose an observable for incoming WebSocket messages.
  get message$(): Observable<any> {
    return this.messageSubject.asObservable();
  }

  // Connect to the WebSocket and initialize audio context/destination.
  connect(url: string): void {
    if (this.socket) {
      this.disconnect();
    }

    console.log(`Connecting to WebSocket: ${url}`);
    this.socket = new WebSocket(url);

    // Initialize AudioContext and create destination node.
    this.audioCtx = new AudioContext();
    this.remoteStreamDestination = this.audioCtx.createMediaStreamDestination();
    this.remoteStream = this.remoteStreamDestination.stream;

    this.socket.onopen = () => {
      console.log('WebSocket connected.');
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if(data.event === 'media') {
          this.handleMediaEvent(data);
          this.messageSubject.next(data);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.socket.onclose = (event) => {
      console.log(`WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason}`);
      this.socket = null;
    };
  }

  // Disconnect the WebSocket and close the AudioContext.
  disconnect(): void {
    if (this.socket) {
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        console.log('Disconnecting WebSocket...');
        this.socket.close(1000, 'Manual disconnect');
      }
      this.socket = null;
    } else {
      console.log('No active WebSocket connection to disconnect.');
    }

    if (this.audioCtx) {
      this.audioCtx.close().catch(err => console.error('Error closing AudioContext:', err));
      this.audioCtx = null;
      this.remoteStreamDestination = null;
      this.remoteStream = null;
    }
  }

  // Check if the WebSocket is connected.
  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  // Expose the remote MediaStream.
  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  // Send outbound data (for example, captured mic audio) via WebSocket.
  sendOutboundAudio(data: any): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(data));
      } catch (err) {
        console.error('Error sending outbound audio:', err);
      }
    } else {
      console.warn('WebSocket is not open. Cannot send outbound audio.');
    }
  }

  // Handle media events from the socket.
  private handleMediaEvent(data: any): void {
    console.log('Received media event:', data);
    const { track, payload } = data.media;
    if (track === 'inbound') {
      // Decode and play inbound PCMU audio.
      this.processInboundAudio(payload);
    }
    // Outbound handling can be added if required.
  }

  // Process inbound PCMU audio payload.
  private processInboundAudio(payload: string): void {
    if (!this.audioCtx || !this.remoteStreamDestination) {
      console.warn('Audio context or destination not initialized.');
      return;
    }
    // Convert base64 payload to ArrayBuffer.
    const arrayBuffer = this.base64ToArrayBuffer(payload);
    // Manually decode PCMU data.
    const pcmData = this.decodePCMU(arrayBuffer);
    const sampleRate = 8000; // Adjust this if needed.
    const audioBuffer = this.audioCtx.createBuffer(1, pcmData.length, sampleRate);
    audioBuffer.copyToChannel(pcmData, 0);
    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    // Connect to the destination so that the audio becomes part of remoteStream.
    source.connect(this.remoteStreamDestination);
    source.start();
  }

  // Helper to convert base64 string to ArrayBuffer.
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryStr = atob(base64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Custom PCMU (μ-law) decoding.
  private decodePCMU(buffer: ArrayBuffer): Float32Array {
    const uLawData = new Uint8Array(buffer);
    const pcmSamples = new Float32Array(uLawData.length);
    for (let i = 0; i < uLawData.length; i++) {
      pcmSamples[i] = this.ulawToLinear(uLawData[i]) / 32768;
    }
    return pcmSamples;
  }

  // Standard μ-law to linear conversion.
  private ulawToLinear(u_val: number): number {
    u_val = ~u_val & 0xFF;
    const t = (((u_val & 0x0F) << 3) + 0x84) << ((u_val >> 4) & 0x07);
    return (u_val & 0x80) ? (0x84 - t) : (t - 0x84);
  }
}
