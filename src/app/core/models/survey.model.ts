/**
 * Describes the publication state of a survey.
 */
export type SurveyStatus = 'published' | 'draft';

/**
 * Represents one selectable answer option inside a survey question.
 */
export interface SurveyOption {
  id: string;
  text: string;
}

/**
 * Represents one question with its available answer options.
 */
export interface SurveyQuestion {
  id: string;
  text: string;
  allowMultiple: boolean;
  options: SurveyOption[];
}

/**
 * Represents the normalized survey shape used inside the frontend.
 */
export interface Survey {
  id: string;
  title: string;
  description: string | null;
  category: string;
  deadline: string | null;
  status: SurveyStatus;
  questions: SurveyQuestion[];
  created_at: string;
}

/**
 * Represents the survey shape returned from Supabase before normalization.
 */
export interface SurveyRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  deadline: string | null;
  status: SurveyStatus;
  questions: string | SurveyQuestion[] | null;
  created_at: string;
}

/**
 * Represents the selected options for one answered question.
 */
export interface VoteAnswer {
  questionId: string;
  optionIds: string[];
}

/**
 * Represents one submitted vote from a participant.
 */
export interface SurveyVote {
  id: string;
  survey_id: string;
  participant_id: string;
  answers: VoteAnswer[];
  created_at: string;
}

/**
 * Describes the data needed to create a new survey.
 */
export interface CreateSurveyPayload {
  title: string;
  description?: string | null;
  category: string;
  deadline?: string | null;
  status: SurveyStatus;
  questions: SurveyQuestion[];
}

/**
 * Describes the survey insert row sent to Supabase.
 */
export interface CreateSurveyRow {
  title: string;
  description?: string | null;
  category: string;
  deadline?: string | null;
  status: SurveyStatus;
  questions: string;
}

/**
 * Describes the data needed to submit a participant vote.
 */
export interface CreateVotePayload {
  survey_id: string;
  participant_id: string;
  answers: VoteAnswer[];
}
