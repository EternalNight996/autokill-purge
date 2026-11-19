// web/ops/contract.mjs —— 「补齐 dsh-purge 能力面」的统一契约（v1）
//
// 每个能力一个文件：web/ops/<id>.mjs，必须导出三样：
//   export const META = { id, zh, en, kind: 'read'|'write'|'both', requires: string[], note?: string }
//   export async function status(ctx)  -> { ok:boolean, available:boolean, summary:string, detail?:any }
//   export async function run(ctx, opts = {}) -> { ok:boolean, changed:boolean, summary:string, detail?:any }
//   （可选）export async function plan(ctx, opts) -> 只读计划，run 前给用户看
//
// ctx 由 web/ops/index.mjs 注入：
//   {
//     dataDir,            // F:/.../autokill-purge/data
//     dshHome,            // C:/Users/<u>/.dsh
//     resourcesDir,       // .../Programs/DeepSeek Harness/resources
//     appDir,             // .../resources/app
//     asarPath,           // .../resources/app.asar（可能已改名让位）
//     desktopExe,
//     log(msg),           // 写 data/ops.log
//     now(),              // ISO 时间
//   }
//
// 纪律：
//   1) status() 只读，不许写盘、不许起进程、不许杀进程。
//   2) run() 必须幂等；重复跑结果一致。
//   3) 任何改宿主的动作先落快照（ctx.snapshot(tag) 已注入）。
//   4) 报错不要抛裸异常给路由：run() 自己 catch，返回 { ok:false, error }。

export const OPS_CONTRACT = 1;

/** 统一的结果归一：缺字段时补默认，避免前端各处判空。 */
export function normalizeResult(kind, value) {
  const v = value && typeof value === 'object' ? value : {};
  if (kind === 'status') {
    return {
      ok: v.ok !== false,
      available: v.available !== false,
      summary: String(v.summary || ''),
      detail: v.detail === undefined ? null : v.detail,
    };
  }
  return {
    ok: v.ok !== false,
    changed: v.changed === true,
    summary: String(v.summary || ''),
    detail: v.detail === undefined ? null : v.detail,
    error: v.error ? String(v.error) : null,
  };
}
