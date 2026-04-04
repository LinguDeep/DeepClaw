"""Containerized tools with Docker sandboxing and fallback safety."""
import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

from .sandbox import DockerSandbox, SandboxConfig, FallbackSafetyMode
from .safety import SafetyMiddleware
from .memory import RAGMemory

logger = logging.getLogger("linguclaw.tools")


@dataclass(frozen=True)
class CommandResult:
    stdout: str
    stderr: str
    returncode: int
    sandboxed: bool = True


@dataclass(frozen=True)
class FileResult:
    success: bool
    content: Optional[str] = None
    error: Optional[str] = None


class ShellTool:
    """Docker-sandboxed shell execution with fallback to strict safety mode."""

    def __init__(self, project_root: str, use_docker: bool = True, 
                 safety: Optional[SafetyMiddleware] = None,
                 fallback_confirmed: bool = False):
        self.project_root = Path(project_root).resolve()
        self.project_root.mkdir(parents=True, exist_ok=True)
        self.safety = safety or SafetyMiddleware()
        
        # Docker sandbox setup
        self.sandbox: Optional[DockerSandbox] = None
        self.fallback: Optional[FallbackSafetyMode] = None
        self._using_docker = False
        
        if use_docker:
            self.sandbox = DockerSandbox(SandboxConfig(
                image="alpine:latest",
                memory_limit="512m",
                cpu_limit=0.5,
                auto_remove=True,
            ))
            if self.sandbox.available:
                if self.sandbox.start(str(self.project_root)):
                    self._using_docker = True
                    logger.info("Using Docker sandbox")
                else:
                    logger.warning("Docker available but sandbox start failed")
                    self._init_fallback(fallback_confirmed)
            else:
                self._init_fallback(fallback_confirmed)
        else:
            self._init_fallback(fallback_confirmed)

    def _init_fallback(self, confirmed: bool):
        """Initialize strict safety fallback mode."""
        self.fallback = FallbackSafetyMode(self.safety, confirmed)
        logger.warning("Docker unavailable - using strict safety fallback")

    @property
    def is_sandboxed(self) -> bool:
        return self._using_docker and self.sandbox is not None

    async def run(self, command: str, timeout: float = 60.0) -> CommandResult:
        """Execute command in Docker container or with strict safety fallback."""
        
        if self.is_sandboxed and self.sandbox:
            # Docker sandboxed execution
            try:
                # Run in executor to make it async
                loop = asyncio.get_event_loop()
                exit_code, stdout, stderr = await asyncio.wait_for(
                    loop.run_in_executor(None, self.sandbox.exec, command),
                    timeout=timeout
                )
                return CommandResult(stdout, stderr, exit_code, sandboxed=True)
            except asyncio.TimeoutError:
                return CommandResult("", f"Timeout after {timeout}s", -1, sandboxed=True)
            except Exception as e:
                return CommandResult("", f"Sandbox error: {e}", -1, sandboxed=True)
        
        elif self.fallback:
            # Strict safety fallback - requires explicit confirmation
            allowed, reason = self.fallback.check(command)
            
            if not allowed:
                # Try to get explicit confirmation for this command
                if self.fallback.prompt_confirmation(command):
                    allowed = True
            
            if not allowed:
                return CommandResult("", f"STRICT SAFETY BLOCKED: {reason}", -1, sandboxed=False)
            
            # Execute with basic subprocess (only after confirmation)
            try:
                import subprocess
                proc = await asyncio.create_subprocess_shell(
                    command,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=str(self.project_root),
                )
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
                return CommandResult(
                    stdout.decode("utf-8", errors="replace"),
                    stderr.decode("utf-8", errors="replace"),
                    proc.returncode or 0,
                    sandboxed=False
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                return CommandResult("", f"Timeout after {timeout}s", -1, sandboxed=False)
            except Exception as e:
                return CommandResult("", str(e), -1, sandboxed=False)
        
        return CommandResult("", "No execution method available", -1, sandboxed=False)

    def stop(self):
        """Cleanup sandbox resources."""
        if self.sandbox:
            self.sandbox.stop()

class SearchMemoryTool:
    """RAG-based semantic search over codebase memory."""

    def __init__(self, memory: RAGMemory):
        self.memory = memory

    def search_codebase(self, query: str, k: int = 5) -> str:
        """Search the indexed codebase for relevant code."""
        if not self.memory.available:
            return "[Memory unavailable - RAG system offline]"
        return self.memory.search(query, k)

    def get_stats(self) -> dict:
        return self.memory.get_stats()

class FileSystemTool:
    """Sandboxed filesystem operations."""

    def __init__(self, root: str):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _validate(self, path: str) -> Path:
        target = Path(path).resolve()
        if not target.is_relative_to(self.root):
            raise PermissionError(f"Access denied: {path} outside {self.root}")
        return target

    def read(self, path: str, limit: Optional[int] = None) -> FileResult:
        try:
            t = self._validate(path)
            if not t.exists(): return FileResult(False, error=f"Not found: {path}")
            if not t.is_file(): return FileResult(False, error=f"Not a file: {path}")
            c = t.read_text(encoding="utf-8", errors="replace")
            if limit and len(c) > limit: c = c[:limit] + f"\n... ({len(c)-limit} more)"
            return FileResult(True, content=c)
        except PermissionError as e: return FileResult(False, error=str(e))
        except Exception as e: return FileResult(False, error=f"Read error: {e}")

    def write(self, path: str, content: str) -> FileResult:
        try:
            t = self._validate(path)
            t.parent.mkdir(parents=True, exist_ok=True)
            t.write_text(content, encoding="utf-8")
            return FileResult(True)
        except PermissionError as e: return FileResult(False, error=str(e))
        except Exception as e: return FileResult(False, error=f"Write error: {e}")

    def list_dir(self, path: str = ".") -> FileResult:
        try:
            t = self._validate(path)
            if not t.exists(): return FileResult(False, error=f"Not found: {path}")
            if not t.is_dir(): return FileResult(False, error=f"Not a directory: {path}")
            entries = [f"{'[dir]' if e.is_dir() else '[file]'} {e.name}" for e in t.iterdir()]
            return FileResult(True, content="\n".join(sorted(entries)))
        except PermissionError as e: return FileResult(False, error=str(e))
        except Exception as e: return FileResult(False, error=f"List error: {e}")
