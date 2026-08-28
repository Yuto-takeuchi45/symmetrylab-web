"""
SYMMETRY Lab 予約・決済サーバー（本番対応版）
FastAPI + Stripe Checkout + SQLite + Excel出力 + メール通知
"""

import json
import os
import html
import re
import csv
import hmac
import smtplib
import sqlite3
import traceback
import urllib.request
import urllib.error
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from io import BytesIO, StringIO
from pathlib import Path
from typing import Optional
from uuid import uuid4
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from .article_seed_data import SEED_ARTICLES

ARTICLE_SLUG_REDIRECTS = {
    article["legacy_slug"]: article["slug"]
    for article in SEED_ARTICLES
    if article.get("legacy_slug")
}

import openpyxl
import stripe
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openpyxl.styles import Alignment, Font, PatternFill
from pydantic import BaseModel

load_dotenv()

stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
STRIPE_WEBHOOK_SECRET_TEST = os.getenv("STRIPE_WEBHOOK_SECRET_TEST", "")
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
ADMIN_KEY = os.getenv("ADMIN_KEY", "").strip()
DB_PATH = os.getenv("DB_PATH", "bookings.db")
JST = ZoneInfo("Asia/Tokyo")

# DBパスの親ディレクトリが書き込み不可ならローカル bookings.db にフォールバック
# （Render Freeプランで永続ディスク /var/data が使えないケース等）
_db_dir = os.path.dirname(DB_PATH)
if _db_dir:
    try:
        os.makedirs(_db_dir, exist_ok=True)
        _probe = os.path.join(_db_dir, ".write_probe")
        with open(_probe, "w") as _f:
            _f.write("")
        os.remove(_probe)
    except (PermissionError, OSError) as _e:
        print(f"[起動] DB_PATH={DB_PATH} の親ディレクトリが書き込み不可（{_e}）→ ./bookings.db にフォールバック")
        DB_PATH = "bookings.db"

DEFAULT_TRAINING_DATES = Path(__file__).parent / "training_dates.json"
TRAINING_DATES_PATH = Path(os.getenv("TRAINING_DATES_PATH", str(DEFAULT_TRAINING_DATES)))
DEFAULT_REFERRAL_CODES = Path(__file__).parent / "referral_codes.json"
REFERRAL_CODES_PATH = Path(os.getenv("REFERRAL_CODES_PATH", str(DEFAULT_REFERRAL_CODES)))

# 起動毎にリポジトリ同梱のデフォルトを永続ディスクへ反映
# ただし管理画面で設定する available_slots / blocked_dates は永続ディスク側を維持
try:
    if DEFAULT_TRAINING_DATES.exists():
        with open(DEFAULT_TRAINING_DATES, "r", encoding="utf-8") as _f:
            _default_data = json.load(_f)

        _persistent_data = {}
        if TRAINING_DATES_PATH.exists():
            try:
                with open(TRAINING_DATES_PATH, "r", encoding="utf-8") as _f:
                    _persistent_data = json.load(_f)
            except Exception:
                _persistent_data = {}

        # マージ：価格・名前等はデフォルトを優先、available_slots/blocked_dates は永続側を維持
        for _t_type in _default_data:
            if _t_type in _persistent_data:
                for _preserve_key in ("available_slots", "blocked_dates"):
                    if _preserve_key in _persistent_data[_t_type]:
                        _default_data[_t_type][_preserve_key] = _persistent_data[_t_type][_preserve_key]

        TRAINING_DATES_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(TRAINING_DATES_PATH, "w", encoding="utf-8") as _f:
            json.dump(_default_data, _f, ensure_ascii=False, indent=2)
        print(f"[起動] training_dates.json をデフォルトとマージして反映")
except Exception as _e:
    print(f"[起動] training_dates.json のマージ失敗（デフォルトを使用）: {_e}")
    if not TRAINING_DATES_PATH.exists():
        TRAINING_DATES_PATH = DEFAULT_TRAINING_DATES

try:
    if not REFERRAL_CODES_PATH.exists() and DEFAULT_REFERRAL_CODES.exists():
        REFERRAL_CODES_PATH.parent.mkdir(parents=True, exist_ok=True)
        REFERRAL_CODES_PATH.write_text(DEFAULT_REFERRAL_CODES.read_text(encoding="utf-8"), encoding="utf-8")
except Exception as _e:
    print(f"[起動] referral_codes.json の永続化領域への初期化に失敗（デフォルトを使用）: {_e}")
    REFERRAL_CODES_PATH = DEFAULT_REFERRAL_CODES

# --- メール設定 ---
SMTP_EMAIL = os.getenv("SMTP_EMAIL", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
# ADMIN_EMAIL はカンマ区切りで複数指定可能（例: "admin1@example.com,admin2@example.com"）
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", SMTP_EMAIL)

# --- Resend（HTTPS API）設定 ---
# RESEND_API_KEY が設定されていれば Resend を優先使用、未設定なら SMTP にフォールバック
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
# 送信元アドレスは Resend 認証済みドメインのみ使用可能。
# 未設定時は Resend のテスト用アドレス onboarding@resend.dev を使う
# （SMTP_EMAIL に Gmail 等を設定していても流用しない。Gmail は Resend で認証不可）
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "onboarding@resend.dev")
RESEND_FROM_NAME = os.getenv("RESEND_FROM_NAME", "SYMMETRY Lab")


def get_admin_emails() -> list:
    """ADMIN_EMAIL（カンマ区切り）をリストに分解して返す"""
    if not ADMIN_EMAIL:
        return []
    return [e.strip() for e in ADMIN_EMAIL.split(",") if e.strip()]

# --- LINE設定 ---
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")

