"""Audit logging and notification helpers."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog, Notification, User


def audit(db: Session, action: str, entity_type: str, entity_id: Any, summary: str,
          user: User | None = None, details: dict[str, Any] | None = None, commit: bool = False) -> AuditLog:
    log = AuditLog(action=action, entity_type=entity_type, entity_id=None if entity_id is None else str(entity_id),
                   summary=summary, details=details or {}, user_id=user.id if user else None,
                   user_email=user.email if user else "system")
    db.add(log)
    if commit:
        db.commit()
    return log


def notify(db: Session, type_: str, title: str, message: str, severity: str = "info",
           audience: str = "all", link: str | None = None, user_id: int | None = None) -> Notification:
    n = Notification(type=type_, title=title, message=message, severity=severity, audience=audience,
                     link=link, user_id=user_id, read_by=[])
    db.add(n)
    return n
