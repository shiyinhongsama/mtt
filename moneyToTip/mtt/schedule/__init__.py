"""schedule — 复习调度（需求 §5.4）。

- 记忆状态：new(新学) / learning(学习中) / review(稳定复习) / relearning(重学中)
- 全量 review log：时间、对错、耗时、自评与决策快照（R-schedule-02/05）
- 基于指数遗忘近似的分钟级排期；答错进入 10 分钟重学（R-schedule-03/04）
- 求助不算复习、不改排期，但记日志（R-explain-07）
"""
