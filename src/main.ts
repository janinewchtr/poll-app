import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

/**
 * Starts the Angular application with the root component and app configuration.
 */
bootstrapApplication(App, appConfig).catch((err) => console.error(err));
