import { createImportSession, importToFigma } from "./importer.js";
import { postprocessMasterGoNodes } from "./postprocess.js";

let activeSession = createImportSession();

if (figma.command?.startsWith("postprocess:")) {
  const result = postprocessMasterGoNodes(figma.currentPage.selection, {
    cleanNames: figma.command !== "postprocess:keep-names",
    repairMasks: true
  });
  const errorCount = result.diagnostics.filter((item) => item.level === "error").length;
  const warnCount = result.diagnostics.filter((item) => item.level === "warn").length;
  figma.notify(`修复完成: 变更 ${result.changed} 处，警告 ${warnCount}，错误 ${errorCount}`);
  figma.commitUndo();
  figma.closePlugin();
} else {
  figma.showUI(__html__, { width: 360, height: 320 });

  figma.ui.onmessage = async (msg) => {
    if (msg.type === "import:reset-session") {
      activeSession = createImportSession();
      figma.ui.postMessage({
        type: "import:session-reset"
      });
    }

    if (msg.type === "import:start") {
      try {
        const result = await importToFigma({
          document: msg.payload.document,
          fontRuleSet: msg.payload.fontRuleSet ?? {},
          batch: msg.payload.batch ?? null,
          session: activeSession
        });

        figma.ui.postMessage({
          type: "import:result",
          payload: {
            createdCount: result.createdNodes.length,
            diagnostics: result.diagnostics,
            diffReport: result.diffReport,
            preflight: result.preflight,
            fontPreflight: result.fontPreflight,
            batch: result.batch
          }
        });
      } catch (error) {
        figma.ui.postMessage({
          type: "import:error",
          payload: {
            message: String(error?.message ?? error)
          }
        });
      }
    }

    if (msg.type === "close") {
      figma.closePlugin();
    }
  };
}
