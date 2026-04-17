"""Chat router package — messages, dispatch, streaming, and relay."""
from fastapi import APIRouter
from .messages import router as messages_router
from .dispatch import router as dispatch_router
from .stream import router as stream_router
from .relay import router as relay_router

router = APIRouter()
router.include_router(messages_router)
router.include_router(dispatch_router)
router.include_router(stream_router)
router.include_router(relay_router)
