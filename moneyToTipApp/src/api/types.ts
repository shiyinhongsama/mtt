/** API 契约类型：与 FastAPI 服务端对齐。 */

export type QType = "choice" | "blank" | "judge" | "qa" | "scenario";
export type Rating = "again" | "hard" | "good" | "easy";

export const SUBJECTIVE_TYPES: QType[] = ["qa", "scenario"];
export const QTYPE_LABELS: Record<QType, string> = {
  choice: "选择",
  blank: "填空",
  judge: "判断",
  qa: "问答",
  scenario: "场景设计",
};

export type QuestionStatus = "pending" | "active" | "flagged" | "suspended";

export interface Question {
  id: number;
  qtype: QType;
  stem: string;
  options: string[];
  answer: string;
  explanation: string;
  source: string;
  tags: string[];
  difficulty: number;
  status: QuestionStatus;
  category_id: number | null;
  bank_id: number | null;
}

export interface QuestionBank {
  id: number;
  name: string;
  description: string;
  is_default: boolean;
  question_count: number;
  created_at: string;
}

export type StudyStatus = "new" | "learning" | "review" | "relearning";

export interface StudyState {
  status: StudyStatus;
  label: string;
  due_at: string | null;
}

export interface RatingPreview {
  interval_minutes: number;
  due_at: string;
  status: StudyStatus;
}

export interface DueQuestion extends Question {
  state: StudyState;
  rating_previews: Record<Rating, RatingPreview>;
}

export interface ReviewDecision {
  interval_minutes: number | null;
  due_at: string | null;
  algorithm_version: string;
}

export interface ReviewResult {
  log_id: number;
  idempotent: boolean;
  state: StudyState | null;
  decision: ReviewDecision;
}

export interface Stats {
  mature_count: number;
  due_today: number;
  reviewed_today: number;
  active_questions: number;
  heatmap: { date: string; count: number }[];
  by_category: {
    category_id: number | null;
    name: string;
    total: number;
    mature: number;
    due: number;
  }[];
}

export interface Bank {
  id: number;
  name: string;
  is_default: boolean;
}

export interface Plan {
  id: number;
  name: string;
  bank_id: number | null;
  daily_goal: number;
  today_done: number;
  goal_met: boolean;
  created_at: string;
}

export interface ApiTokenInfo {
  id: number;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
  masked: string;
}

export interface ReviewSubmit {
  question_id: number;
  client_id: string;
  correct: boolean;
  rating: Rating;
  duration_ms?: number;
  plan_id?: number | null;
}

export interface QuestionCreate {
  stem: string;
  answer: string;
  qtype: QType;
  options: string[];
  explanation: string;
  source: string;
  tags: string[];
  difficulty: number;
  category_id?: number | null;
  bank_id?: number | null;
}

export interface Category {
  id: number;
  name: string;
  children: Category[];
}

export interface TodayStats {
  due_count: number;
  new_count: number;
  relearning_count: number;
  completed_count: number;
  goal_count: number;
  goal_met: boolean;
  shortage_reason: "not_enough_due_questions" | null;
  estimated_minutes: number | null;
  forecast: { date: string; count: number }[];
}

export interface UserInfo {
  id: number;
  username: string;
  role: string;
  is_active: boolean;
  created_at: string;
}
