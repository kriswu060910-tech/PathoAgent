"""用户认证 API 服务。

提供注册、登录、用户信息、设置同步等端点。
使用 SQLite 存储用户数据，JWT 管理会话。

启动方式：
  cd D:\\agent
  python -m auth.server
"""

import hmac
import json
import os
import sqlite3
import time

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shared.security import check_login_rate

from . import config, database
from .auth_logic import create_token, generate_salt, hash_password, verify_password, verify_token

database.init_db()

_cors_origins = os.environ.get(
    "AUTH_CORS_ORIGINS",
    "http://localhost:5173,http://localhost:4173,tauri://localhost",
)
_allow_origins = [origin.strip() for origin in _cors_origins.split(",") if origin.strip()]

app = FastAPI(title="PathoAgent Auth", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


# --- 请求/响应模型 ---

class RegisterRequest(BaseModel):
    username: str
    password: str
    displayName: str = ""
    adminKey: str = ""

class LoginRequest(BaseModel):
    username: str
    password: str

class SettingsRequest(BaseModel):
    settings: dict

class ResetPasswordRequest(BaseModel):
    newPassword: str

class UpdateDisplayNameRequest(BaseModel):
    displayName: str

class UpdateEnabledRequest(BaseModel):
    enabled: bool

class BatchRequest(BaseModel):
    ids: list[int]


# --- 依赖 ---

def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "未提供认证令牌")
    token = auth[7:]
    payload = verify_token(token)
    if not payload:
        raise HTTPException(401, "令牌无效或已过期")
    user = database.find_user_by_id(int(payload["sub"]))
    if not user:
        raise HTTPException(401, "用户不存在")
    if not user.get("enabled", 1):
        raise HTTPException(403, "账号已被禁用，请联系管理员")
    return user


# --- 端点 ---

@app.post("/auth/register")
def register(req: RegisterRequest):
    username = req.username.strip().lower()
    if not username or len(username) < 2:
        raise HTTPException(400, "用户名至少 2 个字符")
    if len(username) > 32:
        raise HTTPException(400, "用户名最多 32 个字符")
    if not req.password or len(req.password) < 8:
        raise HTTPException(400, "密码至少 8 个字符")
    if database.find_user(username):
        raise HTTPException(409, "用户名已存在")

    # 检查管理员密钥
    if req.adminKey:
        # 用户填写了管理员密钥 → 必须验证通过，否则拒绝注册
        if not config.ADMIN_KEY:
            raise HTTPException(400, "管理员注册功能当前未启用")
        if not hmac.compare_digest(
            req.adminKey.encode("utf-8"), config.ADMIN_KEY.encode("utf-8")
        ):
            raise HTTPException(400, "管理员密钥错误")
        role = "admin"
    else:
        role = "user"

    salt = generate_salt()
    pw_hash = hash_password(req.password, salt)
    try:
        user_id = database.create_user(
            username=username,
            password_hash=pw_hash,
            salt=salt,
            display_name=req.displayName.strip()[:64] or username,
            created_at=time.time(),
            role=role,
        )
    except sqlite3.IntegrityError:
        raise HTTPException(409, "用户名已存在")
    token = create_token(user_id, username)
    return {"token": token, "username": username, "displayName": req.displayName.strip()[:64] or username, "role": role}


@app.post("/auth/login")
def login(req: LoginRequest, request: Request):
    username = req.username.strip().lower()
    if not check_login_rate(request):
        raise HTTPException(429, "登录尝试过于频繁，请 15 分钟后再试")

    user = database.find_user(username)
    if not user:
        raise HTTPException(401, "用户名或密码错误")
    if not verify_password(req.password, user["salt"], user["password_hash"]):
        raise HTTPException(401, "用户名或密码错误")
    if not user.get("enabled", 1):
        raise HTTPException(403, "账号已被禁用，请联系管理员")

    token = create_token(user["id"], username)
    return {
        "token": token,
        "username": user["username"],
        "displayName": user["display_name"],
        "role": user.get("role", "user"),
    }


@app.get("/auth/me")
def me(user: dict = Depends(get_current_user)):
    return {
        "username": user["username"],
        "displayName": user["display_name"],
    }


@app.get("/auth/settings")
def get_settings(user: dict = Depends(get_current_user)):
    data = database.get_settings(user["id"])
    return {"settings": json.loads(data) if data else {}}


@app.put("/auth/settings")
def put_settings(req: SettingsRequest, user: dict = Depends(get_current_user)):
    database.save_settings(user["id"], json.dumps(req.settings), time.time())
    return {"ok": True}


# --- 管理员端点 ---

def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(403, "需要管理员权限")
    return user


