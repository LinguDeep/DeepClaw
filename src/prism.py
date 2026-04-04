"""Prism Architecture - Multi-faceted agent system with reflection and dispatch.

The Prism pattern decomposes agent capabilities into discrete facets,
each handling a specific concern (planning, execution, validation).
Light enters the prism (user task) and disperses into specialized wavelengths (facets).
"""
import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any, Callable, Dict, List, Optional, Set, Type, TypeVar, Generic
from datetime import datetime

logger = logging.getLogger("linguclaw.prism")

T = TypeVar('T')


class FacetType(Enum):
    """Types of prism facets."""
    PLANNING = auto()
    EXECUTION = auto()
    VALIDATION = auto()
    MEMORY = auto()
    SAFETY = auto()
    COMMUNICATION = auto()


@dataclass
class FacetResult:
    """Result from a facet processing."""
    facet_type: FacetType
    success: bool
    data: Any = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    reflections: List[str] = field(default_factory=list)  # Self-reflections
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class PrismState:
    """Shared state across all facets."""
    task_id: str
    original_task: str
    context: Dict[str, Any] = field(default_factory=dict)
    facet_results: Dict[FacetType, List[FacetResult]] = field(default_factory=dict)
    reflections: List[str] = field(default_factory=list)
    dispatch_queue: List[FacetType] = field(default_factory=list)
    completed_facets: Set[FacetType] = field(default_factory=set)
    errors: List[str] = field(default_factory=list)
    
    def record_result(self, result: FacetResult):
        """Record a facet result."""
        if result.facet_type not in self.facet_results:
            self.facet_results[result.facet_type] = []
        self.facet_results[result.facet_type].append(result)
        
        if result.success:
            self.completed_facets.add(result.facet_type)
        
        # Auto-reflect on errors
        if not result.success:
            self.reflections.append(f"{result.facet_type.name} failed: {result.data}")
    
    def get_facet_data(self, facet_type: FacetType) -> List[Any]:
        """Get all data from a specific facet type."""
        results = self.facet_results.get(facet_type, [])
        return [r.data for r in results if r.success]


class PrismFacet(ABC, Generic[T]):
    """Base class for prism facets."""
    
    facet_type: FacetType = FacetType.PLANNING
    priority: int = 50  # Lower = higher priority
    dependencies: List[FacetType] = []
    
    def __init__(self, prism_state: PrismState):
        self.state = prism_state
        self.logger = logging.getLogger(f"linguclaw.prism.{self.facet_type.name.lower()}")
        self._reflection_log: List[str] = []
    
    @abstractmethod
    async def refract(self, input_data: Any) -> FacetResult:
        """Process input through this facet (refract the light)."""
        pass
    
    def reflect(self, message: str) -> None:
        """Add a self-reflection."""
        self._reflection_log.append(message)
        self.state.reflections.append(f"[{self.facet_type.name}] {message}")
        self.logger.debug("Reflection: %s", message)
    
    def can_execute(self) -> bool:
        """Check if dependencies are satisfied."""
        return all(dep in self.state.completed_facets for dep in self.dependencies)
    
    async def execute_with_reflection(self, input_data: Any) -> FacetResult:
        """Execute with automatic reflection."""
        self.reflect(f"Starting refraction of {type(input_data).__name__}")
        
        try:
            result = await self.refract(input_data)
            if result.success:
                self.reflect(f"Refraction successful: {len(str(result.data))} chars output")
            else:
                self.reflect(f"Refraction failed: {result.data}")
            
            # Add our reflections to result
            result.reflections = self._reflection_log.copy()
            return result
            
        except Exception as e:
            self.reflect(f"Exception during refraction: {e}")
            return FacetResult(
                facet_type=self.facet_type,
                success=False,
                data=str(e),
                reflections=self._reflection_log.copy()
            )


class PlanningFacet(PrismFacet):
    """Facet for task decomposition and planning."""
    
    facet_type = FacetType.PLANNING
    priority = 10
    
    async def refract(self, input_data: Any) -> FacetResult:
        """Decompose task into plan."""
        task = str(input_data)
        
        self.reflect("Analyzing task structure")
        self.reflect("Identifying required sub-tasks")
        
        # In real implementation, this would use LLM
        plan = {
            "original_task": task,
            "steps": [
                {"id": "analyze", "description": f"Analyze: {task[:50]}...", "agent": "planner"},
                {"id": "execute", "description": "Execute plan steps", "agent": "executor"},
                {"id": "validate", "description": "Validate results", "agent": "reviewer"}
            ],
            "estimated_complexity": "medium",
            "risk_factors": []
        }
        
        self.reflect(f"Generated plan with {len(plan['steps'])} steps")
        
        return FacetResult(
            facet_type=self.facet_type,
            success=True,
            data=plan,
            metadata={"steps": len(plan["steps"]), "complexity": plan["estimated_complexity"]}
        )


