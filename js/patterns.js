/*
 * patterns.js — Agentic GoF pattern nodes for LiteGraph.
 *
 * Implements the contract defined in documents/patterns_data_specification.md.
 * Each node is a "deterministic shell" (typed slots + config) around a mock,
 * synchronous "core". Processing is simulated — this iteration validates the
 * data contracts and composition, not real model calls.
 *
 * Exposes window.PatronPatterns = { TYPES, CATEGORY_COLORS, register(LiteGraph) }.
 */
(function (global) {
  "use strict";

  // --- Slot type ids (see spec §1) -----------------------------------------
  const TYPES = {
    TASK: "task",
    CONTEXT: "context",
    AGENTREF: "agentref",
    RESULT: "result",
    ANY: "", // wildcard
  };

  // Per-GoF-family node title colors, so the canvas reads at a glance.
  const CATEGORY_COLORS = {
    Utility: "#5a5a5a",
    Creational: "#3a6ea5",
    Structural: "#7a4ea5",
    Behavioral: "#a5683a",
  };

  // --- small helpers --------------------------------------------------------
  let _idSeq = 0;
  function nextId(prefix) {
    _idSeq += 1;
    return prefix + "-" + _idSeq;
  }

  function trace(arr, msg) {
    return (arr || []).concat([msg]);
  }

  // complexity ordering for tier comparisons
  const COMPLEXITY_RANK = { low: 0, medium: 1, high: 2 };

  function applyCategory(node, category) {
    node.color = CATEGORY_COLORS[category] || CATEGORY_COLORS.Utility;
    node._category = category;
  }

  function register(LiteGraph) {
    // ======================================================================
    // 3.0  Utility · Task Source
    // ======================================================================
    function TaskSource() {
      this.addOutput("task", TYPES.TASK);
      this.addProperty("instruction", "Refactor the auth module");
      this.addProperty("complexity", "medium");
      this.addProperty("tags", "code,backend");
      this.addWidget("text", "instruction", this.properties.instruction, (v) => {
        this.properties.instruction = v;
      });
      this.addWidget(
        "combo",
        "complexity",
        this.properties.complexity,
        (v) => {
          this.properties.complexity = v;
        },
        { values: ["low", "medium", "high"] }
      );
      this.addWidget("text", "tags", this.properties.tags, (v) => {
        this.properties.tags = v;
      });
      applyCategory(this, "Utility");
      this.size = [240, 110];
    }
    TaskSource.title = "Task Source";
    TaskSource.desc = "Seeds the graph with a task (entry point).";
    TaskSource.prototype.onExecute = function () {
      const task = {
        id: nextId("task"),
        instruction: this.properties.instruction || "",
        complexity: this.properties.complexity || "medium",
        tags: (this.properties.tags || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      this.setOutputData(0, task);
    };

    // ======================================================================
    // 3.1  Builder Agent — Context Assembler (Creational)
    // ======================================================================
    function BuilderAgent() {
      this.addInput("task", TYPES.TASK);
      this.addInput("fragment", TYPES.CONTEXT); // optional upstream bundle
      this.addOutput("context", TYPES.CONTEXT);
      this.addProperty("includeCodebase", true);
      this.addProperty("includeHistory", false);
      this.addProperty("constraints", "Return only a unified diff.");
      this.addWidget("toggle", "includeCodebase", this.properties.includeCodebase, (v) => {
        this.properties.includeCodebase = v;
      });
      this.addWidget("toggle", "includeHistory", this.properties.includeHistory, (v) => {
        this.properties.includeHistory = v;
      });
      this.addWidget("text", "constraints", this.properties.constraints, (v) => {
        this.properties.constraints = v;
      });
      applyCategory(this, "Creational");
      this.size = [250, 120];
    }
    BuilderAgent.title = "Builder Agent";
    BuilderAgent.desc = "Assembles a context bundle in inspectable stages.";
    BuilderAgent.prototype.onExecute = function () {
      const task = this.getInputData(0);
      if (!task) return; // required input absent
      const fragment = this.getInputData(1);

      const sections = [];
      let estTokens = 0;
      const parts = [];

      if (fragment && fragment.prompt) {
        sections.push("fragment");
        estTokens += fragment.estTokens || 0;
        parts.push(fragment.prompt);
      }
      if (this.properties.includeCodebase) {
        sections.push("codebase");
        estTokens += 1200;
        parts.push("[codebase structure]");
      }
      sections.push("instruction");
      estTokens += Math.ceil((task.instruction || "").length / 4) + 20;
      parts.push("INSTRUCTION: " + task.instruction);

      if (this.properties.includeHistory) {
        sections.push("history");
        estTokens += 400;
        parts.push("[conversation history]");
      }
      if (this.properties.constraints) {
        sections.push("constraints");
        estTokens += 60;
        parts.push("CONSTRAINTS: " + this.properties.constraints);
      }

      this.setOutputData(0, {
        taskId: task.id,
        prompt: parts.join("\n\n"),
        sections: sections,
        estTokens: estTokens,
      });
      this.boxcolor = "#9e9";
    };

    // ======================================================================
    // 3.2  Factory Agent — Dynamic Dispatcher (Creational)
    // ======================================================================
    function FactoryAgent() {
      this.addInput("task", TYPES.TASK);
      this.addOutput("agentref", TYPES.AGENTREF);
      this.addProperty("localCeiling", "medium");
      this.addProperty("localModel", "gemma-4-local");
      this.addProperty("cloudModel", "reasoning-cloud");
      this.addWidget(
        "combo",
        "localCeiling",
        this.properties.localCeiling,
        (v) => {
          this.properties.localCeiling = v;
        },
        { values: ["low", "medium", "high"] }
      );
      this.addWidget("text", "localModel", this.properties.localModel, (v) => {
        this.properties.localModel = v;
      });
      this.addWidget("text", "cloudModel", this.properties.cloudModel, (v) => {
        this.properties.cloudModel = v;
      });
      applyCategory(this, "Creational");
      this.size = [250, 110];
    }
    FactoryAgent.title = "Factory Agent";
    FactoryAgent.desc = "Selects a model/persona by matching tier to complexity.";
    FactoryAgent.prototype.onExecute = function () {
      const task = this.getInputData(0);
      if (!task) return;
      const taskRank = COMPLEXITY_RANK[task.complexity] ?? 1;
      const ceilRank = COMPLEXITY_RANK[this.properties.localCeiling] ?? 1;
      const local = taskRank <= ceilRank;
      this.setOutputData(0, {
        taskId: task.id,
        model: local ? this.properties.localModel : this.properties.cloudModel,
        tier: local ? "local" : "cloud",
        maxTokens: local ? 2048 : 8192,
      });
      this.boxcolor = local ? "#9e9" : "#fc6";
    };

    // ======================================================================
    // 3.4  Chain of Responsibility Agent — Escalation (Behavioral)
    //   (declared before Proxy only for readability; order is irrelevant)
    // ======================================================================
    function ChainOfResponsibilityAgent() {
      this.addInput("context", TYPES.CONTEXT);
      this.addInput("agentref", TYPES.AGENTREF);
      this.addOutput("resolved", TYPES.RESULT);
      this.addOutput("escalated", TYPES.RESULT);
      this.addProperty("confidenceThreshold", 0.7);
      this.addProperty("escalateModel", "reasoning-cloud");
      this.addWidget("number", "confidenceThreshold", this.properties.confidenceThreshold, (v) => {
        this.properties.confidenceThreshold = Math.max(0, Math.min(1, v));
      });
      this.addWidget("text", "escalateModel", this.properties.escalateModel, (v) => {
        this.properties.escalateModel = v;
      });
      applyCategory(this, "Behavioral");
      this.size = [260, 110];
    }
    ChainOfResponsibilityAgent.title = "Chain of Responsibility";
    ChainOfResponsibilityAgent.desc = "Runs a primary handler; escalates on low confidence.";
    ChainOfResponsibilityAgent.prototype.onExecute = function () {
      const ctx = this.getInputData(0);
      const ref = this.getInputData(1);
      if (!ctx || !ref) return;

      // Simulate handler 1: local/cheap tiers report lower confidence.
      const base = ref.tier === "local" ? 0.55 : 0.85;
      // Deterministic jitter from prompt length so reruns are stable-ish.
      const jitter = ((ctx.prompt || "").length % 20) / 100;
      const primaryConf = Math.min(0.99, base + jitter);

      const baseResult = {
        taskId: ctx.taskId,
        output: "[" + ref.model + "] handled: " + (ctx.prompt || "").slice(0, 40) + "…",
        confidence: Number(primaryConf.toFixed(2)),
        ok: true,
        trace: trace([], "handler:" + ref.model + " conf=" + primaryConf.toFixed(2)),
      };

      // reset both outputs each pass
      this.setOutputData(0, undefined);
      this.setOutputData(1, undefined);

      if (primaryConf >= this.properties.confidenceThreshold) {
        this.setOutputData(0, baseResult);
        this.boxcolor = "#9e9";
      } else {
        const escalatedConf = Math.min(0.99, primaryConf + 0.3);
        this.setOutputData(1, {
          taskId: ctx.taskId,
          output: "[" + this.properties.escalateModel + "] escalated: " + (ctx.prompt || "").slice(0, 40) + "…",
          confidence: Number(escalatedConf.toFixed(2)),
          ok: true,
          trace: trace(baseResult.trace, "escalated->" + this.properties.escalateModel + " conf=" + escalatedConf.toFixed(2)),
        });
        this.boxcolor = "#fc6";
      }
    };

    // ======================================================================
    // 3.3  Proxy Agent — Guardrail (Structural)
    // ======================================================================
    function ProxyAgent() {
      this.addInput("result", TYPES.RESULT);
      this.addOutput("approved", TYPES.RESULT);
      this.addOutput("rejected", TYPES.RESULT);
      this.addProperty("forbidden", "rm -rf,DROP TABLE,sudo");
      this.addProperty("minConfidence", 0.5);
      this.addWidget("text", "forbidden", this.properties.forbidden, (v) => {
        this.properties.forbidden = v;
      });
      this.addWidget("number", "minConfidence", this.properties.minConfidence, (v) => {
        this.properties.minConfidence = Math.max(0, Math.min(1, v));
      });
      applyCategory(this, "Structural");
      this.size = [250, 90];
    }
    ProxyAgent.title = "Proxy Agent";
    ProxyAgent.desc = "Guardrail: approves or rejects a result.";
    ProxyAgent.prototype.onExecute = function () {
      const result = this.getInputData(0);
      if (!result) return;

      this.setOutputData(0, undefined);
      this.setOutputData(1, undefined);

      const forbidden = (this.properties.forbidden || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const hit = forbidden.find((p) => (result.output || "").includes(p));
      const lowConf = result.confidence < this.properties.minConfidence;

      if (hit || lowConf) {
        const reason = hit ? "forbidden:" + hit : "low-confidence";
        this.setOutputData(1, Object.assign({}, result, {
          ok: false,
          trace: trace(result.trace, "proxy:REJECT(" + reason + ")"),
        }));
        this.boxcolor = "#e66";
      } else {
        this.setOutputData(0, Object.assign({}, result, {
          trace: trace(result.trace, "proxy:APPROVE"),
        }));
        this.boxcolor = "#9e9";
      }
    };

    // ======================================================================
    // 3.5  Utility · Inspector
    // ======================================================================
    function Inspector() {
      this.addInput("value", TYPES.ANY);
      this.addProperty("last", null);
      applyCategory(this, "Utility");
      this.size = [300, 140];
      this._lines = ["(waiting for input…)"];
    }
    Inspector.title = "Inspector";
    Inspector.desc = "Terminal sink — pretty-prints whatever it receives.";
    Inspector.prototype.onExecute = function () {
      const v = this.getInputData(0);
      if (v === undefined) return;
      this.properties.last = v;
      this._lines = JSON.stringify(v, null, 2).split("\n");
      // notify the side panel
      if (global.PatronApp && global.PatronApp.onInspect) {
        global.PatronApp.onInspect(this.id, v);
      }
    };
    Inspector.prototype.onDrawForeground = function (ctx) {
      if (this.flags.collapsed) return;
      ctx.save();
      ctx.font = "10px monospace";
      ctx.fillStyle = "#bdf";
      const maxLines = Math.floor((this.size[1] - 40) / 12);
      const lines = this._lines.slice(0, Math.max(1, maxLines));
      lines.forEach((ln, i) => {
        ctx.fillText(ln.slice(0, 46), 10, 40 + i * 12);
      });
      ctx.restore();
    };

    // --- registry ----------------------------------------------------------
    const REGISTRY = [
      ["patron/task_source", TaskSource],
      ["patron/builder", BuilderAgent],
      ["patron/factory", FactoryAgent],
      ["patron/chain_of_responsibility", ChainOfResponsibilityAgent],
      ["patron/proxy", ProxyAgent],
      ["patron/inspector", Inspector],
    ];
    REGISTRY.forEach(([path, ctor]) => LiteGraph.registerNodeType(path, ctor));

    return REGISTRY.map(([path]) => path);
  }

  global.PatronPatterns = { TYPES, CATEGORY_COLORS, register };
})(window);
