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
   */
  async getSurveys(): Promise<Survey[]> {
    const { data, error } = await this.client
      .from('surveys')
      .select('*')
      .eq('status', 'published')
      .order('deadline', { ascending: true, nullsFirst: false });

    if (error) {
      throw error;
    }

    return (data ?? [])
      .map((survey: SurveyRow) => this.normalizeSurvey(survey))
      .filter((survey: Survey) => this.isSurveyStillVisible(survey));
  }

  /**
   * Checks whether a survey is still inside its 24-hour visibility window.
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
   */
  async getSurveyById(id: string): Promise<Survey | null> {
    const { data, error } = await this.client
      .from('surveys')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return this.normalizeSurvey(data as SurveyRow);
  }

  /**
   * Creates a survey row in Supabase and converts the question list into a JSON string.
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
   */
  subscribeToSurveyVotes(
    surveyId: string,
    onChange: () => void,
  ): ReturnType<SupabaseClient['channel']> {
    return this.client
      .channel(`survey-votes-${surveyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'votes',
          filter: `survey_id=eq.${surveyId}`,
        },
        onChange,
      )
      .subscribe();
  }

  /**
   * Converts a database survey row into the survey shape used by the frontend.
   */
  private normalizeSurvey(survey: SurveyRow): Survey {
    return {
      ...survey,
      questions: this.parseQuestions(survey.questions),
    };
  }

  /**
   * Returns question data from either an already parsed array or a stored JSON string.
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
   */
  private getParsedQuestions(questions: unknown): Survey['questions'] {
    if (!Array.isArray(questions)) {
      return [];
    }

    return questions as Survey['questions'];
  }
}
