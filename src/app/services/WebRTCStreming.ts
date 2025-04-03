import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { VoiceConfig } from './VoiceConfig';
import { Utils } from './Utils';

@Injectable({
  providedIn: 'root'
})
export class WebRTCStreming {
  private socket: WebSocket | null = null;
  private messageSubject = new Subject<any>();
  private audioCtx: AudioContext | null = null;
  private remoteStreamDestination: MediaStreamAudioDestinationNode | null = null;
  private remoteStream: MediaStream | null = null;
  private outboundSequenceNumber: number = 0;
  private inboundSequenceNumber: number = 0;
  private outboundTimestamp: number = 0;
  private inboundTimestamp: number = 0;
  private ssrc: number = Math.floor(Math.random() * 0xFFFFFFFF);
  private audioBuffer: Float32Array[] = [];
  private bufferSize: number = 160; // 20ms at 8kHz
  private sampleRate: number = 8000;
  private streamId: string = '';
  private isTalking: boolean = false;
  private lastInboundTimestamp: number = 0;

  get message$(): Observable<any> {
    return this.messageSubject.asObservable();
  }

  connect(url: string): void {
    if (this.socket) {
      this.disconnect();
    }
    console.log(`Connecting to WebSocket: ${url}`);
    this.socket = new WebSocket(url);
    this.streamId = this.generateStreamId();

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

  private generateStreamId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  sendOutboundAudio(data: any): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        const audioData = data.media.payload;
        if (audioData instanceof Float32Array) {
          this.audioBuffer.push(audioData);
          
          // Process buffer when we have enough samples
          if (this.audioBuffer.length * this.bufferSize >= 160) {
            const combinedBuffer = new Float32Array(this.audioBuffer.length * this.bufferSize);
            let offset = 0;
            for (const buffer of this.audioBuffer) {
              combinedBuffer.set(buffer, offset);
              offset += buffer.length;
            }
            
            // Create RTP packet with synchronized timestamp
            const rtpPacket = Utils.createRTPPacket(
              combinedBuffer,
              this.outboundSequenceNumber,
              this.lastInboundTimestamp + this.bufferSize, // Synchronize with inbound
              this.ssrc
            );
            
            // Format the data according to the required structure
            const packetData = {
              stream_id: this.streamId,
              event: "media",
              media: {
                timestamp: (this.lastInboundTimestamp + this.bufferSize).toString(),
                chunk: this.outboundSequenceNumber.toString(),
                payload: Utils.arrayBufferToBase64(rtpPacket.buffer),
                track: "outbound"
              },
              sequence_number: this.outboundSequenceNumber.toString()
            };
            
            this.socket.send(JSON.stringify(packetData));
            
            // Update outbound sequence number and timestamp
            this.outboundSequenceNumber = (this.outboundSequenceNumber + 1) & 0xFFFF;
            this.audioBuffer = [];
          }
        }
      } catch (err) {
        console.error('Error sending outbound audio:', err);
      }
    } else {
      console.warn('WebSocket is not open. Cannot send outbound audio.');
    }
  }

  private handleMediaEvent(data: any): void {
    const { track, payload, chunk, sequence_number, timestamp } = data.media;
    if (track === 'inbound') {
      try {
        // Update inbound sequence number and timestamp
        this.inboundSequenceNumber = parseInt(sequence_number) || 0;
        this.inboundTimestamp = parseInt(timestamp) || 0;
        this.lastInboundTimestamp = this.inboundTimestamp;
        
        // Process the audio data
        const arrayBuffer = Utils.base64ToArrayBuffer(payload);
        const pcmData = Utils.decodeRTPPacket(arrayBuffer);
        
        if (pcmData && pcmData.length > 0) {
          this.processInboundAudio(pcmData);
        } else {
          console.warn('No valid audio data received');
        }
      } catch (error) {
        console.error('Error processing inbound media:', error);
      }
    }
  }

  private async processInboundAudio(pcmData: Float32Array): Promise<void> {
    if (!this.audioCtx || !this.remoteStreamDestination) {
      console.warn('Audio context or destination not initialized.');
      return;
    }

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    try {
      const audioBuffer = this.audioCtx.createBuffer(1, pcmData.length, this.sampleRate);
      audioBuffer.copyToChannel(pcmData, 0);

      const source = this.audioCtx.createBufferSource();
      source.buffer = audioBuffer;

      // Audio processing chain
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
