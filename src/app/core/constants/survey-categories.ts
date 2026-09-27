/**
 * Lists the fixed categories that can be assigned to a survey.
 */
export const SURVEY_CATEGORIES = [
  'Team Activities',
  'Health & Wellness',
  'Gaming & Entertainment',
  'Education & Learning',
  'Lifestyle & Preferences',
  'Technology & Innovation',
] as const;

/**
 * Represents one of the fixed survey category labels.
 */
export type SurveyCategory = (typeof SURVEY_CATEGORIES)[number];
