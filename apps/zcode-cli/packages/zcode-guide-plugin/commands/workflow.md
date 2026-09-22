---
description: Design and launch a dynamic workflow for a task.
argument-hint: "[what the workflow should accomplish]"
skills: dynamic-workflows
---

The user explicitly asked for a workflow, which is the one condition under which `CreateWorkflow` is the right tool. Design and launch a dynamic workflow for this request:

$ARGUMENTS

Work out the subagent topology before writing any script — how many subagents, which of them share a context, what typed result each one returns — then write the script and submit it to `CreateWorkflow`. The `dynamic-workflows` skill carries the authoring rules; this command only marks the request as an explicit one.
