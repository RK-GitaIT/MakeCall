import { Component, OnDestroy, OnInit } from '@angular/core';
import { TelnyxService } from '../../services/Telnyx/telnyx.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-dialpad',
  imports: [CommonModule, FormsModule],
  templateUrl: './dialpad.component.html',
  styleUrls: ['./dialpad.component.css']
})
export class DialpadComponent implements OnInit, OnDestroy {
  to: string = '+';
  message: string = '';
  from: string = '';
  profiles: any[] = [];
  phoneNumbers: any[] = [];
  isCallStatus: boolean = false;
  callDuration: string = '00:00';
  currentCallControlId: string | null = null;
  timerInterval: any;

  selectedProfile = {
    id: '',
    profileName: '',
    username: '',
    password: ''
  };

  private callBeepSound = new Audio('assets/callbeep.mp3');
  private errorBeepSound = new Audio('assets/beep.wav');

  constructor(private telnyxService: TelnyxService) {}

  async ngOnInit() {
    this.telnyxService.callControlAppProfiles().subscribe(
      (data: any) => {
        this.profiles = data.data;
        console.log('Call control profiles:', this.profiles);
        if (this.profiles.length > 0) {
          this.selectedProfile.id = this.profiles[0].id;
          this.onProfileChange();
        }
      },
      (error: any) => {
        console.error('Error fetching profiles', error);
      }
    );
    clearInterval(this.timerInterval);
  }

  ngOnDestroy() {
    this.closeModal();
    clearInterval(this.timerInterval);
  }

  async onProfileChange() {
    if (!this.selectedProfile.id) return;
    try {
      const selected = this.profiles.find(p => p.id === this.selectedProfile.id);
      if (selected) {
        this.selectedProfile.profileName = selected.connection_name;
        this.selectedProfile.username = selected.user_name;
        this.selectedProfile.password = selected.password;
        const response: any = await this.telnyxService.getProfilesAssociatedPhonenumbers(this.selectedProfile.id).toPromise();
        this.phoneNumbers = response?.data || [];
        this.from = this.phoneNumbers.length > 0 ? this.phoneNumbers[0].phone_number : '';
      }
    } catch (error) {
      console.error('Error fetching associated phone numbers', error);
    }
  }

  showToast(message: string, type: 'info' | 'success' | 'error' | '') {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-4 right-4 p-3 rounded-lg shadow-lg text-white ${
      type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500'
    }`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => document.body.removeChild(toast), 3000);
  }

  async makeOutboundCall() {
    if (!this.from || !this.to) {
      alert('Please fill all required fields.');
      return;
    }
    try {
      this.isCallStatus = true;
      const audioElement = document.getElementById('streaming_audio') as HTMLAudioElement;
      if (audioElement) {
        this.telnyxService.setupAudioStream(audioElement);
      }
  
      // Await mic start before making the call
      await this.startMic();  
  
      const response = await this.telnyxService.makeCall(
        this.to,
        this.from,
        this.selectedProfile.id,
        this.message
      );
  
      if (response?.call_control_id) {
        this.currentCallControlId = response.call_control_id;
        this.startCallTimer();
      }
    } catch (error) {
      this.hangup();
      this.showToast('Error initiating call', 'error');
      console.error('Error initiating call:', error);
    }
  }
  

  validateKey(event: KeyboardEvent) {
    const allowedChars = /^[\d\+]+$/;
    if (!allowedChars.test(event.key)) {
      event.preventDefault();
    }
  }

  closeModal() {
    this.isCallStatus = false;
  }

  startCallTimer() {
    let seconds = 0;
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      seconds++;
      const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
      const secs = (seconds % 60).toString().padStart(2, '0');
      this.callDuration = `${mins}:${secs}`;
    }, 1000);
  }

  hangup() {
    const currentCall = this.telnyxService.getCurrentCall();
    if (currentCall) {
      this.telnyxService.hangUp(currentCall.call_control_id);
    } else {
      console.warn('Missing call control information for hangup.');
    }
  
    // Stop the microphone stream
    this.stopMic();
  
    this.isCallStatus = false;
    clearInterval(this.timerInterval);
    this.callDuration = '00:00';
    this.errorBeepSound.currentTime = 0;
    console.log('Call ended');
    this.closeModal();
  }
  

  async startMic() {
    try {
      const micStream = await this.telnyxService.startMicCapture();
      if (micStream) {
        const micAudio = document.getElementById('mic_audio') as HTMLAudioElement;
        if (micAudio) {
          micAudio.srcObject = micStream;
          micAudio.controls = true;
        }
      }
    } catch (err) {
      console.error('Error starting mic:', err);
    }
  }

  stopMic() {
    const micAudio = document.getElementById('mic_audio') as HTMLAudioElement;
    if (micAudio && micAudio.srcObject) {
      const stream = micAudio.srcObject as MediaStream;
      const tracks = stream.getTracks();
      tracks.forEach(track => track.stop()); // Stop all tracks
      micAudio.srcObject = null; // Release stream
    }
  }
  
}
