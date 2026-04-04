"""Multi-agent orchestration layer with shared state management."""
import asyncio
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Any, Optional, Callable
from datetime import datetime

from .provider import OpenRouterProvider, Message
from .tools import ShellTool, FileSystemTool, SearchMemoryTool, CommandResult
from .memory import RAGMemory
from .safety import SafetyMiddleware, SafetyResult

logger = logging.getLogger("linguclaw.orchestrator")


class AgentRole(Enum):
    PLANNER = "planner"
    EXECUTOR = "executor"
    REVIEWER = "reviewer"


class StepStatus(Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"


@dataclass
class PlanStep:
    id: str
    description: str
    agent: AgentRole
    status: StepStatus = StepStatus.PENDING
    dependencies: List[str] = field(default_factory=list)
    result: Any = None
    error: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3


@dataclass
class SharedState:
    """Shared state across all agents."""
    task: str = ""
    plan: List[PlanStep] = field(default_factory=list)
    current_step_idx: int = -1
    completed_steps: List[str] = field(default_factory=list)
    failed_steps: List[str] = field(default_factory=list)
    observations: List[Dict] = field(default_factory=list)
    thoughts: List[Dict] = field(default_factory=list)
    token_usage: int = 0
    cost_estimate: float = 0.0
    risk_score: int = 0
    sandbox_active: bool = False
    memory_stats: Dict = field(default_factory=dict)
    start_time: Optional[datetime] = None
    
    # Callbacks for UI updates
    _callbacks: List[Callable] = field(default_factory=list, repr=False)
    
    def subscribe(self, callback: Callable):
        self._callbacks.append(callback)
    
    def notify(self):
        for cb in self._callbacks:
            try:
                cb(self)
            except Exception:
                pass
    
    def update(self, **kwargs):
        for k, v in kwargs.items():
            if hasattr(self, k) and not k.startswith('_'):
                setattr(self, k, v)
        self.notify()


@dataclass
class AgentResponse:
    role: AgentRole
    content: str
    action: Optional[str] = None
    action_input: Optional[str] = None
    success: bool = True
    feedback: Optional[str] = None


class BaseAgent:
    """Base class for specialized sub-agents."""
    
    def __init__(self, role: AgentRole, provider: OpenRouterProvider, 
                 system_prompt: str, state: SharedState):
        self.role = role
        self.provider = provider
        self.system_prompt = system_prompt
        self.state = state
        self.history: List[Message] = []
    
    async def think(self, context: str, temperature: float = 0.3) -> AgentResponse:
        """Generate agent response based on context."""
        messages = [
            Message("system", self.system_prompt),
            *self.history,
            Message("user", context)
        ]
        
        resp = await self.provider.complete(messages, temperature)
        
        if resp.error:
            return AgentResponse(self.role, "", success=False, feedback=f"LLM error: {resp.error}")
        
        # Parse action from response
        action, action_input = self._parse_action(resp.content)
        
        return AgentResponse(
            role=self.role,
            content=resp.content,
            action=action,
            action_input=action_input,
            success=True
        )
    
    def _parse_action(self, content: str) -> tuple:
        """Extract action and input from agent response."""
        import re
        
        # Look for ACTION: patterns
        patterns = [
            (r'RUN:\s*(.+?)(?=\n|$)', 'run'),
            (r'WRITE:\s*(.+?)(?=\n|$)', 'write'),
            (r'READ:\s*(.+?)(?=\n|$)', 'read'),
            (r'APPROVE', 'approve'),
            (r'REJECT:\s*(.+?)(?=\n|$)', 'reject'),
            (r'FIX:\s*(.+?)(?=\n|$)', 'fix'),
        ]
        
        for pattern, action_name in patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                return action_name, match.group(1).strip() if match.groups() else ""
        
        return None, None
    
    def remember(self, message: Message):
        self.history.append(message)
        # Keep history bounded
        if len(self.history) > 20:
            self.history = self.history[-20:]


class PlannerAgent(BaseAgent):
    """Creates structured plans for task execution."""
    
    def __init__(self, provider: OpenRouterProvider, state: SharedState, memory: Optional[RAGMemory] = None):
        system_prompt = """You are the PLANNER agent for LinguClaw.
Your job is to analyze tasks and create structured execution plans.

Output format:
PLAN:
1. [Step description]
2. [Step description]
...

Use SEARCH_CODEBASE to find relevant code before planning.
Be specific about file paths and expected outcomes.
"""
        super().__init__(AgentRole.PLANNER, provider, system_prompt, state)
        self.memory = memory
    
    async def create_plan(self, task: str) -> List[PlanStep]:
        """Create a structured plan for the task."""
        # Search memory for context
        context = f"Task: {task}\n"
        if self.memory and self.memory.available:
            code_context = self.memory.auto_context(task)
            if code_context and not code_context.startswith("["):
                context += f"\nRelevant codebase context:\n{code_context}\n"
        
        context += "\nCreate a detailed plan with numbered steps. Each step should be atomic and verifiable."
        
        response = await self.think(context, temperature=0.2)
        
        if not response.success:
            logger.error(f"Planner failed: {response.feedback}")
            return []
        
        # Parse plan into steps
        steps = self._parse_plan(response.content)
        
        # Update state
        self.state.update(plan=steps, current_step_idx=0 if steps else -1)
        self.remember(Message("assistant", response.content))
        
        return steps
    
    def _parse_plan(self, content: str) -> List[PlanStep]:
        """Parse plan text into structured steps."""
        import re
        steps = []
        
        # Find numbered items
        pattern = r'^\s*(\d+)\.\s*(.+?)(?=\n\s*\d+\.|$)'
        matches = re.findall(pattern, content, re.MULTILINE | re.DOTALL)
        
        for num, desc in matches:
            step = PlanStep(
                id=f"step_{num}",
                description=desc.strip().replace('\n', ' '),
                agent=AgentRole.EXECUTOR,
                status=StepStatus.PENDING
            )
            steps.append(step)
        
        return steps


class ExecutorAgent(BaseAgent):
    """Executes planned steps using tools."""
    
    def __init__(self, provider: OpenRouterProvider, state: SharedState,
                 shell: ShellTool, fs: FileSystemTool, search: Optional[SearchMemoryTool] = None):
        system_prompt = """You are the EXECUTOR agent for LinguClaw.
Your job is to execute specific steps from a plan using available tools.

Tools: RUN, READ, WRITE, LIST, SEARCH_CODEBASE

Output format:
THOUGHT: [Brief analysis]
ACTION: [tool]: [input]

Be precise. Only execute what was planned.
"""
        super().__init__(AgentRole.EXECUTOR, provider, system_prompt, state)
        self.shell = shell
        self.fs = fs
        self.search = search
    
    async def execute_step(self, step: PlanStep) -> Dict[str, Any]:
        """Execute a single plan step."""
        step.status = StepStatus.IN_PROGRESS
        self.state.update(current_step_idx=self.state.plan.index(step))
        
        context = f"Execute this step:\n{step.description}\n\nPrevious context: {self._get_context()}"
        
        response = await self.think(context, temperature=0.1)
        
        if not response.success:
            step.status = StepStatus.FAILED
            step.error = response.feedback
            return {"success": False, "error": response.feedback}
        
        # Execute the action
        result = await self._execute_action(response.action, response.action_input)
        
        if result.get("success"):
            step.status = StepStatus.COMPLETED
            step.result = result
            self.state.completed_steps.append(step.id)
        else:
            step.status = StepStatus.FAILED
            step.error = result.get("error", "Unknown error")
            step.retry_count += 1
        
        self.state.notify()
        return result
    
    async def _execute_action(self, action: Optional[str], action_input: Optional[str]) -> Dict:
        """Execute a specific tool action."""
        if not action:
            return {"success": False, "error": "No action specified"}
        
        try:
            if action == "run" and action_input:
                result = await self.shell.run(action_input)
                return {
                    "success": result.returncode == 0,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "returncode": result.returncode,
                    "sandboxed": result.sandboxed
                }
            
            elif action == "read" and action_input:
                result = self.fs.read(action_input)
                return {"success": result.success, "content": result.content, "error": result.error}
            
            elif action == "write" and action_input:
                # Parse "path\ncontent"
                parts = action_input.split("\n", 1)
                if len(parts) == 2:
                    result = self.fs.write(parts[0].strip(), parts[1])
                    return {"success": result.success, "error": result.error}
                return {"success": False, "error": "Invalid write format"}
            
            elif action == "search_codebase" and action_input and self.search:
                result = self.search.search_codebase(action_input)
                return {"success": True, "content": result}
            
            else:
                return {"success": False, "error": f"Unknown action: {action}"}
                
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _get_context(self) -> str:
        """Get recent execution context."""
        recent = self.state.observations[-3:] if self.state.observations else []
        return str(recent)


class ReviewerAgent(BaseAgent):
    """Validates execution results and provides feedback."""
    
    def __init__(self, provider: OpenRouterProvider, state: SharedState):
        system_prompt = """You are the REVIEWER agent for LinguClaw.
Your job is to validate execution results against the planned step.

Output format:
STATUS: [APPROVED/REJECTED]
REASON: [Detailed explanation]
FEEDBACK: [Specific fix instructions if rejected]

Be strict. Code must compile, tests must pass, files must exist.
"""
        super().__init__(AgentRole.REVIEWER, provider, system_prompt, state)
    
    async def validate(self, step: PlanStep, execution_result: Dict) -> AgentResponse:
        """Validate an execution result."""
        context = f"Review this execution:\n\nPlanned step: {step.description}\n\nExecution result: {execution_result}\n\nValidate that the step was completed correctly. Check for errors, missing files, or unexpected output."
        
        response = await self.think(context, temperature=0.1)
        
        if not response.success:
            return AgentResponse(
                role=AgentRole.REVIEWER,
                content="",
                success=False,
                feedback=f"Review failed: {response.feedback}"
            )
        
        # Parse approval/rejection
        is_approved = self._is_approved(response.content)
        
        return AgentResponse(
            role=AgentRole.REVIEWER,
            content=response.content,
            action="approve" if is_approved else "reject",
            success=is_approved,
            feedback=self._extract_feedback(response.content) if not is_approved else None
        )
    
    def _is_approved(self, content: str) -> bool:
        """Check if review response indicates approval."""
        import re
        return bool(re.search(r'STATUS:\s*APPROVED', content, re.IGNORECASE))
    
    def _extract_feedback(self, content: str) -> str:
        """Extract feedback from rejection."""
        import re
        match = re.search(r'FEEDBACK:\s*(.+?)(?=\n|$)', content, re.IGNORECASE | re.DOTALL)
        return match.group(1).strip() if match else content


class Orchestrator:
    """Coordinates Planner, Executor, and Reviewer agents."""
    
    def __init__(self, provider: OpenRouterProvider, shell: ShellTool, 
                 fs: FileSystemTool, memory: Optional[RAGMemory] = None,
                 max_iterations: int = 50):
        self.provider = provider
        self.shell = shell
        self.fs = fs
        self.memory = memory
        self.max_iterations = max_iterations
        
        self.state = SharedState()
        self.state.sandbox_active = getattr(shell, 'is_sandboxed', False)
        if memory:
            self.state.memory_stats = memory.get_stats()
        
        # Initialize sub-agents
        self.planner = PlannerAgent(provider, self.state, memory)
        self.search_tool = SearchMemoryTool(memory) if memory else None
        self.executor = ExecutorAgent(provider, self.state, shell, fs, self.search_tool)
        self.reviewer = ReviewerAgent(provider, self.state)
    
    def subscribe(self, callback: Callable):
        """Subscribe to state changes for UI updates."""
        self.state.subscribe(callback)
    
    async def run(self, task: str) -> str:
        """Execute the full multi-agent workflow."""
        self.state.update(task=task, start_time=datetime.now())
        
        # Phase 1: Planning
        logger.info("Starting planning phase")
        plan = await self.planner.create_plan(task)
        
        if not plan:
            return "Failed to create plan"
        
        logger.info(f"Created plan with {len(plan)} steps")
        
        # Phase 2: Execution with review loop
        for step in plan:
            success = await self._execute_with_review(step)
            if not success and step.retry_count >= step.max_retries:
                return f"Step {step.id} failed after {step.max_retries} retries"
        
        # Generate summary
        completed = len(self.state.completed_steps)
        failed = len(self.state.failed_steps)
        
        return f"Task complete. {completed} steps succeeded, {failed} failed."
    
    async def _execute_with_review(self, step: PlanStep) -> bool:
        """Execute a step with validation and retry logic."""
        iteration = 0
        
        while iteration < step.max_retries:
            iteration += 1
            
            # Execute
            logger.info(f"Executing step {step.id} (attempt {iteration})")
            result = await self.executor.execute_step(step)
            
            # Review
            review = await self.reviewer.validate(step, result)
            
            if review.success:
                logger.info(f"Step {step.id} approved")
                return True
            
            # Retry with feedback
            logger.warning(f"Step {step.id} rejected: {review.feedback}")
            step.status = StepStatus.RETRYING
            
            # Add feedback to executor's context for retry
            self.executor.remember(Message("user", f"Previous attempt failed. Reviewer feedback: {review.feedback}"))
        
        return False
    
    def stop(self):
        """Cleanup resources."""
        if hasattr(self.shell, 'stop'):
            self.shell.stop()
