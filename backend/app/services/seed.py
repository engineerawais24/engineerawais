"""Development-user seed + current-user dependency (Sprint 16 PART 7).

Single local user, no auth. `current_user` is the ONE place a real
authentication boundary will slot in later.
"""
from fastapi import Depends
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import User


def ensure_dev_user(db: Session) -> User:
    settings = get_settings()
    user = db.query(User).filter(User.email == settings.dev_user_email).first()
    if user is None:
        user = User(email=settings.dev_user_email, name=settings.dev_user_name, is_dev=True)
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def current_user(db: Session = Depends(get_db)) -> User:
    """FUTURE AUTH BOUNDARY — today it always returns the dev user."""
    return ensure_dev_user(db)
