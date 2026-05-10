export type ReminderStage =
  | "none"
  | "before_due"
  | "due_date"
  | "overdue_1"
  | "overdue_2"
  | "overdue_3"
  | "escalated";

export type EscalationStatus = "idle" | "queued" | "sent" | "manual_review";

export type ReminderSnapshot = {
  enabled: boolean;
  paused: boolean;
  stage: ReminderStage;
  lastReminderAt?: number;
  nextReminderAt?: number;
  escalationStatus: EscalationStatus;
  paidAt?: number;
};

export type ReminderRule = {
  enabled: boolean;
  daysBeforeDue: number;
  onDueDate: boolean;
  overdueCadenceDays: number;
  maxOverdueReminders: number;
  escalateAfterCount: number;
  businessSignature?: string;
};
