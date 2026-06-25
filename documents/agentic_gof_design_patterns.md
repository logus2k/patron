# Agent-Oriented Design Patterns: Applying GoF to Multi-Agent Systems

**Author:** António Cruz  
**Document Version:** 1.1  

---

## 1. Vision Statement
The transition from traditional software engineering to Generative AI demands a paradigm shift in how we structure applications. As we move from deterministic function execution to orchestrating non-deterministic, latency-bound models, the need for robust encapsulation becomes paramount. 

**Agent-Oriented Programming (AOP)** treats LLMs not as monolithic scripts, but as highly cohesive, loosely coupled objects. By mapping the classic Gang of Four (GoF) design patterns to agentic behavior, we create deterministic shells around non-deterministic cores. This approach enables Multi-Agent Systems (MAS) that are predictable, replicable, and capable of operating autonomously at scale.

The GoF vocabulary is not a replacement for the agentic vocabulary the field already uses — orchestrator-worker, planner-executor, reflection, ReAct, and LLM cascades. Rather, it provides a *structural* lens that names the deterministic plumbing around those flows. Where the two overlap, this document notes the correspondence explicitly (e.g., the Facade Agent is the structural form of an orchestrator; the Chain of Responsibility Agent is the structural form of an LLM cascade).

## 2. Architectural Goals

* **Predictability via Encapsulation:** By restricting an agent to a specific GoF interface, we contain the blast radius of hallucinations and enforce strict input/output contracts.
* **Hardware & Resource Agnosticism:** Abstracting agents allows the underlying model to be swapped dynamically. The overarching architecture shouldn't care if an agent is powered by a massive cloud API or a localized DeepSeek or Gemma 4 model running via `llama.cpp`. 
* **Coordinated State & Resource Access:** Patterns do not save memory by themselves — VRAM is reclaimed by weight loading/unloading and KV-cache management, not by a class diagram. What patterns *do* provide is a single, well-defined point of coordination: one place that owns shared context and one place that owns model residency. This prevents the redundant state and uncoordinated model loads that blow past a constrained budget (e.g., balancing multiple agents within a 24GB VRAM limit), letting the actual resource-management logic live behind a stable interface.
* **Pipeline Integration:** Encapsulated agents become predictable nodes that can be seamlessly tracked, versioned, and orchestrated by MLOps tools.

> **A note on the analogy.** GoF patterns were designed for cheap, synchronous, deterministic objects. Agents are none of these things. Throughout this document the mapping is treated as a structural aid, not an identity — Section 6 addresses where the analogy leaks and should not be pushed further.

---

## 3. Creational Patterns (Agent Instantiation & Lifecycle)
Creational patterns abstract the instantiation process, deciding *which* agent to spin up, with *what* context, and *when*.

### 3.1. The Repository Singleton (Shared State / Memory Manager)
**Concept:** Ensures a single, authoritative owner of a shared resource (session state, schema, memory) that all agents read from and write to, rather than each maintaining a private copy.

> **Naming note:** The classic Singleton constrains *instance count*. The problem we are actually solving here is *shared state and a single source of truth*, which is closer to a **Repository** exposed as a process-wide singleton. The reasoning agents themselves should remain stateless and freely replicable; it is the *store* that is singular, not the cognition.

* **Use Case:** In a complex pipeline, having multiple agents maintain separate memory streams leads to divergence — two agents acting on stale or conflicting copies of the same context.
* **Example:** A `StateRepository` acts as the single source of truth for the session context. If the Coder Agent and the Reviewer Agent both need the current project schema, they request it from the repository, guaranteeing they operate on identically synchronized data.

```text
interface StateRepository:        # singular instance; agents are not
    get(key) -> Value
    commit(key, value) -> Version  # versioned writes for auditability
```

### 3.2. The Factory Method Agent (Dynamic Dispatcher)
**Concept:** Defines an interface for creating an agent, but lets the logic decide which specific model or persona to instantiate based on the task's parameters.

