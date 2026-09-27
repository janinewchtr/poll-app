import { Injectable } from '@angular/core';

const PARTICIPANT_STORAGE_KEY = 'poll-app-participant-id';

/**
 * Manages the anonymous participant id used for vote submissions.
 */
@Injectable({
  providedIn: 'root',
})
export class ParticipantService {
  /**
   * Returns a stable browser-local participant id or creates one for first-time visitors.
   */
  getParticipantId(): string {
    const existingId = localStorage.getItem(PARTICIPANT_STORAGE_KEY);

    if (existingId) {
      return existingId;
    }

    const participantId = crypto.randomUUID();
    localStorage.setItem(PARTICIPANT_STORAGE_KEY, participantId);

    return participantId;
  }
}
