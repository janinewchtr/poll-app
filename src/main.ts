import { bootstrapApplication } from '@angular/platform-browser';

import { appConfig } from './app/app.config';
import { App } from './app/app';

/**
 * Starts the Angular application.
 */
function startApplication(): void {
  bootstrapApplication(App, appConfig).catch(handleBootstrapError);
}

/**
 * Logs errors that happen while Angular starts.
 *
 * @param error - Error thrown during Angular bootstrap.
 */
function handleBootstrapError(error: unknown): void {
  console.error(error);
}

startApplication();
