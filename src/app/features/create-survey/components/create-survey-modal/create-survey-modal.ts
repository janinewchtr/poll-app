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

type CreateSurveyForm = FormGroup<{
  title: FormControl<string>;
  description: FormControl<string>;
  category: FormControl<string>;
  deadline: FormControl<string>;
  questions: FormArray<QuestionForm>;
}>;

type QuestionForm = FormGroup<{
  text: FormControl<string>;
  allowMultiple: FormControl<boolean>;
  options: FormArray<FormControl<string>>;
}>;

type QuestionFormValue = ReturnType<QuestionForm['getRawValue']>;
type SurveyQuestionPayload = CreateSurveyPayload['questions'][number];
type SurveyOptionPayload = SurveyQuestionPayload['options'][number];

const MAX_OPTIONS_PER_QUESTION = 6;

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

  readonly categories = SURVEY_CATEGORIES;
  readonly isSubmitting = signal<boolean>(false);
  readonly submitError = signal<string | null>(null);
  readonly createdSurveyId = signal<string | null>(null);
  readonly isCategoryMenuOpen = signal<boolean>(false);
  readonly selectedCategory = signal<string>('');

  readonly showPublishedOverlay = computed<boolean>(() => {
    return this.createdSurveyId() !== null;
  });

  readonly selectedCategoryLabel = computed<string>(() => {
    return this.selectedCategory() || 'Choose category';
  });

  readonly form: CreateSurveyForm = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    description: [''],
    category: ['', Validators.required],
    deadline: [''],
    questions: this.formBuilder.array<QuestionForm>([this.createQuestion()]),
  });

  readonly questions = computed<FormArray<QuestionForm>>(() => {
    return this.form.controls.questions;
  });

  /**
   * Closes the category menu when the user clicks outside of the dropdown.
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

    this.surveyCreated.emit(surveyId);
    this.closeModal.emit();
  }

  /**
   * Toggles the category dropdown and keeps the click inside the modal control.
   */
  toggleCategoryMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.isCategoryMenuOpen.update((isOpen: boolean) => !isOpen);
  }

  /**
   * Stores the selected category in both the signal and the reactive form.
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
    this.form.controls.questions.push(this.createQuestion());
  }

  /**
   * Removes a question or clears the first one so at least one question remains.
   */
  removeQuestion(questionIndex: number): void {
    if (questionIndex === 0) {
      this.clearQuestion(this.form.controls.questions.at(0));
      return;
    }

    this.form.controls.questions.removeAt(questionIndex);
  }

  /**
   * Adds an empty answer option when the maximum option count has not been reached.
   */
  addOption(questionIndex: number): void {
    const options = this.getOptions(questionIndex);

    if (options.length >= MAX_OPTIONS_PER_QUESTION) {
      return;
    }

    options.push(this.formBuilder.nonNullable.control('', Validators.required));
  }

  /**
   * Checks whether the selected question can receive another answer option.
   */
  canAddOption(questionIndex: number): boolean {
    return this.getOptions(questionIndex).length < MAX_OPTIONS_PER_QUESTION;
  }

  /**
   * Removes an answer option while keeping the minimum of two options.
   */
  removeOption(questionIndex: number, optionIndex: number): void {
    const options = this.getOptions(questionIndex);

    if (options.length <= 2) {
      return;
    }

    options.removeAt(optionIndex);
  }

  /**
   * Returns the option controls for one question.
   */
  getOptions(questionIndex: number): FormArray<FormControl<string>> {
    return this.form.controls.questions.at(questionIndex).controls.options;
  }

  /**
   * Converts an answer index into the visible letter label.
   */
  getAnswerLetter(optionIndex: number): string {
    return String.fromCharCode(65 + optionIndex);
  }

  /**
   * Validates the form and creates the survey in Supabase.
   */
  async submitSurvey(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    try {
      this.isSubmitting.set(true);
      this.submitError.set(null);

      const createdSurvey = await this.supabaseService.createSurvey(this.createSurveyPayload());
      this.createdSurveyId.set(createdSurvey.id);
    } catch {
      this.submitError.set('Survey could not be created.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  /**
   * Creates the default reactive form group for a new question.
   */
  private createQuestion(): QuestionForm {
    return this.formBuilder.nonNullable.group({
      text: ['', Validators.required],
      allowMultiple: [false],
      options: this.formBuilder.array<FormControl<string>>([
        this.formBuilder.nonNullable.control('', Validators.required),
        this.formBuilder.nonNullable.control('', Validators.required),
      ]),
    });
  }

  /**
   * Clears the first question instead of deleting it completely.
   */
  private clearQuestion(question: QuestionForm): void {
    question.controls.text.setValue('');
    question.controls.allowMultiple.setValue(false);

    question.controls.options.controls.forEach((option: FormControl<string>) => {
      option.setValue('');
    });
  }

  /**
   * Builds the payload expected by the Supabase service from the form value.
   */
  private createSurveyPayload(): CreateSurveyPayload {
    const formValue = this.form.getRawValue();

    return {
      title: formValue.title.trim(),
      description: formValue.description.trim() || null,
      category: formValue.category,
      deadline: formValue.deadline || null,
      status: 'published',
      questions: formValue.questions.map((question, questionIndex) =>
        this.createSurveyQuestion(question, questionIndex),
      ),
    };
  }

  /**
   * Converts one question form value into the survey question payload.
   */
  private createSurveyQuestion(
    question: QuestionFormValue,
    questionIndex: number,
  ): SurveyQuestionPayload {
    return {
      id: `q${questionIndex + 1}`,
      text: question.text.trim(),
      allowMultiple: question.allowMultiple,
      options: question.options.map((option, optionIndex) =>
        this.createSurveyOption(option, optionIndex),
      ),
    };
  }

  /**
   * Converts one answer text into the survey option payload.
   */
  private createSurveyOption(option: string, optionIndex: number): SurveyOptionPayload {
    return {
      id: String.fromCharCode(97 + optionIndex),
      text: option.trim(),
    };
  }
}