> **Overlap:** When the selection is driven by inspecting the request at runtime, this shades into a **Router / Dispatcher** (and is closely related to the Strategy Agent in §5.1). The distinction is intent: the Factory owns *construction*, the Router owns *delegation*. They are frequently the same component wearing two hats.

* **Use Case:** Optimizing inference costs and hardware allocation by matching model size to task complexity.
* **Example:** A request enters the system. The Factory Agent evaluates the prompt. If it's a simple formatting task, it instantiates a lightweight `LocalGGUFAgent`. If it requires complex mathematical reasoning, it spawns a heavy `ReasoningAgent`.

```text
interface AgentFactory:
    create(task: TaskSpec) -> Agent  # returns the right model/persona for the task
```

### 3.3. The Builder Agent (Context Assembler)
**Concept:** Separates the construction of a complex agentic prompt or context window from its execution, assembling it in well-defined stages.

> **Family note:** In GoF terms this leans on the Builder's *staged construction* idea, but the agentic version is effectively a **prompt-assembly pipeline** (with a Template Method flavor): each stage contributes one section of the final context. The value is that assembly is inspectable and reorderable independently of inference.

* **Use Case:** Tasks requiring massive context assembly (e.g., reading multiple files, fetching history, compiling schema) before inference.
* **Example:** A `PromptBuilderAgent` sequentially gathers data — first pulling the codebase structure, then appending the user's instructions, then injecting strict formatting constraints — before finally handing the fully constructed prompt to the Executor Agent.

```text
interface PromptBuilder:
    withCodebase(...) -> PromptBuilder
    withInstructions(...) -> PromptBuilder
    withConstraints(...) -> PromptBuilder
    build() -> Prompt        # construction decoupled from execution
```

---

## 4. Structural Patterns (Agent Organization & Boundaries)
Structural patterns focus on how agents and tools are composed to form larger, more resilient structures.

### 4.1. The Facade Agent (Supervisor / Router)
**Concept:** Provides a unified, simplified interface to a complex subsystem of specialized agents. This is the structural form of the familiar **orchestrator-worker** pattern.

* **Use Case:** Hiding the complexity of a multi-agent swarm from the end user or the front-end application.
* **Example:** In a collaborative MLOps platform, the user only interacts with a `WorkspaceSupervisorAgent`. Behind the scenes, the Supervisor orchestrates a `NotebookAgent`, a `DocsAgent`, and a `TestingAgent`, synthesizing their outputs into a single, cohesive response for the user.

```text
interface WorkspaceSupervisor:
    handle(request) -> Response   # hides NotebookAgent, DocsAgent, TestingAgent
```

### 4.2. The Proxy Agent (Guardrail / Tool Gatekeeper)
**Concept:** Provides a surrogate or placeholder to control access to another agent, tool, or external system.
* **Use Case:** Security, syntax validation, and rate-limiting.
* **Example:** Before a `CodeExecutionAgent` is allowed to run a generated script in a local WSL2 Ubuntu environment, its output is intercepted by a `SecurityProxyAgent`. The Proxy statically analyzes the command for destructive operations (e.g., `rm -rf`) and either executes it or bounces it back to the Coder Agent with a strict rejection.

```text
interface SecurityProxy implements CodeExecutor:   # same interface as the real target
    execute(command) -> Result | Rejection         # validate, then delegate or refuse
```

### 4.3. The Decorator Agent (Dynamic Capability Injection)
**Concept:** Attaches additional responsibilities or tools to an agent dynamically, without altering its core system prompt.
* **Use Case:** Extending an agent's capabilities at runtime based on user requests.
* **Example:** A base `ResearchAgent` is instantiated. Depending on the query, it can be "decorated" with a `WebSearchTool` or a `LocalFileTool`, granting it temporary capabilities for the duration of that specific execution chain.

```text
interface Agent:
    run(input) -> Output

class ToolDecorator implements Agent:   # wraps an Agent, adds a tool, preserves interface
    run(input) -> Output
```

