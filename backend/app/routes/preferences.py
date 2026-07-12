"""Career-preferences routes (Sprint 16 PART 4)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Preferences, User
from ..schemas import PreferencesIn, PreferencesOut
from ..services.seed import current_user

router = APIRouter(prefix="/api/preferences", tags=["preferences"])


def _get_or_create(db: Session, user: User) -> Preferences:
    p = db.query(Preferences).filter_by(user_id=user.id).first()
    if p is None:
        p = Preferences(user_id=user.id)
        db.add(p)
        db.commit()
        db.refresh(p)
    return p


@router.get("", response_model=PreferencesOut)
def get_preferences(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return _get_or_create(db, user)


@router.put("", response_model=PreferencesOut)
def put_preferences(body: PreferencesIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = _get_or_create(db, user)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p
