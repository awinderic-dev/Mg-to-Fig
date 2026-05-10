import { importToFigma } from "./importer.js";

figma.showUI(__html__, { width: 360, height: 320 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === "import:start") {
    try {
      const result = await importToFigma({
        document: msg.payload.document,
        fontRuleSet: msg.payload.fontRuleSet ?? {},
        batch: msg.payload.batch ?? null
      });

      figma.ui.postMessage({
        type: "import:result",
        payload: {
          createdCount: result.createdNodes.length,
          diagnostics: result.diagnostics,
          diffReport: result.diffReport,
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
