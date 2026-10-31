from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session

router = APIRouter(tags=["health"])


class HealthOut(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]


@router.get("/health", response_model=HealthOut)
async def health(session: Annotated[AsyncSession, Depends(get_session)]) -> HealthOut:
    await session.execute(text("SELECT 1"))
    return HealthOut(status="ok", database="ok")
