import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { WebsocketService } from '../websocket/websoket.service';
import { WebRTCStreming } from '../websocket/WebRTCStreming';
import { PCMUUtils } from '../PCMUUtils';

export interface CallStatus {
  status: string;
  type: 'info' | 'success' | 'error' | '';
  message?: string;
}

interface CurrentCallData {
  connection_id?: string;
  call_control_id: string;
  client_state: string;
  call_session_id: string;
  call_leg_id: string;
  command_id?: string;
}

@Injectable({
  providedIn: 'root'
})
export class TelnyxService {
  private readonly webhookUrl = 'https://gitait.com/telnyx/api/webhook';
  private readonly wsUrl = 'wss://gitait.com/telnyx/ws';
  private readonly wsUrl_S = 'wss://gitait.com/telnyx/ws-audio-stream';
  private readonly backendApi = 'https://api.telnyx.com/v2';

  private currentCallMessage = '';
  callStatus$ = new BehaviorSubject<CallStatus>({ status: '', type: '' });
  private currentCall: CurrentCallData | null = null;
  // Fallback queue for decoded audio.
  private audioQueue: AudioBuffer[] = [];
  private isPlaying = false;
  private audioCtx: AudioContext | null = null;

  constructor(
    private http: HttpClient,
    private websocketService: WebsocketService,
    private _webRTCStreming: WebRTCStreming
  ) {
    // Subscribe to control messages.
    this.websocketService.message$.subscribe((res: any) => this.handleWebSocketMessage(res));
    // Subscribe to streaming events.
    this._webRTCStreming.message$.subscribe((res: any) => this.handleStreamingSocket(res));
  }

  // Fetch call control profiles.
  callControlAppProfiles(): Observable<any> {
    return this.http.get(`${this.backendApi}/call_control_applications`);
  }

  // Fetch phone numbers for a connection.
  getProfilesAssociatedPhonenumbers(id: string): Observable<any> {
    return this.http.get(`${this.backendApi}/phone_numbers?filter[connection_id]=${id}`);
  }

  // Initiate an outbound call.
  async makeCall(destinationNumber: string, callerNumber: string, connectionId: string, message: string) {
    try {
      console.log(`Calling ${destinationNumber} from ${callerNumber} (Connection ID: ${connectionId})`);
      const profileDetails = await this.getProfilesAssociatedPhonenumbers(connectionId).toPromise();
      if (!profileDetails?.data) {
        throw new Error('Invalid profile details');
      }
      // Ensure control WebSocket is connected.
      if (!this.websocketService.isConnected()) {
        this.websocketService.connect(this.wsUrl);
      }
      this.currentCallMessage = message;
      const payload = {
        to: destinationNumber,
        from: callerNumber,
        from_display_name: "GitaIT",
        connection_id: connectionId,
        timeout_secs: 60,
        timeout_limit_secs: 60,
        webhook_url: this.webhookUrl,
        webhook_url_method: "POST",
        media_encryption: "disabled"
      };
      this.callStatus$.next({ status: 'Call Initiated', type: 'success' });
      const response: any = await this.http.post(`${this.backendApi}/calls`, payload).toPromise();
      if (response?.data?.call_control_id) {
        this.currentCall = {
          connection_id: connectionId,
          call_control_id: response.data.call_control_id,
          client_state: response.data.client_state || '',
          call_session_id: response.data.call_session_id || '',
          call_leg_id: response.data.call_leg_id || ''
        };
        console.log("Call Control ID:", response.data.call_control_id);
        sessionStorage.setItem('call_control_id', JSON.stringify(this.currentCall));
        return response.data;
      } else {
        throw new Error("Call control ID missing in response");
      }
    } catch (error: any) {
      this.handleCallError(error);
    }
  }

  private handleWebSocketMessage(res: any) {
    if (!res?.data) return;
    const { event_type, payload } = res.data;
    switch (event_type) {
      case 'call.initiated':
        this.callStatus$.next({ status: 'Call Initiated', type: 'info' });
        break;
      case 'call.answered':
        this.handleCallAnswered(payload);
        setTimeout(() => this.hangUp(payload.call_control_id), 120000);
        break;
      case 'call.hangup':
        this.callStatus$.next({ status: 'Call Ended', type: 'success' });
        this.endCall();
        break;
      case 'streaming.started':
        console.log("Streaming started for call:", payload.call_control_id);
        break;
      case 'streaming.stopped':
        console.log("Streaming stopped for call:", payload.call_control_id);
        break;
      case 'call.speak.ended':
        this.currentCallMessage = '';
        this.callStatus$.next({ status: 'Call Ended', type: 'error' });
        break;
      default:
        console.log("Unhandled event type:", event_type);
    }
  }

  private handleCallAnswered(payload: any) {
    this.callStatus$.next({ status: 'Call Answered', type: 'success' });
    // Start streaming WebSocket if not connected.
    if (!this._webRTCStreming.isConnected()) {
      this._webRTCStreming.connect(this.wsUrl_S);
    }
    this.currentCall = {
      call_control_id: payload.call_control_id,
      client_state: payload.client_state,
      call_session_id: payload.call_session_id,
      call_leg_id: payload.call_leg_id
    };
    this.streamingStart(payload.call_control_id, payload.client_state, payload.command_id);
    setTimeout(() => this.hangUp(payload.call_control_id), 120000);
  }

