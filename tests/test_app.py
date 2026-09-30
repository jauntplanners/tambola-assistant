import os

import bcrypt

os.environ["APP_USERNAME"] = "tester"
os.environ["APP_PASSWORD_HASH"] = bcrypt.hashpw(b"pw-for-tests", bcrypt.gensalt(4)).decode()
os.environ["SESSION_SECRET"] = "test-secret"
os.environ["DEV_MODE"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402

GOOD = {"username": "tester", "password": "pw-for-tests"}


def client():
    main._fails.clear()
    return TestClient(main.app, follow_redirects=False)


def test_index_redirects_when_logged_out():
    r = client().get("/")
    assert r.status_code == 303 and r.headers["location"] == "/login"


def test_login_then_index():
    c = client()
    r = c.post("/login", data=GOOD)
    assert r.headers["location"] == "/"
    assert c.get("/").status_code == 200


def test_wrong_password_and_lockout():
    c = client()
    for _ in range(5):
        assert c.post("/login", data={**GOOD, "password": "nope"}).headers["location"] == "/login?e=bad"
    # correct password is refused while locked
    assert c.post("/login", data=GOOD).headers["location"] == "/login?e=locked"
