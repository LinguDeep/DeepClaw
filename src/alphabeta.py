"""AlphaBeta Workflow - Branching execution with speculative exploration.

The AlphaBeta pattern implements:
- Alpha branch: Conservative, safe execution path
- Beta branch: Experimental, exploratory path
- Pruning: Eliminate branches based on validation scores
- Merging: Combine successful branches into final result
"""
import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Union
from datetime import datetime
from copy import deepcopy

from .prism import Prism, PrismState, FacetResult, FacetType

logger = logging.getLogger("linguclaw.alphabeta")


class BranchType(Enum):
    """Types of workflow branches."""
    ALPHA = "alpha"      # Conservative, safe
    BETA = "beta"        # Experimental, aggressive
    GAMMA = "gamma"      # Alternative approach
    MERGED = "merged"    # Combined result


class BranchStatus(Enum):
    """Status of a branch."""
    PENDING = auto()
    RUNNING = auto()
    SUCCEEDED = auto()
    FAILED = auto()
    PRUNED = auto()
    MERGED = auto()


@dataclass
class BranchMetrics:
    """Metrics for evaluating branch quality."""
    success_rate: float = 0.0
    execution_time_ms: int = 0
    resource_usage: float = 0.0
    validation_score: float = 0.0
    risk_score: float = 0.0
    confidence: float = 0.0
    
    @property
    def fitness(self) -> float:
        """Calculate overall fitness score (0-1)."""
        if self.risk_score > 80:
            return 0.0  # Too risky
        
        weights = {
            "validation": 0.35,
            "success": 0.25,
            "confidence": 0.20,
            "efficiency": 0.15,
            "safety": 0.05
        }
        
        efficiency = max(0, 1 - (self.resource_usage / 100))
        safety = max(0, 1 - (self.risk_score / 100))
        
        return (
            weights["validation"] * (self.validation_score / 100) +
            weights["success"] * self.success_rate +
            weights["confidence"] * self.confidence +
            weights["efficiency"] * efficiency +
            weights["safety"] * safety
        )


@dataclass
class WorkflowBranch:
    """Represents a single execution branch."""
    branch_id: str
    branch_type: BranchType
    parent_id: Optional[str] = None
    
    # Execution
    prism_state: Optional[PrismState] = None
    strategy: Dict[str, Any] = field(default_factory=dict)
    
    # Status
    status: BranchStatus = BranchStatus.PENDING
    metrics: BranchMetrics = field(default_factory=BranchMetrics)
    
    # Timeline
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    
    # Results
    result: Any = None
    error: Optional[str] = None
    artifacts: List[str] = field(default_factory=list)
    
    # Relations
    children: List[str] = field(default_factory=list)
    merged_from: List[str] = field(default_factory=list)
    
    def start(self):
        """Mark branch as running."""
        self.status = BranchStatus.RUNNING
        self.started_at = datetime.now()
        logger.info(f"Branch {self.branch_id} ({self.branch_type.value}) started")
    
    def complete(self, success: bool, result: Any = None, error: str = None):
        """Mark branch as completed."""
        self.status = BranchStatus.SUCCEEDED if success else BranchStatus.FAILED
        self.completed_at = datetime.now()
        self.result = result
        self.error = error
        
        if self.started_at:
            duration = (self.completed_at - self.started_at).total_seconds() * 1000
            self.metrics.execution_time_ms = int(duration)
        
        logger.info(f"Branch {self.branch_id} completed: {self.status.name}")
    
    def prune(self, reason: str):
        """Prune this branch."""
        self.status = BranchStatus.PRUNED
        self.error = reason
        logger.info(f"Branch {self.branch_id} pruned: {reason}")


class MergeStrategy(ABC):
    """Abstract base for branch merging strategies."""
    
    @abstractmethod
    def merge(self, branches: List[WorkflowBranch]) -> WorkflowBranch:
        """Merge multiple branches into one result."""
        pass


class BestBranchStrategy(MergeStrategy):
    """Select the single best branch based on fitness."""
    
    def merge(self, branches: List[WorkflowBranch]) -> WorkflowBranch:
        """Select highest fitness branch."""
        if not branches:
            raise ValueError("No branches to merge")
        
        best = max(branches, key=lambda b: b.metrics.fitness)
        
        merged = WorkflowBranch(
            branch_id=f"merged_best_{best.branch_id}",
            branch_type=BranchType.MERGED,
            merged_from=[b.branch_id for b in branches],
            status=BranchStatus.MERGED,
            result=best.result,
            metrics=BranchMetrics(
                validation_score=best.metrics.validation_score,
                confidence=best.metrics.confidence,
                risk_score=best.metrics.risk_score
            )
        )
        
        logger.info(f"Merged {len(branches)} branches, selected best: {best.branch_id}")
        return merged


