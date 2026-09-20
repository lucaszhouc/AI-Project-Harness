export interface OnboardingProgress {
  stage: string;
  progress: number;
  label: string;
  detail?: string;
}

export interface OnboardingProgressState extends OnboardingProgress {
  status: "progress";
  detail: string;
}

export interface OnboardingErrorState {
  status: "error";
  message: string;
  errorId?: string;
}

export interface OnboardingWarningState {
  status: "warning";
  message: string;
  errorId?: string;
}

export interface OnboardingCompletedState {
  status: "completed";
}

export function progressOnboardingState(progress: Partial<OnboardingProgress>): OnboardingProgressState;
export function failedOnboardingState(error: unknown): OnboardingErrorState;
export function completedOnboardingState(result: {
  desktopOpened: boolean;
  desktopWarning?: { message: string; errorId?: string };
}): OnboardingWarningState | OnboardingCompletedState;
export function renderOnboardingStatus(state: OnboardingProgressState | OnboardingErrorState | OnboardingWarningState | OnboardingCompletedState | { status: "idle" }): string;
export function escapeOnboardingHtml(value: unknown): string;
