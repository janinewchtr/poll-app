import { DOCUMENT } from '@angular/common';
import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { SURVEY_CATEGORIES } from '../../../../core/constants/survey-categories';
import { CreateSurveyPayload } from '../../../../core/models/survey.model';
import { SupabaseService } from '../../../../core/services/supabase.service';
import {
  containsLetterValidator,
  createQuestionForm,
  createSurveyPayload,
  CreateSurveyForm,
  clearQuestionForm,
  getMinimumDeadlineDate,
  MAX_OPTIONS_PER_QUESTION,
  QuestionForm,
} from './create-survey-modal.helpers';

const PUBLISHED_OVERLAY_VISIBLE_MS = 3000;

/**
 * Displays the survey creation overlay and manages its reactive form state.
 */
@Component({
  selector: 'app-create-survey-modal',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './create-survey-modal.html',
  styleUrl: './create-survey-modal.scss',
})
export class CreateSurveyModal implements OnInit, OnDestroy {
  readonly closeModal = output<void>();
  readonly surveyCreated = output<string>();

  private readonly document = inject(DOCUMENT);
  private readonly formBuilder = inject(FormBuilder);
  private readonly supabaseService = inject(SupabaseService);

  private previousBodyOverflow = '';
  private publishedOverlayTimeoutId: ReturnType<typeof setTimeout> | null = null;

  readonly categories = SURVEY_CATEGORIES;
  readonly isSubmitting = signal<boolean>(false);
  readonly submitError = signal<string | null>(null);
  readonly createdSurveyId = signal<string | null>(null);
  readonly isCategoryMenuOpen = signal<boolean>(false);
  readonly selectedCategory = signal<string>('');
  readonly minimumDeadlineDate = getMinimumDeadlineDate();

  readonly showPublishedOverlay = computed<boolean>(() => {
    return this.createdSurveyId() !== null;
  });

  readonly selectedCategoryLabel = computed<string>(() => {
    return this.selectedCategory() || 'Choose category';
  });

