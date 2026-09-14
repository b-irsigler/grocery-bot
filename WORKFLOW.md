# Two-model workflow (planner + executioner)

A cost-conscious coding loop that splits the work across two models: a strong
**planner** for thinking/architecture/review, and a cheaper **executioner** for
drafting the implementation plan and writing the code. The developer drives
the loop manually by switching models in the opencode TUI between phases.

This file is repo-agnostic. Drop it alongside `plans/_TEMPLATE.md` into any
repo. For a new session say: *"Find your instructions in `WORKFLOW.md`."*

## Roles

- **Planner — `opencode-go/glm-5.2`**: brainstorm, architectural decisions,
  plan review, final review. The planner is the only role allowed to make
  design decisions. It edits only `plans/*.md`, never production code.
- **Executioner — `opencode-go/deepseek-v4-flash`**: drafts the implementation
  plan from the developer–planner conversation, then implements the approved
  plan. It makes NO architectural decisions. If it hits one — an ambiguity the
  plan does not resolve, a missing file, an unclear type — it STOPS and returns
  control to the developer with a concrete question for the planner.

## Artifacts

- `plans/<task-slug>.md` — one file per task. Started from
  `plans/_TEMPLATE.md`. The executioner writes it; the planner reviews and
  edits it in place.
- It is the **single source of truth**. Conversation context may be lost
  across model switches; the plan file is what survives. If the conversation
  is gone when you come back, re-read `plans/<task-slug>.md` and resume from
  its `## Status:` line.
- Task slug: kebab-case, descriptive, e.g. `medieval-map-style`. New task ⇒
  new slug ⇒ new file.

## Manual model switching

