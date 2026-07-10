"""CLI entry point: python -m evals.run --golden ..."""
import argparse
import asyncio
import logging
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import evals  # noqa: F401  -- triggers sys.path setup before app.* imports

from evals.config import (
    DEFAULT_CONCURRENCY,
    DEFAULT_GEN_TIMEOUT_S,
    DEFAULT_MAX_DEPTH,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_PER_CASE_TIMEOUT_S,
    DEFAULT_TOP_K,
    EVAL_PROJECT_ID,
)
from evals.gate import GateConfigError, check_thresholds, load_thresholds
from evals.generation import GEN_PROMPT_VERSION
from evals.golden_set.validate import validate_golden_set
from evals.reporter import compute_aggregate, compute_generation_aggregate, render_table, write_json
from evals.runner import load_golden_set, run_corpus, run_generation_phase

REPO_ROOT = Path(__file__).resolve().parent.parent

logger = logging.getLogger("evals")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="python -m evals.run")
    p.add_argument("--golden", required=True, type=Path,
                   help="Path to golden set JSONL")
    p.add_argument("--index-corpus", type=Path, default=None,
                   help="If given, index this directory before evaluating")
    p.add_argument("--project-id", type=int, default=EVAL_PROJECT_ID)
    p.add_argument("--top-k", type=int, default=DEFAULT_TOP_K)
    p.add_argument("--max-depth", type=int, default=DEFAULT_MAX_DEPTH)
    p.add_argument("--categories", type=str, default=None,
                   help="Comma-separated category filter")
    p.add_argument("--limit", type=int, default=None,
                   help="Only run first N cases")
    p.add_argument("--output-dir", type=Path, default=Path(DEFAULT_OUTPUT_DIR))
    p.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    p.add_argument("--quiet", action="store_true",
                   help="Only print JSON path on success")
    p.add_argument("--with-generation", action="store_true",
                   help="Generate answers and run LLM-as-judge metrics "
                        "(requires LLM_API_KEY or ZHIPUAI_API_KEY)")
    p.add_argument("--gen-model", type=str, default=None,
                   help="Override generator model (default: provider 'default' tier)")
    p.add_argument("--judge-model", type=str, default=None,
                   help="Override judge model (default: glm-5.1, kept distinct from the generator)")
    p.add_argument("--gen-timeout", type=float, default=DEFAULT_GEN_TIMEOUT_S,
                   help="Per-case generation+judge budget in seconds")
    p.add_argument("--gate", type=Path, default=None,
                   help="Thresholds JSON file; exit 1 if any aggregate metric "
                        "falls below its configured floor")
    return p.parse_args(argv)


