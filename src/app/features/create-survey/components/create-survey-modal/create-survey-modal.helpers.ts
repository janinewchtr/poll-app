import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';

import { CreateSurveyPayload } from '../../../../core/models/survey.model';

export const MAX_OPTIONS_PER_QUESTION = 6;

type QuestionForm = FormGroup<{
  text: FormControl<string>;
  allowMultiple: FormControl<boolean>;
  options: FormArray<FormControl<string>>;
}>;

export type CreateSurveyForm = FormGroup<{
  title: FormControl<string>;
  description: FormControl<string>;
  category: FormControl<string>;
  deadline: FormControl<string>;
  questions: FormArray<QuestionForm>;
}>;

export type { QuestionForm };

export type CreateSurveyFormValue = ReturnType<CreateSurveyForm['getRawValue']>;
export type QuestionFormValue = ReturnType<QuestionForm['getRawValue']>;
export type SurveyQuestionPayload = CreateSurveyPayload['questions'][number];
export type SurveyOptionPayload = SurveyQuestionPayload['options'][number];

const HAS_LETTER_PATTERN = /\p{L}/u;

/**
 * Creates a validator that requires at least one letter in a text field.
 *
 * @returns Validator function for checking letter content.
 */
export function containsLetterValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;

    if (typeof value !== 'string') {
      return null;
    }

    return HAS_LETTER_PATTERN.test(value.trim()) ? null : { missingLetters: true };
  };
}

/**
 * Returns tomorrow's date in the yyyy-mm-dd format required by date inputs.
 *
 * @returns Tomorrow's date formatted for a native date input.
 */
export function getMinimumDeadlineDate(): string {
  const tomorrow = new Date();

  tomorrow.setDate(tomorrow.getDate() + 1);

  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Creates the default reactive form group for a new question.
 *
 * @param formBuilder - Angular form builder used to create typed controls.
 * @returns Reactive form group for one survey question.
 */
export function createQuestionForm(formBuilder: FormBuilder): QuestionForm {
  return formBuilder.nonNullable.group({
    text: ['', [Validators.required, containsLetterValidator()]],
    allowMultiple: [false],
    options: formBuilder.array<FormControl<string>>([
      formBuilder.nonNullable.control('', [Validators.required, containsLetterValidator()]),
      formBuilder.nonNullable.control('', [Validators.required, containsLetterValidator()]),
    ]),
  });
}

/**
 * Clears a question form group instead of deleting it completely.
 *
 * @param question - Question form group that should be reset.
 */
export function clearQuestionForm(question: QuestionForm): void {
  question.controls.text.setValue('');
  question.controls.allowMultiple.setValue(false);

  question.controls.options.controls.forEach((option: FormControl<string>) => {
    option.setValue('');
  });
}

/**
 * Builds the payload expected by the Supabase service from the form value.
 *
 * @param formValue - Raw create survey form value.
 * @returns Survey payload ready to be sent to Supabase.
 */
export function createSurveyPayload(formValue: CreateSurveyFormValue): CreateSurveyPayload {
  return {
    title: formValue.title.trim(),
    description: formValue.description.trim() || null,
    category: formValue.category,
    deadline: formValue.deadline || null,
    status: 'published',
    questions: formValue.questions.map(createSurveyQuestion),
  };
}

/**
 * Converts one question form value into the survey question payload.
 *
 * @param question - Raw question form value.
 * @param questionIndex - Zero-based question index used to create the question id.
 * @returns Survey question payload.
 */
function createSurveyQuestion(
  question: QuestionFormValue,
  questionIndex: number,
): SurveyQuestionPayload {
  return {
    id: `q${questionIndex + 1}`,
    text: question.text.trim(),
    allowMultiple: question.allowMultiple,
    options: question.options.map(createSurveyOption),
  };
}

/**
 * Converts one answer text into the survey option payload.
 *
 * @param option - Answer option text entered in the form.
 * @param optionIndex - Zero-based option index used to create the option id.
 * @returns Survey option payload.
 */
function createSurveyOption(option: string, optionIndex: number): SurveyOptionPayload {
  return {
    id: String.fromCharCode(97 + optionIndex),
    text: option.trim(),
  };
}
