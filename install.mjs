#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PATCH_MARKER = "pi-tool-groups-patch:v0.5.0";

function fail(message) {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

function run(command, args = []) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function findPiPackage() {
  let executables;
  try {
    executables = run(process.platform === "win32" ? "where" : "which", process.platform === "win32" ? ["pi"] : ["-a", "pi"]).split(/\r?\n/).filter(Boolean);
  } catch {
    fail("Could not find the `pi` executable in PATH.");
  }

  // Wrapper shims (e.g. cmux) may come first in PATH; use the first one that lives inside the package.
  for (const executable of executables) {
    let cursor = path.dirname(fs.realpathSync(executable));
    while (cursor !== path.dirname(cursor)) {
      const packageJson = path.join(cursor, "package.json");
      if (fs.existsSync(packageJson)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(packageJson, "utf8"));
          if (pkg.name === "@earendil-works/pi-coding-agent") return { root: cursor, pkg, executable };
        } catch {}
      }
      cursor = path.dirname(cursor);
    }
  }
  fail(`Could not locate @earendil-works/pi-coding-agent from: ${executables.join(", ")}.`);
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(before, after);
}

// Injected verbatim into the bundle. No backticks / "${" inside: kept as String.raw.
const INJECTED = String.raw`var TimelineThinkingRow=class{text="";expanded=!1;markdown;constructor(host){this.host=host}setText(text){text!==this.text&&(this.text=text,this.markdown=void 0)}render(width){if(this.expanded){this.markdown??=new Markdown(this.text,1,0,this.host.getMarkdownThemeWithSettings(),{color:t=>theme.fg("thinkingText",t),italic:!0});return["",...this.markdown.render(width)]}let first=(this.text.split("\n").find(l=>l.trim())??"").trim();return["",truncateToWidth(" "+theme.fg("muted","thinking")+"  "+theme.fg("thinkingText",theme.italic(first)),width)]}handleMouse(event){if(event.type!=="click"||event.button!=="left")return;return this.expanded=!this.expanded,this.host.ui.requestRender(),{handled:!0}}invalidate(){this.markdown=void 0}};var TimelineGroupComponent=class extends Container{items=new Container;headerText=new Text("",1,0);expanded=!1;mounted=!1;thinkingCount=0;toolCount=0;rows=new Map;host;constructor(host){super(),this.host=host,this.addChild(new Spacer(1)),this.addChild(new MouseRegion(this.headerText,event=>event.type!=="click"||event.button!=="left"?void 0:(this.setExpanded(!this.expanded),this.host.ui.requestRender(),{handled:!0}))),this.updateHeader()}addItem(item){this.items.addChild(item),this.mounted||(this.mounted=!0,this.host.chatContainer.addChild(this)),this.updateHeader()}addTool(component){this.toolCount+=1,this.addItem(component)}syncThinking(owner,message){let text=(message.content??[]).filter(c=>c.type==="thinking").map(c=>(c.thinking??"").trim()).filter(Boolean).join("\n\n");if(text){let row=this.rows.get(owner);row||(row=new TimelineThinkingRow(this.host),this.rows.set(owner,row),this.thinkingCount+=1,this.addItem(row)),row.setText(text)}return{...message,content:(message.content??[]).filter(c=>c.type!=="thinking")}}setExpanded(expanded){this.expanded!==expanded&&(this.expanded=expanded,expanded?this.addChild(this.items):this.removeChild(this.items),this.updateHeader())}updateHeader(){let parts=[];this.thinkingCount&&parts.push(this.thinkingCount+" THINKING"),this.toolCount&&parts.push(this.toolCount===1?"1 TOOL CALL":this.toolCount+" TOOL CALLS");let arrow=this.expanded?"\u25BE":"\u25B8",hint=this.expanded?"":"  ("+keyText("app.tools.expand")+" to expand)";this.headerText.setText(theme.fg("accent","\u2502 ")+theme.fg("accent",theme.bold(arrow+" [ "+parts.join(" \u00B7 ")+" ]"))+theme.fg("dim",hint))}invalidate(){super.invalidate(),this.items.invalidate(),this.updateHeader()}};`;

const MODE_MEMBERS = 'timelineGroup=void 0;timeline(){return this.timelineGroup||(this.timelineGroup=new TimelineGroupComponent(this),this.timelineGroup.setExpanded(this.toolOutputExpanded)),this.timelineGroup}attachTimeline(component){component.timelineGroup=this.timeline(),component.lastMessage&&component.updateContent(component.lastMessage)}';

