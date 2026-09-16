(function (root) {
    'use strict';

    const CURRENCIES = [
        { code: 'TWD', label: '新臺幣 TWD', patterns: [/\bTWD\b/i, /\bNTD\b/i, /NT\$/i, /新臺幣/, /台幣/] },
        { code: 'JPY', label: '日圓 JPY', patterns: [/\bJPY\b/i, /日圓/, /円/, /￥/] },
        { code: 'KRW', label: '韓元 KRW', patterns: [/\bKRW\b/i, /韓元/, /원/, /₩/] },
        { code: 'USD', label: '美元 USD', patterns: [/\bUSD\b/i, /US\$/i, /美元/] },
        { code: 'EUR', label: '歐元 EUR', patterns: [/\bEUR\b/i, /歐元/, /€/] },
        { code: 'GBP', label: '英鎊 GBP', patterns: [/\bGBP\b/i, /英鎊/, /£/] },
        { code: 'HKD', label: '港幣 HKD', patterns: [/\bHKD\b/i, /HK\$/i, /港幣/] },
        { code: 'CNY', label: '人民幣 CNY', patterns: [/\bCNY\b/i, /\bRMB\b/i, /人民幣/, /人民币/] },
        { code: 'AUD', label: '澳幣 AUD', patterns: [/\bAUD\b/i, /A\$/i, /澳幣/] },
        { code: 'CAD', label: '加幣 CAD', patterns: [/\bCAD\b/i, /C\$/i, /加幣/] },
        { code: 'SGD', label: '新加坡幣 SGD', patterns: [/\bSGD\b/i, /S\$/i, /新加坡幣/] },
        { code: 'THB', label: '泰銖 THB', patterns: [/\bTHB\b/i, /泰銖/, /฿/] },
        { code: 'MYR', label: '馬幣 MYR', patterns: [/\bMYR\b/i, /\bRM\s?/i, /馬幣/] },
        { code: 'PHP', label: '菲律賓披索 PHP', patterns: [/\bPHP\b/i, /₱/, /披索/] },
        { code: 'VND', label: '越南盾 VND', patterns: [/\bVND\b/i, /₫/, /越南盾/] },
        { code: 'IDR', label: '印尼盾 IDR', patterns: [/\bIDR\b/i, /\bRp\s?/i, /印尼盾/] }
    ];

    const normalizeFullWidth = (value) => String(value || '')
        .replace(/[０-９]/g, character => String(character.charCodeAt(0) - 0xFEE0))
        .replace(/，/g, ',')
        .replace(/．/g, '.')
        .replace(/：/g, ':')
        .replace(/￥/g, '¥');

    const parseAmountToken = (token) => {
        let value = String(token || '').replace(/[^\d,.'-]/g, '').replace(/'/g, '');
        if (!value || !/\d/.test(value)) return null;
        const commaCount = (value.match(/,/g) || []).length;
        const dotCount = (value.match(/\./g) || []).length;
        if (commaCount && dotCount) {
            const decimalMark = value.lastIndexOf(',') > value.lastIndexOf('.') ? ',' : '.';
            const thousandsMark = decimalMark === ',' ? /\./g : /,/g;
            value = value.replace(thousandsMark, '').replace(decimalMark, '.');
        } else if (commaCount) {
            const tailLength = value.length - value.lastIndexOf(',') - 1;
            value = commaCount === 1 && tailLength === 2 ? value.replace(',', '.') : value.replace(/,/g, '');
        } else if (dotCount > 1) {
            value = value.replace(/\./g, '');
        }
        const amount = Number.parseFloat(value);
        return Number.isFinite(amount) ? Math.abs(amount) : null;
    };

    const extractCurrency = (text, preferredCurrency) => {
        const normalized = normalizeFullWidth(text);
        for (const currency of CURRENCIES) {
            if (currency.patterns.some(pattern => pattern.test(normalized))) {
                return { currency: currency.code, ambiguous: false };
            }
        }
        if (/¥/.test(normalized)) {
            if (/[円ぁ-んァ-ヶ一-龠]/.test(normalized)) return { currency: 'JPY', ambiguous: false };
            if (/人民|人民币|RMB|CNY/i.test(normalized)) return { currency: 'CNY', ambiguous: false };
        }
        if (/\$/.test(normalized)) return { currency: preferredCurrency || 'USD', ambiguous: !/\b(?:USD|AUD|CAD|SGD|HKD)\b/i.test(normalized) };
        return { currency: preferredCurrency || 'USD', ambiguous: true };
    };

    const formatDate = (year, month, day) => {
        let numericYear = Number.parseInt(year, 10);
        const numericMonth = Number.parseInt(month, 10);
        const numericDay = Number.parseInt(day, 10);
        if (numericYear < 100) numericYear += numericYear >= 70 ? 1900 : 2000;
        if (numericYear < 2000 || numericYear > 2100 || numericMonth < 1 || numericMonth > 12 || numericDay < 1 || numericDay > 31) return '';
        return `${numericYear}-${String(numericMonth).padStart(2, '0')}-${String(numericDay).padStart(2, '0')}`;
    };

    const extractDate = (text) => {
        const normalized = normalizeFullWidth(text);
        let match = normalized.match(/\b(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/);
        if (match) return { date: formatDate(match[1], match[2], match[3]), rawDate: match[0], ambiguous: false };
        match = normalized.match(/\b(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(20\d{2})\b/);
        if (match) return { date: '', rawDate: match[0], ambiguous: true };
        match = normalized.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
        if (match) return { date: formatDate(match[1], match[2], match[3]), rawDate: match[0], ambiguous: false };
        return { date: '', rawDate: '', ambiguous: false };
    };

    const amountPattern = /(?:[$€£¥₩₱฿]\s*)?(?:\d{1,3}(?:[,'\s.]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g;
    const positiveTotalPattern = /grand\s*total|amount\s*due|balance\s*due|total\s*amount|\btotal\b|總計|合計|應付|實付|總額|お会計|お買上|総合計|合計金額|총\s*금액|결제\s*금액|합계|총액/i;
    const strongestTotalPattern = /grand\s*total|amount\s*due|balance\s*due|總計|應付總額|総合計|合計金額|결제\s*금액|총액/i;
    const negativeTotalPattern = /sub\s*total|subtotal|小計|税|tax|vat|change|cash|tender|discount|折扣|折引|お預|釣銭|거스름|현금|card\s*(?:no|number)/i;

    const extractTotal = (lines) => {
        const candidates = [];
        lines.forEach((line, lineIndex) => {
            const tokens = line.match(amountPattern) || [];
            tokens.forEach((token, tokenIndex) => {
                const amount = parseAmountToken(token);
                if (!amount || amount > 100000000) return;
                let score = Math.min(20, Math.log10(amount + 1) * 4);
                if (positiveTotalPattern.test(line)) score += 70;
                if (strongestTotalPattern.test(line)) score += 35;
                if (negativeTotalPattern.test(line)) score -= 85;
                if (/[$€£¥₩₱฿]|\b(?:TWD|NTD|JPY|KRW|USD|EUR|GBP|HKD|CNY|RMB|AUD|CAD|SGD|THB|MYR|PHP|VND|IDR)\b/i.test(line)) score += 12;
                if (/\d{1,2}[/:.-]\d{1,2}[/:.-]\d{2,4}/.test(line)) score -= 35;
                if (/\d{1,2}:\d{2}/.test(line)) score -= 25;
                if (tokenIndex === tokens.length - 1) score += 5;
                score += Math.min(6, lineIndex / Math.max(1, lines.length) * 6);
                candidates.push({ amount, line, score });
            });
        });
        candidates.sort((left, right) => right.score - left.score || right.amount - left.amount);
        const best = candidates[0];
        return best ? { amount: best.amount, sourceLine: best.line, confident: best.score >= 55 } : { amount: null, sourceLine: '', confident: false };
    };

    const guessMerchant = (lines) => {
        const ignored = /receipt|invoice|tax\s*invoice|welcome|thank\s*you|電話|tel\b|fax\b|address|地址|發票|領収書|レシート|영수증|사업자|日時|date\b/i;
        const candidate = lines.slice(0, 10).find(line => {
            const letters = line.replace(/[^A-Za-z\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g, '');
            return letters.length >= 2 && !ignored.test(line) && !positiveTotalPattern.test(line) && !/^[-_=*\s]+$/.test(line);
        });
        return candidate ? candidate.replace(/\s{2,}/g, ' ').trim().slice(0, 60) : '';
    };

    const parseText = (rawText, options = {}) => {
        const text = normalizeFullWidth(rawText).replace(/\u0000/g, '');
        const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
        const currencyResult = extractCurrency(text, options.preferredCurrency);
        const dateResult = extractDate(text);
        const totalResult = extractTotal(lines);
        return {
            merchant: guessMerchant(lines),
            date: dateResult.date,
            rawDate: dateResult.rawDate,
            dateAmbiguous: dateResult.ambiguous,
            currency: currencyResult.currency,
            currencyAmbiguous: currencyResult.ambiguous,
            amount: totalResult.amount,
            amountSourceLine: totalResult.sourceLine,
            amountConfident: totalResult.confident,
            lineCount: lines.length
        };
    };

    const preprocessImage = file => new Promise((resolve, reject) => {
        if (!file || !String(file.type || '').startsWith('image/')) {
            reject(new Error('請選擇 JPG、PNG 或 HEIC 相片。'));
            return;
        }
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            try {
                const maxDimension = 1900;
                const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
                const width = Math.max(1, Math.round(image.naturalWidth * scale));
                const height = Math.max(1, Math.round(image.naturalHeight * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                context.drawImage(image, 0, 0, width, height);
                const imageData = context.getImageData(0, 0, width, height);
                const pixels = imageData.data;
                for (let index = 0; index < pixels.length; index += 4) {
                    const gray = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];
                    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 138));
                    pixels[index] = contrasted;
                    pixels[index + 1] = contrasted;
                    pixels[index + 2] = contrasted;
                }
                context.putImageData(imageData, 0, 0);
                resolve({
                    dataUrl: canvas.toDataURL('image/jpeg', 0.9),
                    width,
                    height,
                    originalName: file.name || 'receipt.jpg'
                });
            } catch (error) {
                reject(error);
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('無法讀取這張相片，請改用 JPG 或 PNG 再試。'));
        };
        image.src = objectUrl;
    });

    root.SplitEasyReceiptOcr = {
        currencies: CURRENCIES.map(({ code, label }) => ({ code, label })),
        parseText,
        parseAmountToken,
        preprocessImage
    };
})(typeof window !== 'undefined' ? window : globalThis);

