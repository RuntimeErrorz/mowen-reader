import { FOLIATE_BRIDGE_PARTS } from './runtimeParts';

export const FOLIATE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline' blob:; connect-src blob: data:; frame-src blob:; script-src 'none';">
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body,foliate-view,foliate-paginator{margin:0;width:100%;height:100%;overflow:hidden}
html,body{background:#fff}
#reader-shell{position:fixed;inset:0;overflow:hidden}
#page-stage,#page-current,.page-preview{position:absolute;inset:0;overflow:hidden}
#page-stage{contain:layout paint;isolation:isolate}
#page-current,.page-preview{transform:translate3d(0,0,0);transition:none!important;backface-visibility:hidden}
#page-current{z-index:2}
.page-preview{z-index:1;pointer-events:none;contain:strict}
#page-preview-prev{transform:translate3d(-100%,0,0)}
#page-preview-next{transform:translate3d(100%,0,0)}
.bookmark-selection-handle{display:none;position:fixed;z-index:6;left:0;top:0;width:44px;height:52px;touch-action:none;user-select:none;-webkit-user-select:none;transform:translate3d(-100px,-100px,0)}
.bookmark-selection-handle.visible{display:block}
.bookmark-selection-handle::before{content:"";position:absolute;left:20px;top:5px;width:4px;height:22px;border-radius:2px;background:var(--accent)}
.bookmark-selection-handle::after{content:"";position:absolute;left:14px;top:23px;width:16px;height:16px;border:2px solid var(--bg);border-radius:50%;background:var(--accent);box-shadow:0 1px 4px rgba(0,0,0,.28)}
foliate-view,foliate-paginator{display:block}
foliate-view::part(head),foliate-view::part(foot){display:none}
#note-backdrop{display:none;position:fixed;z-index:2147483647;inset:0;background:rgba(0,0,0,.24);padding:18px;align-items:flex-end}
#note-backdrop.open{display:flex}
#note-card{position:relative;width:100%;max-height:58%;border-radius:16px;overflow:hidden;border:1px solid var(--line);background:var(--bg);box-shadow:0 12px 40px rgba(0,0,0,.25)}
#note-title{padding:15px 54px 10px 20px;color:var(--text);font-size:13px;line-height:1.45;font-weight:700;border-bottom:1px solid var(--line)}
#note-content{display:block;width:100%;max-width:100%;max-height:min(42vh,420px);padding:13px 20px 20px;overflow-x:hidden;overflow-y:auto;color:var(--text);font-size:16px;line-height:1.65;overflow-wrap:anywhere;word-break:break-word}
#note-content article{display:block;width:100%;max-width:100%;min-width:0}
#note-content article *{box-sizing:border-box!important;max-width:100%!important;min-width:0!important;color:inherit!important;font-size:inherit!important;line-height:inherit!important}
#note-content article :is(sup,sub){font-size:.75em!important;line-height:0!important}
#note-content p,#note-content div,#note-content li,#note-content blockquote,#note-content dd,#note-content dt{width:auto!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:break-word!important}
#note-content p{margin:0 0 .8em}
#note-content pre,#note-content code{white-space:pre-wrap!important;overflow-wrap:anywhere!important;word-break:break-word!important}
#note-content table{display:table!important;width:100%!important;table-layout:fixed!important;border-collapse:collapse}
#note-content th,#note-content td{width:auto!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:break-word!important}
#note-content img,#note-content svg,#note-content video{display:block;max-width:100%!important;width:auto!important;height:auto!important;margin-inline:auto}
#note-content article a{color:var(--accent)!important}
#note-close{position:absolute;z-index:2;right:8px;top:8px;width:34px;height:34px;border:0;border-radius:17px;background:var(--bg);color:var(--muted);font-size:22px}
#image-viewer{display:none;position:fixed;z-index:2147483646;inset:0;background:#000;align-items:center;justify-content:center;touch-action:none;user-select:none;-webkit-user-select:none}
#image-viewer.open{display:flex}
#image-viewer-surface{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none}
#image-viewer-image{display:block;max-width:90vw;max-height:80vh;width:auto;height:auto;object-fit:contain;transform-origin:center center;touch-action:none;user-select:none;-webkit-user-drag:none}
#image-viewer-toolbar{position:absolute;z-index:2;top:calc(env(safe-area-inset-top,0px) + 12px);right:14px;display:flex;gap:8px}
#image-viewer-toolbar button{min-width:42px;height:42px;border:0;padding:0;background:transparent;color:#fff;font-size:28px;line-height:42px}
  </style></head><body><div id="reader-shell"><div id="page-stage"><div id="page-preview-prev" class="page-preview"></div><div id="page-current"></div><div id="page-preview-next" class="page-preview"></div></div></div><div id="bookmark-selection-handle-start" class="bookmark-selection-handle" data-endpoint="start" aria-hidden="true"></div><div id="bookmark-selection-handle-end" class="bookmark-selection-handle" data-endpoint="end" aria-hidden="true"></div><div id="note-backdrop"><div id="note-card"><button id="note-close" aria-label="关闭">×</button><div id="note-title">注释</div><div id="note-content"></div></div></div><div id="image-viewer" aria-hidden="true"><div id="image-viewer-surface"><img id="image-viewer-image" alt="正文图片" draggable="false"><div id="image-viewer-toolbar"><button id="image-viewer-close" type="button" aria-label="关闭图片">×</button></div></div></div></body></html>`;
export const FOLIATE_BRIDGE = FOLIATE_BRIDGE_PARTS.join('');

