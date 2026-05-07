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
            elif provider == "gemini":
                self._clients["gemini"] = AsyncOpenAI(
                    api_key=settings.GEMINI_API_KEY,
                    base_url=settings.GEMINI_BASE_URL,
                )
            elif provider == "volcano":
                self._clients["volcano"] = AsyncOpenAI(
                    api_key=settings.VOLCANO_API_KEY,
                    base_url=settings.VOLCANO_BASE_URL,
                )
            else:
                raise ValueError(f"Unknown provider: {provider!r}. Supported: openai, gemini, volcano")
        return self._clients[provider]

    def resolve_model(self, provider: str, model: str | None) -> str:
        if model:
            return model
        if provider == "openai":
            return settings.OPENAI_DEFAULT_MODEL
        if provider == "gemini":
            return settings.GEMINI_DEFAULT_MODEL
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
        max_tool_rounds: int = 25,
        cache_key: str | None = None,
        run_id: str | None = None,
        stage_key: str = "",
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
            kwargs[_max_tokens_param(provider, resolved_model)] = max_tokens

        # OpenAI prompt caching: passing a stable cache_key groups calls for the
        # provider-side cache router. Caching itself is automatic once the prompt
        # exceeds 1024 tokens, but the key improves hit rate across calls and
        # surfaces cached_tokens in usage. Volcano (火山) doesn't support this
        # parameter — leave that path untouched.
        if provider == "openai" and cache_key:
            kwargs["prompt_cache_key"] = cache_key

        import time as _time
        t0 = _time.monotonic()
        logger.info(
            "[LLM] ▶ calling %s  model=%s  tools=%s  json=%s  cache_key=%s",
            provider, resolved_model, bool(tools), json_mode, cache_key or "-",
        )
        print(f"[LLM] provider={provider}  model={resolved_model}", flush=True)

        # Agentic tool-use loop — capped at max_tool_rounds to prevent runaway calls
        for round_num in range(max(1, max_tool_rounds)):
            response = await _create_chat_completion(client, kwargs, timeout=180)
            choice = response.choices[0]
            self._log_cache_usage(response, provider, round_num + 1)

            if choice.finish_reason == "tool_calls" and tool_dispatcher and choice.message.tool_calls:
                tool_names = [tc.function.name for tc in choice.message.tool_calls]
                logger.info("[LLM] ↪ round %d  calls: %s", round_num + 1, tool_names)
                messages.append(choice.message.model_dump())
                for tc in choice.message.tool_calls:
                    fn_name = tc.function.name
                    try:
                        fn_args = json.loads(tc.function.arguments)
                    except json.JSONDecodeError as exc:
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": json.dumps({
                                "error": f"Invalid tool arguments JSON for {fn_name}: {exc}",
                                "raw_arguments": tc.function.arguments,
                            }, ensure_ascii=False),
                        })
                        continue
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
            if run_id and stage_key and isinstance(tokens, int):
                try:
                    from devflow.services.token_usage import token_usage_store
                    token_usage_store.add(run_id, stage_key, tokens)
                except Exception:
                    logger.debug("token usage tracking failed", exc_info=True)
            return choice.message.content or ""

        # Force a final text response after tool rounds are exhausted
        logger.warning("[LLM] exhausted %d tool rounds — requesting final summary", max_tool_rounds)
        messages.append({"role": "user", "content": "You have used all available tool calls. Now produce your final text response based on what you have gathered so far."})
        kwargs["messages"] = messages
        kwargs.pop("tools", None)
        kwargs.pop("tool_choice", None)
        final = await _create_chat_completion(client, kwargs, timeout=180)
        self._log_cache_usage(final, provider, max_tool_rounds + 1)
        tokens = getattr(final.usage, "completion_tokens", None)
        if run_id and stage_key and isinstance(tokens, int):
            try:
                from devflow.services.token_usage import token_usage_store
                token_usage_store.add(run_id, stage_key, tokens)
            except Exception:
                logger.debug("token usage tracking failed", exc_info=True)
        return final.choices[0].message.content or ""

    def _log_cache_usage(self, response: Any, provider: str, round_num: int) -> None:
        """Log how many prompt tokens were served from the provider-side cache.

        OpenAI returns ``usage.prompt_tokens_details.cached_tokens``; volcano and
        other OpenAI-compatible APIs may omit this field. Silently no-op when
        absent so non-OpenAI providers stay unaffected.
        """
        usage = getattr(response, "usage", None)
        if not usage:
            return
        details = getattr(usage, "prompt_tokens_details", None)
        cached = getattr(details, "cached_tokens", None) if details else None
        if cached is None:
            return
        prompt_total = getattr(usage, "prompt_tokens", 0) or 0
        ratio = (cached / prompt_total * 100) if prompt_total else 0.0
        logger.info(
            "[LLM] ⚡ cache  round=%d  cached=%d / %d prompt tokens (%.0f%%)",
            round_num, cached, prompt_total, ratio,
        )

    async def check_connectivity(self, provider: str) -> dict[str, Any]:
        try:
            client = self.get_client(provider)
            model = self.resolve_model(provider, None)
            # Minimal ping: list models or do a tiny completion
            resp = await _create_chat_completion(
                client,
                {
                    "model": model,
                    "messages": [{"role": "user", "content": "ping"}],
                    _max_tokens_param(provider, model): 1,
                },
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
        # LLMs occasionally hallucinate extra kwargs (e.g. passing ``cwd`` to
        # ``write_file`` because they saw it in another tool's schema). Filter
        # the args down to what the bound function actually accepts so a
        # spurious parameter is silently dropped instead of crashing the run.
        filtered = _filter_kwargs_for(fn, args or {})
        import asyncio
        if asyncio.iscoroutinefunction(fn):
            return await fn(**filtered)
        return fn(**filtered)


def _filter_kwargs_for(fn: Any, args: dict) -> dict:
    import inspect
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        return args
    accepted: set[str] = set()
    accepts_var_kw = False
    for name, param in sig.parameters.items():
        if param.kind is inspect.Parameter.VAR_KEYWORD:
            accepts_var_kw = True
            continue
        if param.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.VAR_POSITIONAL):
            continue
        accepted.add(name)
    if accepts_var_kw:
        return args
    return {k: v for k, v in args.items() if k in accepted}


def _max_tokens_param(provider: str, model: str) -> str:
    """OpenAI reasoning-era chat models reject the legacy max_tokens parameter."""
    normalized = model.lower()
    if provider == "openai" and (normalized.startswith("gpt-5") or normalized.startswith("o")):
        return "max_completion_tokens"
    return "max_tokens"


async def _create_chat_completion(client: AsyncOpenAI, kwargs: dict[str, Any], timeout: int = 180) -> Any:
    try:
        return await client.chat.completions.create(**kwargs, timeout=timeout)
    except Exception as exc:
        message = str(exc)
        unsupported = "Unsupported parameter: '"
        if unsupported not in message:
            raise
        param = message.split(unsupported, 1)[1].split("'", 1)[0]
        if param == "max_tokens" and "max_tokens" in kwargs:
            kwargs["max_completion_tokens"] = kwargs.pop("max_tokens")
        elif param in kwargs:
            kwargs.pop(param, None)
        else:
            raise
        logger.warning("[LLM] retrying without unsupported parameter: %s", param)
        return await client.chat.completions.create(**kwargs, timeout=timeout)


# Singleton used across the app
provider_router = ProviderRouter()