app = FastAPI(title="SYMMETRY Lab Booking API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- データモデル ---
class CheckoutRequest(BaseModel):
    training_type: str
    training_date: str
    customer_name: str
    customer_email: str
    customer_phone: str = ""
    customer_company: str = ""
    sessions: int = 1
    booking_notes: str = ""  # 第1〜第3希望など補足情報（Stripe metadataへ退避）
    referral_code: str = ""


class CareerApplicationRequest(BaseModel):
    client_submission_id: str
    website: str = ""
    name: str
    email: str
    phone: str
    industry: str
    job: str
    experience: str
    income: str
    area: str
    timing: str
    status: str
    message: str = ""
    appointment: str = ""
    appointment_mode: str = ""
    consent: bool
    gclid: str = ""
    gbraid: str = ""
    wbraid: str = ""
    utm_source: str = ""
    utm_medium: str = ""
    utm_campaign: str = ""
    utm_term: str = ""
    utm_content: str = ""
    landing_page: str = "/consulting-career/"
    first_touch_at: str = ""
    last_touch_at: str = ""


class CareerApplicationStatusRequest(BaseModel):
    status: str
    admin_notes: str = ""


# --- SQLite ---
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def editorial_content(article: dict) -> str:
    """Keep repository-seeded articles aligned with SymmetryLab's CTA policy."""
    content = article["content"].rstrip()
    if "内定率" in content:
        return content
    replacements = (
        (
            "大手外資コンサル出身者だけで構成されたチームが、経験の棚卸しからケース面接対策まで丁寧に伴走し、内定獲得に向けた準備を具体化します。",
            "大手外資コンサル出身者による丁寧なケース面接対策と高い内定率を強みに、経験の棚卸しから内定獲得までの準備を具体化します。",
        ),
        (
            "大手外資コンサル出身者が、受講者一人ひとりの思考の癖に合わせて丁寧にケース面接を指導し、転職に向けた準備を具体的に整えます。",
            "大手外資コンサル出身者が、受講者一人ひとりの思考の癖に合わせて丁寧にケース面接を指導し、高い内定率を支える準備を具体的に整えます。",
        ),
        (
            "戦略を描くチームと、システムや業務を実装するチームが別れているケース",
            "戦略を描くチームと、システムや業務を実装するチームが分かれているケース",
        ),
    )
    for before, after in replacements:
        if before in content:
            return content.replace(before, after)
    return content + "\n\nSymmetryLabは大手外資コンサル出身者による丁寧なケース面接対策と高い内定率を強みに、コンサル転職を支援しています。"


def seed_articles(conn):
    """Insert reviewed repository articles once without overwriting CMS edits."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS article_seed_history (
            slug TEXT PRIMARY KEY,
            seeded_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS article_seed_revision_history (
            slug TEXT NOT NULL,
            revision_id TEXT NOT NULL,
            applied_at TEXT NOT NULL,
            PRIMARY KEY (slug, revision_id)
        )
    """)
    now = datetime.now(JST).strftime("%Y-%m-%dT%H:%M:%S")
    for article in SEED_ARTICLES:
        slug = article["slug"]
        legacy_slug = article.get("legacy_slug")
        if legacy_slug:
            legacy = conn.execute("SELECT id FROM articles WHERE slug = ?", (legacy_slug,)).fetchone()
            current = conn.execute("SELECT id FROM articles WHERE slug = ?", (slug,)).fetchone()
            if legacy and not current:
                conn.execute("UPDATE articles SET slug = ? WHERE slug = ?", (slug, legacy_slug))
        existing = conn.execute("SELECT id FROM articles WHERE slug = ?", (slug,)).fetchone()
        if existing:
            revision_id = article.get("revision_id")
            if revision_id:
                revision = conn.execute(
                    "SELECT 1 FROM article_seed_revision_history WHERE slug = ? AND revision_id = ?",
                    (slug, revision_id),
                ).fetchone()
                if not revision:
                    conn.execute("""
                        UPDATE articles
                        SET title = ?, category = ?, excerpt = ?, content = ?,
                            cover_image_url = ?, meta_title = ?, meta_description = ?,
                            updated_at = ?
                        WHERE slug = ?
                    """, (
                        article["title"],
                        article.get("category", "コラム"),
                        article.get("excerpt", ""),
                        editorial_content(article),
                        article.get("cover_image_url", ""),
                        article.get("meta_title", article["title"]),
                        article.get("meta_description", article.get("excerpt", "")),
                        now,
                        slug,
                    ))
                    conn.execute(
                        "INSERT INTO article_seed_revision_history (slug, revision_id, applied_at) VALUES (?, ?, ?)",
                        (slug, revision_id, now),
                    )
            conn.execute(
                "INSERT OR IGNORE INTO article_seed_history (slug, seeded_at) VALUES (?, ?)",
                (slug, now),
            )
            continue
        seeded = conn.execute(
            "SELECT slug FROM article_seed_history WHERE slug = ?", (slug,)
        ).fetchone()
        if seeded:
            continue
        published_at = article.get("published_at") or now
        conn.execute("""
            INSERT INTO articles
            (slug, title, category, excerpt, content, cover_image_url, meta_title,
             meta_description, status, published_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)
        """, (
            slug,
            article["title"],
            article.get("category", "コラム"),
            article.get("excerpt", ""),
            editorial_content(article),
            article.get("cover_image_url", ""),
            article.get("meta_title", article["title"]),
            article.get("meta_description", article.get("excerpt", "")),
            published_at,
            published_at,
            published_at,
        ))
        conn.execute(
            "INSERT INTO article_seed_history (slug, seeded_at) VALUES (?, ?)",
            (slug, now),
        )


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_id TEXT,
            created_at TEXT,
            training_type TEXT,
            training_name TEXT,
            training_date TEXT,
            customer_name TEXT,
            customer_email TEXT,
            customer_phone TEXT,
            customer_company TEXT,
            amount INTEGER,
            payment_status TEXT DEFAULT 'paid',
            stripe_session_id TEXT UNIQUE,
            notes TEXT DEFAULT ''
        )
    """)
    conn.execute("UPDATE bookings SET payment_status = 'paid' WHERE payment_status = '完了'")
    conn.execute("UPDATE bookings SET created_at = REPLACE(created_at, '/', '-') WHERE created_at LIKE '____/__/__%'")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '',
            excerpt TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            cover_image_url TEXT NOT NULL DEFAULT '',
            meta_title TEXT NOT NULL DEFAULT '',
            meta_description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            published_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_articles_public ON articles(status, published_at DESC)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS career_applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id TEXT NOT NULL UNIQUE,
            client_submission_id TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            application_status TEXT NOT NULL DEFAULT 'new',
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            industry TEXT NOT NULL,
            job TEXT NOT NULL,
            experience TEXT NOT NULL,
            income TEXT NOT NULL,
            area TEXT NOT NULL,
            timing TEXT NOT NULL,
            activity_status TEXT NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            appointment TEXT NOT NULL DEFAULT '',
            appointment_mode TEXT NOT NULL DEFAULT '',
            consent_at TEXT NOT NULL,
            privacy_policy_version TEXT NOT NULL,
            gclid TEXT NOT NULL DEFAULT '',
            gbraid TEXT NOT NULL DEFAULT '',
            wbraid TEXT NOT NULL DEFAULT '',
            utm_source TEXT NOT NULL DEFAULT '',
            utm_medium TEXT NOT NULL DEFAULT '',
            utm_campaign TEXT NOT NULL DEFAULT '',
            utm_term TEXT NOT NULL DEFAULT '',
            utm_content TEXT NOT NULL DEFAULT '',
            landing_page TEXT NOT NULL DEFAULT '',
            first_touch_at TEXT NOT NULL DEFAULT '',
            last_touch_at TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT 'unknown',
            admin_notes TEXT NOT NULL DEFAULT ''
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_career_applications_created ON career_applications(created_at DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_career_applications_status ON career_applications(application_status)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS career_application_status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id TEXT NOT NULL,
            status TEXT NOT NULL,
            changed_at TEXT NOT NULL,
            admin_notes TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (application_id) REFERENCES career_applications(application_id)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_career_status_history_application ON career_application_status_history(application_id, changed_at)")
    seed_articles(conn)
    conn.commit()
    conn.close()


def save_booking(session_data: dict) -> bool:
    """予約をDBに保存。新規挿入時True、既存（重複）ならFalseを返す"""
    metadata = session_data.get("metadata", {})
    session_id = session_data.get("id", "")
    short_id = session_id[-8:] if session_id else ""
    amount = session_data.get("amount_total", 0)
    if amount and isinstance(amount, int) and amount > 1000:
        pass  # already in yen
    else:
        amount = int(metadata.get("price", 0))

    conn = get_db()
    try:
        conn.execute("""
            INSERT OR IGNORE INTO bookings
            (booking_id, created_at, training_type, training_name, training_date,
             customer_name, customer_email, customer_phone, customer_company,
             amount, payment_status, stripe_session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?)
        """, (
            short_id,
            datetime.now().strftime("%Y-%m-%d %H:%M"),
            metadata.get("training_type", ""),
            metadata.get("training_name", ""),
            metadata.get("training_date", ""),
            metadata.get("customer_name", ""),
            metadata.get("customer_email", ""),
            metadata.get("customer_phone", ""),
            metadata.get("customer_company", ""),
            amount,
            session_id,
        ))
        conn.commit()
        inserted = conn.total_changes > 0
        if inserted:
            print(f"[予約保存] {metadata.get('customer_name', '')} - {metadata.get('training_name', '')} ({metadata.get('training_date', '')})")
        else:
            print(f"[予約スキップ] session_id={session_id} は既に記録済み")
        return inserted
    finally:
        conn.close()


def resolve_training(training_type: str, data: Optional[dict] = None):
    """case_interview_new/mid → case_interview へのフォールバックを一元化"""
    if data is None:
        data = load_training_dates()
    training = data.get(training_type)
    if not training and training_type in ("case_interview_new", "case_interview_mid"):
        training = data.get("case_interview")
    return training


def _count_used_slots(conn: sqlite3.Connection, training_type: str, date: str) -> int:
    training = resolve_training(training_type)
    type_name = training.get("name", "") if training else ""
    booking_count = conn.execute(
        "SELECT COUNT(*) FROM bookings WHERE training_name = ? AND training_date = ?",
        (type_name, date)
    ).fetchone()[0]
    career_application_count = 0
    if training_type in ("case_interview", "case_interview_new", "case_interview_mid"):
        career_application_count = conn.execute(
            "SELECT COUNT(*) FROM career_applications WHERE appointment = ? AND appointment_mode = 'selected' AND application_status != 'closed'",
            (date,),
        ).fetchone()[0]
    return booking_count + career_application_count


def count_bookings_for_date(training_type: str, date: str) -> int:
    conn = get_db()
    count = _count_used_slots(conn, training_type, date)
    conn.close()
    return count


def load_training_dates():
    with open(TRAINING_DATES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# --- 紹介コード ---
def load_referral_codes() -> dict:
    """紹介コード一覧を読み込む（無ければ空構造）"""
    try:
        with open(REFERRAL_CODES_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"codes": []}


def save_referral_codes(data: dict):
    """紹介コード一覧を保存"""
    try:
        REFERRAL_CODES_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(REFERRAL_CODES_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[紹介コード] 保存失敗: {e}")


def find_referral_code(code: str) -> Optional[dict]:
    """大文字小文字無視でコードを検索（戻り値は元データへの参照）"""
    if not code:
        return None
    code_norm = code.strip().upper()
    data = load_referral_codes()
    for entry in data.get("codes", []):
        if entry.get("code", "").strip().upper() == code_norm:
            return entry
    return None


def validate_referral_code(code: str, training_type: str = "") -> dict:
    """
    紹介コードを検証し、適用情報を返す。
    戻り値: {"valid": bool, "reason": str, "discount_type": "rate"|"amount", "discount_value": ..., "label": "..."}
    """
    entry = find_referral_code(code)
    if not entry:
        return {"valid": False, "reason": "コードが見つかりません"}
    if not entry.get("active", True):
        return {"valid": False, "reason": "現在停止中のコードです"}

    # 期限チェック
    expires = entry.get("expires", "")
    if expires:
        try:
            today = datetime.now().date()
            exp_date = datetime.strptime(expires, "%Y-%m-%d").date()
            if today > exp_date:
                return {"valid": False, "reason": f"有効期限切れ（{expires}まで）"}
        except ValueError:
            pass

    # 利用上限チェック
    max_uses = entry.get("max_uses")
    used_count = entry.get("used_count", 0)
    if max_uses is not None and used_count >= max_uses:
        return {"valid": False, "reason": "利用上限に達しています"}

    # 対象研修種別チェック
    applies_to = entry.get("applies_to", []) or []
    if applies_to and training_type:
        # case_interview_new/mid → case_interview の正規化を反映
        normalized = "case_interview" if training_type in ("case_interview_new", "case_interview_mid") else training_type
        if normalized not in applies_to and training_type not in applies_to:
            return {"valid": False, "reason": "対象外の研修種別です"}

    discount_type = entry.get("discount_type", "amount")
    discount_value = entry.get("discount_value", 0)

    if discount_type == "rate":
        label = f"{int(discount_value * 100)}% OFF"
    else:
        label = f"¥{int(discount_value):,} 割引"

    return {
        "valid": True,
        "reason": "適用可能",
        "code": entry.get("code", ""),
        "discount_type": discount_type,
        "discount_value": discount_value,
        "label": label,
        "note": entry.get("note", ""),
    }


def calc_discounted_total(original_total: int, validation: dict) -> int:
    """検証済みコード情報から割引後の合計金額を計算"""
    if not validation.get("valid"):
        return original_total
    dtype = validation.get("discount_type")
    dval = validation.get("discount_value", 0)
    if dtype == "rate":
        discounted = int(round(original_total * (1 - float(dval))))
    elif dtype == "amount":
        discounted = int(original_total - int(dval))
    else:
        discounted = original_total
    # 0円以下は0円に丸める（Stripeは50円未満決済不可なので、最低50円に）
    return max(50, discounted)


def increment_referral_use(code: str):
    """紹介コードの利用回数を+1"""
    if not code:
        return
    code_norm = code.strip().upper()
    data = load_referral_codes()
    changed = False
    for entry in data.get("codes", []):
        if entry.get("code", "").strip().upper() == code_norm:
            entry["used_count"] = entry.get("used_count", 0) + 1
            changed = True
            break
    if changed:
        save_referral_codes(data)
        print(f"[紹介コード] 利用カウント+1: {code_norm}")


# --- メール送信 ---
def _send_email_via_resend(to_email: str, subject: str, html_body: str) -> bool:
    """Resend HTTPS API でメール送信。失敗時 False を返す"""
    try:
        from_addr = f"{RESEND_FROM_NAME} <{RESEND_FROM_EMAIL}>"
        print(f"[Resend] 送信試行 FROM={from_addr} TO={to_email} subject={subject[:50]}")
        payload = {
            "from": from_addr,
            "to": [to_email],
            "subject": subject,
            "html": html_body,
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            "https://api.resend.com/emails",
            data=data,
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
                "User-Agent": "SYMMETRY-Lab-Booking/1.0",
                "Accept": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8")
            if 200 <= resp.status < 300:
                print(f"[Resend送信成功] {subject} → {to_email} (status={resp.status})")
                return True
            print(f"[Resend送信失敗] status={resp.status} body={body[:300]}")
            return False
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8")
        except Exception:
            err_body = str(e)
        print(f"[Resend送信失敗] HTTPError {e.code}: {err_body[:300]}")
        return False
    except Exception as e:
        print(f"[Resend送信失敗] {type(e).__name__}: {e}")
        traceback.print_exc()
        return False


def _send_email_via_smtp(to_email: str, subject: str, html_body: str) -> bool:
    """従来の SMTP 経由でメール送信。失敗時 False を返す"""
    if not SMTP_EMAIL or not SMTP_PASSWORD:
        print(f"[メール] SMTP未設定のためスキップ: {subject} → {to_email}")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = f"SYMMETRY Lab <{SMTP_EMAIL}>"
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        smtp_host = os.getenv("SMTP_HOST", "smtp.office365.com")
        smtp_port = int(os.getenv("SMTP_PORT", "587"))

        # 465: SSL接続 / 587: STARTTLS / その他: STARTTLS（後方互換）
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=20) as server:
                server.login(SMTP_EMAIL, SMTP_PASSWORD)
                server.sendmail(SMTP_EMAIL, to_email, msg.as_string())
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
                server.starttls()
                server.login(SMTP_EMAIL, SMTP_PASSWORD)
                server.sendmail(SMTP_EMAIL, to_email, msg.as_string())

        print(f"[SMTP送信成功] {subject} → {to_email}")
        return True
    except Exception as e:
        print(f"[SMTP送信失敗] {subject} → {to_email}: {e}")
        traceback.print_exc()
        return False


def send_email(to_email: str, subject: str, html_body: str) -> bool:
    """
    メール送信（Resend優先、フォールバックでSMTP）。
    RESEND_API_KEY が設定されていれば Resend (HTTPS API) を使用。
    未設定または失敗時は SMTP を試行。
    """
    if not to_email:
        return False

    # 1) Resend を優先（HTTPS API。Render等のSMTPブロック環境でも確実に送れる）
    if RESEND_API_KEY:
        # Resend が設定されている場合、SMTPフォールバックは行わない。
        # Render Free プランは SMTP アウトバウンドをブロックするためタイムアウトで遅延するだけ。
        return _send_email_via_resend(to_email, subject, html_body)

    # 2) RESEND_API_KEY 未設定時のみ SMTP を試行（ローカル開発などで利用）
    return _send_email_via_smtp(to_email, subject, html_body)


def _career_application_email_html(application: dict, audience: str) -> str:
    name = html.escape(application.get("name", ""))
    appointment = html.escape(application.get("appointment") or "後日調整")
    appointment_note = "希望日時" if application.get("appointment_mode") == "selected" else "相談日時"
    message = html.escape(application.get("message", "")) or "（記載なし）"
    application_id = html.escape(application.get("application_id", ""))
    if audience == "admin":
        return f"""
        <div style="font-family:Arial,'Noto Sans JP',sans-serif;line-height:1.8;color:#1f2937;max-width:680px;">
          <h1 style="font-size:20px;border-bottom:3px solid #36c9e6;padding-bottom:12px;">コンサル転職相談の新規申込</h1>
          <p>管理画面で詳細を確認してください。</p>
          <table style="border-collapse:collapse;width:100%;">
            <tr><th style="text-align:left;padding:8px;background:#f3f4f6;">申込ID</th><td style="padding:8px;">{application_id}</td></tr>
            <tr><th style="text-align:left;padding:8px;background:#f3f4f6;">氏名</th><td style="padding:8px;">{name}</td></tr>
            <tr><th style="text-align:left;padding:8px;background:#f3f4f6;">メール</th><td style="padding:8px;">{html.escape(application.get("email", ""))}</td></tr>
            <tr><th style="text-align:left;padding:8px;background:#f3f4f6;">電話番号</th><td style="padding:8px;">{html.escape(application.get("phone", ""))}</td></tr>
            <tr><th style="text-align:left;padding:8px;background:#f3f4f6;">現在の業界・職種</th><td style="padding:8px;">{html.escape(application.get("industry", ""))} / {html.escape(application.get("job", ""))}</td></tr>
            <tr><th style="text-align:left;padding:8px;background:#f3f4f6;">希望領域</th><td style="padding:8px;">{html.escape(application.get("area", ""))}</td></tr>
            <tr><th style="text-align:left;padding:8px;background:#f3f4f6;">{appointment_note}</th><td style="padding:8px;">{appointment}</td></tr>
            <tr><th style="text-align:left;padding:8px;background:#f3f4f6;">流入元</th><td style="padding:8px;">{html.escape(application.get("source", "unknown"))}</td></tr>
            <tr><th style="text-align:left;padding:8px;background:#f3f4f6;">GCLID / キャンペーン</th><td style="padding:8px;">{html.escape(application.get("gclid", "") or "なし")} / {html.escape(application.get("utm_campaign", "") or "なし")}</td></tr>
          </table>
          <h2 style="font-size:16px;margin-top:24px;">相談内容</h2>
          <p style="white-space:pre-wrap;background:#f8fafc;padding:12px;">{message}</p>
        </div>
        """
    return f"""
    <div style="font-family:Arial,'Noto Sans JP',sans-serif;line-height:1.8;color:#1f2937;max-width:680px;">
      <h1 style="font-size:20px;border-bottom:3px solid #36c9e6;padding-bottom:12px;">無料相談のお申込みを受け付けました</h1>
      <p>{name} 様</p>
      <p>コンサル転職支援の無料相談へお申込みいただきありがとうございます。担当者が内容を確認のうえ、ご連絡します。</p>
      <p><strong>{appointment_note}：</strong>{appointment}</p>
      <p style="font-size:13px;color:#667085;">このメールは申込受付のお知らせです。日時を選択した場合も、担当者からの連絡をもって確定となります。</p>
      <p style="font-size:13px;color:#667085;">申込ID：{application_id}</p>
    </div>
    """


def send_career_application_notifications(application: dict) -> None:
    """保存済みの申込について、管理者と申込者へ通知する。通知失敗は申込結果を変更しない。"""
    admin_recipients = get_admin_emails()
    admin_subject = "【SYMMETRY Lab】コンサル転職相談の新規申込"
    admin_html = _career_application_email_html(application, "admin")
    if not admin_recipients:
        print("[コンサル転職相談] ADMIN_EMAIL未設定のため管理者通知をスキップ")
    for recipient in admin_recipients:
        try:
            send_email(recipient, admin_subject, admin_html)
        except Exception as exc:
            print(f"[コンサル転職相談] 管理者通知に失敗 ({recipient}): {exc}")

    applicant_email = application.get("email", "")
    if applicant_email:
        try:
            send_email(
                applicant_email,
                "【SYMMETRY Lab】無料相談のお申込みを受け付けました",
                _career_application_email_html(application, "applicant"),
            )
        except Exception as exc:
            print(f"[コンサル転職相談] 申込者通知に失敗 ({applicant_email}): {exc}")


def send_booking_confirmation(metadata: dict, amount: int):
    """予約確認メールを顧客に送信"""
    customer_name = metadata.get("customer_name", "")
    customer_email = metadata.get("customer_email", "")
    training_name = metadata.get("training_name", "")
    training_date = metadata.get("training_date", "")
    sessions = metadata.get("sessions", "1")

    if not customer_email:
        return

    subject = f"【SYMMETRY Lab】{training_name} お申込み確認"

    html = f"""
    <div style="max-width:600px;margin:0 auto;font-family:'Helvetica Neue',Arial,sans-serif;color:#1F2937;line-height:1.8;">
      <div style="border-top:3px solid #36C9E6;padding:40px 32px;">
        <h1 style="font-size:20px;font-weight:700;color:#1F2937;margin:0 0 8px;">
          お申込みありがとうございます
        </h1>
        <p style="font-size:13px;color:#6B7280;margin:0 0 32px;">
          SYMMETRY Lab株式会社
        </p>

        <p style="font-size:15px;">
          {customer_name} 様<br><br>
          この度は <strong>{training_name}</strong> にお申込みいただき、誠にありがとうございます。<br>
          以下の内容でご予約を承りました。
        </p>

        <div style="background:#F9FAFB;border-left:3px solid #36C9E6;padding:20px 24px;margin:28px 0;border-radius:2px;">
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0;color:#6B7280;width:140px;">プログラム</td>
              <td style="padding:8px 0;font-weight:600;">{training_name}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6B7280;">日程</td>
              <td style="padding:8px 0;font-weight:600;">{training_date}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6B7280;">セッション数</td>
              <td style="padding:8px 0;font-weight:600;">{sessions}回</td>
            </tr>
            <tr style="border-top:1px solid #E5E7EB;">
              <td style="padding:12px 0 8px;color:#6B7280;">お支払い金額</td>
              <td style="padding:12px 0 8px;font-weight:700;font-size:18px;color:#36C9E6;">
                ¥{amount:,}
              </td>
            </tr>
          </table>
        </div>

        <h2 style="font-size:15px;font-weight:700;color:#1F2937;margin:32px 0 12px;">
          今後の流れ
        </h2>
        <ol style="font-size:14px;padding-left:20px;color:#4B5563;">
          <li style="margin-bottom:8px;">本メールで予約内容をご確認ください</li>
          <li style="margin-bottom:8px;">担当者よりTeamsリンクをメールでお送りします</li>
          <li style="margin-bottom:8px;">お時間になりましたらTeamsにてご参加ください</li>
        </ol>

        <p style="font-size:14px;color:#4B5563;margin-top:28px;">
          ご不明点がございましたら、お気軽にご連絡ください。<br>
          お会いできることを楽しみにしております。
        </p>

        <div style="border-top:1px solid #E5E7EB;margin-top:40px;padding-top:20px;">
          <p style="font-size:12px;color:#9CA3AF;margin:0;">
            SYMMETRY Lab株式会社<br>
            Email: {SMTP_EMAIL}<br>
            Web: https://symmetrylab.jp
          </p>
        </div>
      </div>
    </div>
    """

    send_email(customer_email, subject, html)

    # 管理者にも通知
    admin_subject = f"[新規予約] {customer_name}様 - {training_name} ({training_date})"
    admin_html = f"""
    <div style="font-family:sans-serif;font-size:14px;color:#333;line-height:1.8;">
      <h2 style="color:#36C9E6;">新規予約通知</h2>
      <table style="border-collapse:collapse;">
        <tr><td style="padding:4px 16px 4px 0;color:#888;">氏名</td><td><strong>{customer_name}</strong></td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#888;">メール</td><td>{customer_email}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#888;">電話</td><td>{metadata.get('customer_phone', '')}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#888;">プログラム</td><td>{training_name}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#888;">日程</td><td>{training_date}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#888;">セッション数</td><td>{sessions}回</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#888;">金額</td><td><strong>¥{amount:,}</strong></td></tr>
      </table>
    </div>
    """
    for admin in get_admin_emails():
        send_email(admin, admin_subject, admin_html)


# --- LINE Messaging API ---
def send_line_push(user_id: str, messages: list) -> bool:
    """LINE Push API でメッセージ送信"""
    if not LINE_CHANNEL_ACCESS_TOKEN or not user_id:
        return False
    try:
        req = urllib.request.Request(
            "https://api.line.me/v2/bot/message/push",
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {LINE_CHANNEL_ACCESS_TOKEN}",
            },
            data=json.dumps({"to": user_id, "messages": messages}).encode("utf-8"),
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            res.read()
        print(f"[LINE送信成功] → {user_id}")
        return True
    except Exception as e:
        print(f"[LINE送信失敗] {e}")
        traceback.print_exc()
        return False


def send_line_booking_notification(metadata: dict, amount: int):
    """予約完了後、LINEトークに確認メッセージ送信"""
    company = metadata.get("customer_company", "")
    if not company.startswith("LINE:"):
        return
    user_id = company.replace("LINE:", "").strip()
    if not user_id:
        return

    customer_name = metadata.get("customer_name", "")
    training_name = metadata.get("training_name", "")
    training_date = metadata.get("training_date", "")
    sessions = metadata.get("sessions", "1")

    bubble = {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#36C9E6",
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": "予約完了", "color": "#FFFFFF", "weight": "bold", "size": "lg"},
                {"type": "text", "text": "SYMMETRY Lab", "color": "#EBF9FC", "size": "xs", "margin": "sm"},
            ],
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "paddingAll": "16px",
            "contents": [
                {"type": "text", "text": f"{customer_name} 様", "weight": "bold", "size": "md"},
                {"type": "text", "text": "お申込みありがとうございます。", "size": "sm", "color": "#6B7280", "margin": "sm", "wrap": True},
                {"type": "separator", "margin": "lg"},
                {
                    "type": "box", "layout": "vertical", "margin": "lg", "spacing": "sm",
                    "contents": [
                        {"type": "box", "layout": "baseline", "contents": [
                            {"type": "text", "text": "プログラム", "size": "xs", "color": "#6B7280", "flex": 3},
                            {"type": "text", "text": training_name, "size": "xs", "flex": 5, "wrap": True, "weight": "bold"},
                        ]},
                        {"type": "box", "layout": "baseline", "contents": [
                            {"type": "text", "text": "希望日時", "size": "xs", "color": "#6B7280", "flex": 3},
                            {"type": "text", "text": training_date, "size": "xs", "flex": 5, "wrap": True, "weight": "bold"},
                        ]},
                        {"type": "box", "layout": "baseline", "contents": [
                            {"type": "text", "text": "セッション数", "size": "xs", "color": "#6B7280", "flex": 3},
                            {"type": "text", "text": f"{sessions}回", "size": "xs", "flex": 5, "weight": "bold"},
                        ]},
                        {"type": "box", "layout": "baseline", "contents": [
                            {"type": "text", "text": "お支払い", "size": "xs", "color": "#6B7280", "flex": 3},
                            {"type": "text", "text": f"¥{amount:,}", "size": "sm", "flex": 5, "weight": "bold", "color": "#36C9E6"},
                        ]},
                    ],
                },
                {"type": "separator", "margin": "lg"},
                {"type": "text", "text": "担当者より24時間以内にご連絡いたします。", "size": "xs", "color": "#6B7280", "margin": "lg", "wrap": True},
            ],
        },
    }

    messages = [
        {"type": "flex", "altText": f"{training_name} お申込み完了", "contents": bubble},
    ]
    send_line_push(user_id, messages)


CAREER_APPLICATION_STATUSES = {
    "new", "contacted", "qualified_candidate", "agent_referral",
    "interview", "joined", "closed"
}

CAREER_APPLICATION_CHOICES = {
    "industry": {"金融・保険", "IT・インターネット", "メーカー", "商社・物流", "広告・メディア", "官公庁・非営利", "その他"},
    "job": {"営業・事業開発", "企画・マーケティング", "経営企画・管理", "IT・エンジニア", "金融専門職", "コンサルタント", "その他"},
    "experience": {"1年未満", "1〜3年", "4〜6年", "7〜10年", "11年以上"},
    "income": {"400万円未満", "400〜600万円", "600〜800万円", "800〜1,000万円", "1,000万円以上"},
    "area": {"戦略", "総合", "その他", "未定"},
    "timing": {"3か月以内", "半年以内", "1年以内", "時期未定"},
    "status": {"情報収集中", "応募前・準備中", "応募・選考中", "内定・オファーあり"},
}


def _career_trim(value: str, field_name: str, max_length: int, required: bool = False) -> str:
    value = (value or "").strip()
    if required and not value:
        raise HTTPException(status_code=422, detail=f"{field_name}は必須です")
    if len(value) > max_length:
        raise HTTPException(status_code=422, detail=f"{field_name}が長すぎます")
    return value


def _validate_career_appointment(appointment: str, appointment_mode: str) -> tuple[str, str]:
    appointment = _career_trim(appointment, "相談希望日時", 40)
    appointment_mode = _career_trim(appointment_mode, "相談希望日時の選択方法", 20)
    if not appointment:
        return appointment, appointment_mode
    if appointment_mode not in ("selected", "later"):
        raise HTTPException(status_code=422, detail="相談希望日時の選択方法が正しくありません")
    if appointment_mode == "later":
        return appointment, appointment_mode
    try:
        appointment_dt = datetime.strptime(appointment, "%Y-%m-%d %H:%M").replace(tzinfo=JST)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="相談希望日時の形式が正しくありません") from exc
    if appointment_dt < datetime.now(JST):
        raise HTTPException(status_code=422, detail="過去の日時は選択できません")
    is_weekend = appointment_dt.weekday() >= 5
    allowed = (9 <= appointment_dt.hour <= 20) if is_weekend else (19 <= appointment_dt.hour <= 23)
    if allowed and appointment_dt.minute == 0:
        return appointment, appointment_mode
    raise HTTPException(status_code=422, detail="相談可能時間外の日時です")


def _ensure_career_appointment_available(conn: sqlite3.Connection, appointment: str) -> None:
    if not appointment:
        return
    training = resolve_training("case_interview")
    if not training:
        raise HTTPException(status_code=409, detail="相談可能な日時を確認できません")
    date, time = appointment.split(" ", 1)
    if date in training.get("blocked_dates", []):
        raise HTTPException(status_code=409, detail="選択した日は現在受付していません")
    available_slots = training.get("available_slots", {})
    configured_times = available_slots.get(date) if available_slots else None
    if available_slots and configured_times is None:
        raise HTTPException(status_code=409, detail="選択した日程は現在受付していません")
    if configured_times is not None and time not in configured_times:
        raise HTTPException(status_code=409, detail="選択した時間は現在受付していません")
    if configured_times is None and time not in training.get("time_slots", []):
        raise HTTPException(status_code=409, detail="選択した時間は現在受付していません")

    used_slots = _count_used_slots(conn, "case_interview", appointment)
    if used_slots >= int(training.get("max_capacity", 0)):
        raise HTTPException(status_code=409, detail="選択した時間は満席です。別の日時をお選びください")


def _validate_career_application(req: CareerApplicationRequest) -> CareerApplicationRequest:
    if req.website.strip():
        raise HTTPException(status_code=422, detail="申込を受け付けられませんでした")
    req.client_submission_id = _career_trim(req.client_submission_id, "申込識別子", 100, required=True)
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,100}", req.client_submission_id):
        raise HTTPException(status_code=422, detail="申込識別子が正しくありません")
    req.name = _career_trim(req.name, "氏名", 120, required=True)
    req.email = _career_trim(req.email, "メールアドレス", 254, required=True)
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", req.email):
        raise HTTPException(status_code=422, detail="メールアドレスの形式が正しくありません")
    req.phone = _career_trim(req.phone, "電話番号", 40, required=True)
    if len(re.sub(r"[^0-9]", "", req.phone)) < 7:
        raise HTTPException(status_code=422, detail="電話番号の形式が正しくありません")

    required_fields = (
        ("industry", "現在の業界"), ("job", "現在の職種"),
        ("experience", "社会人経験年数"), ("income", "現在の年収帯"),
        ("area", "希望するコンサル領域"), ("timing", "転職希望時期"),
        ("status", "現在の転職活動・選考状況"),
    )
    for field_name, label in required_fields:
        setattr(req, field_name, _career_trim(getattr(req, field_name), label, 120, required=True))
        if getattr(req, field_name) not in CAREER_APPLICATION_CHOICES[field_name]:
            raise HTTPException(status_code=422, detail=f"{label}の選択肢が正しくありません")
    req.message = _career_trim(req.message, "相談内容", 5000)
    req.gclid = _career_trim(req.gclid, "gclid", 500)
    req.gbraid = _career_trim(req.gbraid, "gbraid", 500)
    req.wbraid = _career_trim(req.wbraid, "wbraid", 500)
    req.utm_source = _career_trim(req.utm_source, "utm_source", 200)
    req.utm_medium = _career_trim(req.utm_medium, "utm_medium", 200)
    req.utm_campaign = _career_trim(req.utm_campaign, "utm_campaign", 200)
    req.utm_term = _career_trim(req.utm_term, "utm_term", 200)
    req.utm_content = _career_trim(req.utm_content, "utm_content", 200)
    req.landing_page = _career_trim(req.landing_page, "ランディングページ", 500)
    req.first_touch_at = _career_trim(req.first_touch_at, "初回流入日時", 80)
    req.last_touch_at = _career_trim(req.last_touch_at, "最終流入日時", 80)
    req.appointment, req.appointment_mode = _validate_career_appointment(req.appointment, req.appointment_mode)
    if not req.consent:
        raise HTTPException(status_code=422, detail="個人情報の取扱いへの同意が必要です")
    return req


def _career_origin_allowed(request: Request) -> bool:
    origin = request.headers.get("origin", "").rstrip("/")
    if not origin:
        return False
    origin_url = urlparse(origin)
    base_url = urlparse(BASE_URL)
    allowed = {
        BASE_URL.rstrip("/"),
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    }
    if origin in allowed:
        return True
    return (
        base_url.hostname in {"127.0.0.1", "localhost"}
        and origin_url.scheme == "http"
        and origin_url.hostname in {"127.0.0.1", "localhost"}
    )


@app.post("/api/consulting-career/applications")
async def create_career_application(request: Request, background_tasks: BackgroundTasks, req: CareerApplicationRequest):
    if not _career_origin_allowed(request):
        raise HTTPException(status_code=403, detail="許可されていない送信元です")
    req = _validate_career_application(req)
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(
            "SELECT application_id, created_at FROM career_applications WHERE client_submission_id = ?",
            (req.client_submission_id,),
        ).fetchone()
        if existing:
            conn.rollback()
            return {
                "ok": True,
                "duplicate": True,
                "application_id": existing["application_id"],
                "lead_id": existing["application_id"],
                "created_at": existing["created_at"],
            }

        _ensure_career_appointment_available(conn, req.appointment if req.appointment_mode == "selected" else "")
        application_id = str(uuid4())
        now = datetime.now().isoformat(timespec="seconds")
        source = "google_ads" if (req.gclid or req.gbraid or req.wbraid) else (req.utm_source or "unknown")
        conn.execute("""
            INSERT INTO career_applications (
                application_id, client_submission_id, created_at, updated_at,
                application_status, name, email, phone, industry, job,
                experience, income, area, timing, activity_status, message,
                appointment, appointment_mode, consent_at, privacy_policy_version,
                gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign,
                utm_term, utm_content, landing_page, first_touch_at, last_touch_at, source
            ) VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            application_id, req.client_submission_id, now, now,
            req.name, req.email, req.phone, req.industry, req.job,
            req.experience, req.income, req.area, req.timing, req.status, req.message,
            req.appointment, req.appointment_mode, now,
            os.getenv("PRIVACY_POLICY_VERSION", "current"),
            req.gclid, req.gbraid, req.wbraid, req.utm_source, req.utm_medium,
            req.utm_campaign, req.utm_term, req.utm_content, req.landing_page,
            req.first_touch_at, req.last_touch_at, source,
        ))
        conn.execute(
            "INSERT INTO career_application_status_history (application_id, status, changed_at, admin_notes) VALUES (?, 'new', ?, '')",
            (application_id, now),
        )
        conn.commit()
        background_tasks.add_task(
            send_career_application_notifications,
            {
                "application_id": application_id,
                "created_at": now,
                "name": req.name,
                "email": req.email,
                "phone": req.phone,
                "industry": req.industry,
                "job": req.job,
                "area": req.area,
                "appointment": req.appointment,
                "appointment_mode": req.appointment_mode,
                "message": req.message,
                "source": source,
                "gclid": req.gclid,
                "utm_campaign": req.utm_campaign,
            },
        )
        return {"ok": True, "duplicate": False, "application_id": application_id, "lead_id": application_id, "created_at": now}
    except sqlite3.IntegrityError:
        conn.rollback()
        existing = conn.execute(
            "SELECT application_id, created_at FROM career_applications WHERE client_submission_id = ?",
            (req.client_submission_id,),
        ).fetchone()
        if existing:
            return {
                "ok": True,
                "duplicate": True,
                "application_id": existing["application_id"],
                "lead_id": existing["application_id"],
                "created_at": existing["created_at"],
            }
        raise HTTPException(status_code=500, detail="申込を保存できませんでした")
    finally:
        conn.close()