class ConsensusMergeStrategy(MergeStrategy):
    """Merge by finding consensus across branches."""
    
    def merge(self, branches: List[WorkflowBranch]) -> WorkflowBranch:
        """Combine results where all branches agree."""
        if not branches:
            raise ValueError("No branches to merge")
        
        # Find common successful results
        successful = [b for b in branches if b.status == BranchStatus.SUCCEEDED]
        
        if not successful:
            # All failed, return error
            return WorkflowBranch(
                branch_id="merged_fail",
                branch_type=BranchType.MERGED,
                status=BranchStatus.FAILED,
                error="All branches failed"
            )
        
        # Calculate weighted average of metrics
        avg_validation = sum(b.metrics.validation_score for b in successful) / len(successful)
        avg_confidence = sum(b.metrics.confidence for b in successful) / len(successful)
        
        # For simplicity, use result from highest confidence branch
        most_confident = max(successful, key=lambda b: b.metrics.confidence)
        
        merged = WorkflowBranch(
            branch_id="merged_consensus",
            branch_type=BranchType.MERGED,
            merged_from=[b.branch_id for b in branches],
            status=BranchStatus.MERGED,
            result={
                "consensus_from": len(successful),
                "selected_from": most_confident.branch_id,
                "data": most_confident.result
            },
            metrics=BranchMetrics(
                validation_score=avg_validation,
                confidence=avg_confidence,
                risk_score=min(b.metrics.risk_score for b in successful)
            )
        )
        
        logger.info(f"Consensus merge from {len(successful)} successful branches")
        return merged


