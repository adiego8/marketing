from app.services.pipeline.base import PipelineStep

_STEP_REGISTRY: dict[str, type[PipelineStep]] = {}


def register_step(key: str):
    """Decorator to register a pipeline step handler."""

    def decorator(cls: type[PipelineStep]):
        _STEP_REGISTRY[key] = cls
        return cls

    return decorator


def get_step(key: str) -> PipelineStep:
    """Get an instance of a registered pipeline step."""
    cls = _STEP_REGISTRY.get(key)
    if cls is None:
        raise ValueError(f"Unknown pipeline step: {key}")
    return cls()


def list_steps() -> list[str]:
    """List all registered step keys."""
    return list(_STEP_REGISTRY.keys())
