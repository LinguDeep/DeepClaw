"""PrismOrchestrator - Integrates Prism+AlphaBeta with existing orchestrator."""
import asyncio
import logging
from typing import Any, Callable, Dict, List, Optional

from .orchestrator import Orchestrator, SharedState, PlannerAgent, ExecutorAgent, ReviewerAgent, AgentRole
from .prism import Prism, create_default_prism, FacetType, PrismState
from .alphabeta import AlphaBetaEngine, WorkflowBranch, BranchType, run_alphabeta_workflow
from .memory import RAGMemory
from .provider import OpenRouterProvider
from .tools import ShellTool, FileSystemTool
from .safety import SafetyMiddleware

logger = logging.getLogger("linguclaw.prism_orchestrator")


class PrismOrchestrator(Orchestrator):
    """Enhanced orchestrator using Prism architecture with AlphaBeta workflow."""
    
    def __init__(self, 
                 provider: OpenRouterProvider,
                 shell: ShellTool,
                 fs: FileSystemTool,
                 memory: Optional[RAGMemory] = None,
                 max_iterations: int = 50,
                 use_alphabeta: bool = True,
                 max_branches: int = 2):
        
        # Initialize base orchestrator
        super().__init__(provider, shell, fs, memory, max_iterations)
        
        self.use_alphabeta = use_alphabeta
        self.max_branches = max_branches
        self._prism_factory: Optional[Callable[[str], Prism]] = None
        self._alphabeta_engine: Optional[AlphaBetaEngine] = None
        
        # Create prism factory
        self._setup_prism_factory()
    
    def _setup_prism_factory(self):
        """Setup factory for creating prisms per branch."""
        def factory(task_id: str) -> Prism:
            prism = create_default_prism(
                task_id=task_id,
                memory=self.memory,
                safety=self.shell.safety if hasattr(self.shell, 'safety') else SafetyMiddleware(),
                tools={}  # Would add actual tools here
            )
            return prism
        
        self._prism_factory = factory
    
    async def run(self, task: str) -> str:
        """Execute task with Prism+AlphaBeta architecture."""
        if not self.use_alphabeta:
            # Fall back to standard orchestrator
            return await super().run(task)
        
        self.state.update(task=task)
        logger.info(f"Starting Prism+AlphaBeta workflow: {task[:50]}...")
        
        try:
            # Run AlphaBeta workflow
            result = await run_alphabeta_workflow(
                task,
                self._prism_factory,
                max_branches=self.max_branches
            )
            
            # Process result
            if result.status.name == "SUCCEEDED":
                # Update state with branch info
                self.state.update(
                    completed_steps=[result.branch_id],
                    thoughts=[{
                        "agent": "prism",
                        "content": f"AlphaBeta workflow completed via {result.branch_type.value} branch"
                    }]
                )
                
                # Extract actual result data
                result_data = result.result
                if isinstance(result_data, dict):
                    return f"Task complete. Result: {result_data.get('data', result_data)}"
                return f"Task complete. Result: {result_data}"
            
            elif result.status.name == "MERGED":
                self.state.update(
                    completed_steps=result.merged_from,
                    thoughts=[{
                        "agent": "prism",
                        "content": f"Merged from branches: {result.merged_from}"
                    }]
                )
                return f"Task complete (merged). Result: {result.result}"
            
            else:
                # Failed
                error = result.error or "Unknown error"
                self.state.update(
                    failed_steps=[result.branch_id],
                    thoughts=[{
                        "agent": "prism",
                        "content": f"Workflow failed: {error}"
                    }]
                )
                return f"Task failed: {error}"
                
        except Exception as e:
            logger.error(f"PrismOrchestrator error: {e}")
            # Fallback to standard orchestrator
            logger.info("Falling back to standard orchestrator")
            return await super().run(task)
    
    def get_prism_state(self) -> Optional[PrismState]:
        """Get the last prism state if available."""
        # This would be populated from the AlphaBeta engine
        return None
    
    def get_branch_tree(self) -> Optional[Dict]:
        """Get branch tree visualization data."""
        # Would return tree from AlphaBetaEngine
        return None


# Prism-aware agents that integrate with facets
class PrismPlannerAgent(PlannerAgent):
    """Planner agent that works with Prism planning facet."""
    
    async def create_plan(self, task: str) -> List:
        """Create plan using Prism if available."""
        # Check if we have a prism state with planning results
        if hasattr(self.state, 'context') and 'prism_plan' in self.state.context:
            plan_data = self.state.context['prism_plan']
            # Convert to PlanStep objects
            return self._convert_plan_data(plan_data)
        
        # Fall back to standard planning
        return await super().create_plan(task)
    
    def _convert_plan_data(self, plan_data: Dict) -> List:
        """Convert prism plan data to PlanStep objects."""
        from .orchestrator import PlanStep, StepStatus
        
        steps = []
        for i, step_data in enumerate(plan_data.get('steps', [])):
            step = PlanStep(
                id=step_data.get('id', f'step_{i}'),
                description=step_data.get('description', 'Unknown step'),
                agent=AgentRole.EXECUTOR,
                status=StepStatus.PENDING
            )
            steps.append(step)
        return steps


