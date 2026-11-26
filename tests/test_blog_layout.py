"""コラム（サーバーで組み立てるページ）が、HPの新デザインの共通ヘッダー・フッターで表示されることのテスト。"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from server import app as app_module


class BlogLayoutTests(unittest.TestCase):
    """コラム一覧と記事ページのHTMLを確認する。"""

    def setUp(self):
        """一時DBに初期の記事を入れて、本物のDBに触れずに確認する。"""
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        db_patch = patch.object(app_module, "DB_PATH", str(Path(self.temp.name) / "test.db"))
        db_patch.start()
        self.addCleanup(db_patch.stop)
        app_module.init_db()
        self.client = TestClient(app_module.app)

    def assert_new_layout(self, html: str):
        """新デザインの部品がそろい、旧デザインのナビゲーションが残っていないことを確認する。"""
        for part in ['href="/theme.css"', 'id="menuBtn"', 'class="nav" id="nav"', 'class="footer site-footer"',
                     'src="/sub.js?v=20261126-01"', '<canvas id="gl"']:
            self.assertIn(part, html)
        self.assertNotIn('class="navbar"', html)

    def test_blog_index_uses_new_layout(self):
        res = self.client.get("/blog/")
        self.assertEqual(res.status_code, 200)
        self.assert_new_layout(res.text)
        self.assertIn('class="column-card"', res.text)

    def test_article_uses_new_layout(self):
        conn = app_module.get_db()
        try:
            slug = conn.execute("SELECT slug FROM articles WHERE status = 'published' LIMIT 1").fetchone()["slug"]
        finally:
            conn.close()
        res = self.client.get(f"/blog/{slug}/")
        self.assertEqual(res.status_code, 200)
        self.assert_new_layout(res.text)
        self.assertIn('class="column-content"', res.text)


if __name__ == "__main__":
    unittest.main()
