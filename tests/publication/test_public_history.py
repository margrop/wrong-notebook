"""验证上传前拦截历史信息，而不只检查当前文件。"""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

CHECKER = Path(__file__).resolve().parents[2] / "scripts/check-public-history.py"


class PublicHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.repo = Path(self.temporary.name)
        self.git("init", "-q")
        self.git("config", "user.name", "测试用户")
        self.git("config", "user.email", "test@example.com")
        self.commit("README.md", "公开源码\n")

    def tearDown(self):
        self.temporary.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.repo, stderr=subprocess.STDOUT)

    def commit(self, path, content):
        file = self.repo / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content)
        self.git("add", path)
        self.git("commit", "-qm", "test: 更新测试文件")

    def check(self, ref="HEAD"):
        return subprocess.run([sys.executable, str(CHECKER), ref], cwd=self.repo, capture_output=True, text=True)

    def test_public_history_passes(self):
        self.assertEqual(self.check().returncode, 0)

    def test_checker_source_can_be_published_without_self_matching(self):
        self.commit("scripts/check-public-history.py", CHECKER.read_text())
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_shallow_clone_cannot_bypass_historical_checks(self):
        with tempfile.TemporaryDirectory() as temporary:
            clone = Path(temporary) / "shallow"
            subprocess.run(["git", "clone", "-q", "--depth=1", self.repo.as_uri(), str(clone)],
                           check=True, capture_output=True)
            result = subprocess.run([sys.executable, str(CHECKER), "HEAD"], cwd=clone,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn("完整历史", result.stderr)

    def test_deleted_private_file_still_blocks_publication(self):
        self.commit(".gitea/workflows/deploy.yml", "部署工作流\n")
        self.git("rm", "-q", ".gitea/workflows/deploy.yml")
        self.git("commit", "-qm", "test: 删除部署文件")
        result = self.check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("私有文件历史", result.stderr)

    def test_local_extension_cannot_be_published(self):
        self.commit("src/extensions/local/ai-account.ts", "export const aiAccountProvider = {};\n")
        result = self.check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("私有文件历史", result.stderr)

    def test_removed_internal_address_still_blocks_publication_without_disclosing_it(self):
        address = ".".join(("10", "42", "1", "7"))
        self.commit("README.md", "http://" + address + "/\n")
        self.commit("README.md", "公开源码\n")
        result = self.check()
        self.assertEqual(result.returncode, 1)
        self.assertIn("内网地址", result.stderr)
        self.assertNotIn(address, result.stderr)

    def test_merging_private_history_is_rejected(self):
        public = self.git("rev-parse", "HEAD").decode().strip()
        self.git("checkout", "-qb", "private-deploy")
        self.commit("deploy/server.example.json", "{}\n")
        self.git("rm", "-q", "deploy/server.example.json")
        self.git("commit", "-qm", "test: 删除私有配置")
        private = self.git("rev-parse", "HEAD").decode().strip()
        self.git("checkout", "-qb", "public-main", public)
        self.commit("public.txt", "公开功能\n")
        self.git("merge", "--no-ff", "-qm", "test: 合并分支", private)
        self.assertEqual(self.check().returncode, 1)

    def test_private_machine_identity_is_rejected(self):
        self.git("config", "user.email", "test@" + "workstation" + ".local")
        self.commit("README.md", "公开源码更新\n")
        self.assertEqual(self.check().returncode, 1)

    def test_annotated_tag_message_is_checked(self):
        address = ".".join(("10", "42", "1", "7"))
        self.git("tag", "-a", "v1.0.0", "-m", "部署地址 " + address)
        self.assertEqual(self.check("v1.0.0").returncode, 1)

    def test_public_baseline_does_not_hide_new_private_history(self):
        baseline = self.git("rev-parse", "HEAD").decode().strip()
        self.commit("README.md", ".".join(("10", "42", "1", "7")))
        self.commit("README.md", "公开源码\n")
        program = (
            "import importlib.util, sys; "
            "spec=importlib.util.spec_from_file_location('checker', sys.argv[1]); "
            "module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); "
            "module.PUBLIC_BASELINE=sys.argv[2]; sys.exit(module.check('HEAD'))"
        )
        result = subprocess.run([sys.executable, "-c", program, str(CHECKER), baseline],
                                cwd=self.repo, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("内网地址", result.stderr)


if __name__ == "__main__":
    unittest.main()
