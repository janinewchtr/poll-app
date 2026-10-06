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

type SurveyWithRawQuestions = Omit<Survey, 'questions'> & {
  questions: SurveyQuestion[] | string | null;
};

type VotesSubscription = ReturnType<SupabaseService['subscribeToSurveyVotes']>;

const VOTED_SURVEY_STORAGE_PREFIX = 'poll-app-voted-survey-';

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

  readonly hasVisibleResults = computed<boolean>(() => {
    return this.hasVotes() || this.hasSelectedAnswers();
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

  readonly canSubmitSurvey = computed<boolean>(() => {
    if (this.isPastSurvey() || this.isSubmitting() || this.hasCompletedSurvey()) {
      return false;
    }

    const questions = this.questions();

    if (questions.length === 0) {
      return false;
    }

    return questions.every((question: SurveyQuestion) => {
      const selectedOptionIds = this.selectedAnswers()[question.id] ?? [];
      return selectedOptionIds.length > 0;
    });
  });

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
   */
  isOptionSelected(questionId: string, optionId: string): boolean {
    return this.selectedAnswers()[questionId]?.includes(optionId) ?? false;
  }

  /**
   * Selects an answer immediately when the participant clicks or taps an option.
   */
  selectAnswer(question: SurveyQuestion, optionId: string, event: MouseEvent): void {
    event.preventDefault();

    if (this.isPastSurvey() || this.isSubmitting() || this.hasCompletedSurvey()) {
      return;
    }

    if (question.allowMultiple) {
      this.toggleMultipleChoiceAnswer(
        question.id,
        optionId,
        !this.isOptionSelected(question.id, optionId),
      );
      return;
    }

    this.selectedAnswers.update((currentAnswers: Record<string, string[]>) => ({
      ...currentAnswers,
      [question.id]: [optionId],
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
   */
  getOptionLabel(optionIndex: number): string {
    return String.fromCharCode(65 + optionIndex);
  }

  /**
   * Calculates the vote percentage for a single option.
   */
  getVotePercentage(questionId: string, optionId: string): number {
    const totalAnswersForQuestion = this.getVisibleTotalAnswersForQuestion(questionId);

    if (totalAnswersForQuestion === 0) {
      return 0;
    }

    const optionVoteCount = this.getVisibleOptionVoteCount(questionId, optionId);

    return Math.round((optionVoteCount / totalAnswersForQuestion) * 100);
  }

  /**
   * Wraps the vote submit flow and handles loading and error state.
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
   */
  private async createVote(surveyId: string): Promise<void> {
    await this.supabaseService.createVote({
      survey_id: surveyId,
      participant_id: this.participantService.getParticipantId(),
      answers: this.createVoteAnswers(),
    });
  }

  /**
   * Shows success feedback, clears answers and refreshes the vote results.
   */
  private async handleVoteSubmitSuccess(surveyId: string): Promise<void> {
    this.storeCompletedSurvey(surveyId);
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
   */
  private async loadSurvey(surveyId: string): Promise<void> {
    try {
      this.startSurveyLoading();

      const survey = await this.supabaseService.getSurveyById(surveyId);

      if (!survey) {
        this.handleMissingSurvey();
        return;
      }

      await this.setLoadedSurvey(survey);
    } catch {
      this.errorMessage.set('Survey could not be loaded.');
    } finally {
      this.isLoading.set(false);
    }
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
   */
  private async setLoadedSurvey(survey: Survey): Promise<void> {
    const normalizedSurvey = this.normalizeSurveyQuestions(survey as SurveyWithRawQuestions);

    this.survey.set(normalizedSurvey);
    this.hasCompletedSurvey.set(this.hasStoredVote(normalizedSurvey.id));
    this.selectedAnswers.set({});
    this.successMessage.set(null);

    await this.loadVotes(normalizedSurvey.id);
    this.subscribeToVoteChanges(normalizedSurvey.id);
  }

  /**
   * Loads all submitted votes for one survey.
   */
  private async loadVotes(surveyId: string): Promise<void> {
    const votes = await this.supabaseService.getVotesBySurveyId(surveyId);
    this.votes.set(votes);
  }

  /**
   * Replaces the current realtime subscription with one for the selected survey.
   */
  private subscribeToVoteChanges(surveyId: string): void {
    void this.votesSubscription?.unsubscribe();

    this.votesSubscription = this.supabaseService.subscribeToSurveyVotes(surveyId, () => {
      void this.loadVotes(surveyId);
    });
  }

  /**
   * Checks whether the participant has selected at least one answer.
   */
  private hasSelectedAnswers(): boolean {
    return Object.values(this.selectedAnswers()).some(
      (selectedOptionIds: string[]) => selectedOptionIds.length > 0,
    );
  }

  /**
   * Counts saved votes plus the participant's current selection for one question.
   */
  private getVisibleTotalAnswersForQuestion(questionId: string): number {
    const selectedOptionIds = this.selectedAnswers()[questionId] ?? [];

    return this.getTotalAnswersForQuestion(questionId) + selectedOptionIds.length;
  }

  /**
   * Counts saved votes plus the participant's current selection for one option.
   */
  private getVisibleOptionVoteCount(questionId: string, optionId: string): number {
    const selectedOptionIds = this.selectedAnswers()[questionId] ?? [];
    const selectedOptionCount = selectedOptionIds.includes(optionId) ? 1 : 0;

    return this.getOptionVoteCount(questionId, optionId) + selectedOptionCount;
  }

  /**
   * Creates the vote answer payload from the currently selected options.
   */
  private createVoteAnswers(): VoteAnswer[] {
    return this.questions().map((question: SurveyQuestion) => ({
      questionId: question.id,
      optionIds: this.selectedAnswers()[question.id] ?? [],
    }));
  }

  /**
   * Counts all selected answers for one question across all votes.
   */
  private getTotalAnswersForQuestion(questionId: string): number {
    return this.votes().reduce((totalAnswers: number, vote: SurveyVote) => {
      const answer = this.findVoteAnswer(vote, questionId);
      return totalAnswers + (answer?.optionIds.length ?? 0);
    }, 0);
  }

  /**
   * Counts how often one option was selected for one question.
   */
  private getOptionVoteCount(questionId: string, optionId: string): number {
    return this.votes().reduce((voteCount: number, vote: SurveyVote) => {
      const answer = this.findVoteAnswer(vote, questionId);

      if (!answer) {
        return voteCount;
      }

      return answer.optionIds.includes(optionId) ? voteCount + 1 : voteCount;
    }, 0);
  }

  /**
   * Finds the answer for one question inside a vote.
   */
  private findVoteAnswer(vote: SurveyVote, questionId: string): VoteAnswer | undefined {
    return vote.answers.find((answer: VoteAnswer) => answer.questionId === questionId);
  }

  /**
   * Normalizes survey question data that may come from the database as a JSON string.
   */
  private normalizeSurveyQuestions(survey: SurveyWithRawQuestions): Survey {
    return {
      ...survey,
      questions: this.parseQuestions(survey.questions),
    };
  }

  /**
   * Returns parsed question data or an empty list when no valid questions are available.
   */
  private parseQuestions(questions: SurveyQuestion[] | string | null): SurveyQuestion[] {
    if (Array.isArray(questions)) {
      return questions;
    }

    if (!questions) {
      return [];
    }

    return this.parseQuestionString(questions);
  }

  /**
   * Parses a stored question JSON string into survey questions.
   */
  private parseQuestionString(questions: string): SurveyQuestion[] {
    try {
      const parsedQuestions: unknown = JSON.parse(questions);
      return this.filterSurveyQuestions(parsedQuestions);
    } catch {
      return [];
    }
  }

  /**
   * Filters parsed JSON values down to valid survey questions.
   */
  private filterSurveyQuestions(questions: unknown): SurveyQuestion[] {
    if (!Array.isArray(questions)) {
      return [];
    }

    return questions.filter((question: unknown): question is SurveyQuestion =>
      this.isSurveyQuestion(question),
    );
  }

  /**
   * Checks whether an unknown value has the minimum shape of a survey question.
   */
  private isSurveyQuestion(question: unknown): question is SurveyQuestion {
    if (!question || typeof question !== 'object') {
      return false;
    }

    const possibleQuestion = question as Partial<SurveyQuestion>;

    return (
      typeof possibleQuestion.id === 'string' &&
      typeof possibleQuestion.text === 'string' &&
      typeof possibleQuestion.allowMultiple === 'boolean' &&
      Array.isArray(possibleQuestion.options)
    );
  }

  /**
   * Adds or removes one option id from a multiple-choice answer.
   */
  private toggleMultipleChoiceAnswer(
    questionId: string,
    optionId: string,
    isChecked: boolean,
  ): void {
    this.selectedAnswers.update((currentAnswers: Record<string, string[]>) => {
      const currentQuestionAnswers = currentAnswers[questionId] ?? [];

      const nextQuestionAnswers = isChecked
        ? [...currentQuestionAnswers, optionId]
        : currentQuestionAnswers.filter((currentOptionId: string) => currentOptionId !== optionId);

      return {
        ...currentAnswers,
        [questionId]: nextQuestionAnswers,
      };
    });
  }
  private hasStoredVote(surveyId: string): boolean {
    return localStorage.getItem(this.getCompletedSurveyStorageKey(surveyId)) === 'true';
  }

  private storeCompletedSurvey(surveyId: string): void {
    localStorage.setItem(this.getCompletedSurveyStorageKey(surveyId), 'true');
  }

  private getCompletedSurveyStorageKey(surveyId: string): string {
    return `${VOTED_SURVEY_STORAGE_PREFIX}${surveyId}`;
  }
}
