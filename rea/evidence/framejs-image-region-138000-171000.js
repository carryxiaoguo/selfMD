+n+v.tempString()+t).replace(/^\-/,"")}
async function _(e){
var t=v.tempString(),n=File.isWin?"\\":"/",n=File.option.userDataPath+n+"runtime-storage"+n+t;
return e&&File.option.userDataPath?File.isNode?async function(e,t){
var n=reqnode("fs-extra");
try{
await n.copy(e,t)}
catch(e){
return console.warn("failed to write temp image data",e),""}
return t}
(e,n):File.isMac&&await JSBridge.invoke("path.copyFile",{
from:e,to:n}
)?n:void 0:""}
function A(e,t,n,l,r){
var i,o=u.applyUploadingStyle;
return e.length&&(i=e.find("img")[0],loadedImgCache.remove(v.wkfile2file(i.getAttribute("src")||"")),i.onload=null),this.editor.brush.clearAndPause(!0),window.moveImageQueue.add(n),o(e,n,!0,!0),this.editor.brush.resume(),(File.isMac?function(e,i){
if(i=i.replace(/^file:\/\//,""),!/^\w+:/.exec(i))try{
i=decodeURI(i)}
catch(e){
}
return new Promise(function(t,n){
bridge.callHandler("images.copyImage",{
src:i,folder:e,fileNameDefined:l||!1,ignoreAlert:r||!1}
,function(e){
(e.success?t:n)(e.msg)}
)}
)}
:function(a,s){
return new Promise(function(d,u){
var h=reqnode("fs-extra"),n=null;
function i(e,t,n){
var i,a,s,l,c,r;
if(/^(http(s?))|(ftp):\/\//.exec(e))i=e,a=t,s=d,l=u,c=n,o=(r=reqnode("path")).dirname(a),r=r.basename(c?a:T(a)),JSBridge.invoke("app.download",i,o,r).then(({
path:n,state:e,type:t}
)=>{
var i=reqnode("fs"),r="";
function o(){
var e,t;
r&&".jpg"!=(t=(e=reqnode("path")).parse(a)).ext&&(a=e.join(t.dir,t.name+"."+r)),i.rename(n,a,e=>{
e?console.sendError(e):n=a,s(n)}
)}
t&&-1<t.indexOf("image/")&&(r=t.substr("image/".length)),"completed"==e?c?n!=a?o():s(n):i.access(a,i.F_OK,function(e){
e?o():s(n)}
):(console.error(e),l(e?"Image download "+e:"unknown error for image download"))}
);
else if(i=/^data:image\/[^;
]+;
base64,/.exec(e)){
var o=decodeURI(e.substr(i[0].length));
try{
o=decodeURI(o)}
catch(e){
}
h.writeFile(t,o,"base64",function(e){
if(e)return u("Failed to copy image\n."+e.message);
d(t)}
)}
else{
try{
e=decodeURI(e)}
catch(e){
}
h.copy(e,t,{
overwrite:n}
,function(e){
if(e)return u("Failed to copy image\n."+(e.message||e));
d(t)}
)}
}
function r(t,n){
h.access(n,h.F_OK,function(e){
e||(n=T(n)),i(t,n,!1)}
)}
var e,t,o=File.isWin?"\\":"/";
if(l)i(s,n=a,!0);
else{
if(/^data:/.exec(s)){
if(!(e=(/^data:image\/([^;
]+);
base64,/.exec(s)||[])[1]))return d(s);
e=v.removeInvalidPathCh(((t=new Date).setHours(t.getHours()-t.getTimezoneOffset()/60),(t=t.toUTCString()).substr(0,t.length-4)+"."+e))}
else e=b.getFileNameFromPath(s),e=v.removeInvalidPathCh(e.replace(/\?([^./]*)$/,""));
a=(a+o).replace(/[\/\\]{
2}
$/,o),n=a+e,window.imageDownloadMap[n]&&window.imageDownloadMap[n]!=s?n=T(n):window.imageDownloadMap[n]=s,/^(https?|ftp):/.exec(s)?r(s,n):h.stat(s,(e,t)=>{
e?u("Failed to copy image\n."+(e.message||e)):t&&t.isFile()?r(s,n):u("Failed to copy image\n. Image src is not a file")}
)}
}
)}
).call(this,t,n).then(function(t){
return t?(a.recordMediaMoves(t),_(t).then(e=>[t,e])):[]}
,function(){
E(n)}
)}
function M(e,t){
if("picgo-app"!=t&&"piclist-app"!=t){
for(var t=e,n=t.split(/\r?\n/),i=(console.sendLog("[Upload Result] "+t),[]),r=n.length-1;
0<=r;
r--){
var o=n[r].trim();
if(o)if(/^(https?|ftp|file):\//.exec(o))i.unshift(o);
else if(/^[a-z0-9]+([\-\.]{
1}
[a-z0-9]+)*\.[a-z]{
2,5}
\/.*$/.exec(o))i.unshift("http://"+o);
else if(i.length)break}
return i}
t=e;
try{
var a=JSON.parse(t);
return a.success?a.result:[]}
catch(e){
return[]}
}
function $(e,t){
return this.editor.brush.pause(),t=v.absolutePathFrom(t),window.uploadImageQueue.add(t),u.applyUploadingStyle(e,t,!1),this.editor.brush.resume(),function(e){
var t=this;
return new Promise(function(n,i){
var r;
File.isMac?(r=t.getImageUploader(),bridge.callHandler("images.upload",{
command:t.getImageUploaderCommand(r),file:e}
,function(e){
var t;
e.success?"ipic"==r?n(e.msg):(t=M(e.msg,r))[t.length-1]?n(t[t.length-1]):i(e.msg):i(e.msg)}
)):File.isNode?L.call(t,[e]).then(e=>{
n(e[0])}
).catch(i):i()}
)}
.call(this,t)}
function L(o){
var n,a,s,l,c=this.getImageUploaderCommand();
return c?((n="picgo-app"==c||"piclist-app"==c)?(a=c,s=File.option.picgoAppPath,l=File.option.piclistAppPath,"picgo-app"!==a||s?"piclist-app"!==a||l?function t(n){
return window.fetch("http://127.0.0.1:36677/upload",{
method:"POST",body:JSON.stringify({
list:o}
)}
).then(function(e){
return 200===e.status?e.json().then(e=>e.success?(console.sendLog("[Upload Result] "+JSON.stringify(e.result)),e.result):Promise.reject(JSON.stringify(e))):Promise.reject(e.text())}
,function(e){
return n?Promise.reject(e.message||"failed"):new Promise(function(e,i){
var r=setTimeout(()=>{
t(!(r=null)).then(e,i)}
,5e3);
window.reqnode("child_process").exec(JSON.stringify("piclist-app"===a?l:s),(e,t,n)=>{
r&&e&&(i("failed to launch PicGo app: "+e.message),clearTimeout(r))}
)}
)}
)}
(!1):Promise.reject("请在偏好设置中配置 PicList (app) 的路径。"):Promise.reject("请在偏好设置中配置 PicGo (app) 的路径。")):new Promise((i,r)=>{
reqnode("child_process").exec(c+" "+v.escapeShell(o),{
maxBuffer:2097152}
,(e,t,n)=>{
e?(console.warn("exec error: "+e),r(e)):t?i(t):(console.warn("error: "+n),r(n))}
)}
)).then(e=>{
var t=n?e:M(e,c);
return t.length==o.length?Promise.resolve(t):(console.log(e),Promise.reject("fail to parse result image path from: "+e))}
):Promise.reject("Upload command not found.")}
function N(e,s,t){
var l,c,d,n=s,u=(s=this.resolveImagePath(s),this.editor);
return u.undo.endSnap(!0),e.each(function(e,t){
var n,i,r,o,a;
t&&((n=t.querySelector(".md-content"))?(d||(l=u.selection.getRangy(),c=u.selection.buildUndo(l),d=m.makeEmptyCommand(c)),o=n.textContent,i=(t.getAttribute("md-inline")==p.imgtag?S:F)(o,s),r=h.extend({
}
,c),o=i.length-o.length,a=u.findNodeByElem(h(t).closest("[cid]")),u.undo.endSnap(!0),t=t.querySelector(".md-content"),l&&t&&l.comparePoint&&l.comparePoint(t,1)<0&&(r.start+=o),l&&t&&l.comparePoint&&l.comparePoint(t,2)<0&&(r.end+=o),d.undo.push(m.buildReplaceUndo(a)),n.textContent=i,u.store(a,!0),t=u.findElemById(a.cid),u.brush.brushNode(a.cid),t.removeClass("md-expand"),u.undo.exeCommand(r),(l=u.selection.getRangy())&&h(l.commonAncestorContainer).closest(".md-image").length&&(r=u.imgEdit.selectComponent("alt",!0)),d.redo.push(m.buildReplaceUndo(a)),d.redo.push(r)):r=this.editor.selection.buildUndo())}
),d&&!t&&((e=u.undo.lastRegisteredOperationCommand())&&e.src===n?m.append(e,d):u.undo.register(d)),d}
async function D(e,t,n,i,r){
e&&n&&t!=n&&(e.undo.push({
type:"deleteMedia",from:n}
),e.redo.unshift({
type:"restoreMedia",from:i,to:n}
),r&&x(t)&&await File.editor.imgEdit.deleteMedia(t,!0,e,i),File.isTextPack())&&x(n)}
function P(r,e,o,t,n,a){
var s=this;
r&&r.length&&o&&A.call(this,r,e,o,t,!1).then(function(e){
var t,n,i;
e&&(t=e[0],e=e[1],void 0!==t)&&(r=E(o),C(t,o,r.find("img")[0]),n=N.call(s,r,t,File.isTextBundle()||File.isTextPack()),(File.isTextBundle()||File.isTextPack())&&((i=s.editor.undo.lastRegisteredOperationCommand())&&i.src===o?m.append(i,n):s.editor.undo.register(n)),D(n,o,t,e,a))}
,function(e){
r=E(o),e&&console.error(e),e&&!n&&setTimeout(function(){
y.showNotification(h.localize.getString("Failed to Copy Image to Target Folder.")+" <code>"+v.escape(e)+"</code>",!0)}
,500)}
)}
window.imgLastModified=Math.floor(+new Date/1e3),window.uploadImageQueue=new Set,window.moveImageQueue=new Set,window.imagePreLoadAfterMove={
}
,window.imageDownloadMap={
}
;
function H(e){
return!/^\s*(https?):/.exec(e)}
var B={
}
;
t.exports=class{
constructor(i){
var t=this;
function n(){
File.editor.contextMenu.hide(),File.editor.contextMenu.restoreLastCursor()}
this.removeUploadingStyle=k,this.editor=i,this.uniqueFilePathOnNode=T,h(i.sessionStr).on("mousemove",".md-image>.md-meta",function(e){
fastdom.measure(function(){
e.offsetX-e.target.offsetLeft<20&&e.offsetY<30?this.nextElementSibling&&this.nextElementSibling.getAttribute("src").trim().length&&fastdom.mutate(function(){
this.classList.add("md-show-hint")}
,this):fastdom.mutate(function(){
this.classList.remove("md-show-hint")}
,this)}
,this)}
).on("mouseleave",".md-image>.md-meta",function(){
fastdom.mutate(function(){
this.classList.remove("md-show-hint")}
,this)}
).on("click","img",function(e){
var t,n=h(e.target).closest(".md-image").addClass("md-expand");
n.length&&(t=O.createRange(),n.attr("md-inline")==p.imgtag?t.selectNodeContents(n.find(".md-meta")[0]):t.moveToBookmark({
containerNode:n.children(".md-meta")[0],start:2,end:2+(e.target.getAttribute("alt")||"").length}
),i.selection.setRange(t,!0))}
).on("btn-action",".md-image-input-src-btn",function(e){
h("#ty-tooltip").hide();
var t=document.createRange();
t.setStart(this.parentElement,0),t.setEnd(this.parentElement,0),h(this).remove(),i.selection.setRange(t,!0)}
).on("click btn-action",".md-image-pick-file-btn",function(e){
return h("#ty-tooltip").hide(),t.insertLocalImage(),!1}
).on("cursorChange",function(e,t){
t&&-1!=t.style.inline.indexOf("image")||!document.querySelector("#user-context-menu.show")||i.contextMenu.hide("#user-context-menu")}
),h(".context-menu").on("click","[data-key='select-img-target'] a",function(){
n(),t.copyToSelectedFolderAction()}
).on("click","[data-key='select-img-target-move'] a",function(){
n(),t.copyToSelectedFolderAction(!0)}
).on("click","[data-key='delete-img'] a",function(){
n(),t.deleteImageAction(!1)}
).on("click","[data-key='delete-img-file'] a",function(){
n(),t.deleteImageAction(!0)}
).on("click","[data-key='upload-img'] a",function(){
n(),t.uploadAction()}
).on("click","[data-key='copy-img-to-target'] a",function(){
n(),t.copyToTargetFolderAction()}
).on("click","[data-key='move-img-to-target'] a",function(){
n(),t.copyToTargetFolderAction(!0)}
).on("click","[data-key='copy-img'] a",function(){
n(),t.copyImage()}
).on("click","[data-key='reveal-img-in-finder'] a",function(){
n(),t.revealInFinder()}
).on("click","[data-key='reveal-img-in-browser'] a",function(){
n(),t.revealInFinder()}
).on("click","[data-key='zoom-smart'] a",function(){
n();
var e=h(".md-expand.md-img-loaded");
e&&t.zoomAction(e,this.getAttribute("data-variable"))}
).on("click","[data-key='zoom-img'] a",function(){
h(this.parentElement).trigger("mouseenter")}
),this.registerBridge()}
registerBridge(){
var i;
File.isMac&&(i=this,bridge.registerHandler("images.fetchImageLocalStorageFolder",function(e,t){
t(i.getTargetImageStorageFolder()||null)}
),bridge.registerHandler("images.allImageUploadCallback",function(e,t){
i.allImageUploadCallbackForMac(e.command,e.success,e.message,e.updateMap,e.sources),t&&t()}
),bridge.registerHandler("images.tagetImageStorageFolderExcludeSetting",function(e,t){
t&&t(i.getTargetImageStorageFolder(!0))}
),bridge.registerHandler("images.doSetImageCopyToFolder",function(e,t){
i.doSetImageCopyToFolder(e),t&&t()}
),bridge.registerHandler("images.doSetImageCopyToIPic",function(e,t){
i.doSetImageCopyToFolder("upload",!0),t&&t()}
),bridge.registerHandler("images.doRemoveImageCopyToFolder",function(e,t){
i.doRemoveImageCopyToFolder(),t&&t()}
),bridge.registerHandler("images.doSetImageRootPath",function(e,t){
i.doSetImageRootPath(e),t&&t()}
),bridge.registerHandler("images.prepareUploadAllImagesOnMac",function(e,t){
i.prepareUploadAllImagesOnMac(t)}
),bridge.registerHandler("images.insertImage",function(e,t){
e=a.insertURL(e);
t&&t(e)}
),bridge.registerHandler("images.zoomImage",function(e,t){
e=i.zoomAction(null,e);
t&&t(e)}
),bridge.registerHandler("images.switchSyntax",function(e,t){
i.switchPattern(null,e)}
),bridge.registerHandler("images.copyAllImages",function([e,t],n){
i._copyAllImages(e,t),n&&n()}
))}
getLocalRootUrlForInsert(){
return this.editor.docMenu.getLocalRootUrl()||File.option.useRelativePathForImg&&b.getCurrentFileFolderPath()||""}
getSrcFromDom(e,t){
return e?e.dataset.isDataSrc&&e.querySelector("img")?e.querySelector("img").getAttribute("src"):t?this.getAbsolutePath(e.dataset.src):e.dataset.src:""}
getAbsolutePath(e,t){
if(!e)return e;
e=v.absolutePathFrom(this.getRealSrc(e));
if(t){
if(!/^[a-z]+:/i.exec(e))return"file://"+e}
else/^https?:/.exec(e)&&!/^data?:/.exec(e)&&!/^file?:/.exec(e)||(e=v.decodeFromEscapedURL(e));
return e}
getRealSrc(e,t,n,r){
if(e){
e=v.decodeFromEscapedPath(e);
var i,o,a,s,l,c,d=(/#[^.\/\\]+$/.exec(e)||[])[0]||"";
if(!/^data:/.exec(e)){
if(/^\/\//.exec(e))return"http:"+e;
try{
return/^(file|ftp|https?):(\/\/|\\\\)/gi.exec(e)?e:!File.isTextBundle()&&!File.isTextPack()||/^assets[\/\\]/.exec(e)?t?u(function(e){
if(/^(wk)?file:/.exec(e))return"file://"+h(v.absolutePathFrom(e))}
(e)):(i=/^((\/)|(\/\/)|(\\\\)|([a-z]+\:[\\\/]))/i,o=this.editor.docMenu.getLocalRootUrl(),File.isNode?(a=reqnode("path"),(!o||File.isTextBundle()||File.isTextPack())&&i.exec(e)?u("file://"+h(e).replace(/^[\/\\]+/,"/")):u("file://"+h(a.resolve(o||b.getCurrentFileFolderPath()||"",e.replace(/^\s*(\\\\|\/)/,""))))):!o&&i.exec(e)?u((c=h(e||""),/[a-z]+:/.exec(c)?c:"file://"+b.normalizePath(c))):u(h((s=o||b.getCurrentFileFolderPath()||"",l=e||"","file://"+b.normalizePath(s.replace(/^file:\/\//,"").replace(/\/$/,"")+"/"+l.replace(/^\//gi,"")))))):""}
catch(e){
}
}
}
return e;
function u(e){
return e=(e=encodeURI(e).replace(/%5C/g,"\\")).replace(/#[^.\/\\]+$/,"").replace(/#/g,"%23"),n&&(e+=d),e}
function h(t){
var e,n,i;
return r&&w.shouldManageResource(t)?(e=File.isWin?"\\":"/",e=File.bundle.filePath+e+"assets"+e,n=v.trimPathParam(t.substring(e.length)),(i=w.deletedAssetsMap())[n]?(reqnode("fs-extra").copy(i[n],t,{
errorOnExist:!1}
,()=>{
var e=i[n];
delete i[n],document.querySelectorAll(`[src^="file://${
u(e)}
"]`).forEach(e=>{
e.src=u(t)}
)}
),i[n]):((File.bundle.unusedAssets||[]).remove(n),t)):t}
}
updateImgRef(e){
var t=this.editor.brush.inline;
h("[data-ref='"+v.escapeSelector(e)+"']").each(function(){
var e=(this.querySelector(".md-content")||{
}
).textContent;
void 0!==e&&h(this).replaceWith(t.output(e))}
)}
willUpdateImgRef(e){
e&&(s&&clearTimeout(s),o[e]=!0,r=r||new Date,200<new Date-r?setTimeout(function(){
Object.keys(o).map(this.updateImgRef,this)}
.bind(this),10):s=setTimeout(function(){
Object.keys(o).map(this.updateImgRef,this)}
.bind(this),300))}
startBusyImageLoader(){
var s;
window.IntersectionObserver&&(s=[],this.intersectionObserver=new IntersectionObserver(function(e){
s=[],e.forEach(e=>{
function t(e){
return e&&"auto"!=e}
var n,i,r,o,a;
e.intersectionRatio<=0?(n=e.target,{
naturalHeight:r,naturalWidth:a,height:o}
=n,n.dataset.realSrc||(i=null,5e5<r*a&&0<o&&(i=[n,n.src,`data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${
a}
 ${
r}
"%3E%3C/svg%3E`],t(n.style.height)||t(n.getAttribute("height"))||t(n.style.width)||t(n.getAttribute("width"))?(n.dataset.fixedSize=!0,i.push(0)):i.push(o),s.push(i)))):(a=e.target).dataset.realSrc&&(a.src=a.dataset.realSrc,a.dataset.realSrc="",a.dataset.fixedSize||a.removeAttribute("height"),a.dataset.fixedSize="")}
),s.forEach(e=>{
e[0].dataset.realSrc=e[1],e[0].src=e[2],e[3]&&e[0].setAttribute("height",e[3])}
),s=[]}
))}
tryAddImageToBusyLoader(e){
var t,n,i;
File.isMac&&!e.dataset.realSrc&&({
src:t,naturalHeight:n,naturalWidth:i}
=e,this.intersectionObserver||this.startBusyImageLoader(),this.intersectionObserver)&&(/^file:/.exec(t)&&2e5<n*i?this.intersectionObserver.observe(e):this.intersectionObserver.unobserve(e))}
async deleteMedia(e,t,n,i){
i=i||await _(e);
if(n&&!i)console.error("Failed to prepare undo / redo for image move / delete");
else{
a.recordMediaMoves(null,[i,e]),n&&(n.redo.push({
type:"deleteMedia",from:e}
),n.undo.unshift({
type:"restoreMedia",from:i,to:e}
));
try{
t&&await JSBridge.invoke("shell.trashItem",e)||(File.isNode&&await reqnode("node:fs/promises").unlink(e),File.isMac&&await JSBridge.invoke("path.delete",e))}
catch(e){
console.warn(e)}
}
}
restoreMedia(n,e){
if(n)try{
a.recordMediaMoves(e);
var i=this;
File.isNode?reqnode("fs-extra").copySync(n,e):JSBridge.invoke("path.copyFile",{
from:n,to:e}
).then(function(e){
var t;
e&&(t=i.getRealSrc(n,!0,!1),h(".md-image.md-img-error img").each(function(){
0==this.src.indexOf(t)&&i.refreshLocalImgDom(this)}
))}
)}
catch(e){
}
}
refreshLocalImgDom(e,t,n){
var i,r,o,a=function(e){
e.target.removeAttribute("width"),e.target.removeAttribute("height"),e.target.removeEventListener("load",a),e.target.removeEventListener("error",a)}
,s=(t=t||Math.floor(+new Date/1e3),(e.parentElement||e).dataset.src||e.dataset.src);
n&&!e.parentElement.classList.contains("md-img-error")||(n=this.getRealSrc(s))&&/^file:/.exec(n)&&(failImgCache.remove(n),v.fromExternalPath(n)&&(n=v.file2wkfile(n),failImgCache.remove(n)),"SOURCE"===e.tagName?(this.editor.htmlBlock.resetVideoDom(e.parentElement),e.setAttribute("src",n),(i=e.parentElement.parentElement)&&(r=e.parentElement.previousSibling,o=e.parentElement.outerHTML,e.parentElement.remove(),setTimeout(()=>{
r?r.insertAdjacentHTML("afterend",o):i.insertAdjacentHTML("afterbegin",o)}
,0))):(!e.width&&!e.height&&("VIDEO"===e.tagName?2<e.readyState:e.complete)&&e.clientWidth&&(e.width=e.clientWidth,e.height=e.clientHeight,e.addEventListener("load",a),e.addEventListener("error",a)),e.setAttribute("src",n+"?lastModify="+t),"IMG"===e.tagName&&e.parentElement.dataset.src&&(e.dataset.localRefresh=!0,e.onload=onImageLoadedFunc,e.onerror=onImageErrorFunc),"VIDEO"===e.tagName&&this.editor.htmlBlock.resetVideoDom(e)))}
refreshLocalImg(e){
if(e||!File.inBusyMode){
e&&(window.failImgCache=[],window.loadedImgCache=[]);
var t=Math.floor(+new Date/1e3),n=this,i=h(".md-image img"),r=0,o=!1;
if(!e)i.each(function(){
1e7<r||(r+=(this.naturalHeight||0)*(this.naturalWidth||0))}
),o=1e7<r;
i.each(function(){
n.refreshLocalImgDom(this,t,o)}
),imgLastModified=t,o||h(".md-htmlblock-container video, .md-htmlblock-container img, .md-htmlblock-container source").each(function(){
n.refreshLocalImgDom(this,t,o)}
)}
}
async reloadAllByNode(){
await JSBridge.invoke("webContents.clearCache"),this.refreshLocalImg(!0)}
updateLocalRootUrl(){
var e=this.editor.docMenu.getLocalRootUrl()||"";
if(this.editor.localRootUrl!=e){
for(var t=document.querySelectorAll("[md-inline='image']"),n=0;
n<t.length;
n++){
var i=(a=t[n]).querySelector("img"),r=a.getAttribute("data-src");
r&&r!=i.getAttribute("src")&&(i=h.parseHTML(u.decorate({
type:l.TYPE.image,markdown:a.textContent,alt:i.getAttribute("alt"),href:r}
))[0],a.parentElement.replaceChild(i,a))}
for(var o=document.querySelectorAll("[data-ty-watch-src]"),n=0;
n<o.length;
n++){
var a,s=(a=o[n]).dataset.src;
a.getAttribute("src")!=s&&(a.src=this.getAbsolutePath(s,!0),"VIDEO"==a.tagName)&&this.editor.htmlBlock.resetVideoDom(a)}
}
}
selectComponent(e,t){
this.editor.undo.endSnap(!0);
var n=this.editor.selection.getRangy(),i=h(n.startContainer).closest("[md-inline='image']"),r=i.text(),i=n.getBookmark(i[0]),o=r.indexOf("]"),a=m.makeEmptyCommand(this.editor.selection.buildUndo());
if(!i.containerNode)return this.editor.selection.buildUndo();
"alt"!==e&&e?(i.start=o+2,i.end=r.length-1):(i.start=2,i.end=o),n.moveToBookmark(i),this.editor.selection.setRange(n,!0);
e=this.editor.selection.buildUndo();
return a.redo.push(e),t||this.editor.undo.register(a),e}
prepareUploadAllImagesOnMac(n){
var i=this;
this.validateBeforeUpload().then(e=>{
var t;
e?(e=i.getImageUploader(),(t=i.getImageUploaderCommand(e))?("upic"==e&&t.replace("-u","-s -u"),e=i.buildImageMap(),n([!0,e,t]),e.length||y.showNotification(h.localize.getString("No local images found.","Panel"),void 0,void 0,void 0,!0)):n([!0,[],""])):n([!1,[],""])}
)}
buildImageMap(e,t){
B={
}
,e=e||H;
for(var n,i,r=document.querySelectorAll(".md-image.md-img-loaded"),o=r.length,a=0;
a<o;
a++)if(n=r[a],i=this.getRealSrc(n.dataset.src),e(i=(i=v.absolutePathFrom(i)).replace(/^file:\/\//,""))){
if(t)return!0;
B[i]=B[i]||[],B[i].push(n)}
return!t&&Object.keys(B)}
allImageUploadCallbackForMac(e,t,n,i,r){
var o;
"ipic"==e?this.replaceImageMap(i,t,n,e):t?(o=M(n,e)).length==r.length?(i={
}
,r.forEach((e,t)=>{
i[e]=o[t]}
),this.replaceImageMap(i,!0,n,e)):this.showError(n,"Failed to fetch {
0}
 images from: ".replace("{
0}
",r.length)):this.showError(n,"Failed to upload images:")}
replaceImageMap(t,e,n,i){
var o=m.makeEmptyCommand(this.editor.selection.buildUndo()),a=this.editor,s=new Set,l=0,c=0,r=(a.undo.endSnap(!0),Object.keys(t).forEach(function(e){
var r;
B[e]&&(c++,(r=t[e])==e?l++:B[e].forEach(function(e){
e.querySelector("img").src=r,v.fromExternalPath(r)&&(e.querySelector("img").src=v.file2wkfile(r)),e.hasAttribute("data-src")&&e.setAttribute("data-src",r);
var t,n=a.findNodeByElem(h(e).closest("[cid]")),i=e.getAttribute("md-inline");
!s.has(n)&&d.isType(i,p.image,p.imgtag)&&(s.add(n),o.undo.push(m.buildReplaceUndo(n))),n=e.querySelector(".md-content").textContent,i==p.image?(t=F(n,r),e.querySelector(".md-content").textContent=t):i==p.imgtag?(t=S(n,r),e.querySelector(".md-content").textContent=t):i==p.refimg&&(t=((e=/^!\[((?:\[[^\]]*\]|[^\[\]]|\](?=[^\[]*\]))*)\]\s*\[([^\]]*)\]/.exec(n))[2]||e[1]).replace(/\s+/g," "),i=a.nodeMap.link_list.getNodeByRef(t),s.has(i)||(s.add(i),o.undo.push(m.buildReplaceUndo(i)),i.set("href",r),a.findElemById(i.cid).replaceWith(i.toHTML())))}
))}
),s.forEach(function(e){
e.get("type")!==p.def_link&&a.store(e,!0),o.redo.push(m.buildReplaceUndo(e))}
),o.redo.push(a.selection.buildUndo()),a.undo.register(o),Object.keys(B).length);
B={
}
,e?y.showNotification(h.localize.getString("Successfully uploaded {
0}
 images.").format(c),!1,h.localize.getString("Undo"),function(){
a.undo.undo()}
):c?("upic"==i&&(c-=l),y.showNotification(h.localize.getString("Successfully uploaded {
0}
 images, {
1}
 failed.").format(c,r-c)+" "+v.truncate(n,600),!1,h.localize.getString("Undo"),function(){
a.undo.undo()}
)):this.showError(n,"Failed to upload images:")}
insertLocalImage(){
function t(e){
e&&0!=e.length&&a.insertURLs(e)}
File.isLocked||(File.isNode?JSBridge.invoke("dialog.showOpenDialog",{
filters:[{
name:"Images",extensions:["png","jpg","jpeg","bmp","svg","tiff","webp","gif"]}
],properties:["openFile","multiSelections"],buttonLabel:"Select"}
).then(({
filePaths:e}
)=>{
t(e)}
):File.isMac&&window.bridge.callHandler("images.insertLocalImage",t))}
shouldTriggerMove(e,t){
return!("upload"==(t=void 0===t?this.getTargetImageStorageFolder(!1,!0):t)&&"upload"!=this.getTargetImageStorageFolderFromSetting()&&!this.checkAutoUploadIsAllowed(!0,!0)||!e)&&(/^\s*(https?|ftp):\/\//.exec(e)?File.isTextBundle()||File.isTextPack()||File.option.applyImageMoveForWeb:!(!(File.isTextBundle()||File.isTextPack()||File.option.applyImageMoveForLocal)||/^data:/.exec(e)||0==e.indexOf(t)&&!e.substring(t.length+1).match(/[\\\/]/g)))}
tryMoveImageDom(e,t,n){
this.tryMoveImageDoms([e[0]],t,n)}
tryMoveImageDoms(e,t,n){
if(t&&e.length){
var i,r,o=function(e,i){
const r={
}
;
return e.forEach(e=>{
var t=i(e),n=r[t];
n?n.push(e):r[t]=[e]}
),r}
(e,e=>this.getSrcFromDom(e,!0));
for(i in o)this.shouldTriggerMove(i,t)&&(r=h(o[i]),"ipic"==t||"upload"==t?this.uploadAction(r,!0):P.call(this,r,t,i,void 0,n))}
}
prepImageMove(l,c){
var d=this;
return new Promise(function(t,n){
var e,i,r,o,a;
return!c&&"upload"!=(l=void 0===l?d.getTargetImageStorageFolder():l)&&l?void(File.isMac?bridge.callHandler("images.prepImageMove",{
folder:l,silent:l==d.getTargetImageStorageFolderFromSetting()}
,function(e){
"success"!=e?s(e):t()}
):(e=reqnode("fs-extra"),d.getTargetImageStorageFolder(!(i=!1))&&(i=!(File.isTextBundle()||File.isTextPack())),r=l,o=i,a=reqnode("fs-extra"),new Promise(function(n,i){
if(!o)return n();
a.stat(r,function(e){
var t;
return e?"ENOENT"!=e.code?i(e.message):(t=h("#image-create-folder-confirm").find("#image-create-folder-target").text(r).end().modal({
backdrop:"static",keyboard:!1}
),File.isLocked=!0,void t.off("mousedown",".image-create-folder-dialog-yes, .image-create-folder-dialog-no, .image-create-folder-dialog-help, .close").one("mousedown",".image-create-folder-dialog-yes",function(){
t.modal("hide"),File.isLocked=!1,File.freshMenu(),n()}
).one("mousedown",".image-create-folder-dialog-no",function(){
t.modal("hide"),File.isLocked=!1,File.freshMenu(),i(!1)}
).one("mousedown",".close",function(){
t.modal("hide"),File.isLocked=!1,File.freshMenu(),i(!1)}
).on("mousedown",".image-create-folder-dialog-help",function(){
var e=File.option.useMirrorInCN?"typoraio.cn":"typora.io";
JSBridge.showInBrowser(`https://support.${
e}
/Images/`)}
)):n()}
)}
).then(function(){
e.ensureDir(l,function(e){
e?s(e):t()}
)}
,s))):t();
function s(e){
e&&alert(e.message||e),n()}
}
)}
tryMoveImageInRange(e,t){
var n,i,r=this.editor,o=this.getTargetImageStorageFolder();
o&&(this.editor.brush.clearAndPause(),(n=!(n=e.getNodes([document.ELEMENT_NODE],function(e){
return"image"==e.getAttribute("md-inline")||"imgtag"==e.getAttribute("md-inline")}
)).length&&e&&(i=e.commonAncestorContainer.parentElement)&&"image"==i.getAttribute("md-inline")?[e.commonAncestorContainer.parentElement]:n).length&&this.prepImageMove(o).then(function(){
r.imgEdit.tryMoveImageDoms(n,o,t)}
,()=>{
}
),this.editor.brush.resume())}
generateAlt(e){
return(b.getFileNameFromPath(e,!0)||"").replace(/(^\.)|(\.[^.]+$)/g,"")}
insertImageFromURL(r){
var o=r;
function d(){
return File.editor.imgEdit.generateAlt(r)}
function u(){
var e=window.getSelection(),t="";
return t=!File.editor.sourceView.inSourceMode&&0<e.startOffset?" ":t}
function e(e,t){
var n,i,r,o,a,s,l=this.editor,c=l.getMarkElem();
return!(!c.length||!l.stylize.canContainInline(c))&&(a=File.isTextBundle()||File.isTextPack(),i=d(),s=u(),n=l.getNode(c.attr("cid")),i=s+"!["+i+"]("+(s=a?e:this.resolveImagePath(e))+")",(r=l.selection.getRangy())?((o=h(r.startContainer).closest("[md-inline='image']")).length?((t?window.uploadImageQueue:window.moveImageQueue).add(e),a||N.call(this,o,e),this.selectComponent("alt",a),r=l.selection.getRangy(),(o=h(r.startContainer).closest("[md-inline='image']")).attr("data-src",s)):(t=r.getBookmark(c[0]).start,(a=m.makeEmptyCommand()).undo.push(l.selection.buildUndo()),f.insertInlineText(l,n,i,t,a,!0),a.src=e,s=l.findElemById(n.cid),l.brush.brushNode(n.cid),s.removeClass("md-expand"),r.moveToBookmark({
containerNode:s[0],start:t+i.length,end:t+i.length}
),(o=h(r.startContainer).closest(".md-image")).find("img").attr("src","file://"+e),l.undo.register(a),window.getSelection()),o):null)}
r=File.isTextBundle()||File.isTextPack()?r:this.resolveImagePath(r);
var t,n=o,i=this,a=this.editor,s=this.getTargetImageStorageFolder(!1,!0);
!function(){
var e,t=d(),n=u(),i=a.selection.getRangy();
!i||!(e=h(i.startContainer).closest("[md-inline='image']")).length||(i=i).startContainer.parentElement.classList.contains("md-image-after-src")&&i.startContainer.textContent.length==i.startOffset?(f.pasteHandler(this.editor,n+"!["+t+"]("+r+")",!0,!0),this.editor.undo.lastRegisteredOperationCommand().src=o):(N.call(this,e,o),this.selectComponent("alt"))}
.call(this),this.shouldTriggerMove(n,s)&&s&&("upload"==s?(i.editor.brush.clearAndPause(),t=e.call(i,n,!0),i.uploadAction(t),i.editor.brush.resume()):s&&(n=b.normalizePath(n),this.editor.brush.clearAndPause(),t=e.call(this,n),i.prepImageMove(s,File.isMac).then(function(){
P.call(i,t,s,n)}
,()=>{
E(n)}
),this.editor.brush.resume()))}
doInsertVideoFromURL(e){
e='<video src="{
url}
"></video>'.replace("{
url}
",e);
f.pasteHandler(this.editor,e,!1)}
doInsertAudioFromURL(e){
e='<audio src="{
url}
"></audio>'.replace("{
url}
",e);
f.pasteHandler(this.editor,e,!1)}
resolveImagePath(e){
if(/^\/\//.exec(e))return"https://"+e;
if(/^data:/.exec(e))return e;
if(/^[^:]+:\/\//.exec(e))return e;
if(!e)return e;
function t(e){
return File.option.autoEscapeImageURL?v.escapeURL(e):e}
var n=this.getLocalRootUrlForInsert(),i=b.getCurrentFileFolderPath();
if(File.isTextBundle())e=v.getRelativePath(n,e,!1,!1),!n||"/"!=e[0]&&"\\"!=e[0]||(e=e.substring(1));
else if(File.isTextPack())e=v.getRelativePath(n,e,!1,!1),!n||"/"!=e[0]&&"\\"!=e[0]||(e=e.substring(1));
else if(n&&n.length){
var r=v.getRelativePath(n,e,!1,File.option.relativePathWithDot);
e=(!(r=n==i?r.replace(/^\s*(\\\\|\/)/,""):r).match(/^\.[\/\\]/)&&this.editor.docMenu.getLocalRootUrl()?"/":"")+r}
else{
if(!File.option.useRelativePathForImg||!i||0!==e.indexOf(i))return t(e);
e=e.substring(i.length).replace(/^\//,"").replace(/\\/,"/"),File.option.relativePathWithDot&&(e="./"+e)}
return t(e=File.isWin?e.replace(/[\/\\]{
1,2}
/g,"/"):e)}
getImageUploaderCommand(e){
var t=(n=n||{
ipic:"ipic","picgo-app":"picgo-app","piclist-app":"piclist-app",upic:"/Applications/uPic.app/Contents/MacOS/uPic -o url -u",picsee:"/Applications/Picsee.app/Contents/MacOS/Picsee -u","picgo-cli":File.isNode?(t=JSON.stringify(_options.userDataPath+"/picgo/"+(File.isWin?"x64"==i.process.arch?"win64":"win32":"linux")+"/picgo"+(File.isWin?".exe":""))+" u",t=File.isWin?"chcp 65001| "+t:t):null}
)[e||File.option.imageUploader||""];
return(t=t||"custom"!==File.option.imageUploader?t:(File.option.customImageUploader||"").replace("${
filepath}
",File.bundle.filePath||"").replace("${
filename}
",(File.getFileName()||"").replace(/\.[^.\/\\]+$/,"")))||""}
getImageUploader(){
var e=this.editor.localSettingBridge&&this.editor.localSettingBridge.getSetting(c);
return e&&!File.editor.sourceView.inSourceMode&&"ipic"==e.toLowerCase()?"ipic":"custom"==File.option.imageUploader?this.getImageUploaderCommand(File.option.imageUploader):File.option.imageUploader}
isFixedImageStorageFolder(){
function e(e){
if(e)return v.isAbsolutePath(e)}
var t;
return!File.isTextBundle()&&!File.isTextPack()&&((t=this.editor.localSettingBridge&&this.editor.localSettingBridge.getSetting(c)||"")?e(t):File.option.defaultImageStorage?e(File.option.defaultImageStorage):void 0)}
assetsFolderForTextBundle(){
var e=File.isWin?"\\":"/";
return this.editor.docMenu.getLocalRootUrl()+e+"assets"}
getTargetImageStorageFolder(e,t){
var n=this.editor.localSettingBridge&&this.editor.localSettingBridge.getSetting(c);
if(File.isTextBundle())return this.assetsFolderForTextBundle();
if(File.isTextPack())return this.assetsFolderForTextBundle();
if(n&&!File.editor.sourceView.inSourceMode){
if((File.option.allowImageUpload||t)&&("ipic"==n.toLowerCase()||"upload"==n.toLowerCase()))return"upload";
t=b.getCurrentFileFolderPath();
if(t)return/[\\/]$/.exec(t[t.length-1])||(t+="/"),b.normalizePath(t+n.replace(/\${
filename}
/g,(File.getFileName()||"").replace(/\.[^.\/\\]+$/,"")),!0)}
return e?null:this.getTargetImageStorageFolderFromSetting()}
getTargetImageStorageFolderFromSetting(){
if("ipic"==File.option.defaultImageStorage||"upload"==File.option.defaultImageStorage)return"upload";
var e=b.getCurrentFileFolderPath();
if(this.cachedFileImageStorage)return this.cachedFileImageStorage;
var t=File.option.defaultImageStorage;
if(!e||/[\\/]$/.exec(e[e.length-1])||(e+="/"),"folder"==t){
if(e)return this.cachedFileImageStorage=b.normalizePath(e.replace(/[\\/]$/,""),!0),this.cachedFileImageStorage}
else if("assert"==t){
if(e)return this.cachedFileImageStorage=b.normalizePath(e+"assets",!0),this.cachedFileImageStorage}
else if("per-file-assert"==t){
if(e)return this.cachedFileImageStorage=b.normalizePath(e+File.getFileName().replace(/\.[^.\/\\]+$/,"")+".assets",!0),this.cachedFileImageStorage}
else if(t&&!d.isType(t,"upload")){
var n=File.getFileName();
if(-1<t.indexOf("${
filename}
")){
if(!n)return null;
t=t.replace(/\${
filename}
/g,n.replace(/\.[^.\/\\]+$/,""))}
(File.isWin?/^[^\/\\]+:[\/\\]/:/^[\\\/]/).exec(t)?this.cachedFileImageStorage=b.normalizePath(t,!0):e&&(this.cachedFileImageStorage=b.normalizePath(e+t,!0))}
return this.cachedFileImageStorage||""}
async moveToTextbundleByNode(e,r){
const t=File.isWin?"\\":"/";
var n=e+t+"assets";
const o=reqnode("path"),a=reqnode("fs-extra"),i=o.basename(r||"").replace(/^\..+$/,"");
async function s(e,t){
await File.editor.imgEdit.deleteMedia(t,!0,e)}
var e=this.buildImageMap(),l=await this._copyAllImages(n,!0),c=await async function(){
for(var e=o.dirname(r),t=await a.readdir(e),n=0,i=0;
i<t.length;
i++)if(-1<File.SupportedTextFiles.indexOf(b.getExtension(t[1]))&&n++,1<n)return null;
return e}
(),e=e.filter(e=>{
return 0!=e.indexOf(n+File.isWin?"\\":"/")&&!(!x(e)||(0===o.dirname(e).indexOf(t+i)||c&&0===e.indexOf(e+t))&&(s(l,e),1))}
);
e.length&&e.forEach(function(e){
s(l,e)}
)}
async onFileMoved(e,t){
var n,i,r;
function o(e){
return 0==e.indexOf(t.replace(/[\\\/]$/,"")+(File.isWin?"\\":"/"))}
this.cachedFileImageStorage=void 0,this.editor.localSettingBridge&&(i=(n=this).getTargetImageStorageFolder(),t!==i)&&t&&i&&v.pathByDeleteLastComponent(t)==v.pathByDeleteLastComponent(e)&&n.buildImageMap(o,!0)&&await async function(e){
try{
if(File.isNode){
if(await reqnode("node:fs/promises").stat(e))return!0}
else if(File.isMac)return await JSBridge.invoke("shell.isFolder",e)}
catch(e){
return!1}
}
(t)&&(e=v.getFolder(i),r=File.getMountFolder(),0==i.lastIndexOf(r)&&(e=i.substr(r.length+1)),r=h.localize.getString("Would you like to update image references and move image files to %@ ?","Panel").replace("%@",e),await n.shouldContinue(r,"noWarningForUpdateImageReference"))&&(await this._copyAllImages(i,!0,o,!0),async function(e){
if(File.isNode)try{
await reqnode("node:fs/promises").rmdir(e,{
recursive:!1,force:!1}
)}
catch(e){
}
else if(File.isMac)return JSBridge.invoke("shell.removeIfEmpty",e)}
(t))}
revealInFinder(){
var e,t=h(".md-expand img").attr("src")||"";
/^(wk)?file:/.exec(t)?(e=v.absolutePathFrom(t),JSBridge.showInFinder(e)):/^https?:/.exec(t)&&JSBridge.showInBrowser(t)}
async copyImage(){
var e=h(".md-expand.md-img-loaded");
if(e){
var t=this.getSrcFromDom(e[0],!0);
if(File.isNode){
var{
clipboard:n,nativeImage:i}
=reqnode("electron"),r=/^https?:/.exec(t)?i.createFromBuffer(Buffer.from(await(await fetch(t)).arrayBuffer())):i.createFromPath(t),o=(n.writeText(t),(e.find("img")[0]||{
}
).outerHTML);
o&&n.writeHTML(o),/\.gif/.exec(t)?n.writeImage(i.createFromBuffer(r.toBitmap())):n.writeImage(r),await 0}
File.isMac&&(o={
}
,/\.svg$/.exec(t)&&((i=(e.find("img")[0]||{
}
).outerHTML)&&(o["text/html"]=i),o["image/svg+xml"]=await(await fetch(t)).text()),await!