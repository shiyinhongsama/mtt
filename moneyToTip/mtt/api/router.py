"""聚合 v1 全部路由。按能力地图构建顺序排列。"""

from fastapi import APIRouter

from mtt.anki.router import router as anki_router
from mtt.capture.router import router as capture_router
from mtt.corpus.router import router as corpus_router
from mtt.data.router import router as data_router
from mtt.explain.router import router as explain_router
from mtt.generate.router import router as generate_router
from mtt.growth.router import router as growth_router
from mtt.identity.onboarding import router as onboarding_router
from mtt.identity.router import router as identity_router
from mtt.schedule.plans import router as plans_router
from mtt.schedule.router import router as schedule_router

api_router = APIRouter()
api_router.include_router(identity_router)
api_router.include_router(onboarding_router)
api_router.include_router(capture_router)
api_router.include_router(corpus_router)
api_router.include_router(generate_router)
api_router.include_router(schedule_router)
api_router.include_router(plans_router)
api_router.include_router(explain_router)
api_router.include_router(data_router)
api_router.include_router(growth_router)
api_router.include_router(anki_router)
