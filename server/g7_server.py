#!/usr/bin/env python3
"""Word Atlas main edition: static web root + accounts + progress sync backend.

Stdlib only. SQLite storage next to this file. Serves the built app (webroot/)
and /api/* on 0.0.0.0:8098, published as the word.678912.xyz origin.
"""
import base64
import hashlib
import hmac
import json
import mimetypes
import re
import secrets
import sqlite3
import time
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse, parse_qs, unquote

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "g7.db"
WEBROOT = HERE.parent / "webroot"
PORT = 8098
COOKIE = "g7_session"
COOKIE_PATH = "/"
SESSION_TTL = 30 * 24 * 3600
MAX_BODY = 3 * 1024 * 1024
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{2,20}$")
DATASET_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")

SEED_USERS = [("admin", "password", "admin"), ("lele", "123321", "user")]

# ---- dataset unit map (for admin progress setting) ----
ATLAS_INDEX = HERE.parent / "app-src" / "public" / "atlas" / "index.json"
DATASET_ID = "pep-g7s1-atlas"
GLOBAL_DATASET = "global"
UNIT_ORDER: list = []
UNIT_MAP: dict = {}
ALL_IDS: set = set()
UNIT_KEYS: dict = {}
ALL_KEYS: set = set()


def word_key(w: str) -> str:
    """Shared-pool key for a word; mirrors the client's normalize()."""
    s = unicodedata.normalize("NFKC", str(w))
    s = s.replace("’", "'").replace("‘", "'")
    s = re.sub(r"[‐‑–—]", "-", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip().lower()
DAY_MS = 86400_000


def load_units():
    global UNIT_ORDER, UNIT_MAP, ALL_IDS, UNIT_KEYS, ALL_KEYS
    try:
        idx = json.loads(ATLAS_INDEX.read_text(encoding="utf-8"))
        fi = idx["fields"].index("cefr")
        ii = idx["fields"].index("id")
        wi = idx["fields"].index("word")
        UNIT_ORDER = list(idx["cefr"])
        m = {u: [] for u in UNIT_ORDER}
        km = {u: set() for u in UNIT_ORDER}
        for w in idx["words"]:
            m[UNIT_ORDER[w[fi]]].append(w[ii])
            km[UNIT_ORDER[w[fi]]].add(word_key(w[wi]))
        UNIT_MAP = m
        UNIT_KEYS = km
        ALL_IDS = {i for ids in m.values() for i in ids}
        ALL_KEYS = set().union(*km.values()) if km else set()
        print(f"units loaded: {[(u, len(UNIT_MAP[u])) for u in UNIT_ORDER]}", flush=True)
    except Exception as e:
        print(f"unit map load failed: {e}", flush=True)


def learned_card(now: int) -> dict:
    """A plausible 'already learned' FSRS card (Review state, stability 25d)."""
    return {"due": now + 24 * DAY_MS, "s": 25, "d": 5, "el": 1, "sd": 24, "ls": 0,
            "reps": 4, "lapses": 0, "st": 2, "last": now - DAY_MS, "seen": now - 21 * DAY_MS}


def completed_units(cards: dict) -> int:
    n = 0
    for u in UNIT_ORDER:
        keys = UNIT_KEYS.get(u, set())
        if keys and all(k in cards for k in keys):
            n += 1
        else:
            break
    return n


# Stage maps for EVERY dataset in the manifest: a dataset's "stages" are the
# bands of its index file (PEP: Unit 1..9; IELTS: A1..C2), keyed by word.
STAGE_ORDER: dict = {}
STAGE_KEYS: dict = {}
STAGE_ALL: dict = {}


def load_stages():
    global STAGE_ORDER, STAGE_KEYS, STAGE_ALL
    order, keys, allk = {}, {}, {}
    for d in manifest_datasets():
        try:
            idx_path = WEBROOT.joinpath(*d["root"].split("/")) / "index.json"
            idx = json.loads(idx_path.read_text(encoding="utf-8"))
            fi = idx["fields"].index("cefr")
            wi = idx["fields"].index("word")
            names = list(idx["cefr"])
            km = {nm: set() for nm in names}
            for w in idx["words"]:
                km[names[w[fi]]].add(word_key(w[wi]))
            order[d["id"]] = names
            keys[d["id"]] = km
            allk[d["id"]] = set().union(*km.values()) if km else set()
            print(f"stages loaded {d['id']}: {[(nm, len(km[nm])) for nm in names]}", flush=True)
        except Exception as e:
            print(f"stage load failed for {d['id']}: {e}", flush=True)
    STAGE_ORDER, STAGE_KEYS, STAGE_ALL = order, keys, allk


def completed_stages(ds: str, cards: dict) -> int:
    n = 0
    for nm in STAGE_ORDER.get(ds, []):
        ks = STAGE_KEYS.get(ds, {}).get(nm, set())
        if ks and all(k in cards for k in ks):
            n += 1
        else:
            break
    return n


def manifest_datasets():
    """Dataset manifest: edit datasets.json next to this file to add a library."""
    try:
        data = json.loads((HERE / "datasets.json").read_text(encoding="utf-8"))
        out = []
        for d in data.get("datasets", []):
            if isinstance(d, dict) and d.get("id") and d.get("root"):
                out.append({"id": str(d["id"]), "name": str(d.get("name") or d["id"]),
                            "desc": str(d.get("desc") or ""), "root": str(d["root"]),
                            "count": int(d.get("count") or 0)})
        if out:
            return out
    except Exception:
        pass
    return [{"id": DATASET_ID, "name": "人教版七上", "desc": "教学词库 · 七年级上册课本词",
             "root": "atlas", "count": 423}]


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000, dklen=32)
    return "pbkdf2$100000$%s$%s" % (base64.urlsafe_b64encode(salt).decode(),
                                    base64.urlsafe_b64encode(dk).decode())