---

## 5. Behavioral Patterns (Agent Interaction & Workflow)
Behavioral patterns manage the algorithms, relationships, and assignment of responsibilities between agents.

### 5.1. The Strategy Agent (Swappable Personas)
**Concept:** Defines a family of behaviors, encapsulates each one, and makes them interchangeable at runtime.
* **Use Case:** Altering the execution style, tone, or evaluation criteria of an agent dynamically.
* **Example:** An `EvaluationAgent` is passed different strategies depending on the pipeline stage. It can be equipped with a `CodePerformanceStrategy` (optimizing for Big O notation) or a `CodeReadabilityStrategy` (optimizing for documentation and style), changing its entire evaluation metric without changing the underlying agent framework.

```text
interface EvaluationStrategy:
    score(artifact) -> Verdict

# EvaluationAgent(strategy) — same agent, swappable criteria
```

### 5.2. Chain of Responsibility Agent (Escalation Pipeline)
**Concept:** Passes a request along a chain of potential handlers until one successfully resolves it. This is the structural form of the **LLM cascade**.
* **Use Case:** Fallback mechanisms to ensure high availability and self-correction.
* **Example:** An incoming query is routed to a fast, localized agent (Handler 1). If the localized agent detects a drop in confidence or fails to parse the output correctly, it passes the exact same context up the chain to a more capable, resource-heavy model (Handler 2) for resolution.

```text
interface Handler:
    handle(context) -> Result | Escalate(context)  # resolve, or pass unchanged up-chain
```

### 5.3. The Observer Agent (Event-Driven Reaction)
**Concept:** Defines a one-to-many dependency so that when one agent updates its state, all registered dependents are notified automatically — decoupling the producer of an event from its consumers.
* **Use Case:** Decoupled, asynchronous agent workflows where agents react to events rather than direct prompts.
* **Example:** An event bus tracks system states. A `LogMonitorAgent` publishes an error event. Immediately, a `TroubleshootingAgent` (subscribed to that event) wakes up, pulls the error context, and begins generating a fix, entirely decoupled from the monitor's execution loop.

> **Related — but not GoF: the Blackboard.** The Observer (pub-sub) handles *notification*. A **Blackboard** — a shared workspace where multiple specialist agents opportunistically read and contribute partial solutions — is a distinct architectural pattern from classical AI / POSA, not part of GoF. The two compose well (agents subscribe to changes on a shared blackboard), but conflating them obscures that the blackboard owns *shared state* while the observer owns *eventing*. Keep them separate when designing.

```text
interface EventBus:
    publish(event) -> void
    subscribe(eventType, handler) -> Subscription
```

---

## 6. Where the Analogy Breaks Down
The GoF mapping is a structural aid, not an identity. Pushing it too far invites design mistakes, because agents differ from objects along axes GoF never had to model:

* **Cost and latency are first-class.** Instantiating an object is free; "instantiating" a heavy `ReasoningAgent` may cost seconds and real money. A Factory or Chain that would be trivially cheap in OOP becomes a budgeting decision in MAS.
* **Failure is probabilistic, not exceptional.** Objects either work or throw. Agents return *plausibly wrong* output. Every pattern boundary here doubles as a validation boundary — which is precisely why the Proxy (guardrail) and Chain (confidence-based escalation) patterns matter more than their OOP counterparts.
* **State lives in the context window.** "Encapsulation" in OOP hides fields; in MAS the relevant state is the prompt/context, which is token-bounded, lossy, and expensive to carry. The Builder and Repository patterns exist largely to manage this scarce resource.
* **Behavior is emergent, not specified.** A Strategy in OOP fully determines behavior. An agent "Strategy" only *biases* behavior via prompt — the model may ignore it. Treat these patterns as shaping probabilities, not enforcing contracts.

The deterministic shell is real and worth building. The non-deterministic core inside it is not an object, and the patterns should be applied with that asymmetry in mind.
