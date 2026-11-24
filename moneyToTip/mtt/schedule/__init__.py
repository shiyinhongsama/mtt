"""schedule — 复习调度（需求 §5.4）。

- 三档状态：new(新学) / learning(巩固中) / mastered(已掌握，间隔>21天)（R-schedule-01）
- 全量 review log：时间、对错、耗时、自评（R-schedule-02，FSRS 训练可消费，R-schedule-05）
- 简化排期规则，冷启动友好（R-schedule-04）；答错的题更早出现（R-schedule-03）
- 求助不算复习、不改排期，但记日志（R-explain-07）
"""
