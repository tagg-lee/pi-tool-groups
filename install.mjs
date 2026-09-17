#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SUPPORTED_VERSION = "0.85.1";
const PATCH_MARKER = "pi-tool-groups-patch:v0.1.0";

function fail(message) {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

function run(command, args = []) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function findPiPackage() {
  let executable;
  try {
    executable = run(process.platform === "win32" ? "where" : "which", ["pi"]).split(/\r?\n/)[0];
  } catch {
    fail("Could not find the `pi` executable in PATH.");
  }

  const realExecutable = fs.realpathSync(executable);
  let cursor = path.dirname(realExecutable);
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
  fail(`Could not locate @earendil-works/pi-coding-agent from ${realExecutable}.`);
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(before, after);
}

function patchBundle(source) {
  const groupClass = `var ToolGroupComponent=class extends Container{toolsContainer=new Container;headerText=new Text("",1,0);headerRegion;ui;expanded=!1;count=0;constructor(ui){super(),this.ui=ui,this.headerRegion=new MouseRegion(this.headerText,event=>event.type!=="click"||event.button!=="left"?void 0:(this.setExpanded(!this.expanded),this.ui.requestRender(),{handled:!0})),this.addChild(this.headerRegion),this.updateHeader()}addTool(component){this.count+=1,this.toolsContainer.addChild(component),this.updateHeader(),this.expanded&&!this.children.includes(this.toolsContainer)&&this.addChild(this.toolsContainer)}setExpanded(expanded){this.expanded!==expanded&&(this.expanded=expanded,expanded?this.children.includes(this.toolsContainer)||this.addChild(this.toolsContainer):this.removeChild(this.toolsContainer),this.updateHeader())}updateHeader(){let arrow=this.expanded?"▾":"▸",label=this.count===1?"1 TOOL CALL":\`${"${this.count}"} TOOL CALLS\`,hint=this.expanded?"":\`  (${"${keyText(\"app.tools.expand\")}"} to expand)\`,rail=theme.fg("accent","│ "),badge=theme.fg("accent",theme.bold(\`${"${arrow}"} [ ${"${label}"} ]\`));this.headerText.setText(rail+badge+theme.fg("dim",hint))}invalidate(){super.invalidate(),this.updateHeader()}};`;

  source = replaceOnce(source, "var InteractiveMode=class _InteractiveMode{", `/* ${PATCH_MARKER} */${groupClass}var InteractiveMode=class _InteractiveMode{`, "insert ToolGroupComponent");
  source = replaceOnce(source, "pendingTools=new Map;toolOutputExpanded=!1;", "pendingTools=new Map;streamingToolGroup=void 0;toolOutputExpanded=!1;", "add group state");
  source = replaceOnce(source, "this.streamingComponent=void 0,this.streamingMessage=void 0,this.pendingTools.clear(),this.renderInitialMessages()", "this.streamingComponent=void 0,this.streamingMessage=void 0,this.streamingToolGroup=void 0,this.pendingTools.clear(),this.renderInitialMessages()", "reset render state");
  source = replaceOnce(source, 'case"agent_start":this.pendingTools.clear(),', 'case"agent_start":this.pendingTools.clear(),this.streamingToolGroup=void 0,', "reset agent group");
  source = replaceOnce(source, "component.setExpanded(this.toolOutputExpanded),this.chatContainer.addChild(component),this.pendingTools.set(content.id,component)", "component.setExpanded(!1),this.streamingToolGroup||(this.streamingToolGroup=new ToolGroupComponent(this.ui),this.streamingToolGroup.setExpanded(this.toolOutputExpanded),this.chatContainer.addChild(this.streamingToolGroup)),this.streamingToolGroup.addTool(component),this.pendingTools.set(content.id,component)", "group streaming tools");
  source = replaceOnce(source, "component.setExpanded(this.toolOutputExpanded),this.chatContainer.addChild(component),this.pendingTools.set(event.toolCallId,component)", "component.setExpanded(!1),this.streamingToolGroup||(this.streamingToolGroup=new ToolGroupComponent(this.ui),this.streamingToolGroup.setExpanded(this.toolOutputExpanded),this.chatContainer.addChild(this.streamingToolGroup)),this.streamingToolGroup.addTool(component),this.pendingTools.set(event.toolCallId,component)", "group fallback tools");
  source = replaceOnce(source, 'case"agent_end":this.settingsManager.getShowTerminalProgress()', 'case"agent_end":this.streamingToolGroup=void 0,this.settingsManager.getShowTerminalProgress()', "clear agent group");
  source = replaceOnce(source, "let renderedPendingTools=new Map,cacheMisses=", "let renderedPendingTools=new Map,historicalToolGroup=void 0,cacheMisses=", "add historical group");

  const historicalBefore = 'if(message.role==="assistant"){this.addMessageToChat(message);for(let content of message.content)if(content.type==="toolCall"){let component=new ToolExecutionComponent(content.name,content.id,content.arguments,{showImages:this.settingsManager.getShowImages(),imageWidthCells:this.settingsManager.getImageWidthCells()},this.getRegisteredToolDefinition(content.name),this.ui,this.sessionManager.getCwd());if(component.setExpanded(this.toolOutputExpanded),this.chatContainer.addChild(component),message.stopReason==="aborted"||message.stopReason==="error")';
  const historicalAfter = 'if(message.role==="assistant"){this.addMessageToChat(message);let toolCalls=message.content.filter(content=>content.type==="toolCall");toolCalls.length>0&&!historicalToolGroup&&(historicalToolGroup=new ToolGroupComponent(this.ui),historicalToolGroup.setExpanded(this.toolOutputExpanded),this.chatContainer.addChild(historicalToolGroup));let toolGroup=historicalToolGroup;for(let content of toolCalls){let component=new ToolExecutionComponent(content.name,content.id,content.arguments,{showImages:this.settingsManager.getShowImages(),imageWidthCells:this.settingsManager.getImageWidthCells()},this.getRegisteredToolDefinition(content.name),this.ui,this.sessionManager.getCwd());if(component.setExpanded(!1),toolGroup.addTool(component),message.stopReason==="aborted"||message.stopReason==="error")';
  source = replaceOnce(source, historicalBefore, historicalAfter, "group historical tools");
  source = replaceOnce(source, '}else this.addMessageToChat(message,options)}for(let[toolCallId,component]', '}else message.role==="user"?(historicalToolGroup=void 0,this.addMessageToChat(message,options)):this.addMessageToChat(message,options)}for(let[toolCallId,component]', "separate historical runs");
  return source;
}

const { root, pkg, executable } = findPiPackage();
if (pkg.version !== SUPPORTED_VERSION) {
  fail(`Pi ${pkg.version} is not supported. This release only supports Pi ${SUPPORTED_VERSION}. No files were changed.`);
}

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
