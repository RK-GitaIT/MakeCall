import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { WebsocketService } from '../websocket/websoket.service';
import { WebRTCStreming } from '../websocket/WebRTCStreming';

export interface CallStatus {
  status: string;
  type: 'info' | 'success' | 'error' | '';
  message?: string; // Optional message property
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

  // Storage for TTS text or any message you need later.
  private currentCallMessage = '';

  callStatus$ = new BehaviorSubject<CallStatus>({ status: '', type: '' });
  private currentCall: CurrentCallData | null = null;

  // AudioContext for playback.
  private audioCtx: AudioContext | null = null;

  constructor(
    private http: HttpClient,
    private websocketService: WebsocketService,
    private _webRTCStreming: WebRTCStreming,
  ) {
    // Subscribe to incoming WebSocket messages.
    this.websocketService.message$.subscribe((res: any) => this.handleWebSocketMessage(res));
    this._webRTCStreming.message$.subscribe((res: any) => this.handelStemingSocket(res));
  }

  // Fetch call control profiles.
  callControlAppProfiles(): Observable<any> {
    return this.http.get(`${this.backendApi}/call_control_applications`);
  }

  // Fetch phone numbers for a given connection.
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
      // Ensure WebSocket connection is active.
      if (!this.websocketService.isConnected()) {
        this.websocketService.connect(this.wsUrl);
      }

      // Save any TTS or additional message.
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
        // stream_url: this.wsUrl,  // Used for media streaming.
        // stream_track: "both_tracks",
        // stream_bidirectional_mode: "rtp",
        // stream_bidirectional_codec: "PCMU",
        // stream_bidirectional_target_legs: "both",
        // stream_bidirectional_sampling_rate: "16000",
        // send_silence_when_idle: true,
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
    console.log("WebSocket Message:", res);
    if (!res?.data) {
      return;
    }
    const { event_type, payload } = res.data;
    console.log(`WebSocket Event: ${event_type}`);
  
    switch (event_type) {
      case 'call.initiated':
        this.callStatus$.next({ status: 'Call Initiated', type: 'info' });
        break;
      case 'call.answered':
        this.callStatus$.next({ status: 'Call Answered', type: 'success' });
        setTimeout(() => {
          this.hangUp(payload.call_control_id);
        }, 120000); 
        if (!this._webRTCStreming.isConnected()) {
          this._webRTCStreming.connect(this.wsUrl_S);
        }
        this.streamingStart(payload.call_control_id, payload.client_state, payload.command_id);
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

  private handelStemingSocket(res: any) {
      console.log("WebRTC Streaming Message:", res);
        // Use our custom method to process base64 RTP messages.
        this.startAudioStream(res.payload.stream_url);
  }
  /**
   * Updated startAudioStream:
   * Opens a WebSocket connection to receive JSON payloads that wrap a base64-encoded RTP payload.
   * The RTP payload is assumed to be PCMU (u-law). This function decodes the payload,
   * converts it to PCM samples, and plays it via the Web Audio API.
   */
  private startAudioStream(streamUrl: string) {
    console.log('Starting audio stream via WebSocket with URL:', streamUrl);
  
    // Initialize AudioContext if not already created.
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    const audioCtx = this.audioCtx;
  
    // Open a WebSocket to receive media streaming messages.
    const mediaSocket = new WebSocket(streamUrl);
    mediaSocket.onopen = () => {
      console.log('Media WebSocket connected.');
    };
  
    mediaSocket.onerror = (err) => {
      console.error('Media WebSocket error:', err);
      this.callStatus$.next({ status: 'Streaming Error', type: 'error', message: 'Media socket error' });
    };
  
    mediaSocket.onmessage = (event: MessageEvent) => {
      // Expect messages as JSON containing a base64-encoded WAV payload.
      try {
        const msg = JSON.parse(event.data);
        if (msg.payload && msg.payload.rtp_payload) {
          const base64Data = msg.payload.rtp_payload;
          // Decode the base64 string into binary data.
          const binaryStr = atob(base64Data);
          const buffer = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            buffer[i] = binaryStr.charCodeAt(i);
          }
          // Decode the WAV data using AudioContext.
          audioCtx.decodeAudioData(buffer.buffer)
            .then((decodedData) => {
              const source = audioCtx.createBufferSource();
              source.buffer = decodedData;
              source.connect(audioCtx.destination);
              source.start();
            })
            .catch((err) => {
              console.error('Error decoding WAV data:', err);
            });
        } else {
          console.warn("Received message without rtp_payload, ignoring.");
        }
      } catch (err) {
        console.error("Error processing media message:", err);
      }
    };
  }  

