// Route table. Every feature is lazy-loaded from its own folder so parallel work never collides
// here. Hash routing: GitHub Pages can't rewrite deep links to index.html.
import type { RouteObject } from 'react-router'
import AppShell from '@/ui/AppShell'
import RouteError from '@/ui/RouteError'

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: AppShell,
    ErrorBoundary: RouteError,
    HydrateFallback: () => null,
    children: [
      { index: true, lazy: () => import('@/features/today').then((m) => ({ Component: m.default })) },

      // Train
      { path: 'train', lazy: () => import('@/features/train').then((m) => ({ Component: m.default })) },
      { path: 'train/start', lazy: () => import('@/features/logger/StartSession').then((m) => ({ Component: m.default })) },
      { path: 'train/session/:id', lazy: () => import('@/features/logger/Logger').then((m) => ({ Component: m.default })) },
      { path: 'train/session/:id/summary', lazy: () => import('@/features/logger/Summary').then((m) => ({ Component: m.default })) },
      { path: 'train/history', lazy: () => import('@/features/history').then((m) => ({ Component: m.default })) },
      { path: 'train/history/:id', lazy: () => import('@/features/history/SessionDetail').then((m) => ({ Component: m.default })) },
      { path: 'train/progress', lazy: () => import('@/features/progress').then((m) => ({ Component: m.default })) },
      { path: 'train/progress/:exerciseId', lazy: () => import('@/features/progress/ExerciseProgress').then((m) => ({ Component: m.default })) },
      { path: 'train/volume', lazy: () => import('@/features/volume').then((m) => ({ Component: m.default })) },

      // Body
      { path: 'body', lazy: () => import('@/features/body').then((m) => ({ Component: m.default })) },

      // Food
      { path: 'food', lazy: () => import('@/features/food').then((m) => ({ Component: m.default })) },
      { path: 'food/phase/new', lazy: () => import('@/features/food/PhaseWizard').then((m) => ({ Component: m.default })) },
      { path: 'food/checkin', lazy: () => import('@/features/checkin').then((m) => ({ Component: m.default })) },

      // More
      { path: 'more', lazy: () => import('@/features/more').then((m) => ({ Component: m.default })) },
      { path: 'program', lazy: () => import('@/features/program').then((m) => ({ Component: m.default })) },
      { path: 'program/day/:id', lazy: () => import('@/features/program/DayEditor').then((m) => ({ Component: m.default })) },
      { path: 'program/exercises', lazy: () => import('@/features/program/ExerciseLibrary').then((m) => ({ Component: m.default })) },
      { path: 'program/exercises/:id', lazy: () => import('@/features/program/ExerciseEditor').then((m) => ({ Component: m.default })) },
      { path: 'program/gyms', lazy: () => import('@/features/program/Gyms').then((m) => ({ Component: m.default })) },
      { path: 'settings', lazy: () => import('@/features/settings').then((m) => ({ Component: m.default })) },
      { path: 'settings/profile', lazy: () => import('@/features/settings/Profile').then((m) => ({ Component: m.default })) },
      { path: 'settings/data', lazy: () => import('@/features/data').then((m) => ({ Component: m.default })) },

      { path: '*', lazy: () => import('@/ui/NotFound').then((m) => ({ Component: m.default })) },
    ],
  },
]
