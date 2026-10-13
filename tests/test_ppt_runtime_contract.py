import unittest
from pathlib import Path


class PptRuntimeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parent.parent
        cls.root = root
        cls.compose = (root / "docker-compose.agent.yml").read_text(encoding="utf-8")
        cls.env_example = (root / "design-agent.env.example").read_text(encoding="utf-8")
        cls.start_batch = (root / "start-windows.bat").read_text(encoding="utf-8")
        cls.stop_batch = (root / "stop-windows.bat").read_text(encoding="utf-8")
        cls.gitignore = (root / ".gitignore").read_text(encoding="utf-8")
        cls.start_ppt = (root / "ops" / "ppt" / "start-ppt.ps1").read_text(encoding="utf-8")
        cls.stop_ppt = (root / "ops" / "ppt" / "stop-ppt.ps1").read_text(encoding="utf-8")
        cls.readme = (root / "README.md").read_text(encoding="utf-8")
        cls.ppt_dockerignore = (root / "ppt-app" / ".dockerignore").read_text(encoding="utf-8")

    def test_example_environment_lists_the_ppt_boundary(self):
        for name in (
            "PPT_POSTGRES_PASSWORD",
            "PPT_DATABASE_URL",
            "PPT_INTERNAL_URL",
            "PPT_INTERNAL_TOKEN",
            "PPT_STORAGE_PATH",
        ):
            self.assertIn(f"{name}=", self.env_example)

    def test_compose_keeps_ppt_database_and_node_internal(self):
        self.assertIn("  ppt-postgres:", self.compose)
        self.assertIn('127.0.0.1:5434:5432', self.compose)
        self.assertIn("ppt-postgres-data:/var/lib/postgresql/data", self.compose)
        self.assertIn("  ppt-migrate:", self.compose)
        self.assertIn("target: migrate", self.compose)
        self.assertIn("condition: service_completed_successfully", self.compose)
        self.assertIn("  ppt-app:", self.compose)
        self.assertIn("target: runner", self.compose)
        self.assertIn('      - "37623"', self.compose)
        self.assertNotIn('"37623:37623"', self.compose)
        self.assertIn("http://ppt-app:37623", self.compose)
        self.assertIn("http://lingdraw:37621", self.compose)
        self.assertIn("/ppt/api/health", self.compose)

    def test_compose_preserves_local_and_s3_storage_configuration(self):
        self.assertIn("STORAGE_PROVIDER: ${STORAGE_PROVIDER:-local}", self.compose)
        for name in (
            "S3_ENDPOINT",
            "S3_REGION",
            "S3_BUCKET",
            "S3_ACCESS_KEY",
            "S3_SECRET_KEY",
            "S3_FORCE_PATH_STYLE",
        ):
            self.assertIn(f"{name}: ${{{name}:-", self.compose)
            self.assertIn(f"{name}=", self.env_example)

    def test_windows_launcher_preflights_and_cleans_up_the_sidecar(self):
        self.assertIn('set "PPT_APP_PORT=37623"', self.start_batch)
        self.assertIn("pptx, jsonschema", self.start_batch)
        self.assertIn("ops\\ppt\\start-ppt.ps1", self.start_batch)
        self.assertIn("ops\\ppt\\stop-ppt.ps1", self.start_batch)
        self.assertIn("-PidFileOnly", self.start_batch)
        self.assertIn("[guid]::NewGuid().ToString('N')", self.start_batch)
        self.assertIn("ppt-internal-token", self.start_batch)
        self.assertIn("could not persist the PPT internal token", self.start_batch)
        self.assertNotIn(">\"%~dp0data\\ppt\\ppt-internal-token\" echo", self.start_batch)
        self.assertNotIn('set "PPT_INTERNAL_TOKEN=local-', self.start_batch)
        self.assertIn("/data/ppt/", self.gitignore)
        self.assertIn("npmCommand.Source --prefix $appRoot run db:deploy", self.start_ppt)
        self.assertIn("npmCommand.Source --prefix $appRoot run db:seed", self.start_ppt)
        self.assertIn("npmCommand.Source --prefix $appRoot run build", self.start_ppt)
        self.assertIn('Join-Path $appRoot ".next\\standalone"', self.start_ppt)
        self.assertIn('Join-Path $standaloneRoot "server.js"', self.start_ppt)
        self.assertIn("-ArgumentList @($quotedStandaloneServer)", self.start_ppt)
        self.assertNotIn('"dev", "-H"', self.start_ppt)
        self.assertIn("/ppt/api/health", self.start_ppt)

    def test_windows_launchers_persist_a_random_ppt_postgres_password(self):
        password_file = "ppt-postgres-password"
        self.assertIn(password_file, self.start_batch)
        self.assertIn(password_file, self.start_ppt)
        self.assertIn(password_file, self.stop_ppt)
        self.assertIn("set /p PPT_POSTGRES_PASSWORD", self.start_batch)
        self.assertIn("[guid]::NewGuid().ToString('N')", self.start_batch)
        self.assertIn('[guid]::NewGuid().ToString("N")', self.start_ppt)
        self.assertIn('[guid]::NewGuid().ToString("N")', self.stop_ppt)
        self.assertIn("[System.IO.File]::WriteAllText", self.start_batch)
        self.assertIn("[System.IO.File]::WriteAllText", self.start_ppt)
        self.assertIn("[System.IO.File]::WriteAllText", self.stop_ppt)
        self.assertIn("could not persist the PPT PostgreSQL password", self.start_batch)
        self.assertIn("PPT_POSTGRES_PASSWORD = $env:PPT_POSTGRES_PASSWORD", self.start_ppt)
        self.assertIn("PPT_POSTGRES_PASSWORD = $env:PPT_POSTGRES_PASSWORD", self.stop_ppt)
        self.assertLess(
            self.start_batch.index('if exist "%PPT_POSTGRES_PASSWORD_FILE%"'),
            self.start_batch.index("[guid]::NewGuid().ToString('N')"),
        )
        for script in (self.start_ppt, self.stop_ppt):
            self.assertLess(
                script.index('GetEnvironmentVariable("PPT_POSTGRES_PASSWORD", "Process")'),
                script.index("ReadAllText($PasswordPath)"),
            )
            self.assertLess(
                script.index("ReadAllText($PasswordPath)"),
                script.index('[guid]::NewGuid().ToString("N")'),
            )
        self.assertNotIn('PPT_POSTGRES_PASSWORD=folio', self.start_batch)
        self.assertNotIn('else { "folio" }', self.start_ppt)
        self.assertNotIn('else { "folio" }', self.stop_ppt)

    def test_explicit_stop_handles_both_node_and_managed_database(self):
        self.assertIn("ops\\ppt\\stop-ppt.ps1", self.stop_batch)
        self.assertIn("Test-ManagedPptProcess", self.stop_ppt)
        self.assertIn("taskkill.exe /PID $processId /T", self.stop_ppt)
        self.assertIn("stop --timeout 15 ppt-postgres", self.stop_ppt)

    def test_root_compose_is_the_only_supported_ppt_compose_entrypoint(self):
        self.assertFalse((self.root / "ppt-app" / "docker-compose.yml").exists())
        self.assertIn("不要在 `ppt-app` 子目录单独运行 Compose", self.readme)

    def test_dockerignore_keeps_the_storage_provider_source_code(self):
        self.assertIn("/storage", self.ppt_dockerignore.splitlines())
        self.assertNotIn("storage", self.ppt_dockerignore.splitlines())
        self.assertTrue((self.root / "ppt-app" / "src" / "lib" / "storage" / "index.ts").is_file())


if __name__ == "__main__":
    unittest.main()
