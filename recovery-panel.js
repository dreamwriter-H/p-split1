(function (root, factory) {
    'use strict';
    const RecoveryPanel = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = RecoveryPanel;
    else root.RecoveryPanel = RecoveryPanel;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    const DAY = 24 * 60 * 60 * 1000;
    const ACTIONS = {
        create: '新增', edit: '修改', delete: '刪除', restore: '還原',
        'add-day': '新增天數', 'delete-day': '刪除整天'
    };
    const FIELDS = {
        desc: '品項', name: '名稱', amount: '金額', payers: '付款人',
        splitBetween: '分攤者', splitAmounts: '分攤金額', participantIds: '分攤者',
        day: '天數', title: '名稱', date: '日期', people: '成員',
        splitMode: '分帳方式', totalBill: '總金額', billPayerId: '付款人',
        serviceChargeType: '服務費方式', serviceChargeValue: '服務費',
        customAmounts: '分攤金額', receiptMeta: '收據資訊', diningImport: '聚餐來源'
    };
    const asTime = value => {
        if (value == null) return NaN;
        if (typeof value === 'number') return value;
        return new Date(value).getTime();
    };
    const datePart = (value, options) => {
        const time = asTime(value);
        if (!Number.isFinite(time)) return '時間不明';
        return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', ...options }).format(time);
    };
    const monthDay = value => datePart(value, { year: 'numeric', month: '2-digit', day: '2-digit' });
    const hourMinute = value => datePart(value, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const expiryTime = archive => {
        const explicit = asTime(archive.expiresAtISO ?? archive.expiresAt);
        const deleted = asTime(archive.deletedAtISO ?? archive.deletedAt);
        // A legacy archive can never stay restorable beyond seven days.
        const maximum = Number.isFinite(deleted) ? deleted + 7 * DAY : NaN;
        if (!Number.isFinite(maximum)) return NaN;
        return archive.expiresAtISO === undefined && archive.expiresAt === undefined ? maximum : Number.isFinite(explicit) ? Math.min(explicit, maximum) : NaN;
    };
    const archiveLabel = archive => archive.label || archive.item?.desc || archive.item?.name || (archive.kind === 'day' ? '旅遊整天' : '未命名帳目');
    const actorName = (name, uid) => (typeof name === 'string' ? name.trim() : '') || (uid ? `成員 …${String(uid).slice(-6)}` : '未命名成員');
    const remainingLabel = remaining => {
        if (remaining >= DAY) return `${Math.ceil(remaining / DAY)} 天內可還原`;
        if (remaining >= 60 * 60 * 1000) return `${Math.ceil(remaining / (60 * 60 * 1000))} 小時內可還原`;
        return '不到 1 小時後到期';
    };

    function RecoveryPanel({ project, onClose, onRestore, busy = false, now }) {
        const React = root.React;
        if (!React) throw new Error('RecoveryPanel requires React.');
        const h = React.createElement;
        const { useState, useRef, useEffect } = React;
        const [tab, setTab] = useState('bin');
        const [clock, setClock] = useState(() => Number.isFinite(now) ? now : Date.now());
        const [restoringId, setRestoringId] = useState(null);
        const [error, setError] = useState('');
        const panelRef = useRef(null);
        const closeRef = useRef(null);
        const closeHandlerRef = useRef(onClose);
        closeHandlerRef.current = onClose;
        const idRef = useRef(null);
        if (!idRef.current) idRef.current = `recovery-${Math.random().toString(36).slice(2, 10)}`;
        const titleId = `${idRef.current}-title`;
        const descriptionId = `${idRef.current}-description`;
        const tabId = `${idRef.current}-tab-${tab}`;
        const panelId = `${idRef.current}-content`;

        useEffect(() => {
            const base = Number.isFinite(now) ? now : Date.now();
            const startedAt = Date.now();
            const refresh = () => setClock(base + Math.max(0, Date.now() - startedAt));
            refresh();
            const timer = root.setInterval(refresh, 30 * 1000);
            return () => root.clearInterval(timer);
        }, [now]);

        useEffect(() => {
            const originalFocus = root.document.activeElement;
            const originalOverflow = root.document.body.style.overflow;
            root.document.body.style.overflow = 'hidden';
            closeRef.current?.focus();
            const onKeyDown = event => {
                // Global confirmation/error dialogs sit above this panel. They
                // must retain keyboard control while they are open.
                const externalModal = event.target?.closest?.('[role="dialog"]');
                if (externalModal && externalModal !== panelRef.current && !panelRef.current?.contains(externalModal)) return;
                const globalDialog = root.document.querySelector('.aa-dialog-modal');
                if (globalDialog?.getClientRects().length) return;
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    closeHandlerRef.current?.();
                    return;
                }
                if (event.key !== 'Tab') return;
                const focusable = Array.from(panelRef.current?.querySelectorAll(
                    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
                ) || []).filter(element => element.getClientRects().length > 0);
                const first = focusable[0], last = focusable[focusable.length - 1];
                if (!first) { event.preventDefault(); panelRef.current?.focus(); return; }
                const focused = root.document.activeElement;
                if (event.shiftKey && (focused === first || !panelRef.current?.contains(focused))) {
                    event.preventDefault(); last.focus();
                } else if (!event.shiftKey && (focused === last || !panelRef.current?.contains(focused))) {
                    event.preventDefault(); first.focus();
                }
            };
            root.document.addEventListener('keydown', onKeyDown, true);
            return () => {
                root.document.removeEventListener('keydown', onKeyDown, true);
                root.document.body.style.overflow = originalOverflow;
                if (originalFocus?.isConnected) originalFocus.focus();
            };
        }, []);

        const archives = (Array.isArray(project?.data?.recycleBin) ? project.data.recycleBin : [])
            .filter(archive => expiryTime(archive) > clock)
            .slice().sort((left, right) => asTime(right.deletedAtISO ?? right.deletedAt) - asTime(left.deletedAtISO ?? left.deletedAt));
        const history = (Array.isArray(project?.data?.activityLog) ? project.data.activityLog : [])
            .slice().sort((left, right) => (asTime(right.at) || 0) - (asTime(left.at) || 0));
        const isBusy = busy || restoringId !== null;

        const restore = async id => {
            if (isBusy || typeof onRestore !== 'function') return;
            setRestoringId(id);
            setError('');
            try { await onRestore(id); }
            catch (caught) { setError(caught?.message || '暫時無法還原，請稍後再試。'); }
            finally { setRestoringId(null); }
        };
        const switchTabWithKeyboard = event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'bin' : event.key === 'End' ? 'history' : tab === 'bin' ? 'history' : 'bin';
            setTab(next);
            panelRef.current?.querySelector(`[data-recovery-tab="${next}"]`)?.focus();
        };
        const tabButton = (key, label, count) => h('button', {
            key, type: 'button', id: `${idRef.current}-tab-${key}`, role: 'tab',
            'aria-controls': panelId, 'aria-selected': tab === key, tabIndex: tab === key ? 0 : -1,
            'data-recovery-tab': key, onClick: () => setTab(key), onKeyDown: switchTabWithKeyboard
        }, label, h('span', { className: 'aa-recovery-count', 'aria-label': `${count} 筆` }, count));
        const empty = (title, description) => h('div', { className: 'aa-recovery-empty' },
            h('span', { className: 'aa-recovery-empty-symbol', 'aria-hidden': 'true' }, tab === 'bin' ? '↶' : '◷'),
            h('p', null, title), h('span', null, description));

        return h('div', { className: 'aa-recovery' },
            h('section', { ref: panelRef, className: 'aa-recovery-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': descriptionId, tabIndex: -1 },
                h('header', { className: 'aa-recovery-header' },
                    h('div', null, h('p', { className: 'aa-recovery-eyebrow' }, '一起記帳，安心找回'), h('h2', { id: titleId }, '回收桶與修改紀錄')),
                    h('button', { ref: closeRef, type: 'button', className: 'aa-recovery-close', onClick: onClose, 'aria-label': '關閉回收桶與修改紀錄' }, '×')),
                h('p', { id: descriptionId, className: 'aa-recovery-description' }, '刪除後保留 7 天，逾期無法還原。時間以臺灣時間顯示。'),
                h('div', { className: 'aa-recovery-tabs', role: 'tablist', 'aria-label': '回收桶與紀錄分頁' }, tabButton('bin', '回收桶', archives.length), tabButton('history', '修改紀錄', history.length)),
                h('div', { className: 'aa-recovery-content', id: panelId, role: 'tabpanel', 'aria-labelledby': tabId, tabIndex: 0 },
                    error && h('p', { className: 'aa-recovery-error', role: 'alert' }, error),
                    tab === 'bin' ? (
                        archives.length ? h('ul', { className: 'aa-recovery-list', 'aria-label': '可還原的帳目與天數' }, ...archives.map(archive => {
                            const label = archiveLabel(archive), deletedAt = archive.deletedAtISO ?? archive.deletedAt;
                            return h('li', { key: archive.id, className: 'aa-recovery-card' },
                                h('div', { className: 'aa-recovery-card-top' },
                                    h('span', { className: `aa-recovery-kind ${archive.kind === 'day' ? 'aa-recovery-kind-day' : ''}` }, archive.kind === 'day' ? `整天 · ${(archive.expenses || []).length} 筆帳目` : archive.collection === 'diningItems' ? '聚餐品項' : '旅遊支出'),
                                    h('span', { className: 'aa-recovery-expiry', title: `到期時間：${monthDay(expiryTime(archive))} ${hourMinute(expiryTime(archive))}` }, remainingLabel(expiryTime(archive) - clock))),
                                h('h3', null, label),
                                h('p', { className: 'aa-recovery-actor' }, `${actorName(archive.deletedByName, archive.deletedBy)}　${hourMinute(deletedAt)} 刪除`),
                                h('div', { className: 'aa-recovery-card-bottom' },
                                    h('time', { dateTime: typeof deletedAt === 'string' ? deletedAt : undefined }, monthDay(deletedAt)),
                                    h('button', { type: 'button', className: 'aa-recovery-restore', disabled: isBusy || typeof onRestore !== 'function', onClick: () => restore(archive.id), 'aria-label': `還原「${label}」` }, restoringId === archive.id ? '還原中…' : '還原')));
                        })) : empty('回收桶目前是空的', '刪除的帳目與整天資料會在這裡保留 7 天。')
                    ) : (
                        history.length ? h('ol', { className: 'aa-recovery-list aa-recovery-history', 'aria-label': '帳目修改紀錄' }, ...history.map((event, index) => {
                            const fields = Array.isArray(event.changedFields) ? event.changedFields.map(field => FIELDS[field] || field) : [];
                            const label = event.label || '帳目';
                            return h('li', { key: event.id || `${event.at}-${index}`, className: `aa-recovery-card aa-recovery-event aa-recovery-action-${event.action}` },
                                h('div', { className: 'aa-recovery-card-top' },
                                    h('span', { className: 'aa-recovery-event-action' }, ACTIONS[event.action] || '更新'),
                                    h('time', { dateTime: typeof event.at === 'string' ? event.at : undefined }, monthDay(event.at))),
                                h('h3', null, label),
                                h('p', { className: 'aa-recovery-actor' }, `${actorName(event.actorName, event.actorId)}　${hourMinute(event.at)} ${ACTIONS[event.action] || '更新'}`),
                                fields.length > 0 && h('p', { className: 'aa-recovery-fields', title: fields.join('、') }, `變更：${fields.slice(0, 3).join('、')}${fields.length > 3 ? ` 等 ${fields.length} 個欄位` : ''}`));
                        })) : empty('還沒有修改紀錄', '啟用此功能後，新增、修改、刪除與還原會記錄在這裡。')
                    ))));
    }

    return RecoveryPanel;
});
