"""Docker sandbox management layer for containerized execution."""
import logging
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Docker imports - global scope for GitHub Actions compatibility
try:
    import docker
    from docker.errors import ImageNotFound
    _DOCKER_AVAILABLE = True
except ImportError:
    docker = None
    ImageNotFound = None
    _DOCKER_AVAILABLE = False

logger = logging.getLogger("linguclaw.sandbox")


@dataclass
class SandboxConfig:
    image: str = "alpine:latest"
    memory_limit: str = "512m"
    cpu_limit: float = 0.5
    timeout: int = 300
    auto_remove: bool = True
    network_disabled: bool = False


class DockerSandbox:
    """Docker container manager for sandboxed command execution."""

    def __init__(self, config: Optional[SandboxConfig] = None):
        self.config = config or SandboxConfig()
        self.client = None
        self.container = None
        self._available = False
        self._mount_point: Optional[str] = None
        self._init_docker()

    def _init_docker(self):
        """Initialize Docker client, handling unavailable Docker gracefully."""
        if not _DOCKER_AVAILABLE:
            logger.warning("docker-py not installed - sandbox unavailable")
            return
        
        try:
            self.client = docker.from_env()
            self.client.ping()
            self._available = True
            logger.info("Docker sandbox initialized (%s)", self.config.image)
        except Exception as e:
            logger.warning("Docker unavailable: %s", e)

    @property
    def available(self) -> bool:
        return self._available and self.client is not None

    @property
    def mount_point(self) -> Optional[str]:
        return self._mount_point

    def start(self, project_root: str) -> bool:
        """Start sandbox container with strict volume mounting."""
        if not self.available:
            logger.error("Cannot start sandbox: Docker not available")
            return False

        root_path = Path(project_root).resolve()
        if not root_path.exists():
            root_path.mkdir(parents=True, exist_ok=True)

        self._mount_point = str(root_path)

        try:
            # Pre-pull image if needed
            try:
                self.client.images.get(self.config.image)
            except ImageNotFound:
                logger.info("Pulling image %s...", self.config.image)
                self.client.images.pull(self.config.image)

            # Run container with strict resource limits and volume mount
            host_config = self.client.api.create_host_config(
                binds={
                    str(root_path): {
                        "bind": "/workspace",
                        "mode": "rw"
                    }
                },
                mem_limit=self.config.memory_limit,
                nano_cpus=int(self.config.cpu_limit * 1e9),
                network_mode="none" if self.config.network_disabled else "bridge",
                auto_remove=self.config.auto_remove,
                cap_drop=["ALL"],
                security_opt=["no-new-privileges"],
                read_only_rootfs=True,
            )

            self.container = self.client.api.create_container(
                image=self.config.image,
                command=["sleep", str(self.config.timeout)],
                working_dir="/workspace",
                host_config=host_config,
                environment={"HOME": "/workspace", "USER": "sandbox"},
            )

            self.client.api.start(self.container["Id"])
            logger.info("Sandbox started: %s (mount: /workspace -> %s)",
                       self.container["Id"][:12], root_path)
            return True

        except Exception as e:
            logger.error("Failed to start sandbox: %s", e)
            self._cleanup()
            return False

    def exec(self, command: str, workdir: Optional[str] = None) -> Tuple[int, str, str]:
        """Execute command inside sandbox container."""
        if not self.available or not self.container:
            return -1, "", "Sandbox not available"

        try:
            # Use shell to execute complex commands
            exec_config = self.client.api.exec_create(
                self.container["Id"],
                ["/bin/sh", "-c", command],
                workdir=workdir or "/workspace",
                stdout=True,
                stderr=True,
                stdin=False,
            )

            output = self.client.api.exec_start(exec_config["Id"], stream=False)

            # Get exit code
            inspect = self.client.api.exec_inspect(exec_config["Id"])
            exit_code = inspect.get("ExitCode", -1)

            # Decode output
            stdout = output.decode("utf-8", errors="replace") if output else ""
            # Docker combines stdout/stderr; we approximate by returning all as stdout
            return exit_code, stdout, ""

        except Exception as e:
            logger.error("Exec failed: %s", e)
            return -1, "", str(e)

    def stop(self) -> None:
        """Stop and cleanup sandbox container."""
        self._cleanup()

    def _cleanup(self):
        """Internal cleanup of container resources."""
        if self.container and self.client:
            try:
                container_id = self.container.get("Id") if isinstance(self.container, dict) else self.container.id
                try:
                    self.client.api.stop(container_id, timeout=5)
                except Exception:
                    pass
                try:
                    self.client.api.remove_container(container_id, force=True)
                except Exception:
                    pass
                logger.info("Sandbox cleaned up: %s", container_id[:12] if len(str(container_id)) > 12 else container_id)
            except Exception as e:
                logger.warning("Cleanup error: %s", e)
        self.container = None
        self._mount_point = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.stop()


class FallbackSafetyMode:
    """Strict safety fallback when Docker is unavailable."""

    def __init__(self, safety_middleware, confirmed: bool = False):
        self.safety = safety_middleware
        self.confirmed = confirmed
        self.enabled = True

    def check(self, command: str) -> Tuple[bool, str]:
        """Check if command is allowed in strict safety mode."""
        if not self.enabled:
            return False, "Strict safety mode disabled"

        result = self.safety.analyze(command)

        if result.risk_level == "high":
            return False, f"BLOCKED (High Risk, score={result.score}): {result.reason}"

        if result.risk_level == "medium" and not self.confirmed:
            return False, f"BLOCKED (Medium Risk requires confirmation): {result.reason}"

        return True, f"ALLOWED ({result.risk_level}, score={result.score})"

    def prompt_confirmation(self, command: str) -> bool:
        """Explicit user confirmation for strict mode."""
        result = self.safety.analyze(command)
        print(f"\n⚠️  STRICT SAFETY MODE - Docker unavailable")
        print(f"Command: {command}")
        print(f"Risk: {result.risk_level.upper()} (score={result.score})")
        print(f"Reason: {result.reason}")
        try:
            r = input("Execute in UNSANDBOXED environment? [yes/N]: ").strip().lower()
            if r == "yes":
                self.confirmed = True
                return True
        except EOFError:
            pass
        return False
