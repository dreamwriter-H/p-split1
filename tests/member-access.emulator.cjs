'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { collection, doc, getDocFromServer, getDocsFromServer, serverTimestamp, setDoc, updateDoc, writeBatch } = require('firebase/firestore');

const projectId = 'demo-aa-recovery-rules';
const space = 'spliteasy-v2-2-prod';
const scope = `apps/${space}`;
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)) {
    throw new Error('Set FIRESTORE_EMULATOR_HOST to localhost:<port>; this test never uses production.');
}
const [host, port] = emulatorHost.split(':');
const claims = (uid, verified = true) => ({email: `${uid}@example.test`, email_verified: verified, firebase: {sign_in_provider: 'google.com'}});
const account = (db, uid) => doc(db, scope, 'accessAccounts', uid);
const manager = db => doc(db, scope, 'accessConfig', 'owner');
const ledger = (db, id = 'ledger-a') => doc(db, scope, 'projects', id);
const member = (db, uid) => doc(ledger(db), 'members', uid);
const invite = db => doc(ledger(db), 'invites', 'test-invite-id');
const index = (db, uid) => doc(db, 'users', uid, 'spaces', space, 'projects', 'ledger-a');
const profile = (uid, status = 'pending') => ({
    email: claims(uid).email, name: uid, status, firstSeenAt: serverTimestamp(), lastSeenAt: serverTimestamp()
});
const setStatus = (db, uid, status) => updateDoc(account(db, uid), {status, statusChangedAt: serverTimestamp()});
const newLedger = (id, ownerId) => ({id, ownerId, name: '測試帳本', type: 'dining', schemaVersion: '2.2.0', createdAt: '2026-11-18', updatedAt: '2026-11-18', data: {}});

async function main() {
    const environment = await initializeTestEnvironment({projectId, firestore: {
        host, port: Number(port),
        rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    }});
    try {
        await environment.clearFirestore();
        await environment.withSecurityRulesDisabled(ctx => setDoc(manager(ctx.firestore()), {email: claims('founder').email}));
        const owner = environment.authenticatedContext('founder', claims('founder')).firestore();
        const a = environment.authenticatedContext('friend-a', claims('friend-a')).firestore();
        const b = environment.authenticatedContext('friend-b', claims('friend-b')).firestore();
        const lookalike = environment.authenticatedContext('unverified', claims('founder', false)).firestore();

        await assertSucceeds(getDocFromServer(manager(owner)));
        await assertFails(getDocFromServer(manager(lookalike)));
        await assertFails(getDocFromServer(manager(a)));
        await assertFails(setDoc(manager(a), {email: claims('friend-a').email}));
        for (const [db, uid] of [[owner, 'founder'], [a, 'friend-a'], [b, 'friend-b']]) {
            await assertSucceeds(setDoc(account(db, uid), profile(uid)));
        }
        await assertFails(setStatus(b, 'friend-b', 'approved'));
        await assertFails(setDoc(account(b, 'other-user'), profile('friend-b', 'approved')));
        await assertFails(getDocsFromServer(collection(a, scope, 'accessAccounts')));
        await assertFails(getDocFromServer(account(a, 'friend-b')));
        const roster = await assertSucceeds(getDocsFromServer(collection(owner, scope, 'accessAccounts')));
        assert.equal(roster.size, 3);
        await assertSucceeds(setStatus(owner, 'friend-a', 'approved'));

        const create = writeBatch(a);
        create.set(ledger(a), newLedger('ledger-a', 'friend-a'));
        create.set(member(a, 'friend-a'), {role: 'owner'});
        create.set(index(a, 'friend-a'), {role: 'owner'});
        await assertSucceeds(create.commit());
        await assertSucceeds(setDoc(invite(a), {status: 'active', createdBy: 'friend-a'}));
        await assertSucceeds(getDocFromServer(ledger(a)));
        await assertFails(getDocFromServer(ledger(owner)));
        await assertFails(getDocFromServer(invite(b)));
        await assertFails(setDoc(member(b, 'friend-b'), {role: 'editor', inviteId: 'test-invite-id'}));
        await assertFails(setDoc(ledger(b, 'other-ledger'), newLedger('other-ledger', 'friend-b')));
        await assertFails(getDocsFromServer(collection(b, 'users/friend-b/spaces', space, 'projects')));

        await assertSucceeds(setStatus(owner, 'friend-b', 'approved'));
        await assertFails(getDocFromServer(ledger(b)));
        await assertSucceeds(getDocFromServer(invite(b)));
        const join = writeBatch(b);
        join.set(member(b, 'friend-b'), {role: 'editor', inviteId: 'test-invite-id'});
        join.set(index(b, 'friend-b'), {role: 'editor'});
        await assertSucceeds(join.commit());
        await assertSucceeds(getDocFromServer(ledger(b)));
        await assertSucceeds(updateDoc(ledger(b), {name: '共編已成功'}));
        await assertSucceeds(setStatus(owner, 'friend-b', 'blocked'));
        await assertFails(getDocFromServer(ledger(b)));
        await assertFails(updateDoc(ledger(b), {name: '停用後寫入'}));
        await assertFails(getDocFromServer(index(b, 'friend-b')));
        await assertSucceeds(updateDoc(account(b, 'friend-b'), {name: '朋友 B', lastSeenAt: serverTimestamp()}));
        const blocked = await assertSucceeds(getDocFromServer(account(b, 'friend-b')));
        assert.equal(blocked.data().status, 'blocked');
        await assertSucceeds(setStatus(owner, 'friend-b', 'approved'));
        await assertSucceeds(getDocFromServer(ledger(b)));
        console.log('MEMBER_ACCESS_EMULATOR_OK 管理權、待核准、自建帳本、共編、停用和恢復均通過');
    } finally {
        await environment.cleanup();
    }
}

module.exports = main;
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

