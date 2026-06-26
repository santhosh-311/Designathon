import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Application
    APP_NAME: str = "MEP-TMS Backend"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True
    
    # Server
    API_V1_STR: str = "/api/v1"
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "")
    
    # Supabase
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
    
    # JWT Configuration
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_HOURS: int = 24
    
    # Email Configuration
    EMAIL_SERVICE: str = os.getenv("EMAIL_SERVICE", "gmail")
    EMAIL_USER: str = os.getenv("EMAIL_USER", "")
    EMAIL_PASSWORD: str = os.getenv("EMAIL_PASSWORD", "")
    
    # Attendance Configuration
    ATTENDANCE_CUTOFF_TIME: str = os.getenv("ATTENDANCE_CUTOFF_TIME", "10:00")
    ABSENT_ALERT_DAYS: int = int(os.getenv("ABSENT_ALERT_DAYS", "3"))
    MIN_BATCH_SIZE_LIMIT: int = int(os.getenv("MIN_BATCH_SIZE_LIMIT", "30"))
    
    # File Upload
    MAX_FILE_SIZE: int = 50 * 1024 * 1024  # 50 MB
    UPLOAD_FOLDER: str = "uploads"
    
    # Topper Configuration
    TOPPER_PERCENTAGE: int = int(os.getenv("TOPPER_PERCENTAGE", "10"))
    
    # Azure OpenAI Configuration
    AZURE_OPENAI_API_KEY: str = os.getenv("AZURE_OPENAI_API_KEY", "")
    AZURE_OPENAI_ENDPOINT: str = os.getenv("AZURE_OPENAI_ENDPOINT", "https://id02-3299-resource.services.ai.azure.com/openai/v1")
    AZURE_OPENAI_DEPLOYMENT: str = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-5.4-mini")
    
    # LangSmith Observability Configuration
    LANGCHAIN_TRACING_V2: str = os.getenv("LANGCHAIN_TRACING_V2", "false")
    LANGCHAIN_API_KEY: str = os.getenv("LANGCHAIN_API_KEY", "")
    LANGCHAIN_PROJECT: str = os.getenv("LANGCHAIN_PROJECT", "mep-tms-backend")
    LANGCHAIN_ENDPOINT: str = os.getenv("LANGCHAIN_ENDPOINT", "https://api.smith.langchain.com")
    
    # Judge0 Configuration
    JUDGE0_API_URL: str = os.getenv("JUDGE0_API_URL", "https://ce.judge0.com")
    JUDGE0_API_KEY: str = os.getenv("JUDGE0_API_KEY", "")

    # Redis Configuration
    REDIS_URL: str = os.getenv("REDIS_URL", "")
    
    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"

settings = Settings()

# Write LangChain / LangSmith configuration to os.environ so the library picks them up automatically
if settings.LANGCHAIN_TRACING_V2.lower() == "true":
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    if settings.LANGCHAIN_API_KEY:
        os.environ["LANGCHAIN_API_KEY"] = settings.LANGCHAIN_API_KEY
    if settings.LANGCHAIN_PROJECT:
        os.environ["LANGCHAIN_PROJECT"] = settings.LANGCHAIN_PROJECT
    if settings.LANGCHAIN_ENDPOINT:
        os.environ["LANGCHAIN_ENDPOINT"] = settings.LANGCHAIN_ENDPOINT