# --- APIエンドポイント ---
@app.get("/api/available-dates")
async def get_available_dates(training_type: str, date: str = ""):
    training = resolve_training(training_type)
    if not training:
        raise HTTPException(status_code=404, detail="研修種別が見つかりません")

    avail_slots = training.get("available_slots", {})
    time_slots = training.get("time_slots", [])

    if date:
        if date < datetime.now(JST).strftime("%Y-%m-%d"):
            return {"time_slots": []}
        if date in training.get("blocked_dates", []):
            return {"time_slots": []}
        # available_slotsが空なら全スロット許可、設定済みならその日のスロットのみ
        if avail_slots:
            allowed_times = avail_slots.get(date, [])
            if not allowed_times:
                return {"time_slots": []}
        else:
            allowed_times = time_slots

        available = []
        for slot in allowed_times:
            booked = count_bookings_for_date(training_type, f"{date} {slot}")
            remaining = training["max_capacity"] - booked
            if remaining > 0:
                available.append({"time": slot, "slots_remaining": remaining})
        return {"time_slots": available}

    # 日付一覧: available_slotsのキー
    available_dates = list(avail_slots.keys()) if avail_slots else []

    return {
        "training_name": training["name"],
        "price": training["price"],
        "price_label": training["price_label"],
        "time_slots": time_slots,
        "available_dates": available_dates,
        "available_slots": avail_slots,
        "blocked_dates": training.get("blocked_dates", []),
    }


