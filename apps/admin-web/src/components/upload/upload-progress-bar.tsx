/**
 * 上传内联进度条（upload 模块批B · 改动4，2026-09-10）
 *
 * 阶段拟真（对齐 upload-core upload-state.ts）：fetch 无上传字节流，
 * 展示阶段而非字节——uploading 中段 60%、done 100%。
 * 配合上层 onPhase 回调驱动，不误导为下载式精确进度。
 */

/** 上传进度条：progress 0-100，细条内联在上传位下方 */
export function UploadProgressBar({ progress }: { progress: number }) {
  return (
    <div
      aria-hidden
      className="h-1.5 w-full overflow-hidden rounded bg-muted"
      role="presentation"
    >
      <div
        className="h-full bg-primary transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}
