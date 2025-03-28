import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DialpadComponent } from './components/dialpad/dialpad.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, DialpadComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'client';
  
}
