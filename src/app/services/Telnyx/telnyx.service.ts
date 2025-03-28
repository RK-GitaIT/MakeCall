import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { WebsocketService } from '../websocket/websoket.service';

export interface CallStatus {
  status: string;
  type: 'info' | 'success' | 'error' | '';
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
  // Replace these with your production endpoints as needed.
  private readonly webhookUrl = 'https://gitait.com/telnyx/api/webhook';
  private readonly wsUrl = 'wss://gitait.com/telnyx/ws';
  private readonly backendApi = 'https://api.telnyx.com/v2';

  // Storage for TTS text (if implemented) or any message you need later.
  private currentCallMessage = '';

  callStatus$ = new BehaviorSubject<CallStatus>({ status: '', type: '' });
  private currentCall: CurrentCallData | null = null;

  constructor(
    private http: HttpClient,
    private websocketService: WebsocketService
  ) {
    // Subscribe to incoming WebSocket messages.
    this.websocketService.message$.subscribe((res: any) => this.handleWebSocketMessage(res));
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
        stream_url: this.wsUrl,  // This is used for audio streaming.
        stream_track: "both_tracks",
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

  // Process incoming WebSocket/webhook events.
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
        // If you have a TTS message, play it; otherwise, start streaming.
        if (this.currentCallMessage.trim() !== '') {
          // Optionally, call a playTTS method here.
          this.currentCallMessage = '';
          // Auto hangup after 2 minutes.
          setTimeout(() => {
            this.hangUp(payload.call_control_id, payload.client_state, payload.command_id);
          }, 120000);
        } else {
          this.streamingStart(payload.call_control_id, payload.client_state, payload.command_id);
        }
        break;
      case 'call.hangup':
        this.callStatus$.next({ status: 'Call Ended', type: 'success' });
        this.endCall();
        break;
      case 'call.machine.detection.ended':
        console.log(`Machine Detection Result: ${payload.result}`);
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

  // Send a hangup command.
  async hangUp(call_control_id: string, client_state: string, command_id: string): Promise<void> {
    try {
      const payload = { client_state, command_id: command_id ?? '' };
      const response: any = await this.http.post(`${this.backendApi}/calls/${call_control_id}/actions/hangup`, payload).toPromise();
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
        stream_url: this.wsUrl,
        stream_track: "both_tracks",
        client_state,
        command_id,
        enable_dialogflow: false,
        dialogflow_config: {
          analyze_sentiment: false,
          partial_automated_agent_reply: false
        }
      };
      const response: any = await this.http.post(`${this.backendApi}/calls/${call_control_id}/actions/streaming_start`, payload).toPromise();
      console.log("Streaming started successfully:", response);
    } catch (error) {
      console.error("Error starting streaming:", error);
      this.handleCallError(error);
    }
  }

  // Set up inbound audio playback from the streaming WebSocket.
  setupAudioStream(audioElement: HTMLAudioElement): void {
    console.log('Setting up audio stream with element:', audioElement);
    const mediaSource = new MediaSource();
    audioElement.src = URL.createObjectURL(mediaSource);
  
    // Use a MIME type widely supported in modern browsers.
    const mimeCodec = 'audio/webm; codecs="opus"';
    if (!MediaSource.isTypeSupported(mimeCodec)) {
      console.error(`Unsupported MIME type or codec: ${mimeCodec}`);
      return;
    }
  
    mediaSource.addEventListener('sourceopen', () => {
      const sourceBuffer = mediaSource.addSourceBuffer(mimeCodec);
      console.log('MediaSource opened and SourceBuffer added with MIME type:', mimeCodec);
      const audioWs = new WebSocket(this.wsUrl);
      audioWs.binaryType = 'arraybuffer';
      const queue: ArrayBuffer[] = [];
  
      sourceBuffer.addEventListener('updateend', () => {
        if (queue.length > 0 && !sourceBuffer.updating) {
          const chunk = queue.shift();
          if (chunk) {
            try {
              sourceBuffer.appendBuffer(chunk);
            } catch (err) {
              console.error("Error appending queued audio data", err);
            }
          }
        }
      });
  
      audioWs.onmessage = (event: MessageEvent) => {
        // If data is text, try to parse as JSON to check if it is a control event.
        if (typeof event.data === 'string') {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed?.data?.event_type) {
              console.log("Received control event:", parsed.data.event_type, "- ignoring for audio streaming.");
              return;
            }
          } catch (e) {
            console.warn("Received text data that is not valid JSON. Ignoring.", e);
            return;
          }
        }
  
        const processBuffer = (buffer: ArrayBuffer) => {
          if (sourceBuffer.updating || queue.length > 0) {
            queue.push(buffer);
          } else {
            try {
              sourceBuffer.appendBuffer(buffer);
            } catch (err) {
              console.error("Error appending audio data", err);
            }
          }
        };
  
        if (event.data instanceof ArrayBuffer) {
          processBuffer(event.data);
        } else if (event.data instanceof Blob) {
          event.data.arrayBuffer()
            .then((buffer: ArrayBuffer) => processBuffer(buffer))
            .catch(err => console.error("Error converting Blob to ArrayBuffer", err));
        } else {
          console.log("Unsupported audio data type:", event.data);
        }
      };
  
      audioWs.onerror = (err) => {
        console.error('Error in audio WebSocket:', err);
        if (mediaSource.readyState === 'open') {
          mediaSource.endOfStream('network');
        }
      };
  
      audioWs.onclose = () => {
        console.log('Audio WebSocket connection closed.');
        if (mediaSource.readyState === 'open') {
          mediaSource.endOfStream();
        }
      };
    });
  
    audioElement.onloadedmetadata = () => {
      // Play audio after metadata is loaded (ensure this is triggered by user interaction).
      audioElement.play().catch(err => console.error('Error starting audio playback:', err));
    };
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
