import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Root component that hosts the router outlet.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
})
export class App {}
