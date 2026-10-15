c(t)?i.createFromBuffer(Buffer.from(await(await fetch(t)).arrayBuffer())):i.createFromPath(t),o=(n.writeText(t),(e.find("img")[0]||{
}
).outerHTML);
o&&n.writeHTML(o),/\.gif/.exec(t)?n.writeImage(i.createFromBuffer(r.toBitmap())):n.writeImage(r),await 0}
File.isMac&&(o={
}
,/\.svg$/.exec(t)&&((i=(e.find("img")[0]||{
}
).outerHTML)&&(o["text/html"]=i),o["image/svg+xml"]=await(await fetch(t)).text()),await!bridge.callHandler("clipboard.writeImage",{
otherData:o,path:t}
))}
}
moveImageTo_(e,t,n,i,r){
P.call(this,e,t,n,i,!1,r)}
async deleteImageAction(e){
var t=h(".md-expand.md-img-loaded");
if(t){
var n=this.editor,i=this.getSrcFromDom(t[0],!0),t=(n.selection.selectAllElem(t),f.backspaceHandler(n,null,"delSelection",!1,!1));
if(t&&t==n.undo.lastRegisteredOperationCommand()){
if(e&&x(i)){
if(!File.isTextBundle()&&!File.isTextPack()&&!await this.shouldContinue("Delete original image file?","noWarningForDeleteImage"))return}
else e=!1;
await this.deleteMedia(i,!0,t)}
}
}
async shouldContinue(e,t){
if(!File.option[t]){
var{
response:e,checkboxChecked:n}
=await y.showWarningDialog(h.localize.getString(e),!0);
if(0!=e)return!1;
n&&(JSBridge.execForAll("window.File && File.option && (File.option."+t+" = true)"),JSBridge.putSetting(t,!0))}
return!0}
async copyToSelectedFolderAction(e){
var t=h(".md-expand.md-img-loaded");
if(t){
var n,i=this.getSrcFromDom(t[0],!0),r=b.getFileNameFromPath(i,!0);
if(/^data:/.exec(i)&&(n=(/^data:[\\\/]*image\/([^;
]+)/.exec(i)||[])[1],r=t.find("img").attr("alt")||new Date+"",n)&&(r=r+"."+n),e&&x(i)){
if(!await this.shouldContinue("Move image will delete the image file at original path, are you sure to continue?","noWarningForMoveImage"))return}
else e=!1;
(n=File.isMac?await JSBridge.invoke("images.selectImageSavePath",{
defaultName:(e?i:r)||"",absolutePath:i||File.editor.imgEdit.cachedFileImageStorage||File.mountFolder_||""}
):(await JSBridge.invoke("dialog.showSaveDialog",{
title:h.localize.getString("Copy and update image source to…","Panel"),defaultPath:(e||File.isLinuxSnap?i:r)||"",properties:["showOverwriteConfirmation"]}
)).filePath)&&n!=i&&this.moveImageTo_(t,n,i,!0,e)}
}
async copyToTargetFolderAction(e){
this.editor.brush.clearAndPause();
var t=h(".md-expand.md-img-loaded");
if(t){
var n=this.getSrcFromDom(t[0],!0),i=this.getTargetImageStorageFolder(),r=this;
if(e&&x(n)){
if(!await r.shouldContinue("Move image will delete the image file at original path, are you sure to continue?","noWarningForMoveImage"))return}
else e=!1;
n&&this.prepImageMove(i,File.isMac).then(function(){
r.moveImageTo_(t,i,n,void 0,e)}
,()=>{
}
),this.editor.brush.resume()}
}
switchPattern(e,t,n,i){
if(!(e=e||h(".md-expand.md-img-loaded")))return!1;
var r,o,a,s=e.find("img"),s=(i&&(a=e.closest("[cid]").attr("cid"),this.editor.undo.addSnap(a,g.NONE)),{
type:t?p.imgtag:p.image,title:s.attr("title"),alt:s.attr("alt"),src:e.attr("data-src")||s.attr("src")}
),l=e.attr("md-inline");
if(t)return l!=p.imgtag&&((t=document.createElement("img")).setAttribute("src",s.src),s.alt&&t.setAttribute("alt",s.alt),s.title&&t.setAttribute("title",s.title),s.markdown=t.outerHTML.replace(/<\/img>$/,"").replace(/\s*>$/," />").replace(/&amp;
/g,"&"),o=u.decorateImage(s,s.markdown,s.src),r=h(o),e.replaceWith(r),i&&(a=e.closest("[cid]").attr("cid"),this.editor.undo.addSnap(a,g.NONE)),[s,r]);
if(l==p.image)return!1;
if(l==p.imgtag&&n)for(var c=/(\w+)\s*=\s*(["']).+?\2/g;
c.exec(void 0);
)if(!["src","title","alt"].exec((void 0)[1].toLowerCase()))return!1;
t=["!["+s.alt.replace(/]/g,"")+"](",s.src,(s.title?JSON.stringify(title):"")+")"];
return s.markdown=t.join(""),o=u.decorateImage(s,s.markdown,s.src,t),r=h(o),e.replaceWith(r),i&&this.editor.undo.addSnap(a,g.REPLACE),[s,r]}
ensureOneImg(e){
if(e=e||h(".md-expand.md-img-loaded"))return 1==e.length?e:(this.editor.brush.expand(!0,!0,!0),h(".md-expand.md-img-loaded"))}
addStyle(e,r,o){
var t,n,a,s,i,l;
(e=this.ensureOneImg(e))&&(t=e.closest("[cid]").attr("cid"),this.editor.undo.addSnap(t,g.NONE),!o&&e.attr("md-inline")!=p.imgtag||(l=e.find("img"),e.attr("md-inline")!=p.imgtag?(i=this.switchPattern(e,!0,!1,!0))&&(n=i[0],e=i[1]):n={
type:p.imgtag,title:l.attr("title"),alt:l.attr("alt"),src:e.attr("data-src")||l.attr("src"),markdown:e.text()}
,a=document.createElement("img"),s=!1,n.markdown=n.markdown.replace(/(style\s*=\s*)(['"])(.*?)\2/,function(e,t,n,i){
a.setAttribute("style",i||""),s=!0,a.style[r]=o;
i=a.getAttribute("style");
return i?t+JSON.stringify(i):""}
),s||(n.markdown=n.markdown.replace(/(\s*\/?>)/,' style="'+r+":"+o+';
" $1').replace(/\s+\/>$/," />")),i=u.decorateImage(n,n.markdown,n.src),l=h(i),e.replaceWith(l),l.find("img").click(),this.editor.undo.addSnap(t,g.REPLACE)))}
zoomAction(e,t){
(e=e||h(".md-expand.md-img-loaded"))&&this.addStyle(e,"zoom","100%"==t?"":t)}
quickUploadValidation(e){
var t=this.getImageUploader();
return t||(e&&(t=h.localize.getString("Please set an image uploader in Preferences panel before using this function.","Panel"),File.isMac?bridge.callHandler("controller.showErrorDialog",t):y.showDialog({
message:t}
)),!1)}
validateBeforeUpload(){
var n=this;
return new Promise(function(e){
var t=n.quickUploadValidation(!0);
t?File.isMac&&"ipic"==t?bridge.callHandler("images.iPicValidateBeforeUpload",e):e(!0):e(!1)}
)}
uploadAction(n,i){
var r;
(n=n||h(".md-expand.md-img-loaded"))&&(r=this).validateBeforeUpload().then(e=>{
var t=v.absolutePathFrom(r.getRealSrc(n.attr("data-src")));
e?$.call(r,n,t).then(function(e){
i||C(e,t,n),n=E(t),N.call(r,n,e)}
,function(e){
n=E(t),N.call(r,n,t),e&&setTimeout(function(){
r.showError(e)}
,500)}
):(E(t),k(n))}
)}
showError(e,t){
e=e.message||e,y.showNotification(`${
h.localize.getString(t||"Failed to upload image. Error Message:")}
 <code style='font-size:0.8em'>${
v.escape(v.truncate(e,600))}
</code>`,!0,h.localize.getString("Learn More","Panel"),function(){
var e=File.option.useMirrorInCN?"typoraio.cn":"typora.io";
JSBridge.showInBrowser(`https://support.${
e}
/Upload-Image/`)}
)}
async _copyAllImages(t,r,n,e,i,o){
var a=this;
if(t&&(!r||e||await a.shouldContinue("Move image will delete the image file at original path, are you sure to continue?","noWarningForMoveImage"))){
var s,l,e=i?Object.keys(B):this.buildImageMap(function(e){
return 0!=e.indexOf(t+File.isWin?"\\":"/")&&(!n||n(e))}
),c=[],d=_options.userDataPath+(File.iwWin?"\\":"/")+"typora-user-images";
y.hideNotification();
try{
await Promise.all(e.map(n=>A.call(a,h(B[n]),t,n,!1,!0).then(([e,t])=>{
c.push([n,e,t])}
))),l=Promise.all(c.map(e=>{
var t,[e,n,i]=e;
if(void 0!==n)return C(n,e,(t=E(e)).find("img")[0]),t=N.call(a,t,n,!0),s?m.append(s,t):s=t,t=r,o&&(t=r||0==e.indexOf(d)),D(s,e,n,i,t)}
)).then(function(){
return s}
)}
catch(e){
console.error(e)}
s&&(this.editor.undo.register(s),i=h.localize.getString(r?"Images moved to %@.":"Images copied to %@.","Panel").replace("%@",`<code>${
v.getFolder(t)}
</code>`),o&&(i=h.localize.getString("Images saved to TextBundle")),o||y.showNotification(i,!0),await l)}
}
moveAllImages(){
return this.copyAllImages(!0)}
async copyAllImages(e){
var t,n=this.getTargetImageStorageFolder();
File.isNode?(t=((await JSBridge.invoke("dialog.showOpenDialog",{
defaultPath:n,title:h.localize.getString("Select Container Folder"),properties:["openDirectory","createDirectory"],buttonLabel:h.localize.getString("Select")}
)).filePaths||[])[0],this._copyAllImages(t,e)):bridge.callHandler("images.startCopyAllImages",[n,e||!1])}
uploadAllImages(){
var e,t;
this.quickUploadValidation(!0)&&(e=this.buildImageMap(),L.call(t=this,e).then(n=>{
y.hideNotification();
var i={
}
;
e.forEach((e,t)=>{
i[e]=n[t]}
),t.replaceImageMap(i,!0)}
).catch(e=>{
t.showError(e,"Failed to upload images:")}
),Object.keys(e).length?(y.hideNotification(),y.showProcessingNotification(h.localize.getString("Uploading in progress…","Panel"))):y.showNotification(h.localize.getString("No local images found.","Panel"),void 0,void 0,void 0,!0))}
contextMenuItems(e){
var t,n=(e.getAttribute("src")||"").replace(/\?(.+)$/,""),i=[],r=!e.closest(".md-img-error"),o=this.getTargetImageStorageFolder(),a=(o&&"upload"!=o&&(o=o.replace(/[\\\/]$/,"")+(File.isWin?"\\":"/")),v.escapeURL(o)),a=(o&&"upload"!=o&&(0!=n.replace(/^file:\/\//,"").indexOf(a)||n.replace(/^file:\/\//,"").substring(a.length+1).match(/[\\\/]/g))&&(t=v.getFolder(o))&&i.push("copyImgToTarget-"+t.replace(/\|/g,"")),/^(wk)?file:\/\//.exec(n)),r=(r&&(i.push("copyImgToSelect"),a&&(t&&i.push("moveImgToTarget-"+t.replace(/\|/g,"")),i.push("moveImgToSelect")),"upload"==o?i.unshift("uploadImg"):i.push("uploadImg"),i.push("copyImg")),a?i.unshift("revealImgInFinder"):/^https?:\/\//.exec(n)&&i.unshift("revealImgInBrowser"),e.getAttribute("data-pixel-ratio"));
return r&&1!=(r=+r)&&i.push("zoomImgTo-"+v.floatToPercent(1/r)),i.push("zoomImg"),e.closest("[md-inline='image']")&&i.push("imgSyntaxMarkdown"),e.closest("[md-inline='imgtag']")&&i.push("imgSyntaxHTML"),i.push(a?"deleteImgFile":"deleteImg"),i}
afterUserInsertImage(t){
var n,i,r,e,o,a,s=(t.getAttribute("src")||"").replace(/\?(.+)$/,"");
function l(){
var e=i.selection.getRangy(),t=h(e.endContainer).closest("[md-inline='image']");
e&&t.length&&!t.hasClass("md-on-moving")&&!t.hasClass("md-on-uploading")&&(i.lastCursor=i.selection.buildUndo(e),i.contextMenu.showCustom(n,"image"))}
s!=this.lastUrl&&t.parentElement&&t.parentElement.contains(window.getSelection().anchorNode)&&(n=[],i=this.editor,e=t.getAttribute("data-pixel-ratio"),r=e=>1!=(e=+(e||1))&&e!=1/0&&!isNaN(e),e?r(e=+e)&&n.push({
label:"Zoom Image to %@",key:"zoom-smart",variable:v.floatToPercent(1/e)}
):File.isMac?bridge.callHandler("images.getScale",s.replace(/^wkfile:/,"file:"),function(e){
r(e)&&(t.setAttribute("data-pixel-ratio",e),n.splice(n.length-1,0,{
label:"Zoom Image to %@",key:"zoom-smart",variable:v.floatToPercent(1/e)}
),l())}
):File.isNode&&I.getImageScaleByElection(s,t.nativeHeight).then(function(e){
r(e)&&(t.setAttribute("data-pixel-ratio",e),n.splice(n.length-1,0,{
label:"Zoom Image to %@",key:"zoom-smart",variable:v.floatToPercent(1/e)}
),l())}
),File.isTextBundle()||File.isTextPack()||((e=this.getTargetImageStorageFolder())&&"upload"!=e&&(e=e.replace(/[\\\/]$/,"")+(File.isWin?"\\":"/"),s=v.absolutePathFrom(s),o=v.escapeURL(e),0!=s.replace(/[\\]/g,"/").indexOf(o)||s.substring(o.length+1).match(/[\\\/]/g)?(a=v.getFolder(e))&&n.push({
label:"Copy to %@",key:"copy-img-to-target",variable:a}
):this.lastUrl=s),n.push({
label:"Copy Image to…",key:"select-img-target"}
),a&&n.push({
label:"Move to %@",key:"move-img-to-target",variable:a}
),n.push({
label:"Rename or Move Image to…",key:"select-img-target-move"}
),File.isTextBundle())||File.isTextPack()||!this.quickUploadValidation()||("upload"==e?n.unshift({
label:"Upload Image",key:"upload-img"}
):n.push({
label:"Upload Image",key:"upload-img"}
)),n.push({
label:"Zoom Image",key:"zoom-img",hasExtraMenu:!0}
),n.length)&&l()}
toggleUploadForFile(){
"upload"==this.getTargetImageStorageFolder(!0)?this.doRemoveImageCopyToFolder(!1):!this.quickUploadValidation(!0)||File.isNode&&!this.checkAutoUploadIsAllowed(!0)||this.doSetImageCopyToFolder("upload",!0)}
checkAutoUploadIsAllowed(e,t){
if(File.option.allowImageUpload)return!0;
if(e){
if(t&&File.option.noWarnigUploadDisabled)return!1;
y.showNativeDialog({
message:h.localize.getString("The option `%@` must be enabled first to automatically upload images.","Panel").replace("%@",h.localize.getString("Allow upload images automatically based on YAML settings","Panel")),buttons:[h.localize.getString("Enable this feature on preferences panel","Panel"),h.localize.getString("Close")],checkbox:t?h.localize.getString("Do not show this again","Panel"):null,callback:function(e,t){
0===e&&(File.isNode?File.megaMenu.highlight("image-setting-group"):bridge.callHandler("setting.showAndHighlight","image-setting-group")),t&&(JSBridge.putSetting("noWarnigUploadDisabled",!0),JSBridge.execForAll("File.option.noWarnigUploadDisabled = true;
"))}
}
)}
return!1}
toggleCopyToFolder(){
var t=this,e=this.getTargetImageStorageFolder(!0),n=b.getCurrentFileFolderPath();
File.refreshImageCopyStatus(!0),File.isLocked||File.editor.sourceView.inSourceMode||(e?this.doRemoveImageCopyToFolder(!1):n?JSBridge.invoke("dialog.showOpenDialog",{
defaultPath:b.getCurrentFileFolderPath(),title:h.localize.getString("Select Container Folder"),properties:["openDirectory","createDirectory"],buttonLabel:h.localize.getString("Select")}
).then(({
filePaths:e}
)=>{
e&&0!=e.length&&t.doSetImageCopyToFolder(e[0])}
):JSBridge.invoke("dialog.showMessageBox",{
title:h.localize.getString("Document must be saved first.","Panel"),message:h.localize.getString("Typora will copy newly inserted image to folder by selected relative path, so please save the file first.","Panel"),defaultId:0,cancelId:0,buttons:[h.localize.getString("OK")]}
))}
toggleUseImageRootPath(){
var e=this.editor.docMenu.getLocalRootUrl(),t=this.editor;
e?this.editor.docMenu.removeProperty("typora-root-url"):JSBridge.invoke("dialog.showOpenDialog",{
defaultPath:b.getCurrentFileFolderPath(),title:h.localize.getString("Select Container Folder"),properties:["openDirectory","createDirectory"],buttonLabel:h.localize.getString("Select")}
).then(({
filePaths:e}
)=>{
e&&0!=e.length&&t.imgEdit.doSetImageRootPath(e[0])}
)}
doSetImageCopyToFolder(e,t){
e=t?"upload":v.getRelativePath(b.getCurrentFileFolderPath(),e,!0),this.editor.docMenu.writeProperty(c,e)}
doSetImageRootPath(e){
this.editor.docMenu.writeProperty("typora-root-url",v.getRelativePath(b.getCurrentFileFolderPath(),e,!0))}
doRemoveImageCopyToFolder(e){
return this.editor.docMenu.removeProperty(c,e)}
}
}
),$__System.registerDynamic("35",["11