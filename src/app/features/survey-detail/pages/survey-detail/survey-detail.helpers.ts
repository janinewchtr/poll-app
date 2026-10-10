import {
  Survey,
  SurveyQuestion,
  SurveyVote,
  VoteAnswer,
} from '../../../../core/models/survey.model';

export type SurveyWithRawQuestions = Omit<Survey, 'questions'> & {
  questions: SurveyQuestion[] | string | null;
};

export type SelectedAnswers = Record<string, string[]>;

const VOTED_SURVEY_STORAGE_PREFIX = 'poll-app-voted-survey-';

/**
 * Checks whether every survey question has at least one selected answer.
 *
 * @param questions - Survey questions that need answers.
 * @param selectedAnswers - Currently selected answers grouped by question id.
 * @returns Whether all questions have at least one selected answer.
 */
export function areAllQuestionsAnswered(
  questions: SurveyQuestion[],
  selectedAnswers: SelectedAnswers,
): boolean {
  return (
    questions.length > 0 &&
    questions.every((question: SurveyQuestion) => {
      return (selectedAnswers[question.id] ?? []).length > 0;
    })
  );
}

/**
 * Checks whether the participant has selected at least one answer.
 *
 * @param selectedAnswers - Currently selected answers grouped by question id.
 * @returns Whether at least one answer has been selected.
 */
export function hasSelectedAnswers(selectedAnswers: SelectedAnswers): boolean {
  return Object.values(selectedAnswers).some(
    (selectedOptionIds: string[]) => selectedOptionIds.length > 0,
  );
}

/**
 * Creates the vote answer payload from selected answers.
 *
 * @param questions - Survey questions used to build the vote answer payload.
 * @param selectedAnswers - Currently selected answers grouped by question id.
 * @returns Vote answers ready to be submitted.
 */
export function createVoteAnswers(
  questions: SurveyQuestion[],
  selectedAnswers: SelectedAnswers,
): VoteAnswer[] {
  return questions.map((question: SurveyQuestion) => ({
    questionId: question.id,
    optionIds: selectedAnswers[question.id] ?? [],
  }));
}

/**
 * Adds or removes one option id from a multiple-choice answer.
 *
 * @param selectedAnswers - Current answer selection grouped by question id.
 * @param questionId - Question id whose selected options should be changed.
 * @param optionId - Option id that should be toggled.
 * @returns Updated answer selection.
 */
export function toggleSelectedOption(
  selectedAnswers: SelectedAnswers,
  questionId: string,
  optionId: string,
): SelectedAnswers {
  const currentOptionIds = selectedAnswers[questionId] ?? [];
  const nextOptionIds = getToggledOptionIds(currentOptionIds, optionId);

  return {
    ...selectedAnswers,
    [questionId]: nextOptionIds,
  };
}

/**
 * Returns selected option ids with the requested option toggled.
 *
 * @param currentOptionIds - Option ids currently selected for the question.
 * @param optionId - Option id that should be added or removed.
 * @returns Updated option ids for the question.
 */
function getToggledOptionIds(currentOptionIds: string[], optionId: string): string[] {
  if (currentOptionIds.includes(optionId)) {
    return currentOptionIds.filter((currentOptionId: string) => currentOptionId !== optionId);
  }

  return [...currentOptionIds, optionId];
}

/**
 * Calculates the vote percentage for a single option.
 *
 * @param questionId - Question id whose results should be calculated.
 * @param optionId - Option id whose percentage should be calculated.
 * @param votes - Saved votes loaded from Supabase.
 * @param selectedAnswers - Current participant selection included in the live preview.
 * @returns Rounded vote percentage for the option.
 */
export function calculateVotePercentage(
  questionId: string,
  optionId: string,
  votes: SurveyVote[],
  selectedAnswers: SelectedAnswers,
): number {
  const totalAnswers = getVisibleTotalAnswers(questionId, votes, selectedAnswers);

  if (totalAnswers === 0) {
    return 0;
  }

  return Math.round(
    (getVisibleOptionVotes(questionId, optionId, votes, selectedAnswers) / totalAnswers) * 100,
  );
}

/**
 * Counts saved votes plus the participant's current selection for one question.
 *
 * @param questionId - Question id whose total visible answers should be counted.
 * @param votes - Saved votes loaded from Supabase.
 * @param selectedAnswers - Current participant selection included in the live preview.
 * @returns Total visible answer count for the question.
 */
function getVisibleTotalAnswers(
  questionId: string,
  votes: SurveyVote[],
  selectedAnswers: SelectedAnswers,
): number {
  const selectedOptionIds = selectedAnswers[questionId] ?? [];

  return getTotalAnswers(questionId, votes) + selectedOptionIds.length;
}

/**
 * Counts saved votes plus the participant's current selection for one option.
 *
 * @param questionId - Question id whose option votes should be counted.
 * @param optionId - Option id whose votes should be counted.
 * @param votes - Saved votes loaded from Supabase.
 * @param selectedAnswers - Current participant selection included in the live preview.
 * @returns Total visible vote count for the option.
 */
