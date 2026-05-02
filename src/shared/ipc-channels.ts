// Centralized list of IPC channel names. Keeping these as constants prevents
// silent renames and lets us share types between main and renderer.

export const IPC = {
  // Renderer → Main (invoke / call-and-respond)
  GetSettings: "settings:get",
  UpdateSettings: "settings:update",
  GetDisplays: "displays:get",
  SaveDrawing: "drawing:save",
  LoadDrawing: "drawing:load",
  ExportImage: "drawing:export-image",
  GetCaptureSources: "capture:sources",

  // Recording controls
  RecordStart: "record:start",
  RecordStop: "record:stop",
  RecordPause: "record:pause",
  RecordResume: "record:resume",
  RecordEncodeGif: "record:encode-gif",
  RecordSaveBlob: "record:save-blob", // renderer pushes encoded blob bytes

  // Toolbar ↔ Overlay coordination
  ToolbarSetTool: "toolbar:set-tool",
  ToolbarSetStyle: "toolbar:set-style",
  ToolbarUndo: "toolbar:undo",
  ToolbarRedo: "toolbar:redo",
  ToolbarClear: "toolbar:clear",
  ToolbarToggleVisible: "toolbar:toggle-visible",
  ToolbarResize: "toolbar:resize",

  // Main → Renderer (broadcast / subscribe)
  OnVisibilityChange: "overlay:visibility-change",
  OnToolChange: "overlay:tool-change",
  OnStyleChange: "overlay:style-change",
  OnHistoryAction: "overlay:history-action",
  OnRecorderStatus: "recorder:status",
  OnSettingsChange: "settings:change",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
