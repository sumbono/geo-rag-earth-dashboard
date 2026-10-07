from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/geo"
    jwt_secret: str
    refresh_secret: str
    demo_user: str = "demo"
    demo_password: str
    public_origin: str = "http://localhost:3000"
    thumbs_dir: str = "data/thumbs"
    encoder: str = "remoteclip"          # "remoteclip" | "fake"
    rate_limit_enabled: bool = True