@app.post("/api/create-checkout-session")
async def create_checkout_session(req: CheckoutRequest):
    # 入力の基本バリデーション（サーバ側でのリクエスト内容を必ずログに出す）
    print(f"[checkout] type={req.training_type} date={req.training_date!r} email={req.customer_email} sessions={req.sessions} notes_len={len(req.booking_notes)}")

    if not stripe.api_key:
        raise HTTPException(status_code=400, detail="サーバ設定エラー: 決済サービスが未設定です。管理者へお問い合わせください。")
    if not BASE_URL or not BASE_URL.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="サーバ設定エラー: BASE_URLが正しく設定されていません。")
    if not req.customer_email or "@" not in req.customer_email:
        raise HTTPException(status_code=400, detail="メールアドレスの形式が正しくありません。")
    if not req.customer_name.strip():
        raise HTTPException(status_code=400, detail="お名前が空です。")

    training = resolve_training(req.training_type)
    if not training:
        raise HTTPException(status_code=400, detail=f"無効な研修種別です: {req.training_type}")

    avail_slots = training.get("available_slots", {})
    # training_date は "2026-04-25 14:00" 形式を前提。先頭の日付のみ抽出
    date_part = req.training_date.split(" ")[0] if " " in req.training_date else req.training_date
    if avail_slots and date_part not in avail_slots:
        raise HTTPException(status_code=400, detail=f"この日程は予約可能日として設定されていません（{date_part}）")

    booked = count_bookings_for_date(req.training_type, req.training_date)
    if booked >= training["max_capacity"]:
        raise HTTPException(status_code=400, detail="この日程は定員に達しています")

    qty = max(1, int(req.sessions))

    # ケース面接対策はパッケージ価格（割引適用）。それ以外は単価×数量
    CASE_PACKAGE_PRICES = {1: 7000, 2: 13580, 3: 19950, 5: 32200, 10: 63000}
    if req.training_type in ("case_interview", "case_interview_new", "case_interview_mid") and qty in CASE_PACKAGE_PRICES:
        original_total = CASE_PACKAGE_PRICES[qty]
    else:
        original_total = training["price"] * qty

    # 紹介コード検証＆割引適用
    referral_validation = {"valid": False}
    discount_amount = 0
    if req.referral_code:
        referral_validation = validate_referral_code(req.referral_code, req.training_type)
        if referral_validation.get("valid"):
            discounted_total = calc_discounted_total(original_total, referral_validation)
            discount_amount = original_total - discounted_total
            total_price = discounted_total
        else:
            print(f"[checkout] 紹介コード無効: {req.referral_code} → {referral_validation.get('reason')}")
            raise HTTPException(
                status_code=400,
                detail=f"クーポンコードを適用できません: {referral_validation.get('reason', '無効なコードです')}"
            )
    else:
        total_price = original_total

    # Stripeのline_itemsは「単価×数量」モデルなので、合計額を unit_amount に入れて quantity=1 で渡す
    unit_amount = total_price
    stripe_quantity = 1

    # Stripe product name は250文字制限。日時部分だけを載せ、希望一覧は metadata へ
    name_with_qty = f"{training['name']} - {req.training_date}"
    if qty > 1:
        name_with_qty += f"（{qty}セッションパッケージ）"
    if len(name_with_qty) > 240:
        name_with_qty = name_with_qty[:237] + "..."

    # Stripe metadataは各value 500文字制限。booking_notesは念のため切り詰め
    notes = (req.booking_notes or "")[:490]

    try:
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "jpy",
                    "product_data": {
                        "name": name_with_qty,
                        "description": f"SYMMETRY Lab {training['name']}"
                    },
                    "unit_amount": unit_amount,
                },
                "quantity": stripe_quantity,
            }],
            mode="payment",
            success_url=f"{BASE_URL}/booking.html?success=true&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{BASE_URL}/lp-case.html?canceled=true",
            customer_email=req.customer_email,
            metadata={
                "training_type": req.training_type,
                "training_name": training["name"],
                "training_date": req.training_date,
                "customer_name": req.customer_name,
                "customer_email": req.customer_email,
                "customer_phone": req.customer_phone,
                "customer_company": req.customer_company,
                "price": str(total_price),
                "original_price": str(original_total),
                "discount_amount": str(discount_amount),
                "referral_code": req.referral_code if referral_validation.get("valid") else "",
                "sessions": str(qty),
                "booking_notes": notes,
            }
        )
        print(f"[checkout] OK session={session.id}")
        return {"checkout_url": session.url}
    except stripe.error.StripeError as e:
        print(f"[checkout] StripeError: {type(e).__name__}: {e}")
        traceback.print_exc()
        # Stripeエラーは設定/入力起因が多いので400で返してUI側で文言を出せるように
        raise HTTPException(status_code=400, detail=f"決済セッションの作成に失敗しました: {str(e)}")
    except Exception as e:
        print(f"[checkout] Unexpected: {type(e).__name__}: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"予期しないエラーが発生しました: {str(e)}")


@app.get("/api/confirm-booking")
async def confirm_booking(session_id: str):
    try:
        session = stripe.checkout.Session.retrieve(session_id)
        if session.payment_status != "paid":
            raise HTTPException(status_code=400, detail="決済が完了していません")

        md = session.metadata
        session_data = {
            "id": session.id,
            "amount_total": session.amount_total,
            "metadata": {
                "training_type": md["training_type"] if "training_type" in md else "",
                "training_name": md["training_name"] if "training_name" in md else "",
                "training_date": md["training_date"] if "training_date" in md else "",
                "customer_name": md["customer_name"] if "customer_name" in md else "",
                "customer_email": md["customer_email"] if "customer_email" in md else "",
                "customer_phone": md["customer_phone"] if "customer_phone" in md else "",
                "customer_company": md["customer_company"] if "customer_company" in md else "",
                "price": md["price"] if "price" in md else "0",
            }
        }
        inserted = save_booking(session_data)
        print(f"[予約確認] session_id={session_id} inserted={inserted}")

        # 新規予約のときのみ通知送信＋紹介コード使用カウント（confirm-booking多重呼び出し対策）
        if inserted:
            amount = session_data.get("amount_total", 0)
            send_booking_confirmation(session_data["metadata"], amount)
            send_line_booking_notification(session_data["metadata"], amount)
            # 紹介コード使用回数を+1
            used_code = session_data["metadata"].get("referral_code", "")
            if used_code:
                increment_referral_use(used_code)
            return {"status": "ok", "message": "予約を記録しました"}
        else:
            return {"status": "ok", "message": "予約は既に記録済みです", "already_recorded": True}
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=f"セッション情報の取得に失敗: {str(e)}")


