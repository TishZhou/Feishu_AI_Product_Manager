import json
import logging
import uuid
from typing import Any

from openai import AsyncOpenAI

from devflow.config import settings

logger = logging.getLogger("devflow.provider")


def _emit(run_id: str | None, stage_key: str, level: str, message: str, **extra) -> None:
    if not run_id:
        return
    try:
        from devflow.core.log_bus import log_bus
        log_bus.emit(run_id, level, stage_key, message, **extra)
    except Exception as e:
        logger.warning("log_bus emit failed (level=%s stage=%s): %s", level, stage_key, e)


class ProviderRouter:
    def __init__(self) -> None:
        self._clients: dict[str, AsyncOpenAI] = {}

    def get_client(self, provider: str) -> AsyncOpenAI:
        if provider not in self._clients:
            if provider == "gemini":
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
                raise ValueError(f"Unknown provider: {provider!r}. Supported: gemini, volcano")
        return self._clients[provider]

    def resolve_model(self, provider: str, model: str | None) -> str:
        if model:
            return model
        if provider == "gemini":
            return settings.GEMINI_DEFAULT_MODEL
        if provider == "volcano":
            return settings.VOLCANO_DEFAULT_MODEL
        return ""

    async def _stream_round(
        self,
        client: AsyncOpenAI,
        kwargs: dict[str, Any],
        run_id: str | None,
        stage_key: str,
        call_id: str,
    ) -> tuple[str, str | None, list[dict]]:
        """
        Execute one streaming LLM round.
        Returns (full_content, finish_reason, tool_calls_list).
        Emits 'token' log events for each text chunk.
        """
        stream = await client.chat.completions.create(**kwargs, stream=True, timeout=180)

        full_content = ""
        tool_calls_by_index: dict[int, dict[str, Any]] = {}
        finish_reason: str | None = None

        async for chunk in stream:
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            if choice.finish_reason:
                finish_reason = choice.finish_reason
            delta = choice.delta

            # Accumulate text content and emit as token events
            if delta.content:
                full_content += delta.content
                _emit(run_id, stage_key, "token", delta.content, call_id=call_id)

            # Accumulate tool-call deltas
            if delta.tool_calls:
                for tc_delta in delta.tool_calls:
                    idx = tc_delta.index
                    if idx not in tool_calls_by_index:
                        tool_calls_by_index[idx] = {
                            "id": "",
                            "type": "function",
                            "function": {"name": "", "arguments": ""},
                        }
                    if tc_delta.id:
                        tool_calls_by_index[idx]["id"] = tc_delta.id
                    if tc_delta.function:
                        if tc_delta.function.name:
                            tool_calls_by_index[idx]["function"]["name"] += tc_delta.function.name
                        if tc_delta.function.arguments:
                            tool_calls_by_index[idx]["function"]["arguments"] += tc_delta.function.arguments

        tool_calls = [tool_calls_by_index[i] for i in sorted(tool_calls_by_index.keys())]
        return full_content, finish_reason, tool_calls

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
        run_id: str | None = None,
        stage_key: str = "",
    ) -> str:
        provider = provider or settings.DEFAULT_PROVIDER
        if provider == "openai":
            provider = "gemini"  # openai has been replaced by gemini
        client = self.get_client(provider)
        resolved_model = self.resolve_model(provider, model)

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

        # Providers that do NOT support the response_format API parameter
        _NO_JSON_FORMAT_PROVIDERS = {"volcano"}

        if json_mode and provider in _NO_JSON_FORMAT_PROVIDERS:
            # Inject JSON instruction into system prompt instead of using API param
            messages[0]["content"] = (
                messages[0]["content"]
                + "\n\nIMPORTANT: Your response MUST be valid JSON only. "
                "Do not include markdown, code fences, or any text outside the JSON object."
            )

        kwargs: dict[str, Any] = {"model": resolved_model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        if json_mode and provider not in _NO_JSON_FORMAT_PROVIDERS:
            kwargs["response_format"] = {"type": "json_object"}
        if max_tokens:
            kwargs["max_tokens"] = max_tokens

        import time as _time
        t0 = _time.monotonic()
        logger.info("[LLM] ▶ calling %s  model=%s  tools=%s  json=%s", provider, resolved_model, bool(tools), json_mode)

        # Agentic tool-use loop (max 10 rounds to prevent infinite loops)
        for round_num in range(10):
            call_id = str(uuid.uuid4())[:8]
            _emit(run_id, stage_key, "llm",
                  f"LLM 推理中  model={resolved_model}  第 {round_num + 1} 轮",
                  call_id=call_id)

            full_content, finish_reason, tool_calls = await self._stream_round(
                client, kwargs, run_id, stage_key, call_id
            )

            if finish_reason == "tool_calls" and tool_dispatcher and tool_calls:
                tool_names = [tc["function"]["name"] for tc in tool_calls]
                logger.info("[LLM] ↪ round %d  calls: %s", round_num + 1, tool_names)
                _emit(run_id, stage_key, "llm", f"第 {round_num + 1} 轮工具调用: {', '.join(tool_names)}")

                # Reconstruct the assistant message with tool_calls for the messages list
                assistant_msg: dict[str, Any] = {
                    "role": "assistant",
                    "content": full_content or None,
                    "tool_calls": [
                        {
                            "id": tc["id"],
                            "type": "function",
                            "function": {
                                "name": tc["function"]["name"],
                                "arguments": tc["function"]["arguments"],
                            },
                        }
                        for tc in tool_calls
                    ],
                }
                messages.append(assistant_msg)

                for tc in tool_calls:
                    fn_name = tc["function"]["name"]
                    fn_args = json.loads(tc["function"]["arguments"])
                    args_preview = ", ".join(f"{k}={repr(v)[:60]}" for k, v in fn_args.items())
                    logger.info("[TOOL] ▶ %s(%s)", fn_name, args_preview)
                    _emit(run_id, stage_key, "tool", f"调用工具 {fn_name}({args_preview[:120]})")
                    tool_result = await tool_dispatcher.dispatch(fn_name, fn_args)
                    result_preview = str(tool_result)[:120].replace("\n", " ")
                    logger.info("[TOOL] ✓ %s → %s", fn_name, result_preview)
                    _emit(run_id, stage_key, "tool", f"工具返回 {fn_name}: {result_preview}")
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps(tool_result, ensure_ascii=False),
                    })

                kwargs["messages"] = messages
                continue

            elapsed = _time.monotonic() - t0
            tokens_approx = len(full_content) // 4  # rough estimate when usage not in stream
            logger.info("[LLM] ✓ done  finish=%s  ~tokens=%s  %.1fs", finish_reason, tokens_approx, elapsed)
            _emit(run_id, stage_key, "llm",
                  f"推理完成  ~{tokens_approx} tokens  耗时 {elapsed:.1f}s",
                  call_id=call_id)
            return full_content

        # Force a final text response after tool rounds are exhausted
        logger.warning("[LLM] exhausted 10 tool rounds — requesting final summary")
        _emit(run_id, stage_key, "llm", "工具调用轮次耗尽，请求最终汇总")
        messages.append({
            "role": "user",
            "content": "You have used all available tool calls. Now produce your final text response based on what you have gathered so far.",
        })
        kwargs["messages"] = messages
        kwargs.pop("tools", None)
        kwargs.pop("tool_choice", None)

        call_id = str(uuid.uuid4())[:8]
        _emit(run_id, stage_key, "llm", "最终汇总推理中", call_id=call_id)
        full_content, _, _ = await self._stream_round(client, kwargs, run_id, stage_key, call_id)
        elapsed = _time.monotonic() - t0
        _emit(run_id, stage_key, "llm", f"汇总完成  耗时 {elapsed:.1f}s", call_id=call_id)
        return full_content

    async def check_connectivity(self, provider: str) -> dict[str, Any]:
        try:
            client = self.get_client(provider)
            model = self.resolve_model(provider, None)
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
