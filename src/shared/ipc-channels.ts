// Centralized list of IPC channel names. Keeping these as constants prevents
// silent renames and lets us share types between main and renderer.

export const IPC = {
  // Renderer → Main (invoke / call-and-respond)
  GetSettings: "settings:get",
  UpdateSettings: "settings:update",
  GetDisplays: "displays:get",
  GetCursorScreenPoint: "cursor:get-screen-point",
  SaveDrawing: "drawing:save",
  LoadDrawing: "drawing:load",
  ExportImage: "drawing:export-image",
  ExportSvg: "drawing:export-svg",
  GetCaptureSources: "capture:sources",

  // Recording controls
  RecordStart: "record:start",
  RecordStop: "record:stop",
  RecordPause: "record:pause",
  RecordResume: "record:resume",
  RecordCaptureFailed: "record:capture-failed",
  RecordSaveBlob: "record:save-blob", // renderer pushes encoded blob bytes

  // Toolbar ↔ Overlay coordination
  ToolbarSetTool: "toolbar:set-tool",
  ToolbarSetStyle: "toolbar:set-style",
  ToolbarUndo: "toolbar:undo",
  ToolbarRedo: "toolbar:redo",
  ToolbarClear: "toolbar:clear",
  ToolbarExport: "toolbar:export",
  ToolbarToggleVisible: "toolbar:toggle-visible",
  ToolbarSetVisibleBounds: "toolbar:set-visible-bounds",
  OverlaySetPointerOverToolbar: "overlay:set-pointer-over-toolbar",

  // Main → Renderer (broadcast / subscribe)
  OnVisibilityChange: "overlay:visibility-change",
  OnToolChange: "overlay:tool-change",
  OnStyleChange: "overlay:style-change",
  OnToolbarBoundsChange: "overlay:toolbar-bounds-change",
  OnHistoryAction: "overlay:history-action",
  OnExportRequest: "overlay:export-request",
  OnRecorderStatus: "recorder:status",
  OnSettingsChange: "settings:change",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
