"""数据库连接与版本化初始化（SQLite，可整体迁移，R-data-01）。"""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlmodel import SQLModel, Session, create_engine

from mtt.config import settings

engine = create_engine(settings.database_url, echo=False)


def _alembic_config() -> Config:
    root = Path(__file__).parent
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    url = engine.url.render_as_string(hide_password=False).replace("%", "%%")
    config.set_main_option("sqlalchemy.url", url)
    return config


def run_migrations() -> None:
    """创建全新数据库，或将旧库和已管理库升级到当前版本。"""
    import mtt.identity.models  # noqa: F401
    import mtt.corpus.models  # noqa: F401
    import mtt.capture.models  # noqa: F401
    import mtt.schedule.models  # noqa: F401
    import mtt.generate.models  # noqa: F401

    tables = set(inspect(engine).get_table_names())
    config = _alembic_config()
    if "alembic_version" not in tables and "user" not in tables:
        SQLModel.metadata.create_all(engine)
        command.stamp(config, "head")
        return
    if "alembic_version" not in tables:
        command.stamp(config, "0001_baseline")
    command.upgrade(config, "head")
    _migrate()


def init_db() -> None:
    run_migrations()


def _migrate() -> None:
    """补充早期非版本化字段，并把存量题目归入默认题库。"""
    from sqlmodel import select

    from mtt.corpus.models import Question
    from mtt.corpus.service import ensure_default_bank
    from mtt.identity.models import User

    with engine.begin() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(question)")}
        if "bank_id" not in cols:
            conn.exec_driver_sql("ALTER TABLE question ADD COLUMN bank_id INTEGER")
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(apitoken)")}
        if "last_used_at" not in cols:
            conn.exec_driver_sql("ALTER TABLE apitoken ADD COLUMN last_used_at DATETIME")

    with Session(engine) as session:
        for user in session.exec(select(User)).all():
            bank = ensure_default_bank(session, user.id)
            stmt = select(Question).where(Question.owner_id == user.id,
                                          Question.bank_id == None)  # noqa: E711
            for q in session.exec(stmt).all():
                q.bank_id = bank.id
                session.add(q)
        session.commit()


def get_session():
    with Session(engine) as session:
        yield session
