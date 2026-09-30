import logging
import os
import secrets
import time
from collections import defaultdict, deque
from pathlib import Path

import bcrypt
from fastapi import FastAPI, Form, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware


log = logging.getLogger("tambola")

STATIC = Path(__file__).parent / "static"
DEV_MODE = os.environ.get("DEV_MODE") == "1"

APP_USERNAME = os.environ.get("APP_USERNAME", "")
APP_PASSWORD_HASH = os.environ.get("APP_PASSWORD_HASH", "").encode()
SESSION_SECRET = os.environ.get("SESSION_SECRET") or secrets.token_hex(32)
if not os.environ.get("SESSION_SECRET"):
    log.warning("SESSION_SECRET not set; sessions reset on every restart.")
if not (APP_USERNAME and APP_PASSWORD_HASH):
    log.warning("APP_USERNAME / APP_PASSWORD_HASH not set; login is disabled.")

# Failed-login throttle: 5 failures per IP per 10 minutes.
LOGIN_WINDOW = 600
LOGIN_MAX_FAILS = 5
_fails: dict[str, deque] = defaultdict(deque)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    max_age=12 * 3600,
    same_site="strict",
    https_only=not DEV_MODE,
)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


def _authed(request: Request) -> bool:
    return request.session.get("user") == APP_USERNAME and bool(APP_USERNAME)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")


def _check_password(username: str, password: str) -> bool:
    if not (APP_USERNAME and APP_PASSWORD_HASH):
        return False
    try:
        ok_pw = bcrypt.checkpw(password.encode(), APP_PASSWORD_HASH)
    except ValueError:
        log.error("APP_PASSWORD_HASH is not a valid bcrypt hash.")
        return False
    return secrets.compare_digest(username, APP_USERNAME) and ok_pw


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/")
def index(request: Request):
    if not _authed(request):
        return RedirectResponse("/login", status_code=303)
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/login")
def login_page(request: Request):
    if _authed(request):
        return RedirectResponse("/", status_code=303)
    return FileResponse(STATIC / "login.html")


@app.post("/login")
def login(request: Request, username: str = Form(...), password: str = Form(...)):
    ip = _client_ip(request)
    now = time.time()
    fails = _fails[ip]
    while fails and now - fails[0] > LOGIN_WINDOW:
        fails.popleft()
    if len(fails) >= LOGIN_MAX_FAILS:
        return RedirectResponse("/login?e=locked", status_code=303)
    if not _check_password(username, password):
        fails.append(now)
        return RedirectResponse("/login?e=bad", status_code=303)
    fails.clear()
    request.session.clear()
    request.session["user"] = APP_USERNAME
    return RedirectResponse("/", status_code=303)


@app.post("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)