@app.get("/auth/admin/users")
def admin_list_users(_admin: dict = Depends(require_admin)):
    users = database.list_users()
    for u in users:
        u["enabled"] = bool(u.get("enabled", 1))
    return {"users": users}


@app.delete("/auth/admin/users/{user_id}")
def admin_delete_user(user_id: int, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(400, "不能删除自己")
    admins = [u for u in database.list_users() if u.get("role") == "admin"]
    if len(admins) <= 1 and any(u["id"] == user_id for u in admins):
        raise HTTPException(400, "不能删除最后一个管理员")
    if not database.delete_user(user_id):
        raise HTTPException(404, "用户不存在")
    return {"ok": True}


@app.put("/auth/admin/users/{user_id}/role")
def admin_update_role(user_id: int, req: dict, _admin: dict = Depends(require_admin)):
    role = req.get("role")
    if role not in ("user", "admin"):
        raise HTTPException(400, "无效角色")

    # 不能降级最后一个管理员
    if role == "user":
        admins = [u for u in database.list_users() if u.get("role") == "admin"]
        if len(admins) <= 1 and any(u["id"] == user_id for u in admins):
            raise HTTPException(400, "不能移除最后一个管理员")

    if not database.update_user_role(user_id, role):
        raise HTTPException(404, "用户不存在")
    return {"ok": True}


@app.put("/auth/admin/users/{user_id}/password")
def admin_reset_password(user_id: int, req: ResetPasswordRequest, _admin: dict = Depends(require_admin)):
    if len(req.newPassword) < 8:
        raise HTTPException(400, "密码至少 8 个字符")
    salt = generate_salt()
    pw_hash = hash_password(req.newPassword, salt)
    if not database.update_user_password(user_id, pw_hash, salt):
        raise HTTPException(404, "用户不存在")
    return {"ok": True}


@app.put("/auth/admin/users/{user_id}/display-name")
def admin_update_display_name(user_id: int, req: UpdateDisplayNameRequest, _admin: dict = Depends(require_admin)):
    name = req.displayName.strip()[:64]
    if not name:
        raise HTTPException(400, "显示名不能为空")
    if not database.update_user_display_name(user_id, name):
        raise HTTPException(404, "用户不存在")
    return {"ok": True}


@app.put("/auth/admin/users/{user_id}/enabled")
def admin_toggle_enabled(user_id: int, req: UpdateEnabledRequest, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(400, "不能禁用自己的账号")
    if not database.update_user_enabled(user_id, req.enabled):
        raise HTTPException(404, "用户不存在")
    return {"ok": True}


@app.get("/auth/admin/users/{user_id}/settings")
def admin_get_user_settings(user_id: int, _admin: dict = Depends(require_admin)):
    data = database.get_user_settings(user_id)
    if not data:
        raise HTTPException(404, "用户不存在")
    return data


@app.post("/auth/admin/batch/delete")
def admin_batch_delete(req: BatchRequest, admin: dict = Depends(require_admin)):
    if not req.ids:
        raise HTTPException(400, "未选择用户")
    if admin["id"] in req.ids:
        raise HTTPException(400, "不能删除自己")
    admins = [u for u in database.list_users() if u.get("role") == "admin"]
    target_admins = [u for u in admins if u["id"] in req.ids]
    if len(admins) - len(target_admins) < 1:
        raise HTTPException(400, "不能删除所有管理员")
    deleted = database.batch_delete_users(req.ids)
    return {"ok": True, "deleted": deleted}


@app.post("/auth/admin/batch/enable")
def admin_batch_enable(req: BatchRequest, _admin: dict = Depends(require_admin)):
    if not req.ids:
        raise HTTPException(400, "未选择用户")
    count = database.batch_update_enabled(req.ids, True)
    return {"ok": True, "updated": count}


@app.post("/auth/admin/batch/disable")
def admin_batch_disable(req: BatchRequest, admin: dict = Depends(require_admin)):
    if not req.ids:
        raise HTTPException(400, "未选择用户")
    if admin["id"] in req.ids:
        raise HTTPException(400, "不能禁用自己的账号")

    # 不能禁用所有管理员
    users = database.list_users()
    admins = [u for u in users if u.get("role") == "admin"]
    target_admins = [u for u in admins if u["id"] in req.ids]
    if len(admins) - len(target_admins) < 1:
        raise HTTPException(400, "不能禁用所有管理员")

    count = database.batch_update_enabled(req.ids, False)
    return {"ok": True, "updated": count}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    print(f"Auth 服务启动: http://{config.DEFAULT_HOST}:{config.DEFAULT_PORT}")
    uvicorn.run(app, host=config.DEFAULT_HOST, port=config.DEFAULT_PORT)
