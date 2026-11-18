'use strict';

const { randomUUID: makeUUID } = require('node:crypto');
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PROJECT_COLLECTION = 'apps/spliteasy-v2-2-prod/projects';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 5;

/** Match the client's hard deadline; never extend seven days with expiresAt. */
function archiveDeadline(archive) {
    const deleted = Date.parse(archive?.deletedAt);
    if (!Number.isFinite(deleted)) return null;
    const hardDeadline = deleted + RETENTION_MS;
    if (archive.expiresAt === undefined) return hardDeadline;
    const explicit = Date.parse(archive.expiresAt);
    return Number.isFinite(explicit) ? Math.min(hardDeadline, explicit) : null;
}

/** Pure plan. Unknown timestamps are retained for investigation, never guessed away. */
function planCleanup(project, now = Date.now()) {
    if (!Number.isFinite(now)) throw new TypeError('Cleanup requires a valid server timestamp.');
    const archives = Array.isArray(project?.data?.recycleBin) ? project.data.recycleBin : [];
    const remaining = [];
    let removed = 0, nextDeadline = Infinity;
    for (const archive of archives) {
        const deadline = archiveDeadline(archive);
        if (deadline !== null && now >= deadline) { removed += 1; continue; }
        remaining.push(archive);
        if (deadline !== null) nextDeadline = Math.min(nextDeadline, deadline);
    }
    const nextExpiry = Number.isFinite(nextDeadline) ? new Date(nextDeadline).toISOString() : null;
    return {
        remaining,
        removed,
        nextExpiry,
        needsWrite: removed > 0 || (project?.recycleBinNextExpiry ?? null) !== nextExpiry
    };
}

/**
 * Bounded, cursor-based Firestore adapter. Query snapshots are only candidates:
 * every transaction rereads the current project before planning a field update.
 */
async function purgeExpiredRecycleBins(db, options = {}) {
    const clock = options.now || Date.now;
    const randomUUID = options.randomUUID || makeUUID;
    const documentIdField = options.documentIdField || '__name__';
    const pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
    const maxPages = options.maxPages || DEFAULT_MAX_PAGES;
    const concurrency = options.concurrency || 8;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
        !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50 ||
        !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
        throw new TypeError('Invalid cleanup bounds.');
    }
    const cutoff = clock();
    if (!Number.isFinite(cutoff)) throw new TypeError('Invalid cleanup server clock.');
    const cutoffISO = new Date(cutoff).toISOString();
    const summary = { scanned: 0, updated: 0, removed: 0, skipped: 0, failed: 0, pages: 0, limited: false };
    const seen = new Set();
    let cursor = null;
    for (let page = 0; page < maxPages; page += 1) {
        let query = db.collection(PROJECT_COLLECTION)
            .where('recycleBinNextExpiry', '>', '')
            .where('recycleBinNextExpiry', '<=', cutoffISO)
            .orderBy('recycleBinNextExpiry')
            .orderBy(documentIdField)
            .limit(pageSize);
        if (cursor) query = query.startAfter(cursor);
        const snapshot = await query.get();
        const docs = snapshot.docs || [];
        summary.pages += 1;
        if (!docs.length) break;
        // Preserve the original query snapshot so later metadata writes cannot move its cursor.
        cursor = docs[docs.length - 1];
        let index = 0;
        async function worker() {
            while (index < docs.length) {
                const candidate = docs[index++];
                const path = candidate.ref.path;
                if (seen.has(path)) { summary.skipped += 1; continue; }
                seen.add(path);
                summary.scanned += 1;
                try {
                    const result = await db.runTransaction(async transaction => {
                        const current = await transaction.get(candidate.ref);
                        if (!current.exists) return { updated: false, removed: 0 };
                        const latest = current.data();
                        const plan = planCleanup(latest, clock());
                        if (!plan.needsWrite) return { updated: false, removed: 0 };
                        const previousRevision = Number(latest.recoveryWriteRevision) || 0;
                        if (!Number.isSafeInteger(previousRevision) || previousRevision < 0 || previousRevision === Number.MAX_SAFE_INTEGER) {
                            throw new Error('Invalid recovery write revision; cleanup left project untouched.');
                        }
                        transaction.update(candidate.ref, {
                            'data.recycleBin': plan.remaining,
                            recycleBinNextExpiry: plan.nextExpiry,
                            recoveryWriteToken: randomUUID(),
                            recoveryWriteRevision: previousRevision + 1
                        });
                        return { updated: true, removed: plan.removed };
                    });
                    if (result.updated) { summary.updated += 1; summary.removed += result.removed; }
                    else summary.skipped += 1;
                } catch (error) {
                    summary.failed += 1;
                    options.onError?.(error, { projectId: candidate.id });
                }
            }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, docs.length) }, worker));
        if (docs.length < pageSize) break;
        if (page === maxPages - 1) summary.limited = true;
    }
    return summary;
}

module.exports = { RETENTION_MS, PROJECT_COLLECTION, DEFAULT_PAGE_SIZE, DEFAULT_MAX_PAGES,
    archiveDeadline, planCleanup, purgeExpiredRecycleBins };
