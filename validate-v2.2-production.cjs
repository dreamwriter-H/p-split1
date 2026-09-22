"use strict";

const fs = require("fs");

const html = fs.readFileSync("index.html", "utf8");
const rules = fs.readFileSync("firestore.rules", "utf8");
const lines = html.split(/\r?\n/).length;
const bytes = Buffer.byteLength(html);
const failures = [];

function expect(name, condition) {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    console.error(`FAIL ${name}`);
    failures.push(name);
  }
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

expect("index >= 180000 bytes", bytes >= 180000);
expect("index >= 2300 lines", lines >= 2300);
expect("no truncation marker", !/(?:tokens truncated|…\s*\d+\s*tokens|\.\.\.\s*truncated)/i.test(html));

[
  "const APP_VERSION = '2.2.0'",
  "const BUILD_ID = 'v2.2.0'",
  "const DATA_SPACE = 'spliteasy-v2-2-prod'",
  "const USER_INDEX_SPACE = 'spliteasy-v2-2-prod'",
  "const DATA_SCHEMA_VERSION = '2.2.0'",
  "class AppErrorBoundary extends React.Component",
  "const DialogModal =",
  "const LoginScreen =",
  "const TravelMode =",
  "const DiningMode =",
  "ReactDOM.createRoot(document.getElementById('root'))",
  "await setPersistence(auth, browserLocalPersistence)",
  "indexSnapshot.metadata.hasPendingWrites",
  "const getProjectWithRetry = async",
  "Post-create index confirmation failed",
  "Post-join index confirmation failed",
  "Ensure project index failed",
  "batch.delete(userProjectRefFor(member.id, project.id))",
  "batch.delete(userProjectRefFor(memberDoc.id, project.id))",
  "applyInputValue(event, value => setTrip(prev => ({ ...prev, name: value })))",
  "applyInputValue(event, value => updateData('title', value))",
].forEach((marker) => expect(`marker: ${marker}`, html.includes(marker)));

expect("all three runtime cache keys use v2.2.0", [
  "./invoice-image-scanner.js?v=2.2.0",
  "./invoice-qr-parser.js?v=2.2.0",
  "./receipt-ocr.js?v=2.2.0",
].every((marker) => html.includes(marker)));

expect("no preview runtime constants", !html.includes("spliteasy-v2-2-preview")
  && !html.includes("2.2.0-preview")
  && !html.includes("v2.2.0-rc4"));
expect("no test-build UI wording", !html.includes("測試版"));
expect("production schema key", html.includes("const productionSchemaKey = 'splitEasy_v2_2_prod_schemaVersion'"));

const removedKeys = [
  "splitEasy_apiKey",
  "splitEasy_currentProject",
  "splitEasy_myProjects",
  "splitEasy_schemaVersion",
  "splitEasy_v2_2_preview_schemaVersion",
];
removedKeys.forEach((key) => expect(`cleanup key: ${key}`, count(html, `'${key}'`) === 1));
expect("no broad web-storage clear", !html.includes("localStorage.clear(") && !html.includes("sessionStorage.clear("));
expect("does not mention Firebase auth storage keys", !/firebase:(?:authUser|persistence)/.test(html));

const unsafeCompositionHandlers = html.split(/\r?\n/)
  .filter((line) => line.includes("onCompositionEnd="))
  .map((line) => {
    const start = line.indexOf("onCompositionEnd=");
    const end = line.indexOf("onChange=", start);
    return line.slice(start, end < 0 ? line.length : end);
  })
  .filter((handler) => /(?:currentTarget|target)\.value/.test(handler));
expect("IME handlers do not defer event.value", unsafeCompositionHandlers.length === 0);
expect("permission-denied never deletes an index", !html.includes("deleteDoc(indexDoc.ref)")
  && !/permission-denied[\s\S]{0,500}deleteDoc\(userProjectRefFor/.test(html));

const galleryInputs = html.match(/<input[^>]+ref=\{(?:galleryInputRef|singleQrGalleryInputRef)\}[^>]*>/g) || [];
expect("gallery inputs exist", galleryInputs.length >= 2);
expect("gallery inputs do not force camera", galleryInputs.every((tag) => !/capture=/.test(tag)));

[
  "function productionProjectPath(projectId)",
  "function productionMemberPath(projectId, uid)",
  "function productionInvitePath(projectId, inviteId)",
  "match /apps/spliteasy-v2-2-prod/projects/{projectId}",
  "request.resource.data.schemaVersion == '2.2.0'",
  "match /users/{userId}/spaces/spliteasy-v2-2-prod/projects/{projectId}",
  "match /apps/spliteasy-v2/projects/{document=**}",
  "match /users/{userId}/projects/{document=**}",
  "match /apps/spliteasy-v2-2-preview/projects/{document=**}",
  "match /users/{userId}/spaces/spliteasy-v2-2-preview/projects/{document=**}",
  "match /artifacts/{document=**}",
].forEach((marker) => expect(`rules marker: ${marker}`, rules.includes(marker)));

expect("legacy v2 allows removed", !rules.includes("match /apps/spliteasy-v2/projects/{projectId}"));
expect("preview allows removed", !rules.includes("match /apps/spliteasy-v2-2-preview/projects/{projectId}"));
expect("no users root allow", !/match \/users\/\{userId\}\s*\{/.test(rules));

if (failures.length) {
  console.error(`V2_2_PRODUCTION_VALIDATION_FAILED ${failures.length}`);
  process.exit(1);
}

console.log(`V2_2_PRODUCTION_VALIDATION_OK bytes=${bytes} lines=${lines}`);
