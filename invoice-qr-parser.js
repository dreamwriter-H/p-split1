(function (global) {
    'use strict';

    const decodeBase64Utf8 = (value) => {
        const compact = value.replace(/\s/g, '');
        const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, '=');
        const binary = global.atob(padded);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
    };

    const parseRocInvoiceDate = (value) => {
        if (!/^\d{7}$/.test(value)) return '';
        const year = parseInt(value.slice(0, 3), 10) + 1911;
        const month = value.slice(3, 5);
        const day = value.slice(5, 7);
        return `${year}-${month}-${day}`;
    };

    const parseItemTriples = (tokens, expectedCount) => {
        const items = [];
        const limit = Number.isFinite(expectedCount) && expectedCount > 0 ? expectedCount : Math.floor(tokens.length / 3);
        for (let index = 0; index + 2 < tokens.length && items.length < limit; index += 3) {
            const name = String(tokens[index] || '').trim();
            const quantity = parseFloat(tokens[index + 1]);
            const unitPrice = parseFloat(tokens[index + 2]);
            if (!name || !Number.isFinite(quantity) || !Number.isFinite(unitPrice)) continue;
            items.push({ name, quantity, unitPrice, amount: quantity * unitPrice });
        }
        return items;
    };

    const parse = (rawCodes) => {
        const codes = [...new Set((rawCodes || []).map(code => String(code || '').trim()).filter(Boolean))];
        const leftCode = codes.find(code => !code.startsWith('**') && /^[A-Z]{2}\d{8}\d{7}[\d ]{4}[0-9A-Fa-f]{16}/.test(code));
        const rightCodes = codes.filter(code => code.startsWith('**'));
        if (!leftCode) return { status: 'waiting-left', message: rightCodes.length ? '已讀到右方 QR，請再掃描左方 QR。' : '尚未讀到有效的臺灣電子發票左方 QR。' };
        if (leftCode.length < 77) return { status: 'error', message: '左方 QR 資料長度不足，請重新拍攝。' };

        const totalAmount = parseInt(leftCode.slice(29, 37), 16);
        const salesAmount = parseInt(leftCode.slice(21, 29), 16);
        const invoice = {
            invoiceNumber: leftCode.slice(0, 10),
            date: parseRocInvoiceDate(leftCode.slice(10, 17)),
            randomNumber: leftCode.slice(17, 21),
            salesAmount: Number.isFinite(salesAmount) ? salesAmount : 0,
            totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
            buyerId: leftCode.slice(37, 45),
            sellerId: leftCode.slice(45, 53)
        };

        const detailPayload = `${leftCode.slice(77)}${rightCodes.map(code => code.slice(2)).join('')}`;
        let items = [];
        let expectedCount = 0;
        let encoding = '';
        if (detailPayload.startsWith(':')) {
            const fields = detailPayload.slice(1).split(':');
            expectedCount = parseInt(fields[1], 10) || 0;
            encoding = fields[3] || '';
            try {
                if (encoding === '2') {
                    items = parseItemTriples(decodeBase64Utf8(fields.slice(4).join(':')).split(':'), expectedCount);
                } else if (encoding === '0' || encoding === '1') {
                    items = parseItemTriples(fields.slice(4), expectedCount);
                }
            } catch (error) {
                console.warn('電子發票品項解碼失敗：', error);
            }
        }

        const hasRightSide = rightCodes.length > 0;
        const isComplete = expectedCount === 0 || items.length >= expectedCount;
        return {
            status: 'ready',
            invoice,
            items,
            expectedCount,
            encoding,
            hasRightSide,
            isComplete,
            message: !hasRightSide && expectedCount > items.length ? '發票品項尚未完整，請再掃描右方 QR。' : '電子發票已讀取，請核對品項與總額。'
        };
    };

    global.SplitEasyInvoice = Object.freeze({ parse });
})(window);