@app.post("/api/stripe-webhook")
async def stripe_webhook(request: Request):
    """
    Stripe Webhookエンドポイント。
    決済完了等のイベントを受信し、管理者にメール通知。
    また、フォールバックとして予約をDBに記録（confirm-bookingと多重実行されてもsave_bookingでスキップされる）。
    """
    payload = await request.body()
    sig_header = request.headers.get("Stripe-Signature", "")

    # 署名検証（本番・テスト両方のシークレットで試行）
    secrets_to_try = [s for s in [STRIPE_WEBHOOK_SECRET, STRIPE_WEBHOOK_SECRET_TEST] if s]

    if not secrets_to_try:
        print("[Webhook] STRIPE_WEBHOOK_SECRET / STRIPE_WEBHOOK_SECRET_TEST 未設定のため署名検証をスキップ（本番では必ず設定してください）")
        try:
            event = json.loads(payload.decode("utf-8"))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid payload: {e}")
    else:
        event = None
        last_err = None
        for secret in secrets_to_try:
            try:
                event = stripe.Webhook.construct_event(payload, sig_header, secret)
                break  # 検証成功
            except stripe.error.SignatureVerificationError as e:
                last_err = e
                continue
            except Exception as e:
                print(f"[Webhook] パース失敗: {e}")
                raise HTTPException(status_code=400, detail=f"Invalid payload: {e}")

        if event is None:
            print(f"[Webhook] 全シークレットで署名検証失敗: {last_err}")
            raise HTTPException(status_code=400, detail="Invalid signature")

    # event は stripe.Event オブジェクトまたは dict のどちらの可能性もある
    if isinstance(event, dict):
        event_type = event.get("type", "unknown")
        event_id = event.get("id", "")
    else:
        # stripe.Event オブジェクトは [] アクセス可、属性アクセスも可
        try:
            event_type = event["type"]
        except Exception:
            event_type = getattr(event, "type", "unknown")
        try:
            event_id = event["id"]
        except Exception:
            event_id = getattr(event, "id", "")
    print(f"[Webhook] 受信: type={event_type} id={event_id}")

    # checkout.session.completed のときに通知メール送信
    if event_type == "checkout.session.completed":
        # stripe.Event でも dict でも安全にアクセスできるようヘルパー
        def _safe_get(obj, key, default=None):
            if isinstance(obj, dict):
                return obj.get(key, default)
            try:
                v = obj[key]
                return v if v is not None else default
            except Exception:
                pass
            try:
                return getattr(obj, key, default)
            except Exception:
                return default

        data_obj = _safe_get(event, "data", {}) or {}
        session = _safe_get(data_obj, "object", {}) or {}
        session_id = _safe_get(session, "id", "") or ""
        amount_total = _safe_get(session, "amount_total", 0) or 0

        # Webhook payload の metadata は Python 3.14 環境で空に見える事がある
        # → session_id を使って Stripe API から確実に再取得
        md = {}
        if session_id and stripe.api_key:
            try:
                full_session = stripe.checkout.Session.retrieve(session_id)
                # full_session.metadata は dict ライクなオブジェクト
                raw_md = getattr(full_session, "metadata", None) or {}
                if hasattr(raw_md, "to_dict"):
                    md = raw_md.to_dict()
                else:
                    try:
                        md = dict(raw_md)
                    except Exception:
                        md = raw_md if isinstance(raw_md, dict) else {}
                # amount_total も再取得した方が確実
                amount_total = getattr(full_session, "amount_total", amount_total) or amount_total
                print(f"[Webhook] セッション再取得OK metadata_keys={list(md.keys())}")
            except Exception as e:
                print(f"[Webhook] セッション再取得失敗: {e} → payload の metadata で続行")
                md = _safe_get(session, "metadata", {}) or {}
                if not isinstance(md, dict):
                    try:
                        md = dict(md)
                    except Exception:
                        md = {}

        customer_name = md.get("customer_name", "") if isinstance(md, dict) else ""
        customer_email = md.get("customer_email", "") if isinstance(md, dict) else ""
        customer_phone = md.get("customer_phone", "") if isinstance(md, dict) else ""
        training_name = md.get("training_name", "") if isinstance(md, dict) else ""
        training_date = md.get("training_date", "") if isinstance(md, dict) else ""
        sessions_count = md.get("sessions", "1") if isinstance(md, dict) else "1"
        referral_code = md.get("referral_code", "") if isinstance(md, dict) else ""

        # 管理者宛にWebhook通知メール
        admins = get_admin_emails()
        if admins:
            subject = f"[Webhook通知] 決済完了 - {customer_name}様 / {training_name}"
            html = f"""
            <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:14px;color:#1F2937;line-height:1.8;max-width:600px;">
              <div style="border-top:3px solid #36C9E6;padding:24px;background:#FFFFFF;">
                <h2 style="font-size:18px;color:#36C9E6;margin:0 0 8px;">Stripe Webhook通知 — 決済完了</h2>
                <p style="font-size:12px;color:#6B7280;margin:0 0 20px;">checkout.session.completed</p>

                <table style="border-collapse:collapse;width:100%;font-size:14px;">
                  <tr><td style="padding:6px 16px 6px 0;color:#6B7280;width:140px;">セッションID</td><td style="font-family:monospace;font-size:12px;">{session_id}</td></tr>
                  <tr><td style="padding:6px 16px 6px 0;color:#6B7280;">イベントID</td><td style="font-family:monospace;font-size:12px;">{event_id}</td></tr>
                  <tr><td style="padding:6px 16px 6px 0;color:#6B7280;">氏名</td><td><strong>{customer_name}</strong></td></tr>
                  <tr><td style="padding:6px 16px 6px 0;color:#6B7280;">メール</td><td>{customer_email}</td></tr>
                  <tr><td style="padding:6px 16px 6px 0;color:#6B7280;">電話</td><td>{customer_phone}</td></tr>
                  <tr><td style="padding:6px 16px 6px 0;color:#6B7280;">プログラム</td><td>{training_name}</td></tr>
                  <tr><td style="padding:6px 16px 6px 0;color:#6B7280;">日程</td><td>{training_date}</td></tr>
                  <tr><td style="padding:6px 16px 6px 0;color:#6B7280;">セッション数</td><td>{sessions_count}回</td></tr>
                  <tr><td style="padding:6px 16px 6px 0;color:#6B7280;">紹介コード</td><td>{referral_code or '—'}</td></tr>
                  <tr style="border-top:1px solid #E5E7EB;"><td style="padding:10px 16px 10px 0;color:#6B7280;">支払金額</td><td style="font-weight:700;font-size:18px;color:#36C9E6;">¥{amount_total:,}</td></tr>
                </table>

                <p style="font-size:12px;color:#9CA3AF;margin-top:24px;">
                  本メールは Stripe Webhook（決済完了通知）を受信した時点で自動送信されています。
                </p>
              </div>
            </div>
            """
            for admin in admins:
                send_email(admin, subject, html)

        # フォールバック：DB記録（confirm-bookingが既に走っている場合は inserted=False で何もしない）
        try:
            session_data = {
                "id": session_id,
                "amount_total": amount_total,
                "metadata": {
                    "training_type": md.get("training_type", ""),
                    "training_name": training_name,
                    "training_date": training_date,
                    "customer_name": customer_name,
                    "customer_email": customer_email,
                    "customer_phone": customer_phone,
                    "customer_company": md.get("customer_company", ""),
                    "price": md.get("price", "0"),
                },
            }
            inserted = save_booking(session_data)
            if inserted:
                # confirm-booking が呼ばれずにここで初記録されたら、顧客向けの確認メールも送る
                send_booking_confirmation(session_data["metadata"], amount_total)
                send_line_booking_notification(session_data["metadata"], amount_total)
                used_code = referral_code
                if used_code:
                    increment_referral_use(used_code)
                print(f"[Webhook] DB記録完了 session_id={session_id}")
            else:
                print(f"[Webhook] 既に記録済み session_id={session_id}（重複スキップ）")
        except Exception as e:
            print(f"[Webhook] DB記録エラー: {e}")
            traceback.print_exc()

    else:
        # 他のイベントも管理者に簡易通知（必要に応じて）
        admins = get_admin_emails()
        if admins:
            subject = f"[Webhook通知] {event_type}"
            html = f"""
            <div style="font-family:sans-serif;font-size:14px;color:#1F2937;line-height:1.8;">
              <h3 style="color:#36C9E6;">Stripe Webhook 受信</h3>
              <p><strong>イベント種別：</strong> {event_type}</p>
              <p><strong>イベントID：</strong> <span style="font-family:monospace;font-size:12px;">{event_id}</span></p>
            </div>
            """
            for admin in admins:
                send_email(admin, subject, html)

    return JSONResponse({"received": True})