def check_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt_b64, hash_b64 = stored.split("$")
        salt = base64.urlsafe_b64decode(salt_b64)
        expect = base64.urlsafe_b64decode(hash_b64)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(iters), dklen=len(expect))
        return hmac.compare_digest(dk, expect)
    except Exception:
        return False


def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY, pass_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
        disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS progress (
        username TEXT NOT NULL, dataset TEXT NOT NULL, data TEXT NOT NULL,
        client_ts INTEGER NOT NULL, server_ts INTEGER NOT NULL,
        PRIMARY KEY (username, dataset));
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_prefs (
        username TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
        PRIMARY KEY (username, key));
    """)
    conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('register_open', '1')")
    for username, password, role in SEED_USERS:
        row = conn.execute("SELECT username FROM users WHERE username = ?", (username,)).fetchone()
        if not row:
            conn.execute("INSERT INTO users (username, pass_hash, role, disabled, created_at) VALUES (?, ?, ?, 0, ?)",
                         (username, hash_password(password), role, int(time.time())))
    conn.commit()
    conn.close()


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    # ---------- helpers ----------
    def _send(self, status, obj, cookie=None, clear_cookie=False):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie",
                             f"{COOKIE}={cookie}; Path={COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age={SESSION_TTL}")
        if clear_cookie:
            self.send_header("Set-Cookie",
                             f"{COOKIE}=; Path={COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0")
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return None
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw)
        except Exception:
            return None

    def _session_user(self):
        cookie = self.headers.get("Cookie") or ""
        token = None
        for part in cookie.split(";"):
            part = part.strip()
            if part.startswith(COOKIE + "="):
                token = part[len(COOKIE) + 1:]
        if not token:
            return None
        conn = db()
        row = conn.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone()
        if not row or row["expires"] < int(time.time()):
            conn.close()
            return None
        user = conn.execute("SELECT * FROM users WHERE username = ?", (row["username"],)).fetchone()
        conn.close()
        if not user or user["disabled"]:
            return None
        return {"username": user["username"], "role": user["role"]}

    def _new_session(self, username):
        token = secrets.token_urlsafe(32)
        conn = db()
        conn.execute("DELETE FROM sessions WHERE expires < ?", (int(time.time()),))
        conn.execute("INSERT INTO sessions (token, username, expires) VALUES (?, ?, ?)",
                     (token, username, int(time.time()) + SESSION_TTL))
        conn.commit()
        conn.close()
        return token

    def _require_admin(self):
        user = self._session_user()
        if not user:
            self._send(401, {"error": "请先登录。"})
            return None
        if user["role"] != "admin":
            self._send(403, {"error": "需要管理员权限。"})
            return None
        return user

    def _static(self, path):
        rel = unquote(path).lstrip("/")
        parts = [p for p in PurePosixPath(rel).parts if p not in ("", ".", "..")]
        target = WEBROOT.joinpath(*parts) if parts else WEBROOT / "index.html"
        if not target.is_file():
            if parts and "." in parts[-1]:
                data = b"not found"
                self.send_response(404)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            target = WEBROOT / "index.html"
            if not target.is_file():
                return self._send(404, {"error": "应用尚未部署。"})
        data = target.read_bytes()
        mime_map = {".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                    ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp",
                    ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg",
                    ".woff2": "font/woff2", ".woff": "font/woff"}
        ctype = mime_map.get(target.suffix) or mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if target.suffix in (".html", ".js", ".css", ".json", ".svg"):
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if target.name == "index.html":
            self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # ---------- routes ----------
    def do_GET(self):
        u = urlparse(self.path)
        path, qs = u.path, parse_qs(u.query)
        if not path.startswith("/api/"):
            return self._static(path)
        if path == "/api/health":
            return self._send(200, {"ok": True})
        if path == "/api/datasets":
            return self._send(200, {"datasets": manifest_datasets()})
        if path == "/api/user/prefs":
            user = self._session_user()
            if not user:
                return self._send(401, {"error": "请先登录。"})
            conn = db()
            row = conn.execute("SELECT value FROM user_prefs WHERE username = ? AND key = 'datasets'",
                               (user["username"],)).fetchone()
            conn.close()
            ids = None
            if row:
                try:
                    ids = json.loads(row["value"])
                except Exception:
                    ids = None
            if not isinstance(ids, list) or not ids:
                ids = [DATASET_ID]
            return self._send(200, {"datasets": [str(x) for x in ids]})
        if path == "/api/settings":
            conn = db()
            row = conn.execute("SELECT value FROM settings WHERE key = 'register_open'").fetchone()
            conn.close()
            return self._send(200, {"register_open": (row["value"] == "1") if row else True})
        if path == "/api/auth/me":
            user = self._session_user()
            if not user:
                return self._send(401, {"error": "未登录。"})
            return self._send(200, user)
        if path == "/api/progress":
            user = self._session_user()
            if not user:
                return self._send(401, {"error": "请先登录。"})
            dataset = (qs.get("dataset") or [""])[0]
            if not DATASET_RE.match(dataset):
                return self._send(400, {"error": "词库参数不正确。"})
            conn = db()
            row = conn.execute("SELECT data, client_ts, server_ts FROM progress WHERE username = ? AND dataset = ?",
                               (user["username"], dataset)).fetchone()
            conn.close()
            if not row:
                return self._send(200, {"progress": None, "clientTs": 0, "serverTs": 0})
            return self._send(200, {"progress": json.loads(row["data"]),
                                    "clientTs": row["client_ts"], "serverTs": row["server_ts"]})
        if path == "/api/admin/users":
            if not self._require_admin():
                return
            conn = db()
            users = conn.execute("SELECT username, role, disabled, created_at FROM users ORDER BY created_at, username").fetchall()
            out = []
            for r in users:
                cards = 0
                units = 0
                stages = {}
                for pr in conn.execute("SELECT dataset, data FROM progress WHERE username = ?", (r["username"],)):
                    try:
                        pcards = json.loads(pr["data"]).get("cards") or {}
                        if pr["dataset"] == GLOBAL_DATASET:
                            cards = len(pcards)
                            units = completed_units(pcards)
                            stages = {ds: completed_stages(ds, pcards) for ds in STAGE_ORDER}
                    except Exception:
                        pass
                out.append({"username": r["username"], "role": r["role"], "disabled": bool(r["disabled"]),
                            "created_at": r["created_at"], "cards": cards, "units": units, "stages": stages})
            conn.close()
            return self._send(200, {"users": out, "unitTotal": len(UNIT_ORDER),
                                    "stageTotals": {ds: len(v) for ds, v in STAGE_ORDER.items()}})
        return self._send(404, {"error": "接口不存在。"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/auth/register":
            body = self._body() or {}
            username = str(body.get("username") or "").strip()
            password = str(body.get("password") or "")
            if not USERNAME_RE.match(username):
                return self._send(400, {"error": "账号需为 2–20 位字母、数字或下划线。"})
            if len(password) < 4 or len(password) > 64:
                return self._send(400, {"error": "密码至少 4 位。"})
            conn = db()
            row = conn.execute("SELECT value FROM settings WHERE key = 'register_open'").fetchone()
            if row and row["value"] != "1":
                conn.close()
                return self._send(403, {"error": "注册已关闭，请联系管理员。"})
            exists = conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
            if exists:
                conn.close()
                return self._send(409, {"error": "这个账号名已经被注册了。"})
            conn.execute("INSERT INTO users (username, pass_hash, role, disabled, created_at) VALUES (?, ?, 'user', 0, ?)",
                         (username, hash_password(password), int(time.time())))
            conn.commit()
            conn.close()
            token = self._new_session(username)
            return self._send(201, {"username": username, "role": "user"}, cookie=token)
        if path == "/api/auth/login":
            body = self._body() or {}
            username = str(body.get("username") or "").strip()
            password = str(body.get("password") or "")
            conn = db()
            row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            conn.close()
            if not row or not check_password(password, row["pass_hash"]):
                return self._send(401, {"error": "账号或密码不正确。"})
            if row["disabled"]:
                return self._send(403, {"error": "这个账号已被停用，请联系管理员。"})
            token = self._new_session(username)
            return self._send(200, {"username": username, "role": row["role"]}, cookie=token)
        if path == "/api/auth/logout":
            cookie = self.headers.get("Cookie") or ""
            for part in cookie.split(";"):
                part = part.strip()
                if part.startswith(COOKIE + "="):
                    conn = db()
                    conn.execute("DELETE FROM sessions WHERE token = ?", (part[len(COOKIE) + 1:],))
                    conn.commit()
                    conn.close()
            return self._send(200, {"ok": True}, clear_cookie=True)
        if path == "/api/admin/register-open":
            if not self._require_admin():
                return
            body = self._body() or {}
            conn = db()
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('register_open', ?)",
                         ("1" if body.get("open") else "0",))
            conn.commit()
            conn.close()
            return self._send(200, {"register_open": bool(body.get("open"))})
        if path == "/api/admin/progress":
            if not self._require_admin():
                return
            body = self._body() or {}
            username = str(body.get("username") or "").strip()
            ds = str(body.get("dataset") or DATASET_ID)
            if ds not in STAGE_ORDER:
                return self._send(400, {"error": "词库不存在。"})
            try:
                units = int(body.get("stages", body.get("units")))
            except Exception:
                return self._send(400, {"error": "阶段数不正确。"})
            units = max(0, min(units, len(STAGE_ORDER[ds])))
            conn = db()
            row = conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
            if not row:
                conn.close()
                return self._send(404, {"error": "账号不存在。"})
            prow = conn.execute("SELECT data FROM progress WHERE username = ? AND dataset = ?",
                                (username, GLOBAL_DATASET)).fetchone()
            if prow:
                try:
                    progress = json.loads(prow["data"])
                except Exception:
                    progress = None
            else:
                progress = None
            if not isinstance(progress, dict) or progress.get("version") != 2:
                progress = {"version": 2, "datasetId": GLOBAL_DATASET, "cards": {}, "bookmarks": [],
                            "days": {}, "typing": [], "session": None, "mistakes": []}
            cur_cards = progress.get("cards") or {}
            keep = set()
            for nm in STAGE_ORDER[ds][:units]:
                keep.update(STAGE_KEYS[ds].get(nm, set()))
            # Words covered by stages this account has completed in OTHER
            # datasets are protected: dialling this dataset back must not
            # strip progress that belongs to another dataset's stages.
            protected = set()
            for other, onames in STAGE_ORDER.items():
                if other == ds:
                    continue
                for nm in onames[:completed_stages(other, cur_cards)]:
                    protected.update(STAGE_KEYS[other].get(nm, set()))
            allk = STAGE_ALL.get(ds, set())
            now = int(time.time() * 1000)
            new_cards = {}
            for key, card in cur_cards.items():
                if key in keep or key not in allk or key in protected:
                    new_cards[key] = card
            for key in keep:
                if key not in new_cards:
                    new_cards[key] = learned_card(now)
            progress["cards"] = new_cards
            progress["session"] = None
            conn.execute("INSERT OR REPLACE INTO progress (username, dataset, data, client_ts, server_ts) VALUES (?, ?, ?, ?, ?)",
                         (username, GLOBAL_DATASET, json.dumps(progress, ensure_ascii=False), now, now))
            conn.commit()
            conn.close()
            return self._send(200, {"ok": True, "cards": len(new_cards), "units": units,
                                    "stages": units, "dataset": ds})
        if path == "/api/admin/user":
            admin = self._require_admin()
            if not admin:
                return
            body = self._body() or {}
            username = str(body.get("username") or "").strip()
            action = str(body.get("action") or "")
            if username == admin["username"] and action in ("disable", "delete"):
                return self._send(400, {"error": "不能停用或删除当前登录的管理员账号。"})
            conn = db()
            row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            if not row:
                conn.close()
                return self._send(404, {"error": "账号不存在。"})
            if action == "disable":
                conn.execute("UPDATE users SET disabled = 1 WHERE username = ?", (username,))
                conn.execute("DELETE FROM sessions WHERE username = ?", (username,))
            elif action == "enable":
                conn.execute("UPDATE users SET disabled = 0 WHERE username = ?", (username,))
            elif action == "reset":
                password = str(body.get("password") or "")
                if len(password) < 4 or len(password) > 64:
                    conn.close()
                    return self._send(400, {"error": "新密码至少 4 位。"})
                conn.execute("UPDATE users SET pass_hash = ? WHERE username = ?",
                             (hash_password(password), username))
                conn.execute("DELETE FROM sessions WHERE username = ?", (username,))
            elif action == "delete":
                conn.execute("DELETE FROM users WHERE username = ?", (username,))
                conn.execute("DELETE FROM sessions WHERE username = ?", (username,))
                conn.execute("DELETE FROM progress WHERE username = ?", (username,))
            else:
                conn.close()
                return self._send(400, {"error": "未知操作。"})
            conn.commit()
            conn.close()
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "接口不存在。"})

    def do_PUT(self):
        path = urlparse(self.path).path
        if path == "/api/user/prefs":
            user = self._session_user()
            if not user:
                return self._send(401, {"error": "请先登录。"})
            body = self._body() or {}
            known = {d["id"] for d in manifest_datasets()}
            ids = [str(x) for x in (body.get("datasets") or []) if str(x) in known]
            ids = list(dict.fromkeys(ids))
            if not ids:
                return self._send(400, {"error": "至少要保留一个词库。"})
            conn = db()
            conn.execute("INSERT OR REPLACE INTO user_prefs (username, key, value) VALUES (?, 'datasets', ?)",
                         (user["username"], json.dumps(ids)))
            conn.commit()
            conn.close()
            return self._send(200, {"datasets": ids})
        if path == "/api/progress":
            user = self._session_user()
            if not user:
                return self._send(401, {"error": "请先登录。"})
            body = self._body()
            if body is None:
                return self._send(413, {"error": "进度数据过大或格式不对。"})
            dataset = str(body.get("dataset") or "")
            progress = body.get("progress")
            client_ts = int(body.get("clientTs") or 0)
            if not DATASET_RE.match(dataset) or not isinstance(progress, dict) \
                    or progress.get("version") != 2 or progress.get("datasetId") != dataset:
                return self._send(400, {"error": "进度数据不合法。"})
            now = int(time.time() * 1000)
            conn = db()
            conn.execute("INSERT OR REPLACE INTO progress (username, dataset, data, client_ts, server_ts) VALUES (?, ?, ?, ?, ?)",
                         (user["username"], dataset, json.dumps(progress, ensure_ascii=False), client_ts, now))
            conn.commit()
            conn.close()
            return self._send(200, {"serverTs": now, "clientTs": client_ts})
        return self._send(404, {"error": "接口不存在。"})


if __name__ == "__main__":
    init_db()
    load_units()
    load_stages()
    print(f"word-atlas server on 0.0.0.0:{PORT}, db={DB_PATH}, webroot={WEBROOT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
