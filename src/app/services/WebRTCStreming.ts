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

  get message$(): Observable<any> {
    return this.messageSubject.asObservable();
  }

  connect(url: string): void {
    if (this.socket) {
      this.disconnect();
    }
    console.log(`Connecting to WebSocket: ${url}`);
    this.socket = new WebSocket(url);

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

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  isConnectedTo(currenturl: string): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN && this.socket.url === currenturl;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

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

  private handleMediaEvent(data: any): void {
   // console.log('Received media event:', data);
    const { track, payload } = data.media;
    if (track === 'inbound') {
      this.processInboundAudio(payload);
    }
  }

  private async processInboundAudio(payload: string): Promise<void> {
    if (!this.audioCtx || !this.remoteStreamDestination) {
      console.warn('Audio context or destination not initialized.');
      return;
    }

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    try {
      const arrayBuffer = OPUSUtils.base64ToArrayBuffer(payload);
      const pcmData = OPUSUtils.decode(arrayBuffer); // Ensure OPUSUtils.decode() returns Float32Array

      if (!(pcmData instanceof Float32Array)) {
        console.error('Decoded audio data is not a Float32Array.');
        return;
      }

      const audioBuffer = this.audioCtx.createBuffer(1, pcmData.length, VoiceConfig.intendedSampleRate);
      audioBuffer.copyToChannel(pcmData, 0);

      const source = this.audioCtx.createBufferSource();
      source.buffer = audioBuffer;

      const bandpassFilter = this.audioCtx.createBiquadFilter();
      bandpassFilter.type = 'bandpass';
      bandpassFilter.frequency.value = 1000;
      bandpassFilter.Q.value = 1;

      const compressor = this.audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -50;
      compressor.knee.value = 40;
      compressor.ratio.value = 12;
      compressor.attack.value = 0;
      compressor.release.value = 0.25;

      source.connect(bandpassFilter);
      bandpassFilter.connect(compressor);
      compressor.connect(this.remoteStreamDestination);

      source.start();
    } catch (error) {
      console.error('Error processing inbound audio:', error);
    }
  }
}
