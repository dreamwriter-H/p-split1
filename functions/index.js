'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const { purgeExpiredRecycleBins } = require('./recycle-bin-cleanup');

initializeApp();

// Deployment is separate from the website. Requires a configured Scheduler/Billing project.
exports.purgeExpiredRecycleBin = onSchedule({
    schedule: 'every 15 minutes',
    timeZone: 'Asia/Taipei',
    region: 'asia-east1',
    memory: '256MiB',
    timeoutSeconds: 300,
    maxInstances: 1,
    concurrency: 1,
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300
}, async () => {
    const summary = await purgeExpiredRecycleBins(getFirestore(), {
        now: Date.now,
        documentIdField: FieldPath.documentId(),
        onError: (error, context) => logger.error('Recycle-bin cleanup transaction failed.', {
            projectId: context.projectId,
            message: error.message
        })
    });
    logger.info('Recycle-bin cleanup finished.', summary);
    if (summary.failed) throw new Error(`${summary.failed} cleanup transaction(s) failed; scheduler retry required.`);
});
