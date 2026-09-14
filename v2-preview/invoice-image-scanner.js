(function (global) {
    'use strict';

    const LEFT_QR_PATTERN = /^[A-Z]{2}\d{8}\d{7}[\d ]{4}[0-9A-Fa-f]{16}/;
    const RIGHT_QR_PATTERN = /^\*\*/;

    const classifyCode = (value) => {
        const code = String(value || '').trim();
        if (LEFT_QR_PATTERN.test(code)) return 'left';
        if (RIGHT_QR_PATTERN.test(code)) return 'right';
        return 'other';
    };

    const hasInvoicePair = (codes) => {
        const types = new Set(codes.map(classifyCode));
        return types.has('left') && types.has('right');
    };

    const appendUnique = (target, values) => {
        values.forEach(value => {
            const code = String(value || '').trim();
            if (code && !target.includes(code)) target.push(code);
        });
    };

    const nextFrame = () => new Promise(resolve => global.setTimeout(resolve, 0));

    const loadImage = async (file) => {
        if (!file || !String(file.type || '').startsWith('image/')) {
            throw new Error('請選擇發票照片。');
        }

        if (typeof global.createImageBitmap === 'function') {
            try {
                const bitmap = await global.createImageBitmap(file, { imageOrientation: 'from-image' });
                return {
                    source: bitmap,
                    width: bitmap.width,
                    height: bitmap.height,
                    dispose: () => bitmap.close?.()
                };
            } catch (error) {
                console.warn('createImageBitmap 無法讀取照片，改用圖片元件：', error);
            }
        }

        const objectUrl = global.URL.createObjectURL(file);
        const image = new Image();
        image.decoding = 'async';
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('照片載入失敗，請重新拍攝。'));
            image.src = objectUrl;
        });
        return {
            source: image,
            width: image.naturalWidth,
            height: image.naturalHeight,
            dispose: () => global.URL.revokeObjectURL(objectUrl)
        };
    };

    const makeBaseCanvas = (source, width, height) => {
        const maxDimension = 2600;
        const scale = Math.min(1, maxDimension / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        return canvas;
    };

    const buildCropPlans = () => {
        const plans = [
            { label: '完整照片', x: 0, y: 0, width: 1, height: 1, maxSide: 1600 },
            { label: '照片下半部', x: 0, y: 0.45, width: 1, height: 0.55, maxSide: 1400 },
            { label: '照片中段', x: 0, y: 0.225, width: 1, height: 0.55, maxSide: 1400 },
            { label: '照片上半部', x: 0, y: 0, width: 1, height: 0.55, maxSide: 1400 }
        ];

        const rowStarts = [0, 0.2, 0.4, 0.6];
        const columnStarts = [0, 0.225, 0.45];
        rowStarts.forEach((y, rowIndex) => {
            columnStarts.forEach((x, columnIndex) => {
                plans.push({
                    label: `區域 ${rowIndex + 1}-${columnIndex + 1}`,
                    x,
                    y,
                    width: 0.55,
                    height: 0.4,
                    maxSide: 1250
                });
            });
        });
        return plans;
    };

    const renderCrop = (baseCanvas, plan) => {
        const sourceX = Math.max(0, Math.floor(baseCanvas.width * plan.x));
        const sourceY = Math.max(0, Math.floor(baseCanvas.height * plan.y));
        const sourceWidth = Math.min(baseCanvas.width - sourceX, Math.ceil(baseCanvas.width * plan.width));
        const sourceHeight = Math.min(baseCanvas.height - sourceY, Math.ceil(baseCanvas.height * plan.height));
        const longestSide = Math.max(sourceWidth, sourceHeight);
        const shortestSide = Math.max(1, Math.min(sourceWidth, sourceHeight));
        const upscale = Math.min(2, Math.max(1, 720 / shortestSide));
        const scale = Math.min(upscale, plan.maxSide / longestSide);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(baseCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        return canvas;
    };

    const maskResult = (imageData, result) => {
        const location = result?.location;
        if (!location) return;
        const points = [location.topLeftCorner, location.topRightCorner, location.bottomRightCorner, location.bottomLeftCorner].filter(Boolean);
        if (!points.length) return;
        const xs = points.map(point => point.x);
        const ys = points.map(point => point.y);
        const padding = Math.max(10, Math.round(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.15));
        const startX = Math.max(0, Math.floor(Math.min(...xs) - padding));
        const endX = Math.min(imageData.width, Math.ceil(Math.max(...xs) + padding));
        const startY = Math.max(0, Math.floor(Math.min(...ys) - padding));
        const endY = Math.min(imageData.height, Math.ceil(Math.max(...ys) + padding));
        for (let y = startY; y < endY; y += 1) {
            for (let x = startX; x < endX; x += 1) {
                const offset = (y * imageData.width + x) * 4;
                imageData.data[offset] = 255;
                imageData.data[offset + 1] = 255;
                imageData.data[offset + 2] = 255;
                imageData.data[offset + 3] = 255;
            }
        }
    };

    const increaseContrast = (source) => {
        const enhanced = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
        const histogram = new Uint32Array(256);
        let pixels = 0;
        for (let index = 0; index < enhanced.data.length; index += 16) {
            const gray = Math.round(enhanced.data[index] * 0.299 + enhanced.data[index + 1] * 0.587 + enhanced.data[index + 2] * 0.114);
            histogram[gray] += 1;
            pixels += 1;
        }
        const lowerTarget = pixels * 0.03;
        const upperTarget = pixels * 0.97;
        let cumulative = 0;
        let low = 0;
        let high = 255;
        for (let value = 0; value < 256; value += 1) {
            cumulative += histogram[value];
            if (cumulative >= lowerTarget) { low = value; break; }
        }
        cumulative = 0;
        for (let value = 0; value < 256; value += 1) {
            cumulative += histogram[value];
            if (cumulative >= upperTarget) { high = value; break; }
        }
        if (high - low < 40) {
            low = Math.max(0, low - 20);
            high = Math.min(255, high + 20);
        }
        const range = Math.max(1, high - low);
        for (let index = 0; index < enhanced.data.length; index += 4) {
            const gray = enhanced.data[index] * 0.299 + enhanced.data[index + 1] * 0.587 + enhanced.data[index + 2] * 0.114;
            const adjusted = Math.max(0, Math.min(255, Math.round((gray - low) * 255 / range)));
            enhanced.data[index] = adjusted;
            enhanced.data[index + 1] = adjusted;
            enhanced.data[index + 2] = adjusted;
            enhanced.data[index + 3] = 255;
        }
        return enhanced;
    };

    const decodeImageData = (sourceImageData) => {
        const codes = [];
        const working = new ImageData(new Uint8ClampedArray(sourceImageData.data), sourceImageData.width, sourceImageData.height);
        const decode = imageData => global.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });

        let result = decode(working);
        if (result?.data) {
            appendUnique(codes, [result.data]);
            maskResult(working, result);
            result = decode(working);
            if (result?.data) appendUnique(codes, [result.data]);
        }

        if (!hasInvoicePair(codes)) {
            const enhanced = increaseContrast(working);
            result = decode(enhanced);
            if (result?.data) {
                appendUnique(codes, [result.data]);
                maskResult(enhanced, result);
                result = decode(enhanced);
                if (result?.data) appendUnique(codes, [result.data]);
            }
        }
        return codes;
    };

    const scanPreparedCanvas = async (baseCanvas, options = {}) => {
        if (typeof global.jsQR !== 'function') throw new Error('QR 辨識元件尚未載入，請確認網路後重新開啟頁面。');
        const plans = buildCropPlans();
        const codes = [];
        let attempts = 0;

        for (const plan of plans) {
            attempts += 1;
            options.onProgress?.({ current: attempts, total: plans.length, label: plan.label, codes: [...codes] });
            const cropCanvas = renderCrop(baseCanvas, plan);
            const context = cropCanvas.getContext('2d', { willReadFrequently: true });
            appendUnique(codes, decodeImageData(context.getImageData(0, 0, cropCanvas.width, cropCanvas.height)));
            cropCanvas.width = 1;
            cropCanvas.height = 1;
            if (hasInvoicePair(codes)) break;
            if (attempts % 2 === 0) await nextFrame();
        }

        return {
            codes,
            attempts,
            totalPlans: plans.length,
            foundLeft: codes.some(code => classifyCode(code) === 'left'),
            foundRight: codes.some(code => classifyCode(code) === 'right'),
            foundPair: hasInvoicePair(codes)
        };
    };

    const scanCanvas = async (sourceCanvas, options = {}) => {
        const baseCanvas = makeBaseCanvas(sourceCanvas, sourceCanvas.width, sourceCanvas.height);
        try {
            return await scanPreparedCanvas(baseCanvas, options);
        } finally {
            baseCanvas.width = 1;
            baseCanvas.height = 1;
        }
    };

    const scanFile = async (file, options = {}) => {
        const loaded = await loadImage(file);
        try {
            const baseCanvas = makeBaseCanvas(loaded.source, loaded.width, loaded.height);
            try {
                return await scanPreparedCanvas(baseCanvas, options);
            } finally {
                baseCanvas.width = 1;
                baseCanvas.height = 1;
            }
        } finally {
            loaded.dispose();
        }
    };

    global.SplitEasyInvoiceImageScanner = Object.freeze({ scanFile, scanCanvas, classifyCode, buildCropPlans });
})(window);