  /**
   * Decodes PCMU (u-law) data to PCM float samples.
   * @param buffer An ArrayBuffer containing PCMU audio data.
   * @returns A Float32Array of linear PCM samples.
   */
  private decodePCMU(buffer: ArrayBuffer): Float32Array {
    const uLawData = new Uint8Array(buffer);
    const pcmSamples = new Float32Array(uLawData.length);
    for (let i = 0; i < uLawData.length; i++) {
      pcmSamples[i] = this.ulawToLinear(uLawData[i]) / 32768;
    }
    return pcmSamples;
  }

  /**
   * Converts an 8-bit u-law sample to linear PCM.
   * This implementation follows the standard u-law conversion.
   * @param u_val An 8-bit unsigned integer sample.
   * @returns A linear PCM sample.
   */
  private ulawToLinear(u_val: number): number {
    // Invert all bits.
    u_val = ~u_val & 0xFF;
    const sign = (u_val & 0x80) ? -1 : 1;
    const exponent = (u_val >> 4) & 0x07;
    const mantissa = u_val & 0x0F;
    const magnitude = ((mantissa << 1) + 33) << exponent;
    return sign * (magnitude - 33);
  }

  // Send a hangup command.
  async hangUp(call_control_id: string): Promise<void> {
    try {
      const response: any = await this.http.post(`${this.backendApi}/calls/${call_control_id}/actions/hangup`, {}).toPromise();
      console.log("Call hung up successfully:", response);
    } catch (error) {
      console.error("Error hanging up call:", error);
      this.handleCallError(error);
    }
  }

  // Send a streaming start command.
  async streamingStart(call_control_id: string, client_state: string, command_id: string): Promise<void> {
    try {
      const payload = {
        stream_url: this.wsUrl_S,
        stream_track: "both_tracks",
        stream_bidirectional_mode: "rtp",
        stream_bidirectional_codec: "PCMU",
        stream_bidirectional_target_legs: "both",
        stream_bidirectional_sampling_rate: "16000",
        send_silence_when_idle: true,
      };
      const response: any = await this.http.post(`${this.backendApi}/calls/${call_control_id}/actions/streaming_start`, payload).toPromise();
      console.log("Streaming started successfully:", response);
    } catch (error) {
      console.error("Error starting streaming:", error);
      this.handleCallError(error);
    }
  }

  // Set up inbound audio playback using MediaSource (if needed).
  setupAudioStream(audioElement: HTMLAudioElement): void {
    // Implementation omitted for brevity.
  }
  
  // Start capturing microphone input.
  async startMicCapture(): Promise<MediaStream | null> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      console.log("Microphone capture started.");
      return stream;
    } catch (error) {
      console.error("Error accessing microphone:", error);
      return null;
    }
  }
  
  // Handle errors: log error, play beep sound, update status, disconnect WebSocket.
  private handleCallError(error: any) {
    console.error('Call Failed:', error.message || error);
    this.playBeepSound();
    this.callStatus$.next({ status: 'Call Failed', type: 'error' });
    this.websocketService.disconnect();
  }
  
  // Play an error beep.
  private playBeepSound() {
    const beep = new Audio('assets/beep.mp3');
    beep.play().catch(err => console.error('Error playing beep sound:', err));
  }
  
  // End the call.
  endCall() {
    this.callStatus$.next({ status: 'Call Ended', type: 'success' });
    this.websocketService.disconnect();
    console.log("Call has ended.");
  }
  
  // Retrieve current call data from session storage.
  getCurrentCall(): CurrentCallData | null {
    const stored = sessionStorage.getItem('call_control_id');
    if (stored) {
      this.currentCall = JSON.parse(stored);
    }
    return this.currentCall;
  }
}
