"""全局配置（环境变量前缀 MTT_）。

- 模型 API Key 为全局配置（BYOK），管理员持有，普通用户不接触（R-identity-09）
- 排期算法可切换：simple（默认，冷启动友好）→ fsrs（数据齐备后，R-schedule-04/05）
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MTT_", env_file=".env",
                                      env_file_encoding="utf-8")

    database_url: str = "sqlite:///mtt.db"
    data_dir: str = "./data"

    # BYOK：模型 Key 全局配置，不写死在代码里，可随时更换（R-data-04）
    model_api_key: str = ""
    model_base_url: str = ""
    model_name: str = ""

    schedule_algorithm: str = "simple"  # simple | fsrs

    # 前端构建产物路径（独立工程 moneyToTipApp / moneyToTipConsole，留空自动探测）
    webapp_dist: str = ""
    console_dist: str = ""


settings = Settings()
