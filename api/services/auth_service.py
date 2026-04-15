import secrets
import httpx
from datetime import datetime, timedelta
from jose import jwt, JWTError
from passlib.context import CryptContext
from api.config import get_settings

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def generate_api_key(prefix: str = "akela") -> str:
    token = secrets.token_urlsafe(32)
    return f"{prefix}_{token}"


def create_jwt(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(hours=settings.jwt_expire_hours)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return {}


def verify_admin_credentials(username: str, password: str) -> bool:
    return (
        username == settings.admin_username
        and password == settings.admin_password
    )


async def get_github_user(code: str) -> dict:
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            json={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
            },
            headers={"Accept": "application/json"},
        )
        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise ValueError("Failed to get GitHub access token")
        user_resp = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        return user_resp.json()
