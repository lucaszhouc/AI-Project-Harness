function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createReportedError(error, errorId) {
  const reported = new Error(`${errorMessage(error)}\n错误编号：${errorId}`);
  if (error instanceof Error && error.stack) reported.stack = `${reported.stack}\nCaused by: ${error.stack}`;
  return reported;
}

function createOnboardingIpcHandler({ onboardProject, errorLog }) {
  return async function handleOnboarding(event, rawName) {
    let currentStage = "starting";
    const onProgress = (progress) => {
      currentStage = progress.stage || currentStage;
      if (event.sender?.isDestroyed?.()) return;
      event.sender?.send?.("project:onboarding-progress", progress);
    };

    try {
      const result = await onboardProject(rawName, { onProgress });
      if (result?.desktopOpened === false) {
        const warningMessage = "项目已经准备好，但 Codex 没有自动打开。你可以再试一次。";
        let errorId;
        try {
          const record = errorLog.capture(new Error(result.desktopError || warningMessage), {
            operation: "codex:open-desktop",
            stage: "opening_codex_desktop",
            context: { queryLength: String(rawName || "").length },
          });
          errorId = record.id;
        } catch {
          // The Codex task already exists; keep the partial success recoverable even if diagnostics fail.
        }
        return {
          ...result,
          desktopWarning: { message: warningMessage, ...(errorId ? { errorId } : {}) },
        };
      }
      if (result?.desktopProjectRestartRequired) {
        return {
          ...result,
          desktopProjectWarning: result.desktopProjectWarning
            || "连接已经完成。请彻底退出 Codex Desktop 后重新打开，确认项目是否出现在侧栏。",
        };
      }
      return result;
    } catch (error) {
      let record;
      try {
        record = errorLog.capture(error, {
          operation: "project:add-by-name",
          stage: currentStage,
          context: { queryLength: String(rawName || "").length },
        });
      } catch {
        throw new Error(`${errorMessage(error)}\n错误日志写入失败，请检查磁盘空间或目录权限。`);
      }
      throw createReportedError(error, record.id);
    }
  };
}

module.exports = { createOnboardingIpcHandler, createReportedError, errorMessage };
