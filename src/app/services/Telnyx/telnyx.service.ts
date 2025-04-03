import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { WebsocketService } from '../websocket/websoket.service';
import { WebRTCStreming } from '../WebRTCStreming';
import { VoiceConfig } from '../VoiceConfig';
import { OPUSUtils } from '../OPUSUtils';

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
      if (!this._webRTCStreming.isConnectedTo(this.wsUrl_S)) {
        this._webRTCStreming.connect(this.wsUrl_S);
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
        media_encryption: "disabled",
        stream_url: this.wsUrl_S,  
        stream_track: "both_tracks",
        stream_bidirectional_mode: "rtp",
        stream_bidirectional_codec: "OPUS",
        stream_bidirectional_target_legs: "both",
        stream_bidirectional_sampling_rate: VoiceConfig.outboundMic.sampleRate,
        send_silence_when_idle: true,
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
    this.startCallRecording(payload.call_control_id);
    setTimeout(() => this.hangUp(payload.call_control_id), 120000);
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
      const pcmData = OPUSUtils.decode(OPUSUtils.base64ToArrayBuffer(base64Data));
      const audioBuffer = this.audioCtx.createBuffer(1, pcmData.length, 8500);
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

  async startOutboundMic(): Promise<void> {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: VoiceConfig.outboundMic.sampleRate,
          noiseSuppression: VoiceConfig.outboundMic.noiseSuppression,
          echoCancellation: VoiceConfig.outboundMic.echoCancellation,
          autoGainControl: VoiceConfig.outboundMic.autoGainControl
        }
      });
      // Use a dedicated AudioContext for outbound audio.
      const audioContext = new AudioContext({ sampleRate: VoiceConfig.outboundMic.sampleRate });
      const source = audioContext.createMediaStreamSource(micStream);
      const processor = audioContext.createScriptProcessor(VoiceConfig.outboundMic.bufferSize, 1, 1);
      source.connect(processor);
      processor.connect(audioContext.destination); // Optional: local monitoring.

      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        // Normalize the audio to avoid distortion.
      //  const normalizedData = this.normalizeAudio(inputData);
       // const encoded = OPUSUtils.encode(normalizedData);
       // const base64Payload = OPUSUtils.arrayBufferToBase64(encoded.buffer);
        // Send outbound audio via the streaming WebSocket.
        this._webRTCStreming.sendOutboundAudio({
          event: "media",
          media: {
            track: "outbound",
            payload: inputData.buffer, // Use the raw OPUS data directly.
           // payload: base64Payload
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
      this.websocketService.disconnect();
      this._webRTCStreming.disconnect();
      this.callStatus$.next({ status: 'Call Ended', type: 'success' });
    } catch (error) {
      this.handleCallError(error);
    }
  }

  private normalizeAudio(input: Float32Array): Float32Array {
    const output = new Float32Array(input.length);
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      sum += input[i] * input[i];
    }
    const rms = Math.sqrt(sum / input.length);
    const gain = rms > 0 ? 0.8 / rms : 1;
    for (let i = 0; i < input.length; i++) {
      output[i] = input[i] * gain;
    }
    return output;
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
      console.log('Microphone capture started successfully.', micStream);
      return micStream;
    } catch (err) {
      console.error('Error capturing microphone:', err);
      throw err;
    }
  }

  async startCallRecording(callControlId: string) {
    const requestBody = {
      format: "mp3",
      channels: "dual",
      play_beep: true,
      max_length: 0,
      timeout_secs: 0
    };

    try {
      // Use firstValueFrom to convert the observable to a promise.
      const response = await firstValueFrom(
        this.http.post(`${this.backendApi}/calls/${callControlId}/actions/record_start`, requestBody)
      );
      console.log("Recording started successfully:", response);
    } catch (error) {
      console.error("Error starting call recording:", error);
      throw error;
    }
  }
}
