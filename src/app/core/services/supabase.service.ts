import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { environment } from '../../../environments/environment';
import {
  CreateSurveyPayload,
  CreateSurveyRow,
  CreateVotePayload,
  Survey,
  SurveyRow,
  SurveyVote,
} from '../models/survey.model';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const SURVEY_VISIBLE_AFTER_END_MS = MILLISECONDS_PER_DAY;

/**
 * Handles all Supabase reads, writes and realtime subscriptions for surveys and votes.
 */
@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  private readonly client: SupabaseClient = createClient(
    environment.supabaseUrl,
    environment.supabaseAnonKey,
  );

  /**
   * Loads all published surveys and normalizes their question data for the app.
   *
   * @returns Published surveys that are still visible in the app.
   */
  async getSurveys(): Promise<Survey[]> {
    const { data, error } = await this.getPublishedSurveyRows();

    if (error) {
      throw error;
    }

    return this.getVisibleSurveys(data ?? []);
  }

  /**
   * Loads published survey rows ordered by deadline.
   *
   * @returns Supabase query for published survey rows.
   */
  private getPublishedSurveyRows() {
    return this.client
      .from('surveys')
      .select('*')
      .eq('status', 'published')
      .order('deadline', { ascending: true, nullsFirst: false });
  }

  /**
   * Converts and filters visible survey rows.
   *
   * @param surveys - Survey rows loaded from Supabase.
   * @returns Normalized surveys that are still visible.
   */
  private getVisibleSurveys(surveys: SurveyRow[]): Survey[] {
    return surveys
      .map((survey: SurveyRow) => this.normalizeSurvey(survey))
      .filter((survey: Survey) => this.isSurveyStillVisible(survey));
  }

  /**
   * Checks whether a survey is still inside its 24-hour visibility window.
   *
   * @param survey - Survey to check.
   * @returns Whether the survey should still be shown.
   */
  private isSurveyStillVisible(survey: Survey): boolean {
    const now = Date.now();

    if (!survey.deadline) {
      return new Date(survey.created_at).getTime() + SURVEY_VISIBLE_AFTER_END_MS >= now;
    }

    return new Date(survey.deadline).getTime() + SURVEY_VISIBLE_AFTER_END_MS >= now;
  }

  /**
   * Loads a single survey by id and returns null when no matching survey exists.
   *
   * @param id - Survey id to load.
   * @returns Matching survey or null when no survey exists.
   */
  async getSurveyById(id: string): Promise<Survey | null> {
    const { data, error } = await this.getSurveyRowById(id);

    if (error) {
      throw error;
    }

    return data ? this.normalizeSurvey(data as SurveyRow) : null;
  }

  /**
   * Loads one survey row by id from Supabase.
   *
   * @param id - Survey id to load.
   * @returns Supabase query for one survey row.
   */
  private getSurveyRowById(id: string) {
    return this.client.from('surveys').select('*').eq('id', id).maybeSingle();
  }

  /**
   * Creates a survey row in Supabase and converts the question list into a JSON string.
   *
   * @param payload - Survey data submitted from the create survey form.
   * @returns Created survey normalized for the frontend.
   */
  async createSurvey(payload: CreateSurveyPayload): Promise<Survey> {
    const surveyRow: CreateSurveyRow = {
      ...payload,
      questions: JSON.stringify(payload.questions),
    };

    const { data, error } = await this.client.from('surveys').insert(surveyRow).select().single();

    if (error) {
      throw error;
    }

    return this.normalizeSurvey(data as SurveyRow);
  }

  /**
   * Loads all votes that belong to one survey.
   *
   * @param surveyId - Survey id whose votes should be loaded.
   * @returns Votes submitted for the survey.
   */
  async getVotesBySurveyId(surveyId: string): Promise<SurveyVote[]> {
    const { data, error } = await this.client
      .from('votes')
      .select('*')
      .eq('survey_id', surveyId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return data ?? [];
  }

  /**
   * Creates one vote entry for a survey participant.
   *
   * @param payload - Vote data submitted by the participant.
   * @returns Created vote entry.
   */
  async createVote(payload: CreateVotePayload): Promise<SurveyVote> {
    const { data, error } = await this.client.from('votes').insert(payload).select().single();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Subscribes to realtime vote changes for one survey and calls the given callback on updates.
   *
   * @param surveyId - Survey id whose votes should be watched.
   * @param onChange - Callback called when Supabase sends a vote change.
   * @returns Supabase realtime channel subscription.
   */
  subscribeToSurveyVotes(
    surveyId: string,
    onChange: () => void,
  ): ReturnType<SupabaseClient['channel']> {
    return this.client
      .channel(`survey-votes-${surveyId}`)
      .on('postgres_changes', this.createVoteChangeFilter(surveyId), onChange)
      .subscribe();
  }

  /**
   * Creates the Supabase realtime filter for one survey's votes.
   *
   * @param surveyId - Survey id used in the realtime filter.
   * @returns Realtime filter configuration for Supabase vote changes.
   */
  private createVoteChangeFilter(surveyId: string) {
    return {
      event: '*',
      schema: 'public',
      table: 'votes',
      filter: `survey_id=eq.${surveyId}`,
    } as const;
  }

  /**
   * Converts a database survey row into the survey shape used by the frontend.
   *
   * @param survey - Survey row loaded from Supabase.
   * @returns Normalized survey with parsed questions.
   */
  private normalizeSurvey(survey: SurveyRow): Survey {
    return {
      ...survey,
      questions: this.parseQuestions(survey.questions),
    };
  }

  /**
   * Returns question data from either an already parsed array or a stored JSON string.
   *
   * @param questions - Question data from the survey row.
   * @returns Parsed survey questions or an empty list.
   */
  private parseQuestions(questions: string | Survey['questions'] | null): Survey['questions'] {
    if (Array.isArray(questions)) {
      return questions;
    }

    if (!questions) {
      return [];
    }

    return this.parseQuestionString(questions);
  }

  /**
   * Parses stored question JSON and falls back to an empty list when parsing fails.
   *
   * @param questions - Stored question JSON string.
   * @returns Parsed survey questions or an empty list.
   */
  private parseQuestionString(questions: string): Survey['questions'] {
    try {
      const parsedQuestions: unknown = JSON.parse(questions);
      return this.getParsedQuestions(parsedQuestions);
    } catch {
      return [];
    }
  }

  /**
   * Ensures parsed question data is an array before passing it to the app.
   *
   * @param questions - Parsed question data with unknown shape.
   * @returns Survey questions when the parsed data is an array, otherwise an empty list.
   */
  private getParsedQuestions(questions: unknown): Survey['questions'] {
    if (!Array.isArray(questions)) {
      return [];
    }

    return questions as Survey['questions'];
  }
}