function getVisibleOptionVotes(
  questionId: string,
  optionId: string,
  votes: SurveyVote[],
  selectedAnswers: SelectedAnswers,
): number {
  const selectedOptionIds = selectedAnswers[questionId] ?? [];
  const selectedOptionCount = selectedOptionIds.includes(optionId) ? 1 : 0;

  return getOptionVotes(questionId, optionId, votes) + selectedOptionCount;
}

/**
 * Counts all selected answers for one question across all votes.
 *
 * @param questionId - Question id whose answer count should be calculated.
 * @param votes - Saved votes loaded from Supabase.
 * @returns Total selected answer count for the question.
 */
function getTotalAnswers(questionId: string, votes: SurveyVote[]): number {
  return votes.reduce((totalAnswers: number, vote: SurveyVote) => {
    const answer = findVoteAnswer(vote, questionId);
    return totalAnswers + (answer?.optionIds.length ?? 0);
  }, 0);
}

/**
 * Counts how often one option was selected for one question.
 *
 * @param questionId - Question id that owns the option.
 * @param optionId - Option id whose votes should be counted.
 * @param votes - Saved votes loaded from Supabase.
 * @returns Number of votes for the option.
 */
function getOptionVotes(questionId: string, optionId: string, votes: SurveyVote[]): number {
  return votes.reduce((voteCount: number, vote: SurveyVote) => {
    const answer = findVoteAnswer(vote, questionId);
    return answer?.optionIds.includes(optionId) ? voteCount + 1 : voteCount;
  }, 0);
}

/**
 * Finds the answer for one question inside a vote.
 *
 * @param vote - Vote that may contain an answer for the question.
 * @param questionId - Question id to search for.
 * @returns Matching vote answer or undefined when no answer exists.
 */
function findVoteAnswer(vote: SurveyVote, questionId: string): VoteAnswer | undefined {
  return vote.answers.find((answer: VoteAnswer) => answer.questionId === questionId);
}

/**
 * Normalizes survey question data that may come from the database as a JSON string.
 *
 * @param survey - Survey whose questions may still be stored as raw data.
 * @returns Survey with normalized question data.
 */
export function normalizeSurveyQuestions(survey: SurveyWithRawQuestions): Survey {
  return {
    ...survey,
    questions: parseQuestions(survey.questions),
  };
}

/**
 * Returns parsed question data or an empty list when no valid questions are available.
 *
 * @param questions - Raw question data from the survey.
 * @returns Parsed survey questions or an empty list.
 */
function parseQuestions(questions: SurveyQuestion[] | string | null): SurveyQuestion[] {
  if (Array.isArray(questions)) {
    return questions;
  }

  if (!questions) {
    return [];
  }

  return parseQuestionString(questions);
}

/**
 * Parses a stored question JSON string into survey questions.
 *
 * @param questions - Stored question JSON string.
 * @returns Parsed survey questions or an empty list when parsing fails.
 */
function parseQuestionString(questions: string): SurveyQuestion[] {
  try {
    const parsedQuestions: unknown = JSON.parse(questions);
    return filterSurveyQuestions(parsedQuestions);
  } catch {
    return [];
  }
}

/**
 * Filters parsed JSON values down to valid survey questions.
 *
 * @param questions - Parsed JSON value with unknown shape.
 * @returns Valid survey questions only.
 */
function filterSurveyQuestions(questions: unknown): SurveyQuestion[] {
  if (!Array.isArray(questions)) {
    return [];
  }

  return questions.filter((question: unknown): question is SurveyQuestion =>
    isSurveyQuestion(question),
  );
}

/**
 * Checks whether an unknown value has the minimum shape of a survey question.
 *
 * @param question - Value that should be checked.
 * @returns Whether the value has the shape of a survey question.
 */
function isSurveyQuestion(question: unknown): question is SurveyQuestion {
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
 * Checks whether the participant has already voted in a survey.
 *
 * @param surveyId - Survey id used to check local storage.
 * @returns Whether the participant has already completed the survey.
 */
export function hasStoredVote(surveyId: string): boolean {
  return localStorage.getItem(getCompletedSurveyStorageKey(surveyId)) === 'true';
}

/**
 * Stores that the participant has completed a survey.
 *
 * @param surveyId - Survey id that should be marked as completed.
 */
export function storeCompletedSurvey(surveyId: string): void {
  localStorage.setItem(getCompletedSurveyStorageKey(surveyId), 'true');
}

/**
 * Builds the local storage key for a completed survey.
 *
 * @param surveyId - Survey id used in the storage key.
 * @returns Local storage key for the completed survey flag.
 */
function getCompletedSurveyStorageKey(surveyId: string): string {
  return `${VOTED_SURVEY_STORAGE_PREFIX}${surveyId}`;
}