@app.get("/api/bookings/export")
async def export_bookings(key: str = ""):
    """予約一覧をExcelでダウンロード"""
    if not _legacy_admin_key_is_valid(key):
        raise HTTPException(status_code=403, detail="認証が必要です")

    try:
        conn = get_db()
        rows = conn.execute("SELECT * FROM bookings ORDER BY id DESC").fetchall()
        conn.close()

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "bookings"

        headers = [
            "予約ID", "申込日時", "研修種別", "研修日",
            "氏名", "メールアドレス", "電話番号", "会社名",
            "金額", "決済ステータス", "Stripe Session ID", "備考"
        ]
        ws.append(headers)

        for row in rows:
            ws.append([
                row["booking_id"], row["created_at"], row["training_name"],
                row["training_date"], row["customer_name"], row["customer_email"],
                row["customer_phone"], row["customer_company"], row["amount"],
                row["payment_status"], row["stripe_session_id"], row["notes"]
            ])

        output = BytesIO()
        wb.save(output)
        output.seek(0)

        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=bookings.xlsx"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/bookings")
async def list_bookings(key: str = ""):
    """予約一覧をJSON形式で取得"""
    if not _legacy_admin_key_is_valid(key):
        raise HTTPException(status_code=403, detail="認証が必要です")
    conn = get_db()
    rows = conn.execute("SELECT * FROM bookings ORDER BY id DESC").fetchall()
    conn.close()
    return [dict(row) for row in rows]


def _legacy_admin_key_is_valid(key: str = "") -> bool:
    return bool(ADMIN_KEY) and hmac.compare_digest(key, ADMIN_KEY)


def _admin_key_is_valid(request: Request) -> bool:
    supplied = request.headers.get("X-Admin-Key", "")
    return bool(ADMIN_KEY) and hmac.compare_digest(supplied, ADMIN_KEY)


@app.get("/api/admin/consulting-career/applications")
async def list_career_applications(request: Request, status: str = "", limit: int = 100):
    if not _admin_key_is_valid(request):
        raise HTTPException(status_code=403, detail="認証が必要です")
    limit = min(max(limit, 1), 500)
    conn = get_db()
    try:
        if status:
            if status not in CAREER_APPLICATION_STATUSES:
                raise HTTPException(status_code=400, detail="無効なステータスです")
            rows = conn.execute(
                "SELECT * FROM career_applications WHERE application_status = ? ORDER BY id DESC LIMIT ?",
                (status, limit),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM career_applications ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    finally:
        conn.close()
    return [dict(row) for row in rows]


@app.patch("/api/admin/consulting-career/applications/{application_id}")
async def update_career_application(
    application_id: str,
    request: Request,
    payload: CareerApplicationStatusRequest,
):
    if not _admin_key_is_valid(request):
        raise HTTPException(status_code=403, detail="認証が必要です")
    if payload.status not in CAREER_APPLICATION_STATUSES:
        raise HTTPException(status_code=400, detail="無効なステータスです")
    if len(payload.admin_notes) > 5000:
        raise HTTPException(status_code=422, detail="管理メモが長すぎます")
    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        current = conn.execute(
            "SELECT application_status FROM career_applications WHERE application_id = ?",
            (application_id,),
        ).fetchone()
        if not current:
            conn.rollback()
            raise HTTPException(status_code=404, detail="申込が見つかりません")
        now = datetime.now().isoformat(timespec="seconds")
        notes = payload.admin_notes.strip()
        conn.execute(
            "UPDATE career_applications SET application_status = ?, admin_notes = ?, updated_at = ? WHERE application_id = ?",
            (payload.status, notes, now, application_id),
        )
        if current["application_status"] != payload.status:
            conn.execute(
                "INSERT INTO career_application_status_history (application_id, status, changed_at, admin_notes) VALUES (?, ?, ?, ?)",
                (application_id, payload.status, now, notes),
            )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "application_id": application_id, "status": payload.status}


@app.get("/api/admin/consulting-career/applications/{application_id}/history")
async def get_career_application_history(application_id: str, request: Request):
    if not _admin_key_is_valid(request):
        raise HTTPException(status_code=403, detail="認証が必要です")
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT status, changed_at, admin_notes FROM career_application_status_history WHERE application_id = ? ORDER BY id ASC",
            (application_id,),
        ).fetchall()
    finally:
        conn.close()
    return [dict(row) for row in rows]


@app.get("/api/admin/consulting-career/applications/export")
async def export_career_applications(request: Request):
    if not _admin_key_is_valid(request):
        raise HTTPException(status_code=403, detail="認証が必要です")
    conn = get_db()
    rows = conn.execute("SELECT * FROM career_applications ORDER BY id DESC").fetchall()
    conn.close()
    headers = [
        "申込ID", "クライアント申込ID", "申込日時", "更新日時", "対応ステータス",
        "氏名", "メールアドレス", "電話番号", "現在の業界", "現在の職種",
        "社会人経験年数", "現在の年収帯", "希望領域", "転職希望時期",
        "転職活動・選考状況", "相談内容", "相談希望日時", "日時選択方法",
        "同意日時", "プライバシーポリシーバージョン", "gclid", "gbraid", "wbraid",
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
        "ランディングページ", "初回流入日時", "最終流入日時", "流入元", "管理メモ",
    ]
    fields = [
        "application_id", "client_submission_id", "created_at", "updated_at", "application_status",
        "name", "email", "phone", "industry", "job", "experience", "income", "area", "timing",
        "activity_status", "message", "appointment", "appointment_mode", "consent_at",
        "privacy_policy_version", "gclid", "gbraid", "wbraid", "utm_source", "utm_medium",
        "utm_campaign", "utm_term", "utm_content", "landing_page", "first_touch_at", "last_touch_at",
        "source", "admin_notes",
    ]
    output = StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(headers)
    for row in rows:
        writer.writerow([row[field] for field in fields])
    content = ("\ufeff" + output.getvalue()).encode("utf-8")
    return StreamingResponse(
        BytesIO(content),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=consulting-career-applications.csv"},
    )


@app.get("/api/admin/blocked-dates")
async def get_blocked_dates(key: str = ""):
    """予約可能日時一覧を取得"""
    if not _legacy_admin_key_is_valid(key):
        raise HTTPException(status_code=403, detail="認証が必要です")
    data = load_training_dates()
    result = {}
    for t_type, t_data in data.items():
        result[t_type] = {
            "name": t_data["name"],
            "time_slots": t_data.get("time_slots", []),
            "available_slots": t_data.get("available_slots", {}),
        }
    return result


