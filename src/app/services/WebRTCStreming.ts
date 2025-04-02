import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { PCMUUtils } from './PCMUUtils';

@Injectable({
  providedIn: 'root'
})
export class WebRTCStreming {
  private socket: WebSocket | null = null;
  private messageSubject = new Subject<any>();
  // AudioContext and MediaStreamDestination for inbound audio.
  private audioCtx: AudioContext | null = null;
  private remoteStreamDestination: MediaStreamAudioDestinationNode | null = null;
  private remoteStream: MediaStream | null = null;

  // Expose observable messages.
  get message$(): Observable<any> {
    return this.messageSubject.asObservable();
  }

  // Connect to the streaming WebSocket and initialize audio.
  connect(url: string): void {
    if (this.socket) {
      this.disconnect();
    }
    console.log(`Connecting to WebSocket: ${url}`);
    this.socket = new WebSocket(url);

    // Initialize AudioContext and destination.
    this.audioCtx = new AudioContext();
    this.remoteStreamDestination = this.audioCtx.createMediaStreamDestination();
    this.remoteStream = this.remoteStreamDestination.stream;

    this.socket.onopen = () => {
      console.log('WebSocket connected.');
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'media') {
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

  // Disconnect and close audio.
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

  // Check if connected.
  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  // Get the remote MediaStream.
  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  // Send outbound audio or data via WebSocket.
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

  // Handle incoming media events.
  private handleMediaEvent(data: any): void {
    console.log('Received media event:', data);
    const { track, payload } = data.media;
    if (track === 'inbound') {
      this.processInboundAudio(payload);
    }
  }

  // Process inbound PCMU audio payload.
  private processInboundAudio(payload: string): void {
    if (!this.audioCtx || !this.remoteStreamDestination) {
      console.warn('Audio context or destination not initialized.');
      return;
    }
    const arrayBuffer = PCMUUtils.base64ToArrayBuffer(payload);
    const pcmData = PCMUUtils.decodePCMU(arrayBuffer);
    const sampleRate = 8500; // Standard for PCMU.
    const audioBuffer = this.audioCtx.createBuffer(1, pcmData.length, sampleRate);
    audioBuffer.copyToChannel(pcmData, 0);
    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    // Connect to destination so it appears in the remote stream.
    source.connect(this.remoteStreamDestination);
    source.start();
  }
}
