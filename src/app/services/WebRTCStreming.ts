import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { VoiceConfig } from './VoiceConfig';
import { OPUSUtils } from './OPUSUtils';

@Injectable({
  providedIn: 'root'
})
export class WebRTCStreming {
  private socket: WebSocket | null = null;
  private messageSubject = new Subject<any>();
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

    // Initialize AudioContext with our configured sample rate.
    this.audioCtx = new AudioContext({ sampleRate: VoiceConfig.audioContextSampleRate });
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

  // Disconnect and clean up.
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

  // Return the remote MediaStream.
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

  // In WebRTCStreming (inbound audio processing)
private async processInboundAudio(payload: string): Promise<void> {
  if (!this.audioCtx || !this.remoteStreamDestination) {
    console.warn('Audio context or destination not initialized.');
    return;
  }
  // Ensure the AudioContext is active.
  if (this.audioCtx.state === 'suspended') {
    await this.audioCtx.resume();
  }
  // Decode the base64 payload.
  const arrayBuffer = OPUSUtils.base64ToArrayBuffer(payload);
  const pcmData = OPUSUtils.decode(arrayBuffer);
  // Create an AudioBuffer using the intended sample rate.
  const audioBuffer = this.audioCtx.createBuffer(1, pcmData.length, VoiceConfig.intendedSampleRate);
  audioBuffer.copyToChannel(pcmData, 0);

  const source = this.audioCtx.createBufferSource();
  source.buffer = audioBuffer;

  // Create a bandpass filter node to pass frequencies typical for voice.
  const bandpassFilter = this.audioCtx.createBiquadFilter();
  bandpassFilter.type = 'bandpass';
  bandpassFilter.frequency.value = 1000; // center frequency (adjust as needed)
  bandpassFilter.Q.value = 1; // quality factor (adjust for bandwidth)

  // Optionally, add a dynamics compressor to further reduce background noise.
  const compressor = this.audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -50; // in dB (adjust as needed)
  compressor.knee.value = 40;
  compressor.ratio.value = 12;
  compressor.attack.value = 0;
  compressor.release.value = 0.25;

  // Connect nodes: source -> filter -> compressor -> remote stream destination.
  source.connect(bandpassFilter);
  bandpassFilter.connect(compressor);
  compressor.connect(this.remoteStreamDestination);

  source.start();
}

}
