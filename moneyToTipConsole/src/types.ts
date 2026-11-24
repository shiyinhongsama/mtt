/** API 契约类型：与 mtt（FastAPI 服务端）对齐 */

export type QType = "choice" | "blank" | "judge" | "qa" | "scenario";

export type QuestionStatus = "pending" | "active" | "flagged" | "suspended";

export const STATUS_LABELS: Record<QuestionStatus, string> = {
  active: "在库",
  pending: "预览区",
  flagged: "已标记",
  suspended: "已暂停",
};

export const QTYPE_LABELS: Record<QType, string> = {
  choice: "选择",
  blank: "填空",
  judge: "判断",
  qa: "问答",
  scenario: "场景设计",
};

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

export interface Stats {
  mature_count: number;
  due_today: number;
  reviewed_today: number;
  active_questions: number;
  status_counts: Record<string, number>;
  by_bank: {
    bank_id: number | null;
    name: string;
    total: number;
    mature: number;
    due: number;
  }[];
  heatmap: { date: string; count: number }[];
  by_category: {
    category_id: number | null;
    name: string;
    total: number;
    mature: number;
    due: number;
  }[];
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

export interface ApiTokenInfo {
  id: number;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
  /** 完整 token（仅管理员接口返回，供复制） */
  token: string;
  /** 掩码（前4…后4），仅用于展示 */
  masked: string;
}