  readonly form: CreateSurveyForm = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3), containsLetterValidator()]],
    description: [''],
    category: ['', Validators.required],
    deadline: [''],
    questions: this.formBuilder.array<QuestionForm>([createQuestionForm(this.formBuilder)]),
  });

  readonly questions = computed<FormArray<QuestionForm>>(() => {
    return this.form.controls.questions;
  });

  /**
   * Closes the category menu when the user clicks outside of the dropdown.
   *
   * @param event - Document click event used to detect outside clicks.
   */
  @HostListener('document:click', ['$event'])
  closeCategoryMenuOnOutsideClick(event: MouseEvent): void {
    const clickedElement = event.target;

    if (!(clickedElement instanceof Element)) {
      return;
    }

    const clickedInsideCategoryFilter = clickedElement.closest('.create-category-filter');

    if (!clickedInsideCategoryFilter) {
      this.isCategoryMenuOpen.set(false);
    }
  }

  /**
   * Prevents the page behind the modal from scrolling while the modal is open.
   */
  ngOnInit(): void {
    this.previousBodyOverflow = this.document.body.style.overflow;
    this.document.body.style.overflow = 'hidden';
  }

  /**
   * Restores the previous body scroll behavior when the modal is destroyed.
   */
  ngOnDestroy(): void {
    this.clearPublishedOverlayTimeout();
    this.document.body.style.overflow = this.previousBodyOverflow;
  }

  /**
   * Emits the close event unless a survey is currently being submitted.
   */
  close(): void {
    if (this.isSubmitting()) {
      return;
    }

    this.closeModal.emit();
  }

  /**
   * Closes the published overlay and sends the created survey id to the parent view.
   */
  closePublishedOverlay(): void {
    const surveyId = this.createdSurveyId();

    if (!surveyId) {
      return;
    }

    this.clearPublishedOverlayTimeout();
    this.surveyCreated.emit(surveyId);
    this.closeModal.emit();
  }

  /**
   * Toggles the category dropdown and keeps the click inside the modal control.
   *
   * @param event - Click event that should not bubble to the document listener.
   */
  toggleCategoryMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.isCategoryMenuOpen.update((isOpen: boolean) => !isOpen);
  }

  /**
   * Stores the selected category in both the signal and the reactive form.
   *
   * @param category - Category selected by the user.
   * @param event - Click event that should not bubble to the document listener.
   */
  selectCategory(category: string, event: MouseEvent): void {
    event.stopPropagation();

    this.selectedCategory.set(category);
    this.form.controls.category.setValue(category);
    this.form.controls.category.markAsTouched();
    this.form.controls.category.updateValueAndValidity();

    this.isCategoryMenuOpen.set(false);
  }

  /**
   * Adds an empty question group to the survey form.
   */
  addQuestion(): void {
    this.form.controls.questions.push(createQuestionForm(this.formBuilder));
  }

  /**
   * Removes a question and keeps one editable question in the form.
   *
   * @param questionIndex - Index of the question that should be removed.
   */
  removeQuestion(questionIndex: number): void {
    const questions = this.form.controls.questions;

    if (questions.length === 1) {
      clearQuestionForm(questions.at(0));
      return;
    }

    questions.removeAt(questionIndex);
  }

  /**
   * Adds an empty answer option when the maximum option count has not been reached.
   *
   * @param questionIndex - Index of the question that should receive another option.
   */
  addOption(questionIndex: number): void {
    const options = this.getOptions(questionIndex);

    if (options.length >= MAX_OPTIONS_PER_QUESTION) {
      return;
    }

    options.push(
      this.formBuilder.nonNullable.control('', [Validators.required, containsLetterValidator()]),
    );
  }

  /**
   * Checks whether the selected question can receive another answer option.
   *
   * @param questionIndex - Index of the question whose option count should be checked.
   * @returns Whether another option can be added.
   */
  canAddOption(questionIndex: number): boolean {
    return this.getOptions(questionIndex).length < MAX_OPTIONS_PER_QUESTION;
  }

  /**
   * Removes an answer option or clears it when the minimum option count is reached.
   *
   * @param questionIndex - Index of the question that owns the option.
   * @param optionIndex - Index of the option that should be removed or cleared.
   */
  removeOption(questionIndex: number, optionIndex: number): void {
    const options = this.getOptions(questionIndex);

    if (options.length <= 2) {
      const option = options.at(optionIndex);

      option.setValue('');
      option.markAsPristine();
      option.markAsUntouched();
      return;
    }

    options.removeAt(optionIndex);
  }

  /**
   * Returns the option controls for one question.
   *
   * @param questionIndex - Index of the question whose options should be returned.
   * @returns Form array containing the answer option controls.
   */
  getOptions(questionIndex: number): FormArray<FormControl<string>> {
    return this.form.controls.questions.at(questionIndex).controls.options;
  }

  /**
   * Converts an answer index into the visible letter label.
   *
   * @param optionIndex - Zero-based answer option index.
   * @returns Letter label shown for the answer option.
   */
  getAnswerLetter(optionIndex: number): string {
    return String.fromCharCode(65 + optionIndex);
  }

  /**
   * Validates the form and creates the survey in Supabase.
   */
  async submitSurvey(): Promise<void> {
    if (this.form.invalid) {
      this.handleInvalidSubmit();
      return;
    }

    await this.createSurvey();
  }

  /**
   * Marks all form fields after an invalid submit attempt.
   */
  private handleInvalidSubmit(): void {
    this.form.markAllAsTouched();
  }

  /**
   * Creates the survey and handles submit errors.
   */
  private async createSurvey(): Promise<void> {
    try {
      await this.createSurveySafely();
    } catch {
      this.submitError.set('Survey could not be created.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  /**
   * Sends the survey payload and shows the published overlay.
   */
  private async createSurveySafely(): Promise<void> {
    this.isSubmitting.set(true);
    this.submitError.set(null);

    const createdSurvey = await this.supabaseService.createSurvey(
      createSurveyPayload(this.form.getRawValue()),
    );
    this.showPublishedOverlayFor(createdSurvey.id);
  }

  /**
   * Shows the published message and closes it automatically after a short delay.
   *
   * @param surveyId - Id of the created survey.
   */
  private showPublishedOverlayFor(surveyId: string): void {
    this.createdSurveyId.set(surveyId);
    this.startPublishedOverlayTimeout();
  }

  /**
   * Starts the timer for the published confirmation overlay.
   */
  private startPublishedOverlayTimeout(): void {
    this.clearPublishedOverlayTimeout();

    this.publishedOverlayTimeoutId = setTimeout(() => {
      this.closePublishedOverlay();
    }, PUBLISHED_OVERLAY_VISIBLE_MS);
  }

  /**
   * Clears the published overlay timer when it is no longer needed.
   */
  private clearPublishedOverlayTimeout(): void {
    if (!this.publishedOverlayTimeoutId) {
      return;
    }

    clearTimeout(this.publishedOverlayTimeoutId);
    this.publishedOverlayTimeoutId = null;
  }
}
