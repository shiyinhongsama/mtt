"""数据库连接与初始化（SQLite，可整体迁移，R-data-01）。"""

from sqlmodel import SQLModel, Session, create_engine

from mtt.config import settings

engine = create_engine(settings.database_url, echo=False)


def init_db() -> None:
    # 延迟导入，确保所有表的模型都已注册
    import mtt.identity.models  # noqa: F401
    import mtt.corpus.models  # noqa: F401
    import mtt.capture.models  # noqa: F401
    import mtt.schedule.models  # noqa: F401
    import mtt.generate.models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _migrate()


def _migrate() -> None:
    """轻量迁移：旧库补 question.bank_id 并把存量题目归入默认题库。"""
    from sqlmodel import Session, select

    from mtt.corpus.models import Question, QuestionBank
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