@app.post("/api/admin/blocked-dates")
async def update_blocked_dates(request: Request, key: str = ""):
    """予約可能日時を更新"""
    if not _legacy_admin_key_is_valid(key):
        raise HTTPException(status_code=403, detail="認証が必要です")
    body = await request.json()
    training_type = body.get("training_type", "")
    available_slots = body.get("available_slots", None)

    data = load_training_dates()
    if training_type not in data:
        raise HTTPException(status_code=400, detail="無効な研修種別です")

    if available_slots is not None:
        data[training_type]["available_slots"] = available_slots
    with open(TRAINING_DATES_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return {"status": "ok"}


@app.get("/api/admin/stats")
async def get_stats(key: str = ""):
    """ダッシュボード統計"""
    if not _legacy_admin_key_is_valid(key):
        raise HTTPException(status_code=403, detail="認証が必要です")
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM bookings").fetchone()[0]
    total_revenue = conn.execute("SELECT COALESCE(SUM(amount), 0) FROM bookings WHERE payment_status = 'paid'").fetchone()[0]
    this_month = datetime.now().strftime("%Y-%m")
    monthly = conn.execute("SELECT COUNT(*) FROM bookings WHERE created_at LIKE ?", (f"{this_month}%",)).fetchone()[0]
    monthly_revenue = conn.execute("SELECT COALESCE(SUM(amount), 0) FROM bookings WHERE payment_status = 'paid' AND created_at LIKE ?", (f"{this_month}%",)).fetchone()[0]
    conn.close()
    return {
        "total_bookings": total,
        "total_revenue": total_revenue,
        "monthly_bookings": monthly,
        "monthly_revenue": monthly_revenue,
    }


@app.get("/api/validate-referral")
async def api_validate_referral(code: str = "", training_type: str = ""):
    """紹介コードのリアルタイム検証エンドポイント"""
    return validate_referral_code(code, training_type)


@app.get("/api/admin/referral-codes")
async def admin_get_referral_codes(key: str = ""):
    """全紹介コード一覧（管理画面用）"""
    if not _legacy_admin_key_is_valid(key):
        raise HTTPException(status_code=403, detail="認証が必要です")
    return load_referral_codes()


@app.post("/api/admin/referral-codes")
async def admin_save_referral_codes(request: Request, key: str = ""):
    """紹介コード一覧を上書き保存（管理画面用）"""
    if not _legacy_admin_key_is_valid(key):
        raise HTTPException(status_code=403, detail="認証が必要です")
    body = await request.json()
    if "codes" not in body or not isinstance(body["codes"], list):
        raise HTTPException(status_code=400, detail="codesリストが必要です")
    save_referral_codes({"codes": body["codes"]})
    return {"status": "ok", "count": len(body["codes"])}


# --- Column CMS ---
ARTICLE_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def article_timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def normalize_article_content(content: str) -> str:
    content = html.unescape(content or "")
    content = re.sub(r"<br\s*/?>", "\n", content, flags=re.IGNORECASE)
    content = re.sub(r"(https?://)\s+([A-Za-z0-9])", r"\1\2", content)
    content = re.sub(r"(?m)^\s*[•・]\s+", "- ", content)
    content = re.sub(r"(?m)^\s*(\d+)[、]\s+", r"\1. ", content)
    return "\n".join(line.strip() for line in content.splitlines())


def article_summary(content: str, limit: int = 160) -> str:
    plain = re.sub(r"[#>*_`\[\]()]", "", normalize_article_content(content))
    plain = re.sub(r"\s+", " ", plain).strip()
    return plain[:limit]


def inline_markdown(text: str) -> str:
    escaped = html.escape(text, quote=False)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)
    link_placeholders = []

    def link_replacer(match):
        label = match.group(1)
        url = re.sub(r"\s+", "", html.unescape(match.group(2)))
        if not re.match(r"^(https?://|mailto:|/(?!/))", url, re.IGNORECASE):
            return label
        token = f"\u0000LINK{len(link_placeholders)}\u0000"
        link_placeholders.append((token, f'<a href="{html.escape(url, quote=True)}" rel="noopener noreferrer">{label}</a>'))
        return token

    escaped = re.sub(r"\[([^\]]+)\]\(\s*([^)]+?)\s*\)", link_replacer, escaped, flags=re.DOTALL)

    def bare_url_replacer(match):
        url = match.group(0)
        suffix = ""
        while url and url[-1] in ".,;:!?)]}、。":
            suffix = url[-1] + suffix
            url = url[:-1]
        if not url:
            return match.group(0)
        return f'<a href="{html.escape(url, quote=True)}" rel="noopener noreferrer">{html.escape(url)}</a>{suffix}'

    escaped = re.sub(r"(?<![\"'=])(https?://[^\s<]+)", bare_url_replacer, escaped)
    for token, link in link_placeholders:
        escaped = escaped.replace(token, link)
    return escaped


def markdown_to_html(content: str) -> str:
    """Render the limited article format accepted by the admin editor."""
    blocks, list_type, paragraph = [], None, []
    content = normalize_article_content(content)

    def table_cells(line: str) -> list[str]:
        value = line.strip()
        if value.startswith("|"):
            value = value[1:]
        if value.endswith("|"):
            value = value[:-1]
        return [cell.strip() for cell in value.split("|")]

    def is_table_separator(line: str) -> bool:
        cells = table_cells(line)
        return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)

    def render_table(header_line: str, row_lines: list[str]) -> str:
        headers = table_cells(header_line)
        column_count = len(headers)
        head_html = "".join(f"<th scope=\"col\">{inline_markdown(cell)}</th>" for cell in headers)
        body_rows = []
        for row_line in row_lines:
            cells = table_cells(row_line)
            cells = (cells + [""] * column_count)[:column_count]
            body_rows.append("<tr>" + "".join(f"<td>{inline_markdown(cell)}</td>" for cell in cells) + "</tr>")
        body_html = f"<tbody>{''.join(body_rows)}</tbody>" if body_rows else ""
        return f'<div class="table-wrap"><table><thead><tr>{head_html}</tr></thead>{body_html}</table></div>'

    def flush_paragraph():
        nonlocal paragraph
        if paragraph:
            blocks.append(f"<p>{inline_markdown(''.join(paragraph))}</p>")
            paragraph = []

    def close_list():
        nonlocal list_type
        if list_type:
            blocks.append(f"</{list_type}>")
            list_type = None

    lines = content.splitlines()
    line_index = 0
    while line_index < len(lines):
        raw_line = lines[line_index]
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            close_list()
            line_index += 1
            continue
        if (
            "|" in line
            and line_index + 1 < len(lines)
            and is_table_separator(lines[line_index + 1])
        ):
            flush_paragraph()
            close_list()
            table_rows = []
            next_index = line_index + 2
            while next_index < len(lines) and lines[next_index].strip() and "|" in lines[next_index]:
                table_rows.append(lines[next_index])
                next_index += 1
            blocks.append(render_table(line, table_rows))
            line_index = next_index
            continue
        heading = re.match(r"^(#{2,3})\s+(.+)$", line)
        if heading:
            flush_paragraph()
            close_list()
            level = len(heading.group(1))
            blocks.append(f"<h{level}>{inline_markdown(heading.group(2))}</h{level}>")
            line_index += 1
            continue
        ordered = re.match(r"^\d+[.)]\s+(.+)$", line)
        bullet = re.match(r"^[-*]\s+(.+)$", line)
        if ordered or bullet:
            flush_paragraph()
            expected_type, item = ("ol", ordered.group(1)) if ordered else ("ul", bullet.group(1))
            if list_type and list_type != expected_type:
                close_list()
            if not list_type:
                blocks.append(f"<{expected_type}>")
                list_type = expected_type
            blocks.append(f"<li>{inline_markdown(item)}</li>")
            line_index += 1
            continue
        if line.startswith("> "):
            flush_paragraph()
            close_list()
            blocks.append(f"<blockquote>{inline_markdown(line[2:])}</blockquote>")
            line_index += 1
            continue
        close_list()
        paragraph.append(line)
        line_index += 1
    flush_paragraph()
    close_list()
    return "\n".join(blocks)


def get_article_by_slug(slug: str):
    conn = get_db()
    article = conn.execute(
        "SELECT * FROM articles WHERE slug = ? AND status = 'published'", (slug,)
    ).fetchone()
    conn.close()
    return article


def public_layout(title: str, description: str, canonical: str, body: str, article=None, preview: bool = False) -> str:
    raw_image = article["cover_image_url"] if article and article["cover_image_url"] else "/images/hero-consulting.jpg"
    image = raw_image if raw_image.startswith(("http://", "https://")) else f"{BASE_URL.rstrip('/')}/{raw_image.lstrip('/')}"
    article_json = ""
    if article:
        data = {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": article["title"],
            "description": description,
            "datePublished": article["published_at"],
            "dateModified": article["updated_at"],
            "mainEntityOfPage": canonical,
            "image": image,
            "author": {"@type": "Organization", "name": "SYMMETRY Lab株式会社"},
            "publisher": {"@type": "Organization", "name": "SYMMETRY Lab株式会社"},
        }
        article_json = '<script type="application/ld+json">' + json.dumps(data, ensure_ascii=False).replace("</", "<\\/") + "</script>"
    return f"""<!DOCTYPE html>
<html lang="ja"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{html.escape(title)}</title><meta name="description" content="{html.escape(description, quote=True)}">
  <meta name="robots" content="{'noindex, nofollow' if preview else 'index, follow, max-image-preview:large'}">{' ' if preview else f'<link rel="canonical" href="{html.escape(canonical, quote=True)}">'}
  <meta property="og:type" content="article"><meta property="og:title" content="{html.escape(title, quote=True)}"><meta property="og:description" content="{html.escape(description, quote=True)}"><meta property="og:url" content="{html.escape(canonical, quote=True)}"><meta property="og:image" content="{html.escape(image, quote=True)}">
  <meta name="twitter:card" content="summary_large_image"><link rel="stylesheet" href="/css/style.css?v=20260714">
  <style>.column-wrap{{max-width:820px;margin:0 auto}}.column-meta{{color:#6b7280;font-size:.9rem;margin-bottom:1rem}}.column-content{{font-size:1rem;line-height:2;color:#273142}}.column-content h2{{font-size:1.65rem;margin:2.5rem 0 1rem;color:#1a2332}}.column-content h3{{font-size:1.3rem;margin:2rem 0 .75rem;color:#1a2332}}.column-content p,.column-content ul,.column-content ol{{margin:0 0 1.25rem}}.column-content ul{{padding-left:1.5rem;list-style:disc}}.column-content ol{{padding-left:1.5rem;list-style:decimal}}.column-content li{{padding-left:.2rem;margin:.35rem 0}}.column-content blockquote{{margin:1.5rem 0;padding:.75rem 1rem;border-left:3px solid #00b4d8;background:#f4f6f9}}.column-content a{{color:#007f9d;text-decoration:underline}}.column-content .table-wrap{{overflow-x:auto;margin:1.5rem 0}}.column-content table{{width:100%;border-collapse:collapse;font-size:.95rem;line-height:1.7;background:#fff}}.column-content th,.column-content td{{border:1px solid #d8dee8;padding:.65rem .75rem;text-align:left;vertical-align:top}}.column-content th{{background:#f4f6f9;font-weight:700;color:#1a2332}}.column-cover{{width:100%;max-height:420px;object-fit:cover;margin:1.5rem 0 2rem;border-radius:8px}}</style>
  {article_json}
</head><body>
<nav class="navbar"><div class="container"><a href="/index.html" class="nav-logo"><img src="/images/logo_full.png" alt="SYMMETRY Lab" class="nav-logo-img"></a><button class="nav-toggle" aria-label="メニュー" aria-expanded="false"><span></span><span></span><span></span></button><div class="nav-links"><a href="/company.html">会社概要</a><a href="/services.html">サービス</a><a href="/blog/">コラム</a><a href="/contact.html">お問い合わせ</a></div></div></nav>
{body}
<footer class="footer"><div class="container"><div class="footer-bottom"><span>&copy; 2026 SYMMETRY Lab株式会社 All rights reserved.</span></div></div></footer>
<script src="/js/main.js"></script>
</body></html>"""