class PrismExecutorAgent(ExecutorAgent):
    """Executor that respects Prism safety and execution facets."""
    
    async def execute_step(self, step) -> Dict[str, Any]:
        """Execute with Prism context."""
        # Check if step should be blocked by safety
        if hasattr(self.state, 'context') and 'prism_safety' in self.state.context:
            safety_data = self.state.context['prism_safety']
            if safety_data.get('risk_score', 0) > 80:
                return {
                    "success": False,
                    "error": f"Blocked by safety: {safety_data.get('risk_level', 'unknown')}"
                }
        
        # Execute normally
        return await super().execute_step(step)


# Workflow visualization data generator
class PrismWorkflowVisualizer:
    """Generate visualization data for Prism+AlphaBeta workflows."""
    
    @staticmethod
    def create_sankey_data(branches: List[WorkflowBranch]) -> Dict:
        """Create Sankey diagram data for branch flow."""
        nodes = []
        links = []
        
        node_map = {}
        
        # Create nodes
        for branch in branches:
            node_id = len(nodes)
            node_map[branch.branch_id] = node_id
            nodes.append({
                "id": node_id,
                "name": f"{branch.branch_type.value}: {branch.branch_id}",
                "status": branch.status.name,
                "fitness": branch.metrics.fitness
            })
        
        # Create links (parent -> child)
        for branch in branches:
            if branch.parent_id and branch.parent_id in node_map:
                links.append({
                    "source": node_map[branch.parent_id],
                    "target": node_map[branch.branch_id],
                    "value": branch.metrics.fitness * 100
                })
        
        return {"nodes": nodes, "links": links}
    
    @staticmethod
    def create_timeline_data(branches: List[WorkflowBranch]) -> List[Dict]:
        """Create timeline visualization data."""
        events = []
        
        for branch in branches:
            events.append({
                "branch": branch.branch_id,
                "type": branch.branch_type.value,
                "start": branch.started_at.isoformat() if branch.started_at else None,
                "end": branch.completed_at.isoformat() if branch.completed_at else None,
                "status": branch.status.name,
                "fitness": branch.metrics.fitness
            })
        
        return sorted(events, key=lambda x: x["start"] or "")
    
    @staticmethod
    def create_facet_breakdown(prism_state: PrismState) -> Dict:
        """Create breakdown of facet results."""
        breakdown = {}
        
        for facet_type, results in prism_state.facet_results.items():
            breakdown[facet_type.name] = {
                "count": len(results),
                "successes": sum(1 for r in results if r.success),
                "failures": sum(1 for r in results if not r.success),
                "reflections": sum(len(r.reflections) for r in results)
            }
        
        return breakdown


# Integration helper for CLI
class PrismCLIHelper:
    """Helper for CLI integration of Prism features."""
    
    @staticmethod
    def add_prism_options(parser):
        """Add Prism-related CLI options."""
        parser.add_argument(
            "--prism",
            action="store_true",
            help="Enable Prism architecture"
        )
        parser.add_argument(
            "--alphabeta",
            action="store_true",
            help="Enable AlphaBeta branching workflow"
        )
        parser.add_argument(
            "--branches",
            type=int,
            default=2,
            help="Maximum number of branches (default: 2)"
        )
        parser.add_argument(
            "--strategy",
            choices=["best", "consensus"],
            default="best",
            help="Branch merge strategy"
        )
    
    @staticmethod
    def create_orchestrator(args, provider, shell, fs, memory):
        """Create appropriate orchestrator based on args."""
        use_prism = getattr(args, 'prism', False) or getattr(args, 'alphabeta', False)
        
        if use_prism:
            from .alphabeta import BestBranchStrategy, ConsensusMergeStrategy
            
            strategy_name = getattr(args, 'strategy', 'best')
            strategy = BestBranchStrategy() if strategy_name == 'best' else ConsensusMergeStrategy()
            
            return PrismOrchestrator(
                provider=provider,
                shell=shell,
                fs=fs,
                memory=memory,
                use_alphabeta=getattr(args, 'alphabeta', True),
                max_branches=getattr(args, 'branches', 2)
            )
        
        # Standard orchestrator
        return Orchestrator(provider, shell, fs, memory)