def git_meta() -> tuple[str | None, bool | None]:
    """Return (short_sha, dirty_bool) or (None, None) if git is unavailable."""
    try:
        sha = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT, text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        dirty = bool(
            subprocess.check_output(
                ["git", "status", "--porcelain"], cwd=REPO_ROOT, text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
        )
        return sha, dirty
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None, None


async def _do_index(corpus_path: Path, project_id: int) -> None:
    """Index the corpus by walking the directory and calling build_from_files.

    Per TBD #2 (resolved): graph_builder has no 'index a directory' helper.
    The harness must walk the directory itself, assemble the list of file
    dicts ({path, content, language}), and call CodeGraphBuilder.build_from_files.

    Path strings written into ``module_path`` here are what later flow into
    chunk.metadata.module_path during retrieval, and retrieval metrics compare
    them to the golden set's ``expected_files`` by exact string match. The
    golden-set convention (see golden_set.validate) resolves paths from repo
    root, so corpora inside the repo are stored repo-root-relative, e.g.
    ``evals/fixtures/mini_repo/auth.py``. A corpus outside the repo falls back
    to ``corpus_path.parent``-relative.
    """
    from app.services.code_graph.graph_builder import CodeGraphBuilder  # noqa: WPS433

    corpus_root = corpus_path.resolve()
    base = REPO_ROOT if corpus_root.is_relative_to(REPO_ROOT) else corpus_root.parent

    files: list[dict[str, str]] = []
    for py_file in sorted(corpus_root.rglob("*.py")):
        rel_path = py_file.relative_to(base).as_posix()
        files.append({
            "path": rel_path,
            "content": py_file.read_text(encoding="utf-8"),
            "language": "python",
        })
    if not files:
        raise RuntimeError(f"No .py files found under {corpus_path}")

    builder = CodeGraphBuilder()
    result = await builder.build_from_files(files, project_id=project_id)
    if not result.get("success", False):
        errors = result.get("stats", {}).get("errors", [])
        raise RuntimeError(
            f"build_from_files reported failures: {errors[:3]}"
            f"{' ...' if len(errors) > 3 else ''}"
        )


async def main_async(args: argparse.Namespace) -> int:
    # 0. Load gate thresholds first so a bad config fails before the run
    thresholds = None
    if args.gate:
        try:
            thresholds = load_thresholds(args.gate)
        except GateConfigError as exc:
            print(f"ERROR: --gate: {exc}", file=sys.stderr)
            return 2

    # 1. Validate golden set
    try:
        errors, warnings = validate_golden_set(args.golden, REPO_ROOT)
    except FileNotFoundError:
        print(f"ERROR: golden set file not found: {args.golden}", file=sys.stderr)
        return 2
    for w in warnings:
        print(f"WARN: {w}", file=sys.stderr)
    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        return 2

    cases = load_golden_set(args.golden)
    if args.categories:
        allowed = {c.strip() for c in args.categories.split(",") if c.strip()}
        cases = [c for c in cases if c["category"] in allowed]
    if args.limit:
        cases = cases[: args.limit]

    gen_llm = judge_llm = None
    if args.with_generation:
        from app.core.config import settings
        if not (settings.LLM_API_KEY or settings.ZHIPUAI_API_KEY):
            print("ERROR: --with-generation requires LLM_API_KEY or "
                  "ZHIPUAI_API_KEY to be configured", file=sys.stderr)
            return 2
        from app.services.langchain_glm_service import LLMService
        try:
            gen_llm = (LLMService(model=args.gen_model) if args.gen_model
                       else LLMService(tier="default"))
            # Judge pinned to glm-5.1, deliberately distinct from the glm-5.2
            # generator (default tier), to avoid self-grading bias.
            judge_llm = (LLMService(model=args.judge_model) if args.judge_model
                         else LLMService(model="glm-5.1"))
        except ValueError as exc:  # e.g. unknown LLM_PROVIDER
            print(f"ERROR: cannot configure LLM: {exc}", file=sys.stderr)
            return 2
    elif args.gen_model or args.judge_model or args.gen_timeout != DEFAULT_GEN_TIMEOUT_S:
        print("WARN: --gen-model/--judge-model/--gen-timeout have no effect "
              "without --with-generation", file=sys.stderr)

    # 2. Optional indexing step
    if args.index_corpus:
        try:
            await _do_index(args.index_corpus, args.project_id)
        except Exception as exc:
            print(f"ERROR: --index-corpus failed: {type(exc).__name__}: {exc}",
                  file=sys.stderr)
            return 3

    # 3. Build retriever
    try:
        from app.services.code_graph.retriever import CodeGraphRetriever
        retriever = CodeGraphRetriever()
    except Exception as exc:
        print(f"ERROR: cannot initialize retriever: {type(exc).__name__}: {exc}",
              file=sys.stderr)
        return 3

    # 4. Run
    results = await run_corpus(
        cases, retriever,
        top_k=args.top_k, max_depth=args.max_depth,
        project_id=args.project_id, concurrency=args.concurrency,
        timeout_s=DEFAULT_PER_CASE_TIMEOUT_S,
    )

    if args.with_generation:
        await run_generation_phase(
            results, gen_llm, judge_llm,
            concurrency=args.concurrency, timeout_s=args.gen_timeout,
        )

    # 5. Build meta + aggregate + persist
    sha, dirty = git_meta()
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta = {
        "timestamp": timestamp,
        "git_sha": sha,
        "git_dirty": dirty,
        "golden_set": str(args.golden),
        "indexed_corpus": str(args.index_corpus) if args.index_corpus else None,
        "case_count": len(results),
        "config": {
            "top_k": args.top_k,
            "max_depth": args.max_depth,
            "project_id": args.project_id,
            "concurrency": args.concurrency,
            "with_generation": args.with_generation,
            "gen_model": gen_llm.model if gen_llm else None,
            "judge_model": judge_llm.model if judge_llm else None,
            "gen_prompt_version": GEN_PROMPT_VERSION if args.with_generation else None,
        },
    }
    aggregate = compute_aggregate(results)
    gen_aggregate = compute_generation_aggregate(results)
    if gen_aggregate is not None:
        aggregate["generation"] = gen_aggregate

    args.output_dir.mkdir(parents=True, exist_ok=True)
    safe_ts = timestamp.replace(":", "").replace("-", "")
    out_path = args.output_dir / f"{safe_ts}.json"

    wrote = True
    try:
        write_json(out_path, meta, results, aggregate)
    except OSError as exc:
        # Still print metrics to stdout so a write failure doesn't lose info.
        print(f"WARN: could not write result file: {exc}", file=sys.stderr)
        wrote = False

    if args.quiet and wrote:
        print(str(out_path))
    else:
        print(render_table(aggregate))
        if wrote:
            print(f"\nWrote {out_path}")

    # 6. Regression gate (checklist: exit non-zero when a metric drops below floor)
    if thresholds is not None:
        failures = check_thresholds(aggregate, thresholds)
        if failures:
            for failure in failures:
                print(f"GATE FAIL: {failure}", file=sys.stderr)
            print(f"GATE: FAILED ({len(failures)} threshold violation(s), "
                  f"config: {args.gate})", file=sys.stderr)
            return 1
        print("GATE: PASSED")
    return 0


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")
    args = parse_args(argv)
    sys.exit(asyncio.run(main_async(args)))


if __name__ == "__main__":
    main()
