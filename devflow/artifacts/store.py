import json
from pathlib import Path

from devflow.config import settings


class ArtifactStore:
    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self.base_dir = Path(settings.ARTIFACTS_DIR) / run_id
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def artifact_path(self, filename: str) -> Path:
        return self.base_dir / filename

    def save(self, filename: str, content: str) -> Path:
        path = self.artifact_path(filename)
        # Back up existing file from a prior attempt
        if path.exists():
            existing = path.read_text(encoding="utf-8")
            attempt = 1
            while True:
                bak = self.base_dir / f"{filename}.attempt{attempt}.bak"
                if not bak.exists():
                    bak.write_text(existing, encoding="utf-8")
                    break
                attempt += 1
        path.write_text(content, encoding="utf-8")
        return path

    def load(self, filename: str) -> str:
        path = self.artifact_path(filename)
        if not path.exists():
            raise FileNotFoundError(f"Artifact not found: {filename} (run {self.run_id})")
        return path.read_text(encoding="utf-8")

    def load_parsed(self, filename: str) -> str | dict | list:
        content = self.load(filename)
        if filename.endswith(".json"):
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                return content
        return content

    def load_all_prior(self, stage_artifact_map: dict[str, list[str]]) -> dict[str, dict]:
        """Load artifacts for a set of stages.

        stage_artifact_map: {stage_key: [filename, ...]}
        Returns: {stage_key: {filename: parsed_content}}
        """
        result: dict[str, dict] = {}
        for stage_key, filenames in stage_artifact_map.items():
            result[stage_key] = {}
            for filename in filenames:
                try:
                    result[stage_key][filename] = self.load_parsed(filename)
                except FileNotFoundError:
                    pass
        return result

    def exists(self, filename: str) -> bool:
        return self.artifact_path(filename).exists()

    def size(self, filename: str) -> int:
        path = self.artifact_path(filename)
        return path.stat().st_size if path.exists() else 0
