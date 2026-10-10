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
 */
export function hasSelectedAnswers(selectedAnswers: SelectedAnswers): boolean {
  return Object.values(selectedAnswers).some(
    (selectedOptionIds: string[]) => selectedOptionIds.length > 0,
  );
}

/**
 * Creates the vote answer payload from selected answers.
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
 */
function getToggledOptionIds(currentOptionIds: string[], optionId: string): string[] {
  if (currentOptionIds.includes(optionId)) {
    return currentOptionIds.filter((currentOptionId: string) => currentOptionId !== optionId);
  }

  return [...currentOptionIds, optionId];
}

/**
 * Calculates the vote percentage for a single option.
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
 */
function getTotalAnswers(questionId: string, votes: SurveyVote[]): number {
  return votes.reduce((totalAnswers: number, vote: SurveyVote) => {
    const answer = findVoteAnswer(vote, questionId);
    return totalAnswers + (answer?.optionIds.length ?? 0);
  }, 0);
}

/**
 * Counts how often one option was selected for one question.
 */
function getOptionVotes(questionId: string, optionId: string, votes: SurveyVote[]): number {
  return votes.reduce((voteCount: number, vote: SurveyVote) => {
    const answer = findVoteAnswer(vote, questionId);
    return answer?.optionIds.includes(optionId) ? voteCount + 1 : voteCount;
  }, 0);
}

/**
 * Finds the answer for one question inside a vote.
 */
function findVoteAnswer(vote: SurveyVote, questionId: string): VoteAnswer | undefined {
  return vote.answers.find((answer: VoteAnswer) => answer.questionId === questionId);
}

/**
 * Normalizes survey question data that may come from the database as a JSON string.
 */
export function normalizeSurveyQuestions(survey: SurveyWithRawQuestions): Survey {
  return {
    ...survey,
    questions: parseQuestions(survey.questions),
  };
}

/**
 * Returns parsed question data or an empty list when no valid questions are available.
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
 */
export function hasStoredVote(surveyId: string): boolean {
  return localStorage.getItem(getCompletedSurveyStorageKey(surveyId)) === 'true';
}

/**
 * Stores that the participant has completed a survey.
 */
export function storeCompletedSurvey(surveyId: string): void {
  localStorage.setItem(getCompletedSurveyStorageKey(surveyId), 'true');
}

/**
 * Builds the local storage key for a completed survey.
 */
function getCompletedSurveyStorageKey(surveyId: string): string {
  return `${VOTED_SURVEY_STORAGE_PREFIX}${surveyId}`;
}
