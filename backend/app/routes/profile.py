"""Profile routes (Sprint 16 PART 4)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Profile, User
from ..schemas import ProfileIn, ProfileOut
from ..services.seed import current_user

router = APIRouter(prefix="/api/profile", tags=["profile"])


def _get_or_create(db: Session, user: User) -> Profile:
    p = db.query(Profile).filter_by(user_id=user.id).first()
    if p is None:
        p = Profile(user_id=user.id)
        db.add(p)
        db.commit()
        db.refresh(p)
    return p


@router.get("", response_model=ProfileOut)
def get_profile(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return _get_or_create(db, user)


@router.put("", response_model=ProfileOut)
def put_profile(body: ProfileIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = _get_or_create(db, user)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p


@router.patch("", response_model=ProfileOut)
def patch_profile(body: ProfileIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = _get_or_create(db, user)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p
