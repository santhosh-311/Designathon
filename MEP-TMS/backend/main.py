from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import connect_to_supabase, close_supabase_connection
from app.core.redis_cache import connect_to_redis, close_redis_connection, redis_cache_middleware
from app.routers import auth, batch, attendance, assessment, report, user, chat, notification, agent, report_card, onboarding, timeline, assistant, gamification
from app.tasks.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle"""
    # Startup
    connect_to_supabase()
    connect_to_redis()
    start_scheduler()
    print("[OK] Application startup complete")
    yield
    # Shutdown
    stop_scheduler()
    close_redis_connection()
    close_supabase_connection()
    print("[OK] Application shutdown complete")


# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="MEP-TMS Backend API for Training Management System",
    lifespan=lifespan
)

# ── Middleware stack (registered bottom-up: last registered = outermost) ──────

# 1. Redis cache middleware (runs inside CORS, caches authenticated GET responses)
@app.middleware("http")
async def cache_middleware(request: Request, call_next):
    return await redis_cache_middleware(request, call_next)

# 2. Request logger
@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"--> Incoming Request: {request.method} {request.url.path}")
    try:
        response = await call_next(request)
        print(f"<-- Finished Request: {request.method} {request.url.path} with status {response.status_code}")
        return response
    except Exception as e:
        print(f"<-- Request Failed: {request.method} {request.url.path} with error {str(e)}")
        raise

# 3. CORS (outermost — handles preflight before any other middleware)
# Base allowed origins for local development
allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]

# Append production origins if configured
if settings.CORS_ORIGINS:
    for origin in settings.CORS_ORIGINS.split(","):
        clean_origin = origin.strip()
        if clean_origin and clean_origin not in allowed_origins:
            allowed_origins.append(clean_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION
    }

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(auth.router)
app.include_router(batch.router)
app.include_router(attendance.router)
app.include_router(assessment.router)
app.include_router(report.router)
app.include_router(user.router)
app.include_router(chat.router)
app.include_router(notification.router)
app.include_router(agent.router)
app.include_router(report_card.router)
app.include_router(onboarding.router)
app.include_router(timeline.router)
app.include_router(assistant.router)
app.include_router(gamification.router)

# ── Debug log endpoint ────────────────────────────────────────────────────────

from pydantic import BaseModel

class BrowserError(BaseModel):
    message: str
    stack: str
    url: str

@app.post("/api/debug-log")
async def debug_log(err: BrowserError):
    try:
        with open("browser_errors.txt", "a") as f:
            f.write(f"\n[{err.url}] {err.message}\nStack: {err.stack}\n")
    except Exception as e:
        print(f"Failed to write client error log: {e}")
    return {"status": "ok"}

# ── Root ──────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": f"Welcome to {settings.APP_NAME}",
        "version": settings.APP_VERSION,
        "docs": "/docs"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG
    )