class AlphaBetaEngine:
    """Core AlphaBeta workflow engine."""
    
    def __init__(self, 
                 max_branches: int = 4,
                 prune_threshold: float = 0.3,
                 merge_strategy: Optional[MergeStrategy] = None):
        self.max_branches = max_branches
        self.prune_threshold = prune_threshold
        self.merge_strategy = merge_strategy or BestBranchStrategy()
        
        self.branches: Dict[str, WorkflowBranch] = {}
        self.active_branches: Set[str] = set()
        self.pruned_branches: Set[str] = set()
        
        self.logger = logging.getLogger("linguclaw.alphabeta.engine")
        self._branch_counter = 0
    
    def _generate_branch_id(self, branch_type: BranchType) -> str:
        """Generate unique branch ID."""
        self._branch_counter += 1
        return f"{branch_type.value}_{self._branch_counter:03d}"
    
    def create_branch(self, 
                     branch_type: BranchType,
                     parent_id: Optional[str] = None,
                     strategy: Optional[Dict] = None) -> WorkflowBranch:
        """Create a new workflow branch."""
        if len(self.active_branches) >= self.max_branches:
            # Prune worst performing branch first
            self._prune_worst_branch()
        
        branch_id = self._generate_branch_id(branch_type)
        
        branch = WorkflowBranch(
            branch_id=branch_id,
            branch_type=branch_type,
            parent_id=parent_id,
            strategy=strategy or self._default_strategy(branch_type)
        )
        
        self.branches[branch_id] = branch
        self.active_branches.add(branch_id)
        
        if parent_id and parent_id in self.branches:
            self.branches[parent_id].children.append(branch_id)
        
        self.logger.info(f"Created branch {branch_id} ({branch_type.value})")
        return branch
    
    def _default_strategy(self, branch_type: BranchType) -> Dict[str, Any]:
        """Get default strategy for branch type."""
        strategies = {
            BranchType.ALPHA: {
                "conservative": True,
                "validate_each_step": True,
                "max_risk": 30,
                "approach": "safe"
            },
            BranchType.BETA: {
                "conservative": False,
                "validate_each_step": False,
                "max_risk": 70,
                "approach": "exploratory",
                "speculative": True
            },
            BranchType.GAMMA: {
                "conservative": False,
                "validate_each_step": True,
                "max_risk": 50,
                "approach": "alternative"
            }
        }
        return strategies.get(branch_type, {})
    
    async def execute_branch(self, 
                           branch: WorkflowBranch,
                           prism: Prism,
                           task: str) -> WorkflowBranch:
        """Execute a single branch through the prism."""
        branch.start()
        
        try:
            # Run through prism
            state = await prism.disperse(task, context={
                "branch_id": branch.branch_id,
                "branch_type": branch.branch_type.value,
                "strategy": branch.strategy
            })
            
            branch.prism_state = state
            
            # Calculate metrics from prism results
            self._calculate_metrics(branch, state)
            
            # Check if we should prune
            if self._should_prune(branch):
                branch.prune(f"Fitness {branch.metrics.fitness:.2f} below threshold")
                return branch
            
            # Get final result
            result = prism.get_final_result()
            success = any(
                r.success for r in state.facet_results.get(FacetType.VALIDATION, [])
            ) or not state.errors
            
            branch.complete(success=success, result=result)
            
        except Exception as e:
            self.logger.error(f"Branch {branch.branch_id} failed: {e}")
            branch.complete(success=False, error=str(e))
        
        self.active_branches.discard(branch.branch_id)
        return branch
    
    def _calculate_metrics(self, branch: WorkflowBranch, state: PrismState):
        """Calculate metrics from prism state."""
        metrics = BranchMetrics()
        
        # Validation score from validation facet
        validations = state.facet_results.get(FacetType.VALIDATION, [])
        if validations:
            successful = sum(1 for v in validations if v.success)
            metrics.validation_score = (successful / len(validations)) * 100
        
        # Risk from safety facet
        safety_results = state.facet_results.get(FacetType.SAFETY, [])
        if safety_results and safety_results[0].data:
            metrics.risk_score = safety_results[0].data.get("risk_score", 50)
        
        # Confidence based on facet success
        total_facets = len(state.completed_facets)
        all_facets = len(state.facet_results)
        if all_facets > 0:
            metrics.success_rate = total_facets / all_facets
            metrics.confidence = metrics.success_rate * (metrics.validation_score / 100)
        
        # Resource usage estimate
        metrics.resource_usage = len(str(state.context)) / 1000  # Rough estimate
        
        branch.metrics = metrics
        self.logger.debug(f"Branch {branch.branch_id} metrics: fitness={metrics.fitness:.2f}")
    
    def _should_prune(self, branch: WorkflowBranch) -> bool:
        """Determine if branch should be pruned."""
        if branch.metrics.fitness < self.prune_threshold:
            return True
        if branch.metrics.risk_score > 90:
            return True
        return False
    
    def _prune_worst_branch(self):
        """Prune the worst performing active branch."""
        if not self.active_branches:
            return
        
        candidates = [self.branches[bid] for bid in self.active_branches]
        worst = min(candidates, key=lambda b: b.metrics.fitness if b.status != BranchStatus.PRUNED else 1.0)
        
        worst.prune("Resource limit - lowest fitness")
        self.active_branches.discard(worst.branch_id)
        self.pruned_branches.add(worst.branch_id)
    
    async def execute_workflow(self,
                             task: str,
                             prism_factory: Callable[[str], Prism],
                             branch_types: Optional[List[BranchType]] = None) -> WorkflowBranch:
        """Execute full AlphaBeta workflow with multiple branches."""
        branch_types = branch_types or [BranchType.ALPHA, BranchType.BETA]
        
        self.logger.info(f"Starting AlphaBeta workflow: {task[:50]}...")
        self.logger.info(f"Creating {len(branch_types)} branches")
        
        # Create branches
        branches = []
        for btype in branch_types:
            branch = self.create_branch(btype)
            branches.append(branch)
        
        # Execute branches concurrently
        tasks = []
        for branch in branches:
            prism = prism_factory(branch.branch_id)
            t = asyncio.create_task(
                self.execute_branch(branch, prism, task)
            )
            tasks.append(t)
        
        completed_branches = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Filter out exceptions
        successful = []
        for result in completed_branches:
            if isinstance(result, Exception):
                self.logger.error(f"Branch execution failed: {result}")
            elif result.status == BranchStatus.SUCCEEDED:
                successful.append(result)
        
        # Merge results
        if successful:
            merged = self.merge_strategy.merge(successful)
            self.logger.info(f"Workflow complete: merged from {len(successful)} branches")
            return merged
        else:
            # Return best failed branch
            best_failed = max(
                [b for b in branches if b.status == BranchStatus.FAILED],
                key=lambda b: b.metrics.fitness,
                default=None
            )
            if best_failed:
                return best_failed
            
            # All pruned
            return WorkflowBranch(
                branch_id="all_pruned",
                branch_type=BranchType.MERGED,
                status=BranchStatus.FAILED,
                error="All branches pruned or failed"
            )
    
    def get_branch_tree(self) -> Dict[str, Any]:
        """Get hierarchical view of branches."""
        # Find root branches (no parent)
        roots = [b for b in self.branches.values() if b.parent_id is None]
        
        def build_tree(branch: WorkflowBranch) -> Dict:
            return {
                "id": branch.branch_id,
                "type": branch.branch_type.value,
                "status": branch.status.name,
                "fitness": branch.metrics.fitness,
                "children": [build_tree(self.branches[cid]) for cid in branch.children if cid in self.branches]
            }
        
        return {
            "roots": [build_tree(r) for r in roots],
            "total_branches": len(self.branches),
            "active": len(self.active_branches),
            "pruned": len(self.pruned_branches)
        }


# Convenience function for simple AlphaBeta execution
async def run_alphabeta_workflow(task: str,
                                 prism_factory: Callable[[str], Prism],
                                 max_branches: int = 2) -> WorkflowBranch:
    """Simple interface to run AlphaBeta workflow."""
    engine = AlphaBetaEngine(max_branches=max_branches)
    return await engine.execute_workflow(
        task,
        prism_factory,
        branch_types=[BranchType.ALPHA, BranchType.BETA]
    )
