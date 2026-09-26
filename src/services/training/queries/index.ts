// Read side of training: view-model queries for the start sheet, logger, summary, history,
// progress, volume dashboard and Today alerts. Each takes the service context first, only reads
// Dexie and computes, and returns plain serializable objects (null for "not found"), so the UI can
// call it inside useLiveQuery.
export { getTrainingAlerts, type TrainingAlerts } from './alerts'
export {
  getExerciseProgress,
  getProgressOverview,
  PROGRESS_CHANGE_LOOKBACK_DAYS,
  type ChangeDirection,
  type DatedMetric,
  type ExerciseProgress,
  type MetricChange,
  type ProgressOverviewItem,
  type ProgressPoint,
  type ProgressSeries,
} from './progress'
export {
  getLoggerView,
  getSessionDetail,
  getSessionSummary,
  listSessions,
  type ExerciseOutcome,
  type LastTimeView,
  type LoggerExerciseView,
  type LoggerView,
  type NextSuggestionView,
  type SessionDetailExerciseView,
  type SessionDetailView,
  type SessionListItem,
  type SessionSummaryView,
  type SessionVolumeView,
  type SetView,
  type SummaryExerciseView,
} from './session'
export type { SessionBodyweight } from '../bodyweight'
export {
  AD_HOC_DAY_NAME,
  LAST_GYM_KEY,
  stallKey,
  type BestSet,
  type DeloadView,
  type MuscleSets,
  type PrescriptionBadge,
  type StallView,
} from './shared'
export {
  getStartOptions,
  previewSession,
  type ExerciseOption,
  type GymOption,
  type PreviewSlot,
  type SessionPreview,
  type StartDayOption,
  type StartOptions,
} from './start'
export {
  getVolumeDashboard,
  type DayCapWarning,
  type SessionCapWarning,
  type VolumeDashboard,
  type VolumeMuscleRow,
} from './volume'