  async streamingStart(call_control_id: string, client_state: string, command_id: string): Promise<void> {
    try {
      // Streaming payload:
      // - stream_url: URL for media stream.
      // - stream_track: "both_tracks" for bidirectional audio.
      // - stream_bidirectional_mode: "rtp" to use RTP.
      // - stream_bidirectional_codec: "PCMU" for μ‑law encoding.
      // - stream_bidirectional_target_legs: "both" to apply on both call legs.
      // - stream_bidirectional_sampling_rate: "8000" Hz for PCMU.
      // - send_silence_when_idle: true to keep channel active.
      const payload = {
        stream_url: this.wsUrl_S,
        stream_track: "both_tracks",
        stream_bidirectional_mode: "rtp",
        stream_bidirectional_codec: "PCMU",
        stream_bidirectional_target_legs: "both",
        stream_bidirectional_sampling_rate: "8000",
        send_silence_when_idle: true,
      };
      const response: any = await this.http
        .post(`${this.backendApi}/calls/${call_control_id}/actions/streaming_start`, payload)
        .toPromise();
      console.log("Streaming started successfully:", response);
    } catch (error) {
      console.error("Error starting streaming:", error);
      this.handleCallError(error);
    }
  }

  // Handle media events from the streaming WebSocket.
  private handleStreamingSocket(res: any) {
    if (res.event === 'media') {
      const { track, payload } = res.media;
      if (track === 'inbound') {
        this.processInboundAudio(payload);
      }
    }
  }

  // Fallback: process inbound audio if not using MediaStream playback.
  private processInboundAudio(base64Data: string) {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    try {
      const pcmData = PCMUUtils.decodePCMU(PCMUUtils.base64ToArrayBuffer(base64Data));
      const audioBuffer = this.audioCtx.createBuffer(1, pcmData.length, 8000);
      audioBuffer.getChannelData(0).set(pcmData);
      this.audioQueue.push(audioBuffer);
      this.playAudioQueue();
    } catch (error) {
      console.error('Audio processing error:', error);
    }
  }

  private async playAudioQueue() {
    if (this.isPlaying || !this.audioCtx || this.audioQueue.length === 0) return;
    this.isPlaying = true;
    const audioBuffer = this.audioQueue.shift()!;
    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioCtx.destination);
    source.onended = () => {
      this.isPlaying = false;
      this.playAudioQueue();
    };
    source.start();
  }

  // Outbound microphone capture: encode mic audio to PCMU and send it.
  async startOutboundMic(): Promise<void> {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Use a dedicated AudioContext with sample rate 8000 Hz.
      const audioContext = new AudioContext({ sampleRate: 8000 });
      const source = audioContext.createMediaStreamSource(micStream);
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      source.connect(processor);
      processor.connect(audioContext.destination); // Optional: for local monitoring.
      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        const encoded = PCMUUtils.encodePCMU(inputData);
        const base64Payload = PCMUUtils.arrayBufferToBase64(encoded.buffer);
        // Send outbound audio via the streaming WebSocket.
        this._webRTCStreming.sendOutboundAudio({
          event: "media",
          media: {
            track: "outbound",
            payload: base64Payload
          }
        });
      };
      console.log('Outbound microphone capture started.');
    } catch (err) {
      console.error('Error capturing outbound mic audio:', err);
    }
  }

  async hangUp(call_control_id: string): Promise<void> {
    try {
      await this.http.post(`${this.backendApi}/calls/${call_control_id}/actions/hangup`, {}).toPromise();
      this.cleanupAudio();
      this.callStatus$.next({ status: 'Call Ended', type: 'success' });
    } catch (error) {
      this.handleCallError(error);
    }
  }

  // Cleanup audio: close AudioContext and reset state.
  private cleanupAudio() {
    if (this.audioCtx) {
      this.audioCtx.close().then(() => {
        this.audioCtx = null;
        this.audioQueue = [];
        this.isPlaying = false;
      });
    }
  }

  private handleCallError(error: any) {
    console.error('Error:', error);
    this.cleanupAudio();
    this.callStatus$.next({
      status: 'Error',
      type: 'error',
      message: error.message || 'Unknown error occurred'
    });
    this.playBeepSound();
    this.websocketService.disconnect();
  }

  private playBeepSound() {
    const beep = new Audio('assets/beep.mp3');
    beep.play().catch(err => console.error('Error playing beep sound:', err));
  }

  endCall() {
    this.callStatus$.next({ status: 'Call Ended', type: 'success' });
    this.websocketService.disconnect();
    console.log("Call has ended.");
  }

  getCurrentCall(): CurrentCallData | null {
    const stored = sessionStorage.getItem('call_control_id');
    if (stored) {
      this.currentCall = JSON.parse(stored);
    }
    return this.currentCall;
  }

  // Setup the remote stream on an audio element for inbound audio.
  setupAudioStream(audioElement: HTMLAudioElement) {
    const remoteStream = this._webRTCStreming.getRemoteStream && this._webRTCStreming.getRemoteStream();
    if (remoteStream) {
      audioElement.srcObject = remoteStream;
      audioElement.play().catch(err => console.error('Error playing audio stream:', err));
    } else {
      console.warn('No remote stream available for audio streaming.');
    }
  }

  // Start microphone capture for local monitoring.
  async startMicCapture(): Promise<MediaStream> {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return micStream;
    } catch (err) {
      console.error('Error capturing microphone:', err);
      throw err;
    }
  }
}
