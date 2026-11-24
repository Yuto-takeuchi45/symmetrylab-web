"""静的ファイル配信の公開範囲（ページ・画像とページに必要なCSS/JSだけを配信する）のテスト。"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from server import app as app_module

REPO_ROOT = Path(app_module.__file__).resolve().parent.parent


class PublicStaticPathRuleTests(unittest.TestCase):
    """公開可否の判定関数を、パスの形ごとに確認する。"""

    def test_public_paths(self):
        for path in ["index.html", "blog/index.html", "images/logo_full.png", "favicon.ico",
                     "css/style.css", "js/main.js", "style.css", "robots.txt", "IMAGES/A.JPG"]:
            with self.subTest(path=path):
                self.assertTrue(app_module.is_public_static_path(path, is_dir=False))
        for path in ["", ".", "blog", "images", "recruitment"]:
            with self.subTest(dir=path):
                self.assertTrue(app_module.is_public_static_path(path, is_dir=True))

    def test_private_paths(self):
        for path in ["server/app.py", "server/referral_codes.json", "render.yaml", "requirements.txt",
                     "runtime.txt", "GOOGLE_ADS_SETUP.md", "bookings.db", "tests/test_meta_capi.py",
                     "docs/adr/0001-contact-inquiries.md", "downloads/case_interview_framework.pdf",
                     "ad_creative/README.md", "ad_creative/wius-style-funnel-preview.html",
                     "ad_creative/assets/instagram-consulting-01.png", ".gitignore", ".env",
                     ".git/config", ".deploy_master/index.html", "images/.hidden.png",
                     "server/index.html", "tracking.env.example", "google-ads-keyword-research-template.csv",
                     "blog/robots.txt", "recruitment/jobs.json"]:
            with self.subTest(path=path):
                self.assertFalse(app_module.is_public_static_path(path, is_dir=False))
        # 大文字・小文字を区別しないファイルシステムでの書き換えによる回避も防ぐ
        for path in ["AD_CREATIVE/wius-style-funnel-preview.html", "Server/app.py", "TESTS/test_meta_capi.py"]:
            with self.subTest(path=path):
                self.assertFalse(app_module.is_public_static_path(path, is_dir=False))
        for path in ["server", "tests", ".git", "docs/adr", "ad_creative"]:
            with self.subTest(dir=path):
                self.assertFalse(app_module.is_public_static_path(path, is_dir=True))


class PublicStaticServingTests(unittest.TestCase):
    """実際のリポジトリを配信したときのHTTP応答を確認する。"""

    def setUp(self):
        """起動時の初期化が本物のDBに触れないよう、一時DBを使う。"""
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        db_patch = patch.object(app_module, "DB_PATH", str(Path(self.temp.name) / "test.db"))
        db_patch.start()
        self.addCleanup(db_patch.stop)
        self.client = TestClient(app_module.app)

    def test_site_pages_and_assets_are_served(self):
        for url in ["/", "/index.html", "/services.html", "/contact.html", "/company.html",
                    "/images/logo_full.png", "/favicon.ico", "/css/style.css", "/js/main.js",
                    "/style.css", "/main.js", "/robots.txt", "/consulting-career/", "/recruitment/"]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_directory_without_slash_still_redirects(self):
        res = self.client.get("/consulting-career", follow_redirects=False)
        self.assertIn(res.status_code, (301, 302, 307, 308))

    def test_private_files_are_not_served(self):
        urls = ["/server/app.py", "/server/referral_codes.json", "/server/training_dates.json",
                "/render.yaml", "/requirements.txt", "/runtime.txt", "/GOOGLE_ADS_SETUP.md",
                "/tests/test_meta_capi.py", "/docs/adr/0001-contact-inquiries.md",
                "/downloads/case_interview_framework.pdf", "/ad_creative/README.md",
                "/ad_creative/symmetrylab-career-quiz-lp.html", "/ad_creative/assets/instagram-consulting-01.png",
                "/.gitignore", "/.git/config", "/server/", "/tests/", "/tracking.env.example",
                "/%2e%2e/%2e%2e/etc/passwd", "/images/../server/app.py"]
        for url in urls:
            with self.subTest(url=url):
                res = self.client.get(url)
                self.assertEqual(res.status_code, 404, f"{url} が公開されています")
                self.assertNotIn("import sqlite3", res.text)

    def test_api_docs_are_not_public(self):
        """APIの自動ドキュメント（管理系APIの一覧が見えてしまう）を公開しないこと。"""
        for url in ["/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)

    def test_routes_outside_static_still_work(self):
        """静的配信の制限が、個別に用意したルート（広告LP・求人データ・ヘルスチェック）に影響しないこと。"""
        self.assertEqual(self.client.get("/career-check/").status_code, 200)
        self.assertEqual(self.client.get("/api/health").status_code, 200)
        jobs = REPO_ROOT / "recruitment" / "jobs.json"
        if jobs.exists():
            self.assertEqual(self.client.get("/recruitment/jobs.json").status_code, 200)


if __name__ == "__main__":
    unittest.main()