@app.get("/api/admin/articles")
async def admin_list_articles(key: str = ""):
    if not _legacy_admin_key_is_valid(key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    conn = get_db()
    rows = conn.execute("SELECT * FROM articles ORDER BY COALESCE(published_at, updated_at) DESC").fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.post("/api/admin/articles/preview", response_class=HTMLResponse)
async def admin_preview_article(request: Request, key: str = ""):
    if not _legacy_admin_key_is_valid(key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    data = await request.json()
    now = article_timestamp()
    article = {
        "title": (data.get("title") or "無題のコラム").strip(),
        "category": (data.get("category") or "コラム").strip(),
        "content": (data.get("content") or "").strip(),
        "cover_image_url": (data.get("cover_image_url") or "").strip(),
        "meta_title": (data.get("meta_title") or data.get("title") or "プレビュー").strip(),
        "meta_description": (data.get("meta_description") or article_summary(data.get("content") or "")).strip(),
        "published_at": now,
        "updated_at": now,
    }
    image = f'<img class="column-cover" src="{html.escape(article["cover_image_url"], quote=True)}" alt="{html.escape(article["title"], quote=True)}">' if article["cover_image_url"] else ""
    body = f'<div style="background:#1a2332;color:#fff;padding:.6rem 1rem;text-align:center;font-size:.85rem">プレビュー</div><section class="section"><div class="container column-wrap"><p class="column-meta"><a href="/blog/">コラム</a> / {html.escape(article["category"])} / {now[:10].replace("-", ".")}</p><h1 style="font-size:2rem;line-height:1.5">{html.escape(article["title"])}</h1>{image}<div class="column-content">{markdown_to_html(article["content"])}</div></div></section>'
    return HTMLResponse(public_layout(article["meta_title"], article["meta_description"], f"{BASE_URL}/blog/preview/", body, article, preview=True))


def validate_article_payload(body: dict) -> dict:
    slug = (body.get("slug") or "").strip().lower()
    title = (body.get("title") or "").strip()
    status = body.get("status", "draft")
    if not title or len(title) > 120:
        raise HTTPException(status_code=400, detail="タイトルは1〜120文字で入力してください")
    if not ARTICLE_SLUG_RE.fullmatch(slug):
        raise HTTPException(status_code=400, detail="URLは半角小文字・数字・ハイフンのみで入力してください")
    if status not in ("draft", "published"):
        raise HTTPException(status_code=400, detail="公開状態が不正です")
    content = (body.get("content") or "").strip()
    if status == "published" and not content:
        raise HTTPException(status_code=400, detail="公開するには本文を入力してください")
    return {
        "slug": slug, "title": title, "category": (body.get("category") or "").strip()[:50],
        "excerpt": (body.get("excerpt") or article_summary(content))[:300], "content": content,
        "cover_image_url": (body.get("cover_image_url") or "").strip()[:1000],
        "meta_title": (body.get("meta_title") or title)[:120],
        "meta_description": (body.get("meta_description") or article_summary(content))[:200], "status": status,
    }


@app.post("/api/admin/articles")
async def admin_create_article(request: Request, key: str = ""):
    if not _legacy_admin_key_is_valid(key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    data, now = validate_article_payload(await request.json()), article_timestamp()
    data["published_at"] = now if data["status"] == "published" else None
    conn = get_db()
    try:
        cursor = conn.execute("""INSERT INTO articles
            (slug,title,category,excerpt,content,cover_image_url,meta_title,meta_description,status,published_at,created_at,updated_at)
            VALUES (:slug,:title,:category,:excerpt,:content,:cover_image_url,:meta_title,:meta_description,:status,:published_at,:created_at,:updated_at)""", {**data, "created_at": now, "updated_at": now})
        conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="このURLはすでに使われています")
    finally:
        conn.close()
    return {"id": cursor.lastrowid, "slug": data["slug"]}


@app.put("/api/admin/articles/{article_id}")
async def admin_update_article(article_id: int, request: Request, key: str = ""):
    if not _legacy_admin_key_is_valid(key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    data, now = validate_article_payload(await request.json()), article_timestamp()
    conn = get_db()
    current = conn.execute("SELECT published_at FROM articles WHERE id = ?", (article_id,)).fetchone()
    if not current:
        conn.close()
        raise HTTPException(status_code=404, detail="記事が見つかりません")
    data["published_at"] = current["published_at"] or now if data["status"] == "published" else None
    try:
        conn.execute("""UPDATE articles SET slug=:slug,title=:title,category=:category,excerpt=:excerpt,content=:content,
            cover_image_url=:cover_image_url,meta_title=:meta_title,meta_description=:meta_description,status=:status,
            published_at=:published_at,updated_at=:updated_at WHERE id=:id""", {**data, "updated_at": now, "id": article_id})
        conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="このURLはすでに使われています")
    finally:
        conn.close()
    return {"id": article_id, "slug": data["slug"]}


@app.delete("/api/admin/articles/{article_id}")
async def admin_delete_article(article_id: int, key: str = ""):
    if not _legacy_admin_key_is_valid(key):
        raise HTTPException(status_code=403, detail="Unauthorized")
    conn = get_db()
    cursor = conn.execute("DELETE FROM articles WHERE id = ?", (article_id,))
    conn.commit()
    conn.close()
    if not cursor.rowcount:
        raise HTTPException(status_code=404, detail="記事が見つかりません")
    return {"status": "deleted"}


@app.get("/blog", include_in_schema=False)
async def blog_without_trailing_slash():
    return RedirectResponse("/blog/", status_code=308)


@app.get("/blog/index.html", include_in_schema=False)
async def legacy_blog_index():
    return RedirectResponse("/blog/", status_code=308)


@app.get("/blog/", response_class=HTMLResponse, include_in_schema=False)
async def public_blog_index():
    conn = get_db()
    articles = conn.execute("SELECT * FROM articles WHERE status = 'published' ORDER BY published_at DESC").fetchall()
    conn.close()
    cards = []
    for article in articles:
        date = (article["published_at"] or "")[:10].replace("-", ".")
        category = html.escape(article["category"] or "コラム")
        cards.append(f'''<article style="padding:1.5rem 0;border-bottom:1px solid #e5e7eb"><p class="column-meta">{date} / {category}</p><h2 style="font-size:1.35rem;margin-bottom:.7rem"><a href="/blog/{article["slug"]}/" style="color:#1a2332;text-decoration:none">{html.escape(article["title"])}</a></h2><p>{html.escape(article["excerpt"] or article_summary(article["content"]))}</p><p style="margin-top:1rem"><a href="/blog/{article["slug"]}/">続きを読む</a></p></article>''')
    listing = "".join(cards) or "<p>現在公開中のコラムはありません。</p>"
    cta = '<div style="margin-top:2rem;padding:1.5rem;background:#1f2937;color:#fff;border-radius:8px"><h2 style="color:#fff;font-size:1.3rem">ケース面接の準備を、今日から具体化する</h2><p>大手外資コンサル出身者が、思考の癖に合わせて丁寧にケース面接を指導。高い内定率を支える実践的な対策を提供します。</p><p style="margin-bottom:0"><a href="/lp-case.html" class="btn-primary">ケース面接対策を見る</a></p></div>'
    body = f'<section class="section"><div class="container column-wrap"><div class="section-header"><h1>コラム</h1><p>戦略コンサル転職、ケース面接、実務スキルに役立つ情報を発信しています。</p></div>{listing}{cta}</div></section>'
    return HTMLResponse(public_layout("コラム | SYMMETRY Lab株式会社", "戦略コンサル転職に役立つコラム。実務スキルやケース面接のノウハウを解説します。", "https://symmetrylab.jp/blog/", body))


@app.get("/blog/{slug}/", response_class=HTMLResponse, include_in_schema=False)
async def public_article(slug: str):
    redirected_slug = ARTICLE_SLUG_REDIRECTS.get(slug)
    if redirected_slug:
        return RedirectResponse(url=f"/blog/{redirected_slug}/", status_code=301)
    article = get_article_by_slug(slug)
    if not article:
        raise HTTPException(status_code=404, detail="Not found")
    canonical = f"https://symmetrylab.jp/blog/{article['slug']}/"
    date = (article["published_at"] or "")[:10].replace("-", ".")
    image = f'<img class="column-cover" src="{html.escape(article["cover_image_url"], quote=True)}" alt="{html.escape(article["title"], quote=True)}">' if article["cover_image_url"] else ""
    body = f'<section class="section"><div class="container column-wrap"><p class="column-meta"><a href="/blog/">コラム</a> / {html.escape(article["category"] or "コラム")} / {date}</p><h1 style="font-size:2rem;line-height:1.5">{html.escape(article["title"])}</h1>{image}<div class="column-content">{markdown_to_html(article["content"])}</div></div></section>'
    return HTMLResponse(public_layout(article["meta_title"] or article["title"], article["meta_description"] or article_summary(article["content"]), canonical, body, article))


@app.get("/sitemap.xml", response_class=HTMLResponse, include_in_schema=False)
async def dynamic_sitemap():
    static_urls = ["/", "/lp-case.html", "/lp-training.html", "/services.html", "/booking.html", "/blog/", "/faq.html", "/company.html", "/contact.html", "/privacy.html", "/tokushoho.html"]
    conn = get_db()
    articles = conn.execute("SELECT slug, updated_at FROM articles WHERE status = 'published' ORDER BY published_at DESC").fetchall()
    conn.close()
    urls = [(f"https://symmetrylab.jp{path}", "2026-07-14") for path in static_urls]
    urls.extend((f"https://symmetrylab.jp/blog/{row['slug']}/", (row["updated_at"] or "")[:10]) for row in articles)
    entries = "".join(f"<url><loc>{html.escape(loc)}</loc><lastmod>{lastmod}</lastmod></url>" for loc, lastmod in urls)
    return HTMLResponse(f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>', media_type="application/xml")


@app.api_route("/api/health", methods=["GET", "HEAD"])
async def health():
    return {"status": "ok", "time": datetime.now().isoformat()}


@app.get("/api/tracking-config", include_in_schema=False)
async def tracking_config():
    """Expose public tag identifiers without hard-coding production IDs in the LP."""
    return {
        "gtm_container_id": os.getenv("SYMMETRY_GTM_CONTAINER_ID", "").strip(),
        "ga4_measurement_id": os.getenv("SYMMETRY_GA4_MEASUREMENT_ID", "").strip(),
        "google_ads_conversion_id": os.getenv("SYMMETRY_GOOGLE_ADS_CONVERSION_ID", "").strip(),
        "google_ads_conversion_label": os.getenv("SYMMETRY_GOOGLE_ADS_CONVERSION_LABEL", "").strip(),
    }


@app.on_event("startup")
async def startup():
    init_db()
    print(f"[起動] SYMMETRY Lab 予約サーバー - {BASE_URL}")


# 静的ファイル配信（最後にマウント）
static_dir = os.getenv("WEBSITE_DIR", os.path.join(os.path.dirname(__file__), ".."))
if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
