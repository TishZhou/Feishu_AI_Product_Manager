import json
import logging
from typing import Any

from openai import AsyncOpenAI

from devflow.config import settings

logger = logging.getLogger("devflow.provider")


class ProviderRouter:
    def __init__(self) -> None:
        self._clients: dict[str, AsyncOpenAI] = {}

    def get_client(self, provider: str) -> AsyncOpenAI:
        if provider not in self._clients:
            if provider == "openai":
                self._clients["openai"] = AsyncOpenAI(
                    api_key=settings.OPENAI_API_KEY,
                    base_url=settings.OPENAI_BASE_URL,
                )
            elif provider == "volcano":
                self._clients["volcano"] = AsyncOpenAI(
                    api_key=settings.VOLCANO_API_KEY,
                    base_url=settings.VOLCANO_BASE_URL,
                )
            else:
                raise ValueError(f"Unknown provider: {provider!r}. Supported: openai, volcano")
        return self._clients[provider]

    def resolve_model(self, provider: str, model: str | None) -> str:
        if model:
            return model
        if provider == "openai":
            return settings.OPENAI_DEFAULT_MODEL
        if provider == "volcano":
            return settings.VOLCANO_DEFAULT_MODEL
        return ""

    async def chat(
        self,
        system: str,
        user: str,
        tools: list[dict] | None = None,
        model: str | None = None,
        provider: str | None = None,
        tool_dispatcher: "ToolDispatcher | None" = None,
        json_mode: bool = False,
        max_tokens: int | None = None,
    ) -> str:
        provider = provider or settings.DEFAULT_PROVIDER
        client = self.get_client(provider)
        resolved_model = self.resolve_model(provider, model)

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

        kwargs: dict[str, Any] = {"model": resolved_model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        if json_mode and provider != "volcano":
            kwargs["response_format"] = {"type": "json_object"}
        if max_tokens:
            kwargs["max_tokens"] = max_tokens

        import time as _time
        t0 = _time.monotonic()
        logger.info("[LLM] ▶ calling %s  model=%s  tools=%s  json=%s", provider, resolved_model, bool(tools), json_mode)
        print(f"[LLM] provider={provider}  model={resolved_model}", flush=True)

        # Agentic tool-use loop (max 10 rounds to prevent infinite loops)
        for round_num in range(10):
            response = await client.chat.completions.create(**kwargs, timeout=180)
            choice = response.choices[0]

            if choice.finish_reason == "tool_calls" and tool_dispatcher and choice.message.tool_calls:
                tool_names = [tc.function.name for tc in choice.message.tool_calls]
                logger.info("[LLM] ↪ round %d  calls: %s", round_num + 1, tool_names)
                messages.append(choice.message.model_dump())
                for tc in choice.message.tool_calls:
                    fn_name = tc.function.name
                    fn_args = json.loads(tc.function.arguments)
                    # Log args (truncated)
                    args_preview = ", ".join(f"{k}={repr(v)[:60]}" for k, v in fn_args.items())
                    logger.info("[TOOL] ▶ %s(%s)", fn_name, args_preview)
                    tool_result = await tool_dispatcher.dispatch(fn_name, fn_args)
                    # Log result (truncated)
                    result_preview = str(tool_result)[:120].replace("\n", " ")
                    logger.info("[TOOL] ✓ %s → %s", fn_name, result_preview)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps(tool_result, ensure_ascii=False),
                    })
                kwargs["messages"] = messages
                continue

            tokens = getattr(response.usage, "completion_tokens", "?")
            elapsed = _time.monotonic() - t0
            logger.info("[LLM] ✓ done  finish=%s  tokens=%s  %.1fs", choice.finish_reason, tokens, elapsed)
            return choice.message.content or ""

        # Force a final text response after tool rounds are exhausted
        logger.warning("[LLM] exhausted 10 tool rounds — requesting final summary")
        messages.append({"role": "user", "content": "You have used all available tool calls. Now produce your final text response based on what you have gathered so far."})
        kwargs["messages"] = messages
        kwargs.pop("tools", None)
        kwargs.pop("tool_choice", None)
        final = await client.chat.completions.create(**kwargs, timeout=180)
        return final.choices[0].message.content or ""

    async def check_connectivity(self, provider: str) -> dict[str, Any]:
        try:
            client = self.get_client(provider)
            model = self.resolve_model(provider, None)
            # Minimal ping: list models or do a tiny completion
            resp = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=1,
            )
            return {"provider": provider, "status": "ok", "model": model}
        except Exception as e:
            return {"provider": provider, "status": "error", "error": str(e)}


class ToolDispatcher:
    """Routes tool-call function names to actual Python callables."""

    def __init__(self) -> None:
        self._registry: dict[str, Any] = {}

    def register(self, name: str, fn: Any) -> None:
        self._registry[name] = fn

    async def dispatch(self, name: str, args: dict) -> Any:
        fn = self._registry.get(name)
        if fn is None:
            return {"error": f"Unknown tool: {name}"}
        import asyncio
        if asyncio.iscoroutinefunction(fn):
            return await fn(**args)
        return fn(**args)


# Singleton used across the app
provider_router = ProviderRouter()
