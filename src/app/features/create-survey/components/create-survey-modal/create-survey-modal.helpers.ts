import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';

import { CreateSurveyPayload } from '../../../../core/models/survey.model';

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

export type QuestionFormValue = ReturnType<QuestionForm['getRawValue']>;
export type SurveyQuestionPayload = CreateSurveyPayload['questions'][number];
export type SurveyOptionPayload = SurveyQuestionPayload['options'][number];

const HAS_LETTER_PATTERN = /\p{L}/u;

/**
 * Checks whether a text field contains at least one letter.
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
