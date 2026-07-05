/*
 * menu.js — Patron's pull-down menu model (consumed by MenuBar, see js/MenuBar.js).
 *
 * Mirrors noted's data-driven menu.json, but defined inline as a JS global so it
 * works both under serve.py AND over file:// (a fetch of a local .json fails on
 * file://, which would leave the menubar empty). Commands are wired to Patron's
 * app functions in app.js (registerCommand). Keep command ids in sync there.
 *
 * Structure per specs/menu_revision.md: Project · Edit · Insert · Build · View · Help.
 * (Per-block management is NOT here — it's a double-click on the block.)
 */
window.PATRON_MENU = [
  {
    label: "Project",
    key: "P",
    items: [
      { label: "New Project", shortcut: "Ctrl+N", command: "project.new" },
      { label: "Open Project…", shortcut: "Ctrl+O", command: "project.open" },
      { label: "Close Project", shortcut: "Ctrl+W", command: "project.close" },
      { type: "separator" },
      { label: "Save", shortcut: "Ctrl+S", command: "project.save" },
      { label: "Save As…", shortcut: "Ctrl+Shift+S", command: "project.saveAs" },
      { label: "Rename…", command: "project.rename" },
      { label: "Project Settings…", command: "project.settings" },
      { type: "separator" },
      { label: "Delete Project…", command: "project.delete" },
      { type: "separator" },
      { label: "Import…", command: "project.import" },
      { label: "Export…", command: "project.export" },
    ],
  },
  {
    label: "Edit",
    key: "E",
    items: [
      { label: "Undo", shortcut: "Ctrl+Z", command: "edit.undo" },
      { label: "Redo", shortcut: "Ctrl+Shift+Z", command: "edit.redo" },
      { type: "separator" },
      { label: "Cut", shortcut: "Ctrl+X", command: "edit.cut" },
      { label: "Copy", shortcut: "Ctrl+C", command: "edit.copy" },
      { label: "Paste", shortcut: "Ctrl+V", command: "edit.paste" },
      { label: "Duplicate", shortcut: "Ctrl+D", command: "edit.duplicate" },
      { label: "Delete Selection", shortcut: "Delete", command: "edit.delete" },
      { label: "Select All", shortcut: "Ctrl+A", command: "edit.selectAll" },
      { type: "separator" },
      { label: "Clear Canvas", command: "edit.clear" },
    ],
  },
  {
    label: "Insert",
    key: "I",
    items: [
      { label: "Initiators", submenu: [
        { label: "Scheduler", command: "insert.trigger" },
        { label: "File Initiator", command: "insert.file_initiator" },
        { label: "Web Initiator", command: "insert.web_initiator" },
        { label: "Speech-to-Text", command: "insert.stt_initiator" },
        { label: "Text Send", command: "insert.console_send" },
      ]},
      { label: "Blocks", submenu: [
        { label: "Agent", command: "insert.agent" },
        { label: "Vector Database", command: "insert.vector_query" },
        { label: "Graph Database", command: "insert.graph_query" },
        { label: "JSON", command: "insert.data" },
        { label: "Data Transform", command: "insert.transform" },
        { label: "Workflow", command: "insert.composite" },
      ]},
      { label: "Destinations", submenu: [
        { label: "WhatsApp", command: "insert.whatsapp" },
        { label: "Text-to-Speech", command: "insert.tts" },
        { label: "Event Bus", command: "insert.bus" },
        { label: "Text Receive", command: "insert.console_receive" },
        { label: "File Destination", command: "insert.file_destination" },
        { label: "Web Destination", command: "insert.web_destination" },
      ]},
    ],
  },
  {
    label: "Build",
    key: "B",
    items: [
      // Validate + Deployment Status were removed — the live deploy-status badge (bottom-left)
      // now shows compile-readiness and deploy state continuously (see js/status-badge.js).
      { label: "Deploy", shortcut: "Ctrl+Enter", command: "build.deploy" },
      { label: "Undeploy", command: "build.undeploy" },
      { label: "Delete Deployment…", command: "build.deleteDeployment" },
      { type: "separator" },
      { label: "Compile to DSL", command: "build.compile" },
    ],
  },
  {
    label: "Run",
    key: "R",
    items: [
      // VS Code-style debugger, adapted to a flat workflow graph (one "Step" — no call depth for
      // Over/Into/Out). Commands wired in app.js → window.PatronDebug (js/debug-controls.js).
      // Shortcuts avoid the browser-reserved F5 family (reload) / F11 (fullscreen) / F12 (devtools):
      // F8 is the "go" key (Start when idle, Continue when paused — VS Code F5 style), F9/F10 free.
      { label: "Start Debugging", shortcut: "F8", command: "run.start" },
      { label: "Run Without Debugging", shortcut: "Ctrl+F8", command: "run.runNoDebug" },
      { label: "Stop Debugging", shortcut: "Shift+F8", command: "run.stop", enabled: "debugging" },
      { label: "Restart Debugging", shortcut: "Ctrl+Shift+F8", command: "run.restart", enabled: "debugging" },
      { type: "separator" },
      { label: "Continue", command: "run.continue", enabled: "paused" },   // F8 resumes when paused
      { label: "Step", shortcut: "F10", command: "run.step", enabled: "paused" },
      { type: "separator" },
      { label: "Toggle Breakpoint", shortcut: "F9", command: "run.toggleBreakpoint" },
      { label: "Enable All Breakpoints", command: "run.enableAllBreakpoints" },
      { label: "Disable All Breakpoints", command: "run.disableAllBreakpoints" },
      { label: "Remove All Breakpoints", command: "run.removeAllBreakpoints" },
    ],
  },
  {
    label: "View",
    key: "V",
    items: [
      { label: "Toolbox", command: "view.toolbox", type: "checkbox", checked: "toolboxVisible" },
      { label: "Output Panel", command: "view.output", type: "checkbox", checked: "outputVisible" },
      { label: "Debug", command: "view.trace", type: "checkbox", checked: "traceVisible" },
      { label: "Canvas Controls", command: "view.controls", type: "checkbox", checked: "controlsVisible" },
      { type: "separator" },
      // Both themes shown; a checkbox marks the active one.
      { label: "Dark Theme", command: "theme.dark", type: "checkbox", checked: "isDark" },
      { label: "White Theme", command: "theme.white", type: "checkbox", checked: "isLight" },
    ],
  },
  {
    label: "Help",
    key: "H",
    items: [
      { label: "Documentation…", command: "help.docs" },
      { label: "Keyboard Shortcuts…", command: "help.shortcuts" },
      { type: "separator" },
      { label: "About Patron", command: "help.about" },
    ],
  },
];
