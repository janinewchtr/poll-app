import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { SURVEY_CATEGORIES } from '../../../../core/constants/survey-categories';
import { Survey } from '../../../../core/models/survey.model';
import { SupabaseService } from '../../../../core/services/supabase.service';
import { CreateSurveyModal } from '../../../create-survey/components/create-survey-modal/create-survey-modal';

type SurveyTab = 'active' | 'past';

const ALL_SURVEYS = 'All Surveys';
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Displays the landing page, survey overview and category filtering.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, CreateSurveyModal],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly router = inject(Router);
  private readonly supabaseService = inject(SupabaseService);

  readonly surveys = signal<Survey[]>([]);
  readonly isLoading = signal<boolean>(true);
  readonly errorMessage = signal<string | null>(null);

  readonly activeTab = signal<SurveyTab>('active');
  readonly selectedCategory = signal<string>(ALL_SURVEYS);
  readonly isCategoryMenuOpen = signal<boolean>(false);
  readonly isCreateSurveyModalOpen = signal<boolean>(false);

  readonly categories: readonly string[] = [ALL_SURVEYS, ...SURVEY_CATEGORIES];

  readonly visibleSurveys = computed<Survey[]>(() => {
    return this.surveys()
      .filter((survey: Survey) => this.matchesActiveTab(survey))
      .filter((survey: Survey) => this.matchesSelectedCategory(survey))
      .sort(
        (firstSurvey: Survey, secondSurvey: Survey) =>
          this.getDeadlineTime(firstSurvey) - this.getDeadlineTime(secondSurvey),
      );
  });

  readonly endingSoonSurveys = computed<Survey[]>(() => {
    return this.surveys()
      .filter((survey: Survey) => !this.isPastSurvey(survey))
      .filter((survey: Survey) => survey.deadline !== null)
      .sort(
        (firstSurvey: Survey, secondSurvey: Survey) =>
          this.getDeadlineTime(firstSurvey) - this.getDeadlineTime(secondSurvey),
      )
      .slice(0, 3);
  });

  constructor() {
    void this.loadSurveys();
  }

  /**
   * Closes the category dropdown when the user clicks outside of it.
   *
   * @param event - Document click event used to detect outside clicks.
   */
  @HostListener('document:click', ['$event'])
  closeCategoryMenuOnOutsideClick(event: MouseEvent): void {
    const clickedElement = event.target;

    if (!(clickedElement instanceof Element)) {
      return;
    }

    const clickedInsideCategoryFilter = clickedElement.closest('.category-filter');

    if (!clickedInsideCategoryFilter) {
      this.isCategoryMenuOpen.set(false);
    }
  }

  /**
   * Opens the shared create-survey modal from the home page.
   */
  openCreateSurveyModal(): void {
    this.isCreateSurveyModalOpen.set(true);
    this.isCategoryMenuOpen.set(false);
  }

  /**
   * Closes the shared create-survey modal.
   */
  closeCreateSurveyModal(): void {
    this.isCreateSurveyModalOpen.set(false);
  }

  /**
   * Refreshes the list and navigates to the newly created survey.
   *
   * @param surveyId - Id of the newly created survey.
   */
  async handleSurveyCreated(surveyId: string): Promise<void> {
    await this.loadSurveys();
    this.activeTab.set('active');
    this.selectedCategory.set(ALL_SURVEYS);
    await this.router.navigate(['/surveys', surveyId]);
  }

  /**
   * Switches between active and past surveys.
   *
   * @param tab - Survey tab that should become active.
   */
  setActiveTab(tab: SurveyTab): void {
    this.activeTab.set(tab);
    this.selectedCategory.set(ALL_SURVEYS);
    this.isCategoryMenuOpen.set(false);
  }

  /**
   * Stores the selected category filter.
   *
   * @param category - Category selected by the user.
   */
  setSelectedCategory(category: string): void {
    this.selectedCategory.set(category);
  }

  /**
   * Opens or closes the category filter dropdown.
   */
  toggleCategoryMenu(): void {
    this.isCategoryMenuOpen.update((isOpen: boolean) => !isOpen);
  }

  /**
   * Applies a category filter and closes the dropdown.
   *
   * @param category - Category selected in the dropdown.
   */
  selectCategory(category: string): void {
    this.setSelectedCategory(category);
    this.isCategoryMenuOpen.set(false);
  }

  /**
   * Checks whether a survey deadline is already in the past.
   *
   * @param survey - Survey whose deadline should be checked.
   * @returns Whether the survey is already past its deadline.
   */
  isPastSurvey(survey: Survey): boolean {
    if (!survey.deadline) {
      return false;
    }

    return this.getDeadlineTime(survey) < Date.now();
  }

  /**
   * Formats a deadline date for display in survey cards.
   *
   * @param deadline - Deadline date string or null when no deadline exists.
   * @returns Formatted deadline label for the UI.
   */
  formatDeadline(deadline: string | null): string {
    if (!deadline) {
      return 'No deadline';
    }

    return new Intl.DateTimeFormat('en', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(deadline));
  }

  /**
   * Builds the deadline badge text shown on survey cards.
   *
   * @param survey - Survey whose deadline badge should be created.
   * @returns Deadline badge label for the survey card.
   */
  getDeadlineBadge(survey: Survey): string {
    if (!survey.deadline) {
      return 'No deadline';
    }

    const daysLeft = Math.ceil((this.getDeadlineTime(survey) - Date.now()) / MILLISECONDS_PER_DAY);

    if (daysLeft <= 0) {
      return 'Past survey';
    }

    return daysLeft === 1 ? 'Ends in 1 Day' : `Ends in ${daysLeft} Days`;
  }

  /**
   * Loads the published surveys from Supabase.
   */
  private async loadSurveys(): Promise<void> {
    try {
      this.isLoading.set(true);
      this.errorMessage.set(null);

      const surveys = await this.supabaseService.getSurveys();
      this.surveys.set(surveys);
    } catch {
      this.errorMessage.set('Surveys could not be loaded.');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Checks whether a survey belongs to the currently selected tab.
   *
   * @param survey - Survey to compare with the active tab.
   * @returns Whether the survey should be visible in the active tab.
   */
  private matchesActiveTab(survey: Survey): boolean {
    if (this.activeTab() === 'active') {
      return !this.isPastSurvey(survey);
    }

    return this.isPastSurvey(survey);
  }

  /**
   * Checks whether a survey matches the selected category filter.
   *
   * @param survey - Survey to compare with the selected category.
   * @returns Whether the survey matches the selected category filter.
   */
  private matchesSelectedCategory(survey: Survey): boolean {
    return this.selectedCategory() === ALL_SURVEYS || survey.category === this.selectedCategory();
  }

  /**
   * Returns a comparable timestamp for survey sorting.
   *
   * @param survey - Survey whose deadline should be converted.
   * @returns Deadline timestamp or the largest safe number when no deadline exists.
   */
  private getDeadlineTime(survey: Survey): number {
    if (!survey.deadline) {
      return Number.MAX_SAFE_INTEGER;
    }

    return new Date(survey.deadline).getTime();
  }
}