function patchBundle(source) {
  const r = (before, after, label) => { source = replaceOnce(source, before, after, label); };
  r("var InteractiveMode=class _InteractiveMode{", `/* ${PATCH_MARKER} */${INJECTED}var InteractiveMode=class _InteractiveMode{${MODE_MEMBERS}`, "insert timeline classes");
  // Assistant components hand their thinking to the run's timeline instead of rendering it inline.
  r("updateContent(message,isStreaming=this.isStreaming){this.lastMessage=message,", "updateContent(message,isStreaming=this.isStreaming){let originalMessage=message;this.timelineGroup&&(message=this.timelineGroup.syncThinking(this,message)),this.lastMessage=originalMessage,", "route thinking");
  r("this.streamingMessage=event.message,this.chatContainer.addChild(this.streamingComponent)", "this.streamingMessage=event.message,this.chatContainer.addChild(this.streamingComponent),this.streamingComponent.timelineGroup=this.timeline()", "attach streaming assistant");
  r("this.chatContainer.addChild(assistantComponent);break}", "this.chatContainer.addChild(assistantComponent),this.attachTimeline(assistantComponent);break}", "attach historical assistant");
  // Tool rows go into the same timeline, in arrival order.
  r("component.setExpanded(this.toolOutputExpanded),this.chatContainer.addChild(component),this.pendingTools.set(content.id,component)", "component.setExpanded(!1),this.timeline().addTool(component),this.pendingTools.set(content.id,component)", "streaming tools");
  r("component.setExpanded(this.toolOutputExpanded),this.chatContainer.addChild(component),this.pendingTools.set(event.toolCallId,component)", "component.setExpanded(!1),this.timeline().addTool(component),this.pendingTools.set(event.toolCallId,component)", "fallback tools");
  r("component.setExpanded(this.toolOutputExpanded),this.chatContainer.addChild(component),message.stopReason", "component.setExpanded(!1),this.timeline().addTool(component),message.stopReason", "historical tools");
  // One timeline per user request.
  r('case"agent_start":this.pendingTools.clear(),', 'case"agent_start":this.pendingTools.clear(),this.timelineGroup=void 0,', "reset on agent start");
  r('case"agent_end":this.settingsManager.getShowTerminalProgress()', 'case"agent_end":this.timelineGroup=void 0,this.settingsManager.getShowTerminalProgress()', "reset on agent end");
  r("renderSessionItems(items,messageMeta,options={}){this.pendingTools.clear();", "renderSessionItems(items,messageMeta,options={}){this.pendingTools.clear(),this.timelineGroup=void 0;", "reset on rebuild");
  r("addMessageToChat(message,options){switch(message.role){", 'addMessageToChat(message,options){switch(message.role==="user"&&(this.timelineGroup=void 0),message.role){', "reset on user message");
  // No transcript notices for Ctrl+O / Ctrl+T toggles — they pile up between tool rows.
  r(';this.showStatus(`Tool output: ${expanded?"expanded":"collapsed"}`)}', "}", "silence tool toggle notice");
  r(',this.showStatus(`Thinking blocks: ${this.hideThinkingBlock?"hidden":"visible"}`)}', "}", "silence thinking toggle notice");
  return source;
}

const { root, pkg, executable } = findPiPackage();
// No version pin. The exact-match anchors in patchBundle() are a stricter
// guard than a version number: a mismatch throws and the original is restored.

const chunksDir = path.join(root, "dist", "bundle", "chunks");
const candidates = fs.readdirSync(chunksDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => path.join(chunksDir, name))
  .filter((file) => fs.readFileSync(file, "utf8").includes("InteractiveMode=class _InteractiveMode"));
if (candidates.length !== 1) fail(`Expected one interactive bundle chunk, found ${candidates.length}.`);

const target = candidates[0];
const original = fs.readFileSync(target, "utf8");
if (original.includes(PATCH_MARKER)) {
  console.log(`Pi Tool Groups is already installed.\nTarget: ${target}`);
  process.exit(0);
}

const backupDir = path.join(os.homedir(), ".pi", "agent", "patch-backups", "pi-tool-groups", pkg.version);
fs.mkdirSync(backupDir, { recursive: true });
const backup = path.join(backupDir, path.basename(target));
if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);

try {
  const patched = patchBundle(original);
  const temporary = `${target}.pi-tool-groups.tmp.js`;
  fs.writeFileSync(temporary, patched);
  run(process.execPath, ["--check", temporary]);
  fs.renameSync(temporary, target);
} catch (error) {
  try { fs.copyFileSync(backup, target); } catch {}
  fail(`Patch failed and the original was restored. ${error.message}`);
}

console.log(`\n✓ Pi Tool Groups installed\n\nPi: ${pkg.version}\nExecutable: ${executable}\nPatched: ${target}\nBackup: ${backup}\n\nRestart Pi to activate the grouped tool-call UI.`);
