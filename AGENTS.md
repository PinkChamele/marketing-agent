# AGENTS.md

You are a TypeScript developer experienced with the Mastra framework. You are building a **multi-agent system for vertical market entry research and marketing strategy**. You follow strict TypeScript practices and always consult up-to-date Mastra documentation before making changes.

## CRITICAL: Load `mastra` skill

**BEFORE doing ANYTHING with Mastra, load the `mastra` skill FIRST.** Never rely on cached knowledge as Mastra's APIs change frequently between versions. Use the skill to read up-to-date documentation from `node_modules`.

In particular, verify the current syntax for:

- The **supervisor pattern** for multi-agent coordination (added Feb 2026)
- Agent memory configuration (working memory vs. persistent stores)
- Tool definitions with Zod input/output schemas
- Workflow steps and how they compose with agents

## Project Overview

This is a **Mastra** project written in TypeScript. Node.js runtime is `>=22.13.0`. Model access is routed through **OpenRouter** so we can swap models per agent (cheap models for bulk summarization, stronger models for final synthesis).

### What this system does

An outsourcing company wants to evaluate and enter new industry verticals (healthcare is the first target). Given a brief like _"vertical = healthcare, our company = [description]"_, the system produces a structured vertical-entry report covering market trends, competitor landscape, candidate ICPs, and positioning recommendations.

### Architecture

A **supervisor agent** orchestrates specialist subagents. Each subagent has scoped memory and a narrow toolset.

| Agent               | Responsibility                                                                    | Primary tools                          |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------- |
| `supervisor`        | Decompose the brief, delegate, review intermediate outputs, assemble final report | (delegates only)                       |
| `marketResearcher`  | Trends, market size, regulatory context for the vertical                          | `webSearch`, `fetchUrl`, `saveFinding` |
| `competitorAnalyst` | Identify and profile 3-5 key competitors                                          | `webSearch`, `fetchUrl`, `saveFinding` |
| `icpBuilder`        | Construct 2 candidate Ideal Customer Profiles with pains and buying signals       | `readFindings`, `saveFinding`          |
| `strategyWriter`    | Produce the final positioning & channel recommendation as structured markdown     | `readFindings`                         |

For the **MVP**, only `supervisor`, `marketResearcher`, and `strategyWriter` exist. Add the others incrementally only after the core loop produces useful output.

## Commands

```bash
npm run dev    # Start Mastra Studio at localhost:4111 (long-running, separate terminal)
npm run build  # Build a production-ready server
```

## Project Structure

| Folder                 | Description                                                                       |
| ---------------------- | --------------------------------------------------------------------------------- |
| `src/mastra`           | Entry point for all Mastra-related code and configuration                         |
| `src/mastra/agents`    | Supervisor and specialist subagents (one file per agent)                          |
| `src/mastra/workflows` | Top-level "vertical entry research" workflow that invokes the supervisor          |
| `src/mastra/tools`     | `webSearch`, `fetchUrl`, `saveFinding`, `readFindings`                            |
| `src/mastra/schemas`   | Zod schemas for findings, ICPs, competitor profiles, final report                 |
| `src/mastra/scorers`   | (Add later) Evals for output quality — groundedness, source quality, completeness |
| `src/mastra/mcp`       | (Optional) Custom MCP servers if we want to expose tools externally               |
| `src/mastra/public`    | Static assets copied into `.build/output` during build                            |

### Top-level files

| File                  | Description                                                                         |
| --------------------- | ----------------------------------------------------------------------------------- |
| `src/mastra/index.ts` | Central entry point — register all agents, tools, workflows, scorers here           |
| `.env.example`        | Template for env vars (`OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`) |
| `package.json`        | Project metadata, dependencies, npm scripts                                         |
| `tsconfig.json`       | TypeScript options, path aliases, compiler settings                                 |

## Tools — design notes

These are the four tools the agents share. All inputs/outputs use Zod schemas.

- **`webSearch`** — wraps Tavily. Inputs: `{ query, includeDomains?, excludeDomains?, maxResults? }`. Returns ranked results with snippets _and_ extracted page content where available. Default to a quality-biased domain whitelist (analyst firms, established trade press) for the healthcare vertical; let the agent override per call.
- **`fetchUrl`** — wraps Firecrawl for JS-heavy pages, falls back to plain HTTP+readability for simple pages. Returns clean markdown.
- **`saveFinding`** — appends a structured finding to a shared SQLite store. Schema: `{ source: url, claim, evidence (quoted snippet), confidence: "high"|"medium"|"low", tags: string[] }`. **This is the single most important tool** — without it, research evaporates into chat context and the strategy agent has nothing grounded to work from.
- **`readFindings`** — queries the findings store by tag or free-text. Used by downstream agents (ICP builder, strategy writer) to ground their output in what was actually researched.

### Source quality bias

For the healthcare vertical specifically, the `webSearch` tool should prefer (via `includeDomains` default): Gartner, Forrester, IDC, Everest Group, HFS Research, Deloitte, McKinsey, BCG, Accenture insights, Healthcare IT News, Fierce Healthcare, Becker's, HIMSS, and public 10-Ks / earnings transcripts from incumbents (Cognizant, Wipro, Infosys). Exclude obvious SEO content farms.

## Model routing (OpenRouter)

Configure per-agent model selection in `src/mastra/index.ts`. Suggested defaults:

- `marketResearcher`, `competitorAnalyst` → mid-tier model (cost-effective for bulk reading/summarization)
- `icpBuilder` → mid-tier
- `supervisor`, `strategyWriter` → stronger model (the synthesis steps are where quality matters most)

Models are passed via env vars so we can A/B without code changes. Never hardcode model strings inside agents.

## Output contract

The final deliverable is a markdown report conforming to a Zod schema with: executive summary, market trends (≥3, each with sourced evidence), competitor profiles (3-5), candidate ICPs (2), positioning recommendation, and a sources appendix. Every claim must trace back to at least one finding in the store. If the strategy writer cannot ground a claim, it must say so explicitly rather than fabricate.

## Boundaries

### Always do

- Load the `mastra` skill before any Mastra-related work
- Register new agents, tools, workflows, and scorers in `src/mastra/index.ts`
- Use Zod schemas for tool inputs and outputs, agent outputs, and the final report
- Route all model calls through OpenRouter via env-var configuration
- Force every claim in the final report to cite a finding from the store
- Run `npm run build` to verify changes compile

### Never do

- Never commit `.env` files or secrets
- Never modify `node_modules` or Mastra's database files directly
- Never hardcode API keys or model strings
- Never let an agent produce unsourced factual claims about the vertical — if there's no finding to back it, the agent should flag the gap, not fill it from training data
- Never expand the agent roster before the smaller version produces output that a domain expert would call useful

## Resources

- [Mastra Documentation](https://mastra.ai/llms.txt)
- [Mastra .well-known skills discovery](https://mastra.ai/.well-known/skills/index.json)
- [Anthropic: Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) — required reading on the supervisor/worker pattern
- [OpenRouter docs](https://openrouter.ai/docs) — model routing
- [Tavily](https://tavily.com/), [Firecrawl](https://firecrawl.dev/) — search and fetch
