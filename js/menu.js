/*
 * menu.js — Patron's pull-down menu model (consumed by MenuBar, see js/MenuBar.js).
 *
 * Mirrors noted's data-driven menu.json, but defined inline as a JS global so it
 * works both under serve.py AND over file:// (a fetch of a local .json fails on
 * file://, which would leave the menubar empty). Commands are wired to Patron's
 * app functions in app.js (registerCommand). Keep command ids in sync there.
 */
window.PATRON_MENU = [
  {
    label: "File",
    key: "F",
    items: [
      { label: "New / Clear Canvas", command: "file.clear" },
      { type: "separator" },
      { label: "Load News Agent", command: "file.news" },
      { type: "separator" },
      { label: "Save Workspace", shortcut: "Ctrl+S", command: "file.save" },
      { label: "Load Workspace", command: "file.load" },
    ],
  },
  {
    label: "Build",
    key: "B",
    items: [
      { label: "Compile → DSL", command: "build.compile" },
      { label: "Deploy to Runtime", command: "build.deploy" },
    ],
  },
  {
    label: "View",
    key: "V",
    items: [
      { label: "Toolbox", command: "view.toolbox", type: "checkbox", checked: "toolboxVisible" },
      { label: "Output Panel", command: "view.output", type: "checkbox", checked: "outputVisible" },
      { label: "Properties Panel", command: "view.properties", type: "checkbox", checked: "propsVisible" },
      { label: "Zoom Control", command: "view.zoom", type: "checkbox", checked: "zoomVisible" },
      { type: "separator" },
      // One switching option (not a checkbox): only the item matching the
      // current theme's opposite is visible, so the label flips between the two.
      { label: "Dark Theme", command: "view.theme", when: "isLight" },
      { label: "White Theme", command: "view.theme", when: "isDark" },
    ],
  },
  {
    label: "Help",
    key: "H",
    items: [
      { label: "About Patron", command: "help.about" },
    ],
  },
];