class ExecutionFacet(PrismFacet):
    """Facet for tool execution and action taking."""
    
    facet_type = FacetType.EXECUTION
    priority = 20
    dependencies = [FacetType.PLANNING]
    
    def __init__(self, prism_state: PrismState, tools: Optional[Dict[str, Callable]] = None):
        super().__init__(prism_state)
        self.tools = tools or {}
    
    async def refract(self, input_data: Any) -> FacetResult:
        """Execute tools based on plan."""
        plan = input_data
        
        self.reflect("Preparing execution environment")
        self.reflect(f"Available tools: {list(self.tools.keys())}")
        
        executions = []
        for step in plan.get("steps", []):
            self.reflect(f"Executing step: {step['id']}")
            
            execution = {
                "step_id": step["id"],
                "agent": step["agent"],
                "status": "completed",
                "result": f"Executed {step['description']}",
                "timestamp": datetime.now().isoformat()
            }
            executions.append(execution)
        
        return FacetResult(
            facet_type=self.facet_type,
            success=True,
            data={"executions": executions, "completed": len(executions)},
            metadata={"tool_calls": len(executions)}
        )


class ValidationFacet(PrismFacet):
    """Facet for result validation and quality assurance."""
    
    facet_type = FacetType.VALIDATION
    priority = 30
    dependencies = [FacetType.EXECUTION]
    
    async def refract(self, input_data: Any) -> FacetResult:
        """Validate execution results."""
        executions = input_data.get("executions", [])
        
        self.reflect("Beginning validation pass")
        self.reflect(f"Validating {len(executions)} execution results")
        
        validations = []
        issues = []
        
        for exec_result in executions:
            self.reflect(f"Checking execution: {exec_result['step_id']}")
            
            # Simulate validation logic
            is_valid = True  # Real impl would check actual results
            
            validation = {
                "step_id": exec_result["step_id"],
                "valid": is_valid,
                "checks": ["syntax", "security", "completeness"],
                "issues": []
            }
            
            if not is_valid:
                issues.append(f"Step {exec_result['step_id']} failed validation")
            
            validations.append(validation)
        
        success = len(issues) == 0
        
        if success:
            self.reflect("All validations passed")
        else:
            self.reflect(f"Found {len(issues)} validation issues")
        
        return FacetResult(
            facet_type=self.facet_type,
            success=success,
            data={"validations": validations, "all_valid": success},
            metadata={"passed": len([v for v in validations if v["valid"]]), "failed": len(issues)}
        )


class MemoryFacet(PrismFacet):
    """Facet for RAG memory operations."""
    
    facet_type = FacetType.MEMORY
    priority = 15  # Run after planning but can run in parallel
    dependencies = []
    
    def __init__(self, prism_state: PrismState, memory=None):
        super().__init__(prism_state)
        self.memory = memory
    
    async def refract(self, input_data: Any) -> FacetResult:
        """Query memory for relevant context."""
        task = str(input_data)
        
        self.reflect("Querying RAG memory for context")
        
        if self.memory and self.memory.available:
            # Real implementation would query memory
            context = f"Relevant code context for: {task[:30]}..."
            self.reflect("Retrieved context from memory")
        else:
            context = "No memory available"
            self.reflect("Memory unavailable, skipping")
        
        return FacetResult(
            facet_type=self.facet_type,
            success=True,
            data={"context": context, "relevant_chunks": 0},
            metadata={"memory_active": self.memory is not None and self.memory.available}
        )


class SafetyFacet(PrismFacet):
    """Facet for safety analysis and risk scoring."""
    
    facet_type = FacetType.SAFETY
    priority = 5  # Highest priority - run first
    dependencies = []
    
    def __init__(self, prism_state: PrismState, safety_middleware=None):
        super().__init__(prism_state)
        self.safety = safety_middleware
    
    async def refract(self, input_data: Any) -> FacetResult:
        """Analyze safety of task."""
        task = str(input_data)
        
        self.reflect("Performing safety analysis")
        
        # Simulate safety check
        risk_score = 25  # Low risk
        risk_level = "low"
        
        if "rm -rf" in task or "mkfs" in task:
            risk_score = 100
            risk_level = "critical"
            self.reflect("CRITICAL: Destructive command detected")
        elif "curl" in task and "|" in task:
            risk_score = 70
            risk_level = "medium"
            self.reflect("WARNING: Download and execute pattern")
        else:
            self.reflect(f"Risk level: {risk_level} ({risk_score}/100)")
        
        return FacetResult(
            facet_type=self.facet_type,
            success=risk_score < 100,  # Critical risk fails the facet
            data={"risk_score": risk_score, "risk_level": risk_level, "task": task},
            metadata={"blocked": risk_score >= 100, "requires_confirmation": risk_score >= 70}
        )


