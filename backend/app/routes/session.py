"""Development session endpoint (Sprint 16 PART 7)."""
from fastapi import APIRouter, Depends

from ..models import User
from ..schemas import SessionOut
from ..services.seed import current_user

router = APIRouter(prefix="/api", tags=["session"])


@router.get("/session", response_model=SessionOut)
def get_session(user: User = Depends(current_user)):
    return SessionOut(
        mode="local-dev",
        user_id=user.id,
        email=user.email,
        name=user.name,
        authenticated=False,
        note="Local single-user development session — a real authentication boundary is reserved for a future sprint.",
    )
