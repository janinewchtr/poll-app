import { Routes } from '@angular/router';

/**
 * Defines the lazy-loaded application routes.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/surveys/pages/home/home').then((m) => m.Home),
  },
  {
    path: 'surveys/:id',
    loadComponent: () =>
      import('./features/survey-detail/pages/survey-detail/survey-detail').then(
        (m) => m.SurveyDetail,
      ),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
