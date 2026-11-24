/** API 契约类型：与 mtt（FastAPI 服务端）对齐 */

export type QType = "choice" | "blank" | "judge" | "qa" | "scenario";

/** 主观题：无自动判定，走四档自评（again/hard/good/easy） */
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

export type StudyStatus = "new" | "learning" | "mastered";

/** 到期题：题目 + 复习状态；label 是服务端映射好的用户语言（术语黑名单） */
export interface DueQuestion extends Question {
  state: { status: StudyStatus; label: string };
}

export interface ReviewResult {
  log_id: number;
  idempotent: boolean;
  state: { status: StudyStatus; label: string };
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

/** 训练计划：题库范围 + 每日目标（百词斩式玩法） */
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
  rating: "again" | "hard" | "good" | "easy";
  duration_ms?: number;
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

export interface UserInfo {
  id: number;
  username: string;
  role: string;
  is_active: boolean;
  created_at: string;
}
