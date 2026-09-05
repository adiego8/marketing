from abc import ABC, abstractmethod
from dataclasses import dataclass, field


class RunContext(dict):
    """Accumulates output from each pipeline step.

    Step N can read output from steps 1 through N-1.
    Each step writes its output under its step key.
    """

    pass


@dataclass
class StepResult:
    """Result returned by a pipeline step."""

    output: dict = field(default_factory=dict)
    success: bool = True
    error: str | None = None


class PipelineStep(ABC):
    """Base class for all pipeline steps."""

    @abstractmethod
    async def execute(self, context: RunContext, config: dict) -> StepResult:
        """Execute this step.

        Args:
            context: Accumulated state from prior steps.
            config: Step-specific config from task_configs.pipeline.

        Returns:
            StepResult with output to merge into context.
        """
        raise NotImplementedError
