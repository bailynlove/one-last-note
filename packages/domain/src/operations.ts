export interface RetentionPolicy {
  captureAcceptedDays: number;
  captureFailedDays: number;
  auditDays: number;
  logsDays: number;
  metricsMonths: number;
  trashDays: number;
}

export const RETENTION: RetentionPolicy = {
  captureAcceptedDays: 90,
  captureFailedDays: 7,
  auditDays: 400,
  logsDays: 30,
  metricsMonths: 13,
  trashDays: 30,
};

export const NOTE_UPLOAD_RATE_LIMIT = 30;
export const NOTE_UPLOAD_RATE_WINDOW_SECONDS = 60 * 60;
export const API_REQUEST_RATE_LIMIT = 600;
export const API_REQUEST_RATE_WINDOW_SECONDS = 60;
