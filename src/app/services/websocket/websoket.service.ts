import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private socket: WebSocket | null = null;
  private messageSubject = new Subject<any>();

  // Expose an observable to subscribe for incoming WebSocket messages
  get message$(): Observable<any> {
    return this.messageSubject.asObservable();
  }

  // Connect to the WebSocket using the provided URL
  connect(url: string): void {
    if (this.socket) {
      this.disconnect();
    }

    console.log(`Connecting to WebSocket: ${url}`);
    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      console.log('WebSocket connected.');
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.messageSubject.next(data);
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

  // Disconnect the WebSocket
  disconnect(): void {
    if (this.socket) {
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        console.log('Disconnecting WebSocket...');
        this.socket.close(1000, 'Manual disconnect');
      } else {
        console.log('WebSocket already disconnected or not open.');
      }
      this.socket = null;
    } else {
      console.log('No active WebSocket connection to disconnect.');
    }
  }

  // ✅ Check if WebSocket is connected
  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }
}
