'use strict';

// Run only against a local Firestore emulator, never against a real project.
// See tests/recovery-rules.md for installation and execution instructions.
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, deleteDoc, collection, getDocs } = require('firebase/firestore');

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)) {
    throw new Error('Set FIRESTORE_EMULATOR_HOST to localhost:<port>; these tests never use production.');
}

const [host, port] = emulatorHost.split(':');
const projectId = 'demo-aa-recovery-rules';
const space = 'apps/spliteasy-v2-2-prod/projects';
const oldToken = 'recovery-token-before-0001';
const newToken = 'recovery-token-after-00002';
const nextRevision = 5;
const google = { firebase: { sign_in_provider: 'google.com' } };
const initialProject = {
    id: 'project', name: '規則測試', type: 'travel', ownerId: 'owner',
    schemaVersion: '2.2.0', createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z', data: { days: 1, people: [], expenses: [] }
};

async function main() {
    const environment = await initializeTestEnvironment({
        projectId,
        firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8') }
    });
    let passed = 0;
    try {
        await environment.clearFirestore();
        const cases = [
            ['legacy project remains editable before migration', false, 'editor', p => ({ ...p, name: '舊版正常修改' }), true],
            ['legacy project can migrate to a recovery token', false, 'editor', p => ({ ...p, recoveryWriteToken: newToken, recoveryWriteRevision: 1 }), true],
            ['upgraded project rejects legacy full-document spread', true, 'editor', p => ({ ...p, data: { ...p.data, expenses: [{ id: 'stale', amount: 100 }] } }), false],
            ['upgraded project rejects removing the token', true, 'editor', p => { const next = { ...p }; delete next.recoveryWriteToken; return next; }, false],
            ['upgraded project rejects unchanged token', true, 'editor', p => ({ ...p, name: '未換 token' }), false],
            ['upgraded project rejects numeric token', true, 'editor', p => ({ ...p, recoveryWriteToken: 1234567890123456, recoveryWriteRevision: nextRevision }), false],
            ['upgraded project rejects short token', true, 'editor', p => ({ ...p, recoveryWriteToken: 'short', recoveryWriteRevision: nextRevision }), false],
            ['upgraded project accepts editor with rotated token', true, 'editor', p => ({ ...p, name: '新版修改', recoveryWriteToken: newToken, recoveryWriteRevision: nextRevision }), true],
            ['upgraded project accepts owner with rotated token', true, 'owner', p => ({ ...p, recoveryWriteToken: newToken, recoveryWriteRevision: nextRevision }), true],
            ['upgraded project rejects stale replay with an older different token', true, 'editor', p => ({ ...p, recoveryWriteToken: 'older-stale-token-00000', recoveryWriteRevision: 3 }), false],
            ['new token cannot reuse the same revision', true, 'editor', p => ({ ...p, recoveryWriteToken: newToken }), false],
            ['new token cannot skip a revision', true, 'editor', p => ({ ...p, recoveryWriteToken: newToken, recoveryWriteRevision: 6 }), false],
            ['new token cannot remove the revision', true, 'editor', p => { const next = { ...p, recoveryWriteToken: newToken }; delete next.recoveryWriteRevision; return next; }, false],
            ['new token cannot use a noninteger revision', true, 'editor', p => ({ ...p, recoveryWriteToken: newToken, recoveryWriteRevision: 4.5 }), false],
            ['token-only marker requires its first revision increment', 'token-only', 'editor', p => ({ ...p, recoveryWriteToken: newToken, recoveryWriteRevision: 1 }), true],
            ['token-only marker rejects old copied metadata', 'token-only', 'editor', p => ({ ...p, recoveryWriteToken: newToken }), false],
            ['revision-only marker allows the next revision and first token', 'revision-only', 'editor', p => ({ ...p, recoveryWriteToken: newToken, recoveryWriteRevision: nextRevision }), true],
            ['revision-only marker rejects an old copied document', 'revision-only', 'editor', p => ({ ...p, name: '舊版複製' }), false],
            ['rotated token does not grant a non-member access', true, 'outsider', p => ({ ...p, recoveryWriteToken: newToken, recoveryWriteRevision: nextRevision }), false],
            ['rotated token does not grant an anonymous client access', true, null, p => ({ ...p, recoveryWriteToken: newToken, recoveryWriteRevision: nextRevision }), false],
            ['rotated token cannot change ownerId', true, 'editor', p => ({ ...p, ownerId: 'editor', recoveryWriteToken: newToken, recoveryWriteRevision: nextRevision }), false],
            ['rotated token cannot change project type', true, 'editor', p => ({ ...p, type: 'dining', recoveryWriteToken: newToken, recoveryWriteRevision: nextRevision }), false],
            ['rotated token cannot change schemaVersion', true, 'editor', p => ({ ...p, schemaVersion: 'other', recoveryWriteToken: newToken, recoveryWriteRevision: nextRevision }), false]
        ];
        for (let index = 0; index < cases.length; index++) {
            const [name, upgraded, actor, transform, allowed] = cases[index];
            const id = `case-${index}`;
            const markers = upgraded === 'token-only' ? { recoveryWriteToken: oldToken }
                : upgraded === 'revision-only' ? { recoveryWriteRevision: 4 }
                : upgraded ? { recoveryWriteToken: oldToken, recoveryWriteRevision: 4 } : {};
            const project = { ...initialProject, id, ...markers };
            await environment.withSecurityRulesDisabled(async context => {
                const database = context.firestore();
                await setDoc(doc(database, space, id), project);
                await setDoc(doc(database, space, id, 'members', 'owner'), { role: 'owner' });
                await setDoc(doc(database, space, id, 'members', 'editor'), { role: 'editor' });
            });
            const database = actor ? environment.authenticatedContext(actor, google).firestore() : environment.unauthenticatedContext().firestore();
            const operation = setDoc(doc(database, space, id), transform(project));
            await (allowed ? assertSucceeds(operation) : assertFails(operation));
            console.log(`PASS ${name}`);
            passed++;
        }

        const ownerDb = environment.authenticatedContext('owner', google).firestore();
        const editorDb = environment.authenticatedContext('editor', google).firestore();
        await assertSucceeds(getDoc(doc(editorDb, space, 'case-2')));
        console.log('PASS upgraded project remains readable by members'); passed++;
        await assertFails(getDocs(collection(editorDb, space)));
        console.log('PASS project collection listing remains denied'); passed++;
        await assertFails(deleteDoc(doc(editorDb, space, 'case-2')));
        console.log('PASS editor still cannot delete the entire project'); passed++;
        await assertSucceeds(deleteDoc(doc(ownerDb, space, 'case-2')));
        console.log('PASS owner project deletion remains explicitly allowed'); passed++;
        console.log(`RECOVERY_RULES_EMULATOR_OK ${passed}`);
    } finally {
        await environment.cleanup();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
