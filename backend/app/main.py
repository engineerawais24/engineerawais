"""CareerPilot FastAPI application (Sprint 16).

Creates the app, restricts CORS to the local CareerPilot frontend
origins, registers every router, initializes the database (+ dev user)
on startup, and returns a structured error envelope for all failures.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import get_settings
from .database import init_db
from .routes import routers

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()          # create tables + seed dev user (idempotent)
    yield


app = FastAPI(title=settings.app_name, version=settings.api_version, lifespan=lifespan)

# CORS — ONLY the configured local frontend origins ("null" covers file://).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

for r in routers:
    app.include_router(r)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    detail = exc.detail
    payload = detail if isinstance(detail, dict) else {"code": "http_error", "message": str(detail)}
    return JSONResponse(status_code=exc.status_code, content={"error": {**payload, "status": exc.status_code}})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"error": {
            "code": "validation_error",
            "message": "Request validation failed",
            "status": 422,
            "details": jsonable_encoder(exc.errors()),
        }},
    )


@app.get("/", tags=["root"])
def root():
    return {
        "service": settings.app_name,
        "version": settings.api_version,
        "environment": settings.environment,
        "docs": "/docs",
        "health": "/api/health",
    }
