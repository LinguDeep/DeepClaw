"""Web UI server for LinguClaw with clean CSS interface."""
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import asdict

from .orchestrator import Orchestrator, SharedState, StepStatus
from .memory import RAGMemory
from .plugins import PluginManager

try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import HTMLResponse, JSONResponse
    from pydantic import BaseModel
    _FASTAPI_AVAILABLE = True
except ImportError:
    _FASTAPI_AVAILABLE = False
    FastAPI = None
    WebSocket = None
    BaseModel = None

logger = logging.getLogger("linguclaw.web")


# Request/Response models
class TaskRequest(BaseModel):
    task: str
    model: str = "anthropic/claude-3.5-sonnet"
    max_steps: int = 15


class TaskResponse(BaseModel):
    task_id: str
    status: str
    message: str


class WebUIManager:
    """Manages the web UI server and state."""
    
    def __init__(self, project_root: str, host: str = "0.0.0.0", port: int = 8080):
        self.project_root = project_root
        self.host = host
        self.port = port
        self.app: Optional[FastAPI] = None
        self.orchestrator: Optional[Orchestrator] = None
        self.plugin_manager: Optional[PluginManager] = None
        self.active_connections: List[WebSocket] = []
        self._running = False
    
    def _create_app(self) -> FastAPI:
        """Create FastAPI application with routes."""
        if not _FASTAPI_AVAILABLE:
            raise ImportError("FastAPI not installed. Run: pip install fastapi uvicorn")
        
        @asynccontextmanager
        async def lifespan(app: FastAPI):
            # Startup
            self.plugin_manager = PluginManager()
            await self.plugin_manager.load_all()
            logger.info(f"Loaded {len(self.plugin_manager.list_plugins())} plugins")
            yield
            # Shutdown
            if self.plugin_manager:
                await self.plugin_manager.shutdown_all()
        
        app = FastAPI(
            title="LinguClaw Web UI",
            description="Codebase-Aware Multi-Agent System",
            version="0.3.0",
            lifespan=lifespan
        )
        
        # Static files
        static_dir = Path(__file__).parent / "static"
        if static_dir.exists():
            app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
        
        # Routes
        @app.get("/", response_class=HTMLResponse)
        async def root():
            return self._get_html()
        
        @app.get("/api/status")
        async def status():
            return {
                "version": "0.3.0",
                "status": "running" if self._running else "idle",
                "plugins": len(self.plugin_manager.list_plugins()) if self.plugin_manager else 0,
                "docker_available": self._check_docker(),
                "memory_available": self._check_memory()
            }
        
        @app.post("/api/task", response_model=TaskResponse)
        async def create_task(request: TaskRequest):
            task_id = self._generate_task_id()
            asyncio.create_task(self._run_task(task_id, request))
            return TaskResponse(
                task_id=task_id,
                status="started",
                message=f"Task '{request.task[:50]}...' started"
            )
        
        @app.get("/api/plugins")
        async def list_plugins():
            if not self.plugin_manager:
                return []
            return [asdict(p.info) for p in self.plugin_manager.list_plugins()]
        
        @app.get("/api/workflow/status")
        async def workflow_status():
            """Get Prism workflow status and branch information."""
            return {
                "use_prism": hasattr(self.orchestrator, 'use_alphabeta'),
                "branches": [],
                "active_branch": None,
                "reflections": []
            }
        
        @app.websocket("/ws")
        async def websocket_endpoint(websocket: WebSocket):
            await websocket.accept()
            self.active_connections.append(websocket)
            try:
                while True:
                    data = await websocket.receive_text()
                    try:
                        msg = json.loads(data)
                        if msg.get("type") == "ping":
                            await websocket.send_json({"type": "pong"})
                    except json.JSONDecodeError:
                        pass
            except WebSocketDisconnect:
                self.active_connections.remove(websocket)
        
        return app
    
    def _get_html(self) -> str:
        """Return the main HTML page."""
        return """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LinguClaw — Codebase-Aware Agent</title>
    <link rel="stylesheet" href="/static/style.css">
    <link rel="stylesheet" href="/static/prism.css">
</head>
<body>
    <div class="app">
        <header class="header">
            <div class="logo">
                <span class="logo-icon">🦀</span>
                <span class="logo-text">LinguClaw</span>
            </div>
            <nav class="nav">
                <button class="nav-btn active" data-tab="dashboard">Dashboard</button>
                <button class="nav-btn" data-tab="workflow">🔮 Prism</button>
                <button class="nav-btn" data-tab="plugins">Plugins</button>
                <button class="nav-btn" data-tab="settings">Settings</button>
            </nav>
            <div class="status">
                <span id="connection-status" class="badge">● Connected</span>
            </div>
        </header>
        
        <main class="main">
            <!-- Dashboard Tab -->
            <div id="dashboard" class="tab active">
                <div class="layout">
                    <aside class="sidebar">
                        <div class="panel">
                            <h3>📁 Project</h3>
                            <div id="file-tree" class="file-tree">
                                <div class="loading">Loading...</div>
                            </div>
                        </div>
                        <div class="panel">
                            <h3>🔌 Plugins</h3>
                            <div id="plugin-list" class="plugin-list">
                                <div class="loading">Loading...</div>
                            </div>
                        </div>
                    </aside>
                    
                    <div class="content">
                        <div class="task-input">
                            <textarea id="task-prompt" placeholder="Enter your task... (e.g., 'Refactor authentication module')"></textarea>
                            <div class="task-actions">
                                <button id="btn-run" class="btn btn-primary">▶ Run Task</button>
                                <button id="btn-stop" class="btn btn-danger" disabled>⏹ Stop</button>
                            </div>
                        </div>
                        
                        <div class="panels">
                            <div class="panel thoughts-panel">
                                <h3>💭 Agent Thoughts</h3>
                                <div id="thoughts" class="scrollable">
                                    <div class="empty">Waiting for task...</div>
                                </div>
                            </div>
                            
                            <div class="panel plan-panel">
                                <h3>📋 Plan</h3>
                                <div id="plan" class="scrollable">
                                    <div class="empty">No active plan</div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="panel logs-panel">
                            <h3>📜 Execution Log</h3>
                            <div id="logs" class="scrollable logs"></div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Plugins Tab -->
            <div id="plugins" class="tab">
                <div class="plugins-grid" id="plugins-grid">
                    <div class="loading">Loading plugins...</div>
                </div>
            </div>
            
            <!-- Prism Workflow Tab -->
            <div id="workflow" class="tab">
                <div class="layout">
                    <aside class="sidebar">
                        <div class="panel">
                            <h3>🔮 Prism Architecture</h3>
                            <div class="prism-info">
                                <p class="info-text">Multi-faceted agent system with reflection</p>
                                <div class="facet-list">
                                    <div class="facet-item safety">🛡️ Safety</div>
                                    <div class="facet-item planning">📋 Planning</div>
                                    <div class="facet-item memory">🧠 Memory</div>
                                    <div class="facet-item execution">⚡ Execution</div>
                                    <div class="facet-item validation">✓ Validation</div>
                                </div>
                            </div>
                        </div>
                        <div class="panel">
                            <h3>🌿 AlphaBeta Branches</h3>
                            <div id="branch-tree" class="branch-tree">
                                <div class="branch-item alpha">
                                    <span class="branch-name">Alpha (Conservative)</span>
                                    <span class="branch-status">Pending</span>
                                </div>
                                <div class="branch-item beta">
                                    <span class="branch-name">Beta (Experimental)</span>
                                    <span class="branch-status">Pending</span>
                                </div>
                            </div>
                        </div>
                    </aside>
                    
                    <div class="content">
                        <div class="panel workflow-viz">
                            <h3>📊 Workflow Visualization</h3>
                            <div id="workflow-graph" class="workflow-graph">
                                <div class="empty">Start a task to see workflow visualization</div>
                            </div>
                        </div>
                        
                        <div class="panels">
                            <div class="panel reflections-panel">
                                <h3>💭 Reflections</h3>
                                <div id="reflections" class="scrollable">
                                    <div class="empty">Facet reflections will appear here...</div>
                                </div>
                            </div>
                            
                            <div class="panel metrics-panel">
                                <h3>📈 Branch Metrics</h3>
                                <div id="branch-metrics" class="scrollable">
                                    <div class="metrics-grid">
                                        <div class="metric">
                                            <span class="metric-label">Fitness</span>
                                            <span class="metric-value" id="metric-fitness">-</span>
                                        </div>
                                        <div class="metric">
                                            <span class="metric-label">Risk</span>
                                            <span class="metric-value" id="metric-risk">-</span>
                                        </div>
                                        <div class="metric">
                                            <span class="metric-label">Validation</span>
                                            <span class="metric-value" id="metric-validation">-</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Settings Tab -->
            <div id="settings" class="tab">
                <div class="settings-form">
                    <h2>Configuration</h2>
                    <div class="form-group">
                        <label>Model</label>
                        <select id="setting-model">
                            <option>anthropic/claude-3.5-sonnet</option>
                            <option>anthropic/claude-3-opus</option>
                            <option>openai/gpt-4</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Max Steps</label>
                        <input type="number" id="setting-steps" value="15" min="1" max="100">
                    </div>
                    <div class="form-group">
                        <label>Docker Sandbox</label>
                        <label class="toggle">
                            <input type="checkbox" id="setting-docker" checked>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
            </div>
        </main>
        
        <footer class="footer">
            <div class="stats">
                <span id="stat-tokens">Tokens: 0</span>
                <span id="stat-risk">Risk: Low</span>
                <span id="stat-sandbox">Sandbox: Docker</span>
            </div>
            <div class="version">v0.3.0</div>
        </footer>
    </div>
    
    <script src="/static/app.js"></script>
    <script src="/static/prism.js"></script>
</body>
</html>"""
    
    def _check_docker(self) -> bool:
        """Check if Docker is available."""
        try:
            import docker
            client = docker.from_env()
            client.ping()
            return True
        except Exception:
            return False
    
    def _check_memory(self) -> bool:
        """Check if RAG memory is available."""
        try:
            memory = RAGMemory(self.project_root)
            return memory.available
        except Exception:
            return False
    
    def _generate_task_id(self) -> str:
        """Generate unique task ID."""
        import uuid
        return str(uuid.uuid4())[:8]
    
    async def _run_task(self, task_id: str, request: TaskRequest):
        """Run a task and broadcast updates."""
        # Initialize components
        from .provider import OpenRouterProvider, TokenBudget
        from .tools import ShellTool, FileSystemTool
        from .safety import SafetyMiddleware
        import os
        
        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            await self._broadcast({"type": "error", "message": "OPENROUTER_API_KEY not set"})
            return
        
        self._running = True
        
        try:
            provider = OpenRouterProvider(
                api_key=api_key,
                model=request.model,
                budget=TokenBudget(max_total=128000)
            )
            
            shell = ShellTool(
                project_root=self.project_root,
                use_docker=True,
                safety=SafetyMiddleware()
            )
            
            fs = FileSystemTool(self.project_root)
            memory = RAGMemory(self.project_root)
            
            self.orchestrator = Orchestrator(
                provider=provider,
                shell=shell,
                fs=fs,
                memory=memory,
                max_iterations=request.max_steps
            )
            
            # Subscribe to state changes
            def state_callback(state: SharedState):
                asyncio.create_task(self._broadcast_state(state))
            
            self.orchestrator.subscribe(state_callback)
            
            await self._broadcast({"type": "started", "task_id": task_id})
            result = await self.orchestrator.run(request.task)
            await self._broadcast({"type": "completed", "result": result})
            
        except Exception as e:
            logger.error(f"Task error: {e}")
            await self._broadcast({"type": "error", "message": str(e)})
        finally:
            self._running = False
            if self.orchestrator:
                self.orchestrator.stop()
    
    async def _broadcast_state(self, state: SharedState):
        """Broadcast state update to all connected clients."""
        data = {
            "type": "state",
            "current_step": state.current_step_idx,
            "completed": len(state.completed_steps),
            "failed": len(state.failed_steps),
            "token_usage": state.token_usage,
            "risk_score": state.risk_score
        }
        await self._broadcast(data)
    
    async def _broadcast(self, data: dict):
        """Send message to all connected WebSocket clients."""
        disconnected = []
        for ws in self.active_connections:
            try:
                await ws.send_json(data)
            except Exception:
                disconnected.append(ws)
        
        for ws in disconnected:
            if ws in self.active_connections:
                self.active_connections.remove(ws)
    
    async def start(self):
        """Start the web server."""
        if not _FASTAPI_AVAILABLE:
            logger.error("FastAPI not available. Install with: pip install fastapi uvicorn")
            return
        
        self.app = self._create_app()
        
        import uvicorn
        config = uvicorn.Config(self.app, host=self.host, port=self.port, log_level="info")
        server = uvicorn.Server(config)
        
        logger.info(f"Starting LinguClaw Web UI on http://{self.host}:{self.port}")
        await server.serve()
    
    def stop(self):
        """Stop the web server."""
        self._running = False


# Convenience function to run web UI
def run_web_ui(project_root: str = ".", host: str = "0.0.0.0", port: int = 8080):
    """Run the LinguClaw web UI."""
    import asyncio
    manager = WebUIManager(project_root, host, port)
    asyncio.run(manager.start())