class Prism:
    """Core Prism - coordinates multiple facets with reflection."""
    
    def __init__(self, task_id: Optional[str] = None):
        self.task_id = task_id or self._generate_id()
        self.state = PrismState(task_id=self.task_id, original_task="")
        self.facets: Dict[FacetType, PrismFacet] = {}
        self._execution_order: List[FacetType] = []
        self.logger = logging.getLogger("linguclaw.prism.core")
    
    def _generate_id(self) -> str:
        """Generate unique task ID."""
        import uuid
        return str(uuid.uuid4())[:8]
    
    def add_facet(self, facet: PrismFacet) -> "Prism":
        """Add a facet to the prism."""
        self.facets[facet.facet_type] = facet
        
        # Recalculate execution order based on priorities and dependencies
        self._calculate_execution_order()
        
        self.logger.info(f"Added facet: {facet.facet_type.name} (priority: {facet.priority})")
        return self
    
    def _calculate_execution_order(self) -> None:
        """Calculate dependency-respecting execution order."""
        # Topological sort with priority consideration
        visited: Set[FacetType] = set()
        order: List[FacetType] = []
        
        def visit(facet_type: FacetType):
            if facet_type in visited:
                return
            visited.add(facet_type)
            
            facet = self.facets.get(facet_type)
            if facet:
                # Visit dependencies first
                for dep in facet.dependencies:
                    if dep in self.facets:
                        visit(dep)
                order.append(facet_type)
        
        # Sort facets by priority first
        sorted_facets = sorted(
            self.facets.values(),
            key=lambda f: f.priority
        )
        
        for facet in sorted_facets:
            visit(facet.facet_type)
        
        self._execution_order = order
        self.logger.debug(f"Execution order: {[f.name for f in order]}")
    
    async def disperse(self, task: str, context: Optional[Dict] = None) -> PrismState:
        """Disperses task through all facets (main entry point)."""
        self.state.original_task = task
        if context:
            self.state.context.update(context)
        
        self.logger.info(f"Dispersing task through {len(self.facets)} facets")
        self.state.reflections.append(f"Task received: {task[:50]}...")
        
        # Execute facets in order
        for facet_type in self._execution_order:
            facet = self.facets[facet_type]
            
            if not facet.can_execute():
                msg = f"Skipping {facet_type.name}: dependencies not satisfied"
                self.logger.warning(msg)
                self.state.reflections.append(msg)
                continue
            
            self.logger.info(f"Executing facet: {facet_type.name}")
            
            # Prepare input data based on facet type and previous results
            input_data = self._prepare_input(facet_type, task)
            
            # Execute with reflection
            result = await facet.execute_with_reflection(input_data)
            self.state.record_result(result)
            
            if not result.success and facet_type == FacetType.SAFETY:
                # Safety failures are blocking
                self.logger.error("Safety check failed, aborting")
                break
        
        self.logger.info("Dispersion complete")
        return self.state
    
    def _prepare_input(self, facet_type: FacetType, task: str) -> Any:
        """Prepare appropriate input for a facet type."""
        if facet_type == FacetType.PLANNING:
            # Planning gets the original task + memory context
            memory_context = self.state.get_facet_data(FacetType.MEMORY)
            if memory_context:
                return {"task": task, "context": memory_context[0].get("context", "")}
            return task
        
        elif facet_type == FacetType.EXECUTION:
            # Execution gets the plan
            plans = self.state.get_facet_data(FacetType.PLANNING)
            return plans[0] if plans else {"steps": []}
        
        elif facet_type == FacetType.VALIDATION:
            # Validation gets execution results
            executions = self.state.get_facet_data(FacetType.EXECUTION)
            return executions[0] if executions else {"executions": []}
        
        elif facet_type == FacetType.SAFETY:
            # Safety gets the raw task
            return task
        
        elif facet_type == FacetType.MEMORY:
            # Memory gets the task for context search
            return task
        
        return task
    
    def get_reflection_summary(self) -> str:
        """Get a summary of all reflections."""
        return "\n".join(self.state.reflections)
    
    def get_final_result(self) -> Optional[Any]:
        """Get the final result from validation or execution."""
        validations = self.state.get_facet_data(FacetType.VALIDATION)
        if validations:
            return validations[-1]
        
        executions = self.state.get_facet_data(FacetType.EXECUTION)
        if executions:
            return executions[-1]
        
        return None


# Convenience factory function
def create_default_prism(task_id: Optional[str] = None, 
                         memory=None, 
                         safety=None,
                         tools: Optional[Dict[str, Callable]] = None) -> Prism:
    """Create a prism with default facets."""
    prism = Prism(task_id)
    
    # Add facets in priority order
    prism.add_facet(SafetyFacet(prism.state, safety))
    prism.add_facet(MemoryFacet(prism.state, memory))
    prism.add_facet(PlanningFacet(prism.state))
    prism.add_facet(ExecutionFacet(prism.state, tools))
    prism.add_facet(ValidationFacet(prism.state))
    
    return prism
