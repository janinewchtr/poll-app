import {
  areAllQuestionsAnswered,
  calculateVotePercentage,
  createVoteAnswers,
  hasSelectedAnswers,
  hasStoredVote,
  normalizeSurveyQuestions,
  storeCompletedSurvey,
  toggleSelectedOption,
  SurveyWithRawQuestions,
} from './survey-detail.helpers';

import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import {
  Survey,
  SurveyQuestion,
  SurveyVote,
  VoteAnswer,
} from '../../../../core/models/survey.model';
import { ParticipantService } from '../../../../core/services/participant.service';
import { SupabaseService } from '../../../../core/services/supabase.service';
import { CreateSurveyModal } from '../../../create-survey/components/create-survey-modal/create-survey-modal';

type VotesSubscription = ReturnType<SupabaseService['subscribeToSurveyVotes']>;

/**
 * Shows one survey, handles vote submission and displays realtime result updates.
 */
@Component({
  selector: 'app-survey-detail',
  standalone: true,
  imports: [RouterLink, CreateSurveyModal],
  templateUrl: './survey-detail.html',
  styleUrl: './survey-detail.scss',
})
export class SurveyDetail implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly participantService = inject(ParticipantService);
  private readonly supabaseService = inject(SupabaseService);

  private votesSubscription: VotesSubscription | null = null;

  readonly survey = signal<Survey | null>(null);
  readonly votes = signal<SurveyVote[]>([]);

  readonly isLoading = signal<boolean>(true);
  readonly isSubmitting = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly selectedAnswers = signal<Record<string, string[]>>({});
  readonly isCreateSurveyModalOpen = signal<boolean>(false);
  readonly hasCompletedSurvey = signal<boolean>(false);
  readonly isResultsPanelOpen = signal<boolean>(true);

  readonly questions = computed<SurveyQuestion[]>(() => {
    return this.survey()?.questions ?? [];
  });

  readonly hasVotes = computed<boolean>(() => {
    return this.votes().length > 0;
  });

  readonly canSubmitSurvey = computed<boolean>(() => {
    if (this.isSurveyLocked()) {
      return false;
    }

    return areAllQuestionsAnswered(this.questions(), this.selectedAnswers());
  });

  readonly isPastSurvey = computed<boolean>(() => {
    const currentSurvey = this.survey();

    if (!currentSurvey?.deadline) {
      return false;
    }

    return new Date(currentSurvey.deadline).getTime() < Date.now();
  });

  readonly surveyStatusLabel = computed<string>(() => {
    return this.isPastSurvey() ? 'Past survey' : 'Published';
  });

  readonly hasVisibleResults = computed<boolean>(() => {
    return this.hasVotes() || hasSelectedAnswers(this.selectedAnswers());
  });

  /**
   * Checks whether the survey cannot receive new answers.
   *
   * @returns Whether the survey is locked for new submissions.
   */
  private isSurveyLocked(): boolean {
    return this.isPastSurvey() || this.isSubmitting() || this.hasCompletedSurvey();
  }

  constructor() {
    void this.loadSurveyPage();
  }

  /**
   * Cleans up the realtime vote subscription when the detail page is destroyed.
   */
  ngOnDestroy(): void {
    void this.votesSubscription?.unsubscribe();
  }

  /**
   * Opens the shared create-survey modal from the detail page.
   */
  openCreateSurveyModal(): void {
    this.isCreateSurveyModalOpen.set(true);
  }

  /**
   * Closes the shared create-survey modal.
   */
  closeCreateSurveyModal(): void {
    this.isCreateSurveyModalOpen.set(false);
  }

  /**
   * Navigates to a newly created survey and reloads the detail page data.
   *
   * @param surveyId - Id of the newly created survey.
   */
  async handleSurveyCreated(surveyId: string): Promise<void> {
    this.isCreateSurveyModalOpen.set(false);
    await this.router.navigate(['/surveys', surveyId]);
    await this.loadSurveyPage();
  }

  /**
   * Toggles the visibility of the survey results panel on mobile screens.
   */
  toggleResultsPanel(): void {
    this.isResultsPanelOpen.update((isOpen: boolean) => !isOpen);
  }

  /**
   * Formats a deadline date for display in the survey header.
   *
   * @param deadline - Deadline date string or null when no deadline exists.
   * @returns Formatted deadline label for the survey header.
   */
  formatDeadline(deadline: string | null): string {
    if (!deadline) {
      return 'No deadline';
    }

    return new Intl.DateTimeFormat('en', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(deadline));
  }

  /**
   * Checks whether a specific option is selected for one question.
   *
   * @param questionId - Question id that owns the option.
   * @param optionId - Option id that should be checked.
   * @returns Whether the option is currently selected.
   */
  isOptionSelected(questionId: string, optionId: string): boolean {
    return this.selectedAnswers()[questionId]?.includes(optionId) ?? false;
  }

  /**
   * Selects an answer immediately when the participant clicks or taps an option.
   *
   * @param question - Question whose answer should be changed.
   * @param optionId - Option id selected by the participant.
   * @param event - Mouse event used to prevent the default input behavior.
   */
  selectAnswer(question: SurveyQuestion, optionId: string, event: MouseEvent): void {
    event.preventDefault();

    if (this.isPastSurvey() || this.isSubmitting() || this.hasCompletedSurvey()) {
      return;
    }

    if (question.allowMultiple) {
      this.toggleMultipleChoiceAnswer(question.id, optionId);
      return;
    }

    this.selectSingleChoiceAnswer(question.id, optionId);
  }

  /**
   * Stores one selected option for a single-choice question.
   *
   * @param questionId - Question id whose answer should be replaced.
   * @param optionId - Option id that should become the selected answer.
   */
  private selectSingleChoiceAnswer(questionId: string, optionId: string): void {
    this.selectedAnswers.update((currentAnswers: Record<string, string[]>) => ({
      ...currentAnswers,
      [questionId]: [optionId],
    }));
  }

  /**
   * Submits the current participant vote when the survey is complete.
   */
  async submitVote(): Promise<void> {
    const currentSurvey = this.survey();

    if (!currentSurvey || !this.canSubmitSurvey()) {
      return;
    }

    await this.saveVote(currentSurvey.id);
  }

  /**
   * Converts an option index into the visible result letter.
   *
   * @param optionIndex - Zero-based option index.
   * @returns Letter shown for the option.
   */
  getOptionLabel(optionIndex: number): string {
    return String.fromCharCode(65 + optionIndex);
  }

  /**
   * Calculates the vote percentage for a single option.
   *
   * @param questionId - Question id whose results should be checked.
   * @param optionId - Option id whose percentage should be calculated.
   * @returns Rounded vote percentage for the option.
   */
  getVotePercentage(questionId: string, optionId: string): number {
    return calculateVotePercentage(questionId, optionId, this.votes(), this.selectedAnswers());
  }

  /**
   * Wraps the vote submit flow and handles loading and error state.
   *
   * @param surveyId - Survey id that receives the vote.
   */
  private async saveVote(surveyId: string): Promise<void> {
    try {
      this.startVoteSubmit();
      await this.createVote(surveyId);
      await this.handleVoteSubmitSuccess(surveyId);
    } catch {
      this.errorMessage.set('Your vote could not be submitted.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  /**
   * Resets submit messages and marks the vote request as pending.
   */
  private startVoteSubmit(): void {
    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }

  /**
   * Sends the selected answers to Supabase for one survey.
   *
   * @param surveyId - Survey id that receives the vote.
   */
  private async createVote(surveyId: string): Promise<void> {
    await this.supabaseService.createVote({
      survey_id: surveyId,
      participant_id: this.participantService.getParticipantId(),
      answers: createVoteAnswers(this.questions(), this.selectedAnswers()),
    });
  }

  /**
   * Shows success feedback, clears answers and refreshes the vote results.
   *
   * @param surveyId - Survey id whose results should be refreshed.
   */
  private async handleVoteSubmitSuccess(surveyId: string): Promise<void> {
    storeCompletedSurvey(surveyId);
    this.hasCompletedSurvey.set(true);
    this.successMessage.set('Your vote has been submitted.');
    this.selectedAnswers.set({});

    await this.loadVotes(surveyId);
  }

  /**
   * Reads the survey id from the route and loads the matching survey.
   */
  private async loadSurveyPage(): Promise<void> {
    const surveyId = this.route.snapshot.paramMap.get('id');

    if (!surveyId) {
      this.handleMissingSurvey();
      return;
    }

    await this.loadSurvey(surveyId);
  }

  /**
   * Loads the selected survey and its vote data from Supabase.
   *
   * @param surveyId - Survey id that should be loaded.
   */
  private async loadSurvey(surveyId: string): Promise<void> {
    try {
      await this.loadSurveySafely(surveyId);
    } catch {
      this.errorMessage.set('Survey could not be loaded.');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Loads one survey and stores it when it exists.
   *
   * @param surveyId - Survey id that should be loaded safely.
   */
  private async loadSurveySafely(surveyId: string): Promise<void> {
    this.startSurveyLoading();

    const survey = await this.supabaseService.getSurveyById(surveyId);

    if (!survey) {
      this.handleMissingSurvey();
      return;
    }

    await this.setLoadedSurvey(survey);
  }

  /**
   * Resets loading errors before a survey request starts.
   */
  private startSurveyLoading(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
  }

  /**
   * Stores the state used when a survey id is missing or unknown.
   */
  private handleMissingSurvey(): void {
    this.survey.set(null);
    this.errorMessage.set('Survey could not be found.');
    this.isLoading.set(false);
  }

  /**
   * Stores the loaded survey, clears old selections and starts realtime vote updates.
   *
   * @param survey - Survey loaded from Supabase.
   */
  private async setLoadedSurvey(survey: Survey): Promise<void> {
    const normalizedSurvey = normalizeSurveyQuestions(survey as SurveyWithRawQuestions);

    this.survey.set(normalizedSurvey);
    this.hasCompletedSurvey.set(hasStoredVote(normalizedSurvey.id));
    this.selectedAnswers.set({});
    this.successMessage.set(null);

    await this.loadVotes(normalizedSurvey.id);
    this.subscribeToVoteChanges(normalizedSurvey.id);
  }

  /**
   * Loads all submitted votes for one survey.
   *
   * @param surveyId - Survey id whose votes should be loaded.
   */
  private async loadVotes(surveyId: string): Promise<void> {
    const votes = await this.supabaseService.getVotesBySurveyId(surveyId);
    this.votes.set(votes);
  }

  /**
   * Replaces the current realtime subscription with one for the selected survey.
   *
   * @param surveyId - Survey id whose votes should be watched.
   */
  private subscribeToVoteChanges(surveyId: string): void {
    void this.votesSubscription?.unsubscribe();

    this.votesSubscription = this.supabaseService.subscribeToSurveyVotes(surveyId, () => {
      void this.loadVotes(surveyId);
    });
  }

  /**
   * Adds or removes one option id from a multiple-choice answer.
   *
   * @param questionId - Question id whose selected options should be changed.
   * @param optionId - Option id that should be toggled.
   */
  private toggleMultipleChoiceAnswer(questionId: string, optionId: string): void {
    this.selectedAnswers.update((currentAnswers: Record<string, string[]>) =>
      toggleSelectedOption(currentAnswers, questionId, optionId),
    );
  }
}