Between phases the developer switches the active model in the opencode TUI
(see `/help` or the TUI's model picker) and announces the new phase at the
top of the next message, e.g. *"Phase: draft plan. Here's the design
summary …"*. The executioner needs the planner's design summary in the
message, because it has no other memory of the brainstorm.

Short phase labels:
- `Phase: brainstorm` — Planner
- `Phase: draft plan` — Executioner
- `Phase: review plan` — Planner
- `Phase: implement` — Executioner
- `Phase: final review` — Planner

## The loop

0. **Start.** Pick a task-slug. Switch the active model to the **Planner**
   (`opencode-go/glm-5.2`). State `Phase: brainstorm`.
1. **Brainstorm (Planner).** Ask the planner questions, let it explore the
   codebase, push back on bad ideas, settle the architecture. End this phase
   when the planner emits a compact **Design Summary** in chat: files to
   touch, the types/names involved, error + test strategy, and the non-goals.
   No plan file is written yet — just the summary.
2. **Draft plan (Executioner).** Switch to the **Executioner**
   (`opencode-go/deepseek-v4-flash`). State `Phase: draft plan` and paste the
   Design Summary. Ask the executioner to write `plans/<task-slug>.md` (copy
   `plans/_TEMPLATE.md` first) at the detail bar described below. It must not
   start implementing.
3. **Review plan (Planner).** Switch back to the Planner. State
   `Phase: review plan` and ask it to open `plans/<task-slug>.md`.
   - **Small fixes** (typo, missing edge case, unclear wording, wrong
     verification command) → the **Planner** edits the plan file directly.
     Loop back to step 2 only if a fix needs executioner-level detail.
   - **Large gaps** (whole section missing, wrong architecture, missing
     files) → return to step 2 with an explicit gap list for the executioner.
4. **Approve.** When the planner judges the plan detailed and correct, it
   sets `## Status: approved` in the plan file. Do not implement before this
   line exists.
5. **Implement (Executioner).** Switch to the Executioner. State
   `Phase: implement`. It applies the plan top-to-bottom, in the order
   written:
   - No skipping, no reordering, no "improvements".
   - It runs every verification command in the plan, in order, reading each
     command's output before the next.
   - It does NOT commit. It does NOT edit files outside the plan's Files
     list. On any failure or ambiguity it STOPS and reports.
6. **Final review (Planner).** Switch to the Planner. State
   `Phase: final review`. It reviews the diff + the verification outputs the
   executioner reported.
   - Green → the **developer** commits.
   - Red → the planner returns a concrete fix list; back to step 5 for those
     fixes only (do not re-open the whole task).
7. **Reset.** Next task gets a new slug and a new `plans/<slug>.md`.

## Required detail bar (for the executioner)

The plan must be self-contained: a smaller-tier model with **no memory of the
planner conversation** must be able to execute each step from the plan file
alone. Concretely each `## Changes` entry must include:

- exact file path;
- exact insertion point ("after &lt;fn&gt;, before &lt;fn2&gt;") or
  "replace rule `.x` entirely with";
- verbatim literals (full const bodies, full replacement rules) inside fenced
  blocks — no paraphrasing, no "and so on";
- for new files: the full file body;
- per-step verification commands, in the order to run them, with expected
  output;
- list of files/globs never to touch (Rollback section);
- known gotchas and how to handle each (Edge cases section).

If an entry is missing any of these, the plan is not yet `approved`.

## Hard rules (apply across all phases)

- **No mid-step model switching.** Finish the current phase's step, then
  switch at the phase boundary.
- **No model ever commits.** Only the developer commits, after final review
  is green.
- **The plan file is the only source of truth.** If conversation context is
  lost, re-open `plans/<task-slug>.md` and resume from `## Status:`.
- **Plan, then code.** The executioner never edits production code before the
  plan file reads `## Status: approved`.
- **Stop on ambiguity.** The executioner does not improvise; it returns a
  concrete question to the developer, who routes it to the planner.

## Why this saves cost

The planner's tokens are spent on low-volume, high-leverage work —
brainstorming, reviewing, and editing short plan files. The high-volume work
(drafting the long plan file, writing the actual code) goes to the cheaper
flash-tier executioner. The plan file is the bridge that lets a smaller model
execute without needing the (expensive) brainstorm context itself.

## Automated mode (orchestrator)

The manual loop above can be driven automatically by three opencode agents in
`.opencode/agents/`:

- `orchestrator.md` — primary, `opencode-go/deepseek-v4-flash`, the session
  entry point (`default_agent` in `opencode.json`). Drives the phase loop,
  spawns subagents, and relays human decisions through the `question` tool.
  Never writes code.
- `planner.md` — subagent, `opencode-go/glm-5.2` — the Planner role, invoked
  at brainstorm / review plan / final review.
- `executor.md` — subagent, `opencode-go/deepseek-v4-flash` — the Executioner
  role, invoked at draft plan / implement.

Kick off a task with the `/workflow` command (`.opencode/command/workflow.md`):

```
/workflow <task-slug> <one-paragraph description>
```

The orchestrator parses the slug + description, then runs the loop from
§The loop by spawning and resuming the planner and executor subagents. Manual
model switching is replaced by Task-tool spawns; everything else (Roles,
Artifacts, the detail bar, the Hard rules, the plan file as single source of
truth) is unchanged.

The planner's brainstorm output is a terse **sketch file**
`plans/<slug>.sketch.md` (~30-80 lines of bullets: files, types/names, error
+ test strategy, non-goals, key decisions — NO verbatim code). The planner
ends brainstorm with the token `SKETCH READY` (no payload); the orchestrator
passes only the slug to the executor, which reads the sketch and expands it
into the full `plans/<slug>.md`. This keeps the expensive planner's output low
volume and avoids the orchestrator relaying a long design summary verbatim.

Subagent sessions are resumed by `task_id`, so the planner keeps its
brainstorm context across the brainstorm -> review plan -> final-review phases
and the executor keeps context across draft plan -> implement -> fixes. When a
subagent needs a human decision it returns `QUESTION:`; the orchestrator
surfaces it via the `question` tool and resumes the same subagent with the
answer — so you stay in the loop only for decisions, not for switching models.

Config is loaded once at start; after editing any file under `.opencode/` or
`opencode.json`, quit and restart opencode for the change to take effect.